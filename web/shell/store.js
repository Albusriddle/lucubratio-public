/* ============================================================
   Lucubratio · 数据层（领域 API）
   职责：进度 / 最近阅读 / 作答 / 卡片 / 复习日志 / 书签 / 设置 + 备份导出导入
   上层（page.js / home.js）只依赖本文件，不直接碰 IndexedDB。
   降级：IndexedDB 不可用时自动退回 localStorage，保证 App 仍可用。
   ============================================================ */
import * as db from './db.js';
import { emptyRecord, schedule } from './fsrs.js';
import { dayKey, addDays, startOfDay } from './time.js';

export const KIND = { idb: 'idb', local: 'local' };

const state = {
  kind: KIND.idb,
  ready: false,
  appVersion: '',
  contentVersion: '',
};

/** 备份格式标识，改动时提升版本 */
export const BACKUP_FORMAT = 'lucubratio-backup';

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function lsKey(cid) { return 'sa:scroll:' + cid; }

/* ---------------- 初始化 ---------------- */

export async function init(opts) {
  state.appVersion = (opts && opts.appVersion) || '';
  state.contentVersion = (opts && opts.contentVersion) || '';

  try {
    await db.openDB();
    await ensureMeta();
    await migrateLegacy();
    state.kind = KIND.idb;
  } catch (e) {
    console.warn('[store] IndexedDB 不可用，降级到 localStorage：', e);
    state.kind = KIND.local;
  }
  state.ready = true;
  return state.kind;
}

export function info() {
  return { kind: state.kind, ready: state.ready, appVersion: state.appVersion, contentVersion: state.contentVersion };
}

async function ensureMeta() {
  const installed = await db.get('meta', 'installedAt');
  if (!installed) {
    await db.put('meta', { key: 'installedAt', value: Date.now() });
  }
  if (state.appVersion) {
    const cur = await db.get('meta', 'appVersion');
    if (!cur || cur.value !== state.appVersion) {
      await db.put('meta', { key: 'appVersion', value: state.appVersion });
    }
  }
  if (state.contentVersion) {
    await db.put('meta', { key: 'contentVersion', value: state.contentVersion });
  }
}

/** 把 P1/P2 时代留在 localStorage 的进度迁到 IndexedDB（只执行一次） */
async function migrateLegacy() {
  const done = await db.get('meta', 'legacyMigrated');
  if (done) return;

  let migrated = 0;
  const lsKeys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('sa:scroll:') === 0) lsKeys.push(k);
    }
  } catch (e) { /* localStorage 不可用则跳过 */ }

  for (const k of lsKeys) {
    const cid = k.slice('sa:scroll:'.length);
    const y = parseInt(localStorage.getItem(k) || '0', 10) || 0;
    if (y > 0) {
      await db.put('progress', {
        cid: cid,
        scrollTop: y,
        pct: 0,
        ratio: 0,
        updatedAt: Date.now(),
        visitedAt: Date.now(),
        legacy: true,
      });
      migrated++;
    }
  }

  try {
    const last = localStorage.getItem('sa:last');
    if (last) {
      const v = JSON.parse(last);
      if (v && v.cid) {
        await db.put('meta', { key: 'lastRead', value: Object.assign({ ts: Date.now() }, v) });
      }
    }
  } catch (e) { /* ignore */ }

  for (const k of lsKeys) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  try { localStorage.removeItem('sa:last'); } catch (e) { /* ignore */ }

  await db.put('meta', { key: 'legacyMigrated', value: Date.now() });
  if (migrated) console.info('[store] 已迁移 ' + migrated + ' 条旧进度');
}

/* ---------------- 进度 ---------------- */

export async function loadProgress(cid) {
  if (state.kind !== KIND.idb) {
    const y = parseInt(localStorage.getItem(lsKey(cid)) || '0', 10) || 0;
    return y > 0 ? { cid: cid, scrollTop: y, pct: 0 } : null;
  }
  return db.get('progress', cid);
}

/**
 * @param {{cid:string,file:string,title:string,scrollTop:number,pct:number,ratio:number}} p
 */
