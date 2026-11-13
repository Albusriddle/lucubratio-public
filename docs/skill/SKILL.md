---
name: lucubratio-course
description: "Use this skill when the user wants to turn course material (lecture PDFs, slides, textbook chapters, exam scope) into a Lucubratio offline course package (.lcr) — i.e. when they ask to '把课件做成课程包'、'把这门课做成 App 内容'、'生成可离线学习的讲义/自测题'、'做一个 .lcr 包', or want to extend an existing Lucubratio content set with new lectures. It governs the whole generation pipeline: extraction, segmented authoring with dual-producer + reviewer, quiz authoring, build/verify, packaging and verification. Not for editing presentation slide decks (use academic-pptx / ppt-maker) and not for writing the app shell code itself."
license: 与 lucubratio-public 仓库一致（Apache-2.0）
---

# Lucubratio 课程包生成

把一门课的 PDF 变成**能读、能自测、能复习**的 `.lcr` 课程包。

确定性的事交给脚本（本仓库 `tools/` + `scripts/`），判断类的事交给智能体：**分段生成 → 双盲复核 → 合稿 → 出题 → 校验 → 打包**。

## 0. 前置检查（缺一不可）

```bash
# 1) 依赖
python -c "import pymupdf; print('ok')" || pip install pymupdf pillow

# 2) 在 lucubratio-public 仓库根目录（有 scripts/build.mjs）
ls scripts/build.mjs || echo "先切换到 lucubratio-public 仓库"

# 3) 课件存在
ls <课件.pdf>
```

缺任何一项，先告诉用户缺什么，**不要**开始生成。

## 1. 抽取（脚本，不靠模型）

```bash
python tools/pdf-extract.py <课件.pdf> --out .work/<课程id> --render   # PDF（可选 --render 出图）
python tools/pptx-extract.py <课件.pptx> --deck <讲次> --out .work/<课程id>   # PPTX（自动导出内嵌图）
# 想更严格地标出"文字很少但关键信息在图里"的页：加 --low-text 24
# （默认 --low-text 200 已经会标记低文字页，report.low_text_pages 一定有内容）
```

产出：

| 文件 | 用途 |
|---|---|
| `.work/<id>/pages/pNNN.md` | 逐页文本，生成阶段按页喂给子智能体 |
| `.work/<id>/img/pNNN.webp` | **无文字层页**的截图，必须看图补写 |
| `.work/<id>/report.json` | 总页数、无文字页、**低文字有图页**、建议分段 |

**铁律一（读图）**：以下两类页都必须让作者看 `img/` 后据图写，**禁止臆造**：

- `report.json.empty_pages`：完全没有文字层（纯截图）
- `report.json.low_text_pages`：文字很少但含内嵌图片

> 真实教训：某页只有「运行结果」四个字，而两个关键数字（`[balance: 16413910]` / `[should: 20000000]`）
> 全在页面里的终端截图里。只看文本层会漏掉整道题的答案。

**铁律二（复核必须重渲染）**：`pages/pNNN.md` 里出现"图/Figure/截图/表中"等字样，**或**该页文字量 < 200 字
但含 `<img>`/矢量图，**复核人都必须把该页重渲染（≥150 dpi）后逐项核对**，不能只读文本层。

> 真实教训：某页文字层只写"16KB 地址空间、1KB 页"，图上只有 **4 条**映射箭头；B 稿凭印象写成 6 条，
> 又由 6 推出"10 个无效条目 / 8 页"（应为 12 / 12），还画进了流程图——三处互相加固。
> 复核人按 300 dpi 重渲染、逐列扫像素才把它摁住；只读文本层的复核根本发现不了。

## 1.5 配额（写在提示里，别等事后删）

| 课件页数 | 分段 | 每段题量 | 合计 |
|---|---|---|---|
| ≤20 | 1 | 5–8 | 5–8 |
| 20–60 | 2 | 3–5 | 6–10 |
| 60–200 | 3–6 | 3–4 | 10–20 |

**可直接复制的 producer / reviewer 提示词见 [prompts.md](prompts.md)**（含硬约束与 PATCH 输出格式）。

