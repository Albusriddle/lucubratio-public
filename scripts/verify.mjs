// 构建产物静态校验：npm run verify
// 任何一个断言失败 → 非零退出（供 CI / 提交前使用）
import fs from 'node:fs';
import path from 'node:path';

// 校验基线：不同仓库内容量差别很大，允许用 package.json 的 verifyBaselines 覆盖
import { readFileSync as _rf } from 'node:fs';
let _pkg = {};
try { _pkg = JSON.parse(_rf(new URL('../package.json', import.meta.url), 'utf8')); } catch {}
const BASELINE = Object.assign(
  { mermaid: 250, math: 100, sections: 50, totalMB: 24 },
  (_pkg && _pkg.verifyBaselines) || {}
);

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'web');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const bad = (m) => fails.push(m);

// 1) 产物目录
if (!fs.existsSync(OUT)) {
  console.error('✗ 产物目录不存在，请先运行 npm run build');
  process.exit(1);
}

// 2) manifest 结构
const manifestPath = path.join(OUT, 'manifest.json');
if (!fs.existsSync(manifestPath)) bad('缺少 manifest.json');
let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  bad('manifest.json 不是合法 JSON：' + e.message);
}

if (manifest) {
  if (manifest.appVersion !== pkg.version) {
    bad(`manifest.appVersion=${manifest.appVersion} 与 package.json=${pkg.version} 不一致`);
  } else ok('版本号一致：' + pkg.version);

  if (!/^[0-9a-f]{8}$/.test(String(manifest.contentHash || ''))) {
    bad('manifest.contentHash 缺失或格式不对: ' + manifest.contentHash);
  } else ok('内容指纹：' + manifest.contentHash);

  const items = (manifest.groups || []).flatMap((g) => g.items || []);
  if (items.length === 0) bad('manifest 里没有任何内容页');

  const ids = new Set();
  let bytes = 0;
  for (const it of items) {
    if (ids.has(it.id)) bad(`重复 cid: ${it.id}`);
    ids.add(it.id);

    for (const k of ['id', 'file', 'title', 'no', 'hash', 'kind']) {
      if (!it[k]) bad(`条目 ${it.id} 缺少字段 ${k}`);
    }
    if (it.kind === 'paper' || it.kind === 'memo' || it.kind === 'text') { /* ok */ }
    else bad(`条目 ${it.id} 的 kind 非法: ${it.kind}`);

    if (it.file && !fs.existsSync(path.join(OUT, decodeURIComponent(it.file)))) {
      bad(`内容文件缺失: ${it.file}`);
    }
    bytes += it.bytes || 0;
  }
  ok(`内容页 ${items.length} 个，合计 ${(bytes / 1048576).toFixed(2)} MB`);
  if (bytes > 6 * 1024 * 1024) bad(`内容体积超预算（>6MB）: ${(bytes / 1048576).toFixed(2)} MB`);

  // 3) 每个页面都真正注入了壳层
  for (const it of items) {
    const p = path.join(OUT, decodeURIComponent(it.file));
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, 'utf8');
    if (!html.includes('viewport-fit=cover')) bad(`${it.id}: 缺 viewport-fit=cover`);
    if (!html.includes('/shell/shell.css')) bad(`${it.id}: 未注入 shell.css`);
    if (!html.includes('/shell/page.js')) bad(`${it.id}: 未注入 page.js`);
    if (!html.includes('/shell/boot.js')) bad(`${it.id}: 未注入 boot.js（首屏主题）`);
    if (!html.includes('/shell/theme.css')) bad(`${it.id}: 未注入 theme.css（深色）`);
    if (!html.includes(`data-cid="${it.id}"`)) bad(`${it.id}: 未注入 data-cid`);
    if (!/data-cver="[0-9a-f]{8}"/.test(html)) bad(`${it.id}: 缺 data-cver`);
    if (!/data-appver="[^"]+"/.test(html)) bad(`${it.id}: 缺 data-appver`);
    if (html.includes('file://')) bad(`${it.id}: 出现 file:// 引用（禁止）`);
    if (/\\\(|\\\)/.test(html)) bad(`${it.id}: 残留未渲染的 LaTeX 标记 \\( … \\)`);

    // 自评单元：数量必须与 manifest 一致，且必须带 cid 前缀
    // 只统计标题上的自评标记；正文里若提到 data-qid 这个词，不该被算作单元
    const qCount = (html.match(/<h[2-6][^>]*\sdata-qid="/g) || []).length;
    const qExpect = it.questions || 0;
    if (qCount !== qExpect) {
      bad(`${it.id}: data-qid 数量 ${qCount} ≠ manifest.questions ${qExpect}`);
    }
    if (qCount > 0 && !html.includes(`data-qid="${it.id}#`)) {
      bad(`${it.id}: data-qid 缺少 cid 前缀（会与其它页撞车）`);
    }

    // 图表：源码必须已转义、不得残留旧方案的 script 外壳
    const mermaidCount = (html.match(/class="mermaid"/g) || []).length;
    if (mermaidCount > 0) {
      // 历史 bug（整页残留 script 外壳）已修复；现在允许它出现在 .mermaid 里——
      // 那是作者写图源码的唯一方式（content 页面不走构建期转义）。
      const outsideMermaid = html.replace(/<div class="mermaid">[\s\S]*?<\/div>/g, '');
      if (outsideMermaid.includes('type="text/plain"')) {
        bad(`${it.id}: <script type="text/plain"> 出现在 .mermaid 之外`);
      }
      // 允许作者用 <script type="text/plain"> 包裹 mermaid 源码（唯一合法写法）；
      // 但里面不能再出现别的 <script> / 提前闭合的 </script>。
      const blocks = html.split('<div class="mermaid">').slice(1);
      for (const b of blocks) {
        const body = b.split('</div>')[0] || '';
        const stripped = body
          .replace(/^<script type="text\/plain">/, '')
          .replace(/<\/script>$/, '');
        if (/<script/i.test(stripped) || /<\/script/i.test(stripped)) {
          bad(`${it.id}: 图表源码里出现非法的 <script / </script>`);
          break;
        }
      }
    }
  }
  ok('全部页面注入标记检查通过');

  // 3.5) 引用完整性：站内图片必须存在、页内锚点必须能找到 id
  {
    let imgRefs = 0;
    const missingImgs = [];
    const brokenAnchors = [];
    for (const it of items) {
      const p = path.join(OUT, decodeURIComponent(it.file));
      if (!fs.existsSync(p)) continue;
      const html = fs.readFileSync(p, 'utf8');
      const ids = new Set((html.match(/\bid="([^"]+)"/g) || []).map((m) => m.slice(4, -1)));

      for (const m of html.matchAll(/<img[^>]+src="(\/[^"]+)"/g)) {
        imgRefs += 1;
        const rel = decodeURIComponent(m[1]).replace(/^\//, '');
        if (!fs.existsSync(path.join(OUT, rel))) missingImgs.push(`${it.id}:${m[1]}`);
      }
      for (const m of html.matchAll(/href="#([^"]+)"/g)) {
        if (!ids.has(m[1])) brokenAnchors.push(`${it.id}:#${m[1]}`);
      }
    }
    if (missingImgs.length) bad(`图片引用不存在：${missingImgs.slice(0, 3).join(', ')}（共 ${missingImgs.length}）`);
    else ok(`图片引用 ${imgRefs} 个，全部存在`);
    if (brokenAnchors.length) bad(`页内锚点找不到目标：${brokenAnchors.slice(0, 3).join(', ')}（共 ${brokenAnchors.length}）`);
    else ok('页内锚点全部有效');
  }

  // 图表：内容页用内联 mermaid；content/diagrams 是"字符画替换文件"（可选）。
  // 说明：以前这里拿"图表文件里的块数"和"页面内联块数"比大小，两边不相干 → 检查恒为真（假绿）。
  // 现在拆成两件真实的事：① 内联 mermaid 有基线；② 替换文件若存在，必须能对上某个真实 cid（防孤儿）。
  {
    const diagramDir = path.join(ROOT, 'content', 'diagrams');
    const files = fs.existsSync(diagramDir)
      ? fs.readdirSync(diagramDir).filter((f) => f.endsWith('.html'))
      : [];

    let actualMermaid = 0;
    for (const it of items) {
      const p = path.join(OUT, decodeURIComponent(it.file));
      if (!fs.existsSync(p)) continue;
      actualMermaid += (fs.readFileSync(p, 'utf8').match(/class="mermaid"/g) || []).length;
    }
    const MERMAID_BASELINE = BASELINE.mermaid;
    if (actualMermaid < MERMAID_BASELINE) {
      bad(`内联 mermaid 块少得可疑：只有 ${actualMermaid} 个（基线 ${MERMAID_BASELINE}）`);
    } else {
      ok(`内联 mermaid ${actualMermaid} 块`);
    }

    if (files.length === 0) {
      ok('图表替换文件 0 个（内容已全部使用内联 mermaid）');
    } else {
      const badName = files.filter((f) => !/^os-\d+-(d?\d+)\.html$/.test(f));
      if (badName.length) bad(`图表文件命名不合法: ${badName.slice(0, 3).join(', ')}`);
      const known = new Set(items.map((it) => it.id));
      const orphans = files.filter((f) => !known.has(f.replace(/-(d?\d+)\.html$/, '')));
      if (orphans.length) bad(`图表文件没有对应页面（孤儿）: ${orphans.slice(0, 3).join(', ')}`);
      else ok(`图表替换文件 ${files.length} 个，均能对上真实页面`);
    }
  }

  // 4) 内容变换基线：绝不能有字符画残留；公式/纯文本块数量不能突然塌方
  {
    let artChars = 0;
    let mathCount = 0;
    let plainCount = 0;
    for (const it of items) {
      const p = path.join(OUT, decodeURIComponent(it.file));
      if (!fs.existsSync(p)) continue;
      const html = fs.readFileSync(p, 'utf8');
      artChars += (html.match(/[│┌┐└┘├┤┬┴┼]/g) || []).length;
      mathCount += (html.match(/class="sa-math"/g) || []).length;
      plainCount += (html.match(/class="plain-flow"/g) || []).length;
    }
    if (artChars > 0) bad(`仍有 ${artChars} 个字符画字符（│┌┐└┘…）残留，应全部转成 mermaid/正文`);
    else ok('无字符画残留（盒线字符 0）');

    if (mathCount < BASELINE.math) bad(`公式少得可疑：只有 ${mathCount} 个（新课件体系基线约 190）`);
    else ok(`公式 ${mathCount} 个（MathML）`);

    // 新课件体系里没有"仅箭头块"，纯文本块为 0 是正常的；只在旧内容回归时才需要 >0
    if (plainCount > 0 && plainCount < 20) bad(`纯文本块数量异常：${plainCount} 个`);
    else ok(`纯文本块 ${plainCount} 个`);
  }

  if (!manifest.questionCount || manifest.questionCount < 1) {
    bad('manifest.questionCount 缺失或为 0（自评单元没被识别，检查 QUESTION_RULES）');
  } else {
    const sum = items.reduce((n, i) => n + (i.questions || 0), 0);
    if (sum !== manifest.questionCount) bad(`questionCount 汇总不一致：${sum} ≠ ${manifest.questionCount}`);
    else ok(`自评单元 ${manifest.questionCount} 个，与各页合计一致`);
  }
}

// 4) 壳资源
const SHELL_FILES = [
  'index.html',
  'review.html',
  'search.html',
  'stats.html',
  'diagnostics.html',
  'shell/shell.css',
  'shell/theme.css',
  'shell/boot.js',
  'shell/splash.js',
  'shell/theme.js',
  'shell/page.js',
  'shell/home.js',
  'shell/store.js',
  'shell/db.js',
  'shell/fsrs.js',
  'shell/time.js',
  'shell/review.js',
  'shell/search.js',
  'shell/stats.js',
  'vendor/ts-fsrs.mjs',
  'vendor/mermaid.min.js',
  'shell/mermaid-init.js',
  'vendor/LICENSE-ts-fsrs',
];
let shellMissing = 0;
for (const f of SHELL_FILES) {
  const p = path.join(OUT, f);
  if (!fs.existsSync(p)) { bad('壳资源缺失: ' + f); shellMissing++; }
  else if (fs.statSync(p).size < 64) { bad('壳资源为空: ' + f); shellMissing++; }
}
if (!shellMissing) ok('壳资源完整（' + SHELL_FILES.length + ' 个）');

// 5) 检索索引
const searchPath = path.join(OUT, 'search.json');
if (!fs.existsSync(searchPath)) {
  bad('缺少 search.json（检索索引）');
} else {
  let sj = null;
  try {
    sj = JSON.parse(fs.readFileSync(searchPath, 'utf8'));
  } catch (e) {
    bad('search.json 不是合法 JSON：' + e.message);
  }
  if (sj) {
    if (sj.v !== 1) bad('search.json 版本号不是 1');
    const secs = sj.sections || [];
    if (secs.length < BASELINE.sections) bad('检索小节过少：' + secs.length);
    else ok(`检索索引 ${secs.length} 节 / ${(fs.statSync(searchPath).size / 1024).toFixed(0)} KB`);

    const pageIds = new Set(Object.keys(sj.pages || {}));
    let orphan = 0;
    for (const s of secs) if (!pageIds.has(s.p)) orphan++;
    if (orphan) bad(`检索小节里有 ${orphan} 条指向不存在的页面`);

    if (fs.statSync(searchPath).size > 3 * 1024 * 1024) {
      bad('检索索引超预算（>3MB）');
    }
  }
}

// 6) 开发页不得随包发布
for (const f of ['probe.html', '_dev']) {
  if (fs.existsSync(path.join(OUT, f))) bad('开发文件被打进产物: ' + f);
}

// 7) 体积预算
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce(
  (n, e) => n + (e.isDirectory() ? walk(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
const total = walk(OUT);
ok('产物总体积 ' + (total / 1048576).toFixed(2) + ' MB');
if (total > BASELINE.totalMB * 1024 * 1024) bad('产物超预算（>24MB，含课件图片）: ' + (total / 1048576).toFixed(2) + ' MB');

// ---------- 汇总 ----------
console.log('');
for (const m of oks) console.log('\x1b[32m✓\x1b[0m ' + m);
if (fails.length) {
  console.log('');
  for (const m of fails) console.log('\x1b[31m✗\x1b[0m ' + m);
  console.log(`\n\x1b[31m校验失败：${fails.length} 项\x1b[0m`);
  process.exit(1);
}
console.log('\n\x1b[32m全部校验通过\x1b[0m');
