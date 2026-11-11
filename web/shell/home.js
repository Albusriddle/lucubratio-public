/* ============================================================
   Lucubratio · 首页逻辑
   目录渲染 / 继续学习 / 数据统计 / 备份导出导入
   ============================================================ */
import {
  init, getLastRead, stats, dueCount, exportSnapshot, importSnapshot, info,
  reconcileContent, reconcileByCid, orphanCount, rearmOrphans, deleteCourseData,
} from './store.js';
import { initTheme, getTheme, setTheme, getFont, setFont, THEME_LABEL, FONT_LABEL } from './theme.js';
import { loadLibrary, libraryStats, buildCverMap } from './library.js';

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg) {
    if (window.AndroidSA && window.AndroidSA.toast) window.AndroidSA.toast(String(msg));
    // 没有原生桥时静默（只在浏览器里预览壳页会出现）
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /* ---------------- 目录（内置 + 已导入） ---------------- */
  /* ---------------- 删除课程（两段式确认） ---------------- */
  /* ---------------- 继续学习 ---------------- */
  async function renderContinue() {
    if (!document.getElementById('continue')) return;   // 精简首页/我的页可能没有这个卡
    var last = await getLastRead();
    if (!last || !last.file) return;
    $('c-title').textContent = last.title || '上次的内容';
    var pct = Math.max(0, Math.min(100, last.pct || 0));
    $('c-fill').style.width = Math.max(3, pct) + '%';
    $('c-pct').textContent = '已读 ' + pct + '%　点击继续';
    var el = $('continue');
    el.hidden = false;
    el.href = encodeURI(last.file);
  }

  /* ---------------- 今日复习入口 ---------------- */
  async function renderDue() {
    if (!document.getElementById('due')) return;
    var n = 0;
    try { n = await dueCount(); } catch (e) { n = 0; }
    var el = $('due');
    if (n > 0) {
      $('dueCount').textContent = String(n);
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  /* ---------------- 内容更新后的孤儿卡 ---------------- */
  async function renderOrphan() {
    var n = 0;
    try { n = await orphanCount(); } catch (e) { n = 0; }
    var el = $('orphan');
    if (!el) return;
    if (!n) {
      el.hidden = true;
      return;
    }
    $('orphanCount').textContent = String(n);
    el.hidden = false;
    $('orphanBtn').onclick = async function () {
      try {
        var k = await rearmOrphans();
        toast('已重新排入复习：' + k + ' 张');
        el.hidden = true;
        await renderDue();
        await renderStats();
      } catch (e) {
        toast('操作失败：' + (e && e.message));
      }
    };
  }

  /* ---------------- 数据统计 ---------------- */
  /** 安全写文本：元素不存在就跳过（页面只要实现一部分字段也能正常渲染） */
  function setText(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  async function renderStats() {
    if (!document.getElementById('st-progress')) return;
    var s = await stats();
    setText('st-progress', s.progress + ' 篇');
    setText('st-attempts', s.attempts + ' 条');
    setText('st-cards', s.cards + ' 张');
    var k = info().kind;
    setText('st-kind', k === 'idb' ? 'IndexedDB' : '降级模式');
    setText('st-hint', k === 'idb' ? '' : '存储不可用');
    // 存储正常时这行为空，留着会多一行「存储提示 」的空白——按内容显隐
    var hintRow = document.getElementById('st-hint-row');
    if (hintRow) hintRow.hidden = k === 'idb';
  }

  /* ---------------- 备份：导出 ---------------- */
  async function doExport() {
    var btn = $('btn-export');
    btn.disabled = true;
    try {
      var snap = await exportSnapshot();
      var json = JSON.stringify(snap, null, 1);
      var name = 'lucubratio-backup-' + stamp() + '.json';

      if (window.AndroidSA && window.AndroidSA.exportBackup) {
        window.AndroidSA.exportBackup(json, name);
        return;
      }
      // 浏览器兜底（App 里不会走到）
      var blob = new Blob([json], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    } catch (e) {
      toast('导出失败：' + (e && e.message));
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- 备份：导入 ---------------- */
  function doImport() {
    if (window.AndroidSA && window.AndroidSA.importBackup) {
      window.AndroidSA.importBackup();
      return;
    }
    toast('当前环境不支持导入');
  }

  // 原生读文件后回调这里（必须是全局函数）
  window.__saOnImport = async function (text) {
    try {
      var snap = JSON.parse(text);
      var s = await importSnapshot(snap, { mode: 'replace' });
      toast('导入成功：进度 ' + (s.progress || 0) + ' 条，错题 ' + (s.attempts || 0) + ' 条');
      setTimeout(function () { location.reload(); }, 900);
    } catch (e) {
      toast('导入失败：' + (e && e.message));
    }
  };

  /* ---------------- 外观（主题 / 字号） ---------------- */
  function markSeg(id, attr, val) {
    var btns = $(id).querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute(attr) === val ? 'true' : 'false');
    }
  }

  function initAppearance() {
    if (!document.getElementById('theme-seg')) return;
    var t = getTheme();
    var f = getFont();
    markSeg('theme-seg', 'data-t', t);
    markSeg('fs-seg', 'data-f', f);
    $('theme-v').textContent = THEME_LABEL[t] || t;
    $('fs-v').textContent = FONT_LABEL[f] || f;

    $('theme-seg').addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-t]') : null;
      if (!b) return;
      var v = b.getAttribute('data-t');
      setTheme(v);
      markSeg('theme-seg', 'data-t', v);
      $('theme-v').textContent = THEME_LABEL[v] || v;
    });

    $('fs-seg').addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-f]') : null;
      if (!b) return;
      var v = b.getAttribute('data-f');
      setFont(v);
      markSeg('fs-seg', 'data-f', v);
      $('fs-v').textContent = FONT_LABEL[v] || v;
    });
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    initTheme();
    initAppearance();

    var lib = null;
    try {
      lib = await loadLibrary();
    } catch (e) {
      // 课程库读不出来时，首页只显示 0 篇（列表已移到目录页）
      console.warn('[home] 课程库加载失败', e);
    }

    if (lib) {
      // 顶部「离线学习 · N 篇」（课程列表已搬到目录页，这里只更新计数）
      var st0 = libraryStats(lib);
      var subEl = document.getElementById('sub');
      if (subEl) subEl.innerHTML = '离线学习 · <b>' + st0.totalPages + '</b> 篇';
      var builtin = lib.builtin;
      if (builtin && document.getElementById('ver')) $('ver').textContent = 'v' + builtin.appVersion;
    }

    await init({
      appVersion: lib && lib.builtin ? lib.builtin.appVersion : '',
      contentVersion: lib && lib.builtin ? lib.builtin.contentHash : '',
    });

    // 讲义更新后对账：把指向已变标题的旧卡片标为"待复核"，不直接丢弃
    try {
      // 逐页对账：内置用全局哈希，导入课程用「课程id@版本#页指纹」
      if (lib) await reconcileByCid(buildCverMap(lib));
    } catch (e) {
      console.warn('[home] 内容版本对账失败', e);
    }

    await renderContinue();
    await renderDue();
    await renderOrphan();
    await renderStats();

    var diagBtn = document.getElementById('btn-diag');
    if (diagBtn) diagBtn.addEventListener('click', function () { location.href = '/diagnostics.html'; });

    if (document.getElementById('btn-export')) $('btn-export').addEventListener('click', doExport);
    if (document.getElementById('btn-import')) $('btn-import').addEventListener('click', doImport);

    // 首屏数据都好了 → 通知开屏可以退场（splash 自己保证至少停 500ms）
    if (window.__saSplashDone) window.__saSplashDone();
  }

  boot().catch(function (e) {
    console.error('[home] 启动失败', e);
    if (window.__saSplashDone) window.__saSplashDone(e);
    // 没有列表可写：只记日志（页面顶部会显示 0 篇）
  });
})();

