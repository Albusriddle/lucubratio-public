// 把多段已定稿的片段合并成一页，并做全局重编号与一致性检查
//
// 用法：
//   node tools/merge-pages.mjs <输出.html> <片段1.html> <片段2.html> […]
//
// 做的事：
//   1. 按给定顺序拼接（每段之间空一行）
//   2. 把所有 `<h3 id="检测 N">检测 N（10 分）…` 按文档顺序重编号为 1..M
//   3. 检查 h2/h3 的 id 是否全局唯一（分段时最容易撞在这里）
//   4. 报告：h2/h3/题量/页码引用/mermaid 数，并对「全页题量上限」给结论
//   5. 检查段落元叙述（「这一稿」「本稿」「另一份稿」等）——试跑里出现过两次
//
// 退出码：0 正常；1 有条目级错误（id 重复 / 残留元叙述）

import fs from 'node:fs';

// 全页题量上限（见 docs/skill/SKILL.md「2.5 合稿阶段的题量上限」）
const QUIZ_CAP = { tiny: 8, small: 10, large: 12 };

const [, , outPath, ...inputs] = process.argv;
if (!outPath || inputs.length === 0) {
  console.error('用法: node tools/merge-pages.mjs <输出.html> <片段1.html> <片段2.html> […]');
  process.exit(1);
}

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

let parts = [];
for (const f of inputs) {
  if (!fs.existsSync(f)) { console.error(`片段不存在: ${f}`); process.exit(1); }
  parts.push(fs.readFileSync(f, 'utf8').trim());
}
let html = parts.join('\n\n');

// ---- 2) 全局重编号 ----
const before = [...html.matchAll(/<h3 id="检测 (\d+)"/g)].map((m) => m[1]);
let n = 0;
html = html.replace(/<h3 id="检测 \d+"/g, () => `<h3 id="检测 ${++n}"`);
let t = 0;
// 标题文字同步（只处理标准写法「检测 N（10 分）」）
html = html.replace(/<h3 id="检测 (\d+)">检测 \d+（10 分）/g, (m, id) => {
  t++;
  return `<h3 id="检测 ${id}">检测 ${id}（10 分）`;
});

// ---- 3) id 唯一性 ----
const problems = [];
const ids = [...html.matchAll(/<h([23])\b[^>]*\bid="([^"]+)"/g)].map((m) => ({ tag: m[1], id: m[2] }));
const seen = new Map();
for (const { tag, id } of ids) {
  if (seen.has(id)) problems.push(`id 重复：${id}（${seen.get(id)} 与 ${tag}）`);
  else seen.set(id, tag);
}

// ---- 5) 元叙述残留 ----
const metaHits = (html.match(/这一稿|本稿|另一份稿|稿 A|稿 B|生产者 [AB]|复核人/g) || []);
if (metaHits.length) problems.push(`残留元叙述 ${metaHits.length} 处：${[...new Set(metaHits)].join('、')}`);

// ---- 统计 ----
const stats = {
  h2: (html.match(/<h2\b/gi) || []).length,
  h3: (html.match(/<h3\b/gi) || []).length,
  quiz: n,
  cites: (html.match(/(?:课件\s*)?p\s*\d{1,3}\b|第\s*\d{1,3}\s*页/g) || []).length,
  mermaid: (html.match(/class="mermaid"/g) || []).length,
  chars: html.length,
};

// 全页题量上限：按 h2 数粗判规模（≤3 章≈20 页量级）
const cap = stats.h2 <= 3 ? QUIZ_CAP.tiny : stats.h2 <= 5 ? QUIZ_CAP.small : QUIZ_CAP.large;

if (problems.length) {
  for (const p of problems) console.log(`${RED('✗')} ${p}`);
  console.log(`\n${RED('合并中止：' + problems.length + ' 项问题（未写入）')}`);
  process.exit(1);
}

fs.writeFileSync(outPath, html + '\n', 'utf8');

console.log(`${GREEN('✓')} 已合并 ${inputs.length} 段 → ${outPath}`);
console.log(`  h2=${stats.h2} h3=${stats.h3} 题=${stats.quiz} 引用=${stats.cites} mermaid=${stats.mermaid} 字数=${stats.chars}`);
console.log(DIM(`  题号重编号：${before.join(',')} → ${Array.from({ length: n }, (_, i) => i + 1).join(',')}`));
if (stats.quiz > cap) {
  console.log(`${YELLOW('!')} 全页题量 ${stats.quiz} 道，超过上限 ${cap}（按「重复 / 记忆化 / 同页码同考点」删）`);
} else {
  console.log(`${GREEN('✓')} 全页题量 ${stats.quiz} ≤ 上限 ${cap}`);
}
