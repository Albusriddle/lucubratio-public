// 纯函数单元测试（Node 直跑，不需要浏览器）
// 覆盖：日期格式化（跨天判断）、FSRS 调度确定性、ASCII→SVG 转换
import assert from 'node:assert/strict';
import { dayKey, addDays, startOfDay, dayDiff, fmtDue, fmtDueShort } from '../web/shell/time.js';
import { emptyRecord, schedule, preview, RATING } from '../web/shell/fsrs.js';
import { asciiToSvg } from './lib/ascii-svg.mjs';
import { looksFormula, formulaToTex } from './lib/formula.mjs';

let passed = 0;
const ok = (name) => { passed++; console.log('\x1b[32m✓\x1b[0m ' + name); };
const fail = [];
function check(name, fn) {
  try { fn(); ok(name); } catch (e) { fail.push(name + ' → ' + e.message); console.log('\x1b[31m✗\x1b[0m ' + name); }
}

// ---------- time.js ----------
const now = new Date(2026, 10, 6, 11, 53, 0).getTime();   // 2026-11-06 11:53 本地时间

check('dayKey 使用本地日期', () => {
  assert.equal(dayKey(now), '2026-11-06');
  assert.equal(dayKey(addDays(now, 1)), '2026-11-07');
});

check('addDays 走日历而非 +86400000', () => {
  const n = new Date(2026, 2, 8, 0, 30, 0).getTime();      // 非整点，跨月
  assert.equal(dayKey(addDays(n, 1)), '2026-03-09');
  assert.equal(dayKey(addDays(n, -8)), '2026-02-28');
});

check('fmtDue：+24h 之内但已是明天 → 显示「明天」而不是「今天」', () => {
  const due = now + 24 * 3600 * 1000 - 2 * 60 * 1000;      // 明天 11:51
  assert.equal(dayKey(due), '2026-11-07');
  assert.equal(fmtDue(due, now), '明天');
});

check('fmtDue：同一天显示「今天 HH:MM」', () => {
  const due = new Date(2026, 10, 6, 13, 30, 0).getTime();
  assert.equal(fmtDue(due, now), '今天 13:30');
});

check('fmtDue：3 天后 / 跨月日期', () => {
  assert.equal(fmtDue(addDays(now, 3), now), '3 天后');
  assert.equal(fmtDue(new Date(2026, 11, 20, 9, 0, 0).getTime(), now), '12月20日');
});

check('fmtDue：1 分钟内显示「现在」', () => {
  assert.equal(fmtDue(now + 30000, now), '现在');
});

check('fmtDueShort：分钟/小时/明天', () => {
  assert.equal(fmtDueShort(now + 5 * 60 * 1000, now), '5 分钟后');
  assert.equal(fmtDueShort(now + 3 * 3600 * 1000, now), '3 小时后');
  assert.equal(fmtDueShort(now + 24 * 3600 * 1000, now), '明天');
  assert.equal(fmtDueShort(now + 4 * 24 * 3600 * 1000, now), '4 天后');
});

check('dayDiff 按日历日计算', () => {
  assert.equal(dayDiff(now, addDays(now, 1)), 1);
  assert.equal(dayDiff(startOfDay(now), now), 0);
});

// ---------- fsrs.js ----------
check('新卡评分后 due 在未来且 reps=1', () => {
  const nowMs = Date.now();
  const rec = emptyRecord('t1', new Date(nowMs));
  const out = schedule(rec, RATING.Good, new Date(nowMs));
  assert.ok(out.card.due > nowMs, 'due 应在未来');
  assert.equal(out.card.reps, 1);
  assert.ok(out.card.stability > 0);
});

check('同样输入得到同样输出（已关闭 fuzz）', () => {
  const base = emptyRecord('t2', new Date(1700000000000));
  const a = schedule(base, RATING.Good, new Date(1700000000000));
  const b = schedule(base, RATING.Good, new Date(1700000000000));
  assert.equal(a.card.due, b.card.due);
  assert.equal(a.card.stability, b.card.stability);
  assert.equal(a.card.difficulty, b.card.difficulty);
});

