#!/usr/bin/env node
/**
 * CHANGELOG 结构守则（CI 与本地 test:all 共用这一份实现）。
 *
 * 规则：
 *  1. 必须有 [Unreleased] 段，且在所有版本段之前
 *  2. 「（暂无）」最多 1 处，且必须落在 [Unreleased] 段内
 *     （历史事故：插新版本段时把旧占位符一段段往下挤，最终出现 4 处孤立占位符）
 *  3. 版本段不能重复，且必须从新到旧排列
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const lines = md.split('\n');

function fail(msg) {
  console.error('✗ CHANGELOG 结构检查失败：' + msg);
  process.exit(1);
}

const placeholders = lines.filter((l) => l.trim() === '（暂无）').length;
if (placeholders > 1) {
  const at = lines.map((l, i) => (l.trim() === '（暂无）' ? i + 1 : 0)).filter(Boolean);
  fail(`「（暂无）」最多 1 处（且只能在 [Unreleased] 内），实际 ${placeholders} 处（行 ${at.join(', ')}）——多半是插入新版本段时把旧占位符往下挤了`);
}

const unrel = lines.findIndex((l) => l.startsWith('## [Unreleased]'));
if (unrel < 0) fail('缺少 [Unreleased] 段');

const firstVer = lines.findIndex((l, i) => i > unrel && /^## \[/.test(l));
if (placeholders === 1) {
  const ph = lines.findIndex((l) => l.trim() === '（暂无）');
  if (!(unrel < ph && (firstVer < 0 || ph < firstVer))) {
    fail(`「（暂无）」必须落在 [Unreleased] 段内（Unreleased 第 ${unrel + 1} 行、占位符第 ${ph + 1} 行、下一版本段第 ${firstVer + 1} 行）`);
  }
}

const anyVer = lines.findIndex((l) => /^## \[[0-9]/.test(l));
if (anyVer >= 0 && unrel > anyVer) fail('[Unreleased] 不是第一个段落（被插到文件中间了）');

const vers = lines
  .filter((l) => /^## \[[0-9]+\.[0-9]+\.[0-9]+\]/.test(l))
  .map((l) => l.slice(4).split(']')[0]);
if (new Set(vers).size !== vers.length) fail('版本段重复：' + vers.join(', '));

const nums = vers.map((v) => v.split('.').map(Number));
for (let i = 1; i < nums.length; i++) {
  const [a, b] = [nums[i - 1], nums[i]];
  const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (cmp <= 0) fail(`版本段未按从新到旧排列：${vers[i - 1]} 排在 ${vers[i]} 之前`);
}

console.log(`✓ CHANGELOG 结构正常（${vers.length} 个版本段：${vers[0]} … ${vers[vers.length - 1]}）`);
