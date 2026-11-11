// 构建 Web 产物：web/（壳）+ content/（原文注入）→ android/app/src/main/assets/web/
// 用法：node scripts/build.mjs
// 约定：任何一处注入失败 / 内容为空 / 资源缺失 → 非零退出（防止静默产出空壳）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { asciiToSvg, repairDiagram } from './lib/ascii-svg.mjs';
import { looksFormula, formulaToTex } from './lib/formula.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONTENT = path.join(ROOT, 'content');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'web');

// 只发布这些分组；新增科目时在这里加一行
const GROUPS = [
  { id: 'os', title: '操作系统 · 期中复习', dir: 'os' },
];

// 构建时跳过的开发用目录（不随包发布）
const DEV_DIRS = new Set(['_dev']);

// kicker → 首页徽章配色分类（白名单，不靠标题正则猜）
const KICKER_KIND = {
  总纲: 'memo',
  速记卡: 'memo',
  卷A: 'paper',
  卷B: 'paper',
  卷C: 'paper',
  卷D: 'paper',
  押题卷: 'paper',
};

/**
 * 每篇的"可自评单元"规则（显式声明，不做启发式猜测）。
 * 命中规则的标题会被打上 data-qid="<标题 id>"，运行时据此插入自评条。
 * 各卷结构不一致，所以必须逐篇配置；新增内容时若忘了配，构建会报错提醒。
 */
const QUESTION_RULES = {
  // 示例课程（content/os/01、02）用「检测 N（10 分）」作为自评单元标题。
  // 你接入自己的课程时，在这里加一条：  'os-99': { level: 3, test: /^检测\s*\d+/ },
  // 规则命中 = 该页出现自评条；某页配了规则却一个都没命中，构建会直接报错（防写错）。
  'os-06': { level: 3, test: /^检测\s*\d+/ },
  'os-07': { level: 3, test: /^检测\s*\d+/ },
  'os-09': { level: 3, test: /^检测\s*\d+/ },
  'os-04': { level: 3, test: /^检测\s*\d+/ },
  'os-05': { level: 3, test: /^检测\s*\d+/ },
  'os-08': { level: 3, test: /^检测\s*\d+/ },
  'os-03': { level: 3, test: /^检测\s*\d+/ },
  'os-10': { level: 3, test: /^检测\s*\d+/ },
  'os-11': { level: 3, test: /^检测\s*\d+/ },
  'os-12': { level: 3, test: /^检测\s*\d+/ },
  'os-01': { level: 3, test: /^检测\s*\d+/ },
  'os-02': { level: 3, test: /^检测\s*\d+/ },
};

