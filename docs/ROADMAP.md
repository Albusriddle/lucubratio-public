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

## 阶段 0 · Spike（3 天）— 先证伪

| 天 | 做什么 | 通过标准 |
|---|---|---|
| D1 ✅ | **已完成**：`scripts/pack.mjs`（零依赖 zip 写入 + 路径重写）、`scripts/verify-package.mjs`（11 项校验）、`scripts/test-package.mjs`（6 项正/负面自测） | 示例包 10.0KB，校验 11/11 通过；Zip Slip / 外部脚本 / 缺页 / 未知格式 全部被拒 |
| D2 | App 端加 `/courses/` 的 `PathHandler`（映射 `filesDir`）+ 一个硬编码导入入口 | 导入后能打开 `courses/<id>/content/os/xx.html`，壳层样式与 Mermaid 正常 |
| D3 | **清空内置课程**，只靠导入包跑 | 首页/阅读/自评/搜索/统计/重启后仍在 —— 全通 |

> 这一步不写 UI、不做校验器。目的只有一个：证明"静态站点可以整体搬到 filesDir 并被查看器正常使用"。

## 阶段 1 · MVP（约 8–10 人日）

- [x] `scripts/pack.mjs`：build → zip → `format.json` + `sha256` → `dist/<id>-<version>.lcr`
- [x] `scripts/verify-package.mjs`：离线校验包结构和安全规则（见 PACKAGE-FORMAT §4）
- [x] Java 导入器：SAF 选包 → 流式解压（防 Zip Slip / Zip 炸弹）→ 全量校验（含 HtmlGuard）→ ATOMIC_MOVE 提交（失败回滚）
- [x] Java `UserCoursesHandler`：`/courses/` → `filesDir/courses/`（含 `/courses/index.json` 动态注册表；`Mime` 共用；缺文件返 404 不回落网络）
- [x] 首页「课程库」：内置课程 + 我的课程（`web/shell/library.js` 合并两份清单；显示页数/体积/导入时间；无桥时自动隐藏该段）
- [x] 数据层：**不升 DB 版本**（命名空间前缀即可精确删数据）；`BACKUP_STORES` 白名单已加
- [x] 搜索：`loadSearchIndex()` 合并内置 + 各课程的 `search.json`（cids 已命名空间化，键不冲突）

### Step 8/9 已完成项

- [x] 删除课程：Java `CourseStore.delete()` + `Bridge.deleteCourse()`；网页两段式确认（本壳 `window.confirm` 无效）+ `deleteCourseData()` 按 `<课程id>:` 前缀清进度/卡片/日志
- [x] 多课程搜索：`library.loadSearchIndex()` 合并多份索引；搜索页改用该入口
- [x] 多课程复习：`review.js` 标题表来自课程库（导入课程的卡片不再显示裸 cid）
- [x] 启动清理：`CourseStore.cleanupTemp()` 清 `.tmp-*` / `.trash-*` 残留

## 阶段 2 · 生成侧体验（约 3–5 人日）

- [ ] **DSH 技能**：从 PDF/PPTX 出发 → 逐页文本 → 双盲生成 → 复核 → 打包（把本项目已有的 `AGENTS-SPEC` 固化成一键流程）
- [ ] 规则去硬编码：`QUESTION_RULES` 改为由 `manifest.json` 声明（`questions: [{level, pattern}]`）
- [ ] 模板仓库：`lucubratio-template`，给不写代码的人一个"把课件丢进去就能出包"的最小入口

## 阶段 3 · 生态化（按需）

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
