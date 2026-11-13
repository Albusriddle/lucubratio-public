/* ============================================================
   Lucubratio · Mermaid 渲染
   - 库不随页面同步加载：5.3MB 的 mermaid.min.js 在第一张图
     快进入视口（提前 600px）时才动态注入，含图页面首屏省一次整包解析。
   - 惰性渲染：滚进视口才渲染。
   - 主题切换：只重渲染"当前可见"的图，其余等滚回来再渲。
   - 无障碍：渲染后给 SVG 补 role="img" 与 aria-label（取自 figcaption）。
   ============================================================ */
(function () {
  'use strict';

  // 同步阶段捕获本脚本的 data-lib：loadLib 在 IntersectionObserver 回调里执行，
  // 那时 document.currentScript 已是 null，必须在这里先存下来（否则丢 ?v= 缓存击穿）。
  var LIB_SRC = (function () {
    var cs = document.currentScript;
    if (cs && cs.dataset && cs.dataset.lib) return cs.dataset.lib;
    return window.__SA_MERMAID_SRC || '/vendor/mermaid.min.js';
  })();

  // ---------- 同步阶段：先快照源码 ----------
  // 构建期已把 mermaid 源码整体 HTML 转义，textContent 读出来就是原文（<br/> 等都在）。
  var early = document.querySelectorAll('.mermaid');
  for (var i = 0; i < early.length; i++) {
    if (!early[i].hasAttribute('data-src')) {
      early[i].setAttribute('data-src', early[i].textContent);
    }
  }

  var nodes = [];
  var visible = [];
  var initialized = false;
  var libPromise = null;

  function isDark() {
    return document.documentElement.classList.contains('sa-dark');
  }

  function config() {
    var dark = isDark();
    return {
      startOnLoad: false,
      securityLevel: 'loose',
      theme: dark ? 'dark' : 'default',
      fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      flowchart: { htmlLabels: true, curve: 'basis', padding: 14, nodeSpacing: 26, rankSpacing: 34, wrappingWidth: 280 },
      state: { nodeSpacing: 26, rankSpacing: 34 },
      maxTextSize: 20000,
      themeVariables: dark ? {
        background: '#171c24',
        primaryColor: '#1d2530',
        primaryTextColor: '#e6edf6',
        primaryBorderColor: '#3a4757',
        lineColor: '#7d8ea3',
        secondaryColor: '#1b2430',
        tertiaryColor: '#141a22',
      } : {},
    };
  }

  function ensureInit() {
    if (!window.mermaid) return false;
    if (!initialized || window.__saMermaidDark !== isDark()) {
      window.mermaid.initialize(config());
      window.__saMermaidDark = isDark();
      initialized = true;
    }
    return true;
  }

  /** 按需加载 mermaid 本体（只加载一次） */
  function loadLib() {
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      // 库路径由注入的 <script src="/shell/mermaid-init.js" data-lib="…"> 提供；
      // 兼容旧写法 window.__SA_MERMAID_SRC（老产物/旧包），最后回落到默认路径。
      var src = LIB_SRC;
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () {
        if (window.mermaid) resolve(window.mermaid);
        else reject(new Error('mermaid 加载后未挂载到 window'));
      };
      s.onerror = function () { reject(new Error('mermaid 脚本加载失败')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  function decorate(el) {
    var svg = el.querySelector('svg');
    if (!svg) return;
    // 按 viewBox 给 SVG 定「自然尺寸」，再用 max-width 限宽。
    // 为什么：mermaid 默认 useMaxWidth 会把窄图按容器等比放大（4 节点竖排图被拉到整屏、
    // 字号几十 px）；而单纯 CSS width:auto 对无固有尺寸的 SVG 又会退化成 100%，等于没修。
    try {
      var vb = svg.viewBox && svg.viewBox.baseVal;
      if (vb && vb.width > 0) {
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = vb.width + 'px';
        svg.style.height = 'auto';
        svg.style.maxWidth = '100%';
      }
    } catch (e) { /* 老 WebView 没有 viewBox.baseVal 时保持原样 */ }
    svg.setAttribute('role', 'img');
    var fig = el.closest ? el.closest('figure') : null;
    var cap = fig ? fig.querySelector('figcaption') : null;
    var label = cap ? cap.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    svg.setAttribute('aria-label', label || '结构图');
  }

  function renderOne(el) {
    var src = (el.getAttribute('data-src') || '').trim();
    if (!src) return Promise.resolve();

    return loadLib().then(function () {
      if (!ensureInit()) return;
      el.removeAttribute('data-rendered');
      el.textContent = src; // 写入后 innerHTML 是转义文本，mermaid 自己 decode
      return window.mermaid.run({ nodes: [el] }).then(function () {
        el.setAttribute('data-rendered', '1');
        decorate(el);
        // 渲染会清空容器（el.textContent = src），外部挂在里面的 UI 需要重建
        if (typeof window.__saDiagramRendered === 'function') window.__saDiagramRendered(el);
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="mermaid-error">图表渲染失败：' +
        String((e && e.message) || e).slice(0, 200) + '</div>';
    });
  }

  function isRendered(el) {
    return el.getAttribute('data-rendered') === '1';
  }

  function setup() {
    nodes = Array.prototype.slice.call(document.querySelectorAll('.mermaid'));
    if (!nodes.length) return;

    if (!('IntersectionObserver' in window)) {
      nodes.forEach(renderOne);
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          if (visible.indexOf(en.target) < 0) visible.push(en.target);
          if (!isRendered(en.target)) renderOne(en.target);
        } else {
          var k = visible.indexOf(en.target);
          if (k >= 0) visible.splice(k, 1);
        }
      });
    }, { rootMargin: '600px 0px' });

    nodes.forEach(function (n) { io.observe(n); });
    watchTheme();
  }

  /** 主题切换：只重渲染当前可见的图，其他的保持原样（滚回来时若已渲染则不重做） */
  function watchTheme() {
    var lastDark = isDark();
    var mo = new MutationObserver(function () {
      var d = isDark();
      if (d === lastDark) return;
      lastDark = d;
      initialized = false; // 颜色变了，需要重新 initialize
      visible.slice().forEach(function (el) {
        if (isRendered(el)) renderOne(el);
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  function boot() {
    if (!document.querySelector('.mermaid')) return;
    setup();
  }

  if (document.readyState === 'complete') setTimeout(boot, 0);
  else window.addEventListener('load', boot);
})();
