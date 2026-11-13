#!/usr/bin/env node
/**
 * 导航守则：所有页面跳转/刷新都必须走统一过渡入口
 *
 * 为什么需要：
 *   动效（幕布 / View Transitions）只在 window.saLeave / saReload 里实现一次。
 *   一旦某处直接写 location.href = … 或 location.reload()，那一次跳转就变成瞬切，
 *   而且没有任何测试会红——只能靠人眼看出来。2026-11 就漏过 5 处。
 *
 * 规则：
 *   · 除 shell/boot.js（唯一实现处）外，禁止裸 `location.href =` / `location.reload(`
 *   · 允许的兜底行必须带注释标记 `sa-nav-fallback`
 *     （形如：`window.saLeave ? window.saLeave(u) : (location.href = u); // sa-nav-fallback`）
 *
 * 用法：node scripts/check-nav.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const WEB = path.join(ROOT, 'web');
const SKIP = path.join('shell', 'boot.js');           // 唯一允许直接操作 location 的地方
const BARE = /location\.(href\s*=|reload\()/;

const offenders = [];
let scanned = 0;

(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'vendor' || e.name === '_dev') continue;   // 第三方库不参与守则
      walk(full);
      continue;
    }
    if (!/\.(js|html)$/.test(e.name)) continue;
    if (/\.min\.js$/.test(e.name)) continue;                    // 压缩库同理
    if (full.endsWith(SKIP)) continue;
    scanned++;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!BARE.test(line)) return;
      if (line.includes('sa-nav-fallback')) return;
      offenders.push(`${path.relative(ROOT, full)}:${i + 1}  ${line.trim().slice(0, 70)}`);
    });
  }
})(WEB);

if (offenders.length) {
  console.error('✗ 导航守则失败：以下跳转没有走统一过渡入口（window.saLeave / saReload）：');
  for (const o of offenders) console.error('  · ' + o);
  console.error('\n  改法：把 location.href = u 换成 window.saLeave(u)；location.reload() 换成 window.saReload()。');
  console.error('  若确实需要在入口不存在时兜底，请在行尾加注释 // sa-nav-fallback');
  process.exit(1);
}
console.log(`✓ 导航守则通过：${scanned} 个页面/脚本，全部走 saLeave / saReload`);
