/* PPT 侧栏：按页序浏览本讲全部原版截图
   ------------------------------------------------------------
   为什么需要它：正文只对部分页插了图，读到"课件描述了某页"却看不到那一页时，
   以前只能凭文字想象。这里把整本 PPT 的截图按页序排好，随时点开、翻页、跳页。

   数据来源：构建期生成的 /img/index.json（build.mjs 产出，见「PPT 页索引」段）
     { decks: [ { deck, lecture, title, pages: [ { n, w, h, f } ] } ] }

   关键实现点：
   - 图片基址从页面里现有的 <img src="…/img/…"> 反推：assets 下是 /img/…，
     课程包内是 /courses/<id>/img/…，两种都能用，不写死路径。
   - 返回键：面板与全屏翻页都注册到 boot.js 的 saOnBack 栈（原生返回键先关它们）。
   - 不引任何依赖；不内联脚本（课程包禁止内联）；不新开页面。
*/
(function () {
  'use strict';

  var body = document.body;
  if (!body || !body.hasAttribute('data-cid')) return;   // 只在阅读页启用

  /* ---------------- 基址与索引 ---------------- */
  function imgBase() {
    // 1) 页面里有截图 → 从它的 src 反推（assets: /img/…；课程包: /courses/<id>/img/…）
    var im = document.querySelector('img[src*="/img/"]');
    if (im) {
      var m = im.getAttribute('src').match(/^(.*?)\/img\//);
      if (m) return m[1];
    }
    // 2) 没有图的页面（如期中串讲）→ 从 body[data-file] 推：
    //    内置页 /content/os/x.html → ''；课程包 /courses/<id>/content/os/x.html → '/courses/<id>'
    var file = body.getAttribute('data-file') || '';
    var mm = file.match(/^(.*?)\/content\//);
    return mm ? mm[1] : '';
  }
  var BASE = imgBase();
  var indexPromise = null;

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(BASE + '/img/index.json', { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return indexPromise;
  }

  function lectureOf() {
    var cid = body.getAttribute('data-cid') || '';
    var m = cid.match(/-(\d+)$/);
    return m ? m[1] : '';
  }

  function currentDeck(idx) {
    if (!idx || !idx.decks || !idx.decks.length) return null;
    var lec = lectureOf();
    for (var i = 0; i < idx.decks.length; i++) {
      if (String(idx.decks[i].lecture) === lec) return idx.decks[i];
    }
    return idx.decks[0];
  }

  function pageUrl(deck, page) { return BASE + '/img/' + deck.deck + '/' + page.f; }

  /* ---------------- 面板 ---------------- */
  var panel = null, grid = null, titleEl = null, unregPanel = null, built = false;

  function build() {
    if (built) return;
    built = true;

    panel = document.createElement('div');
    panel.className = 'sa-pttg';
    panel.hidden = true;

    var head = document.createElement('div');
    head.className = 'sa-pttg-head';

    titleEl = document.createElement('div');
    titleEl.className = 'sa-pttg-title';

    var jump = document.createElement('input');
    jump.className = 'sa-pttg-jump';
    jump.type = 'number';
    jump.min = '1';
    jump.inputMode = 'numeric';
    jump.placeholder = '跳页';
    jump.setAttribute('aria-label', '跳到第几页');
    jump.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var n = parseInt(jump.value, 10);
      if (n > 0) openPager(n - 1);
    });

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'sa-pttg-x';
    close.setAttribute('aria-label', '关闭');
    close.textContent = '✕';
    close.addEventListener('click', function () { closePanel(); });

    head.appendChild(titleEl);
    head.appendChild(jump);
    head.appendChild(close);

    grid = document.createElement('div');
    grid.className = 'sa-pttg-grid';

    panel.appendChild(head);
    panel.appendChild(grid);

    var scrim = document.createElement('div');
    scrim.className = 'sa-pttg-scrim';
    scrim.addEventListener('click', function () { closePanel(); });

    body.appendChild(scrim);
    body.appendChild(panel);
    panel._scrim = scrim;
  }

  var curDeck = null;

  function openPanel(startPage) {
    build();
    loadIndex().then(function (idx) {
      var deck = currentDeck(idx);
      if (!deck) {
        titleEl.textContent = '没有 PPT 索引（先构建）';
        return;
      }
      curDeck = deck;
      titleEl.textContent = '本讲 PPT · 共 ' + deck.pages.length + ' 页';
      renderGrid(deck);
      panel.hidden = false;
      panel._scrim.hidden = false;
      setBallHidden(true);
      body.classList.add('sa-pttg-open');
      if (!unregPanel && window.saOnBack) unregPanel = window.saOnBack(function () { closePanel(); });
      if (startPage) openPager(startPage - 1);
      panel.querySelector('.sa-pttg-grid').scrollTop = 0;
    });
  }

  function renderGrid(deck) {
    grid.innerHTML = '';
    var frag = document.createDocumentFragment();
    deck.pages.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sa-pttg-item';
      b.setAttribute('aria-label', '第 ' + p.n + ' 页');
      var im = document.createElement('img');
      im.loading = 'lazy';
      im.decoding = 'async';
      im.src = pageUrl(deck, p);
      im.alt = '';
      var tag = document.createElement('span');
      tag.className = 'sa-pttg-n';
      tag.textContent = String(p.n);
      b.appendChild(im);
      b.appendChild(tag);
      b.addEventListener('click', function () { openPager(i); });
      frag.appendChild(b);
    });
    grid.appendChild(frag);
  }

  function closePanel() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if (panel._scrim) panel._scrim.hidden = true;
    setBallHidden(false);
    body.classList.remove('sa-pttg-open');
    if (unregPanel) { unregPanel(); unregPanel = null; }
    closePager();
  }

  /* ---------------- 全屏翻页 ---------------- */
  var viewer = null, vImg = null, vCounter = null, vIndex = 0, unregViewer = null;

  function buildViewer() {
    if (viewer) return;
    viewer = document.createElement('div');
    viewer.className = 'sa-pttg-viewer';
    viewer.hidden = true;

    var top = document.createElement('div');
    top.className = 'sa-pttg-vtop';
    vCounter = document.createElement('span');
    vCounter.className = 'sa-pttg-vcount';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'sa-pttg-x';
    close.setAttribute('aria-label', '关闭');
    close.textContent = '✕';
    close.addEventListener('click', function () { closePager(); });
    top.appendChild(vCounter);
    top.appendChild(close);

    var stage = document.createElement('div');
    stage.className = 'sa-pttg-stage';
    vImg = document.createElement('img');
    vImg.alt = '';
    stage.appendChild(vImg);

    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'sa-pttg-nav sa-pttg-prev';
    prev.setAttribute('aria-label', '上一页');
    prev.textContent = '‹';
    prev.addEventListener('click', function () { step(-1); });

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'sa-pttg-nav sa-pttg-next';
    next.setAttribute('aria-label', '下一页');
    next.textContent = '›';
    next.addEventListener('click', function () { step(1); });

    viewer.appendChild(top);
    viewer.appendChild(stage);
    viewer.appendChild(prev);
    viewer.appendChild(next);

    // 左右滑动翻页
    var x0 = null;
    stage.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
    stage.addEventListener('pointerup', function (e) {
      if (x0 === null) return;
      var dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) step(dx > 0 ? -1 : 1);
    });

    body.appendChild(viewer);
  }

  function step(d) {
    if (!curDeck) return;
    var i = vIndex + d;
    if (i < 0 || i >= curDeck.pages.length) return;
    showPage(i);
  }

  function showPage(i) {
    if (!curDeck || i < 0 || i >= curDeck.pages.length) return;
    vIndex = i;
    var p = curDeck.pages[i];
    vImg.src = pageUrl(curDeck, p);
    vCounter.textContent = p.n + ' / ' + curDeck.pages.length;
    var items = grid ? grid.children : [];
    for (var k = 0; k < items.length; k++) items[k].classList.toggle('is-current', k === i);
  }

  function openPager(i) {
    buildViewer();
    showPage(i);
    viewer.hidden = false;
    body.classList.add('sa-pttg-view');
    setBallHidden(true);
    if (!unregViewer && window.saOnBack) unregViewer = window.saOnBack(function () { closePager(); });
    // 把当前页对应的缩略图滚进视野，关掉全屏后能接着翻
    var el = grid && grid.children[i];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function closePager() {
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    body.classList.remove('sa-pttg-view');
    setBallHidden(false);
    if (unregViewer) { unregViewer(); unregViewer = null; }
  }

  /* ---------------- 悬浮球入口（可拖动，位置记忆） + 正文图注角标 ---------------- */

  /**
   * 为什么是悬浮球而不是顶栏按钮：
   *   1) 期中串讲/速记卡/模拟卷这些"纯文字页"以前根本不加载本脚本 → 没有入口；
   *      现在所有内容页都加载，但顶栏在窄屏上已经很挤（☰ / 标题 / ↑），再加一个图标会挤掉标题；
   *   2) 悬浮球可以在任意页出现、用户自己拖到顺手的位置，不占顶栏。
   * 层级：z-index 840 —— 抽屉(880/900)、顶栏(950)、图片放大(1200)、侧栏(1570)、幕布(1900)
   *       都比它高，所以"该被盖住"的场景不需要额外监听。
   */
  var ballEl = null;
  var POS_KEY = 'sa:pptball';

  function readPos() {
    try {
      var raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (typeof o.xPct === 'number' && typeof o.yPct === 'number') return o;
    } catch (e) { /* 忽略 */ }
    return null;
  }

  function savePos(xPct, yPct) {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ xPct: xPct, yPct: yPct })); } catch (e) { /* 忽略 */ }
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /** 把球放到 (left, top) —— 像素坐标，内部会 clamp 到安全区 */
  function placeBall(left, top) {
    if (!ballEl) return;
    var size = ballEl.offsetWidth || 48;
    var vw = window.innerWidth, vh = window.innerHeight;
    var topLimit = 52 + 8;                                    // 顶栏高度 + 间距
    var botLimit = vh - size - 8;
    var l = clamp(left, 8, vw - size - 8);
    var t = clamp(top, topLimit, Math.max(topLimit, botLimit));
    ballEl.style.left = Math.round(l) + 'px';
    ballEl.style.top = Math.round(t) + 'px';
    ballEl.style.right = 'auto';
    ballEl.style.bottom = 'auto';
  }

  function snapToEdge() {
    if (!ballEl) return;
    var size = ballEl.offsetWidth || 48;
    var vw = window.innerWidth;
    var rect = ballEl.getBoundingClientRect();
    var left = rect.left, top = rect.top;
    var centerX = left + size / 2;
    var goLeft = centerX < vw / 2;
    var targetLeft = goLeft ? 8 : vw - size - 8;
    ballEl.style.transition = 'left .12s ease, top .12s ease';
    placeBall(targetLeft, top);
    setTimeout(function () { if (ballEl) ballEl.style.transition = ''; }, 160);
    savePos((targetLeft + size / 2) / vw, (top + size / 2) / window.innerHeight);
  }

  function mountBall() {
    if (ballEl) return;
    ballEl = document.createElement('button');
    ballEl.type = 'button';
    ballEl.className = 'sa-pptball';
    ballEl.setAttribute('aria-label', 'PPT 原版截图：点开看整本，拖动可移动');
    ballEl.setAttribute('data-sa-pptball', '1');

    var glyph = document.createElement('span');
    glyph.className = 'sa-pptball-g';
    glyph.textContent = '▤';
    var label = document.createElement('span');
    label.className = 'sa-pptball-t';
    label.textContent = 'PPT';
    ballEl.appendChild(glyph);
    ballEl.appendChild(label);

    body.appendChild(ballEl);

    // 初始位置：记忆值优先；否则右侧 62% 高度
    var size = 48;
    var pos = readPos();
    if (pos) {
      placeBall(pos.xPct * window.innerWidth - size / 2, pos.yPct * window.innerHeight - size / 2);
    } else {
      placeBall(window.innerWidth - size - 8, window.innerHeight * 0.62);
    }

    /* ---- 拖动 / 点击 ---- */
    var dragging = false, moved = false;
    var startX = 0, startY = 0, startLeft = 0, startTop = 0, startAt = 0;

    ballEl.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY; startAt = Date.now();
      var r = ballEl.getBoundingClientRect();
      startLeft = r.left; startTop = r.top;
      ballEl.classList.add('is-drag');
      try { ballEl.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });

    ballEl.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (!moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) moved = true;   // 8px 阈值：区分点击与拖动
      if (!moved) return;
      placeBall(startLeft + dx, startTop + dy);
    });

    var handledAt = 0;   // 指针路径已处理点击的时间戳（避免与 click 事件重复打开）

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      ballEl.classList.remove('is-drag');
      try { ballEl.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      if (!moved && Date.now() - startAt < 300) {
        handledAt = Date.now();
        openPanel(0);            // 视为点击
      } else if (moved) {
        snapToEdge();            // 松手吸附到最近的左/右边缘
      }
    }
    ballEl.addEventListener('pointerup', endDrag);

    // 键盘 Enter/空格，以及脚本触发的 .click()（check-pages 就靠它）：
    // 不走指针路径，直接开面板；若刚被指针路径处理过则跳过，避免重复打开。
    ballEl.addEventListener('click', function () {
      if (Date.now() - handledAt < 600) return;
      openPanel(0);
    });
    ballEl.addEventListener('pointercancel', function (e) {
      if (!dragging) return;
      dragging = false;
      ballEl.classList.remove('is-drag');
      snapToEdge();
    });

    // 旋屏 / 窗口变化：按记忆位置重新 clamp，别让球跑到屏幕外
    window.addEventListener('resize', function () {
      if (!ballEl) return;
      var p = readPos();
      var r = ballEl.getBoundingClientRect();
      if (p) placeBall(p.xPct * window.innerWidth - 24, p.yPct * window.innerHeight - 24);
      else placeBall(r.left, r.top);
    });

    // 首次出现时轻呼吸两下（记住"已经提示过"）
    try {
      if (!localStorage.getItem('sa:pptball:hinted')) {
        ballEl.classList.add('sa-pptball-hint');
        localStorage.setItem('sa:pptball:hinted', '1');
        setTimeout(function () { if (ballEl) ballEl.classList.remove('sa-pptball-hint'); }, 3200);
      }
    } catch (e) { /* 忽略 */ }

    // 供 check-pages 断言
    window.__saPptReady = window.__saPptReady || {};
    window.__saPptReady.ball = true;
  }

  /** 面板/全屏打开时把球藏起来（它们层级更高，这里只是防误触） */
  function setBallHidden(hide) {
    if (ballEl) ballEl.hidden = !!hide;
  }

  function addChips() {
    // 两种图注结构都加角标：slide-fig（现行写法）与 sa-ppt（旧式，构建期展开）
    var figs = document.querySelectorAll('figure.slide-fig, figure.sa-ppt');
    for (var i = 0; i < figs.length; i++) {
      (function (fig) {
        if (fig.dataset.saPptChip) return;
        fig.dataset.saPptChip = '1';
        var im = fig.querySelector('img[src*="/img/"]');
        if (!im) return;
        var m = im.getAttribute('src').match(/\/p(\d+)\.webp/);
        if (!m) return;
        var n = Number(m[1]);
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'sa-ppt-chip';
        chip.textContent = 'p' + n + ' · 查看整本';
        chip.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          openPanel(n);
        });
        // 角标挂在 figure 上（不塞进 figcaption）：否则放大层的标题会把「p3 · 查看整本」一起带进去
        fig.appendChild(chip);
      })(figs[i]);
    }
  }

  function boot() {
    loadIndex().then(function (idx) {
      window.__saPptReady = { index: !!(idx && idx.decks && idx.decks.length), ball: false };
      if (!idx || !idx.decks || !idx.decks.length) return;   // 没索引（公开 demo / 无图课程）→ 不加载 UI
      mountBall();
      addChips();
    });
  }

  if (document.readyState === 'complete') setTimeout(boot, 0);
  else window.addEventListener('load', boot);
})();