const KJ = { reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m', cyan: '\x1b[36m', red: '\x1b[31m', yellow: '\x1b[33m' };
const log = (...a) => console.log(...a);

const errors = [];
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

function rimraf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory() && DEV_DIRS.has(e.name)) {
      log(`${KJ.dim}  · 跳过开发目录 ${e.name}/${KJ.reset}`);
      continue;
    }
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function pickTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i);
  if (h1) {
    const t = stripTags(h1[1]);
    if (t) return t;
  }
  const t = html.match(/<title>([^<]*)<\/title>/i);
  if (t) return t[1].split(' · ')[0].trim();
  return '(无标题)';
}

function pickKicker(html) {
  const k = html.match(/<div class="kicker">([\s\S]{0,60}?)<\/div>/i);
  return k ? stripTags(k[1]) : '';
}

/** 给命中的标题加 data-qid="<cid>#<标题id>"，返回 {html, count} */

/** 给表格统一套一层 .table-wrap
 *
 * 为什么要在构建期做：CSS 只能让「有 wrapper 的表格」横滑；
 * 没有 wrapper 的表格会把整页撑宽，手机会出现"整页左右拖"。
 * 实测某一版：170 个表格里只有 31 个带 wrapper（producer 手写的），其余 139 个都在撑宽页面。
 */
function wrapTables(html) {
  let count = 0;
  const out = html.replace(/<table\b[\s\S]*?<\/table>/g, (m, offset, whole) => {
    // 已经包在 .table-wrap 里就跳过
    const before = whole.slice(Math.max(0, offset - 400), offset);
    if (/<div[^>]*class="[^"]*table-wrap[^"]*"[^>]*>\s*$/.test(before)) return m;
    count += 1;
    return `<div class="table-wrap">${m}</div>`;
  });
  return { html: out, count };
}

function tagQuestions(html, rule, cid) {
  if (!rule) return { html, count: 0 };
  let count = 0;
  // 标题内容长度不设上限：题干可能很长（曾因 {0,200} 上限导致 2 道长题干题被静默漏标）
  const re = new RegExp(`<h(${rule.level})([^>]*)>([\\s\\S]*?)</h\\1>`, 'g');
  const out = html.replace(re, (m, lv, attrs, inner) => {
    if (!rule.test.test(stripTags(inner))) return m;
    const idMatch = attrs.match(/\sid="([^"]+)"/);
    if (!idMatch) return m;
    if (/\sdata-qid=/.test(attrs)) return m;
    count++;
    return `<h${lv}${attrs} data-qid="${cid}#${idMatch[1]}">${inner}</h${lv}>`;
  });
  return { html: out, count };
}

/** 从正文里切出「标题 + 该标题下的文字」，生成全文检索用的小节 */
function extractSections(html, cid) {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  let body = mainMatch ? mainMatch[1] : html;
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const sections = [];
  for (const chunk of body.split(/(?=<h[23]\b)/i)) {
    const hm = chunk.match(/^<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/i);
    const anchor = hm ? (hm[2].match(/\sid="([^"]+)"/) || [])[1] || '' : '';
    const head = hm ? stripTags(hm[3]) : '';
    const text = stripTags(chunk).slice(0, 2500);
    if (text.length < 8) continue;
    sections.push({ p: cid, a: anchor, h: head, x: text });
  }
  return sections;
}

/**
 * KaTeX（构建期依赖，不进 APK）
 * 仓库 package.json 是 "type":"module"，直接 require 那个 UMD 会拿到空命名空间，
 * 所以放到 vm 沙箱里按 CommonJS 跑一次。
 * 输出选 MathML：不需要额外 CSS / 字体文件，Chrome 109+ 原生支持（我们下限是 WebView 110）。
 */
