# 更新日志

本仓库（`lucubratio-public`）是 Lucubratio 的**流水线 + 查看器**部分，不含任何课程素材。

## [0.2.0] - 2026-11-08

**课程包生态打通**：从「内容烤进 APK」变成「生成 `.lcr` → App 内导入 → 首页可见 → 可读可测可复习」。

### 新增

- **课程包格式 `.lcr`**（zip：`format.json` / `manifest.json` / `search.json` / `content/` / `img/`），见 [docs/PACKAGE-FORMAT.md](docs/PACKAGE-FORMAT.md)
- **打包器** `scripts/pack.mjs`：零依赖 zip 写入、路径重写、cid 命名空间化（`<课程id>:<原cid>`）、`format.bytes`、二次打包保护
- **包校验器** `scripts/verify-package.mjs`：11 项（zip 安全 / 结构 / 一致性 / 标签级内容安全 / 体积）
- **App 内导入**：SAF 选包 → 流式解压 → 全量校验（含 Java 侧 HtmlGuard）→ `ATOMIC_MOVE` 提交（失败回滚）
- **课程库首页**：内置课程 + 我的课程（页数/体积/导入时间），支持删除（两段式确认，删课同时清进度/卡片/日志）
- **多课程**：搜索索引合并、复习标题表、逐页孤儿卡对账（`reconcileByCid`）全部支持导入课程
- **D3 空内置**：`npm run build:empty` 产出无内置内容的包，课程全靠导入
- 文档：[docs/IMPORT.md](docs/IMPORT.md)（怎么做自己的课程包）、[docs/ROADMAP.md](docs/ROADMAP.md)、[docs/AGENTS-SPEC.md](docs/AGENTS-SPEC.md)

### 修复（既有缺陷）

- `verify-package` 的正则安全门可被**无引号 / 单引号 / 内联 `<script>`** 绕过 → 换成标签级扫描 `scripts/lib/htmlguard.mjs`（Java 侧 `HtmlGuard` 同规则）
- `pack.mjs` 不重写页面 `data-*` → 导入课程会死链、跨课串数据；现在改写 5 个属性 + manifest id + 搜索键
- `build.mjs` 注入内联 `<script>`（与"禁内联 + CSP"冲突）→ 改为 `data-lib` 属性
- `format.bytes` 恒为 0 → 打包时回填并交叉校验
- 备份遍历全部 IndexedDB store → 改为 `BACKUP_STORES` 白名单
- `smoke.mjs` 硬编码 `schema===1` → 改为与 `DB_VERSION` 比对
- debug 构建加 `.dev` 包名后缀，避免覆盖正式版数据

### 测试

`npm test`（21 项纯函数）+ `test-library`（14 项课程库）+ `test-package`（15 项打包/校验，含 7 个恶意探针）+ `verify:device`（设备侧 5 项）。

## [0.1.0] - 2026-11-08

从主项目（含个人课程内容的私有仓库）提炼出「流水线 + 查看器」平台部分，Apache-2.0 发布。
