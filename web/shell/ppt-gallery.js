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
    var im = document.querySelector('img[src*="/img/"]');
    if (im) {
      var m = im.getAttribute('src').match(/^(.*?)\/img\//);
      if (m) return m[1];
    }
    return '';
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
    if (!unregViewer && window.saOnBack) unregViewer = window.saOnBack(function () { closePager(); });
    // 把当前页对应的缩略图滚进视野，关掉全屏后能接着翻
    var el = grid && grid.children[i];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function closePager() {
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    body.classList.remove('sa-pttg-view');
    if (unregViewer) { unregViewer(); unregViewer = null; }
  }

  /* ---------------- 顶栏按钮 + 正文图注角标 ---------------- */
  function addButton() {
    var bar = document.querySelector('.sa-topbar');
    if (!bar) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sa-icon sa-pptbtn';
    btn.setAttribute('aria-label', 'PPT 原版截图');
    btn.title = 'PPT 原版截图';
    btn.textContent = '▤';
    btn.addEventListener('click', function () { openPanel(0); });
    var top = bar.querySelector('.sa-bar-progress');
    bar.insertBefore(btn, top || null);
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
        var cap = fig.querySelector('figcaption');
        (cap || fig).appendChild(chip);
      })(figs[i]);
    }
  }

  function boot() {
    loadIndex().then(function (idx) {
      if (!idx || !idx.decks || !idx.decks.length) return;   // 没索引（公开 demo）→ 不加载 UI
      addButton();
      addChips();
    });
  }

  if (document.readyState === 'complete') setTimeout(boot, 0);
  else window.addEventListener('load', boot);
})();
