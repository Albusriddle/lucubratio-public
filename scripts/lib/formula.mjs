/* ============================================================
   把"纯文本公式"翻译成 LaTeX（构建期用，无运行时依赖）
   规则很保守：只认得出形状的，认不出就返回 null 让调用方保留原文。
   ============================================================ */

/** 看起来像公式？—— 恰好 1 个等号、含数学符号、没有代码形状 */
export function looksFormula(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t || t.length > 60) return false;
  if (!/[=×÷Σ−]/.test(t)) return false;
  if (/[;{}()\[\]]|==|->|\|\||&&|\+=|-=|->|\bif\b|\bfor\b|\bwhile\b|\breturn\b|#|%[a-z]|\berrno\b/.test(t)) return false;
  return (t.match(/=/g) || []).length === 1;
}

/**
 * 纯文本 → LaTeX
 *   T周转 = T完成 − T到达   →  T_{\text{周转}} = T_{\text{完成}} - T_{\text{到达}}
 *   CPU利用率 = 忙/总 × 100%  →  \text{CPU利用率} = \frac{\text{忙}}{\text{总}} \times 100\%
 */
export function formulaToTex(text) {
  let out = String(text).trim();

  // 多字母缩写 + 汉字 → 整体当文本（CPU利用率，而不是 CPU_{利用率}）
  out = out.replace(/([A-Za-z]{3,})([\u4e00-\u9fa5]+)/g, (m, v, cjk) => '\\text{' + v + cjk + '}');

  // 把已经包好的 \text{…} 先保护起来，避免后面的规则钻进里面再匹配一次
  const texts = [];
  out = out.replace(/\\text\{[^{}]*\}/g, (m) => {
    texts.push(m);
    return '\u0003' + (texts.length - 1) + '\u0004';
  });

  // 单字母 + 汉字 → 下标（先占位，避免后面被二次包成 \text{\text{…}}）
  const subs = [];
  out = out.replace(/([A-Za-z])([\u4e00-\u9fa5]+)/g, (m, v, cjk) => {
    subs.push(cjk);
    return v + '\u0001' + (subs.length - 1) + '\u0002';
  });

  out = out.replace(/[\u4e00-\u9fa5]+/g, (m) => '\\text{' + m + '}');
  out = out.replace(/\u0001(\d+)\u0002/g, (m, i) => '_{\\text{' + subs[Number(i)] + '}}');
  out = out.replace(/\u0003(\d+)\u0004/g, (m, i) => texts[Number(i)]);

  // 分式：两侧都不跨过 = × ÷ + − 和空白
  out = out.replace(/([^\s=×÷+\-]{1,40})\s*\/\s*([^\s=×÷+\-]{1,40})/g,
    (m, a, b) => '\\frac{' + a + '}{' + b + '}');

  out = out
    .replace(/Σ/g, '\\sum ')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/−/g, '-')
    .replace(/%/g, '\\%');

  // 单位（ms / μs / us / ns / s）跟在数字后面时用正体
  out = out.replace(/(\d)\s*(ms|μs|us|ns|s)\b/g, (m, d, u) => d + '\\,\\text{' + u + '}');
  return out;
}
