#!/usr/bin/env node
/**
 * 复核门禁检查（红线 3 的机械化）
 *
 * 用法：
 *   node scripts/check-gates.mjs .work/net/reviews
 *   node scripts/check-gates.mjs .work/net/reviews --require ch1 ch2 …  # 额外要求这些门禁文件存在
 *
 * 规则（与 AGENTS.md 红线 3 一致）：
 *   1. 目录里每个 `gate-*.md` 都是一道门禁记录，必须含「结论：通过」；
 *   2. 文件里出现「不通过」，或「问题=N」中 N>0，即判该门禁失败；
 *   3. 显式 `--require` 列出的门禁必须存在，缺失也算失败（防止漏审就打包）；
 *   4. 有任何失败 → 退出码 1，**不许打包/发版**。
 *
 * 为什么要这个脚本：铁律靠人记会漏。打包前跑一次，把「审没审、过没过」变成可执行判断。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) || '.work/reviews';
const requireIdx = args.indexOf('--require');
let required = requireIdx >= 0 ? args.slice(requireIdx + 1) : [];

// 没有显式 --require 时，用 package.json 的 gateChecks（有课程在制的仓库才配这个字段）
if (required.length === 0) {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (Array.isArray(pkg.gateChecks)) required = pkg.gateChecks;
  } catch {}
}

if (!dir) {
  console.error('用法: node scripts/check-gates.mjs <reviews 目录> [--require gate-xxx …]');
  process.exit(2);
}
if (!fs.existsSync(dir)) {
  if (required.length) {
    console.error(`✗ 复核目录不存在：${dir}（但 package.json 里声明了 gateChecks）`);
    process.exit(1);
  }
  console.log(`· 跳过：没有 ${dir}，且本仓库未声明 gateChecks（无课程在制）`);
  process.exit(0);
}

const files = fs.readdirSync(dir).filter((f) => /^gate-.*\.md$/.test(f)).sort();
const fails = [];
const oks = [];

if (files.length === 0) {
  fails.push('目录里没有任何 gate-*.md（等同于没审就进下一步）');
}

for (const f of files) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  const name = f.replace(/\.md$/, '');
  const nums = [...s.matchAll(/问题\s*[=＝]\s*(\d+)/g)].map((m) => Number(m[1]));
  const bad = [];

  if (/结论[：:]\s*不通过/.test(s)) bad.push('结论写着「不通过」');
  if (!/结论[：:]\s*通过/.test(s)) bad.push('缺少「结论：通过」');
  if (nums.some((n) => n > 0)) bad.push(`报告里的问题数不为 0（${nums.filter((n) => n > 0).join('/')}）`);
  if (/问题清单[：:]\s*(?!无)/.test(s) && /^\|/m.test(s) && !/问题清单[：:]\s*无/.test(s)) {
    bad.push('含问题清单表格（疑似未清零）');
  }

  if (bad.length) fails.push(`${name}: ${bad.join('；')}`);
  else oks.push(name);
}

for (const r of required) {
  const hit = files.some((f) => f.replace(/\.md$/, '') === r || f.startsWith(r));
  if (!hit) fails.push(`缺少必需门禁记录：${r}`);
}

for (const o of oks) console.log(`✓ 门禁通过  ${o}`);
if (fails.length) {
  console.error('\n✗ 复核门禁未通过：');
  for (const f of fails) console.error('  · ' + f);
  console.error('\n按红线 3：修完必须重走对应门禁，直到这里只剩 ✓。');
  process.exit(1);
}
console.log(`\n✓ 全部 ${oks.length} 道复核门禁通过`);