let _katex = null;
function katex() {
  if (_katex) return _katex;
  const file = path.join(ROOT, 'scripts', 'vendor', 'katex.min.js');
  if (!fs.existsSync(file)) return null;
  const sandbox = { module: { exports: {} }, exports: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
  _katex = sandbox.module.exports;
  return _katex && typeof _katex.renderToString === 'function' ? _katex : null;
}

/** 行内/块级 LaTeX → MathML（渲染失败保留原文，不炸构建） */
function renderLatex(html) {
  const k = katex();
  if (!k) return { html, count: 0 };
  let count = 0;
  const out = html
    .replace(/\\\(([^\n]{1,400}?)\\\)/g, (m, tex) => {
      try { count++; return k.renderToString(tex, { output: 'mathml', throwOnError: false, displayMode: false }); }
      catch (e) { return m; }
    })
    .replace(/\\\[([^\n]{1,400}?)\\\]/g, (m, tex) => {
      try { count++; return k.renderToString(tex, { output: 'mathml', throwOnError: false, displayMode: true }); }
      catch (e) { return m; }
    });
  return { html: out, count };
}

/* ---------------- 表格里的"纯文本公式" → LaTeX → MathML ---------------- */

/** 处理 <pre> 之外所有 <code> 里的纯文本公式；渲染失败/警告就原样保留 */
function renderFormulaCodes(html) {
  const k = katex();
  if (!k) return { html, count: 0, skipped: 0 };
  let count = 0;
  let skipped = 0;

  const convert = (chunk) => chunk.replace(/<code>([^<]{1,80})<\/code>/g, (mm, text) => {
    if (!looksFormula(text)) return mm;
    const tex = formulaToTex(text);
    try {
      const rendered = k.renderToString(tex, { output: 'mathml', throwOnError: true, strict: 'error' });
      count += 1;
      return '<span class="sa-math">' + rendered + '</span>';
    } catch (e) {
      skipped += 1;
      return mm;
    }
  });

  // 代码块整段跳过（ASCII 图 / 代码示例里的 <code> 不能动）
  const parts = html.split(/(<pre[\s\S]*?<\/pre>)/i);
  const out = parts.map((p, i) => (i % 2 === 1 ? p : convert(p))).join('');
  return { html: out, count, skipped };
}

/** HTML 转义：让 mermaid 源码安全地放在 div 里，textContent 读出来即原文 */
function escapeText(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 纯文本块 → HTML：转义 + 把 **粗体** 还原成 <strong> */
function textBlockToHtml(text) {
  return escapeText(text).replace(/\*\*([^*\n]{1,80}?)\*\*/g, '<strong>$1</strong>');
}

/**
 * 纯公式 <pre> → 每行一个 MathML。
 * 前提：整块每一行都能被 KaTeX 无警告渲染，否则整块放弃、原样保留（多是 C 代码）。
 */
function renderFormulaBlocks(html) {
  const k = katex();
  if (!k) return { html, count: 0 };
  let count = 0;
  const out = html.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/gi, (m, attrs, inner) => {
    // 常见形态是 <pre><code>…</code></pre>，剥掉外壳再判
    let body = inner;
    const cm = inner.match(/^(\s*<code[^>]*>)([\s\S]*?)(<\/code>\s*)$/i);
    if (cm) body = cm[2];
    if (/[│┌┐└┘├┤┬┴┼─→←↑↓▼▶◀▲]/.test(body)) return m;
    if (body.indexOf('<') >= 0) return m;
    const lines = body.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return m;
    const rendered = [];
    try {
      for (const line of lines) {
        if (!looksFormula(line)) return m;
        rendered.push('<span class="sa-math">' +
          k.renderToString(formulaToTex(line), { output: 'mathml', throwOnError: true, strict: 'error' }) +
          '</span>');
      }
    } catch (e) {
      return m;
    }
    count += 1;
    return '<div class="formula-block">' + rendered.join('') + '</div>';
  });
  return { html: out, count };
}

const BOX_CHARS = /[│┌┐└┘├┤┬┴┼─▶◀▼▲→←↑↓]/;
// 图表文件的编号只按「含盒线字符」的块递增，箭头块不占号（否则内容增删会让索引整体错位）
const BOX_ONLY = /[│┌┐└┘├┤┬┴┼]/;   // 盒线：对应 <cid>-<n>.html
const DASH_ONLY = /[─]/;            // 纯横线/箭头时间线：对应 <cid>-d<n>.html

/**
 * 图表替换：扫描 content/diagrams/<cid>-<idx>.html，存在则整块替换对应 <pre>。
 * 不再手工维护映射表——新增一个文件即生效。
 */
const DIAGRAM_DIR = path.join(ROOT, 'content', 'diagrams');
function loadDiagramOverrides() {
  const map = {};
  if (!fs.existsSync(DIAGRAM_DIR)) return map;
  for (const f of fs.readdirSync(DIAGRAM_DIR)) {
    const m = f.match(/^(os-\d+)-(d?\d+)\.html$/);
    if (m) map[m[1] + '#' + m[2]] = path.join(DIAGRAM_DIR, f);
  }
  return map;
}
const DIAGRAM_OVERRIDES = loadDiagramOverrides();

/**
 * 内容里的字符画处理（三步，按优先级）：
 *
 * 1. **有图表替换文件** → 整块换成 content/diagrams/<cid>-<n>.html（通常是 Mermaid）。
 *    编号分两个独立序列：盒线块 `<cid>-<n>`、纯横线/时间轴块 `<cid>-d<n>`，
 *    这样在某页中间插入新图也不会让后面的编号整体错位。
 * 2. **没有替换文件** → 走 asciiToSvg：字符网格映射成内联 SVG
 *    （制表符画 <path>、文字用 textLength 锁宽、颜色 currentColor）。
 *    原因：Android 的 monospace 没有中文字形，汉字回退到比例字体
 *    （实测汉字 16px / 字母 9.6px = 1.67，而非等宽假设的 2.0），纯文本必然漂移。
 * 3. 转换前先跑 repairDiagram，把源文件里"竖线不在主干列上"的行吸附回主干列。
 *
 * 只处理含制表/横线字符的 <pre>；普通代码块（无这些字符）原样保留。
 */
function fixAsciiArt(html, cid) {
  let blocks = 0;
  let maxCols = 0;
  let artIndex = 0;
  let boxIndex = 0;
  let dashIndex = 0;
  const out = html.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/gi, (m, attrs, inner) => {
    if (!BOX_CHARS.test(inner)) return m;

    // 常见形态是 <pre><code>…</code></pre>，把 code 外壳剥掉只处理文本
    let text = inner;
    const cm = inner.match(/^(\s*<code[^>]*>)([\s\S]*?)(<\/code>\s*)$/i);
    if (cm) text = cm[2];
    if (text.indexOf('<') >= 0) return m; // 仍有标签，不动

    artIndex++;
    const boxArt = BOX_ONLY.test(text);
    const dashArt = DASH_ONLY.test(text);

    // 既没有盒线也没有成段横线 → 它其实是"用箭头写的文字"，回归正文（不再栅格化）
    if (!boxArt && !dashArt) {
      totalPlainBlocks += 1;
      return '<div class="plain-flow">' + textBlockToHtml(text) + '</div>';
    }

    let key = null;
    if (boxArt) key = `${cid}#${boxIndex++}`;
    else if (dashArt) key = `${cid}#d${dashIndex++}`;

    const override = key ? DIAGRAM_OVERRIDES[key] : undefined;
    if (override) {
      const file = override;
      if (fs.existsSync(file)) {
        blocks++;
        totalArtMermaid++;
        let frag = fs.readFileSync(file, 'utf8');
        // mermaid 源码里有 <br/> 之类的标签：直接塞进 HTML 会被当成真实标签解析，
        // textContent 里的换行就丢了。做法是**把源码整体 HTML 转义**——
        // 浏览器读 textContent 时会自动解码回原文，而源码里的 </div> / </script>
        // 被转义后也不可能截断外层结构。
        frag = frag.replace(/<div([^>]*\bclass="[^"]*\bmermaid\b[^"]*"[^>]*)>([\s\S]*?)<\/div>/g,
          function (_m, attrs, inner) {
            return '<div' + attrs + '>' + escapeText(inner) + '<\/div>';
          });
        return frag;
      }
      log(`${KJ.yellow}  · 缺少图形替换文件 ${override}${KJ.reset}`);
    }

    const rep = repairDiagram(text);
    totalArtRepaired += rep.moved;
    const art = asciiToSvg(rep.text);
    if (!art.svg) return m;

    blocks++;
    maxCols = Math.max(maxCols, art.cols);
    return `<div class="art-wrap"><pre class="art">${art.svg}</pre></div>`;
  });
  artBoxByCid[cid] = boxIndex;
  artDashByCid[cid] = dashIndex;
  return { html: out, blocks, cols: maxCols };
}

