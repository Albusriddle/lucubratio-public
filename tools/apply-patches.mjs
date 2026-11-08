// 把复核报告里的 PATCH 清单机械地应用到片段文件上
//
// 用法：
//   node tools/apply-patches.mjs <review.md> <目标片段.html> [--dry] [--去重]
//
// 复核报告里每条 PATCH 的格式（见 docs/skill/prompts.md）：
//   PATCH 1
//   文件：A 或 B
//   原文：<被替换的原文片段>
//   改为：<替换后的完整文本>
//   理由：<对应第几条>
//
// 行为：
//   · 每条都要求「原文」在目标文件里**恰好出现一次**（0 次=定位失败，>1 次=不唯一）
//   · 任何一条失败，默认不写入任何改动（要么全过，要么不改），避免合稿半途而废
//   · --dry 只报告不落盘；--去重 允许原文出现多次时替换全部

import fs from 'node:fs';

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const allowMulti = args.includes('--去重');
// --as A|B：只应用「文件：」字段匹配的补丁。
// 不加这个参数时是"盲应用"——把 B 的补丁喂给 A 的文件会整批失败，
// 因此本工具在有「文件：」字段时会先核对，不匹配就报错退出。
const otherIdx = args.indexOf('--other');
const otherPath = otherIdx >= 0 ? args[otherIdx + 1] : '';
const asIdx = args.indexOf('--as');
const asLabel = asIdx >= 0 ? String(args[asIdx + 1] || '').toUpperCase() : '';
const positional = args.filter((a, i) =>
  !a.startsWith('--') && !(asIdx >= 0 && i === asIdx + 1) && !(otherIdx >= 0 && i === otherIdx + 1));
const [reviewPath, targetPath] = positional;

if (!reviewPath || !targetPath) {
  console.error('用法: node tools/apply-patches.mjs <review.md> <片段.html> [--dry] [--去重]');
  process.exit(1);
}
if (!fs.existsSync(reviewPath)) { console.error('复核报告不存在: ' + reviewPath); process.exit(1); }
if (!fs.existsSync(targetPath)) { console.error('目标片段不存在: ' + targetPath); process.exit(1); }

