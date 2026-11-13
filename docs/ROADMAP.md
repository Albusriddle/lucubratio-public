# 路线图

> 目标：从"内容编译进 APK"变成"流水线生成课程包 → App 导入学习"的生态形态。
> 原则：先做 3 天验证再投两周；每一步都保持可运行、可回退。

## 已完成的既有缺陷修复（P0/P1/P2）

| 编号 | 问题 | 状态 |
|---|---|---|
| P0-1 | `verify-package` 正则可被无引号/单引号/内联 script 绕过 | ✅ 换成 `scripts/lib/htmlguard.mjs` 标签级扫描；9 个探针全被拒 |
| P0-2 | `pack.mjs` 不重写页面 `data-*` | ✅ 改写 5 个属性 + manifest id + search 键/sections；并拒绝二次打包 |
| P0-3 | `build.mjs` 注入内联 `<script>` | ✅ 改为 `data-lib` 属性，`mermaid-init.js` 用 `document.currentScript` 读取 |
| P1-1 | `format.bytes` 恒 0 | ✅ 打包时回填，校验器交叉核对 |
| P2-1 | 备份遍历全部 store | ✅ `db.BACKUP_STORES` 白名单，`store.js` 4 处改用 |
| P2-2 | `smoke.mjs` 硬编码 schema===1 | ✅ 改为与 `DB_VERSION` 比对 |

## 设备验收结果（MuMu Android 15 模拟器，2026-11-08）

用 `Lucubratio-dev-v0.2.0.apk` + `demo-0.2.1.lcr` 实测（**0.2.x 时期**；0.3.4–0.3.10 的版面已在 **2026-11-13 用 MuMu/Android 15 复跑**，结果见 [`DEVICE-CHECKLIST.md`](DEVICE-CHECKLIST.md) §6）：

| 项 | 结果 |
|---|---|
| 导入课程包（SAF） | ✅ 落到 `files/courses/demo/{format,manifest,search}.json + content/` |
| 首页课程库 | ✅ 「内置课程 2 篇」+「我的课程 1 门 · 2 篇」，含版本/体积/导入日期/删除按钮 |
| 打开导入课程页 | ✅ 壳层样式、目录、自评条（3 个）全部正常；`data-cid=demo:os-01`、`data-cver=demo@0.2.1#…` |
| 自评建卡 | ✅ 写入 `qid=demo:os-01#检测 1`、`cid=demo:os-01`，cver 与页面一致 |
| 冷启动持久化 | ✅ 课程与卡片都在 |
| 跨课程搜索 | ✅ 搜「检测」命中 8 条，内置与导入课程同时出现 |
| 课程更新（同 id 覆盖） | ✅ 从 0.2.0 升到 0.2.1，Toast/首页版本同步；**旧卡片自动进「待复核」** |
| 删除课程 | ✅ **目录页**每门导入课程行内「删除」→ 自绘确认弹窗 → 原生删文件 + 清本地数据（0.3.1 起；此前入口在首页，P4 搬页后曾一度丢失） |
| D3 空内置 | ✅ 空包启动显示「0 篇 / 还没有课程」且无「内置课程」段；导入后只剩「我的课程」 |

验收中发现并修复的两个真问题：
- 示例页正文写成 `**加粗**`（Markdown 记号）→ 改为 `<strong>`，并在 verify 增加"正文不得残留 Markdown 星号"检查
- 深色主题下 `blockquote` 浅底浅字几乎不可读 → 改为深底浅字（`#2b2b23` / `#e8dcc0`）

## 阶段 0 · Spike（3 天）— 先证伪

| 天 | 做什么 | 通过标准 |
|---|---|---|
| D1 ✅ | **已完成**：`scripts/pack.mjs`（零依赖 zip 写入 + 路径重写）、`scripts/verify-package.mjs`（11 项校验，含检索索引一致性）、`scripts/test-package.mjs`（15 项正/负面自测） | 示例包 ~18KB，校验 11/11 通过；Zip Slip / 外部脚本 / 缺页 / 未知格式 全部被拒 |
| D2 ✅ | **已完成**（0.1.x 起）：`UserCoursesHandler` 把 `/courses/` 映射到 `filesDir/courses/`，导入入口走 SAF（`CourseImporter`） | 导入后能打开 `courses/<id>/content/os/xx.html`，壳层样式与 Mermaid 正常 |
| D3 | **清空内置课程**，只靠导入包跑 | 首页/阅读/自评/搜索/统计/重启后仍在 —— 全通 |

