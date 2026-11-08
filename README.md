# Lucubratio · 流水线 + 查看器

> 把**任意课程内容**编译成可离线学习的内容包，再用一个只读查看器读它、记进度、按 FSRS 复习。
>
> 本仓库**只提供流水线与查看器**，不含任何课程素材。示例页（`content/os/01`、`02`）是自撰的格式demo。

---

## 这是什么

三件东西，彼此解耦：

| 部分 | 位置 | 作用 |
|---|---|---|
| **内容规范** | [`docs/CONTENT-SPEC.md`](docs/CONTENT-SPEC.md) | 一页内容该怎么写：标题/锚点、公式、Mermaid 图、表格、自评单元、图片 |
| **编译器** | [`scripts/build.mjs`](scripts/build.mjs) | 源 HTML → 可运行站点：注入壳层、公式转 MathML、给命中规则的标题打自评标记、生成检索索引与 manifest |
| **查看器** | [`web/`](web) + [`android/`](android) | 离线阅读、目录抽屉、断点续读、自评 → FSRS 复习、全文搜索、学习统计 |

生成侧还有一套**作业规范**：[`docs/AGENTS-SPEC.md`](docs/AGENTS-SPEC.md) —— 规定了"双人独立产出 + 第三人复核"的流程，用来保证 AI 生成的内容不出事实错误。

## 快速开始

```bash
# 1) 编译（零依赖，只需 Node 20+）
node scripts/build.mjs

# 2) 校验产物（锚点/图片/公式基线/自评单元数）
node scripts/verify.mjs

# 3) 纯函数单测 + 打包器自测
npm test
npm run test:package

# 4)（可选）出一个"没有内置内容"的包：课程全靠导入
npm run build:empty
SKIP_WEB_BUILD=1 npm run build:debug   # 必须跳过 preBuild，否则会被常规构建覆盖

# 5) 打成课程包（.lcr，可校验后分发）
npm run pack -- --id demo --title "示例课程" --version 0.1.0
npm run verify:package -- dist/demo-0.1.0.lcr

# 6) 出常规 APK（需要 JDK 17 + Android SDK 35）
npm run build:debug
```

产物在 `android/app/src/main/assets/web/`，这是构建输出、不入库。

## 目录结构

```
content/os/          # 课程内容（源）：本仓库只有 2 页 demo，请替换成你自己的
web/                 # 查看器（壳层 HTML/JS/CSS + 内置 Mermaid / ts-fsrs）
scripts/             # 编译器 / 校验器 / 单测 / 冒烟 / 打包 / gradle 入口
android/             # Android WebView 壳（无网络权限，纯本地）
docs/                # 内容规范 / 作业规范 / 课程包格式 / 路线图
```

## 设计约束（有意为之）

- **完全离线**：APK 不声明 `INTERNET` 权限。
- **不用 `file://`**：所有页面走 `WebViewAssetLoader` 的 `https://appassets.androidplatform.net`，否则 IndexedDB 不可持久。
- **内容与壳分离**：`content/` 是内容源，`android/.../assets/web/` 只是产物；改内容永远改源文件。
- **图只用 Mermaid**：字符画在手机上必然错位（中文不是等宽两倍）。

## 你自己接课程

1. 读 [`docs/CONTENT-SPEC.md`](docs/CONTENT-SPEC.md)，按格式写 `content/os/NN_标题.html`；
2. 在 `scripts/build.mjs` 的 `QUESTION_RULES` 里为你的页面加一条自评规则；
3. 跑 `node scripts/build.mjs && node scripts/verify.mjs`；
4. 出 APK 自己装。

> **已经支持「课程包 `.lcr` + App 内导入」**：教程见 [`docs/IMPORT.md`](docs/IMPORT.md)，
> 格式见 [`docs/PACKAGE-FORMAT.md`](docs/PACKAGE-FORMAT.md)，进度见 [`docs/ROADMAP.md`](docs/ROADMAP.md)；
> 版本变更见 [`CHANGELOG.md`](CHANGELOG.md)。

## 许可

本仓库以 **Apache License 2.0** 发布，全文见 [LICENSE](LICENSE)。要点：

- ✅ 可以自由使用、修改、分发（含商业使用）
- ✅ 附带专利授权（贡献者不会因专利反诉你）
- ✅ 改了什么不必开源，但需保留版权与许可声明、并在修改过的文件里注明
- ⚠️ **课程内容不在本许可范围内**：`content/` 里你自己生成的课程，版权归你；若内容来自他人讲义/教材，公开分发前请自行取得授权
- 商标与项目名（Lucubratio）不在授权范围内

> 若你 fork 后对外分发，建议保留 `NOTICE`（如有）与本 LICENSE 文件。

## 免责

本仓库不提供任何课件、教材、讲义截图。使用者把课堂材料转成内容时，**版权与合规责任自负**——此类转换通常只适合个人学习，不宜公开分发。