export async function saveProgress(p) {
  const rec = {
    cid: p.cid,
    file: p.file,
    title: p.title,
    scrollTop: Math.round(p.scrollTop || 0),
    pct: Math.max(0, Math.min(100, Math.round(p.pct || 0))),
    ratio: p.ratio || 0,
    visitedAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (state.kind !== KIND.idb) {
    try { localStorage.setItem(lsKey(p.cid), String(rec.scrollTop)); } catch (e) { /* ignore */ }
    return rec;
  }

  await db.put('progress', rec);
  return rec;
}

/**
 * "最近阅读"不单独存一份，直接从 progress 里按 visitedAt 取最新一条。
 * 这样导入备份 / 多设备恢复时不会出现 lastRead 与 progress 不一致。
 */
export async function getLastRead() {
  if (state.kind !== KIND.idb) {
    try {
      const v = JSON.parse(localStorage.getItem('sa:last') || 'null');
      return v && v.cid ? v : null;
    } catch (e) { return null; }
  }
  const rec = await db.getLastByIndex('progress', 'visitedAt');
  if (!rec) return null;
  return {
    cid: rec.cid,
    file: rec.file,
    title: rec.title,
    pct: rec.pct || 0,
    scrollTop: rec.scrollTop || 0,
    ts: rec.visitedAt || rec.updatedAt || 0,
  };
}

export async function getAllProgress() {
  if (state.kind !== KIND.idb) return [];
  return db.getAll('progress');
}

/* ---------------- 作答 / 卡片 / 复习日志（P4） ---------------- */

export function addAttempt(a) {
  if (state.kind !== KIND.idb) return Promise.resolve(null);
  return db.put('attempts', Object.assign({ id: uuid(), ts: Date.now() }, a));
}

export function listAttemptsByCid(cid) {
  if (state.kind !== KIND.idb) return Promise.resolve([]);
  return db.getAllByIndex('attempts', 'cid', cid);
}

export function getCard(qid) {
  if (state.kind !== KIND.idb) return Promise.resolve(null);
  return db.get('cards', qid);
}

export function putCard(card) {
  if (state.kind !== KIND.idb) return Promise.resolve(null);
  return db.put('cards', card);
}

export function getCardsByCid(cid) {
  if (state.kind !== KIND.idb) return Promise.resolve([]);
  return db.getAllByIndex('cards', 'cid', cid);
}

/** 到期卡片（due <= now），跳过"待复核"的孤儿卡，按到期时间升序 */
export async function dueCards(now) {
  if (state.kind !== KIND.idb) return [];
  const t = now || Date.now();
  const list = await db.getAllByIndex('cards', 'due', IDBKeyRange.upperBound(t));
  return list
    .filter(function (c) { return !c.orphan; })
    .sort(function (a, b) { return a.due - b.due; });
}

export async function dueCount(now) {
  return (await dueCards(now)).length;
}

/* ---------------- 内容版本与孤儿卡 ---------------- */

/**
 * 讲义更新后，旧卡片可能指向已不存在的标题。
 * 这里按 contentHash 对账：版本不一致的标 orphan（不进复习队列，等用户复核）。
 * 升级前的老卡片没有 cver 字段，直接认领当前版本，避免一次性全变孤儿。
 */
export async function reconcileContent(cver) {
  if (state.kind !== KIND.idb || !cver) return { orphaned: 0, adopted: 0, total: 0 };
  const cards = await db.getAll('cards');
  const changed = [];
  let orphaned = 0;
  let adopted = 0;

  for (const c of cards) {
    if (!c.cver) {
      c.cver = cver;
      adopted++;
      changed.push(c);
    } else if (c.cver !== cver && !c.orphan) {
      c.orphan = true;
      c.orphanedAt = Date.now();
      orphaned++;
      changed.push(c);
    }
  }
  if (changed.length) await db.putMany('cards', changed);
  return { orphaned: orphaned, adopted: adopted, total: cards.length };
}

export async function orphanCards() {
  if (state.kind !== KIND.idb) return [];
  const all = await db.getAll('cards');
  return all.filter(function (c) { return c.orphan; });
}

export async function orphanCount() {
  return (await orphanCards()).length;
}

/** 用户确认"重新学习"：清掉孤儿标记并立即排进复习队列 */
export async function rearmOrphans() {
  const list = await orphanCards();
  if (!list.length) return 0;
  const now = Date.now();
  for (const c of list) {
    c.orphan = false;
    c.rearmedAt = now;
    c.due = now;
  }
  await db.putMany('cards', list);
  return list.length;
}

function sameLocalDay(a, b) {
  return dayKey(a) === dayKey(b);
}

/**
 * 自评 / 复习打分：推进 FSRS 卡片 + 写一条复习日志 + 写一条作答流水。
 *
 * 内容页的「自评」允许当天改主意：如果同一张卡今天已经用自评打过一次分，
 * 并且那是该卡最新的一条评分，就先回滚到评分前的快照、删掉旧日志，再应用新评分。
 * 这样"再点一次"是**修改**，而不是又复习了一轮（否则 reps/统计会被灌水）。
 *
 * 三张表的写入放在同一个事务里：要么全成，要么全不动。
 *
 * @param {{qid:string,cid:string,file:string,anchor:string,text:string,rating:number,source?:'page'|'review'}} p
 * @returns {Promise<object|null>} 更新后的卡片记录
 */
/* ---------------- 课程删除 ---------------- */

/**
 * 删除一门导入课程在本地的全部数据。
 * 该课程的 cid/qid 都带 "<课程id>:" 前缀（打包期命名空间化），所以按前缀判定即可，
 * 不需要维护"课程 → 数据"的映射表。
 *
 * @returns {Promise<number>} 删掉的行数
 */
export async function deleteCourseData(courseId) {
  var prefix = String(courseId) + ':';
  if (state.kind !== KIND.idb) return 0;
  var stores = db.BACKUP_STORES.filter(function (s) { return s !== 'meta' && s !== 'settings'; });
  var removed = 0;
  await db.run(stores, 'readwrite', function (tx) {
    var jobs = [];
    stores.forEach(function (s) {
      var os = tx.objectStore(s);
      jobs.push(new Promise(function (resolve) {
        var req = os.openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur) { resolve(); return; }
          var row = cur.value || {};
          // reviews 用 qid 判归属，其余表都有 cid
          var key = (s === 'reviews') ? row.qid : row.cid;
          if (typeof key === 'string' && key.indexOf(prefix) === 0) {
            cur.delete();
            removed++;
          }
          cur.continue();
        };
        req.onerror = function () { resolve(); };
      }));
    });
    return Promise.all(jobs);
  });
  return removed;
}

