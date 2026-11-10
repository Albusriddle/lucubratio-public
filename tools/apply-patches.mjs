// 把复核报告里的 PATCH / IMPORT 清单机械地应用到片段文件上
//
// 用法：
//   node tools/apply-patches.mjs <review.md> <目标片段.html> [选项]
//
// 选项：
//   --as A|B        只应用「文件：A|B」的补丁（建议总是给，避免把 B 的补丁喂给 A）
//   --other <path>  IMPORT 的源文件（跨文件搬块时必须给）
//   --dry           只报告不落盘
//   --去重          允许「原文」在目标文件里出现多次（默认要求恰好一次）
//
// 支持的补丁写法（都是真实出现过的）：
//   1) PATCH 1
//   2) **PATCH 1**
//   3) PATCH 4（插入，不是替换）
//   4) ### A1（P0）p72：…   ← 位于「PATCH / 补丁」小节下的编号子标题
// 字段行兼容：`文件：A` / `- 文件：A` / 原文用反引号或 ``` 围栏 / 多行值
//
// 事务语义：任一条失败则**整批不写入**（避免合稿半途而废）。

import fs from 'node:fs';

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

// ---------------- 参数 ----------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const optVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : '';
};
const DRY = flag('--dry');
const ALLOW_MULTI = flag('--去重');
const LENIENT = flag('--lenient');   // 跳过失败项、其余照改（用于「一处描述多处」这类无法逐字命中的补丁）
const AS = optVal('--as').toUpperCase().slice(0, 1);
const OTHER = optVal('--other');

const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  const prev = argv[i - 1];
  return prev !== '--as' && prev !== '--other';
});
const [reviewPath, targetPath] = positional;

if (!reviewPath || !targetPath) {
  console.error('用法: node tools/apply-patches.mjs <review.md> <目标片段.html> [--as A|B] [--other <源文件>] [--dry] [--去重]');
  process.exit(2);
}
if (!fs.existsSync(reviewPath)) { console.error('复核报告不存在: ' + reviewPath); process.exit(2); }
if (!fs.existsSync(targetPath)) { console.error('目标片段不存在: ' + targetPath); process.exit(2); }

// ---------------- 解析 PATCH ----------------
// 标签是多字的（文件/原文/改为/理由），不能放进单字符类
const FIELD_RE = /^[\s\-*]*(文件|原文|改为|理由)\s*[：:]\s*([\s\S]*)$/;
const FIELD_KEY = { 文件: 'file', 原文: 'from', 改为: 'to', 理由: 'why' };