## 2. 分段生成（双盲 + 复核）

按 `report.json.suggested_segments` 分段（默认 30 页/段）。每段：

```
producer A ──┐
             ├─→ reviewer（回查原页 + 独立重算）─→ 采信决策 ─→ 合稿
producer B ──┘
```

- **A、B 各自独立写**，不要互相看，也不要给同一份参考笔记
- 每份产出：`<段>.a.html` / `<段>.b.html`，只写正文片段（`h2/h3/p/table/mermaid`），不写 `<html>` 头
- **给 reviewer 的任何线索都必须自己先核实**：数字、页码、图内信息——只要是从 producer 自述里拿来的，
  一律先回原文/原图核对；核对不了就不给，或明确标注「来自 producer 自述，未验证」。
  > 真实教训：某次我把 producer 自述的「15KB→3 页框」当锚点转给 reviewer，课件里根本没有这个对应
  > （p41 的 15KB 只给「→27 KiB、偏移 3 KiB」）。复核人自己重算才发现，锚点是错的。
- reviewer 产出 `review-<段>.md`：逐条「A 对/B 对/都不对 + 依据页码」，并且**必须给出 PATCH 清单**
  （文件 + 定位原文 + 改为），合稿的人照着改即可——避免"结论对但改起来靠猜"


详细判定标准见 [quality-gate.md](quality-gate.md)；合稿分工与决策模板见 [merge-playbook.md](merge-playbook.md)。

## 2.5 合稿阶段的题量上限（单段达标不代表全页达标）

每段 3–4 道是**单段**配额；合并成一页后还要再查一次：

| 全页页数 | 全页题量上限 |
|---|---|
| ≤20 | 8 |
| 20–60 | 10 |
| 60+ | 12 |

超出就按"重复 / 记忆化 / 与另一题同页码同考点"三条标准删，**不要**因为"都写得不错"就留着。
（实测：52 页 2 段合出 14 道、79 页 2 段合出 9 道，都超过单页建议值。）

## 3. 合稿（脚本 + 人工裁决）

```bash
node tools/assemble.mjs <序号>_<标签> "<页面标题>" .work/<id>/<段>.final.html
```

- `<段>.final.html` 是按 reviewer 结论合并后的片段
- 脚本会检查 h2/h3 是否都有 `id`（缺了会警告）并打印 `QUESTION_RULES` 提示
- 页面骨架用 [page-template.md](page-template.md)

**落盘前必做：给新页面加自评规则。** 规则在 `scripts/build.mjs` 的 `QUESTION_RULES` 里，
**按页 cid 配置**（cid = `os-` + 文件名前两位，如 `05_vm1.html` → `os-05`）：

```js
'os-05': { level: 3, test: /^检测\s*\d+/ },
```

不加会怎样：`build` 不给标题打 `data-qid` → 页面上**没有自评条**（错题进不了 FSRS），
并且 `verify` 直接失败：`自评标题与标记数不一致：os-05: 标题 6 / 标记 0`
（报错里会打印应当补的那一行，照抄即可）。

## 4. 出题

> **解析默认折叠**：查看器会把每道题的 `<blockquote><strong>解析</strong>…` 折起来，
> 学生点「查看解析」才看到；自评（不会/模糊/会）之后会自动展开。
> 因此**解析必须独立成一个 blockquote**，不要与选项写在同一段，也不要提前把答案写进题干。

每个课件 5–8 道「检测」，题面来自课件原页，**解析必须标页码**：

```html
<h3 id="检测 1">检测 1（10 分）题干…</h3>
<p>A. …　B. …　C. …　D. …</p>
<blockquote><strong>解析</strong>：…（课件 p42）</blockquote>
```

- 四个选项都要有"错在哪"的理由，不允许三个明显凑数
- 数值题（调度顺序/命中率/页表大小）必须**独立重算一遍**再写解析

## 4.5 课件截图（可选，但推荐）

把「正文里转述的那页课件」截出来嵌进正文，读者不用来回翻 PDF。

```bash
node tools/ppt-shots.mjs --all --src "<课件目录>"     # 渲染 web/img/<deck>/pNNN.webp（宽 900 webp）
node tools/mark-ppt.mjs --file .work/pages/05_vm1.html --report .work/vm1/report.json   # 存量内容机械预标
```

