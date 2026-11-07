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

let rewrittenFiles = 0;
for (const g of manifest.groups || []) {
  for (const it of g.items || []) {
    if (it.file && it.file.startsWith('/content/')) {
      it.file = PREFIX + it.file;
      rewrittenFiles++;
    }
  }
}
let rewrittenPages = 0;
for (const cid of Object.keys(search.pages || {})) {
  const p = search.pages[cid];
  if (p && typeof p.f === 'string' && p.f.startsWith('/content/')) {
    p.f = PREFIX + p.f;
    rewrittenPages++;
  }
}

/* ---------- 收集文件 ---------- */
const entries = [];
const push = (name, data) => entries.push({ name, data });

const contentDir = path.join(OUT, 'content');
const imgDir = path.join(OUT, 'img');

if (!fs.existsSync(contentDir)) {
  console.error('产物里没有 content/ 目录');
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
for (const { full, rel } of pageFiles) {
  let html = fs.readFileSync(full, 'utf8');
  // 只重写站内图片；/shell/ 不动（壳层由 App 内置）
  html = html.replace(/(src|href)="\/img\//g, (m, attr) => {
    rewrittenImgs++;
    return `${attr}="${PREFIX}/img/`;
  });
  push(rel, html);
}

if (fs.existsSync(imgDir)) {
  (function collectImgs(dir, base = 'img') {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = base + '/' + name;
      if (fs.statSync(full).isDirectory()) collectImgs(full, rel);
      else push(rel, fs.readFileSync(full));
    }
  })(imgDir);
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
const format = {
  format: 'lcr/1',
  id,
  title,
  version,
  appMin,
  builtAt: new Date().toISOString(),
  pages: pageCount,
  questions: manifest.questionCount || 0,
  bytes: 0, // 打完包回填
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
console.log('  路径重写:', `manifest ${rewrittenFiles} 项 · search ${rewrittenPages} 页 · 页面内图片引用 ${rewrittenImgs} 处`);
console.log('  content :', contentSha.slice(0, 16) + '…');
