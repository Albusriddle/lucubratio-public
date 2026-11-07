# 路线图

> 目标：从"内容编译进 APK"变成"流水线生成课程包 → App 导入学习"的生态形态。
> 原则：先做 3 天验证再投两周；每一步都保持可运行、可回退。

## 阶段 0 · Spike（3 天）— 先证伪

| 天 | 做什么 | 通过标准 |
|---|---|---|
| D1 | 手工把示例课程打成 `.lcr`（zip + format.json） | 包能被 `unzip -l` 正常展开，`format.json` 校验通过 |
| D2 | App 端加 `/courses/` 的 `PathHandler`（映射 `filesDir`）+ 一个硬编码导入入口 | 导入后能打开 `courses/<id>/content/os/xx.html`，壳层样式与 Mermaid 正常 |
| D3 | **清空内置课程**，只靠导入包跑 | 首页/阅读/自评/搜索/统计/重启后仍在 —— 全通 |

> 这一步不写 UI、不做校验器。目的只有一个：证明"静态站点可以整体搬到 filesDir 并被查看器正常使用"。

## 阶段 1 · MVP（约 8–10 人日）

- [ ] `scripts/pack.mjs`：build → zip → `format.json` + `sha256` → `dist/<id>-<version>.lcr`
- [ ] `scripts/verify-package.mjs`：离线校验包结构和安全规则（见 PACKAGE-FORMAT §4）
- [ ] Java 导入器：SAF 选包 → 校验 → 解压（防 Zip Slip）→ 写注册表
- [ ] Java `UserCoursesHandler`：`/courses/<id>/...` → `filesDir/courses/<id>/...`（复用 MIME 表）
- [ ] 首页「课程库」：内置课程 + 我的课程（导入/删除/更新、显示体积与页数）
- [ ] 数据层：`courses` 表（schema v1→v2）+ 删课时清数据
- [ ] 搜索：多份 `search.json` 合并（首次搜索缓存到 IndexedDB）

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
