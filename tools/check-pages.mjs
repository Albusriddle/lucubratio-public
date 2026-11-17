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
  try { // 收尾：端口可能已被移除/设备重启过，adb 会往 stderr 打印 "listener not found"，不影响结果
try {
  execFileSync(ADB, [...(SERIAL ? ['-s', SERIAL] : []), 'forward', '--remove', `tcp:${PORT}`], { stdio: 'ignore' });
} catch { /* 忽略 */ } } catch { /* ignore */ }
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
let galleryPages = 0;
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

  // PPT 入口已改为「可拖动悬浮球」：有索引的页面都必须有球（含纯文字期中页）。
  // 公开仓库的 demo 页没有 img/index.json → 不该有球，也不算失败。
  const g = await ev(`(async function () {
    const ready = window.__saPptReady || {};
    const ball = document.querySelector('.sa-pptball');
    if (!ready.index) return { skip: true };
    if (!ball) return { noBall: true };
    const r = ball.getBoundingClientRect();
    ball.click();
    await new Promise(r => setTimeout(r, 1200));
    const pnl = document.querySelector('.sa-pttg');
    const n = document.querySelectorAll('.sa-pttg-item').length;
    const open = !!(pnl && !pnl.hidden);      // 先判定，再关闭
    const closeBtn = document.querySelector('.sa-pttg-x');
    if (closeBtn) closeBtn.click();
    await new Promise(r => setTimeout(r, 300));
    return { open, n, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width) };
  })()`);

  if (!g) { bad++; console.log(`${RED('✗')} PPT 悬浮球：求值失败`); }
  else if (g.skip) { /* 没有索引（公开 demo）→ 跳过 */ }
  else if (g.noBall) { bad++; console.log(`${RED('✗')} PPT 悬浮球：本页有索引但没有球`); }
  else if (!g.open || !(g.n > 0)) { bad++; console.log(`${RED('✗')} PPT 侧栏：未打开或没有缩略图（n=${g.n}）`); }
  else {
    galleryPages++;
    if (galleryPages === 1) {
      console.log(`${GREEN('✓')} PPT 悬浮球：${g.w}px，点开 ${g.n} 页缩略图，关闭正常`);
    }
  }
}

/* ---------- 附加行为检查 1：抽屉章标题吸顶不能有缝 ---------- */
{
  const target = pages.find((u) => u.includes('/content/')) || pages[0];
  await send('Page.navigate', { url: 'https://appassets.androidplatform.net' + target });
  await sleep(WAIT);
  const d = await ev(`(async function () {
    const btn = document.querySelector('.sa-icon');
    if (!btn) return { skip: '没有抽屉按钮' };
    btn.click();
    await new Promise(r => setTimeout(r, 450));
    const sb = document.getElementById('sidebar');
    if (!sb) return { skip: '没有 #sidebar' };
    sb.scrollTop = Math.min(600, sb.scrollHeight);
    await new Promise(r => setTimeout(r, 400));
    const row = sb.querySelector('.sa-toc-row');
    if (!row) return { skip: '没有可吸顶的章标题' };
    const gap = Math.round(row.getBoundingClientRect().top - sb.getBoundingClientRect().top);
    const padTop = getComputedStyle(sb).paddingTop;
    btn.click();                       // 收起抽屉
    return { gap, padTop };
  })()`);
  if (!d || d.skip) {
    console.log(`${GRAY('·')} 抽屉吸顶：${d && d.skip ? d.skip : '未取到'}`);
  } else if (d.gap > 1) {
    bad++;
    console.log(`${RED('✗')} 抽屉吸顶：章标题与抽屉顶边有 ${d.gap}px 缝（padding-top=${d.padTop}）`);
  } else {
    console.log(`${GREEN('✓')} 抽屉吸顶：gap=${d.gap}px`);
  }
}

/* ---------- 附加行为检查 2：开屏只在冷启动 ---------- */
{
  // 1) 先加载一次首页（冷启动语义：若本会话还没加载过 /，这里会播开屏并写入 sa-booted）
  await send('Page.navigate', { url: 'https://appassets.androidplatform.net/' });
  let flag = null;
  for (let i = 0; i < 12; i++) {
    await sleep(350);
    const v = await ev(`(function () {
      try { return sessionStorage.getItem('sa-booted'); } catch (e) { return null; }
    })()`);
    if (typeof v === 'string') { flag = v; break; }
  }
  // 2) 再回首页：这次应该首帧就带 sa-no-splash，且 #sa-splash 已不存在
  await send('Page.navigate', { url: 'https://appassets.androidplatform.net/' });
  let cls = null, splash = null;
  for (let i = 0; i < 12; i++) {
    await sleep(350);
    const v = await ev(`(function () {
      try {
        return { cls: document.documentElement.className,
                 splash: !!document.getElementById('sa-splash'),
                 ready: document.readyState };
      } catch (e) { return null; }
    })()`);
    if (v && v.ready === 'complete') { cls = v.cls; splash = v.splash; break; }
  }
  const okSplash = flag === '1' && typeof cls === 'string' && /sa-no-splash/.test(cls) && splash === false;
  if (!okSplash) {
    bad++;
    console.log(`${RED('✗')} 开屏冷启动判定：flag=${flag} cls=${JSON.stringify(cls)} splash=${splash}`);
  } else {
    console.log(`${GREEN('✓')} 开屏冷启动判定：同会话回首页不再显示开屏（flag=1, sa-no-splash）`);
  }
}

ws.close();
adb(['forward', '--remove', `tcp:${PORT}`]);

console.log('');
if (bad) {
  console.log(RED(`运行时检查失败：${bad}/${pages.length} 页有异常`));
  process.exit(1);
}
if (galleryPages) console.log(GRAY(`  PPT 悬浮球：${galleryPages}/${pages.length} 页有索引并已挂载`));
console.log(GREEN(`运行时检查通过：${pages.length} 页均无异常`));
