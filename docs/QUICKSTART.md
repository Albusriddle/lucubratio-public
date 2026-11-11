# 快速开始：三条路，挑一条走

> 这个仓库提供「**编译器 + 查看器**」，不提供任何课程内容。
> 你想怎么用，决定了你该走哪条路。

| 你想要 | 走哪条 | 需要会什么 |
|---|---|---|
| 只想**读**自己的课程 | [路径 A](#路径-a只读自己的课程) | 会用命令行跑几条命令 |
| 想改**界面/功能** | [路径 B](#路径-b改界面或功能) | 会写 HTML/CSS/JS |
| 想**做一个自己的 App** | [路径 C](#路径-c做成自己的-app) | 会改包名、能自己发版 |

---

## 路径 A：只读自己的课程

**目标**：5 分钟内看到自己的内容能读、能自测、能复习。

### A1. 拿到能用的 APK

两种方式，任选：

- 用本仓库 Releases 页的 APK（若已发布）
- 或自己构建（见 A4）

### A2. 写内容

在 `content/os/` 放你的页面，格式照 [`CONTENT-SPEC.md`](CONTENT-SPEC.md)：

```html
<h2 id="1-本节讲什么">1. 本节讲什么</h2>
<p>正文…</p>
<h3 id="检测 1">检测 1（10 分）题干…</h3>
<p>A. … B. … C. … D. …</p>
```

三个硬要求：

1. 每个 `<h2>/<h3>` 有**页内唯一 id**
2. 想让某标题成为自评单元 → 去 `scripts/build.mjs` 的 `QUESTION_RULES` 加一条规则
3. 图用 **Mermaid**，别贴字符画（手机上必然错位）

### A3. 打包成课程包

```bash
node scripts/build.mjs                                  # 编译
node scripts/verify.mjs                                 # 校验（锚点/图片/公式/自评数）
node scripts/pack.mjs --id my-course --title "我的课" --version 1.0.0
node scripts/verify-package.mjs dist/my-course-1.0.0.lcr  # 分发前必做
```

把 `dist/my-course-1.0.0.lcr` 传到手机 → App 首页「＋ 导入课程包」→ 选它。

### A4. （可选）自己出 APK

```bash
npm run build:debug      # 需要 JDK 17 + Android SDK 35
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

> 详细步骤与错误码见 [`IMPORT.md`](IMPORT.md)。

---

## 路径 B：改界面或功能

### 目录速查

| 想改什么 | 改哪里 |
|---|---|
| 首页内容与交互 | `web/index.html` + `web/shell/home.js` |
| 首页/我的页样式（布局、卡片、数据行） | `web/shell/home.css` |
| 底栏三 tab 与切页动效 | `web/shell/tabbar.js`、`web/shell/nav.js` |
| 目录页（三级树、展开记忆） | `web/toc.html` + `web/shell/toc.js` |
| 我的页（设置、备份、存储） | `web/me.html`（逻辑复用 `home.js`） |
| 阅读页行为（顶栏/抽屉/断点续读/自评条/解析折叠） | `web/shell/page.js` |
| 课件页截图（`sa-ppt` 标记 → 图片） | `scripts/build.mjs`（替换）+ `tools/ppt-shots.mjs`（生成） |
| 课程库合并逻辑 | `web/shell/library.js` |
| 数据层 / 复习算法 | `web/shell/store.js`、`fsrs.js`、`db.js` |
| 深色主题配色 | `web/shell/theme.css` |
| 导入器 / WebView 壳 | `android/.../CourseImporter.java`、`MainActivity.java` |
| 编译规则（公式、自评、索引、表格包裹） | `scripts/build.mjs` |
| 改完自检 | `npm run test:all`（与 CI 同套）+ `npm run check:pages`（真机跑页面） |

### 改完怎么验

```bash
npm test                 # 21 项纯函数
npm run test:library     # 14 项课程库
npm run test:package     # 15 项打包/安全
node scripts/verify.mjs  # 产物静态校验
```

CI 会在 PR 上跑同一套（含"空构建冒烟"）。

---

## 路径 C：做成自己的 App

### C1. Fork + 改身份

```bash
git clone https://github.com/<你>/lucubratio-public.git my-app
cd my-app
```

需要改的地方（都在 `android/` 里）：

| 项 | 位置 | 说明 |
|---|---|---|
| 包名 | `android/app/build.gradle` 的 `namespace` + `applicationId` | 改成你自己的域名反写 |
| Java 包目录 | `android/app/src/main/java/com/lucubratio/reader/` | 跟着包名改目录与 `package` 行 |
| 应用名 | `android/app/src/main/res/values/strings.xml` 的 `app_name` | 桌面显示名 |
| 图标题 / 开屏 | `web/index.html` | 首页 `<h1>` 与开屏文案 |

### C2. 决定要不要内置内容

- **内置**：把你的课程放进 `content/os/` 一起构建（用户装完就有内容）
- **不内置**：`npm run build:empty` 出空包，课程全靠导入（见 [`PACKAGE-FORMAT.md`](PACKAGE-FORMAT.md)）

> ⚠️ 内置内容注意合规：他人课件/教材通常只适合个人学习。

### C3. 发版

1. 在 `CHANGELOG.md` 加一段 `## [x.y.z] - 日期`
2. 改 `package.json` 的 `version`（唯一版本来源，同时决定 versionCode）
3. `git tag vx.y.z && git push origin main --tags`

`.github/workflows/release.yml` 会：跑测试 → 构建 → **有签名 Secrets 就出正式包，没有就出 debug 包并标注** → 用 CHANGELOG 生成 Release 说明。

签名 Secrets（可选）：`KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`。

---

## 常见坑（都踩过）

| 坑 | 现象 | 解决 |
|---|---|---|
| Gradle 覆盖内容 | 刚 `build:empty` 完，打出的 APK 又带内容了 | 打包时加 `SKIP_WEB_BUILD=1`（`preBuild` 会自动跑 `build.mjs`） |
| 装不上 | `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | debug 带 `.dev` 后缀，与正式包不同签名；先卸载对应包 |
| 图片 404 | 页面里写 `/img/x.png` 但资产是 `.webp` | 一律用 `.webp` |
| 课程包被判失败 | `E_HTML: 内联 <script>` | 页面里只能有 `<script type="text/plain">`（Mermaid 源码）和 `/shell/*.js` |
| 导入后"继续学习"死链 | 手工改了 manifest 没改页面 | 别手改包，用 `pack.mjs` 重新打包 |
| 改动没生效 | 浏览器/WebView 缓存 | 构建会给资源加 `?v=<版本>`；必要时 `adb shell pm clear` |

---

## 下一步

- 内容格式：[`CONTENT-SPEC.md`](CONTENT-SPEC.md)
- 课程包格式：[`PACKAGE-FORMAT.md`](PACKAGE-FORMAT.md)
- 打包/导入教程：[`IMPORT.md`](IMPORT.md)
- 路线图：[`ROADMAP.md`](ROADMAP.md) ｜ 变更：[`../CHANGELOG.md`](../CHANGELOG.md)
