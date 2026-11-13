// 页面切换：只负责「拦截点击 → 交给统一入口」，动效实现不在这里
//
// 能力基线（实测）：Android 15 自带 WebView 是 110，document.startViewTransition 为 undefined，
// 所以默认走 boot.js 的幕布过渡；只有设备 WebView ≥111 时才会用 View Transitions。
//   · window.saLeave(url) 由 boot.js 提供：有 VT 用 VT，没有就用幕布淡出到黑
//   · data-nav-kind 仍保留：VT 生效时 CSS 用它决定滑入方向
//   · 只拦截同源链接；锚点、外链、下载、target=_blank、带 scheme 的链接一律放行
//
// 约定：
//   <a href="…">                    → 前进（从左滑入）
//   <a href="…" data-nav="back">    → 后退（从右滑入）
//   <a href="…" data-nav="tab">     → tab 切换（淡入淡出）
(function () {
  var root = document.documentElement;

  function kindOf(a) {
    var k = (a.getAttribute('data-nav') || '').trim();
    if (k) return k;
    if (a.classList.contains('sa-back')) return 'back';
    return 'forward';
  }

  function navigate(url, kind) {
    root.setAttribute('data-nav-kind', kind);
    // 统一交给 boot.js：有能力就用 View Transition，没有就用幕布；
    // 这里不再自己判断，避免两套动效叠加。
    if (window.saLeave) { window.saLeave(url); return; }
    location.href = url;   // sa-nav-fallback（boot.js 没加载时才走到）
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-no-vt')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    if (a.origin && a.origin !== location.origin) return;          // 外链放行
    // 只放行「带 scheme」的链接（http/https/mailto/tel…）；
    // 裸相对路径（search.html）、./x、../x、/x 全部按站内跳转处理。
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    e.preventDefault();
    navigate(a.href, kindOf(a));
  }, false);

  // 从缓存返回（浏览器后退）时不要保留上次的方向，避免动画错乱
  window.addEventListener('pageshow', function () { root.removeAttribute('data-nav-kind'); });
})();
