/* ============================================================
   Lucubratio · 首页逻辑
   目录渲染 / 继续学习 / 数据统计 / 备份导出导入
   ============================================================ */
import {
  init, getLastRead, stats, dueCount, exportSnapshot, importSnapshot, info,
  reconcileContent, orphanCount, rearmOrphans,
} from './store.js';
import { initTheme, getTheme, setTheme, getFont, setFont, THEME_LABEL, FONT_LABEL } from './theme.js';

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

  /* ---------------- 目录 ---------------- */
  function renderList(manifest) {
    var list = $('list');
    var total = 0;
    var html = '';

    manifest.groups.forEach(function (g) {
      g.items.forEach(function (it) {
        total++;
        var cls = 'item' + (it.kind === 'paper' ? ' paper' : (it.kind === 'memo' ? ' memo' : ''));
        var meta = (it.kicker ? it.kicker + ' · ' : '') +
                   (it.sections ? it.sections + ' 节 · ' : '') +
                   (it.questions ? it.questions + ' 题 · ' : '') +
                   Math.round((it.bytes || 0) / 1024) + ' KB';
        html += '<a class="' + cls + '" href="' + encodeURI(it.file) + '">' +
                  '<span class="no">' + escapeHtml(it.no || '·') + '</span>' +
                  '<span class="body"><span class="t">' + escapeHtml(it.title) + '</span>' +
                  '<span class="m">' + escapeHtml(meta) + '</span></span>' +
                  '<span class="go">›</span>' +
                '</a>';
      });
    });

    list.innerHTML = html || '<div class="empty">没有内容</div>';
    $('sub').innerHTML = '离线学习 · <b>' + total + '</b> 篇';
    $('sec-count').textContent = total + ' 篇';
  }

  /* ---------------- 继续学习 ---------------- */
  async function renderContinue() {
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
  async function renderStats() {
    var s = await stats();
    $('st-progress').textContent = s.progress + ' 篇';
    $('st-attempts').textContent = s.attempts + ' 条';
    $('st-cards').textContent = s.cards + ' 张';
    var k = info().kind;
    $('st-kind').textContent = k === 'idb' ? 'IndexedDB' : '降级模式';
    $('st-hint').textContent = k === 'idb' ? '' : '存储不可用';
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

    var manifest = null;
    try {
      manifest = await (await fetch('/manifest.json')).json();
    } catch (e) {
      $('list').innerHTML = '<div class="empty">manifest 加载失败：' + escapeHtml(e && e.message) + '</div>';
    }

    if (manifest) {
      renderList(manifest);
      $('ver').textContent = 'v' + manifest.appVersion;
    }

    await init({
      appVersion: manifest ? manifest.appVersion : '',
      contentVersion: manifest ? manifest.contentHash : '',
    });

    // 讲义更新后对账：把指向已变标题的旧卡片标为"待复核"，不直接丢弃
    try {
      if (manifest && manifest.contentHash) await reconcileContent(manifest.contentHash);
    } catch (e) {
      console.warn('[home] 内容版本对账失败', e);
    }

    await renderContinue();
    await renderDue();
    await renderOrphan();
    await renderStats();

    $('btn-export').addEventListener('click', doExport);
    $('btn-import').addEventListener('click', doImport);

    // 首屏数据都好了 → 通知开屏可以退场（splash 自己保证至少停 500ms）
    if (window.__saSplashDone) window.__saSplashDone();
  }

  boot().catch(function (e) {
    console.error('[home] 启动失败', e);
    if (window.__saSplashDone) window.__saSplashDone(e);
    $('list').innerHTML = '<div class="empty">启动失败：' + escapeHtml(e && e.message) + '</div>';
  });
})();
