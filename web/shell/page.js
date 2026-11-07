/* ============================================================
   Lucubratio · 内容页运行时壳层
   注入到每个内容页，负责：顶栏 / 抽屉目录 / 阅读进度 / 断点续读 / 宽块横滑提示
   数据来自 /shell/store.js（IndexedDB，降级 localStorage）
   目标基线：Chrome 110（模拟器 WebView）
   ============================================================ */
import { init as initStore, loadProgress, saveProgress, getCardsByCid, assess } from './store.js';
import { fmtDue } from './time.js';

(function () {
  'use strict';

  var body = document.body;
  if (!body || body.dataset.saReady === '1') return;
  body.dataset.saReady = '1';

  var cid = body.dataset.cid || '';
  var file = body.dataset.file || location.pathname;
  var cver = body.dataset.cver || '';
  var appver = body.dataset.appver || '';

  // 页面级共享的数据层初始化：boot 与自评条共用同一个 Promise，避免重复 init / 重复写 meta
  var storeReady = initStore({ appVersion: appver, contentVersion: cver });

  /* ---------------- 顶栏 ---------------- */
  var bar = document.createElement('div');
  bar.className = 'sa-topbar';

  var btnMenu = document.createElement('button');
  btnMenu.className = 'sa-icon';
  btnMenu.type = 'button';
  btnMenu.setAttribute('aria-label', '目录');
  btnMenu.textContent = '☰';

  var titles = document.createElement('div');
  titles.className = 'sa-titles';

  var t1 = document.createElement('div');
  t1.className = 'sa-t1';

  var t2 = document.createElement('div');
  t2.className = 'sa-t2';

  titles.appendChild(t1);
  titles.appendChild(t2);

  var btnTop = document.createElement('button');
  btnTop.className = 'sa-icon';
  btnTop.type = 'button';
  btnTop.setAttribute('aria-label', '回到顶部');
  btnTop.textContent = '↑';

  var prog = document.createElement('div');
  prog.className = 'sa-bar-progress';
  var progFill = document.createElement('i');
  prog.appendChild(progFill);

  bar.appendChild(btnMenu);
  bar.appendChild(titles);
  bar.appendChild(btnTop);
  bar.appendChild(prog);

  var scrim = document.createElement('div');
  scrim.className = 'sa-scrim';

  body.insertBefore(bar, body.firstChild);
  body.insertBefore(scrim, body.firstChild);

  /* ---------------- 标题 ---------------- */
  var h1 = document.querySelector('main h1') || document.querySelector('h1');
  var kicker = document.querySelector('.kicker');
  var docTitle = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : (document.title || '');
  t1.textContent = docTitle;
  t2.textContent = kicker ? kicker.textContent.trim() : '';

  /* ---------------- 抽屉 ---------------- */
  var sidebar = document.getElementById('sidebar');
  var navPushed = false;

  function openNav() {
    body.classList.add('sa-nav-open');
    // 借用 history：让物理返回键先关抽屉，而不是退出 App
    if (!navPushed) {
      try { history.pushState({ saNav: 1 }, ''); navPushed = true; } catch (e) { /* ignore */ }
    }
    if (sidebar) {
      var cur = sidebar.querySelector('details.cur') || sidebar.querySelector('details[open]');
      if (cur && cur.offsetTop) {
        sidebar.scrollTop = Math.max(0, cur.offsetTop - 12);
      }
    }
  }

  function closeNav(viaHistory) {
    var wasOpen = body.classList.contains('sa-nav-open');
    body.classList.remove('sa-nav-open');
    if (!wasOpen) return;
    if (navPushed) {
      navPushed = false;
      if (!viaHistory) {
        try { history.back(); } catch (e) { /* ignore */ }
      }
    }
  }

  function toggleNav() {
    if (body.classList.contains('sa-nav-open')) closeNav(false);
    else openNav();
  }

  window.addEventListener('popstate', function () {
    if (body.classList.contains('sa-nav-open')) {
      navPushed = false;
      body.classList.remove('sa-nav-open');
    }
  });

  btnMenu.addEventListener('click', function (e) {
    e.preventDefault();
    toggleNav();
  });
  scrim.addEventListener('click', function () { closeNav(false); });

  if (sidebar) {
    sidebar.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      navPushed = false;
      body.classList.remove('sa-nav-open');
    });
  }

  btnTop.addEventListener('click', function () { scrollToInstant(0); });

  /* ---------------- 瞬时滚动（绕开页面自带的 scroll-behavior:smooth） ---------------- */
  function scrollToInstant(y) {
    var de = document.documentElement;
    var prev = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    de.style.scrollBehavior = prev;
  }

  /* ---------------- 阅读进度 ---------------- */
  var ticking = false;

  function updateProgress() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var top = window.pageYOffset || doc.scrollTop || 0;
    var pct = max > 4 ? Math.min(100, Math.max(0, (top / max) * 100)) : 0;
    progFill.style.width = pct.toFixed(1) + '%';
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateProgress);
  }, { passive: true });

  /* ---------------- 断点续读 ----------------
     关键：恢复期间（restoring=true）绝不写盘，
     否则页面刚打开时 scrollY=0 会把上次的断点覆盖成 0。 */
  var restoring = true;
  var lastSavedY = -1;
  var saveTimer = null;

  function savePosition(force) {
    if (restoring) return;
    var doc = document.documentElement;
    var top = window.pageYOffset || doc.scrollTop || 0;
    if (!force && lastSavedY >= 0 && Math.abs(top - lastSavedY) < 40) return;
    lastSavedY = top;

    var max = doc.scrollHeight - window.innerHeight;
    var pct = max > 4 ? Math.round((top / max) * 100) : 0;
    var ratio = doc.scrollHeight > 0 ? top / doc.scrollHeight : 0;

    saveProgress({
      cid: cid,
      file: file,
      title: docTitle,
      scrollTop: top,
      pct: pct,
      ratio: ratio,
    }).catch(function (e) { console.warn('[page] 保存进度失败', e); });
  }

  window.addEventListener('scroll', function () {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      savePosition(false);
    }, 900);
  }, { passive: true });

  window.addEventListener('pagehide', function () { savePosition(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') savePosition(true);
  });

  function finishRestore() {
    if (!restoring) return;
    restoring = false;
    updateProgress();
    savePosition(true); // 记录"最近打开"，此时位置已正确
  }

  // 用户一旦交互，立即认为恢复结束（防止 IndexedDB 慢时卡在 restoring）
  ['touchstart', 'wheel', 'keydown'].forEach(function (evt) {
    window.addEventListener(evt, finishRestore, { passive: true, once: true });
  });

  async function boot() {
    await storeReady;
    var rec = await loadProgress(cid);
    var saved = rec ? (rec.scrollTop || 0) : 0;

    if (location.hash || saved <= 200) {
      finishRestore();
      return;
    }
    scrollToInstant(saved);
    requestAnimationFrame(function () { scrollToInstant(saved); });
    setTimeout(function () {
      scrollToInstant(saved);
      finishRestore();
    }, 260);
  }

  /* ---------------- 宽内容块：横滑提示 ---------------- */
  /* ---------------- 图表点击放大 ----------------
     宽图（最多 159 列）在手机上一屏放不下，默认按屏宽缩放看结构，
     点一下铺满全屏按原始尺寸显示，可双指缩放/拖动。 */
  function closeArtZoom() {
    var z = document.querySelector('.art-wrap[data-zoom]');
    if (z) z.removeAttribute('data-zoom');
    var hint = document.getElementById('sa-art-hint');
    if (hint) hint.remove();
    document.body.classList.remove('sa-art-zoom');
  }

  function openArtZoom(wrap) {
    closeArtZoom();
    wrap.setAttribute('data-zoom', '1');
    document.body.classList.add('sa-art-zoom');
    var hint = document.createElement('div');
    hint.id = 'sa-art-hint';
    hint.className = 'art-hint';
    hint.textContent = '双指可缩放 · 轻点关闭';
    document.body.appendChild(hint);
  }

  function setupArtZoom() {
    var wraps = document.querySelectorAll('.art-wrap');
    for (var i = 0; i < wraps.length; i++) {
      wraps[i].addEventListener('click', function (e) {
        if (document.body.classList.contains('sa-art-zoom')) { closeArtZoom(); return; }
        openArtZoom(this);
        e.stopPropagation();
      });
    }
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('sa-art-zoom')) return;
      if (e.target && e.target.closest && e.target.closest('[data-zoom]')) return;
      closeArtZoom();
    }, true);
  }

  function markWideBlocks() {
    var nodes = document.querySelectorAll('pre, table, .table-wrap');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.clientWidth > 120 && el.scrollWidth - el.clientWidth > 8) {
        el.classList.add('sa-wide');
        el.addEventListener('scroll', onWideScroll, { passive: true });
        onWideScroll({ currentTarget: el });
      }
    }
  }

  function onWideScroll(e) {
    var el = e.currentTarget;
    var atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 6;
    if (atEnd) el.classList.add('sa-at-end');
    else el.classList.remove('sa-at-end');
  }

  updateProgress();

  boot().catch(function (e) {
    console.warn('[page] 数据层初始化失败，按未读处理', e);
    finishRestore();
  });

  /* ---------------- 自评条（P4） ---------------- */
  var RATE_TEXT = { 1: '不会', 2: '模糊', 3: '会' };

  /** 页面级共享的数据层初始化（只跑一次，boot 与自评条共用） */

  function renderState(bar, card) {
    var el = bar.querySelector('.sa-qbar-state');
    if (!el) return;
    if (card) {
      bar.classList.add('sa-rated');
      el.textContent = '下次 ' + fmtDue(card.due) + ' · 已练 ' + (card.reps || 1) + ' 次';
    } else {
      bar.classList.remove('sa-rated');
      el.textContent = '';
    }
  }

  function buildBar(qid, anchor, text, card) {
    var bar = document.createElement('div');
    bar.className = 'sa-qbar';
    bar.setAttribute('data-qbar-for', qid);

    var label = document.createElement('span');
    label.className = 'sa-qbar-label';
    label.textContent = '这个点我会';
    bar.appendChild(label);

    [1, 2, 3].forEach(function (r) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sa-qbtn';
      btn.setAttribute('data-r', String(r));
      btn.textContent = RATE_TEXT[r];
      btn.addEventListener('click', function () {
        rate(bar, qid, anchor, text, r);
      });
      bar.appendChild(btn);
    });

    var state = document.createElement('span');
    state.className = 'sa-qbar-state';
    bar.appendChild(state);

    renderState(bar, card);
    return bar;
  }

  async function rate(bar, qid, anchor, text, rating) {
    if (bar.dataset.busy === '1') return;
    bar.dataset.busy = '1';
    var btns = bar.querySelectorAll('.sa-qbtn');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
    try {
      var card = await assess({
        qid: qid,
        cid: cid,
        file: file,
        anchor: anchor,
        text: text,
        rating: rating,
        source: 'page',
      });
      renderState(bar, card);
      var st = bar.querySelector('.sa-qbar-state');
      if (st) st.setAttribute('title', '再点一次可修改本次评分');
    } catch (e) {
      console.warn('[page] 记录失败', e);
      var el = bar.querySelector('.sa-qbar-state');
      if (el) el.textContent = '记录失败';
    } finally {
      bar.dataset.busy = '0';
      for (var j = 0; j < btns.length; j++) btns[j].disabled = false;
    }
  }

  async function setupQuestions() {
    var heads = document.querySelectorAll('[data-qid]');
    if (!heads.length) return;

    var cards = {};
    try {
      var list = await getCardsByCid(cid);
      for (var i = 0; i < list.length; i++) cards[list[i].qid] = list[i];
    } catch (e) { /* 存储不可用时仍然渲染按钮，只是点了没记录 */ }

    for (var j = 0; j < heads.length; j++) {
      var h = heads[j];
      var qid = h.getAttribute('data-qid');
      if (!qid) continue;
      var parts = qid.split('#');
      var anchor = parts.length > 1 ? parts[1] : '';

      // 题目块 = 标题 + 后续兄弟节点，直到下一个 h1/h2/h3
      var last = h;
      var el = h.nextElementSibling;
      while (el && !/^H[123]$/.test(el.tagName)) {
        last = el;
        el = el.nextElementSibling;
      }
      // 防止重复插入（例如热重载或二次调用）
      if (last.nextElementSibling && last.nextElementSibling.classList
          && last.nextElementSibling.classList.contains('sa-qbar')) continue;

      var bar = buildBar(qid, anchor, (h.textContent || '').replace(/\s+/g, ' ').trim(), cards[qid]);
      if (last.parentNode) last.parentNode.insertBefore(bar, last.nextSibling);
    }
  }

  storeReady
    .then(setupQuestions)
    .catch(function (e) { console.warn('[page] 自评条初始化失败', e); });

  function onReady() { markWideBlocks(); setupArtZoom(); }
  if (document.readyState === 'complete') {
    setTimeout(onReady, 0);
  } else {
    window.addEventListener('load', onReady);
  }
})();