function parsePatches(md) {
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  let inPatchSection = false;

  const isHeader = (line) => {
    if (/^\s*#{0,4}\s*(\*\*)?PATCH[\s-]+\d+/.test(line)) return true;
    if (inPatchSection && /^\s*#{3,4}\s*[A-Z]\d+\b/.test(line)) return true;
    return false;
  };

  for (const line of lines) {
    // 先判「是不是补丁标题」——否则 ### A1 会被下面的「离开小节」逻辑先关掉
    if (isHeader(line)) {
      if (cur) blocks.push(cur);
      cur = [];
      continue;
    }
    if (/^\s*#{2,4}\s*.*(PATCH|合稿补丁|补丁)/i.test(line)) { inPatchSection = true; continue; }
    if (/^\s*#{2,3}\s/.test(line)) inPatchSection = false;
    if (cur) cur.push(line);
  }
  if (cur) blocks.push(cur);

  const clean = (v) => String(v || '')
    .replace(/^\s*```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .replace(/^\s*`+/, '')
    .replace(/`+\s*$/, '')
    .trim();

  const out = [];
  for (const blk of blocks) {
    const f = { file: '', from: '', to: '', why: '' };
    let k = null;
    for (const line of blk) {
      const m = line.match(FIELD_RE);
      if (m) { k = FIELD_KEY[m[1]]; f[k] = m[2]; }
      else if (k) f[k] += '\n' + line;
    }
    const from = clean(f.from);
    const to = clean(f.to);
    const file = clean(f.file).toUpperCase().replace(/[^AB]/g, '').slice(0, 1);
    if (from && to) out.push({ file, from, to, why: clean(f.why).replace(/\s+/g, ' ').slice(0, 100) });
  }
  return out;
}

// ---------------- 解析 IMPORT ----------------
function parseImports(md) {
  const out = [];
  const chunks = md.split(/(?:^|\n)\s*(\*\*)?IMPORT\s+\d+[^\n]{0,24}\n/).slice(1);
  for (const ch of chunks) {
    const body = ch.split(/\n\s*#{2,3}\s/)[0];
    const grab = (label) => {
      const m = body.match(new RegExp(`[\\s\\-*]*${label}\\s*[：:]\\s*([^\\n]+)`));
      return m ? m[1].replace(/^`+|`+$/g, '').trim() : '';
    };
    const p = { file: grab('文件'), from: grab('取'), to: grab('到'), replace: grab('替换') };
    if (p.from && p.replace) out.push(p);
  }
  return out;
}

function extractBlock(source, fromMark, toMark) {
  const i = source.indexOf(fromMark);
  if (i < 0) return null;
  if (!toMark) return source.slice(i);
  const j = source.indexOf(toMark, i + fromMark.length);
  return j < 0 ? null : source.slice(i, j);
}

function replaceBlock(target, mark, newBlock) {
  const i = target.indexOf(mark);
  if (i < 0) return null;
  const m = mark.match(/^<h([23])\b/);
  const level = m ? m[1] : '3';
  const re = new RegExp(`<h${level}\\b`, 'g');
  re.lastIndex = i + mark.length;
  const nxt = re.exec(target);
  const end = nxt ? nxt.index : target.length;
  return target.slice(0, i) + newBlock.trim() + '\n\n' + target.slice(end);
}

// ---------------- 主流程 ----------------
const md = fs.readFileSync(reviewPath, 'utf8');
let patches = parsePatches(md);
let imports = parseImports(md);

if (AS) {
  const before = patches.length;
  patches = patches.filter((p) => !p.file || p.file === AS);
  if (patches.length !== before) console.log(C.dim(`按 --as ${AS} 过滤 PATCH：${before} → ${patches.length}`));
}
if (AS && imports.length) {
  const before = imports.length;
  imports = imports.filter((p) => !String(p.file || '').toUpperCase().includes(AS));
  if (imports.length !== before) console.log(C.dim(`按 --as ${AS} 过滤 IMPORT：${before} → ${imports.length}`));
}

console.log(`${C.dim('复核报告：')}${reviewPath}`);
console.log(`${C.dim('目标片段：')}${targetPath}`);
console.log(`${C.dim('PATCH：')}${patches.length} 条${imports.length ? `　${C.dim('IMPORT：')}${imports.length} 条` : ''}\n`);

if (!patches.length && !imports.length) {
  console.log(C.yellow('没有可解析的 PATCH/IMPORT（检查格式，或 --as 过滤后为空）'));
  process.exit(0);
}

let html = fs.readFileSync(targetPath, 'utf8');
const applied = [];
const failed = [];

patches.forEach((p, idx) => {
  const n = html.split(p.from).length - 1;
  if (n === 1) {
    html = html.replace(p.from, () => p.to);
    applied.push({ label: `PATCH ${idx + 1}`, why: p.why });
  } else if (n > 1 && ALLOW_MULTI) {
    html = html.split(p.from).join(p.to);
    applied.push({ label: `PATCH ${idx + 1}`, why: `${p.why}（替换 ${n} 处）` });
  } else {
    failed.push({ label: `PATCH ${idx + 1}`, why: p.why, reason: n === 0 ? '原文未找到' : `原文出现 ${n} 次（不唯一）`, sample: p.from.slice(0, 60) });
  }
});

if (imports.length) {
  if (!OTHER || !fs.existsSync(OTHER)) {
    failed.push({ label: 'IMPORT', why: '', reason: '报告里有 IMPORT 但没给 --other <源文件>', sample: '' });
  } else {
    const source = fs.readFileSync(OTHER, 'utf8');
    imports.forEach((im, idx) => {
      const block = extractBlock(source, im.from, im.to || '');
      if (!block) { failed.push({ label: `IMPORT ${idx + 1}`, why: '', reason: '源文件里定位不到「取/到」标记', sample: im.from }); return; }
      const replaced = replaceBlock(html, im.replace, block);
      if (replaced === null) { failed.push({ label: `IMPORT ${idx + 1}`, why: '', reason: '目标文件里找不到「替换」标记', sample: im.replace }); return; }
      html = replaced;
      applied.push({ label: `IMPORT ${idx + 1}`, why: `搬入 ${block.length} 字符` });
    });
  }
}

for (const a of applied) console.log(`${C.green('✓')} ${a.label}  ${a.why || ''}`);
for (const f of failed) {
  console.log(`${C.red('✗')} ${f.label}  ${f.reason}  ${C.dim(f.sample)}`);
  if (f.why) console.log(`${C.dim('    理由：' + f.why)}`);
}

if (failed.length && !LENIENT) {
  console.log(`\n${C.red(`${failed.length} 条失败——未写入任何改动（避免半成品）`)}`);
  process.exit(1);
}
if (failed.length && LENIENT) {
  console.log(`\n${C.yellow(`${failed.length} 条失败已跳过（--lenient），其余 ${applied.length} 条照改`)}`);
}

if (DRY) {
  console.log(`\n${C.yellow('--dry：未写入')}（${applied.length} 条均可应用）`);
} else {
  fs.writeFileSync(targetPath, html, 'utf8');
  console.log(`\n${C.green(`已写入 ${targetPath}`)}（应用 ${applied.length} 条）`);
}
