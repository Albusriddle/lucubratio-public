// 把若干 HTML 片段组装成一个内容页（content/os/<slug>.html）
//
// 用法：
//   node tools/assemble.mjs <slug> <标题> <片段1.html> [片段2.html …]
//   node tools/assemble.mjs 03_os_进程 "进程与调度" /tmp/s1.html /tmp/s2.html
//
// 片段里只写正文（h2/h3/p/table/…），本脚本负责套上标准头（样式 + viewport），
// 壳层注入（data-cid / data-file / data-cver / 目录 / 自评标记）由 build.mjs 完成，这里不做。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'content/os');

const HEAD = (title) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<style>
  :root{--bg:#fbfbfd;--fg:#1f2328;--muted:#5b6570;--line:#e3e6ea;--accent:#2f6fdd;--code-bg:#f2f4f7}
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--bg);color:var(--fg)}
  body{font-family:"PingFang SC","Microsoft YaHei",-apple-system,"Segoe UI",sans-serif;line-height:1.75;
       padding:18px 16px 40px;max-width:720px;margin:0 auto}
  h2{font-size:22px;margin:30px 0 10px;padding-left:12px;border-left:4px solid var(--accent)}
  h3{font-size:17px;margin:22px 0 8px}
  p,li{font-size:16px}
  blockquote{margin:14px 0;padding:12px 14px;background:#fff8e1;border-left:4px solid #e6b422;border-radius:6px}
  code{background:var(--code-bg);padding:1.5px 5px;border-radius:4px;font-size:.92em}
  .table-wrap{overflow-x:auto;margin:14px 0}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th,td{border:1px solid var(--line);padding:8px 10px;text-align:left}
</style>
</head>
<body>
`;

const TAIL = '\n</body>\n</html>\n';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function main() {
  const [slug, title, ...frags] = process.argv.slice(2);
  if (!slug || !title || frags.length === 0) {
    console.error('用法: node tools/assemble.mjs <slug> <标题> <片段1.html> [片段2 …]');
    process.exit(1);
  }
  if (!/^\d{2}_[\w\u4e00-\u9fa5-]+(\.html)?$/.test(slug)) {
    console.error(`slug 必须形如 "03_标签" 或 "03_标签.html"（两位序号 + 下划线 + 名称）: ${slug}`);
    process.exit(1);
  }

  const parts = [];
  for (const f of frags) {
    if (!fs.existsSync(f)) {
      console.error('片段不存在: ' + f);
      process.exit(1);
    }
    parts.push(fs.readFileSync(f, 'utf8').trim());
  }

  const body = parts.join('\n\n');
  const html = HEAD(title) + body + TAIL;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const name = slug.endsWith('.html') ? slug : slug + '.html';
  const out = path.join(OUT_DIR, name);
  fs.writeFileSync(out, html, 'utf8');

  const h2 = (body.match(/<h2\b/gi) || []).length;
  const h3 = (body.match(/<h3\b/gi) || []).length;
  const noId = (body.match(/<h[23](?![^>]*\bid=)[^>]*>/gi) || []).length;

  console.log(`✓ 已生成 ${path.relative(ROOT, out)}（${h2} 个 h2 / ${h3} 个 h3）`);
  if (noId) {
    console.log(`⚠️ 有 ${noId} 个 h2/h3 缺少 id —— 目录与锚点会失效，务必补上`);
  }
  const num = name.match(/^(\d+)/);
  if (num) {
    console.log(`  提示：若要它成为自评单元，在 scripts/build.mjs 的 QUESTION_RULES 里加`);
    console.log(`        'os-${num[1]}': { level: 3, test: /^检测\\s*\\d+/ },`);
  }
}

main();
