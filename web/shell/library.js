/* ============================================================
   Lucubratio · 课程库
   把"内置课程"（打进 APK 的 /manifest.json）与"已导入课程"
   （filesDir/courses/<id>/manifest.json，经 AndroidSA.listCourses() 得知）
   合并成一份统一的课程列表，供首页渲染。
   ============================================================ */

/** 原生桥：已导入课程的元信息（没有桥时返回空数组，浏览器预览也能跑） */
export function listImportedMetas() {
  try {
    if (!window.AndroidSA || typeof window.AndroidSA.listCourses !== 'function') return [];
    var raw = window.AndroidSA.listCourses();
    var o = JSON.parse(raw || '{}');
    var arr = (o && o.courses) || [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[library] 读取已导入课程失败', e);
    return [];
  }
}

function fetchJson(url) {
  return fetch(url, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
    return r.json();
  });
}

/**
 * 载入课程库。
 * @returns {Promise<{builtin: object|null, imported: {meta: object, manifest: object|null}[]}>}
 */
export async function loadLibrary() {
  var builtin = null;
  try {
    builtin = await fetchJson('/manifest.json');
  } catch (e) {
    console.warn('[library] 内置 manifest 读取失败', e);
  }

  var metas = listImportedMetas();
  var imported = [];
  for (var i = 0; i < metas.length; i++) {
    var m = metas[i];
    var man = null;
    try {
      man = await fetchJson('/courses/' + encodeURIComponent(m.id) + '/manifest.json');
    } catch (e) {
      console.warn('[library] 课程 ' + m.id + ' 的 manifest 读取失败', e);
    }
    imported.push({ meta: m, manifest: man });
  }
  return { builtin: builtin, imported: imported };
}

/** 把 manifest 摊平成页面数组 */
export function flattenItems(manifest) {
  var out = [];
  if (!manifest || !manifest.groups) return out;
  manifest.groups.forEach(function (g) {
    (g.items || []).forEach(function (it) { out.push(it); });
  });
  return out;
}

/** 统计：内置页数 / 导入页数 / 课程数 */
export function libraryStats(lib) {
  var builtinPages = flattenItems(lib.builtin).length;
  var importedPages = 0;
  lib.imported.forEach(function (c) {
    var items = flattenItems(c.manifest);
    importedPages += items.length || (c.meta.pages || 0);
  });
  return {
    builtinPages: builtinPages,
    importedPages: importedPages,
    importedCourses: lib.imported.length,
    totalPages: builtinPages + importedPages,
  };
}

/** 把毫秒时间戳格式化成 YYYY-MM-DD */
export function fmtDate(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 字节数 → "11 KB" / "1.2 MB" */
export function fmtBytes(n) {
  var v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return Math.round(v / 1024) + ' KB';
  return (v / 1048576).toFixed(1) + ' MB';
}

/**
 * 从 cid / qid 里解析出课程 id。
 * 内置内容的 cid 不含 ":"（硬约定），导入课程的是 "<课程id>:<原cid>"。
 * @returns {string|null} 课程 id；内置内容返回 null
 */
export function courseIdOf(cidOrQid) {
  var s = String(cidOrQid == null ? '' : cidOrQid);
  var i = s.indexOf(':');
  if (i <= 0) return null;
  return s.slice(0, i);
}

/** 某个 cid/qid 是否属于指定课程 */
export function belongsToCourse(cidOrQid, courseId) {
  return courseIdOf(cidOrQid) === String(courseId);
}

/**
 * 合并检索索引：内置 /search.json + 每门已导入课程的 /courses/<id>/search.json。
 * 因为 cid 在打包期已命名空间化为 "<课程id>:<原cid>"，各门课的键天然不冲突。
 * @returns {Promise<{v:number, pages:object, sections:object[]}>}
 */
export async function loadSearchIndex() {
  var merged = { v: 1, pages: {}, sections: [] };
  try {
    var b = await fetchJson('/search.json');
    Object.assign(merged.pages, b.pages || {});
    if (Array.isArray(b.sections)) merged.sections = merged.sections.concat(b.sections);
  } catch (e) {
    console.warn('[library] 内置检索索引读取失败', e);
  }
  var metas = listImportedMetas();
  for (var i = 0; i < metas.length; i++) {
    var id = metas[i] && metas[i].id;
    if (!id) continue;
    try {
      var s = await fetchJson('/courses/' + encodeURIComponent(id) + '/search.json');
      Object.assign(merged.pages, s.pages || {});
      if (Array.isArray(s.sections)) merged.sections = merged.sections.concat(s.sections);
    } catch (e) {
      console.warn('[library] 课程 ' + id + ' 的检索索引读取失败', e);
    }
  }
  return merged;
}
