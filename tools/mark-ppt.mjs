#!/usr/bin/env node
// 给已有课程页「机械预标」课件截图位置：
//   在该图页**首次被正文引用**的那一段之后，插入 <figure class="sa-ppt" data-ppt="NN"></figure>
//
// 为什么需要它：规范要求 producer 手写标记，但存量内容（9 门讲座 + 期中三页）是之前生成的。
// 机械预标保证「不漏图」，之后可人工/复核微调位置。
//
// 用法：
//   # 单门讲座页：按抽取报告的图页清单
//   node tools/mark-ppt.mjs --file .work/pages/05_vm1.html --report .work/vm1/report.json
//
//   # 指定页
//   node tools/mark-ppt.mjs --file .work/pages/05_vm1.html --pages 4,8,11
//
//   # 期中页：跨讲引用（03 p46 / 05 p74），标记写成 data-ppt="03:46"
//   node tools/mark-ppt.mjs --file .work/pages/10_期中核心串讲.html --cross
//
// 规则：
//   · 只标「正文里真的引用了该页」的位置（p42 / p042 / 课件 p42）
//   · 一页只标一次；已存在同号标记则跳过
//   · 找不到引用段落的页不标，计入 skipped（输出里会列出）
//   · --cross 只会标「已经渲染出图」的页（web/img/<deck>/pNNN.webp 存在）

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (n, d = '') => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const FILE = opt('--file');
const DRY = has('--dry');
const IMG_ROOT = opt('--img-root', 'web/img');

if (!FILE || !fs.existsSync(FILE)) {
  console.error('用法: node tools/mark-ppt.mjs --file <课程页.html> (--pages 4,8 | --report <report.json> | --cross) [--dry]');
  process.exit(2);
}

let html = fs.readFileSync(FILE, 'utf8');
const DECK_BY_LECTURE = {
  '01': 'intro', '02': 'vcpu1', '03': 'vcpu2', '04': 'vcpu3', '05': 'vm1',
  '06': 'vm2', '07': 'vm3', '08': 'vm4', '09': 'conc1',
};

/* ---------------- 期中页：跨讲引用 ---------------- */
if (has('--cross')) {
  const have = new Set([...html.matchAll(/data-ppt="(\d{2}:\d+)"|data-ppt="([^"]+)"/g)]
    .map((m) => m[1] || m[2])
    .filter((x) => x.includes(':')));
  const hits = [];
  // 扫描所有可能引用课件的块：段落、解析块、题目标题
  const blockRe = /<(p|blockquote|h3)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = blockRe.exec(html))) {
    const body = m[2];
    // 形如「（01 讲 p3、p8）」或「01 p42」：先抓讲次，再抓其后连续的 pNN 列表
    for (const r of body.matchAll(/(0[1-9])\s*讲?[^0-9p\n]{0,4}((?:p0*\d{1,3}[、,，\s]*)+)/g)) {
      const lec = r[1];
      const deck = DECK_BY_LECTURE[lec];
      if (!deck) continue;
      for (const pg of r[2].matchAll(/p0*(\d{1,3})/g)) {
        const pno = Number(pg[1]);
        const key = `${lec}:${pno}`;
        if (have.has(key)) continue;
        const rel = path.join(IMG_ROOT, deck, `p${String(pno).padStart(3, '0')}.webp`);
        if (!fs.existsSync(rel)) continue;      // 只标渲染过的图页
        hits.push({ key, at: m.index + m[0].length });
        have.add(key);
      }
    }
  }
  hits.sort((a, b) => b.at - a.at);          // 从后往前插，偏移不会乱
  for (const h of hits) {
    html = html.slice(0, h.at) + `\n<figure class="sa-ppt" data-ppt="${h.key}"></figure>` + html.slice(h.at);
  }
  if (!DRY) fs.writeFileSync(FILE, html, 'utf8');
  console.log(`${FILE}`);
  console.log(`  跨讲插入 ${hits.length} 个：${hits.map((h) => h.key).reverse().join(', ') || '—'}`);
  process.exit(0);
}

/* ---------------- 单门讲座页：同讲页码 ---------------- */
let pages = [];
if (opt('--pages')) pages = opt('--pages').split(',').map((x) => Number(x.trim())).filter(Boolean);
else if (opt('--report')) {
  const rep = JSON.parse(fs.readFileSync(opt('--report'), 'utf8'));
  pages = [...new Set([...(rep.empty_pages || []), ...(rep.low_text_pages || [])])];
}
if (!pages.length) {
  console.error('需要 --pages 或 --report（期中页请用 --cross）');
  process.exit(2);
}

const already = new Set([...html.matchAll(/data-ppt="(\d+)"/g)].map((m) => Number(m[1])));
const inserted = [];
const skipped = [];

for (const pno of pages.sort((a, b) => a - b)) {
  if (already.has(pno)) { skipped.push(`${pno}(已存在)`); continue; }
  const re = new RegExp(`\\bp0*${pno}\\b`);
  let hit = -1;
  const paraRe = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = paraRe.exec(html))) {
    if (re.test(m[1])) { hit = m.index + m[0].length; break; }   // 插在这一段之后
  }
  if (hit < 0) { skipped.push(`${pno}(正文未引用)`); continue; }
  html = html.slice(0, hit) + `\n<figure class="sa-ppt" data-ppt="${pno}"></figure>` + html.slice(hit);
  inserted.push(pno);
  already.add(pno);
}

if (!DRY) fs.writeFileSync(FILE, html, 'utf8');

console.log(`${FILE}`);
console.log(`  插入 ${inserted.length} 个：${inserted.join(',') || '—'}`);
if (skipped.length) console.log(`  跳过 ${skipped.length} 个：${skipped.join(', ')}`);
