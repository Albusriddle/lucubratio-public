// 课程打包器：把编译产物打成 .lcr（zip）课程包
//
// 用法：
//   node scripts/pack.mjs --id demo --title "示例课程" --version 0.1.0
//   node scripts/pack.mjs --id os --title "操作系统" --version 1.0.0 --out dist
//
// 产物：dist/<id>-<version>.lcr
//
// 做什么：
//   1) 读 android/app/src/main/assets/web 下的 manifest.json / search.json / content / img
//   2) 重写路径：/content/... → /courses/<id>/content/... ；/img/... → /courses/<id>/img/...
//      （/shell/... 保持不动 —— 壳层资源由 App 内置提供，同源）
//   3) 生成 format.json（含 sha256），zip 成 .lcr

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zipSync } from './lib/zip.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'android/app/src/main/assets/web');

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : def;
}

const id = arg('id');
const title = arg('title');
const version = arg('version');
const outDir = path.resolve(ROOT, arg('out', 'dist'));
const appMin = arg('appMin', '0.1.0');

if (!id || !title || !version) {
  console.error('用法: node scripts/pack.mjs --id <id> --title <标题> --version <x.y.z> [--out dist] [--appMin 0.1.0]');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
  console.error(`id 不合法：${id}（只允许小写字母/数字/连字符，≤64 字符）`);
  process.exit(1);
}
if (!fs.existsSync(path.join(OUT, 'manifest.json'))) {
  console.error(`找不到 ${path.relative(ROOT, OUT)}/manifest.json —— 请先跑 node scripts/build.mjs`);
  process.exit(1);
}

const PREFIX = `/courses/${id}`;

/* ---------- 读取并重写路径 ---------- */
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
const search = JSON.parse(fs.readFileSync(path.join(OUT, 'search.json'), 'utf8'));

// cid 命名空间：<包id>:<原cid>，让不同课程的同名页在同一个 IndexedDB 里互不干扰
const NS = (cid) => `${id}:${cid}`;
const hashByCid = new Map();          // 逐页内容指纹（用于 data-cver，避免与包 sha256 形成循环依赖）
let rewrittenFiles = 0;

for (const g of manifest.groups || []) {
  for (const it of g.items || []) {
    if (it.hash) hashByCid.set(it.id, it.hash);
    if (it.id) it.id = NS(it.id);
    if (it.file && it.file.startsWith('/content/')) {
      it.file = PREFIX + it.file;
      rewrittenFiles++;
    }
  }
}

let rewrittenPages = 0;
const newPages = {};
for (const cid of Object.keys(search.pages || {})) {
  const p = search.pages[cid] || {};
  if (typeof p.f === 'string' && p.f.startsWith('/content/')) {
    p.f = PREFIX + p.f;
    rewrittenPages++;
  }
  newPages[NS(cid)] = p;
}
search.pages = newPages;
for (const sec of search.sections || []) {
  if (sec.p) sec.p = NS(sec.p);
}

/* ---------- 收集文件 ---------- */
const entries = [];
const push = (name, data) => entries.push({ name, data });

const contentDir = path.join(OUT, 'content');
// 图片不再随 build 进 assets，直接从源目录取（web/img 是本地素材，gitignored）
const imgDir = path.join(ROOT, 'web/img');

if (!fs.existsSync(contentDir)) {
  console.error('产物里没有 content/ 目录——空构建（npm run build:empty）只能用来出「查看器-only」APK，不能打成课程包。');
  console.error('要打包请先执行常规构建：node scripts/build.mjs');
  process.exit(1);
}

function walk(dir, base = '') {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) walk(full, rel);
    else entries.push({ name: rel, data: fs.readFileSync(full) });
  }
}

// 页面：读出来做路径重写后再入包
const pageFiles = [];
(function collectPages(dir, base = '') {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) collectPages(full, rel);
    else if (name.endsWith('.html')) pageFiles.push({ full, rel: 'content/' + rel });
  }
})(contentDir);

