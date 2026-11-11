# tools/ —— 生成流水线里"确定性"的那部分

这套脚本配合 DSH 技能 `lucubratio-course`（见 [`../docs/skill/`](../docs/skill/)）使用：
**脚本做能确定性完成的事，模型只做判断类的事**（写内容、复核、出题）。

约定：所有脚本 `--help` 或空参运行会打印用法；产物一律写进 gitignored 目录（`.work/`、`dist/`、`web/img/`）。

---

## 一、抽取素材（PDF → 可读文本 + 图）

| 脚本 | 作用 | 依赖 | 典型命令 |
|---|---|---|---|
| `pdf-extract.py` | 课件 PDF → 逐页 Markdown + 图页截图 + `report.json`（无文字页/低文字有图页/建议分段） | Python 3.9+、`pymupdf`（可选 `pillow` 转 WebP） | `python tools/pdf-extract.py lecture.pdf --out .work/deck --render` |
| `ppt-shots.mjs` | 按报告清单批量渲染课件页为 WebP（供正文 `sa-ppt` 引用） | Node、`pymupdf`（调用上面的报告） | `node tools/ppt-shots.mjs --deck deck --pdf lecture.pdf --all` |
| `mark-ppt.mjs` | 给存量课程页机械预标 `<figure class="sa-ppt" data-ppt="…">` | Node | `node tools/mark-ppt.mjs --file page.html --pages 4,8 --dry` |

## 二、写作与合稿

| 脚本 | 作用 | 典型命令 |
|---|---|---|
| `course-new.mjs` | 新建内容页骨架（四块结构 + Mermaid 示例 + 检测题占位） | `node tools/course-new.mjs 03 vCPU1 虚拟化-CPU` |
| `assemble.mjs` | 若干正文片段 → 一个完整内容页（套标准头、检查 h2/h3 缺 id） | `node tools/assemble.mjs 03_vcpu1 "标题" .work/s1.final.html` |
| `compose-quizzes.mjs` | 按复核题单重建「检测题」区块（兼容多种复核写法） | `node tools/compose-quizzes.mjs --review r.md --a a.html --b b.html --out t.html` |
| `apply-patches.mjs` | 把复核报告的 **PATCH 清单**机械应用到片段；支持 `--as A\|B` 过滤与 `IMPORT` 跨文件搬块 | `node tools/apply-patches.mjs review.md frag.html --as A` |
| `merge-pages.mjs` | 多段合并 + 全局重编号 + id 唯一性 + 元叙述残留 + **全页题量上限**检查 | `node tools/merge-pages.mjs out.html s1.html s2.html` |

## 三、质量检查

| 脚本 | 作用 | 何时跑 |
|---|---|---|
| `lint-fragment.mjs` | 片段预检（10 类）：完整文档误写 / 缺 id / Markdown 残留 / Mermaid 写法 / 内联脚本 / 题量 / 页码引用 / 图片类型 / 字符画。`--page` 校验完整内容页，`--allow-no-cite` 放过示例页 | 合稿前 |
| `self-check-quizzes.mjs` | **题目可答性**：答案唯一、干扰项都被点破、解析带页码、题干长度、同页重复 | 出完题后 |
| `check-pages.mjs` | **运行时页面检查**：把每个壳页面在真机/模拟器里打开一遍，抓 JS 异常与控制台错误（静态检查看不见「缺 DOM id 导致按钮失效」这类问题） | 装机后 / 改壳层后 |

> `check-pages.mjs` 需要连着一台开着 WebView 调试的 debug 包设备：
> ```bash
> ADB=F:/Android/sdk/platform-tools/adb.exe SERIAL=127.0.0.1:16384 npm run check:pages
> ```

---

## 四、典型全流程

```bash
python tools/pdf-extract.py lecture.pdf --out .work/deck --render   # 1 抽取
node tools/course-new.mjs 03 vCPU1 "vCPU-1 虚拟化"                    # 2 建骨架（或直接写片段）
node tools/assemble.mjs 03_vcpu1 "vCPU-1 虚拟化" .work/s1.final.html   # 3 合稿
node tools/lint-fragment.mjs content/os/03_vcpu1.html --page          # 4 预检
node tools/self-check-quizzes.mjs content/os/03_vcpu1.html            # 5 题目自检
node scripts/build.mjs && node scripts/verify.mjs                     # 6 编译 + 校验
node scripts/pack.mjs --id vcpu1 --title "vCPU-1" --version 1.0.0     # 7 打包
node scripts/verify-package.mjs dist/vcpu1-1.0.0.lcr                  # 8 包校验
```

## 五、为什么脚本在仓库里而不是只在技能里

技能是"怎么想"，脚本是"怎么做"。脚本放仓库：可以被 CI 跑、可以被别人复现、改错了有 diff 可查。
技能文档见 [`../docs/skill/`](../docs/skill/)。

### `decks.sample.json`

`ppt-shots.mjs --all` 用的「讲次 → 课件 PDF / 抽取目录」映射表样例。
复制成 `tools/decks.json` 后按自己的课件改（该文件在 `.gitignore` 之外，可提交也可不提交），
或直接用 `--decks <你的文件>` 指定。缺省时脚本用内置 9 门示例表并打印提示。
