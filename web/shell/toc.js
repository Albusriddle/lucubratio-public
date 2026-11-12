// 目录页：课程 → 讲义页（章） → 小节，三级可折叠
// 每行右侧 1/4 是「展开」按钮，点行内其余部分=跳转（跳转前二次确认）。
import { loadLibrary, loadSearchIndex } from '/shell/library.js';
import { deleteCourseData } from '/shell/store.js';

const $ = (id) => document.getElementById(id);

/** 非阻塞提示：本壳没有 WebChromeClient，window.alert 是空操作，统一走 boot.js 的 saToast */
function notify(msg) {
  if (window.saToast) { window.saToast(msg); return; }
  console.warn('[toc]', msg);
}
const STORE_KEY = 'lucubratio.toc.expanded';

function loadExpanded() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function saveExpanded(obj) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch (e) { /* 隐私模式忽略 */ }
}

const expanded = loadExpanded();

/* ---------------- 二次确认 ---------------- */
function confirmAsk(label, sub, kicker, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const dlg = $('toc-confirm');
    $('toc-confirm-title').textContent = label;
    $('toc-confirm-sub').textContent = sub || '';
    const k = $('toc-confirm-kicker');
    if (k) k.textContent = kicker || '跳转到';
    const yes = $('toc-confirm-yes');
    const no = $('toc-confirm-no');

    // 按钮文案与危险态**每次都显式重设**：
    // dialog 是复用的，不重设就会出现"删除的红色「删除」残留到下次跳转"。
    yes.textContent = opts.okText || '跳转';
    yes.classList.toggle('danger', !!opts.danger);
    yes.setAttribute('aria-label', opts.okText || '跳转');

    function done(v) {
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      dlg.removeEventListener('cancel', onNo);
      if (dlg.open) dlg.close();
      resolve(v);
    }
    function onYes() { done(true); }
    function onNo(e) { if (e) e.preventDefault(); done(false); }

    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    dlg.addEventListener('cancel', onNo);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else done(window.confirm(label + '\n' + (sub || '')));
  });
}

async function jump(file, anchor, label, sub) {
  const ok = await confirmAsk(label, sub, '跳转到');
  if (!ok) return;
  const url = file + (anchor ? '#' + anchor : '');
  if (typeof document.startViewTransition === 'function') {
    document.documentElement.setAttribute('data-nav-kind', 'forward');
    document.startViewTransition(() => { location.href = url; });
  } else {
    location.href = url;
  }
}

/** 删除一门导入课程（原生删文件 + 本地清数据） */
async function deleteCourse(course) {
  const ok = await confirmAsk(
    course.title || course.id,
    '这门课的页面与学习记录会一起删掉，不可恢复',
    '删除课程',
    { okText: '删除', danger: true }
  );
  if (!ok) return;
  const bridge = window.AndroidSA;
  if (!bridge || typeof bridge.deleteCourse !== 'function') {
    notify('浏览器预览模式不会删除课程文件，请在 App 内操作');
    return;
  }
  try {
    const res = JSON.parse(bridge.deleteCourse(course.id) || '{}');
    if (!res.ok) throw new Error(res.message || '删除失败');
    await deleteCourseData(course.id);
    location.reload();
  } catch (e) {
    notify('删除失败：' + ((e && e.message) || e));
  }
}

/* ---------------- 一棵树 ---------------- */
function makeRow({ level, title, sub, hasChildren, key, onOpen, onGo }) {
  const row = document.createElement('div');
  row.className = 'toc-row lv' + level;
  if (hasChildren) row.classList.add('has-kids');

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'toc-main';
  main.innerHTML =
    '<span class="toc-tt">' + title + '</span>' +
    (sub ? '<span class="toc-sub">' + sub + '</span>' : '');
  main.addEventListener('click', onGo);
  row.appendChild(main);

  if (hasChildren) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'toc-more';
    more.setAttribute('aria-label', '展开或收起');
    more.setAttribute('aria-expanded', expanded[key] ? 'true' : 'false');
    more.textContent = '›';
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      expanded[key] = !expanded[key];
      saveExpanded(expanded);
      more.setAttribute('aria-expanded', expanded[key] ? 'true' : 'false');
      more.classList.toggle('open', !!expanded[key]);
      const kids = row.nextElementSibling;
      if (kids && kids.classList.contains('toc-kids')) kids.classList.toggle('open', !!expanded[key]);
      onOpen && onOpen(expanded[key]);
    });
    more.classList.toggle('open', !!expanded[key]);
    row.appendChild(more);
  }
  return row;
}

