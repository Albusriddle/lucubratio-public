// 检测题自检：答案 / 解析 / 选项 三者是否自洽（"题目到底能不能答"）
//
// 用法：
//   node tools/self-check-quizzes.mjs <页面.html> [--verbose]
//
// 检查项：
//   1. 答案唯一：解析里形如「B 对」的字母必须**有且只有一个**，且该字母在选项里存在
//   2. 选项覆盖：A–D 每个字母都要在解析里被提到（漏一个 = 没破该项）
//   3. 页码引用：解析里必须出现「p数字」或「第 N 页」
//   4. 题干长度：≤120 字（过长说明把整段话塞进题干）
//   5. 同页重复：两题题干的三元组（连续 3 字）Jaccard ≥ 0.8 → 判重复
//   6. 形态：必须有「检测 N（10 分）」、必须四个选项 A–D
//
// 退出码：0 全部通过；1 有问题

import fs from 'node:fs';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const file = args.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('用法: node tools/self-check-quizzes.mjs <页面.html> [--verbose]');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error('文件不存在: ' + file);
  process.exit(1);
}

const html = fs.readFileSync(file, 'utf8');
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** 切出每一道题：从 <h3 id="检测 N"> 到下一个 <h3 或文末 */
function splitQuizzes(src) {
  const out = [];
  const re = /<h3[^>]*id="[^"]*检测\s*(\d+)"[^>]*>([\s\S]*?)<\/h3>/g;
  const marks = [...src.matchAll(re)].map((m) => ({ n: Number(m[1]), index: m.index, end: m.index + m[0].length, head: m[2] }));
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const stop = i + 1 < marks.length ? marks[i + 1].index : src.length;
    out.push({ n: marks[i].n, title: strip(marks[i].head), block: src.slice(start, stop) });
  }
  return out;
}

