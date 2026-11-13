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

// 同一道门可能有多轮记录（gate-ch1.md / gate-ch1-r2.md / gate-ch1-r3.md）：
// 只认**最新一轮**——早先轮次的不通过记录是历史，不该永久拉红。
const families = new Map();
for (const f of files) {
  const base = f.replace(/\.md$/, '');
  const m = base.match(/^(gate-.+?)(?:-r(\d+))?$/);
  const family = m ? m[1] : base;
  const round = m && m[2] ? Number(m[2]) : 1;
  const prev = families.get(family);
  if (!prev || round > prev.round) families.set(family, { round, file: f, base });
}

const fails = [];
const oks = [];

if (families.size === 0) {
  fails.push('目录里没有任何 gate-*.md（等同于没审就进下一步）');
}

for (const [family, info] of [...families].sort((a, b) => a[0].localeCompare(b[0]))) {
  const s = fs.readFileSync(path.join(dir, info.file), 'utf8');
  const nums = [...s.matchAll(/问题\s*[=＝]\s*(\d+)/g)].map((m) => Number(m[1]));
  const bad = [];
  if (/结论[：:]\s*不通过/.test(s)) bad.push(`最新一轮（${info.file}）写着「不通过」`);
  if (!/结论[：:]\s*通过/.test(s)) bad.push(`最新一轮（${info.file}）缺少「结论：通过」`);
  if (nums.some((n) => n > 0)) bad.push(`最新一轮问题数不为 0（${nums.filter((n) => n > 0).join('/')}）`);
  if (bad.length) fails.push(`${family}: ${bad.join('；')}`);
  else oks.push(`${family}（${info.file}，第 ${info.round} 轮）`);
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
