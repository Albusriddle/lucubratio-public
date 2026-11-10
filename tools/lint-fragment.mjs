// 片段预检：在 assemble 之前把常见违规抓出来（比等 build/verify 报错快）
//
// 用法：
//   node tools/lint-fragment.mjs <片段1.html> [片段2 …]
//   node tools/lint-fragment.mjs .work/conc1/s1.final.html
//
// 检查项（对应 SKILL.md 的硬规则）：
//   1. 不能是完整文档（出现 <html>/<head>/<style> 就是写错了）
//   2. 每个 h2/h3 必须有 id
//   3. 正文不得残留 Markdown 记号（**、行首 #、行首 - ）
//   4. Mermaid 块必须是 <div class="mermaid"><script type="text/plain"> 同一行开头
//   5. 不允许内联 <script>（除 text/plain）
//   6. 自评单元标题必须是「检测 N」，且每题要有解析 blockquote
//   7. 图片只允许 .webp/.svg，且不许外链；禁止字符画（盒线字符）
//
// 退出码：0 = 全部通过；1 = 有问题

import fs from 'node:fs';

// 示例页没有课件来源，可用 --allow-no-cite 跳过「页码引用」检查
const ALLOW_NO_CITE = process.argv.includes('--allow-no-cite');
// --page：目标是「完整内容页」而不是「待组装的片段」，跳过外壳检查（doctype/style）
const IS_PAGE = process.argv.includes('--page');

const BOX_CHARS = /[\u2500-\u257F\u2580-\u259F]/; // 盒线字符 + 方块元素（都是字符画的特征）