/** 三字组集合，用于相似度 */
function trigrams(s) {
  const t = strip(s).replace(/[，。、；：（）()「」“”"'!?！？\s]/g, '');
  const set = new Set();
  for (let i = 0; i + 3 <= t.length; i++) set.add(t.slice(i, i + 3));
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const quizzes = splitQuizzes(html);
if (!quizzes.length) {
  console.error('没有找到「检测 N」题块');
  process.exit(1);
}

let bad = 0;
const rows = [];

for (const q of quizzes) {
  const problems = [];
  const body = q.block;

  // 4) 题干长度
  const titleLen = q.title.length;
  if (titleLen > 120) problems.push(`题干 ${titleLen} 字（>120，疑似把整段塞进题干）`);

  // 6) 分值标注
  if (!/（\s*10\s*分\s*）/.test(q.title)) problems.push('标题缺「（10 分）」标注');

  // 选项：A./B./C./D.
  const optLetters = [...body.matchAll(/(?:^|[>\s　])([A-D])[.．、]\s*/g)].map((m) => m[1]);
  const uniqOpts = [...new Set(optLetters)];
  const missingOpts = ['A', 'B', 'C', 'D'].filter((x) => !uniqOpts.includes(x));
  if (missingOpts.length) problems.push(`选项缺 ${missingOpts.join('')}`);

  // 解析区：<blockquote> ... </blockquote>
  const bq = body.match(/<blockquote>([\s\S]*?)<\/blockquote>/);
  const expl = bq ? strip(bq[1]) : '';

  // 1) 答案判定。
  // 本项目的解析约定是「首句直接给正确结论 + 其余写 X 错在…」，
  // 所以正确答案常常不写成「X 对」。判定顺序：
  //   a) 显式「X 对」或「答案：X」 → 用它
  //   b) 恰好三个选项被写成「X 错」 → 第四个就是答案
  //   c) 都判不出 → 标"需人工判定答案"
  const explicit = [...expl.matchAll(/([A-D])\s*对(?![错])/g)].map((m) => m[1]);
  const fromAnswer = [...expl.matchAll(/答案\s*[：:]\s*([A-D])/g)].map((m) => m[1]);
  // 干扰项的写法并不统一：「B 错在…」「B 把两端搞反」「C 漏了界限检查」都有。
  // 统一按「小句句首的选项字母」认：分号/句号/逗号/空白之后紧跟 A-D 且后面不是数字。
  // 只认「选项字母 + 批评性动词」的小句，避免把「只有 A 同时满足」这类正向表述误判成干扰项
  const wrongClause = [...expl.matchAll(
    /(?:^|[；;。，,\s])([A-D])\s*(?=(?:错|把|漏|只|不|混|当成|误|搞|忽|算|取|用|认|多|少|反|以|拿))/g
  )].map((m) => m[1]);
  const wrong = [...new Set(wrongClause)];
  let ans = null;
  let ansHow = '';
  if (fromAnswer.length === 1) { ans = fromAnswer[0]; ansHow = '显式答案'; }
  else if (explicit.length === 1 && !wrong.includes(explicit[0])) { ans = explicit[0]; ansHow = '「X 对」'; }
  else if (wrong.length === 3) { ans = ['A', 'B', 'C', 'D'].find((x) => !wrong.includes(x)); ansHow = '排除三项'; }
  else if (explicit.length > 1) problems.push(`解析里有多个「X 对」：${[...new Set(explicit)].join(',')}（答案不唯一）`);

  if (!ans) problems.push('无法判定答案（既无「X 对」，也不足三个「X 错」）——需人工确认');
  else if (!uniqOpts.includes(ans)) problems.push(`判定出的答案 ${ans} 不在选项里`);

  // 2) 选项覆盖：**错误选项**必须被解析点名（正确答案由首句正向说明，不要求写「X 对」）
  const wrongOpts = ['A', 'B', 'C', 'D'].filter((x) => uniqOpts.includes(x) && x !== ans);
  const notMentioned = wrongOpts.filter((x) => !wrong.includes(x) && !new RegExp(`${x}\\s*(错|对|×|不成立)`).test(expl));
  if (notMentioned.length) problems.push(`解析没点破干扰项 ${notMentioned.join(',')}`);

  // 3) 页码引用
  const hasCite = /p\s*\d{1,3}\b|第\s*\d{1,3}\s*页/.test(expl);
  if (!hasCite) problems.push('解析里没有页码引用');

  rows.push({ n: q.n, title: q.title.slice(0, 26), ans: ans || '?', how: ansHow, len: titleLen, problems });
  if (problems.length) bad++;
}

// 5) 同页重复
const dup = [];
for (let i = 0; i < quizzes.length; i++) {
  for (let j = i + 1; j < quizzes.length; j++) {
    const sim = jaccard(trigrams(quizzes[i].title), trigrams(quizzes[j].title));
    if (sim >= 0.8) dup.push({ a: quizzes[i].n, b: quizzes[j].n, sim: sim.toFixed(2) });
  }
}

// ---- 输出 ----
console.log(`${DIM('文件：')}${file}`);
console.log(`${DIM('题数：')}${quizzes.length}\n`);

for (const r of rows) {
  const mark = r.problems.length ? RED('✗') : GREEN('✓');
  console.log(`${mark} 检测 ${r.n}  答案=${r.ans}${r.how ? '（' + r.how + '）' : ''}  题干${r.len}字  ${DIM(r.title)}`);
  if (verbose || r.problems.length) for (const p of r.problems) console.log('   · ' + p);
}

if (dup.length) {
  console.log('');
  for (const d of dup) console.log(`${YELLOW('!')} 检测 ${d.a} 与 检测 ${d.b} 题干相似度 ${d.sim}（疑似同考点重复）`);
}

console.log('');
if (bad || dup.length) {
  console.log(RED(`自检发现 ${bad} 道题有问题${dup.length ? `，另有 ${dup.length} 组疑似重复` : ''}`));
  process.exit(1);
}
console.log(GREEN(`自检通过：${quizzes.length} 道题，答案唯一、选项全覆盖、解析带页码`));
