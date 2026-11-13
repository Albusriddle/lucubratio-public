// 本地「全部检查」跨平台 runner：覆盖 ci.yml 的全部检查 + 两条本地守则检查
//
// 用法：npm run test:all   或   node scripts/test-all.mjs
//
// 为什么不用 shell 串起来：npm 在 Windows 走 cmd.exe，`for f in …; do … done` 直接语法错，
// 而 CI 在 Linux 上又完全正常——两边不一致最坑。这里统一用 Node 顺序执行。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const NODE = process.execPath;

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

/** 跑一个子命令，失败即抛（供 custom 步骤复用） */
const run = (args) => execFileSync(NODE, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });

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
  // —— 与 ci.yml 对齐的两步（原本只写在 CI 里）——
  { name: '空构建冒烟（build --empty → verify → 恢复构建）', custom: () => {
      run(['scripts/build.mjs', '--empty']);
      try {
        run(['scripts/verify.mjs']);
      } finally {
        run(['scripts/build.mjs']); // 无论校验成败都要恢复常规产物，否则后面全错
      }
    } },
  { name: '多段合并冒烟（merge-pages）', custom: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-merge-'));
      const f1 = path.join(tmp, 'f1.html');
      const f2 = path.join(tmp, 'f2.html');
      fs.writeFileSync(f1, '<h2 id="1-甲">1. 甲</h2>\n<h3 id="检测 1">检测 1（10 分）题干</h3>\n');
      fs.writeFileSync(f2, '<h2 id="2-乙">2. 乙</h2>\n<h3 id="检测 1">检测 1（10 分）题干</h3>\n');
      const out = path.join(tmp, 'merged.html');
      run(['tools/merge-pages.mjs', out, f1, f2]);
      const merged = fs.readFileSync(out, 'utf8');
      if (!merged.includes('id="检测 2"')) throw new Error('merge-pages 没有把重复题号重编号');
    } },
  { name: '导航守则（禁止裸 location 跳转）', custom: () => { run(['scripts/check-nav.mjs']); } },
  // —— 本地守则：CHANGELOG 结构（实现见 scripts/check-changelog.mjs，CI 也调它）——
  ['CHANGELOG 结构', ['scripts/check-changelog.mjs']],
];

let failed = 0;
for (const step of steps) {
  const name = Array.isArray(step) ? step[0] : step.name;
  const args = Array.isArray(step) ? step[1] : null;
  process.stdout.write(`${DIM('▸')} ${name} … `);
  try {
    const out = step.custom ? (step.custom(), '完成') : run(args);
    const tail = out.trim().split('\n').filter(Boolean).pop() || 'ok';
    console.log(GREEN('✓') + ' ' + DIM(tail.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 70)));
  } catch (e) {
    failed++;
    console.log(RED('✗'));
    const text = ((e.stdout || '') + (e.stderr || '') + '\n' + (e.message || '')).replace(/\x1b\[[0-9;]*m/g, '');
    console.log(text.split('\n').filter((l) => l.trim()).slice(-12).map((l) => '   ' + l).join('\n'));
    break;
  }
}

console.log('');
if (failed) {
  console.log(RED('test:all 失败（见上方最后一步的输出）'));
  process.exit(1);
}
console.log(GREEN(`test:all 全部通过（${steps.length} 步）`));