export async function assess(p) {
  if (state.kind !== KIND.idb) return null;

  const now = Date.now();
  const stored = await db.get('cards', p.qid);

  let base = stored;
  let prior = null;

  if (p.source === 'page') {
    const list = await db.getAllByIndex('reviews', 'qid', p.qid);
    const sorted = list.slice().sort(function (a, b) { return b.ts - a.ts; });
    const latest = sorted[0];
    if (latest && latest.source === 'page' && latest.prevCard && sameLocalDay(latest.ts, now)) {
      prior = latest;
      base = Object.assign({}, latest.prevCard);
    }
  }

  if (!base) {
    base = Object.assign(emptyRecord(p.qid, new Date(now)), {
      cid: p.cid,
      file: p.file,
      anchor: p.anchor,
      text: p.text,
      createdAt: now,
    });
  } else {
    base = Object.assign({}, base, {
      cid: base.cid || p.cid,
      file: base.file || p.file,
      anchor: base.anchor || p.anchor,
      text: p.text || base.text,
    });
  }

  const snapshot = JSON.parse(JSON.stringify(base));
  const out = schedule(base, p.rating, new Date(now));
  const merged = Object.assign({}, base, out.card, {
    cid: base.cid,
    file: base.file,
    anchor: base.anchor,
    text: base.text,
    cver: state.contentVersion || base.cver || '',
    orphan: false,
    updatedAt: now,
  });

  const reviewId = uuid();
  const attemptId = uuid();

  await db.run(['cards', 'reviews', 'attempts'], 'readwrite', function (tx) {
    const jobs = [];

    if (prior) {
      jobs.push(db.requestPromise(tx.objectStore('reviews').delete(prior.id)));
      if (prior.attemptId) {
        jobs.push(db.requestPromise(tx.objectStore('attempts').delete(prior.attemptId)));
      }
    }

    jobs.push(db.requestPromise(tx.objectStore('cards').put(merged)));
    jobs.push(db.requestPromise(tx.objectStore('reviews').put({
      id: reviewId,
      qid: p.qid,
      cid: merged.cid,
      rating: p.rating,
      ts: now,
      prevDue: snapshot.due,
      nextDue: merged.due,
      scheduledDays: merged.scheduled_days,
      stability: merged.stability,
      difficulty: merged.difficulty,
      source: p.source || 'page',
      prevCard: snapshot,
      attemptId: attemptId,
    })));
    jobs.push(db.requestPromise(tx.objectStore('attempts').put({
      id: attemptId,
      qid: p.qid,
      cid: merged.cid,
      rating: p.rating,
      correct: p.rating >= 3,
      mode: p.source || 'page',
      ts: now,
    })));

    return Promise.all(jobs);
  });

  return merged;
}

