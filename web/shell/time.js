/* ============================================================
   Lucubratio · 时间工具（纯函数，可在 Node 里直接单测）
   规则一律按【日历日】判断，不用"毫秒差 < 86400000"这种近似，
   否则 due 在 24 小时内的前一刻会被显示成"今天"（实际是明天）。
   ============================================================ */

export function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 本地日期键：YYYY-MM-DD */
export function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 本地当天 0 点 */
export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 按日历加天（不用 +86400000，避免夏令时漂移） */
export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

function hhmm(ts) {
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 两个时间相差几个日历日（b 相对 a） */
export function dayDiff(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

/**
 * 长文案：用于内容页自评条
 * 现在 / 今天 11:55 / 明天 / 3 天后 / 11月9日
 */
export function fmtDue(ts, now) {
  const base = now || Date.now();
  if (ts - base <= 60000) return '现在';

  const a = dayKey(ts);
  const b = dayKey(base);
  if (a === b) return '今天 ' + hhmm(ts);
  if (a === dayKey(addDays(base, 1))) return '明天';

  const days = dayDiff(base, ts);
  if (days > 1 && days < 30) return days + ' 天后';

  const d = new Date(ts);
  return d.getMonth() + 1 + '月' + d.getDate() + '日';
}

/**
 * 短文案：用于复习页四个按钮上的下次间隔
 * 马上 / 5 分钟后 / 3 小时后 / 明天 / 4 天后
 */
export function fmtDueShort(ts, now) {
  const base = now || Date.now();
  const diff = ts - base;
  if (diff <= 60000) return '马上';
  if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + ' 分钟后';

  const a = dayKey(ts);
  const b = dayKey(base);
  if (a === b) return Math.round(diff / 3600000) + ' 小时后';
  if (a === dayKey(addDays(base, 1))) return '明天';

  const days = dayDiff(base, ts);
  return Math.max(2, days) + ' 天后';
}
