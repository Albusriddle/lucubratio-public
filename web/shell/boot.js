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