- 内容侧只写标记：`<figure class="sa-ppt" data-ppt="42"></figure>`（跨讲写 `05:42`）
- 构建期替换成 `<img loading="lazy">` + 图注，点击可放大
- **缺图会直接构建失败**（`web/img` 是 gitignored 的本地产物，换机器要重跑一次）

## 5. 校验（不许跳过）

```bash
node scripts/build.mjs                     # 编译（注入壳层、公式、自评标记、索引）
node scripts/verify.mjs                    # 锚点/图片/公式基线/自评数/Markdown 残留/DOM id/仓库卫生
node tools/self-check-quizzes.mjs <页面>   # 题目自检：答案唯一、干扰项全覆盖、解析块+页码 ★硬门
node scripts/pack.mjs --id <课程id> --title "<课程名>" --version 1.0.0
node scripts/verify-package.mjs dist/<课程id>-1.0.0.lcr   # 包校验（12 项）
```

五步任一失败 → 回到对应步骤修，**不要**用注释/删内容的方式绕过。

> `self-check-quizzes` 是**硬门**：有「检测 N」标题却没有 `<blockquote><strong>解析</strong>…`
> 解析块时**直接失败**（不是警告）。历史内容可加 `--allow-nonblockquote` 暂放，
> 新内容不要用这个开关。只缺页码时可加 `--allow-no-cite`（仍会在 CI 里留警告）。

## 6. 交付

- `dist/<课程id>-<版本>.lcr`：给用户导入 App
- `<课程id>-report.md`：本次生成报告——页数、分段、每段 A/B 采信比例、reviewer 指出的错误清单、抽检页码

## 硬规则（违反即返工）

1. 没有 reviewer 结论的段落**不得合稿**
2. 无文字层页面必须看图，禁止臆造
3. 正文禁止 Markdown 记号（`**加粗**`、`# 标题`）——用 `<strong>` / `<h2>`
4. 每个 `h2/h3` 必须有页内唯一 `id`
5. 图一律 Mermaid，禁止字符画；写法：`<div class="mermaid"><script type="text/plain">flowchart TD` 同一行开头
6. 不许为了"看起来完整"编造课件里没有的内容；不确定就写「课件未展开」
7. **解析块格式固定**：每道检测题必须以 `<blockquote><strong>解析</strong>：…</blockquote>` 结尾，
   紧跟第 4 个选项、中间不插别的元素。查看器会**默认把它折叠**，点「查看解析」才展开；
   不要在题干/选项里泄露答案，也不要自己写 `<details>` 或「查看解析」按钮（壳层会自动加）
8. **课件页截图必须标位置**：正文转述了某页的图/表，就在那一**段之后**写一行
   `<figure class="sa-ppt" data-ppt="42"></figure>`（讲次+页码：`data-ppt="05:42"`）。
   构建期会换成真实 `<img>`（宽 900 的 webp、懒加载、点击可放大）；**不许自己写 `<img>`**，
   缺图会直接构建失败。一页只标一次，插在"首次转述该页"的段落之后。
9. **课程包禁止上传 GitHub**：`.lcr` 及其内容（正文页、图片、学案）一律不进 git、不进 Releases、
   不贴进 issue/PR。课程内容只保留在本地工作区与用户指定位置（详见 `AGENTS.md`）
10. **新页面必须配自评规则**：在 `scripts/build.mjs` 的 `QUESTION_RULES` 里为它的 cid 加一条
    `{ level: 3, test: /^检测\s*\d+/ }`。不加则构建不打自评标记、`verify` 直接失败

## 常见坑

见 [pitfalls.md](pitfalls.md)（含构建/校验报错的对照表）。

## 规模参考

| 规模 | 分段数 | 大致耗时（含复核） |
|---|---|---|
| 40–60 页 | 2–3 段 | 1–2 小时 |
| 200 页 | 6–8 段 | 半天 |
| 700+ 页（9 个课件） | 20+ 段 | 2–3 天 |

**先跑 1 门小课**验证流程，再铺开。