export function addReview(r) {
  if (state.kind !== KIND.idb) return Promise.resolve(null);
  return db.put('reviews', Object.assign({ id: uuid(), ts: Date.now() }, r));
}

/* ---------------- 设置 ---------------- */

export async function getSetting(key, fallback) {
  if (state.kind !== KIND.idb) {
    try {
      const v = localStorage.getItem('sa:set:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  const rec = await db.get('settings', key);
  return rec ? rec.value : fallback;
}

export async function setSetting(key, value) {
  if (state.kind !== KIND.idb) {
    try { localStorage.setItem('sa:set:' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    return;
  }
  await db.put('settings', { key: key, value: value });
}

/* ---------------- 备份：导出 / 导入 ---------------- */

export async function exportSnapshot() {
  const data = {};
  const counts = {};
  if (state.kind === KIND.idb) {
    for (const s of db.BACKUP_STORES) {
      const rows = await db.getAll(s);
      data[s] = rows;
      counts[s] = rows.length;
    }
  } else {
    data.progress = await getAllProgress();
    counts.progress = data.progress.length;
  }
  return {
    format: BACKUP_FORMAT,
    schemaVersion: db.DB_VERSION,
    appVersion: state.appVersion,
    contentVersion: state.contentVersion,
    exportedAt: new Date().toISOString(),
    counts: counts,
    data: data,
  };
}

/**
 * @param {object} snap  exportSnapshot() 的产物
 * @param {{mode?:'replace'|'merge'}} [opts]
 */
/** 备份行校验：主键之外，再挡一次"字段类型不对"（手工改过 / 跨版本拼出来的备份） */
function validateRow(store, row) {
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isStr = (v) => typeof v === 'string' && v.length > 0;

  if (row.cid !== undefined && !isStr(row.cid)) return 'cid 不是合法字符串';
  if (row.qid !== undefined && !isStr(row.qid)) return 'qid 不是合法字符串';

  if (row.pct !== undefined && (!isNum(row.pct) || row.pct < 0 || row.pct > 100)) {
    return 'pct 越界（应在 0–100）：' + row.pct;
  }
  if (row.scrollTop !== undefined && (!isNum(row.scrollTop) || row.scrollTop < 0)) {
    return 'scrollTop 不是合法数字：' + row.scrollTop;
  }
  if (row.due !== undefined && !isNum(row.due)) return 'due 不是时间戳：' + row.due;
  if (row.ts !== undefined && !isNum(row.ts)) return 'ts 不是时间戳：' + row.ts;
  if (row.at !== undefined && !isNum(row.at)) return 'at 不是时间戳：' + row.at;

  const ratings = ['rating', 'lastRating'];
  for (const k of ratings) {
    if (row[k] === undefined) continue;
    if (!isNum(row[k]) || row[k] < 1 || row[k] > 4) return k + ' 越界（应为 1–4）：' + row[k];
  }
  if (row.state !== undefined && (!isNum(row.state) || row.state < 0 || row.state > 3)) {
    return 'state 越界（应为 0–3）：' + row.state;
  }
  if (store === 'progress' && row.pct === undefined) return 'progress 记录缺少 pct';
  if (store === 'cards' && row.qid === undefined) return 'cards 记录缺少 qid';
  return null;
}

export async function importSnapshot(snap, opts) {
  const mode = (opts && opts.mode) || 'replace';

  if (!snap || typeof snap !== 'object') throw new Error('文件内容不是合法 JSON 对象');
  if (snap.format !== BACKUP_FORMAT) throw new Error('不是本应用导出的备份（format 不匹配）');
  if (typeof snap.schemaVersion !== 'number') throw new Error('备份缺少 schemaVersion');
  if (snap.schemaVersion > db.DB_VERSION) {
    throw new Error('备份来自更新的版本（schema ' + snap.schemaVersion + ' > ' + db.DB_VERSION + '），请先升级 App');
  }
  if (state.kind !== KIND.idb) throw new Error('IndexedDB 不可用，无法导入');

  const data = snap.data || {};
  const rowsByStore = {};
  const stats = {};

  // 先整体校验，任何一行不合法就整单拒绝（不做"导入一半"）
  for (const s of db.BACKUP_STORES) {
    let rows = Array.isArray(data[s]) ? data[s] : [];
    if (s === 'meta') {
      rows = rows.filter((r) => r && r.key && r.key !== 'installedAt' && r.key !== 'appVersion');
    }
    const keyPath = db.KEY_PATHS[s];
    for (const r of rows) {
      if (!r || typeof r !== 'object' || r[keyPath] === undefined || r[keyPath] === null) {
        throw new Error('备份数据不合法：表 ' + s + ' 中有记录缺少主键 ' + keyPath);
      }
      const bad = validateRow(s, r);
      if (bad) throw new Error('备份数据不合法：表 ' + s + ' 中 ' + bad);
    }
    rowsByStore[s] = rows;
    stats[s] = rows.length;
  }

  // 跨表单事务：clear + put 全在里面，失败自动回滚，不会留下半空数据库
  await db.run(db.BACKUP_STORES, 'readwrite', function (tx) {
    const jobs = [];
    for (const s of db.BACKUP_STORES) {
      const os = tx.objectStore(s);
      if (mode === 'replace') jobs.push(db.requestPromise(os.clear()));
      for (const r of rowsByStore[s]) jobs.push(db.requestPromise(os.put(r)));
    }
    jobs.push(db.requestPromise(tx.objectStore('meta').put({ key: 'lastImportAt', value: Date.now() })));
    return Promise.all(jobs);
  });

  return stats;
}

export async function storageEstimate() {
  const est = await db.estimate();
  if (!est) return null;
  return { usage: est.usage || 0, quota: est.quota || 0 };
}

/** 各表条数，用于首页"数据与备份" */
export async function stats() {
  if (state.kind !== KIND.idb) {
    const rows = await getAllProgress();
    return { progress: rows.length, attempts: 0, cards: 0, reviews: 0, bookmarks: 0 };
  }
  const [progress, attempts, cards, reviews, bookmarks] = await Promise.all([
    db.count('progress'),
    db.count('attempts'),
    db.count('cards'),
    db.count('reviews'),
    db.count('bookmarks'),
  ]);
  return { progress, attempts, cards, reviews, bookmarks };
}

/** 统计页用的明细：按日复习量、连续天数、卡片状态分布、正确率 */
export async function statsDetail(spanDays) {
  const span = spanDays || 84;
  const endTs = startOfDay(Date.now());
  const startTs = startOfDay(addDays(endTs, -(span - 1)));

  let reviews = [];
  let attempts = [];
  let cards = [];
  let readPages = 0;

  if (state.kind === KIND.idb) {
    // 只取窗口内的数据（reviews/attempts 都有 ts 索引），不整表读
    reviews = await db.getAllByIndex('reviews', 'ts', IDBKeyRange.lowerBound(startTs));
    attempts = await db.getAllByIndex('attempts', 'ts', IDBKeyRange.lowerBound(startTs));
    cards = await db.getAll('cards');
    readPages = await db.count('progress');
  }

  const byDay = {};
  for (const r of reviews) {
    if (!r.ts) continue;
    const k = dayKey(r.ts);
    byDay[k] = (byDay[k] || 0) + 1;
  }

  // 按日历日推进，不用 +86400000（避免夏令时错位）
  const days = [];
  for (let i = 0; i < span; i++) {
    const ts = startOfDay(addDays(startTs, i));
    const k = dayKey(ts);
    days.push({ date: k, ts: ts, count: byDay[k] || 0 });
  }

  // 连续天数：从今天往回数；今天还没复习不算断
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) streak++;
    else if (i === days.length - 1) continue;
    else break;
  }

  const cardStates = [0, 0, 0, 0];
  let due = 0;
  let orphan = 0;
  const now = Date.now();
  for (const c of cards) {
    cardStates[c.state || 0] = (cardStates[c.state || 0] || 0) + 1;
    if (c.orphan) orphan++;
    else if (c.due && c.due <= now) due++;
  }

  const correct = attempts.filter(function (a) { return a.correct; }).length;
  const allReviews = await countReviews();

  return {
    span: span,
    days: days,
    streak: streak,
    reviewTotal: allReviews,
    attemptTotal: attempts.length,
    correctTotal: correct,
    accuracy: attempts.length ? correct / attempts.length : null,
    cardStates: cardStates,
    cardTotal: cards.length,
    due: due,
    orphan: orphan,
    readPages: readPages,
  };
}

async function countReviews() {
  if (state.kind !== KIND.idb) return 0;
  return db.count('reviews');
}
