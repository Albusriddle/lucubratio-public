/* ============================================================
   Lucubratio · 图表全屏查看器
   正文里图表按原始尺寸渲染（超宽就横滑），点右下角 ⤢ 进全屏：
   −/＋（乘法步进）、适应屏幕、单指拖动、双指捏合，✕ 退出。

   历史坑（都已处理）：
   1. 尺寸不能只看 viewBox：优先用页面里的真实渲染尺寸，再退 viewBox，
      最后兜底 320×480；克隆后必须 inline !important 写死 px，否则会被样式表压成 0。
   2. 打开后要自检：内容盒子为 0 时自动降级成 <img src="data:...">，
      再不行给明确文案，绝不黑屏。
   3. 下限放到 1%，所以缩放按钮必须用乘法步进（加减 0.25 会从 25% 直接砸到 1%）。
   ============================================================ */
(function () {
  'use strict';

  var MIN = 0.01;   // 1%
  var MAX = 3.5;    // 350%
  var RATIO = 1.5;  // 每按一次放大/缩小 1.5 倍

  var overlay = null;
  // 返回键集成：打开查看器时压一条历史，返回键先关查看器（与抽屉同一套机制）
  var viewerPushed = false;
  var unregBack = null;   // 返回键桥的注销函数
  var stage = null;
  var content = null;
  var zoomLabel = null;
  var titleEl = null;

  var scale = 1;
  var initialCap = 1;      // 图片：正文内嵌宽度 / 原图宽度
  var tx = 0;
  var ty = 0;
  var naturalW = 0;
  var naturalH = 0;

  function fmt(s) {
    var p = s * 100;
    return (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10) + '%';
  }

  function apply() {
    content.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    if (zoomLabel) zoomLabel.textContent = fmt(scale);
  }

  function clampScale(s) {
    if (!isFinite(s) || s <= 0) s = 1;
    return Math.max(MIN, Math.min(MAX, s));
  }

  function center() {
    tx = (stage.clientWidth - naturalW * scale) / 2;
    ty = Math.max(0, (stage.clientHeight - naturalH * scale) / 2);
    if (naturalH * scale > stage.clientHeight) ty = 0; // 超高时从顶部开始
    apply();
  }

  function setScale(next, cx, cy) {
    var s2 = clampScale(next);
    if (cx == null) { cx = stage.clientWidth / 2; cy = stage.clientHeight / 2; }
    tx = cx - ((cx - tx) / scale) * s2;
    ty = cy - ((cy - ty) / scale) * s2;
    scale = s2;
    apply();
  }

  /** 适应屏幕：宽高都塞进可视区 */
  function containScale() {
    var aw = stage.clientWidth - 20;
    var ah = stage.clientHeight - 20;
    if (aw <= 0 || ah <= 0 || naturalW <= 0 || naturalH <= 0) return 1;
    return Math.min(aw / naturalW, ah / naturalH);
  }

  function contain() {
    scale = clampScale(containScale());
    center();
  }

  function fitWidth() {
    scale = clampScale((stage.clientWidth - 20) / naturalW);
    center();
  }

  function build() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'sa-viewer';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="sa-viewer-head">' +
        '<span class="sa-viewer-title"></span>' +
        '<button class="sa-viewer-close" aria-label="关闭">✕</button>' +
      '</div>' +
      '<div class="sa-viewer-stage"><div class="sa-viewer-content"></div></div>' +
      '<div class="sa-viewer-bar">' +
        '<button type="button" data-act="out" aria-label="缩小">−</button>' +
        '<span class="sa-viewer-zoom">100%</span>' +
        '<button type="button" data-act="in" aria-label="放大">＋</button>' +
        '<button type="button" data-act="fit">适应屏幕</button>' +
      '</div>';
    document.body.appendChild(overlay);

    stage = overlay.querySelector('.sa-viewer-stage');
    content = overlay.querySelector('.sa-viewer-content');
    zoomLabel = overlay.querySelector('.sa-viewer-zoom');
    titleEl = overlay.querySelector('.sa-viewer-title');

    overlay.querySelector('.sa-viewer-close').addEventListener('click', close);
    overlay.querySelector('.sa-viewer-bar').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'in') setScale(scale * RATIO);
      else if (act === 'out') setScale(scale / RATIO);
      else if (act === 'fit') contain();
    });
    zoomLabel.addEventListener('click', startEditZoom);

    bindGestures();
  }

  var editing = false;

  /** 点倍率 → 原地变输入框；回车/失焦生效，Esc 取消；范围 1%–350% */
  function startEditZoom() {
    if (editing) return;
    editing = true;

    var cur = Math.round(scale * 1000) / 10;
    var wrap = document.createElement('span');
    wrap.className = 'sa-viewer-zoom-edit';

    var input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'sa-viewer-zoom-input';
    input.value = String(cur);
    input.setAttribute('aria-label', '缩放百分比');

    var pct = document.createElement('span');
    pct.className = 'sa-viewer-pct';
    pct.textContent = '%';

    var reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'sa-viewer-reset';
    reset.textContent = '100%';

    wrap.appendChild(input);
    wrap.appendChild(pct);
    wrap.appendChild(reset);
    zoomLabel.parentNode.insertBefore(wrap, zoomLabel);
    zoomLabel.style.display = 'none';

    input.focus();
    input.select();

    function finish(apply) {
      if (!editing) return;
      editing = false;
      if (apply) {
        var raw = String(input.value).replace(/[^0-9.]/g, '');
        var v = parseFloat(raw);
        if (isFinite(v) && v > 0) {
          var p = Math.max(MIN * 100, Math.min(MAX * 100, v));
          setScale(p / 100);
        }
      }
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      zoomLabel.style.display = '';
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function () { setTimeout(function () { finish(true); }, 0); });
    reset.addEventListener('mousedown', function (e) {
      e.preventDefault();
      input.value = '100';
      finish(true);
    });
  }

  /* ---------- 手势 ---------- */
  var pointers = [];
  var dragStart = null;
  var pinchStart = null;

  function pointerDist() {
    if (pointers.length < 2) return 0;
    var dx = pointers[0].x - pointers[1].x;
    var dy = pointers[0].y - pointers[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function indexOfPointer(id) {
    for (var i = 0; i < pointers.length; i++) if (pointers[i].id === id) return i;
    return -1;
  }

  function bindGestures() {
    stage.addEventListener('pointerdown', function (e) {
      stage.setPointerCapture(e.pointerId);
      pointers.push({ id: e.pointerId, x: e.clientX, y: e.clientY });
      if (pointers.length === 1) dragStart = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
      else if (pointers.length === 2) pinchStart = { dist: pointerDist(), scale: scale };
    });

    stage.addEventListener('pointermove', function (e) {
      var i = indexOfPointer(e.pointerId);
      if (i < 0) return;
      pointers[i].x = e.clientX;
      pointers[i].y = e.clientY;

      if (pointers.length >= 2 && pinchStart) {
        var d = pointerDist();
        if (pinchStart.dist > 0) setScale(pinchStart.scale * (d / pinchStart.dist));
        return;
      }
      if (dragStart) {
        tx = dragStart.tx + (e.clientX - dragStart.x);
        ty = dragStart.ty + (e.clientY - dragStart.y);
        apply();
      }
    });

    function end(e) {
      var i = indexOfPointer(e.pointerId);
      if (i >= 0) pointers.splice(i, 1);
      if (pointers.length < 2) pinchStart = null;
      if (pointers.length === 0) dragStart = null;
    }
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', end);
  }

  /* ---------- 打开 / 关闭 ---------- */

  /** 把 SVG 序列化成可以直接显示的 data URL（兜底路径用） */
  function svgDataUrl(svg) {
    try {
      var xml = new XMLSerializer().serializeToString(svg);
      if (xml.indexOf('xmlns=') < 0) {
        xml = xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    } catch (e) {
      return '';
    }
  }

  function sizeFromSvg(svg) {
    // 优先用渲染时记录的自然尺寸：页面里可能为了不占满屏幕把图等比缩小过，
    // 放大查看必须回到原始大小，否则「放大」等于放大缩略图。
    var dw = Number((svg.dataset && svg.dataset.nw) || 0);
    var dh = Number((svg.dataset && svg.dataset.nh) || 0);
    if (dw > 4 && dh > 4) return { w: Math.round(dw), h: Math.round(dh) };
    var r = svg.getBoundingClientRect();
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var w = (r && r.width > 4) ? r.width : (vb && vb.width ? vb.width : 0);
    var h = (r && r.height > 4) ? r.height : (vb && vb.height ? vb.height : 0);
    if (!w || !h) {
      w = (vb && vb.width) || 320;
      h = (vb && vb.height) || 480;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }

  function open(source, title) {
    build();
    if (!unregBack && window.saOnBack) {
      unregBack = window.saOnBack(function () { close(false); });
    }
    if (!viewerPushed) {
      // 一条历史 = 一次「返回键只关查看器」。失败（如沙箱禁用）也不影响放大功能
      try { history.pushState({ saViewer: 1 }, ''); viewerPushed = true; } catch (e) { /* ignore */ }
    }
    content.innerHTML = '';
    content.style.transform = 'none';
    initialCap = 1;
    titleEl.textContent = title || '图表';

    var svg = source.querySelector('svg');
    if (svg) {
      var size = sizeFromSvg(svg);
      naturalW = size.w;
      naturalH = size.h;
      var clone = svg.cloneNode(true);
      // inline !important：任何样式表都改不动它，避免被压成 0×0
      clone.style.setProperty('width', naturalW + 'px', 'important');
      clone.style.setProperty('height', naturalH + 'px', 'important');
      clone.style.setProperty('max-width', 'none', 'important');
      clone.removeAttribute('width');
      clone.removeAttribute('height');
      clone.setAttribute('width', String(naturalW));
      clone.setAttribute('height', String(naturalH));
      content.appendChild(clone);
    } else {
      var img = source.tagName === 'IMG' ? source : source.querySelector('img');
      if (img) {
        // 关键：必须用 naturalWidth/Height，且未加载完时要等 onload 重算，
        // 否则 naturalW 会退化成 0/320，倍率与居中全错。
        naturalW = img.naturalWidth || img.clientWidth || 900;
        naturalH = img.naturalHeight || img.clientHeight || 675;
        // 正文里这张图实际占多宽 → 打开时保持同样倍率（用户要求：不要一开就放大）
        var inlineW = img.getBoundingClientRect().width || naturalW;
        initialCap = inlineW / naturalW;
        var clone = img.cloneNode(true);
        clone.style.setProperty('max-width', 'none', 'important');
        clone.style.setProperty('width', naturalW + 'px', 'important');
        clone.style.setProperty('height', 'auto', 'important');
        clone.removeAttribute('width');
        clone.removeAttribute('height');
        content.appendChild(clone);
        if (!img.complete) {
          img.addEventListener('load', function () {
            naturalW = img.naturalWidth || naturalW;
            naturalH = img.naturalHeight || naturalH;
            var c2 = content.querySelector('img');
            if (c2) {
              c2.style.setProperty('width', naturalW + 'px', 'important');
              c2.style.setProperty('height', 'auto', 'important');
            }
            scale = clampScale(Math.min(initialCap, containScale()));
            center();
          }, { once: true });
        }
      } else {
        var node = source.querySelector('table') || source.querySelector('pre') || source;
        content.appendChild(node.cloneNode(true));
        naturalW = content.scrollWidth || 320;
        naturalH = content.scrollHeight || 480;
      }
    }

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';

    scale = clampScale(Math.min(initialCap, containScale()));
    requestAnimationFrame(function () {
      scale = clampScale(Math.min(initialCap, containScale()));
      center();
      requestAnimationFrame(verifyNotEmpty);
    });
  }

  /** 打开后自检：内容为空就降级成 <img>，再不行给文案 */
  function verifyNotEmpty() {
    var r = content.getBoundingClientRect();
    if (r.width >= 8 && r.height >= 8) return;

    var svg = content.querySelector('svg');
    var url = svg ? svgDataUrl(svg) : '';
    if (url) {
      content.innerHTML = '';
      var img = document.createElement('img');
      img.alt = titleEl.textContent || '图表';
      img.style.display = 'block';
      img.onload = function () {
        naturalW = img.naturalWidth || naturalW;
        naturalH = img.naturalHeight || naturalH;
        scale = clampScale(Math.min(1, containScale()));
        center();
      };
      img.src = url;
      content.appendChild(img);
      return;
    }

    content.innerHTML = '<div class="sa-viewer-tip">这个图表暂时无法放大，请在页面内横向滑动查看。</div>';
  }

  function close(viaHistory) {
    // close 也被直接注册成事件监听器（✕ 按钮），此时第一个参数是 event，
    // 必须归一化成 boolean，否则会被误判为"从历史返回"，跳过 history.back()
    if (viaHistory && typeof viaHistory === 'object') viaHistory = false;
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    content.innerHTML = '';
    content.style.transform = 'none';
    initialCap = 1;
    document.body.style.overflow = '';
    if (unregBack) { unregBack(); unregBack = null; }
    if (viewerPushed) {
      viewerPushed = false;
      // 点 ✕ / 点遮罩 / ESC 关闭时，把自己压的那条历史退掉，避免条累积；
      // 返回键关闭时（viaHistory）已经退过了，不能再 back 一次，否则会连退两页。
      if (!viaHistory) {
        try { history.back(); } catch (e) { /* ignore */ }
      }
    }
  }

  /* 返回键 / 返回手势：popstate 时若查看器还开着，只关查看器，不离开课程。
     注意 popstate 的 e.state 是"目标条目"的状态，不能拿它判断，必须看 DOM 现状。 */
  window.addEventListener('popstate', function () {
    if (overlay && !overlay.hidden) close(true);
  });

  /* ESC 也能关（桌面/外接键盘场景），与点 ✕ 同一条路径 */
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // 缩放输入框自己处理 ESC（取消输入），不要顺带把整层关掉
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (overlay && !overlay.hidden) {
      e.preventDefault();
      close(false);
    }
  });

  function titleOf(el) {
    var fig = el.closest ? el.closest('figure') : null;
    var cap = fig ? fig.querySelector('figcaption') : null;
    if (cap) return cap.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
    var prev = el.previousElementSibling;
    if (prev && /^H[1-6]$/.test(prev.tagName)) {
      return prev.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
    }
    return '图表';
  }

  /** 滚动容器外面套一层定位层：按钮挂在包装层上，才不会随内容滚走 */
  function ensureWrap(el) {
    var p = el.parentNode;
    if (p && p.classList && p.classList.contains('sa-zoom-wrap')) return p;
    var wrap = document.createElement('div');
    wrap.className = 'sa-zoom-wrap';
    p.insertBefore(wrap, el);
    wrap.appendChild(el);
    return wrap;
  }

  function addButton(el) {
    var wrap = ensureWrap(el);
    if (wrap.querySelector(':scope > .sa-zoom')) return;
    var isImg = el.tagName === 'IMG';
    var hasSvg = !!el.querySelector('svg');
    var hasTable = !!el.querySelector('table');
    // 课件截图（<img>）也要能放大：以前这里早退，点击只会触发 <a href> 的原生整页看图
    if (!hasSvg && !hasTable && !isImg) return;
    el.classList.add('sa-zoomable');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sa-zoom';
    btn.setAttribute('aria-label', '放大查看');
    btn.textContent = '⤢';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      open(el, titleOf(el));
    });
    wrap.appendChild(btn);
  }

  function setupButtons() {
    var diagrams = document.querySelectorAll('.mermaid');
    for (var i = 0; i < diagrams.length; i++) addButton(diagrams[i]);

    // 课件截图：一律可点开放大（手机上看不清细节）
    var shots = document.querySelectorAll('.sa-ppt img');
    for (var k = 0; k < shots.length; k++) {
      addButton(shots[k]);
      var link = shots[k].closest ? shots[k].closest('a.sa-ppt-open') : null;
      if (link && !link.dataset.saZoomBound) {
        link.dataset.saZoomBound = '1';
        // 拦住 <a href="/img/…">：否则 WebView 会整页打开原图（倍率 1:1、左上角对齐）
        link.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var im = this.querySelector('img');
          if (im) open(im, titleOf(im));
        });
      }
    }

    // 只给"横向溢出的宽表格"加放大镜，避免每张表都长按钮
    var tables = document.querySelectorAll('.table-wrap');
    for (var j = 0; j < tables.length; j++) {
      var t = tables[j];
      if (t.scrollWidth > t.clientWidth + 4) addButton(t);
    }
  }

  // mermaid 渲染完成后的回调（渲染会清空容器，按钮要在这里补）
  window.__saDiagramRendered = addButton;

  function boot() {
    setupButtons();

    // mermaid 是懒渲染的：图表渲染完会替换容器内容，用 MutationObserver 比轮询省
    if (window.MutationObserver) {
      var pending = 0;
      var mo = new MutationObserver(function () {
        if (pending) return;
        pending = requestAnimationFrame(function () {
          pending = 0;
          setupButtons();
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
      // 兜底：有些浏览器对 subtree 变化节流，再补两次延迟扫描
      setTimeout(setupButtons, 1200);
      setTimeout(setupButtons, 3000);
    }

    function relayout() {
      if (overlay && !overlay.hidden) contain();
      setupButtons();   // 旋屏后"表格是否溢出"要重新判断
    }
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
  }

  if (document.readyState === 'complete') setTimeout(boot, 0);
  else window.addEventListener('load', boot);
})();
