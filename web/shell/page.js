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
  /**
   * 内容页自带 <aside id="sidebar">（v1.x 旧内容）时直接沿用；
   * v2.0.0 之后的内容页只有正文，没有侧栏 → 这里按 h2/h3 现生成一个，
   * 否则点 ☰ 只会让遮罩变深、抽屉永远出不来（真机 bug，2026-11 修复）。
   */
  function buildDrawer() {
    // 按 h2 分章、h3 归到所属章下；没有 h2 时退化成一个大组
    var heads = Array.prototype.slice.call(
      document.querySelectorAll('main h2[id], main h3[id]')
    );
    if (!heads.length) {
      heads = Array.prototype.slice.call(document.querySelectorAll('h2[id], h3[id]'));
    }

    var groups = [];
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var title = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (h.tagName === 'H2') {
        groups.push({ id: h.id, title: title, items: [] });
      } else {
        if (!groups.length) groups.push({ id: '', title: '本页', items: [] });
        groups[groups.length - 1].items.push({ id: h.id, title: title });
      }
    }

    var aside = document.createElement('aside');
    aside.id = 'sidebar';

    var head = document.createElement('div');
    head.className = 'sa-drawer-head';
    var label = document.createElement('span');
    label.className = 'sa-drawer-title';
    label.textContent = '目录 · ' + groups.length + ' 章 / ' + heads.length + ' 节';
    var home = document.createElement('a');
    home.className = 'sa-drawer-home';
    home.href = '/';
    home.textContent = '课程列表';
    head.appendChild(label);
    head.appendChild(home);
    aside.appendChild(head);

    /* 目录行结构（与「目录」大页一致）：
         章：[左 75% 跳转][右 25% 展开/收起]   节：整行跳转、无展开按钮
       点任何位置都**不关闭抽屉**，只做平滑滚动 + 该行 200ms 高亮闪烁。 */
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      var row = document.createElement('div');
      row.className = 'sa-toc-row';
      if (grp.id) row.dataset.hid = grp.id;

      var mainBtn = document.createElement('button');
      mainBtn.type = 'button';
      mainBtn.className = 'sa-toc-main';
      mainBtn.textContent = grp.title;
      if (grp.id) mainBtn.dataset.target = grp.id;
      else mainBtn.disabled = true;               // 没有 id 的“本页”伪章不可跳
      row.appendChild(mainBtn);

      var kids = null;
      if (grp.items.length) {
        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'sa-toc-more';
        more.setAttribute('aria-expanded', 'false');
        more.setAttribute('aria-label', '展开或收起本章');
        more.textContent = '›';
        more.dataset.toggle = String(g);
        row.appendChild(more);

        kids = document.createElement('ul');
        kids.className = 'toc';
        kids.dataset.kids = String(g);
        for (var k = 0; k < grp.items.length; k++) {
          var li = document.createElement('li');
          li.className = 'lv3';
          var leaf = document.createElement('button');
          leaf.type = 'button';
          leaf.className = 'sa-toc-leaf';
          leaf.textContent = grp.items[k].title;
          leaf.dataset.target = grp.items[k].id;
          li.appendChild(leaf);
          kids.appendChild(li);
        }
      }

      aside.appendChild(row);
      if (kids) aside.appendChild(kids);
    }

    body.insertBefore(aside, body.firstChild);
    return aside;
  }

  /** 打开抽屉时把"当前所在章"展开并滚到可见位置 */
  function focusCurrentChapter(box) {
    if (!box) return;
    var hs = Array.prototype.slice.call(document.querySelectorAll('main h2[id], h2[id]'));
    if (!hs.length) return;
    var top = (window.pageYOffset || 0) + 80;
    var curId = hs[0].id;
    for (var i = 0; i < hs.length; i++) {
      var el = hs[i];
      var y = el.getBoundingClientRect().top + (window.pageYOffset || 0);
      if (y <= top) curId = el.id;
    }
    var row = box.querySelector('.sa-toc-row[data-hid="' + curId + '"]');
    if (!row) return;
    row.classList.add('cur');
    // 自动展开当前章，方便直接看到所在小节
    var idx = row.querySelector('.sa-toc-more');
    if (idx) expandGroup(row, true);
    if (row.offsetTop > box.clientHeight * 0.6) {
      box.scrollTop = Math.max(0, row.offsetTop - 60);
    }
  }

  var sidebar = document.getElementById('sidebar');
  if (!sidebar) sidebar = buildDrawer();
  var navPushed = false;

  function openNav() {
    body.classList.add('sa-nav-open');
    // 借用 history：让物理返回键先关抽屉，而不是退出 App
    if (!navPushed) {
      try { history.pushState({ saNav: 1 }, ''); navPushed = true; } catch (e) { /* ignore */ }
    }
    focusCurrentChapter(sidebar);
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
      var t = e.target;
      if (!t || !t.closest) return;

      // 右 25%：展开 / 收起
      var more = t.closest('.sa-toc-more');
      if (more) {
        e.preventDefault();
        var row = more.closest('.sa-toc-row');
        if (row) expandGroup(row, !row.classList.contains('open'));
        return;
      }

      // 其余位置：跳转（章/节都算），不弹确认、不关抽屉
      var target = t.closest('[data-target]');
      if (target && target.dataset.target) {
        e.preventDefault();
        var el = document.getElementById(target.dataset.target);
        if (!el) return;
        var row2 = target.closest('.sa-toc-row');
        if (row2) expandGroup(row2, true);
        smoothTo(el);
        flash(target.closest('.sa-toc-row') || target);
      }
    });
  }

  /** 展开/收起某一章（只切 class，不用 <details>） */
  function expandGroup(row, on) {
    var more = row.querySelector('.sa-toc-more');
    var kids = row.nextElementSibling;
    row.classList.toggle('open', !!on);
    if (more) more.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (kids && kids.classList && kids.classList.contains('toc')) {
      kids.classList.toggle('open', !!on);
    }
  }

  /** 平滑滚动到元素：420ms、easeInOutCubic（缓启动→加速→减速） */
  function smoothTo(el) {
    var barH = 0;
    var cs = getComputedStyle(document.documentElement);
    var v = cs.getPropertyValue('--sa-bar-h');
    if (v) barH = parseFloat(v) || 0;
    var top = el.getBoundingClientRect().top + (window.pageYOffset || 0) - barH - 12;
    if (top < 0) top = 0;
    var startY = window.pageYOffset || 0;
    var dist = top - startY;
    if (Math.abs(dist) < 2) return;
    var ms = 420;
    var t0 = performance.now();
    var ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
    function step(now) {
      var k = Math.min(1, (now - t0) / ms);
      window.scrollTo(0, startY + dist * ease(k));
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /** 200ms 高亮闪烁：跳转后给用户"确实动了"的反馈 */
  function flash(node) {
    if (!node || !node.classList) return;
    node.classList.remove('sa-toc-flash');
    // 强制回流，保证连点同一条也能重放动画
    void node.offsetWidth;
    node.classList.add('sa-toc-flash');
    setTimeout(function () { node.classList.remove('sa-toc-flash'); }, 260);
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

  function revealAnswer(bar) {
    var block = bar.saAnsEl;
    if (!block) return;
    block.hidden = false;
    var prev = block.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains('sa-ans-toggle')) {
      prev.textContent = '收起解析';
      prev.setAttribute('aria-expanded', 'true');
    }
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
      revealAnswer(bar);
    } catch (e) {
      console.warn('[page] 记录失败', e);
      var el = bar.querySelector('.sa-qbar-state');
      if (el) el.textContent = '记录失败';
    } finally {
      bar.dataset.busy = '0';
      for (var j = 0; j < btns.length; j++) btns[j].disabled = false;
    }
  }

  // 解析默认折叠，点按钮才显示；自评后自动展开
  function setupAnswerReveal() {
    var blocks = document.querySelectorAll('blockquote');
    for (var i = 0; i < blocks.length; i++) {
      var bq = blocks[i];
      if (bq.dataset.saAns === '1') continue;
      var head = (bq.textContent || '').replace(/^\s+/, '').slice(0, 2);
      if (head !== '解析') continue;           // 只折叠「解析」，易错点等其他引用块保持可见
      bq.dataset.saAns = '1';
      bq.classList.add('sa-ans');
      bq.hidden = true;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sa-ans-toggle';
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = '查看解析';
      (function (block, button) {
        button.addEventListener('click', function () {
          var opening = block.hidden;
          block.hidden = !opening;
          button.textContent = opening ? '收起解析' : '查看解析';
          button.setAttribute('aria-expanded', opening ? 'true' : 'false');
        });
      })(bq, btn);
      if (bq.parentNode) bq.parentNode.insertBefore(btn, bq);
    }
  }

  // 给某道题找它自己的解析块（在题目范围里）
  function answerBlockOf(heading) {
    var el = heading.nextElementSibling;
    while (el && !/^H[123]$/.test(el.tagName)) {
      if (el.tagName === 'BLOCKQUOTE' && el.classList.contains('sa-ans')) return el;
      el = el.nextElementSibling;
    }
    return null;
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
      bar.saAnsEl = answerBlockOf(h);          // 自评后自动展开解析
      if (last.parentNode) last.parentNode.insertBefore(bar, last.nextSibling);
    }
  }

  setupAnswerReveal();

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