/**
 * 选择题选项分行。
 * 原文里 A/B/C/D 四个选项挤在同一个 <p> 中，手机上读起来很难受。
 * 命中条件：段落纯文本以 A. / A、 开头，则在 B./C./D. 前插入 <br>。
 */
function splitOptions(html) {
  let count = 0;
  const out = html.replace(/<p>([\s\S]*?)<\/p>/g, (m, inner) => {
    const text = stripTags(inner);
    if (!/^[AＡ][.、．]/.test(text)) return m;
    if (!/[BＢ][.、．]/.test(text)) return m;
    const replaced = inner.replace(/\s+(?=[BＢCＤDＣ][.、．])/g, '<br>');
    if (replaced === inner) return m;
    count++;
    return `<p>${replaced}</p>`;
  });
  return { html: out, count };
}

/**
 * 自查清单复选框：源文件是 <input type="checkbox" disabled>，disabled 让它完全点不动。
 * 换成 role=checkbox 的按钮，交互与持久化交给 web/shell/ui-extras.js。
 */
function enableChecklists(html, cid) {
  let n = 0;
  const out = html.replace(/<input\s+type="checkbox"[^>]*>/gi, () => {
    n++;
    return '<button type="button" class="sa-check" role="checkbox" aria-checked="false" ' +
      'data-ck="' + cid + '#' + n + '"><span class="sa-check-box" aria-hidden="true"></span></button>';
  });
  return { html: out, count: n };
}