function lint(file) {
  const problems = [];
  const warns = [];
  if (!fs.existsSync(file)) return { file, problems: ['文件不存在'], warns, stats: null };
  let src = fs.readFileSync(file, 'utf8');

  // 1) 完整文档（--page 模式下这是合法的）
  if (!IS_PAGE) {
    if (/<!DOCTYPE|<html\b|<head\b|<body\b/i.test(src)) {
      problems.push('片段里出现了 <!DOCTYPE>/<html>/<head>/<body>（应只写正文）');
    }
    if (/<style\b/i.test(src)) problems.push('片段里出现了 <style>（样式由 assemble 统一套）');
  }

  // 2) h2/h3 缺 id
  const heads = src.match(/<h[23]\b[^>]*>/gi) || [];
  const noId = heads.filter((h) => !/\bid\s*=/.test(h));
  if (noId.length) problems.push(`${noId.length} 个 h2/h3 缺 id：${noId.slice(0, 3).join(' ')}`);

  // id 重复
  const ids = [...src.matchAll(/<h[23]\b[^>]*\bid\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) problems.push(`id 重复：${[...new Set(dup)].slice(0, 5).join(', ')}`);

  // 3) Markdown 残留（剔除 code/pre/script 后判断）
  const stripped = src
    .replace(/<(code|pre|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '');
  if (/\*\*[^*\n]{1,60}\*\*/.test(stripped)) problems.push('正文残留 **加粗** 记号');
  if (/^\s{0,3}#{1,6}\s+\S/m.test(stripped)) warns.push('正文疑似有 Markdown 标题（行首 #）');
  if (/^\s{0,3}[-*+]\s+\S/m.test(stripped)) warns.push('正文疑似有 Markdown 列表（行首 -/*）');

  // 4) Mermaid 块格式
  const mermaidOpens = [...src.matchAll(/<div class="mermaid">/g)].length;
  const badMermaid = [...src.matchAll(/<div class="mermaid">\s*\n\s*<script/gi)].length;
  if (badMermaid) {
    problems.push(`${badMermaid} 个 Mermaid 块写法错误：应为 <div class="mermaid"><script type="text/plain">flowchart …（同一行）`);
  }
  const mermaidScripts = [...src.matchAll(/<script type="text\/plain">/g)].length;
  if (mermaidOpens && mermaidScripts < mermaidOpens) {
    problems.push('有 mermaid div 但缺少 <script type="text/plain">');
  }

  // 5) 内联脚本
  const scripts = [...src.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  const inline = scripts.filter((s) => !/type\s*=\s*"text\/plain"/i.test(s));
  if (inline.length) problems.push(`不允许的内联 <script>：${inline.slice(0, 2).join(' ')}`);

  // 6) 自评单元 + 页码引用
  const quizzes = (src.match(/<h3\b[^>]*id\s*=\s*"检测\s*\d+"/gi) || []).length;
  if (quizzes === 0) warns.push('没有找到「检测 N」自评单元标题');
  else if (quizzes < 3) warns.push(`自评单元只有 ${quizzes} 道（一段通常 3–5 道）`);
  else if (quizzes > 8) warns.push(`自评单元 ${quizzes} 道偏多（单页建议 ≤8，按分段配额控制）`);

  // 页码引用：接受「课件 p12」「（p12）」「课件第 12 页」三种写法
  const cites = [...src.matchAll(/(?:课件\s*)?p\s*\d{1,3}\b|第\s*\d{1,3}\s*页/g)].length;
  if (cites === 0 && !ALLOW_NO_CITE) problems.push('整段没有页码引用（每条事实/解析都要能指到课件页码）');
  else if (cites < quizzes) warns.push(`页码引用 ${cites} 处，少于检测题数 ${quizzes}（解析里每题都应有页码）`);

  // 6.5) 标签配平（防止 producer 被截断：文件结尾停在 <blockquote> 中间）
  {
    const pairs = ['p', 'blockquote', 'table', 'ul', 'li', 'tr', 'td', 'th', 'div', 'h2', 'h3', 'strong', 'code', 'pre'];
    const unbalanced = [];
    for (const tag of pairs) {
      const open = (src.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) || []).length;
      const close = (src.match(new RegExp(`</${tag}\\s*>`, 'g')) || []).length;
      if (open !== close) unbalanced.push(`${tag}: ${open} 开 / ${close} 闭`);
    }
    if (unbalanced.length) problems.push(`标签未配平（可能被截断）：${unbalanced.join('；')}`);
  }

  // 7) 图片与字符画
  const imgs = [...src.matchAll(/<img\b[^>]*src\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
  const badImg = imgs.filter((s) => !/\.(webp|svg)$/i.test(s) || /^https?:|^\/\//i.test(s));
  if (badImg.length) problems.push(`图片不合规（只允许站内 .webp/.svg）：${badImg.slice(0, 3).join(', ')}`);
  if (BOX_CHARS.test(src)) problems.push('正文出现字符画（制表符/盒线字符）——请改用 Mermaid');

  return {
    file,
    problems,
    warns,
    stats: { h2: (src.match(/<h2\b/gi) || []).length, h3: heads.length - (src.match(/<h2\b/gi) || []).length, quizzes, cites, mermaid: mermaidOpens },
  };
}

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('用法: node tools/lint-fragment.mjs <片段.html> [更多片段…]');
  process.exit(1);
}

let bad = 0;
for (const f of files) {
  const r = lint(f);
  const st = r.stats ? `h2=${r.stats.h2} h3=${r.stats.h3} 检测=${r.stats.quizzes} 引用=${r.stats.cites} mermaid=${r.stats.mermaid}` : '';
  if (r.problems.length) {
    bad++;
    console.log(`\x1b[31m✗\x1b[0m ${f}  ${st}`);
    for (const p of r.problems) console.log('   · ' + p);
  } else {
    console.log(`\x1b[32m✓\x1b[0m ${f}  ${st}`);
  }
  for (const w of r.warns) console.log('   \x1b[33m!\x1b[0m ' + w);
}

if (bad) {
  console.log(`\n\x1b[31m${bad} 个片段有问题\x1b[0m`);
  process.exit(1);
}
console.log('\n\x1b[32m片段预检通过\x1b[0m');
