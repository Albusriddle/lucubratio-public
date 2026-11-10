// 按复核的「最终题目清单」重建一页的题目集合
//
// 为什么需要它：复核会给出跨稿增删/改写的题目（例如"取 A 检测 2""新增：64 位 vs 32 位编号辨析"），
// 手工从 markdown 抄成 HTML 既慢又易错。
//
// 用法：
//   node tools/compose-quizzes.mjs --review <review.md> --a <A稿.html> --b <B稿.html> --out <quizzes.html> [--pick 1,2,3]
//
// 行为：
//   1. 在 review.md 里找「最终题目清单 / 附录」小节
//   2. 逐条解析：① 写全了的题（### 检测 N + A./B./C./D. + 解析）→ 转 HTML
//                ② 只给了引用（取 A 检测 2 / B 检测 1）→ 从对应稿里整块搬
//   3. 统一重编号 1..M，输出 HTML 片段
//
// 输出片段可直接拼到「去掉原题的正文」后面。

import fs from 'node:fs';

const console_yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const C = { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m` };

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : ''; };
const REVIEW = opt('--review');
const FILE_A = opt('--a');
const FILE_B = opt('--b');
const OUT = opt('--out');
const PICK = opt('--pick');

if (!REVIEW || !OUT) {
  console.error('用法: node tools/compose-quizzes.mjs --review <review.md> --a <A.html> --b <B.html> --out <out.html> [--pick 1,3,5]');
  process.exit(2);
}

// ---------- 取复核里的题目小节 ----------
function sectionOf(md) {
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,4}\s*.*(最终题目清单|附[：:]?\s*最终题|题目清单)/.test(lines[i])) { start = i + 1; break; }
  }
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

// ---------- markdown → HTML 片段 ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>');

/** 把一段「### 检测 N …」的 markdown 转成一个题目 HTML 块 */
function convertEntry(lines, idx) {
  const head = lines[0].replace(/^#+\s*/, '').trim();
  const body = lines.slice(1);
  const opts = [];
  const stem = [];
  const expl = [];
  let mode = 'stem';
  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[A-D][.．、]\s*/.test(line)) {
      mode = 'opts';
      // 四个选项可能挤在同一行（用全角空格分隔），先按 "X." 切
      const parts = line.split(/(?<=[\s\u3000])(?=[A-D][.．、]\s*)/).filter(Boolean);
      for (const part of parts) if (/^[A-D][.．、]\s*/.test(part.trim())) opts.push(part.trim());
      continue;
    }
    if (/^>\s*/.test(line)) { mode = 'expl'; expl.push(line.replace(/^>\s*/, '').replace(/^\*\*解析\*\*\s*[：:]\s*/, '').replace(/^解析\s*[：:]\s*/, '')); continue; }
    if (mode === 'stem') stem.push(line);
    else if (mode === 'expl') expl.push(line);
    else if (mode === 'opts') expl.push(line); // 选项后紧跟的解释
  }
  // 标题里若已含题干（"检测 1（10 分）题干"），直接用；否则标题只是考点标签，题干取 stem
  const m = head.match(/^(检测\s*\d+\s*[（(]\s*10\s*分\s*[）)])\s*(.*)$/);
  const label = m ? m[1] : `检测 ${idx + 1}（10 分）`;
  const rest = m ? m[2].trim() : '';
  // 标题后半段若是个问句，就直接当题干；否则它是考点标签，题干取正文第一段
  const restIsQuestion = /[？?]\s*$/.test(rest) || !stem.length;
  const title = restIsQuestion ? `${label}${rest}` : `${label}${(stem[0] || '').replace(/\s*$/, '')}`;
  const extraLines = restIsQuestion ? stem : stem.slice(1);
  const stemPara = extraLines.filter(Boolean).join(' ');
  const optHtml = opts.length === 4
    ? `<p>${opts.map((o) => inline(o)).join('　')}</p>`
    : null;
  if (!optHtml || !expl.length) return null;
  const quote = `<blockquote><strong>解析</strong>：${expl.map((x) => inline(x)).join('<br>')}</blockquote>`;
  return { kind: 'written', title: esc(title), stem: stemPara ? inline(stemPara) : '', optHtml, quote };
}

/** 从源稿里整块搬一道题（"取 A 检测 2"） */
function liftQuiz(src, n) {
  const re = new RegExp(`<h3 id="检测 ${n}">[\\s\\S]*?(?=<h3 id="检测 |\\Z)`);
  const m = src.match(re);
  return m ? m[0].trim() : null;
}

/** 把任意题目 HTML 块的编号改成 k */
/** 统一题目标题：确保「检测 k（10 分）」形态（搬来的题可能只有编号） */
function normalizeTitle(block, k) {
  return block.replace(/(<h3 id="检测 \d+">)([\s\S]*?)(<\/h3>)/, (m, open, inner, close) => {
    let t = inner.trim().replace(/^检测\s*\d+\s*/, '');
    t = t.replace(/^[（(]\s*10\s*分\s*[）)]\s*/, '');
    return `${open}检测 ${k}（10 分）${t ? '　' + t : ''}${close}`;
  });
}

function renumber(block, k) {
  let b = block.replace(/<h3 id="检测 \d+"/, `<h3 id="检测 ${k}"`);
  b = b.replace(/(<h3 id="检测 \d+">)\s*检测\s*\d+/, `$1检测 ${k}`);
  return b;
}

// ---------- 解析 ----------
const md = fs.readFileSync(REVIEW, 'utf8');
let sec = sectionOf(md);
// 规范化：把「**检测 N（10 分）**　题干…」这种加粗行内写法拆成「### 检测 N（10 分）」+ 题干段落
sec = sec.replace(/\*\*(检测\s*\d+\s*[（(]\s*10\s*分\s*[）)])\*\*[\s\u3000]*/g, '### $1\n\n');
if (!sec.trim()) {
  console.error('复核里找不到「最终题目清单」小节');
  process.exit(1);
}

const srcA = FILE_A && fs.existsSync(FILE_A) ? fs.readFileSync(FILE_A, 'utf8') : '';
const srcB = FILE_B && fs.existsSync(FILE_B) ? fs.readFileSync(FILE_B, 'utf8') : '';

// ① 写全的题（### 检测 …）
const entries = [];
const chunks = sec.split(/\n(?=#{3,4}\s*检测)/);
for (const ch of chunks) {
  if (!/^#{3,4}\s*检测/.test(ch.trim())) continue;
  const lines = ch.trim().split(/\r?\n/);
  const conv = convertEntry(lines, entries.length);
  if (!conv) {
    const joined = lines.join(' ').slice(0, 60);
    console.log(`  ${console_yellow('跳过')}：${joined}…（选项不足 4 或缺解析）`);
  }
  if (conv) entries.push({ kind: 'written', html: `<h3 id="检测 0">${conv.title}</h3>\n${conv.stem ? `<p>${conv.stem}</p>\n` : ''}${conv.optHtml}\n${conv.quote}` });
}

// ①b HTML 围栏模式：复核把题直接写成 HTML（常见于附录）
if (!entries.length) {
  const html = sec.replace(/```html/gi, '```');
  const blocks = html.split(/```/).filter((x, i) => i % 2 === 1 && /<h3\s+id="检测/.test(x));
  for (const blk of blocks) {
    for (const m of blk.matchAll(/<h3 id="检测 \d+">[\s\S]*?(?=<h3 id="检测 |\s*$)/g)) {
      if (/<blockquote/.test(m[0])) entries.push({ kind: 'html', html: m[0].trim() });
    }
  }
}

// ①c 裸 HTML 模式：小节里直接写 <h3 id="检测 N">…（无 ``` 围栏）
if (!entries.length && /<h3\s+id="检测/.test(sec)) {
  const norm = sec.replace(/\n(?=<h3\s+id="检测)/g, '\n\n');
  for (const m of norm.matchAll(/<h3 id="检测 \d+">[\s\S]*?(?=<h3 id="检测 |\s*$)/g)) {
    if (/<blockquote/.test(m[0])) entries.push({ kind: 'html', html: m[0].trim() });
  }
}

// ② 引用式的题（表格里的「取 A 检测 2」/「A 检测 9」）
if (!entries.length) {
  const rows = sec.split(/\r?\n/).filter((l) => /^\|/.test(l));
  for (const row of rows) {
    const a = row.match(/A[^|\n]{0,20}?检测\s*(\d+)/);
    const b = row.match(/B[^|\n]{0,20}?检测\s*(\d+)/);
    const pick = row.match(/取\s*([AB])\s*检测\s*(\d+)/);
    let block = null;
    if (pick) block = pick[1] === 'A' ? liftQuiz(srcA, Number(pick[2])) : liftQuiz(srcB, Number(pick[2]));
    else if (a && !b) block = liftQuiz(srcA, Number(a[1]));
    else if (b && !a) block = liftQuiz(srcB, Number(b[1]));
    if (block) entries.push({ kind: 'lifted', html: block });
  }
}

if (!entries.length) {
  console.error('没能解析出任何题目（既无「### 检测」块，也无「取 A/B 检测 N」表格）');
  process.exit(1);
}

// ---------- 可选题号筛选 ----------
let list = entries;
if (PICK) {
  const want = PICK.split(',').map((x) => Number(x.trim())).filter(Boolean);
  list = want.map((i) => entries[i - 1]).filter(Boolean);
}

// ---------- 输出 ----------
// 兜底：清掉残留的 Markdown 记号（**加粗** / 孤立 ** / 行首 # / 行首 -）
function cleanup(html) {
  return html
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^-\s+/gm, '');
}

let out = '';
list.forEach((e, i) => { out += cleanup(normalizeTitle(renumber(e.html, i + 1), i + 1)) + '\n\n'; });
fs.writeFileSync(OUT, out.trim() + '\n', 'utf8');

const stats = list.map((e, i) => `${i + 1}:${e.kind === 'written' ? '写入' : '搬运'}`).join(' ');
console.log(`${C.green('✓')} 组出 ${list.length} 道题 → ${OUT}`);
console.log(C.dim('  ' + stats));
