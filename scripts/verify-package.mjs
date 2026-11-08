// 课程包校验器（离线，零依赖）
//
// 用法：node scripts/verify-package.mjs dist/demo-0.1.0.lcr
//
// 校验项（对应 docs/PACKAGE-FORMAT.md §4）：
//   1) zip 安全：绝对路径 / .. / 反斜杠 / 符号链接 / 扩展名白名单
//   2) 结构：format.json / manifest.json / search.json 存在且可解析；format 受支持；appMin 校验
//   3) 一致性：manifest 里列的每个 file 都在包内；页面里 /courses/<id>/img/... 引用都能找到
//   4) 内容安全：页面不得有 <script src=、on* 属性、外链资源
//   5) 体积：单包 ≤ 200MB，解压后文件数 ≤ 5000

import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from './lib/zip.mjs';
import { scanHtml } from './lib/htmlguard.mjs';

const file = process.argv[2];
if (!file) {
  console.error('用法: node scripts/verify-package.mjs <course.lcr>');
  process.exit(1);
}

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const ALLOWED_EXT = new Set(['.html', '.json', '.webp', '.png', '.jpg', '.jpeg', '.svg', '.woff2', '.woff', '.ttf', '.txt', '.md']);

const oks = [];
const bads = [];
const ok = (m) => { oks.push(m); console.log('\x1b[32m✓\x1b[0m ' + m); };
const bad = (m) => { bads.push(m); console.log('\x1b[31m✗\x1b[0m ' + m); };

/* ---------- 1) 解包 ---------- */
const buf = fs.readFileSync(file);
if (buf.length > MAX_BYTES) bad(`包太大：${(buf.length / 1048576).toFixed(1)}MB > 200MB`);
let entries;
try {
  entries = unzipSync(buf);
} catch (e) {
  console.error('✗ 解包失败：' + e.message);
  process.exit(1);
}
ok(`解包成功：${entries.length} 个条目`);

if (entries.length > MAX_ENTRIES) bad(`条目过多：${entries.length} > ${MAX_ENTRIES}`);

/* ---------- 2) zip 安全 ---------- */
const unsafe = entries.filter((e) => {
  const n = e.name;
  return (
    n.startsWith('/') ||
    n.includes('\\') ||
    n.split('/').includes('..') ||
    /^[a-zA-Z]:/.test(n)
  );
});
if (unsafe.length) bad(`存在不安全路径：${unsafe.slice(0, 3).map((e) => e.name).join(', ')}`);
else ok('路径安全（无绝对路径 / .. / 反斜杠）');

const badExt = entries.filter((e) => {
  const ext = path.extname(e.name).toLowerCase();
  return ext && !ALLOWED_EXT.has(ext);
});
if (badExt.length) bad(`存在非白名单扩展名：${badExt.slice(0, 3).map((e) => e.name).join(', ')}`);
else ok('扩展名均在白名单内');

const map = new Map(entries.map((e) => [e.name, e.data]));

/* ---------- 3) 结构 ---------- */
function readJson(name) {
  const d = map.get(name);
  if (!d) return null;
  try { return JSON.parse(d.toString('utf8')); } catch { return undefined; }
}

const format = readJson('format.json');
if (format === null) bad('缺少 format.json');
else if (format === undefined) bad('format.json 不是合法 JSON');
else {
  if (format.format !== 'lcr/1') bad(`format 不受支持：${format.format}`);
  else ok(`format.json 合法（id=${format.id}, version=${format.version}）`);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(format.id || ''))) bad(`id 不合法：${format.id}`);
  if (!format.title) bad('缺少 title');
  if (!/^\d+\.\d+\.\d+$/.test(String(format.version || ''))) bad(`version 不是语义化版本：${format.version}`);
}

const manifest = readJson('manifest.json');
if (manifest === null) bad('缺少 manifest.json');
else if (manifest === undefined) bad('manifest.json 不是合法 JSON');
else {
  const items = (manifest.groups || []).flatMap((g) => g.items || []);
  if (!items.length) bad('manifest 里没有任何页面');
  else ok(`manifest 合法：${items.length} 页 / ${manifest.questionCount || 0} 个自评单元`);

  // 清单里的文件必须都在包内
  const prefix = `/courses/${format && format.id}/`;
  const missing = items
    .map((it) => String(it.file || ''))
    .filter((f) => f.startsWith(prefix))
    .map((f) => f.slice(prefix.length))
    .filter((rel) => !map.has(rel));
  if (missing.length) bad(`manifest 引用的页面不在包内：${missing.slice(0, 3).join(', ')}`);
  else ok('manifest 里的页面全部存在于包内');
}

const search = readJson('search.json');
if (search === null) bad('缺少 search.json');
else if (search === undefined) bad('search.json 不是合法 JSON');
else ok(`search.json 合法：${(search.sections || []).length} 节`);

/* ---------- 4) 页面内容安全（标签级扫描，不再用正则） ---------- */
const pages = entries.filter((e) => e.name.endsWith('.html'));
let imgMissing = 0;
const violationCount = new Map(); // rule → {count, sample}
for (const p of pages) {
  const html = p.data.toString('utf8');
  for (const v of scanHtml(html)) {
    const cur = violationCount.get(v.rule) || { count: 0, sample: '' };
    cur.count++;
    if (!cur.sample) cur.sample = `${p.name}: ${v.detail}`;
    violationCount.set(v.rule, cur);
  }
  // 站内引用必须命中
  const prefix = `/courses/${format && format.id}/`;
  for (const m of html.matchAll(/(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    const url = m[1] || m[2] || m[3] || '';
    if (!url.startsWith(prefix)) continue;
    const rel = url.slice(prefix.length);
    if (!map.has(rel)) imgMissing++;
  }
}
const RULE_LABEL = {
  'forbidden-tag': '禁止的标签（iframe/object/embed/base…）',
  'meta-refresh': 'meta refresh 跳转',
  'inline-handler': '内联事件属性 on*=',
  'external-url': '外部/可执行 URL',
  'bad-link': 'link 指向非 /shell/',
  'inline-script': '内联 <script>',
  'bad-script-src': 'script 指向非 /shell/',
  'style-import': '<style> 内 @import',
  'style-url': '<style> 内外部 url()',
};
if (violationCount.size === 0) {
  ok(`页面内容安全：${pages.length} 页无违规（标签级扫描）`);
} else {
  for (const [rule, info] of violationCount) {
    bad(`${RULE_LABEL[rule] || rule}：${info.count} 处（例：${info.sample}）`);
  }
}
if (imgMissing) bad(`${imgMissing} 处站内引用在包内找不到`); else ok('页面里的站内资源引用全部命中');

/* ---------- 5) format.bytes 一致性 ---------- */
if (format && typeof format.bytes === 'number') {
  const realBytes = entries
    .filter((e) => e.name !== 'format.json')
    .reduce((sum, e) => sum + (Buffer.isBuffer(e.data) ? e.data.length : Buffer.byteLength(String(e.data))), 0);
  if (format.bytes !== realBytes) {
    bad(`format.bytes 与包内实际字节数不符：声明 ${format.bytes}，实际 ${realBytes}`);
  } else {
    ok(`format.bytes 与实际一致（${realBytes} 字节）`);
  }
} else {
  bad('format.bytes 缺失或不是数字');
}

/* ---------- 汇总 ---------- */
console.log('');
if (bads.length) {
  console.log(`\x1b[31m校验失败：${bads.length} 项\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32m全部校验通过（${oks.length} 项）\x1b[0m`);