function makeKids() {
  const box = document.createElement('div');
  box.className = 'toc-kids';
  return box;
}

/* ---------------- 渲染 ---------------- */
async function render() {
  const host = $('toc-tree');
  let lib = null, idx = null;
  try {
    [lib, idx] = await Promise.all([loadLibrary(), loadSearchIndex()]);
  } catch (e) {
    host.innerHTML = '<div class="empty">课程库加载失败：' + (e && e.message) + '</div>';
    return;
  }

  // library 的真实结构是 { builtin, imported[] }，不是 courses[]
  const flatten = (mf) => {
    const out = [];
    ((mf && mf.groups) || []).forEach((g) => (g.items || []).forEach((it) => out.push(it)));
    return out;
  };
  const courses = [];
  if (lib && lib.builtin) {
    const items = flatten(lib.builtin);
    if (items.length) courses.push({ id: 'builtin', title: '内置课程', pages: items });
  }
  ((lib && lib.imported) || []).forEach((c) => {
    const items = flatten(c.manifest);
    // 清单读不出来也要列出来：否则这门课在目录页完全不可见，
    // 连「删除」都用不了（只能想别的办法清数据）。
    courses.push({
      id: (c.meta && c.meta.id) || 'imported',
      title: (c.meta && c.meta.title) || '未命名课程',
      pages: items,
      deletable: true,
      broken: items.length === 0,
    });
  });
  if (!courses.length) {
    host.innerHTML = '<div class="empty">还没有导入课程。<br>到「主页 → 导入课程包」加一门吧。</div>';
    return;
  }

  // 用检索索引把每个页面的小节取出来（sections 里 p=页 cid，h=标题，a=锚点）
  const secByPage = {};
  ((idx && idx.sections) || []).forEach((s) => {
    if (!s || !s.p || !s.h) return;
    if (/^\s*检测\s*\d+/.test(s.h)) return;      // 自评题不进目录
    (secByPage[s.p] = secByPage[s.p] || []).push(s);
  });

  const frag = document.createDocumentFragment();

  courses.forEach((course) => {
    const ckey = 'c:' + course.id;
    const pages = course.pages || [];
    const cRow = makeRow({
      level: 1,
      title: course.title || course.id,
      sub: course.broken ? '清单读不出来（建议删除后重新导入）' : pages.length + ' 讲',
      hasChildren: true,
      key: ckey,
      onGo: () => jump(pages[0] ? pages[0].file : '/', '', course.title, '课程首页'),
    });
    // 导入课程才给删除入口（内置课程随 APK，不提供删除）
    if (course.deletable) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'toc-del';
      del.textContent = '删除';
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteCourse(course); });
      cRow.insertBefore(del, cRow.querySelector('.toc-more'));
    }
    const cKids = makeKids();
    if (expanded[ckey]) cKids.classList.add('open');

    pages.forEach((page) => {
      const pkey = ckey + '>p:' + (page.id || page.file);
      const secs = secByPage[page.id] || [];
      const pRow = makeRow({
        level: 2,
        title: page.title || page.file,
        sub: secs.length ? secs.length + ' 节' : '',
        hasChildren: secs.length > 0,
        key: pkey,
        onGo: () => jump(page.file, '', page.title, '讲义开头'),
      });
      const pKids = makeKids();
      if (expanded[pkey]) pKids.classList.add('open');

      secs.forEach((s) => {
        const sRow = makeRow({
          level: 3,
          title: s.h,
          sub: '',
          hasChildren: false,
          key: pkey + '>s:' + s.a,
          onGo: () => jump(page.file, s.a, s.h, page.title),
        });
        pKids.appendChild(sRow);
      });

      cKids.appendChild(pRow);
      if (secs.length) cKids.appendChild(pKids);
    });

    frag.appendChild(cRow);
    frag.appendChild(cKids);
  });

  host.innerHTML = '';
  host.appendChild(frag);
}

render().catch((e) => {
  const host = $('toc-tree');
  if (host) host.innerHTML = '<div class="empty">目录加载失败：' + (e && e.message) + '</div>';
});