/** 从复核报告里抽出 PATCH 列表 */
function parsePatches(md) {
  const out = [];
  // 按 "PATCH n" 切块
  // 允许行首的 PATCH n 后面带注记，例如「PATCH 4（插入，不是替换）」
  const chunks = md.split(/(?:^|\n)\s*PATCH\s+\d+[^\n]{0,24}\n/).slice(1);
  for (const ch of chunks) {
    const body = ch.split(/\n\s*##\s/)[0]; // 遇到下一个大标题就停
    const grab = (label) => {
      // 注意：不能用 $ 收尾——m 标志下 $ 匹配行尾，会把围栏代码块里的首行截断。
      const re = new RegExp(`${label}\\s*[：:]\\s*([\\s\\S]*?)(?=\\n(?:文件|原文|改为|理由)\\s*[：:]|(?![\\s\\S]))`);
      const m = body.match(re);
      if (!m) return '';
      // 复核常用 ``` 围栏包住长片段，剥掉围栏只留内容
      return m[1].trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    };
    const p = {
      file: grab('文件'),
      from: grab('原文'),
      to: grab('改为'),
      why: grab('理由'),
    };
    if (p.from && p.to) out.push(p);
  }
  return out;
}

let patches = parsePatches(fs.readFileSync(reviewPath, 'utf8'));
// 按「文件：」过滤/核对
if (asLabel) {
  const before = patches.length;
  patches = patches.filter((p) => String(p.file || '').toUpperCase().includes(asLabel));
  if (patches.length !== before) console.log(`${C.dim(`按 --as ${asLabel} 过滤：${before} → ${patches.length} 条`)}`);
  if (!patches.length) {
    console.log(C.yellow(`复核报告里没有「文件：${asLabel}」的补丁——确认目标文件是否给错了`));
    process.exit(0);
  }
}

const importsPreview = parseImports(fs.readFileSync(reviewPath, 'utf8'));
if (!patches.length && !importsPreview.length) {
  console.log(C.yellow('复核报告里既没有 PATCH 也没有 IMPORT（检查格式「PATCH n / 文件 / 原文 / 改为 / 理由」）'));
  process.exit(0);
}

let html = fs.readFileSync(targetPath, 'utf8');
const applied = [];
const failed = [];

for (let i = 0; i < patches.length; i++) {
  const p = patches[i];
  const n = (html.match(new RegExp(escapeRe(p.from), 'g')) || []).length;
  if (n === 1) {
    html = html.replace(p.from, () => p.to);
    applied.push({ i: i + 1, why: p.why });
  } else if (n > 1 && allowMulti) {
    html = html.split(p.from).join(p.to);
    applied.push({ i: i + 1, why: p.why, note: `替换 ${n} 处` });
  } else {
    failed.push({ i: i + 1, why: p.why, reason: n === 0 ? '原文未找到' : `原文出现 ${n} 次（不唯一）`, from: p.from.slice(0, 60) });
  }
}

/** 从复核报告里抽出 IMPORT 列表（跨文件搬块） */
function parseImports(md) {
  const out = [];
  const chunks = md.split(/(?:^|\n)\s*IMPORT\s+\d+[^\n]{0,24}\n/).slice(1);
  for (const ch of chunks) {
    const body = ch.split(/\n\s*##\s/)[0];
    const grab = (label) => {
      const m = body.match(new RegExp(`${label}\\s*[：:]\\s*([^\\n]+)`));
      return m ? m[1].trim() : '';
    };
    const p = { file: grab('文件'), from: grab('取'), to: grab('到'), replace: grab('替换') };
    if (p.from && p.replace) out.push(p);
  }
  return out;
}

/** 按标记取出源码里的一个块：[from, to) 或 [from, EOF) */
function extractBlock(source, fromMark, toMark) {
  const i = source.indexOf(fromMark);
  if (i < 0) return null;
  if (!toMark) return source.slice(i);
  const j = source.indexOf(toMark, i + fromMark.length);
  if (j < 0) return null;
  return source.slice(i, j);
}

/** 用「起点标记 + 下一个同级 h 标签」替换目标块 */
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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

console.log(`${C.dim('复核报告：')}${reviewPath}`);
console.log(`${C.dim('目标片段：')}${targetPath}`);
console.log(`${C.dim('PATCH 总数：')}${patches.length}\n`);

// ---- IMPORT：跨文件搬块 ----
const imports = importsPreview;
if (imports.length) {
  if (!otherPath || !fs.existsSync(otherPath)) {
    console.log(C.red(`✗ 报告里有 ${imports.length} 条 IMPORT，但没有指定 --other <源文件>`));
    process.exit(1);
  }
  const source = fs.readFileSync(otherPath, 'utf8');
  console.log(`${C.dim('IMPORT：源文件')}${otherPath}`);
  for (let i = 0; i < imports.length; i++) {
    const im = imports[i];
    const block = extractBlock(source, im.from, im.to || '');
    if (!block) { failed.push({ i: `I${i + 1}`, reason: '源文件里定位不到「取/到」标记', from: im.from }); continue; }
    const replaced = replaceBlock(html, im.replace, block);
    if (replaced === null) { failed.push({ i: `I${i + 1}`, reason: '目标文件里找不到「替换」标记', from: im.replace }); continue; }
    html = replaced;
    applied.push({ i: `I${i + 1}`, why: `搬入 ${block.length} 字符（${im.from} → ${im.replace}）` });
  }
}

for (const a of applied) console.log(`${C.green('✓')} ${a.i.toString().startsWith('I') ? 'IMPORT' : 'PATCH'} ${a.i}${a.note ? '（' + a.note + '）' : ''}  ${a.why || ''}`);
for (const f of failed) {
  console.log(`${C.red('✗')} PATCH ${f.i}  ${f.reason}  ${C.dim(f.from)}`);
  if (f.why) console.log(`   理由：${f.why}`);
}


if (failed.length) {
  console.log(`\n${C.red(`${failed.length} 条失败——未写入任何改动（避免半成品）`)}`);
  console.log(C.dim('处理建议：0 次 → 报告里的原文与文件不符（可能含反引号/空格差异）；>1 次 → 用 --去重 或让复核方给更长的定位串'));
  process.exit(1);
}

if (dry) {
  console.log(`\n${C.yellow('--dry：未写入')}（${applied.length} 条均可应用）`);
} else {
  fs.writeFileSync(targetPath, html, 'utf8');
  console.log(`\n${C.green(`已写入 ${targetPath}`)}（应用 ${applied.length} 条）`);
}
