// 新建一个内容页骨架（四块结构 + 页内唯一 id + 自评单元占位）
//
// 用法：
//   node tools/course-new.mjs <序号> <标签> <标题> [--no-quiz]
//   node tools/course-new.mjs 03 vCPU1 虚拟化-CPU-进程抽象
//
// 产出 content/os/<序号>_<标签>.html，只含骨架与说明注释，正文由作者/智能体填写。
// 骨架遵循 CONTENT-SPEC 的四块结构，能直接过 build/verify。

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
<title>${title}</title>
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

const QUIZ = (n) => `
<h3 id="检测 ${n}">检测 ${n}（10 分）<!-- 题干：一句话问清一个知识点 --></h3>
<p><!-- 选项 A–D，四个里只有一个是"完全正确"的，其余错因各不相同 --></p>
<p>A. …　B. …　C. …　D. …</p>
<blockquote><strong>解析</strong>：<!-- 逐项说明对错的依据，并标出课件页码 --></blockquote>
`;

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--no-quiz');
  const withQuiz = !process.argv.includes('--no-quiz');
  const [num, label, title] = args;

  if (!num || !label || !title) {
    console.error('用法: node tools/course-new.mjs <序号> <标签> <标题> [--no-quiz]');
    console.error('例如: node tools/course-new.mjs 03 vCPU1 虚拟化-CPU-进程抽象');
    process.exit(1);
  }
  if (!/^\d{2}$/.test(num)) {
    console.error('序号必须是两位数字（如 03）');
    process.exit(1);
  }

  const name = `${num}_${label}.html`;
  const out = path.join(OUT_DIR, name);
  if (fs.existsSync(out)) {
    console.error('已存在，先删掉或换个序号: ' + path.relative(ROOT, out));
    process.exit(1);
  }

  const body = `
<h2 id="1-这一节讲什么">1. 这一节讲什么</h2>
<p><!-- 3–5 句话说清：解决什么问题、关键概念是什么、学完能答哪类题 --></p>

<h2 id="2-正文展开">2. 正文展开</h2>
<h3 id="2-1-核心概念">2.1 核心概念</h3>
<p><!-- 定义 + 一句话直觉 + 一个最小例子 --></p>

<h3 id="2-2-机制与流程">2.2 机制与流程</h3>
<p><!-- 分步骤讲清"发生了什么"，必要时用表格或 Mermaid --></p>
<div class="mermaid"><script type="text/plain">flowchart TD
  A["起点"] --> B["中间"]
  B --> C["结果"]
</script></div>

<h2 id="3-易错点">3. 易错点</h2>
<blockquote><strong>常见误解</strong>：<!-- 写出最容易搞反/混淆的那一点 --></blockquote>
${withQuiz ? QUIZ(1) : ''}
`.trim();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, HEAD(title) + body + '\n</body>\n</html>\n', 'utf8');

  console.log(`✓ 已生成 ${path.relative(ROOT, out)}`);
  console.log(`  下一步：`);
  console.log(`    1) 填写正文（保留所有 id）`);
  console.log(`    2) 在 scripts/build.mjs 的 QUESTION_RULES 加： 'os-${num}': { level: 3, test: /^检测\\s*\\d+/ },`);
  console.log(`    3) node scripts/build.mjs && node scripts/verify.mjs`);
}

main();
