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
   页面切换过渡 + 弹窗动画
   ------------------------------------------------------------
   两条路线，按能力自动选：
     · 支持 View Transitions（Chromium 111+）→ saLeave/saReload 用 startViewTransition
     · 不支持（本机 Android 15 的 WebView 是 110）→ 幕布淡出到黑、再淡入新页
   三个入口 saLeave / saReload / saCloseDialog **必须永远存在**：
   曾经写成「有 VT 就整段 return」，结果在支持 VT 的设备上，程序化跳转与弹窗关闭
   会静默退回瞬时切换——比老设备还"没动效"。
   ============================================================ */
(function () {
  'use strict';
  var ID = 'sa-curtain';
  var canVT = typeof document.startViewTransition === 'function';

  /** 每次实时读取系统设置（用户可能中途开"移除动画"） */
  function prefersReduce() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // 幕布样式：z-index 1900 —— 在 splash(2000/2100) 之下、图片查看器(1200)/顶栏(950)/遮罩(880) 之上
  var CSS = '#' + ID + '{position:fixed;inset:0;z-index:1900;background:rgba(0,0,0,.94);' +
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
    if (leaving) return;
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

  /** 幕布过渡：先黑透再执行 fn */
  function curtainLeave(fn) {
    if (leaving) return;
    leaving = true;
    var c = curtain();
    if (!c || prefersReduce()) { fn(); return; }
    c.classList.remove('is-out');
    c.classList.add('is-in');
    var done = false;
    var go = function () {
      if (done) return; done = true;
      // 跳之前强制黑透：慢渲染设备上 120ms 过渡常只跑到 ~0.5
      try { c.style.opacity = '1'; } catch (e) {}
      setTimeout(fn, 24);
    };
    c.addEventListener('transitionend', function h(e) {
      if (e.propertyName !== 'opacity') return;
      if (parseFloat(getComputedStyle(c).opacity) < 0.98) return;
      c.removeEventListener('transitionend', h);
      go();
    });
    setTimeout(go, 130);
  }

  /** 有 VT 时走 VT（保留 data-nav-kind 方向）；失败返回 false 让调用方退回幕布 */
  function vtLeave(fn) {
    try {
      document.startViewTransition(function () { fn(); });
      return true;
    } catch (e) { return false; }
  }

  /** 统一跳转入口 */
  window.saLeave = function (url) {
    var go = function () { location.href = url; };
    if (canVT && !prefersReduce() && vtLeave(go)) return;
    curtainLeave(go);
  };

  /** 统一刷新入口 */
  window.saReload = function () {
    var go = function () { location.reload(); };
    if (canVT && !prefersReduce() && vtLeave(go)) return;
    curtainLeave(go);
  };

  // 返回键 / 返回手势 / 关页面：拦不住"出"，但可以把幕布先置黑，视觉上仍是同一种过渡
  window.addEventListener('pagehide', function () {
    var c = curtain();
    if (c && !prefersReduce()) { c.classList.remove('is-out'); c.classList.add('is-in'); }
  });
  // bfcache 恢复（返回上一页命中缓存）：必须清掉黑幕，否则停在全黑
  window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; reveal(); } });

  /** 弹窗关闭动画：本机不支持 transition-behavior:allow-discrete，只能先演再关 */
  window.saCloseDialog = function (dlg) {
    if (!dlg || !dlg.open) { try { if (dlg) dlg.close(); } catch (e) {} return; }
    if (prefersReduce()) { dlg.close(); return; }
    dlg.classList.add('is-closing');
    setTimeout(function () {
      try { dlg.close(); } catch (e) {}
      dlg.classList.remove('is-closing');
    }, 130);
  };
})();