check('复习态四档评分的间隔单调不减（Again ≤ Hard ≤ Good ≤ Easy）', () => {
  const t0 = 1700000000000;
  let rec = emptyRecord('t3', new Date(t0));
  rec = schedule(rec, RATING.Good, new Date(t0)).card;         // New → Learning
  rec = schedule(rec, RATING.Good, new Date(t0 + 600000)).card; // Learning → Review
  const p = preview(rec, new Date(t0 + 3 * 86400000));
  assert.ok(p[1] && p[2] && p[3] && p[4], '四档都应可预览');
  assert.ok(p[1].due <= p[2].due, 'Again ≤ Hard');
  assert.ok(p[2].due <= p[3].due, 'Hard ≤ Good');
  assert.ok(p[3].due <= p[4].due, 'Good ≤ Easy');
});

// ---------- ascii-svg ----------
check('ASCII 图转 SVG：宽度按全角 2 格计算', () => {
  const r = asciiToSvg(['┌──┐', '│中│', '└──┘'].join('\n'));
  assert.equal(r.cols, 8, '4 个全角字符 = 8 格');
  assert.equal(r.rows, 3);
  assert.ok(r.svg.includes('viewBox="0 0 56 45"'), '56 = 8×7, 45 = 3×15');
});

check('ASCII 图转 SVG：制表符画成 path，文字锁定宽度', () => {
  const r = asciiToSvg(['┌─┐', '│中│', '└─┘'].join('\n'));
  assert.ok(r.svg.includes('<path'), '应有线条路径');
  assert.ok(r.svg.includes('<text'), '应有文字');
  assert.ok(r.svg.includes('textLength='), '文字必须锁定宽度');
  assert.ok(r.boxes >= 8, '至少 8 个制表符被绘制');
});

check('ASCII 图转 SVG：无制表符时不画线（是否转换由 build 的 BOX_CHARS 守卫决定）', () => {
  const r = asciiToSvg(['int main() {', '  return 0;', '}'].join('\n'));
  assert.ok(!r.svg.includes('<path'), '代码块不应该产生线条');
  assert.ok(r.svg.includes('<text'), '文字仍然正常排版');
});

// ---------- formula ----------
check('looksFormula：明显是公式的要认', () => {
  assert.equal(looksFormula('T周转 = T完成 − T到达'), true);
  assert.equal(looksFormula('CPU利用率 = 忙/总 × 100%'), true);
  assert.equal(looksFormula('q = 10 ms'), true);
});

check('looksFormula：代码/多等号/无符号要拒', () => {
  assert.equal(looksFormula('errno = ECHILD'), false);
  assert.equal(looksFormula('if (rc == 0)'), false);
  assert.equal(looksFormula('pass += stride'), false);
  assert.equal(looksFormula('a = 1 = 2'), false);
  assert.equal(looksFormula('PID'), false);
});

check('formulaToTex：汉字下标', () => {
  assert.equal(formulaToTex('T周转 = T完成'), 'T_{\\text{周转}} = T_{\\text{完成}}');
});

check('formulaToTex：不会出现 \\text{\\text{\u2026}} 嵌套', () => {
  const tex = formulaToTex('T响应 = T首次运行 − T到达');
  assert.equal(tex.indexOf('\\text{\\text{'), -1);
  assert.ok(tex.indexOf('T_{\\text{首次运行}}') >= 0);
});

check('formulaToTex：三字母以上缩写整体当文本', () => {
  assert.equal(formulaToTex('CPU利用率 = 忙/总'), '\\text{CPU利用率} = \\frac{\\text{忙}}{\\text{总}}');
});

check('formulaToTex：乘除与百分号', () => {
  assert.ok(formulaToTex('6 ÷ 7 = 0.857').indexOf('\\div') >= 0);
  assert.ok(formulaToTex('a × b = c').indexOf('\\times') >= 0);
  assert.ok(formulaToTex('x = 50%').indexOf('\\%') >= 0);
});

check('formulaToTex：单位用正体', () => {
  assert.ok(formulaToTex('q = 10 ms').indexOf('\\text{ms}') >= 0);
});

// ---------- 汇总 ----------
console.log('');
if (fail.length) {
  for (const f of fail) console.log('\x1b[31m✗\x1b[0m ' + f);
  console.log(`\n\x1b[31m单元测试失败：${fail.length} 项\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32m单元测试通过（${passed} 项）\x1b[0m`);
