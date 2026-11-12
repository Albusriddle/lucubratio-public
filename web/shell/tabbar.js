// 底部三 tab（主页 / 目录 / 我的）——只在 index / toc / me 三页挂载
// 内容页不加底栏（那边已有顶栏的返回/目录/设置），避免压缩正文高度。

// 样式随脚本自带：谁挂 tabbar.js 谁就有样式，不依赖 home.css
// （曾经只把样式放在 home.css，结果 4 个次级页面挂了脚本却没挂样式，
//   svg 没有尺寸约束直接撑满整屏。）
function injectStyle() {
  if (document.getElementById('sa-tabbar-style')) return;
  var css = [
    'body.has-tabbar{padding-bottom:calc(var(--sa-tabbar-h, 72px) + 16px + env(safe-area-inset-bottom))}',
    '.sa-tabbar{position:fixed;left:0;right:0;bottom:0;display:flex;align-items:stretch;',
    'background:rgba(23,28,36,.94);backdrop-filter:saturate(160%) blur(12px);',
    'border-top:1px solid rgba(255,255,255,.08);padding-bottom:env(safe-area-inset-bottom);z-index:900}',
    'html:not(.sa-dark) .sa-tabbar{background:rgba(255,255,255,.96);border-top-color:rgba(0,0,0,.08)}',
    '.sa-tab{flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:3px;',
    'padding:9px 0 10px;text-decoration:none;color:#8b98a9;font-size:11.5px;',
    '-webkit-tap-highlight-color:transparent}',
    '.sa-tab svg{width:22px;height:22px;flex:0 0 auto}',
    '.sa-tab.is-on{color:#6fb6ff;font-weight:600}',
    '.sa-tab:active{opacity:.7}'
  ].join('');
  var el = document.createElement('style');
  el.id = 'sa-tabbar-style';
  el.textContent = css;
  (document.head || document.documentElement).appendChild(el);
}

(function () {
  var TABS = [
    { key: 'home', href: '/', label: '主页', icon: 'M12 3.2 3.6 10.4V21h6.2v-6.1h4.4V21h6.2V10.4Z' },
    { key: 'toc', href: '/toc.html', label: '目录', icon: 'M4 6h16M4 12h16M4 18h10' },
    { key: 'me', href: '/me.html', label: '我的', icon: 'M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2ZM4.5 20.4c.6-3.6 3.8-5.9 7.5-5.9s6.9 2.3 7.5 5.9' },
  ];

  var here = location.pathname.replace(/\/index\.html$/, '/');
  if (here === '' || here === '/') here = '/';
  var active = here === '/' ? 'home' : here.indexOf('toc') >= 0 ? 'toc' : here.indexOf('me') >= 0 ? 'me' : '';

  var nav = document.createElement('nav');
  nav.className = 'sa-tabbar';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', '主导航');

  TABS.forEach(function (t) {
    var a = document.createElement('a');
    a.href = t.href;
    a.className = 'sa-tab' + (t.key === active ? ' is-on' : '');
    a.setAttribute('data-nav', 'tab');
    a.setAttribute('aria-current', t.key === active ? 'page' : 'false');
    var svg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + t.icon +
      '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    a.innerHTML = svg + '<span>' + t.label + '</span>';
    nav.appendChild(a);
  });

  /** 把底栏真实高度写进 --sa-tabbar-h：
      页面底部内边距靠它算，写死 72px 在系统字体放大 / 横屏时会不够，最后几行会被压住。 */
  function syncHeight() {
    var bar = document.querySelector('.sa-tabbar');
    if (!bar) return;
    var h = Math.round(bar.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--sa-tabbar-h', h + 'px');
  }

  function mount() {
    if (document.querySelector('.sa-tabbar')) return;
    injectStyle();
    document.body.appendChild(nav);
    document.body.classList.add('has-tabbar');
    syncHeight();
    window.addEventListener('resize', syncHeight);
    window.addEventListener('orientationchange', function () { setTimeout(syncHeight, 120); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
