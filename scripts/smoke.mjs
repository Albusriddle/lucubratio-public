// 设备冒烟测试（需要正在运行的 debug 包 + MuMu/真机 + adb）
// 用法：
//   npm run smoke
//   ADB=/path/to/adb SERIAL=127.0.0.1:16384 npm run smoke
//
// 它做的是「真实 WebView 里的数据层回归」：写入→读回→导出结构→拒绝非法备份
// →FSRS 排期→重复评分幂等→孤儿卡对账→检索索引→统计结构。
// CI 里没有设备，所以这个脚本只在本机跑；CI 只跑 scripts/verify.mjs 与 scripts/test.mjs。
import { execFileSync } from 'node:child_process';

const ADB = process.env.ADB || 'adb';
const SERIAL = process.env.SERIAL || '127.0.0.1:16384';
// debug 构建带 .dev 后缀（见 android/app/build.gradle），与真机上的正式版共存
const PKG = process.env.PKG || 'com.lucubratio.reader.dev';
const PORT = Number(process.env.CDP_PORT || 9222);

const fails = [];
const oks = [];
const ok = (m) => { oks.push(m); console.log('\x1b[32m✓\x1b[0m ' + m); };
const bad = (m) => { fails.push(m); console.log('\x1b[31m✗\x1b[0m ' + m); };

function adb(args) {
  return execFileSync(ADB, ['-s', SERIAL, ...args], { encoding: 'utf8' }).trim();
}

// ---------- 1. 建立 CDP 通道 ----------
let pid;
try {
  pid = adb(['shell', 'pidof', PKG]);
} catch (e) {
  console.log('\x1b[31m找不到设备或应用未运行，请先 adb connect + 启动 App\x1b[0m');
  process.exit(1);
}
if (!pid) {
  console.log('\x1b[31m应用没有在运行（pidof 为空）\x1b[0m');
  process.exit(1);
}
ok(`应用进程 pid=${pid}`);

adb(['forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets(retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await r.json();
      const page = list.find((x) => x.type === 'page' && x.url.startsWith('https://appassets.androidplatform.net'));
      if (page) return page;
    } catch (e) { /* retry */ }
    await sleep(500);
  }
  return null;
}

const page = await targets();
if (!page) {
  console.log('\x1b[31mCDP 连不上（debug 包才会开 WebView 调试）\x1b[0m');
  process.exit(1);
}
ok('CDP 已连接：' + page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

const send = (method, params) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error((d.exception && d.exception.description) || d.text);
  }
  return r.result.result.value;
}

const navigate = async (path) => {
  await send('Page.navigate', { url: 'https://appassets.androidplatform.net' + path });
  await sleep(2200);
};

// 删除所有 __smoke* 测试数据（开始与结束各清一次，防止上次中断留下脏数据）
const PURGE = `(async()=>{
  const d = await import('/shell/db.js');
  const db = await d.openDB();
  await new Promise(function(res, rej){
    const tx = db.transaction(['cards','reviews','attempts'], 'readwrite');
    ['cards','reviews','attempts'].forEach(function(name){
      const req = tx.objectStore(name).openCursor();
      req.onsuccess = function(){
        const cur = req.result;
        if (!cur) return;
        const v = cur.value || {};
        if (String(v.qid || '').indexOf('__smoke') === 0) cur.delete();
        cur.continue();
      };
    });
    tx.oncomplete = res;
    tx.onerror = function(){ rej(tx.error); };
  });
  await d.del('progress','__smoke__');
  return 'ok';
})()`;

// ---------- 2. 首页 + manifest ----------
await navigate('/');
const home = JSON.parse(await evalJs(`(async()=>{
  const r = await fetch('/manifest.json');
  const m = await r.json();
  return JSON.stringify({ok: r.ok, pages: m.groups.reduce((n,g)=>n+g.items.length,0), ver: m.appVersion, ch: m.contentHash});
})()`));
if (home.ok && home.pages > 0) ok(`首页 manifest 正常：${home.pages} 页，v${home.ver}，内容 ${home.ch}`);
else bad('manifest 异常');

await evalJs(PURGE);
ok('测试数据已预清理');

// ---------- 3. 数据层 ----------
const kind = await evalJs(`(async()=>{const s=await import('/shell/store.js'); return s.info().kind;})()`);
if (kind === 'idb') ok('存储后端：IndexedDB');
else bad('存储后端降级为 ' + kind + '（期望 idb）');