> 这一步不写 UI、不做校验器。目的只有一个：证明"静态站点可以整体搬到 filesDir 并被查看器正常使用"。

## 阶段 1 · MVP（约 8–10 人日）

- [x] `scripts/pack.mjs`：build → zip → `format.json` + `sha256` → `dist/<id>-<version>.lcr`
- [x] `scripts/verify-package.mjs`：离线校验包结构和安全规则（见 PACKAGE-FORMAT §4）
- [x] Java 导入器：SAF 选包 → 流式解压（防 Zip Slip / Zip 炸弹）→ 全量校验（含 HtmlGuard）→ ATOMIC_MOVE 提交（失败回滚）
- [x] Java `UserCoursesHandler`：`/courses/` → `filesDir/courses/`（含 `/courses/index.json` 动态注册表；`Mime` 共用；缺文件返 404 不回落网络）
- [x] 课程库（P4 起在**目录页**，首页只保留继续学习 / 待复习 / 孤儿卡）：内置课程 + 我的课程（`web/shell/library.js` 合并两份清单；显示页数/体积/导入时间；无桥时自动隐藏该段）
- [x] 数据层：**不升 DB 版本**（命名空间前缀即可精确删数据）；`BACKUP_STORES` 白名单已加
- [x] 搜索：`loadSearchIndex()` 合并内置 + 各课程的 `search.json`（cids 已命名空间化，键不冲突）

### Step 7 已完成项（D3 空内置）

- [x] `node scripts/build.mjs --empty`：产出 `empty:true` / `groups:[]` / 无 `content/` 的包
- [x] `verify.mjs` 自动放行空构建（页面数量基线跳过，壳资源/体积等仍校验）
- [x] 首页空态：完全没有课程时显示「还没有课程。点上方「＋ 导入课程包」…」
- [x] 出空内容 APK 的正确姿势：`npm run build:empty` 后再 `SKIP_WEB_BUILD=1` 打包
- [x] CI 增加"空构建冒烟"步骤，防止这条路径腐化

### Step 8/9 已完成项

- [x] 删除课程：Java `CourseStore.delete()` + `Bridge.deleteCourse()`；入口在**目录页**（自绘确认弹窗，本壳 `window.confirm` 无效）+ `deleteCourseData()` 按 `<课程id>:` 前缀清进度/卡片/日志
- [x] APK 资源口径：构建只回填「被页面引用」的课件截图（公开仓库 0 张；私有仓库按引用数），不再夹带未引用图
- [x] 多课程搜索：`library.loadSearchIndex()` 合并多份索引；搜索页改用该入口
- [x] 多课程复习：`review.js` 标题表来自课程库（导入课程的卡片不再显示裸 cid）
- [x] 启动清理：`CourseStore.cleanupTemp()` 清 `.tmp-*` / `.trash-*` 残留

## 阶段 2 · 生成侧体验（约 3–5 人日）

- [x] **DSH 技能**：`lucubratio-course`（`SKILL.md` + 6 个附件，镜像在 [`skill/`](skill/)）。
        已用 3 门课件试跑（conc-1 52 页 / vm-3 79 页 / vm-2 90 页），产出 3 个课程包；
        双盲 + 复核共拦下 15 处编造、19 处硬性事实错。
- [ ] 规则去硬编码：`QUESTION_RULES` 改为由 `manifest.json` 声明（`questions: [{level, pattern}]`）
- [ ] 模板仓库：`lucubratio-template`，给不写代码的人一个"把课件丢进去就能出包"的最小入口

## 阶段 4 · 0.3.x 阅读体验与发版闸门（已完成，2026-11-11 → 11-13）

