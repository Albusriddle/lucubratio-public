# tools/ —— 生成流水线里"确定性"的那部分

这套脚本配合 DSH 技能 `lucubratio-course` 使用：
**脚本做能确定性完成的事，模型只做判断类的事**（写内容、复核、出题）。

| 脚本 | 作用 | 依赖 |
|---|---|---|
| `pdf-extract.py` | 课件 PDF → 逐页 Markdown + 无文字页截图 + `report.json`（页数/无文字页/建议分段） | Python 3.9+、`pymupdf`（可选 `pillow` 转 WebP） |
| `assemble.mjs` | 若干 HTML 片段 → 一个完整内容页（套标准头，检查 `id`，提示 `QUESTION_RULES`） | Node 20+，零依赖 |
| `course-new.mjs` | 新建内容页骨架（四块结构 + Mermaid 示例 + 检测题占位） | Node 20+，零依赖 |

## 典型流程

```bash
# 1) 抽取（--render 会渲染无文字层页面）
python tools/pdf-extract.py ~/课件/vm-4.pdf --out .work/vm-4 --render

# 2) 看报告：多少页、哪些页是纯图、建议怎么分段
cat .work/vm-4/report.json

# 3) 新页骨架（或直接 assemble 已有片段）
node tools/course-new.mjs 18 vm4 "vm-4 页面置换与抖动"

# 4) 片段合成
node tools/assemble.mjs 18_vm4 "vm-4 页面置换与抖动" .work/vm-4/s1.final.html

# 5) 校验与打包
node scripts/build.mjs && node scripts/verify.mjs
node scripts/pack.mjs --id vm4 --title "vm-4" --version 1.0.0
node scripts/verify-package.mjs dist/vm4-1.0.0.lcr
```

## 约定与坑

- 抽取**不做 OCR**：扫描件 OCR 出来的字用于生成课程错误率太高，宁可让作者看图补写
- `report.json.empty_pages` 里的页，生成阶段必须看 `img/` 后据图写
- `assemble.mjs` 只做"套头 + 拼装"，**不做** `data-cid`/`data-file` 注入——那些由 `scripts/build.mjs` 统一完成
- Mermaid 块必须写成 `<div class="mermaid"><script type="text/plain">flowchart TD`（同一行开头），否则 `verify` 会报错

## 为什么放在仓库里而不是只在技能里

技能是"怎么想"，脚本是"怎么做"。脚本放仓库：可以被 CI 跑、可以被别人复现、改错了有 diff 可查。
技能文档见 `~/.dsh/skills/lucubratio-course/`（`SKILL.md` / `quality-gate.md` / `page-template.md` / `pitfalls.md`）。