const roundtrip = JSON.parse(await evalJs(`(async()=>{
  const s = await import('/shell/store.js');
  await s.saveProgress({cid:'__smoke__', file:'/__smoke__', title:'冒烟测试', scrollTop: 1234, pct: 42, ratio: 0.5});
  const p = await s.loadProgress('__smoke__');
  return JSON.stringify({pct: p && p.pct, top: p && p.scrollTop});
})()`));
if (roundtrip.pct === 42 && roundtrip.top === 1234) ok('进度写入/读回一致（pct=42, top=1234）');
else bad('进度往返不一致：' + JSON.stringify(roundtrip));

const snap = JSON.parse(await evalJs(`(async()=>{
  const s = await import('/shell/store.js');
  const snap = await s.exportSnapshot();
  const db = await import('/shell/db.js');
  return JSON.stringify({format: snap.format, schema: snap.schemaVersion, dbVersion: db.DB_VERSION, hasData: !!snap.data.progress, counts: snap.counts.progress});
})()`));
// 与页面内 DB_VERSION 比对（不再硬编码 1），将来升版不会误报
if (snap.format === 'lucubratio-backup' && snap.schema === snap.dbVersion && snap.hasData) ok(`导出快照结构正确（schema=${snap.schema}，progress=${snap.counts}）`);
else bad('导出快照结构异常：' + JSON.stringify(snap));

const reject = await evalJs(`(async()=>{
  const s = await import('/shell/store.js');
  try { await s.importSnapshot({foo:1}); return 'ACCEPTED'; }
  catch(e){ return 'REJECTED'; }
})()`);
if (reject === 'REJECTED') ok('非法备份被拒绝（format 不匹配）');
else bad('非法备份竟然被接受');

const badRows = await evalJs(`(async()=>{
  const s = await import('/shell/store.js');
  try {
    await s.importSnapshot({format:'unknown-backup', schemaVersion:1, data:{cards:[{foo:1}]}});
    return 'ACCEPTED';
  } catch(e){ return 'REJECTED:' + e.message.slice(0, 18); }
})()`);
if (String(badRows).indexOf('REJECTED') === 0) ok('主键缺失的备份被整单拒绝（' + badRows + '）');
else bad('主键缺失的备份未被拦截');

// ---------- 3.5 FSRS 调度 ----------
const fsrs = JSON.parse(await evalJs(`(async()=>{
  const s = await import('/shell/store.js');
  const now = Date.now();
  const before = await s.stats();
  const c1 = await s.assess({qid:'__smoke_q1', cid:'__smoke__', file:'/x', anchor:'a', text:'冒烟测试题', rating:3, source:'page'});
  const c2 = await s.assess({qid:'__smoke_q1', cid:'__smoke__', file:'/x', anchor:'a', text:'冒烟测试题', rating:1, source:'review'});
  const after = await s.stats();
  const due = await s.dueCards();
  return JSON.stringify({
    firstDelta: c1.due - now,
    reps: c2.reps, lapses: c2.lapses, state: c2.state,
    dueHasQ: due.some(function(c){return c.qid==='__smoke_q1';}),
    cardsAdded: after.cards - before.cards,
    reviewsAdded: after.reviews - before.reviews,
    attemptsAdded: after.attempts - before.attempts
  });
})()`));

if (fsrs.firstDelta > 0) ok(`首次评分已排出下次时间（+${Math.round(fsrs.firstDelta / 60000)} 分钟）`);
else bad('首次评分后 due 不在未来：' + fsrs.firstDelta);

if (fsrs.reps === 2 && fsrs.cardsAdded === 1 && fsrs.reviewsAdded === 2 && fsrs.attemptsAdded === 2) {
  ok(`卡片/日志/流水写入正确（reps=${fsrs.reps}, reviews+${fsrs.reviewsAdded}, attempts+${fsrs.attemptsAdded}）`);
} else {
  bad('计数不符：' + JSON.stringify(fsrs));
}

if (fsrs.dueHasQ === false) ok('未到期卡片不会进入今日队列');
else bad('刚评分的卡片不应立即出现在到期队列');

// ---------- 3.6 同日改评分是「修改」而不是「又复习一次」 ----------
const rerated = JSON.parse(await evalJs(`(async()=>{
  const s = await import('/shell/store.js');
  const d = await import('/shell/db.js');
  await s.assess({qid:'__smoke_q2', cid:'__smoke__', file:'/x', anchor:'a', text:'改评分', rating:1, source:'page'});
  const c2 = await s.assess({qid:'__smoke_q2', cid:'__smoke__', file:'/x', anchor:'a', text:'改评分', rating:3, source:'page'});
  const revs = await d.getAllByIndex('reviews','qid','__smoke_q2');
  const atts = await d.getAllByIndex('attempts','qid','__smoke_q2');
  return JSON.stringify({reps:c2.reps, reviews:revs.length, attempts:atts.length, rating:revs[0] && revs[0].rating});
})()`));