| 版本 | 内容 |
|---|---|
| 0.3.1 | APK 不再夹带课件截图（改为按引用回填）；恢复「删除课程」入口（P4 搬页后一度丢失）；切页动效覆盖首页；壳页资源加 `?v=` |
| 0.3.2 | 底栏样式自包含（4 个次级页面此前 SVG 撑满屏）；损坏课程仍可见可删；构建期 `data-ppt` 断言；`wrapTables` 跳过 `<pre>` |
| 0.3.3 | 正式包名改为 `com.lucubratio.reader.public`（与私有自用版共存不冲突） |
| 0.3.4 | 阅读体验五连改（吸顶章标题、宽屏顶栏/遮罩、侧栏过滤自评题等） |
| 0.3.5 | 目录页删除确认按钮改为红色「删除」 |
| 0.3.6 | 目录/侧栏 5 项：底栏遮挡、标题换行、弹窗居中、侧栏截断、虚假跳转 |
| 0.3.7 | `scripts/check-changelog.mjs` 抽成独立守则（CI 与 `test:all` 共用）；新增 [`DEVICE-CHECKLIST.md`](DEVICE-CHECKLIST.md) |
| 0.3.8 | `release.yml` 补 CHANGELOG / 空构建检查（0.3.4–0.3.6 曾从该缺口漏出）；Secrets 单一来源 |
| 0.3.9 | `push-retry.sh` 支持 tag 校验（此前推 tag 必报"远端不可达"）；发版流程实战 |
| 0.3.10 | 真机验收 8 项修复：按钮字号被 CSS 重置、demo 解析不合规、verify 报错指路、探针库残留、术语统一等 |
| 0.3.11 | **全站页面切换过渡**（幕布淡出→黑→淡入）+ 弹窗开/关动画；返回与 bfcache 兜底 |
| 0.3.12 | 修 VT 设备上三个过渡入口未定义（真机反而比模拟器更少动效的隐患）；`prefers-reduced-motion` 实时读取；幕布 z-index 让位 splash；新增导航静态守则 `check-nav` |
| 0.3.13 | 技能与仓库文档对齐：SKILL.md §5 五步校验（含题目自检硬门）、§3 新页必须配 `QUESTION_RULES`；`pitfalls.md` 补 3 类新错误；`prompts.md` 加「解析首句 X 对」；test:all 步数 11→12 |

> 真机验收：**2026-11-13 已在 MuMu（Android 15，1080×2340@440dpi）复跑**（0.3.9 debug 包 + 注入课程）。
> 通过：底栏不遮挡（间距 39–658px）、无横向滚动、章行 75/25（实测 0.749）、长标题换行不截断、
> 点目录不关抽屉且滚动到位、弹窗精确居中、危险按钮红色、横屏顶栏/☰ 正常、深浅主题持久化、两包共存、删除课程清数据。
> 同时查出 8 项问题（按钮字号被 CSS 重置 / demo 不合规 / verify 报错不指路 / 探针库残留等），**已在 0.3.10 修复**，明细见 §6。

## 阶段 3 · 生态化（按需）

> 下列均为 0.4+ 候选，**尚未开始**；按优先级从上到下。

- [ ] 课程版本与更新提示、孤儿卡迁移向导
- [ ] 质量徽章：`verify-package` 通过 + 抽检通过 → 标记为"校验通过"
- [ ] 许可拆分落地：平台 Apache-2.0 / 文档 CC BY 4.0 / 内容各自保留
- [ ] （可选）分享页：只生成"课程清单 + 校验和"，不做集中分发

## 明确不做

- 不做账号系统、云同步、在线课程市场
- 不做内容审核平台（分发靠用户之间自己传文件）
- 不把课程素材打进公开仓库

## 风险与对策（摘要）

| 风险 | 对策 |
|---|---|
| Zip Slip | 解压时规范化路径，拒绝 `..`、绝对路径、符号链接 |
| 同源 XSS（恶意包读别的课程数据） | 导入时禁止 `<script src>`、`on*`、外链；可选 sha256 白名单 |
| 存储配额 | 单包 ≤200MB、总 ≤1GB，导入前显示体积 |
| 格式演进 | `format: lcr/1` + `appMin`；未知版本拒绝并提示升级 |
| 课程更新导致旧卡片失效 | 复用现有孤儿卡对账，更新时提示重新学习 |