/**
 * 并排公式拆分：源文件里常把两条公式写在同一行、用一长串空格隔开，
 * 手机上一行必然被截断。命中条件（宁少不漏）：
 *   行内 ≥4 连续空格 + 空格两侧各至少一个 "=" + 不是代码行。
 */
function splitFormulas(html) {
  let n = 0;
  const out = html.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/gi, (m, attrs, inner) => {
    // 常见形态是 <pre><code>…</code></pre>，把外壳剥掉再判
    let open = '';
    let close = '';
    let body = inner;
    const cm = inner.match(/^(\s*<code[^>]*>)([\s\S]*?)(<\/code>\s*)$/i);
    if (cm) { open = cm[1]; body = cm[2]; close = cm[3]; }
    if (body.indexOf('<') >= 0) return m;             // 还有别的标签（代码高亮等）不动
    if (/[│┌┐└┘├┤┬┴┼─]/.test(inner)) return m;      // 字符画不动
    const CODE = /[;{}]|\/\/|#include|printf|char |int |if \(|for \(|while \(/;
    const lines = body.split('\n');
    const keep = [];
    let changed = false;
    for (const line of lines) {
      const mm = !CODE.test(line) && line.match(/^(\s*\S[\s\S]*?\S)\s{4,}(\S[\s\S]*)$/);
      if (mm && mm[1].indexOf('=') >= 0 && mm[2].indexOf('=') >= 0) {
        keep.push(mm[1]);
        keep.push(mm[2]);
        changed = true;
        n++;
      } else {
        keep.push(line);
      }
    }
    if (!changed) return m;
    return '<pre' + attrs + '>' + open + keep.join('\n') + close + '</pre>';
  });
  return { html: out, count: n };
}

