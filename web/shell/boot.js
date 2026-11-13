/* 首屏同步应用主题与字号，避免"先白一下再变黑"的闪烁。
   必须以普通 script（非 module、非 defer）放在 <head>，在首次绘制前执行。 */
(function () {
  'use strict';
  try {
    var root = document.documentElement;

    var pref = localStorage.getItem('sa:theme') || 'auto';
    var dark = pref === 'dark' ||
      (pref === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (dark) root.classList.add('sa-dark');
    root.setAttribute('data-theme', dark ? 'dark' : 'light');

    var fs = localStorage.getItem('sa:fs');
    if (fs) root.style.setProperty('--sa-fs', fs + 'px');

    // 供 theme.js / 调试使用
    window.__SA_BOOT__ = { theme: pref, dark: !!dark, fs: fs || '' };
  } catch (e) { /* 隐私模式下 localStorage 可能不可用，忽略 */ }
})();

/* 全局轻提示 window.saToast(msg)
   为什么要它：壳层里原本有三套写法且都不完整——
     · home.js 有本地 toast()（只走原生桥，浏览器里静默）
     · home.js 的导入回调调用 window.saToast(...)，但它**从未被定义**（提示只进了 console）
     · toc.js 用 window.alert()，本壳没设 WebChromeClient，alert 是空操作
   这里定义唯一实现：优先原生 Toast，浏览器预览用 DOM 兜底，保证"任何环境下都能看见"。
   boot.js 是三个壳页（index/toc/me）都加载、且在其它脚本之前执行的那一个。 */
(function () {
  'use strict';
  var HOST_ID = 'sa-toast-host';
  var FALLBACK_CSS = 'position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom));' +
    'transform:translateX(-50%);max-width:86vw;padding:10px 16px;border-radius:10px;' +
    'background:rgba(24,26,30,.92);color:#fff;font-size:14px;line-height:1.4;z-index:9999;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.28);pointer-events:none;opacity:0;transition:opacity .18s';

  window.saToast = function (msg) {
    var text = String(msg == null ? '' : msg);
    if (!text) return;
    if (window.AndroidSA && window.AndroidSA.toast) {
      try { window.AndroidSA.toast(text); return; } catch (e) { /* 落到 DOM 兜底 */ }
    }
    try {
      var host = document.getElementById(HOST_ID);
      if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        (document.body || document.documentElement).appendChild(host);
      }
      var el = document.createElement('div');
      el.setAttribute('style', FALLBACK_CSS);
      el.textContent = text;
      host.appendChild(el);
      requestAnimationFrame(function () { el.style.opacity = '1'; });
      setTimeout(function () {
        el.style.opacity = '0';
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
      }, 1800);
    } catch (e) { /* 连 DOM 都不行就算了，不能因为提示把主流程搞崩 */ }
  };
})();

/* 清理「环境自检」的探针库（lucubratio-probe）
   为什么放在 boot：诊断页要建这个库来验证 IndexedDB 可用，而在诊断页里删除总被 blocked
   （同一文档的连接尚未释放）。页面启动时没有任何连接占用它，删起来最可靠——
   所以只要离开诊断页（或下次启动 App）就会自动清掉。 */
(function () {
  try {
    if (window.indexedDB && indexedDB.deleteDatabase) indexedDB.deleteDatabase('lucubratio-probe');
  } catch (e) { /* 忽略 */ }
})();

/* ============================================================
   页面切换过渡（幕布淡出 → 淡入）+ 弹窗关闭动画
   ------------------------------------------------------------
   为什么不用 View Transitions：本机 Android 15 的 WebView 是 110，
   document.startViewTransition 为 undefined（跨文档 VT 更要 Chromium 126+），
   所以走"自己画幕布"这条在 WebView 90+ 都能用的路。
   如果将来 WebView 支持 VT，这里会自动让位（见 canVT 分支），不会双重动效。
   ============================================================ */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canVT = typeof document.startViewTransition === 'function';
  if (canVT) return;                     // 有 VT 就交给 nav.js 的 VT 分支

  var ID = 'sa-curtain';
  var CSS = '#' + ID + '{position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,.94);' +
    'opacity:1;pointer-events:none;transition:opacity .12s linear;will-change:opacity}' +
    '#' + ID + '.is-in{opacity:1;pointer-events:auto}' +
    '#' + ID + '.is-out{opacity:0;pointer-events:none}' +
    '@media (prefers-reduced-motion: reduce){#' + ID + '{transition:none}}';

  // 同步插入（在 <head> 里执行）：首帧就是黑的，消掉两页之间的白闪
  try {
    if (!document.getElementById(ID + '-css')) {
      var st = document.createElement('style');
      st.id = ID + '-css';
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    if (!document.getElementById(ID)) {
      var el = document.createElement('div');
      el.id = ID;
      el.className = 'is-in';
      el.setAttribute('aria-hidden', 'true');
      document.documentElement.appendChild(el);
    }
  } catch (e) { /* 极端情况下没有样式也不影响功能 */ }

  function curtain() { return document.getElementById(ID); }

  var leaving = false;

  /** 淡入完成：去掉黑幕（内容已在首帧之下就位） */
  function reveal() {
    if (leaving) return;            // 已经在离开流程里，别把幕布又改回透明（会让过渡提前结束）
    var c = curtain();
    if (!c) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        c.classList.add('is-out');
        c.classList.remove('is-in');
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reveal);
  else reveal();

  function leave(fn) {
    if (leaving) return;                 // 300ms 内的重复点击直接忽略（防双跳）
    leaving = true;
    var c = curtain();
    if (reduce || !c) { fn(); return; }
    c.classList.remove('is-out');
    c.classList.add('is-in');            // 淡出到黑
    var done = false;
    // 跳之前**强制黑透**：本机合成分层慢（120ms 过渡常常只跑到 ~0.5），
    // 若不强制，画面会在半黑状态被切走，看起来像"闪了一下"。
    var go = function () {
      if (done) return; done = true;
      try { c.style.opacity = '1'; } catch (e) {}
      setTimeout(fn, 24);                // 留一帧让浏览器把纯黑画出来
    };
    c.addEventListener('transitionend', function h(e) {
      if (e.propertyName !== 'opacity') return;
      if (parseFloat(getComputedStyle(c).opacity) < 0.98) return;
      c.removeEventListener('transitionend', h);
      go();
    });
    setTimeout(go, 130);                 // 略长于 .12s 过渡；到点无论跑到哪都强制黑透
  }

  /** 统一跳转入口：所有程序化导航都应走这里 */
  window.saLeave = function (url) { leave(function () { location.href = url; }); };
  /** 统一刷新入口 */
  window.saReload = function () { leave(function () { location.reload(); }); };

  // 返回键 / 返回手势 / 关页面：拦不住"出"，但可以把幕布先置黑，视觉上仍是同一种过渡
  window.addEventListener('pagehide', function () {
    var c = curtain();
    if (c && !reduce) { c.classList.remove('is-out'); c.classList.add('is-in'); }
  });
  // bfcache 恢复（返回上一页命中缓存）：必须清掉黑幕，否则停在全黑
  window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; reveal(); } });

  /** 弹窗关闭动画：本机不支持 transition-behavior:allow-discrete，只能先演再关 */
  window.saCloseDialog = function (dlg) {
    if (!dlg || !dlg.open) { try { if (dlg) dlg.close(); } catch (e) {} return; }
    if (reduce) { dlg.close(); return; }
    dlg.classList.add('is-closing');
    setTimeout(function () {
      try { dlg.close(); } catch (e) {}
      dlg.classList.remove('is-closing');
    }, 130);
  };
})();
