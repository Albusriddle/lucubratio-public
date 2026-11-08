// 设备侧验收（需要真机/模拟器 + debug 包 + adb）
//
// 用法：
//   ADB=F:/Android/sdk/platform-tools/adb.exe SERIAL=<序列号> npm run verify:device
//   （默认包名 com.lucubratio.reader.dev —— debug 构建的 .dev 后缀）
//
// 检查项（对应 docs/ROADMAP.md 与 Step 3 / D2 验收）：
//   1. 应用在运行、CDP 可用
//   2. /courses/index.json 可访问且是合法 JSON（没有课程时 courses=[]）
//   3. 首页目录渲染正常（条目数 = manifest 页数）
//   4. 不存在的课程文件返回 404，且**不会**回落网络（服务端拦截生效）
//   5. 首页页面结构未被 /courses/ 处理器影响（零回归）

import { execFileSync } from 'node:child_process';

const ADB = process.env.ADB || 'adb';
const SERIAL = process.env.SERIAL || '';
const PKG = process.env.PKG || 'com.lucubratio.reader.dev';
const PORT = Number(process.env.CDP_PORT || 9222);

const fails = [];
const oks = [];
const ok = (m) => { oks.push(m); console.log('\x1b[32m✓\x1b[0m ' + m); };
const bad = (m) => { fails.push(m); console.log('\x1b[31m✗\x1b[0m ' + m); };

function adb(args) {
  return execFileSync(ADB, [...(SERIAL ? ['-s', SERIAL] : []), ...args], { encoding: 'utf8' }).trim();
}

// 1) 设备与应用
let pid = '';
try {
  pid = adb(['shell', 'pidof', PKG]);
} catch (e) {
  console.log('\x1b[31m找不到设备或应用未运行（先 adb connect / 安装 debug 包 / 打开 App）\x1b[0m');
  process.exit(1);
}
if (!pid) {
  console.log('\x1b[31m应用没有在运行（pidof 为空，先打开 App）\x1b[0m');
  process.exit(1);
}
ok(`应用进程 pid=${pid}`);

adb(['forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.log('\x1b[31m找不到 WebView 页面（debug 包才开调试）\x1b[0m');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params) => new Promise((res) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'EXC:' + (r.result.exceptionDetails.text || '');
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Page.navigate', { url: 'https://appassets.androidplatform.net/' });
await sleep(2500);

// 2) 注册表
const idxRaw = await ev(`fetch('/courses/index.json').then(r=>r.text()).catch(e=>'ERR:'+e.message)`);
let idx = null;
try { idx = JSON.parse(idxRaw); } catch { /* noop */ }
if (idx && Array.isArray(idx.courses)) ok(`/courses/index.json 可访问：${idx.courses.length} 门课`);
else bad(`/courses/index.json 异常：${String(idxRaw).slice(0, 120)}`);

// 3) 首页渲染
const items = await ev(`document.querySelectorAll('#list a').length`);
const manifestPages = await ev(`fetch('/manifest.json').then(r=>r.json()).then(m=>m.groups.reduce((n,g)=>n+(g.items||[]).length,0)).catch(()=>-1)`);
if (typeof items === 'number' && items === manifestPages) ok(`首页目录正常：${items} 条（与 manifest 一致）`);
else bad(`首页条目数 ${items} 与 manifest 页数 ${manifestPages} 不一致`);

// 4) 404 不回落网络
const st = await ev(`fetch('/courses/__nope__/x.html').then(r=>r.status).catch(e=>'ERR:'+e.message)`);
if (st === 404) ok('/courses/ 下不存在的文件返回 404（服务端拦截生效，未回落网络）');
else bad(`不存在的课程文件返回 ${st}（期望 404）`);

// 5) 内置页仍可打开
const html = await ev(`fetch('/content/os/01_demo_欢迎.html').then(r=>r.status).catch(()=>-1)`);
if (html === 200) ok('内置内容页仍可访问（/courses/ 处理器未影响 /）');
else bad(`内置内容页访问异常：${html}`);

ws.close();
adb(['forward', '--remove', `tcp:${PORT}`]);

console.log('');
if (fails.length) {
  console.log(`\x1b[31m设备验收失败：${fails.length} 项（通过 ${oks.length} 项）\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32m设备验收通过（${oks.length} 项）\x1b[0m`);