/** 注入壳层：viewport / 样式 / 脚本 / body 标记；返回 null 表示注入未命中 */
function inject(html, { cid, file, cver, appver }) {
  if (!/<\/head>/i.test(html) || !/<\/body>/i.test(html)) return null;

  let s = html;
  s = s.replace(
    /<meta\s+name="viewport"\s+content="[^"]*"\s*>/i,
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  );
  if (!/name="viewport"/i.test(s)) {
    s = s.replace(/<head([^>]*)>/i, '<head$1>\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">');
  }
  s = s.replace(
    /<body([^>]*)>/i,
    (_m, attrs) => `<body${attrs} data-cid="${cid}" data-file="${file}" data-cver="${cver}" data-appver="${appver}">`
  );
  const q = '?v=' + encodeURIComponent(appver);
  s = s.replace(/<\/head>/i,
    '<script src="/shell/boot.js' + q + '"></script>\n' +
    '<link rel="stylesheet" href="/shell/shell.css' + q + '">\n' +
    '<link rel="stylesheet" href="/shell/theme.css' + q + '">\n' +
    '</head>');
  // 只有真的含 mermaid 图的页面才加载那 5.3MB 的库
  const needsMermaid = s.indexOf('class="mermaid"') >= 0;
  // mermaid 那 5.3MB 不在这里同步加载：交给 mermaid-init 在
  // 「第一张图快进入视口」时再动态注入，含图页面首屏因此省下整包解析/编译。
  const needsExtras = /class="(mermaid|table-wrap|sa-check)/.test(s);
  const extras = needsExtras
    ? '<script src="/shell/ui-extras.js' + q + '"></script>\n' +
      '<script src="/shell/diagram-viewer.js' + q + '"></script>\n'
    : '';
  // 注意：这里不能注入内联 <script>——课程包的安全规则（verify-package / HtmlGuard）
  // 禁止内联脚本，而内联脚本也无法配合 CSP script-src 'self'。
  // 库路径改由 data-lib 属性传给 mermaid-init.js（它用 document.currentScript 读取）。
  const tail = (needsMermaid
    ? '<script src="/shell/mermaid-init.js' + q + '" data-lib="/vendor/mermaid.min.js' + q + '"></script>\n'
    : '') + '<script src="/shell/nav.js' + q + '"></script>\n' + extras + '<script type="module" src="/shell/page.js' + q + '"></script>';
  s = s.replace(/<\/body>/i, `${tail}\n</body>`);

  const ok = s.includes('/shell/shell.css') && s.includes('/shell/page.js') &&
    s.includes('/shell/boot.js') && s.includes('/shell/theme.css') && s.includes('data-cid=');
  return ok ? s : null;
}

