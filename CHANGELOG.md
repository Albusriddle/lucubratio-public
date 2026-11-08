# 更新日志

本仓库（`lucubratio-public`）是 Lucubratio 的**流水线 + 查看器**部分，不含任何课程素材。

## [0.2.2] - 2026-11-08

### 修复

- **内容页点 ☰ 抽屉打不开**（v0.2.0/0.2.1 已发布的 bug）：`page.js` 与 `shell.css` 依赖页面内的
  `<aside id="sidebar">`，而 v2 风格的内容页没有这个元素 → 点 ☰ 只让遮罩变深、抽屉永远不出现；
  宽屏下更完全无反应（抽屉样式只写在 `max-width:880px` 里）。
  - 修复：`page.js` 在缺少 `#sidebar` 时按 `h2/h3` **现生成抽屉**（按 h2 分章折叠、打开时高亮当前章）；
    `shell.css` 补一套全宽度生效的抽屉几何与折叠样式
  - 来源：私有版本 v3.0.2（commit `613b441`）的同一修复，本次**反向同步**到公开仓库
  - 验证：MuMu（412×900）点 ☰ → 抽屉展开、6 章 7 节、当前章高亮

## [0.2.1] - 2026-11-08

### 变更

- **本仓库的 Release 改用独立签名钥匙**（与私有版 App 的 keystore 不同）：
  - 证书 SHA-256 `3B:48:73:70:C2:28:3B:E7:67:5E:7B:07:D5:31:E2:B3:AC:F6:74:69:2C:BC:4B:91:2C:B5:47:AE:73:E5:4D:6E`
  - 仓库 Secrets 已配置 `KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`
  - Release 产物从 `lucubratio-<tag>-debug.apk` 变为 **`lucubratio-<tag>-release.apk`**（正式签名）
- `release.yml`：签名自适应逻辑保持不变（无 Secrets 仍会出 debug 包并标注）

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
