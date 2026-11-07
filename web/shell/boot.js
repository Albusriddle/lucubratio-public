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
