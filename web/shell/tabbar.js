// 底部三 tab（主页 / 目录 / 我的）——只在 index / toc / me 三页挂载
// 内容页不加底栏（那边已有顶栏的返回/目录/设置），避免压缩正文高度。
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

  function mount() {
    if (document.querySelector('.sa-tabbar')) return;
    document.body.appendChild(nav);
    document.body.classList.add('has-tabbar');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