if (rerated.reps === 1 && rerated.reviews === 1 && rerated.attempts === 1 && rerated.rating === 3) {
  ok(`同日改评分已覆盖（reps=${rerated.reps}, reviews=${rerated.reviews}, rating=${rerated.rating}）`);
} else {
  bad('同日改评分没有覆盖而是叠加：' + JSON.stringify(rerated));
}

// ---------- 3.7 内容版本对账 / 孤儿卡 ----------
const orphan = JSON.parse(await evalJs(`(async()=>{
  const s = await import('/shell/store.js');
  const d = await import('/shell/db.js');
  const m = await (await fetch('/manifest.json')).json();
  await d.put('cards', {qid:'__smoke_q3', cid:'__smoke__', due: Date.now()-1000, state:2, reps:1, cver:'OLDHASH'});
  const r = await s.reconcileContent(m.contentHash);
  const oc = await s.orphanCount();
  const due1 = (await s.dueCards()).some(function(c){return c.qid==='__smoke_q3';});
  const re = await s.rearmOrphans();
  const due2 = (await s.dueCards()).some(function(c){return c.qid==='__smoke_q3';});
  return JSON.stringify({orphaned: r.orphaned, orphanCount: oc, inDueBefore: due1, rearmed: re, inDueAfter: due2});
})()`));

if (orphan.orphaned >= 1 && orphan.orphanCount >= 1 && orphan.inDueBefore === false && orphan.inDueAfter === true) {
  ok(`孤儿卡对账生效（orphaned=${orphan.orphaned}，复核前不进队列，重新学习后进队列）`);
} else {
  bad('孤儿卡对账异常：' + JSON.stringify(orphan));
}

// ---------- 3.8 搜索与统计 ----------
const search = JSON.parse(await evalJs(`(async()=>{
  const r = await fetch('/search.json');
  const j = await r.json();
  const hits = j.sections.filter(function(s){ return (s.h+' '+s.x).toLowerCase().indexOf('fork') >= 0; }).length;
  return JSON.stringify({ok:r.ok, sections:j.sections.length, pages:Object.keys(j.pages||{}).length, forkHits:hits});
})()`));
if (search.ok && search.sections > 50 && search.forkHits > 0) {
  ok(`检索索引可用（${search.sections} 节 / ${search.pages} 页，'fork' 命中 ${search.forkHits}）`);
} else {
  bad('检索索引异常：' + JSON.stringify(search));
}

const st = JSON.parse(await evalJs(`(async()=>{
  const s = await import('/shell/store.js');
  const d = await s.statsDetail(84);
  return JSON.stringify({days:d.days.length, states:d.cardStates.length, streak:d.streak, reviews:d.reviewTotal, orphan:d.orphan});
})()`));
if (st.days === 84 && st.states === 4) ok(`统计明细可用（84 天 / 4 种状态 / 复习 ${st.reviews} 次 / 孤儿 ${st.orphan}）`);
else bad('统计明细异常：' + JSON.stringify(st));

// ---------- 3.9 主题与字号（P2） ----------
const theme = JSON.parse(await evalJs(`(async()=>{
  const t = await import('/shell/theme.js');
  t.setTheme('dark');
  t.setFont('19');
  const root = document.documentElement;
  const out = {
    darkClass: root.classList.contains('sa-dark'),
    dataTheme: root.getAttribute('data-theme'),
    fs: root.style.getPropertyValue('--sa-fs'),
    stored: (localStorage.getItem('sa:theme') || '') + '/' + (localStorage.getItem('sa:fs') || '')
  };
  t.setTheme('auto');
  t.setFont('16');
  return JSON.stringify(out);
})()`));
if (theme.darkClass && theme.dataTheme === 'dark' && theme.fs === '19px' && theme.stored === 'dark/19') {
  ok(`主题/字号可切换并持久化（data-theme=${theme.dataTheme}, --sa-fs=${theme.fs}）`);
} else {
  bad('主题/字号异常：' + JSON.stringify(theme));
}

// ---------- 4. 清理 ----------
await evalJs(PURGE);
ok('测试数据已清理');

// ---------- 汇总 ----------
ws.close();
console.log('');
if (fails.length) {
  console.log(`\x1b[31m冒烟测试失败：${fails.length} 项\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32m冒烟测试通过（${oks.length} 项）\x1b[0m`);
