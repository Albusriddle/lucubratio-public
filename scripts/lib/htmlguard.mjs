// 标签级 HTML 安全扫描器（零依赖）
//
// 为什么不用正则：属性可以写成 "x"、'x'、x（无引号），标签可以自闭合、可以有注释，
// 文本与属性都可能藏着实体编码（&#106;avascript:）。正则追不上这些写法，
// 只会给"看起来通过了"的假安全。这里按 HTML 的语法把标签与属性真正切出来再判。
//
// 允许的东西（课程包里合法）：
//   · <script type="text/plain">…</script>   放 Mermaid 源码（不执行）
//   · <script src="/shell/*.js">              壳层脚本（由 App 内置提供）
//   · <link href="/shell/*.css">              壳层样式
//   · 内联 <style>                            页面自带样式（但不得引外部资源）
// 禁止：其它任何 <script>、on* 事件属性、外链资源、javascript:、iframe/object/embed/base 等。

const FORBIDDEN_TAGS = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'portal']);
const URL_ATTRS = new Set([
  'src', 'href', 'poster', 'background', 'data', 'formaction', 'action', 'srcset', 'xlink:href', 'manifest',
]);

/** 解码常见 HTML 实体（只解一层，防双重编码绕过靠后面的 scheme 归一化） */
export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);?/gi, (m, h) => safeCP(parseInt(h, 16), m))
    .replace(/&#(\d+);?/g, (m, d) => safeCP(parseInt(d, 10), m))
    .replace(/&(amp|lt|gt|quot|apos|colon|sol|tab|newline|nbsp);?/gi, (m, e) => {
      const map = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':',
        sol: '/', tab: '\t', newline: '\n', nbsp: ' ',
      };
      return map[e.toLowerCase()] ?? m;
    });
}

function safeCP(cp, fallback) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return fallback;
  try { return String.fromCodePoint(cp); } catch { return fallback; }
}

/** 把 URL 归一化后判断是否是"外部/可执行"资源 */
function isBadUrl(raw) {
  const v = decodeEntities(raw).replace(/[\u0000-\u0020\u00a0]/g, '').toLowerCase();
  if (!v) return false;
  if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return true;
  if (v.startsWith('data:') && (v.startsWith('data:text/html') || v.startsWith('data:image/svg'))) return true;
  if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('//')) return true;
  return false;
}

/** 解析一个开标签的属性列表（调用时 i 指向标签名之后） */
function parseAttrs(html, i) {
  const n = html.length;
  const attrs = [];
  let selfClose = false;
  let j = i;
  while (j < n) {
    while (j < n && /\s/.test(html[j])) j++;
    if (j >= n) break;
    if (html[j] === '>') { j++; break; }
    if (html[j] === '/' && html[j + 1] === '>') { selfClose = true; j += 2; break; }
    // 属性名（直到 = / 空白 / >）
    let k = j;
    while (k < n && !/[\s=/>]/.test(html[k])) k++;
    if (k === j) { j++; continue; }
    const name = html.slice(j, k).toLowerCase();
    j = k;
    while (j < n && /\s/.test(html[j])) j++;
    let value = '';
    if (html[j] === '=') {
      j++;
      while (j < n && /\s/.test(html[j])) j++;
      const q = html[j];
      if (q === '"' || q === "'") {
        const end = html.indexOf(q, j + 1);
        value = html.slice(j + 1, end < 0 ? n : end);
        j = end < 0 ? n : end + 1;
      } else {
        let e = j;
        while (e < n && !/[\s>]/.test(html[e])) e++;
        value = html.slice(j, e);
        j = e;
      }
    }
    attrs.push({ name, value });
  }
  return { attrs, selfClose, next: j };
}

/**
 * 扫描一段 HTML，返回违规列表。
 * @param {string} html
 * @returns {{rule:string, tag:string, detail:string, snippet:string}[]}
 */
export function scanHtml(html) {
  const out = [];
  const n = html.length;
  let i = 0;
  const push = (rule, tag, detail, at) => {
    out.push({ rule, tag, detail, snippet: html.slice(Math.max(0, at - 30), at + 60).replace(/\s+/g, ' ') });
  };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;

    // 注释
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    // <!doctype> / <![CDATA[ / <?xml
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    // 结束标签
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    // 开标签
    const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!m) { i = lt + 1; continue; }
    const tag = m[1].toLowerCase();
    const { attrs, next } = parseAttrs(html, lt + m[0].length);
    const attrMap = new Map(attrs.map((a) => [a.name, a.value]));

    /* ---- 规则 1：禁止的标签 ---- */
    if (FORBIDDEN_TAGS.has(tag)) push('forbidden-tag', tag, `<${tag}> 不允许出现在课程包里`, lt);

    /* ---- 规则 2：meta refresh ---- */
    if (tag === 'meta') {
      const he = decodeEntities(attrMap.get('http-equiv') || '').toLowerCase().trim();
      if (he === 'refresh') push('meta-refresh', tag, 'meta http-equiv=refresh 可跳转外链', lt);
    }

    /* ---- 规则 3：on* 事件属性 ---- */
    for (const a of attrs) {
      if (/^on[a-z]/.test(a.name)) push('inline-handler', tag, `属性 ${a.name}= 不允许（内联事件）`, lt);
    }

    /* ---- 规则 4：URL 类属性不得指向外部/可执行 ---- */
    for (const a of attrs) {
      if (!URL_ATTRS.has(a.name)) continue;
      if (isBadUrl(a.value)) push('external-url', tag, `${a.name}="${decodeEntities(a.value).slice(0, 60)}" 指向外部或可执行资源`, lt);
    }

    /* ---- 规则 5：link 只允许 /shell/ ---- */
    if (tag === 'link') {
      const href = decodeEntities(attrMap.get('href') || '').trim();
      if (!href.startsWith('/shell/')) push('bad-link', tag, `link href="${href.slice(0, 60)}" 只允许 /shell/`, lt);
    }

    /* ---- 规则 6：script 白名单 ---- */
    if (tag === 'script') {
      const src = decodeEntities(attrMap.get('src') || '').trim();
      const type = decodeEntities(attrMap.get('type') || '').trim().toLowerCase();
      if (src) {
        if (!src.startsWith('/shell/')) push('bad-script-src', tag, `script src="${src.slice(0, 60)}" 只允许 /shell/`, lt);
      } else if (type !== 'text/plain') {
        push('inline-script', tag, '内联 <script> 不允许（Mermaid 源码请用 type="text/plain"）', lt);
      }
      // 跳过原文内容
      const close = html.toLowerCase().indexOf('</script', next);
      i = close < 0 ? n : close;
      continue;
    }

    /* ---- 规则 7：style 原文里不得引外部资源 ---- */
    if (tag === 'style') {
      const close = html.toLowerCase().indexOf('</style', next);
      const css = html.slice(next, close < 0 ? n : close);
      if (/@import/i.test(css)) push('style-import', tag, '<style> 内出现 @import', lt);
      for (const mm of css.matchAll(/url\(\s*['"]?([^'")]+)/gi)) {
        if (isBadUrl(mm[1])) push('style-url', tag, `<style> 内 url(${decodeEntities(mm[1]).slice(0, 50)}) 指向外部资源`, lt);
      }
      i = close < 0 ? n : close;
      continue;
    }

    if (tag === 'textarea' || tag === 'title') {
      const close = html.toLowerCase().indexOf('</' + tag, next);
      i = close < 0 ? n : close;
      continue;
    }

    i = next;
  }
  return out;
}