/* ---------------- 课程包导入（Step 4 接入原生桥） ---------------- */

/** 原生导入完成后的回调（MainActivity.importCourseFrom 注入） */
window.__saOnCourseImport = function (res) {
  try {
    if (res && res.ok) {
      var msg = (res.replaced ? '已更新《' : '已导入《') + res.id + '》' + (res.pages || 0) + ' 页';
      if (window.saToast) window.saToast(msg);
      else console.log(msg);
      // 课程库渲染在 Step 5 完成；这里先刷新页面让新课程生效
      setTimeout(function () { location.reload(); }, 600);
    } else {
      var bad = '导入失败：' + ((res && res.message) || '未知错误');
      if (window.saToast) window.saToast(bad);
      else console.log(bad);
    }
  } catch (e) { console.error('[import] 回调出错', e); }
};

/** 有原生桥才显示导入按钮（浏览器调试时不显示） */
function wireCourseImport() {
  var btn = document.getElementById('importCourse');
  if (!btn) return;
  if (!window.AndroidSA || typeof window.AndroidSA.importCourse !== 'function') return;
  btn.hidden = false;
  btn.addEventListener('click', function () {
    try { window.AndroidSA.importCourse(); }
    catch (e) { console.error('[import] 调起失败', e); }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireCourseImport);
} else {
  wireCourseImport();
}