let rewrittenImgs = 0;
let rewrittenAttrs = 0;
for (const { full, rel } of pageFiles) {
  let html = fs.readFileSync(full, 'utf8');

  // 二次打包保护：属性里已经有命名空间前缀，说明这份产物已经是课程包
  const cidRaw = (/data-cid="([^"]*)"/.exec(html) || [])[1] || '';
  if (cidRaw.includes(':')) {
    console.error(`✗ ${rel} 的 data-cid="${cidRaw}" 已含命名空间前缀，拒绝二次打包`);
    process.exit(1);
  }

  // 1) 站内图片；/shell/ 不动（壳层由 App 内置）
  html = html.replace(/(src|href)="\/img\//g, (m, attr) => {
    rewrittenImgs++;
    return `${attr}="${PREFIX}/img/`;
  });

  // 2) 5 个 data-* 属性：它们是运行时唯一真相，必须与 manifest 保持一致
  html = html.replace(/data-cid="([^"]+)"/g, (m, v) => { rewrittenAttrs++; return `data-cid="${NS(v)}"`; });
  html = html.replace(/data-file="([^"]+)"/g, (m, v) => {
    if (!v.startsWith('/content/')) return m;
    rewrittenAttrs++;
    return `data-file="${PREFIX}${v}"`;
  });
  html = html.replace(/data-qid="([^"]+)"/g, (m, v) => { rewrittenAttrs++; return `data-qid="${NS(v)}"`; });
  html = html.replace(/data-ck="([^"]+)"/g, (m, v) => { rewrittenAttrs++; return `data-ck="${NS(v)}"`; });
  const pageHash = hashByCid.get(cidRaw) || '0';
  html = html.replace(/data-cver="([^"]*)"/g, () => {
    rewrittenAttrs++;
    return `data-cver="${id}@${version}#${pageHash}"`;
  });

  push(rel, html);
}

/* ---------- 图片：只打包「被页面引用」的那部分 ----------
   为什么只按引用：网页里没引用的图不该进包——2 页 demo 曾因此带上 224 张课件截图
   （5.47 MB → 10 KB），而这些图属于课程内容衍生物，容易在分享包时被带出去。
   注：build 现在也只把「被引用」的图回填进产物，本脚本直接从源目录 web/img 取，两边口径一致。 */
const referencedImgs = new Set();
for (const { full } of pageFiles) {
  const html = fs.readFileSync(full, 'utf8');
  for (const m of html.matchAll(/(?:src|href)="\/img\/([^"?#]+)/g)) {
    referencedImgs.add(decodeURIComponent(m[1]));
  }
}

let imgPacked = 0;
let imgSkipped = 0;
if (fs.existsSync(imgDir)) {
  (function collectImgs(dir, base = '') {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = base ? base + '/' + name : name;
      if (fs.statSync(full).isDirectory()) { collectImgs(full, rel); continue; }
      if (!referencedImgs.has(rel)) { imgSkipped++; continue; }
      push('img/' + rel, fs.readFileSync(full));
      imgPacked++;
    }
  })(imgDir);
}

// 引用了但产物里没有的图片：直接失败（否则包会在阅读时裂图）
const missingImgs = [...referencedImgs].filter((rel) => !fs.existsSync(path.join(imgDir, rel)));
if (missingImgs.length) {
  console.error(`✗ 页面引用了 ${missingImgs.length} 张产物里不存在的图片：${missingImgs.slice(0, 3).join(', ')}`);
  console.error('  提示：先跑 node tools/ppt-shots.mjs 生成，或修正页面里的 /img/ 路径。');
  process.exit(1);
}

push('manifest.json', JSON.stringify(manifest));
push('search.json', JSON.stringify(search));

/* ---------- 内容摘要（对包内文件排序后哈希，保证可复现） ---------- */
const digest = crypto.createHash('sha256');
const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const pageCount = pageFiles.length;
for (const e of sorted) {
  digest.update(e.name);
  digest.update('\0');
  digest.update(Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8'));
  digest.update('\0');
}
const contentSha = digest.digest('hex');

/* ---------- format.json ---------- */
// bytes = 除 format.json 之外所有条目解压后的字节和（课程库显示体积、配额检查都用它）
const realBytes = entries.reduce(
  (sum, e) => sum + (Buffer.isBuffer(e.data) ? e.data.length : Buffer.byteLength(String(e.data), 'utf8')),
  0
);

const format = {
  format: 'lcr/1',
  id,
  title,
  version,
  appMin,
  builtAt: new Date().toISOString(),
  pages: pageCount,
  questions: manifest.questionCount || 0,
  bytes: realBytes,
  sha256: contentSha,
};
push('format.json', JSON.stringify(format, null, 2));

/* ---------- 打包 ---------- */
fs.mkdirSync(outDir, { recursive: true });
const zipBuf = zipSync(entries);
const file = path.join(outDir, `${id}-${version}.lcr`);
fs.writeFileSync(file, zipBuf);

console.log('✓ 打包完成');
console.log('  文件    :', path.relative(ROOT, file));
console.log('  大小    :', (zipBuf.length / 1024).toFixed(1), 'KB');
console.log('  条目    :', entries.length, `（页面 ${pageCount}）`);
console.log('  问答    :', format.questions, '个自评单元');
console.log('  体积    :', (realBytes / 1024).toFixed(1), 'KB（format.bytes）');
console.log('  路径重写:', `manifest ${rewrittenFiles} 项 · search ${rewrittenPages} 页 · data-* ${rewrittenAttrs} 个 · 图片引用改写 ${rewrittenImgs} 处`);

console.log(`  图片收集: 已引用 ${imgPacked} 张 / 跳过未引用 ${imgSkipped} 张`);
console.log('  content :', contentSha.slice(0, 16) + '…');
