/* ============================================================
   Lucubratio · IndexedDB 底层封装（零依赖）
   为什么手写而不引 Dexie：
   - 项目没有打包器，引 Dexie 需要 vendor 一个 ~80KB 的文件并长期跟版本；
   - 我们只有 7 个 store、查询都是"按索引取全部"，手写 150 行足够且完全可控。
   代价：没有 Dexie 的链式 API 与自动迁移，迁移逻辑由本文件的 SCHEMA 表显式维护。
   ============================================================ */

export const DB_NAME = 'lucubratio';
export const DB_VERSION = 1;

/**
 * 表定义：[storeName, {keyPath}, [ [indexName, keyPath, options?], ... ]]
 * 新增表 / 新增索引 → 提升 DB_VERSION 并在 upgrade() 里追加分支（不要改老分支）。
 */
const SCHEMA = [
  ['meta', { keyPath: 'key' }, []],
  ['settings', { keyPath: 'key' }, []],
  ['progress', { keyPath: 'cid' }, [['visitedAt', 'visitedAt'], ['pct', 'pct']]],
  ['attempts', { keyPath: 'id' }, [['qid', 'qid'], ['cid', 'cid'], ['ts', 'ts']]],
  ['cards', { keyPath: 'qid' }, [['due', 'due'], ['cid', 'cid'], ['state', 'state']]],
  ['reviews', { keyPath: 'id' }, [['qid', 'qid'], ['ts', 'ts']]],
  ['bookmarks', { keyPath: 'id' }, [['cid', 'cid']]],
];

export const STORES = SCHEMA.map((s) => s[0]);

/** 各表主键字段，导入备份时用于行校验 */
export const KEY_PATHS = {
  meta: 'key',
  settings: 'key',
  progress: 'cid',
  attempts: 'id',
  cards: 'qid',
  reviews: 'id',
  bookmarks: 'id',
};

let dbPromise = null;

function upgrade(db, oldVersion) {
  // ⚠️ 迁移只增不改：每次升级都追加一个 if 块，历史分支永久保留。
  if (oldVersion < 1) {
    for (const [name, opts, indexes] of SCHEMA) {
      if (db.objectStoreNames.contains(name)) continue;
      const store = db.createObjectStore(name, opts);
      for (const [idxName, keyPath, idxOpts] of indexes) {
        store.createIndex(idxName, keyPath, idxOpts || { unique: false });
      }
    }
  }
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = function (e) {
      try {
        upgrade(req.result, e.oldVersion);
      } catch (err) {
        reject(err);
      }
    };
    req.onsuccess = function () {
      const db = req.result;
      // 别的标签页/未来的升级请求：主动让位，避免把对方卡死
      db.onversionchange = function () {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = function () { reject(req.error || new Error('indexedDB open failed')); };
    req.onblocked = function () { reject(new Error('indexedDB blocked by another connection')); };
  });
  return dbPromise;
}

export function closeDB() {
  if (!dbPromise) return Promise.resolve();
  return dbPromise.then(function (db) {
    db.close();
    dbPromise = null;
  }).catch(function () { dbPromise = null; });
}

function asPromise(req) {
  return new Promise(function (resolve, reject) {
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

/** 把 IDBRequest 包成 Promise（供需要自己掌控事务的场景使用） */
export function requestPromise(req) {
  return asPromise(req);
}

/** 在一个事务里执行 fn(transaction)；事务 complete 后 resolve(fn 的返回值) */
export function run(storeNames, mode, fn) {
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      let tx;
      try {
        tx = db.transaction(storeNames, mode);
      } catch (e) {
        reject(e);
        return;
      }
      let result;
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
      try {
        result = fn(tx);
      } catch (e) {
        try { tx.abort(); } catch (_) { /* ignore */ }
        reject(e);
      }
    });
  });
}

export function get(store, key) {
  return run([store], 'readonly', function (tx) {
    return asPromise(tx.objectStore(store).get(key));
  });
}

export function getAll(store) {
  return run([store], 'readonly', function (tx) {
    return asPromise(tx.objectStore(store).getAll());
  });
}

export function getAllByIndex(store, index, query) {
  return run([store], 'readonly', function (tx) {
    return asPromise(tx.objectStore(store).index(index).getAll(query));
  });
}

export function count(store) {
  return run([store], 'readonly', function (tx) {
    return asPromise(tx.objectStore(store).count());
  });
}

/** 取索引上最大的一条（prev 游标），用于"最近阅读" */
export function getLastByIndex(store, index) {
  return run([store], 'readonly', function (tx) {
    return new Promise(function (resolve, reject) {
      const req = tx.objectStore(store).index(index).openCursor(null, 'prev');
      req.onsuccess = function () { resolve(req.result ? req.result.value : null); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

export function put(store, value) {
  return run([store], 'readwrite', function (tx) {
    return asPromise(tx.objectStore(store).put(value));
  });
}

export function putMany(store, values) {
  return run([store], 'readwrite', function (tx) {
    const os = tx.objectStore(store);
    const out = [];
    for (const v of values) out.push(asPromise(os.put(v)));
    return Promise.all(out);
  });
}

export function del(store, key) {
  return run([store], 'readwrite', function (tx) {
    return asPromise(tx.objectStore(store).delete(key));
  });
}

export function clear(store) {
  return run([store], 'readwrite', function (tx) {
    return asPromise(tx.objectStore(store).clear());
  });
}

/** 大致占用（含配额），用于设置页展示 */
export function estimate() {
  if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
  return navigator.storage.estimate().catch(function () { return null; });
}
