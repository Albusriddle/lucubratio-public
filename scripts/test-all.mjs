// 本地「全部检查」跨平台 runner：与 CI 跑同一套（Windows 的 cmd 不认 bash 的 for/do）
//
// 用法：npm run test:all   或   node scripts/test-all.mjs
//
// 为什么不用 shell 串起来：npm 在 Windows 走 cmd.exe，`for f in …; do … done` 直接语法错，
// 而 CI 在 Linux 上又完全正常——两边不一致最坑。这里统一用 Node 顺序执行。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const NODE = process.execPath;

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const contentPages = fs
  .readdirSync(path.join(ROOT, 'content/os'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => path.join('content/os', f));

/** 依序执行；任一失败即停 */
const steps = [
  ['构建', ['scripts/build.mjs']],
  ['校验产物', ['scripts/verify.mjs']],
  ['单元测试', ['scripts/test.mjs']],
  ['课程库自测', ['scripts/test-library.mjs']],
  ['打包/校验自测', ['scripts/test-package.mjs']],
  ['片段预检（内容页）', ['tools/lint-fragment.mjs', ...contentPages, '--page', '--allow-no-cite']],
  ...contentPages.map((p) => [`题目自检 ${path.basename(p)}`, ['tools/self-check-quizzes.mjs', p, '--allow-no-cite']]),
];

let failed = 0;
for (const [name, args] of steps) {
  process.stdout.write(`${DIM('▸')} ${name} … `);
  try {
    const out = execFileSync(NODE, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    const tail = out.trim().split('\n').filter(Boolean).pop() || 'ok';
    console.log(GREEN('✓') + ' ' + DIM(tail.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 70)));
  } catch (e) {
    failed++;
    console.log(RED('✗'));
    const text = ((e.stdout || '') + (e.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
    console.log(text.split('\n').filter((l) => l.trim()).slice(-12).map((l) => '   ' + l).join('\n'));
    break;
  }
}

console.log('');
if (failed) {
  console.log(RED(`test:all 失败（在第 ${steps.findIndex((s) => s) + 1} 步）`));
  process.exit(1);
}
console.log(GREEN(`test:all 全部通过（${steps.length} 步）`));
