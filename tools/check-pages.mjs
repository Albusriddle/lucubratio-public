// 运行时页面检查：把每个壳页面在真机/模拟器里打开一遍，抓 JS 异常与控制台错误
//
// 为什么需要（静态检查补不了的那类 bug）：
//   守卫写成「有 #a 就继续」，函数体内又用了 #b；#b 缺失时抛 TypeError，
//   同一函数/启动流程里后续代码全部不执行 —— 例如「我的页备份按钮失效」。
//   这类问题只有真的跑一遍页面才能确定性发现。
//
// 用法：
//   ADB=F:/Android/sdk/platform-tools/adb.exe SERIAL=127.0.0.1:16384 npm run check:pages
//   node tools/check-pages.mjs --pkg com.lucubratio.reader.dev --serial 127.0.0.1:16384
//
// 退出码：0 = 全部页面无异常；1 = 有页面报错；2 = 环境问题（无设备/无调试端口）

import { execFileSync } from 'node:child_process';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const ADB = process.env.ADB || arg('adb', 'adb');
const SERIAL = process.env.SERIAL || arg('serial', '');
const PKG = process.env.PKG || arg('pkg', 'com.lucubratio.reader.dev');
const PORT = Number(arg('port', '9224'));
// 任何退出路径（含 process.exit(2)）都要清掉 adb forward，否则端口残留、
// 下次可能连到旧 target。
let forwardSet = false;
process.on('exit', () => {
  if (!forwardSet) return;
  try { adb(['forward', '--remove', `tcp:${PORT}`]); } catch { /* ignore */ }
});
const WAIT = Number(arg('wait', '2500'));

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const GRAY = (s) => `\x1b[2m${s}\x1b[0m`;

function adb(args) {
  return execFileSync(ADB, [...(SERIAL ? ['-s', SERIAL] : []), ...args], { encoding: 'utf8' }).trim();
}

let pid = '';
try {
  pid = adb(['shell', 'pidof', PKG]);
} catch {
  console.error(RED(`找不到应用进程：${PKG}（先安装 debug 包并打开一次）`));
  process.exit(2);
}
if (!pid) {
  console.error(RED(`应用没在运行：${PKG}`));
  process.exit(2);
}

adb(['forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
  forwardSet = true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets = [];
try {
  targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
} catch {
  console.error(RED(`连不上调试端口 ${PORT}（debug 包才开 WebView 调试）`));
  process.exit(2);
}
const target = targets.find((t) => t.type === 'page');
if (!target) {
  console.error(RED('找不到 WebView 页面目标'));
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pend = new Map();
let errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push('未捕获异常：' + String((d.exception && d.exception.description) || d.text || '').split('\n')[0]);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('console.error：' + m.params.args.map((a) => a.value || a.description || '').join(' ').split('\n')[0]);
  }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));

const send = (method, params) => new Promise((res) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.exceptionDetails ? null : r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 900, deviceScaleFactor: 2, mobile: true });

/** 页面清单：固定壳页 + manifest 里的每个内容页 */
async function pageList() {
  const fixed = ['/', '/toc.html', '/me.html', '/search.html', '/review.html', '/stats.html', '/diagnostics.html'];
  const manifest = await ev("fetch('/manifest.json').then(r=>r.json()).then(m=>JSON.stringify(m)).catch(()=>'')");
  const pages = [...fixed];
  if (manifest) {
    try {
      for (const g of JSON.parse(manifest).groups || []) {
        for (const it of g.items || []) pages.push(it.file);
      }
    } catch { /* ignore */ }
  }
  return pages;
}

const pages = await pageList();
console.log(`${GRAY('包名：')}${PKG}${SERIAL ? GRAY('  设备：') + SERIAL : ''}`);
console.log(`${GRAY('待检页面：')}${pages.length}\n`);

let bad = 0;
for (const url of pages) {
  errors = [];
  await send('Page.navigate', { url: 'https://appassets.androidplatform.net' + url });
  await sleep(WAIT);
  // 页面里的未处理 Promise 拒绝不会走 exceptionThrown，这里补一次显式探测
  const alive = await ev('document.readyState');
  const label = url.length > 48 ? url.slice(0, 48) + '…' : url;
  if (errors.length) {
    bad++;
    console.log(`${RED('✗')} ${label}`);
    for (const e of errors.slice(0, 3)) console.log('   · ' + e.slice(0, 160));
  } else if (!alive) {
    bad++;
    console.log(`${RED('✗')} ${label}  ${GRAY('页面无响应')}`);
  } else {
    console.log(`${GREEN('✓')} ${label}`);
  }
}

ws.close();
adb(['forward', '--remove', `tcp:${PORT}`]);

console.log('');
if (bad) {
  console.log(RED(`运行时检查失败：${bad}/${pages.length} 页有异常`));
  process.exit(1);
}
console.log(GREEN(`运行时检查通过：${pages.length} 页均无异常`));
