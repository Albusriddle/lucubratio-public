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

# 3) 纯函数单测
npm test

# 4) 出 APK（需要 JDK 17 + Android SDK 35）
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

> 未来会改成「课程包 `.lcr` + App 内导入」，见 [`docs/PACKAGE-FORMAT.md`](docs/PACKAGE-FORMAT.md) 与 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 许可（待定，重要）

⚠️ 本仓库当前沿用 `LICENSE`（源码可见 · 非商业 · 禁止公开衍生）——这是从个人自用项目继承来的条款，**与"人人可定制、可分享课程"的生态目标冲突**。

建议在首次公开发布前调整为：

| 对象 | 建议许可 |
|---|---|
| 流水线 / 查看器（`web/`、`scripts/`、`android/`） | Apache-2.0（含专利授权，适合做平台） |
| 规范文档（`docs/`） | CC BY 4.0 |
| **课程内容** | 由内容作者自行决定（默认建议 CC BY-NC-SA 或"仅个人使用"） |

在变更前，请把本仓库视为**私有项目**。

## 免责

本仓库不提供任何课件、教材、讲义截图。使用者把课堂材料转成内容时，**版权与合规责任自负**——此类转换通常只适合个人学习，不宜公开分发。
