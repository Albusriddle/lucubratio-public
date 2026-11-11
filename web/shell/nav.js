// 页面切换动效（滑动 / 淡入淡出）
//
// 设计：
//   · 优先用 View Transitions API（Android 15 的 WebView 支持），按 data-nav 选方向
//   · 不支持或用户开了「减少动态效果」→ 直接跳转，只保留一次很轻的淡入（CSS 负责）
//   · 只拦截同源链接；锚点、外链、下载、target=_blank 一律放行
//
// 约定：
//   <a href="…">                    → 前进（从左滑入）
//   <a href="…" data-nav="back">    → 后退（从右滑入）
//   <a href="…" data-nav="tab">     → tab 切换（淡入淡出）
(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canVT = typeof document.startViewTransition === 'function';

  function kindOf(a) {
    var k = (a.getAttribute('data-nav') || '').trim();
    if (k) return k;
    if (a.classList.contains('sa-back')) return 'back';
    return 'forward';
  }

  function navigate(url, kind) {
    root.setAttribute('data-nav-kind', kind);
    if (!canVT || reduce) {
      location.href = url;
      return;
    }
    try {
      document.startViewTransition(function () { location.href = url; });
    } catch (e) {
      location.href = url;
    }
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-no-vt')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    if (a.origin && a.origin !== location.origin) return;          // 外链放行
    if (!/^\/(?!\/)/.test(href) && !/^\.{0,2}\//.test(href)) return; // 只处理站内相对/绝对路径
    e.preventDefault();
    navigate(a.href, kindOf(a));
  }, false);

  // 从缓存返回（浏览器后退）时不要保留上次的方向，避免动画错乱
  window.addEventListener('pageshow', function () { root.removeAttribute('data-nav-kind'); });
})();