// ---------- main ----------
if (!fs.existsSync(WEB) || !fs.existsSync(path.join(WEB, 'index.html'))) {
  log(`${KJ.red}✗ 缺少 web/ 壳源码${KJ.reset}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// --empty：产出"没有内置内容"的包（D3 验收用）。此时课程全靠用户导入。
const EMPTY = process.argv.includes('--empty');

// ===== 第一遍：收集 + 去重 + 内容指纹 =====
const collected = [];
for (const g of GROUPS) {
  if (EMPTY) break;                       // 空构建：不收集任何内容页
  const srcDir = path.join(CONTENT, g.dir);
  if (!fs.existsSync(srcDir)) {
    if (!EMPTY) errors.push(`缺少内容目录: content/${g.dir}`);
    continue;
  }
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.html'));
  const seen = new Map();

  for (const file of files) {
    const raw = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const rawHash = sha1(raw);
    if (seen.has(rawHash)) {
      log(`${KJ.dim}  · 跳过重复文件 ${file}（与 ${seen.get(rawHash)} 相同）${KJ.reset}`);
      continue;
    }
    seen.set(rawHash, file);

    const numMatch = file.match(/^(\d+)/);
    const cid = `${g.id}-${numMatch ? numMatch[1] : 'x'}`;
    const no = numMatch ? numMatch[1] : '·';

    let title = pickTitle(raw);
    // 标题自带序号时剥掉，避免与首页徽章重复（"01 第 1 章…" → "第 1 章…"）
    if (numMatch && title.startsWith(no)) {
      title = title.slice(no.length).replace(/^[\s·:：.\-]+/, '').trim() || title;
    }

    collected.push({
      group: g,
      file,
      raw,
      rawHash,
      cid,
      no,
      urlPath: `/content/${g.dir}/${file}`,
      order: numMatch ? Number(numMatch[1]) : 500,
      title,
      kicker: pickKicker(raw),
      sections: (raw.match(/<h2\b/gi) || []).length,
    });
  }
}

// 内容指纹：只看原文，壳层改动不影响它 → 用来判断"题库/讲义是否变过"
const contentHash = sha1(collected.map((c) => `${c.cid}:${c.rawHash}`).sort().join('|')).slice(0, 8);

// ===== 第二遍：注入 + 落盘 =====
rimraf(OUT);
fs.mkdirSync(OUT, { recursive: true });
copyDir(WEB, OUT);

for (const f of ['index.html', 'shell/shell.css', 'shell/page.js', 'shell/store.js', 'shell/db.js']) {
  if (!fs.existsSync(path.join(OUT, f))) {
    log(`${KJ.red}✗ 壳资源缺失: ${f}${KJ.reset}`);
    process.exit(1);
  }
}

const manifest = {
  generatedAt: new Date().toISOString(),
  appVersion: pkg.version,
  contentHash,
  empty: EMPTY,        // true = 这个包没有内置内容，首页只显示"我的课程"
  groups: [],
};

let totalBytes = 0;
let totalQuestions = 0;
let totalArtBlocks = 0;
let totalArtMermaid = 0;
const artBoxByCid = {};
const artDashByCid = {};
let totalArtMaxCols = 0;
let totalArtRepaired = 0;
let totalOptParagraphs = 0;
let totalCheckboxes = 0;
let totalFormulaSplits = 0;
let totalLatex = 0;
let totalMdStripped = 0;
let totalPlainBlocks = 0;
let totalFormulaBlocks = 0;
let totalTableMath = 0;
let totalTableWrapped = 0;
let totalTableMathSkipped = 0;
const searchSections = [];
const searchPages = {};

for (const g of GROUPS) {
  if (EMPTY) break;            // 空构建：不产出任何分组
  const items = [];
  for (const c of collected.filter((x) => x.group.id === g.id)) {
    const rule = QUESTION_RULES[c.cid];
    // 先做两处内容整形（都不改原文，只在产物里生效）
    const art = fixAsciiArt(c.raw, c.cid);
    const opt = splitOptions(art.html);
    const chk = enableChecklists(opt.html, c.cid);
    const fml = splitFormulas(chk.html);
    totalCheckboxes += chk.count;
    totalFormulaSplits += fml.count;
    totalArtBlocks += art.blocks;
    totalArtMaxCols = Math.max(totalArtMaxCols, art.cols);
    totalOptParagraphs += opt.count;
    const tex = renderLatex(fml.html);
    totalLatex += tex.count;
    const fblk = renderFormulaBlocks(tex.html);
    totalFormulaBlocks += fblk.count;
    const tf = renderFormulaCodes(fblk.html);
    totalTableMath += tf.count;
    totalTableMathSkipped += tf.skipped;
    const tagged = tagQuestions(tf.html, rule, c.cid);
    if (rule && tagged.count === 0) {
      errors.push(`自评单元规则未命中（结构可能变了）: ${c.cid} / ${c.file}`);
    }
    const wrapped = wrapTables(tagged.html);
    totalTableWrapped += wrapped.count;
    const html = inject(wrapped.html, { cid: c.cid, file: c.urlPath, cver: contentHash, appver: pkg.version });
    if (!html) {
      errors.push(`注入失败（缺少 </head> 或 </body>）: ${g.dir}/${c.file}`);
      continue;
    }
    const outDir = path.join(OUT, 'content', g.dir);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, c.file), html);

    items.push({
      id: c.cid,
      no: c.no,
      file: c.urlPath,
      title: c.title,
      kicker: c.kicker,
      kind: KICKER_KIND[c.kicker] || (c.kicker.startsWith('卷') ? 'paper' : 'text'),
      order: c.order,
      hash: c.rawHash.slice(0, 8),
      bytes: Buffer.byteLength(html),
      sections: c.sections,
      questions: tagged.count,
    });
    totalBytes += Buffer.byteLength(html);
    totalQuestions += tagged.count;

    searchPages[c.cid] = { t: c.title, f: c.urlPath };
    for (const sec of extractSections(c.raw, c.cid)) searchSections.push(sec);
  }
  items.sort((a, b) => a.order - b.order);
  manifest.groups.push({ id: g.id, title: g.title, items });
  log(`${KJ.cyan}${g.id}${KJ.reset} ${items.length} 页`);
}

// 图表覆盖校验：每页的字符画块数必须与 content/diagrams 下的文件数一致
for (const cid of Object.keys(artBoxByCid)) {
  const boxNeed = artBoxByCid[cid] || 0;
  const dashNeed = artDashByCid[cid] || 0;
  const boxHave = Object.keys(DIAGRAM_OVERRIDES).filter((k) => k.startsWith(cid + '#') && !k.includes('#d')).length;
  const dashHave = Object.keys(DIAGRAM_OVERRIDES).filter((k) => k.startsWith(cid + '#d')).length;
  if (boxHave < boxNeed) errors.push(`图表缺失：${cid} 有 ${boxNeed} 块盒线图，但只有 ${boxHave} 个替换文件`);
  if (boxHave > boxNeed) errors.push(`图表冗余：${cid} 只有 ${boxNeed} 块盒线图，却有 ${boxHave} 个替换文件（索引可能写错）`);
  if (dashHave < dashNeed) errors.push(`时间线缺失：${cid} 有 ${dashNeed} 块纯线图，但只有 ${dashHave} 个替换文件`);
  if (dashHave > dashNeed) errors.push(`时间线冗余：${cid} 只有 ${dashNeed} 块纯线图，却有 ${dashHave} 个替换文件`);
}

// 反向检查：替换文件必须对应"真的有字符画块"的页面，否则就是孤儿（页面被删了、文件还在）
for (const key of Object.keys(DIAGRAM_OVERRIDES)) {
  const cid = key.split('#')[0];
  if (!Object.prototype.hasOwnProperty.call(artBoxByCid, cid)) {
    errors.push(`图表孤儿：${cid} 有替换文件，但该页没有字符画块（页面可能已删除）`);
  }
}

if (collected.length === 0 && !EMPTY) errors.push('没有任何内容页被处理');
if (errors.length) {
  log('');
  for (const e of errors) log(`${KJ.red}✗ ${e}${KJ.reset}`);
  log(`${KJ.red}构建失败：${errors.length} 个错误${KJ.reset}`);
  process.exit(1);
}

manifest.questionCount = totalQuestions;
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

// 全文检索索引（自建，非 Pagefind：正文只有 400KB，没必要引 wasm）
const searchJson = JSON.stringify({ v: 1, pages: searchPages, sections: searchSections });
fs.writeFileSync(path.join(OUT, 'search.json'), searchJson, 'utf8');

log('');
log(`${KJ.green}✓${KJ.reset} 构建完成：${collected.length} 页 / ${totalQuestions} 个自评单元，内容 ${(totalBytes / 1048576).toFixed(2)} MB${EMPTY ? '（--empty：无内置内容）' : ''}`);
log(`${KJ.dim}  检索索引 ${searchSections.length} 节 / ${(fs.statSync(path.join(OUT, 'search.json')).size / 1024).toFixed(0)} KB`);
log(`${KJ.dim}  图表：mermaid 替换 ${totalArtMermaid} 块 / SVG 兜底 ${totalArtBlocks - totalArtMermaid} 块（最宽 ${totalArtMaxCols} 列，修复 ${totalArtRepaired} 行错位）`);
log(`${KJ.dim}  选项分行 ${totalOptParagraphs} 段 · 复选框 ${totalCheckboxes} 个 · 并排公式拆分 ${totalFormulaSplits} 处 · LaTeX ${totalLatex} 处 · 公式代码 ${totalTableMath} 条（跳过 ${totalTableMathSkipped}） · 纯文本块 ${totalPlainBlocks} 个 · 公式块 ${totalFormulaBlocks} 个`);
log(`${KJ.dim}  版本 ${manifest.appVersion} · 内容指纹 ${contentHash} · 输出 ${path.relative(ROOT, OUT)}${KJ.reset}`);
