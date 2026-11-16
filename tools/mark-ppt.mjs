#!/usr/bin/env node
// 给已有课程页「机械预标」课件截图位置：在该图页**首次被正文引用**的那一段之后，插入
//   <figure class="slide-fig"><img src="/img/<deck>/pNNN.webp" …><figcaption>课件 pNN 原图</figcaption></figure>
// （唯一写法见 AGENTS 约定 1.5；deck 名从 tools/decks.json 查，不再硬编码）
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
const DECKS_JSON = opt('--decks', 'tools/decks.json');
const DECK_BY_LECTURE = (() => {
  const fallback = {
    '01': 'intro', '02': 'vcpu-1', '03': 'vcpu-2', '04': 'vcpu-3', '05': 'vm-1',
    '06': 'vm-2', '07': 'vm-3', '08': 'vm-4', '09': 'conc-1', '10': 'conc-2', '11': 'conc-3',
  };
  try {
    const raw = JSON.parse(fs.readFileSync(DECKS_JSON, 'utf8'));
    const out = {};
    for (const [no, v] of Object.entries(raw)) if (v && v.deck) out[no] = v.deck;
    return Object.keys(out).length ? out : fallback;
  } catch (e) {
    console.log(`  · 读不到 ${DECKS_JSON}，用内置 11 讲映射`);
    return fallback;
  }
})();

/** 生成 slide-fig 片段（唯一写法；带 alt 与 figcaption） */
function slideFig(deck, pno) {
  const f = `p${String(pno).padStart(3, '0')}.webp`;
  return `\n<figure class="slide-fig">\n` +
    `  <img src="/img/${deck}/${f}" alt="课件 p${pno} 原图" loading="lazy">\n` +
    `  <figcaption>课件 p${pno} 原图</figcaption>\n` +
    `</figure>`;
}

/** 该页是否已经有图（新版 slide-fig 或旧版 data-ppt 都算） */
function hasFigure(html, deck, pno) {
  const f = `p${String(pno).padStart(3, '0')}.webp`;
  if (html.includes(`/img/${deck}/${f}`)) return true;
  return new RegExp(`data-ppt="(?:\\d{2}:)?${pno}"`).test(html);
}

/* ---------------- 期中页：跨讲引用 ---------------- */
if (has('--cross')) {
  const have = new Set();   // 已存在的跨讲引用（用 deck/page 组合判断，见 hasFigure）
  const hits = [];
  const unknownLectures = new Set();
  // 扫描所有可能引用课件的块：段落、解析块、题目标题
  const blockRe = /<(p|blockquote|h3)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = blockRe.exec(html))) {
    const body = m[2];
    // 形如「（01 讲 p3、p8）」或「01 p42」：先抓讲次，再抓其后连续的 pNN 列表
    for (const r of body.matchAll(/(0[1-9])\s*讲?[^0-9p\n]{0,4}((?:p0*\d{1,3}[、,，\s]*)+)/g)) {
      const lec = r[1];
      const deck = DECK_BY_LECTURE[lec];
      if (!deck) {
        if (!unknownLectures.has(lec)) {
          unknownLectures.add(lec);
          console.log(`  ! 讲次 ${lec} 不在 ${DECKS_JSON} 里，已跳过（补一条映射即可）`);
        }
        continue;
      }
      for (const pg of r[2].matchAll(/p0*(\d{1,3})/g)) {
        const pno = Number(pg[1]);
        const key = `${lec}:${pno}`;
        if (have.has(key)) continue;
        const rel = path.join(IMG_ROOT, deck, `p${String(pno).padStart(3, '0')}.webp`);
        if (!fs.existsSync(rel)) continue;      // 只标渲染过的图页
        if (hasFigure(html, deck, pno)) continue;
        hits.push({ key, deck, pno, at: m.index + m[0].length });
        have.add(key);
      }
    }
  }
  hits.sort((a, b) => b.at - a.at);          // 从后往前插，偏移不会乱
  for (const h of hits) {
    html = html.slice(0, h.at) + slideFig(h.deck, h.pno) + html.slice(h.at);
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

const LECTURE = (() => {
  const m = path.basename(FILE).match(/^(\d{2})_/);
  return m ? m[1] : '';
})();
const DECK = opt('--deck') || DECK_BY_LECTURE[LECTURE] || '';
if (!DECK) {
  console.error(`无法确定 deck：文件名不是 NN_… 形式，请用 --deck <name>（可选：${Object.values(DECK_BY_LECTURE).join(', ')}）`);
  process.exit(2);
}
const inserted = [];
const skipped = [];

for (const pno of pages.sort((a, b) => a - b)) {
  if (hasFigure(html, DECK, pno)) { skipped.push(`${pno}(已存在)`); continue; }
  const re = new RegExp(`\\bp0*${pno}\\b`);
  let hit = -1;
  const paraRe = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = paraRe.exec(html))) {
    if (re.test(m[1])) { hit = m.index + m[0].length; break; }   // 插在这一段之后
  }
  if (hit < 0) { skipped.push(`${pno}(正文未引用)`); continue; }
  html = html.slice(0, hit) + slideFig(DECK, pno) + html.slice(hit);
  inserted.push(pno);
}

if (!DRY) fs.writeFileSync(FILE, html, 'utf8');

console.log(`${FILE}`);
console.log(`  插入 ${inserted.length} 个：${inserted.join(',') || '—'}`);
if (skipped.length) console.log(`  跳过 ${skipped.length} 个：${skipped.join(', ')}`);
