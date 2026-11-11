# 更新日志

本仓库（`lucubratio-public`）是 Lucubratio 的**流水线 + 查看器**部分，不含任何课程素材。

<!-- 书写约定：新版本段插在 [Unreleased] 之后；「暂无」占位符只保留在 [Unreleased] 里那一处，
     写新版时不要把它往下挤（历史上因此出现过 2 处孤立占位符）。npm run test:all 会检查这一点。 -->

## [Unreleased]

（暂无）

## [0.3.3] - 2026-11-11

### 变更（安装身份）

- **正式版包名改为 `com.lucubratio.reader.public`**（`applicationIdSuffix ".public"`）
  - 原因：私有仓库的自用 App 占用 `com.lucubratio.reader` 且 versionCode 更大，
    同包名安装会被系统判为降级（`INSTALL_FAILED_VERSION_DOWNGRADE`）而失败
  - 效果：查看器（公开版）与自用 App 可**同时安装**；debug 版仍是 `.dev` 后缀
  - 代价：从 v0.2.x 公开版升级会变成"装第二个 App"（老版本可自行卸载）

## [0.3.2] - 2026-11-11

### 修复

- **底栏样式自包含**：`.sa-tabbar` / `.sa-tab` / SVG 尺寸 / `body.has-tabbar` 全部内联进 `tabbar.js`
  （此前样式只在 `home.css`，搜索/统计/复习/环境自检四页挂了脚本却没挂样式，SVG 撑满整屏）；
  `home.css` 删除重复段，避免两处定义
- **损坏课程可见**：`toc.js` 对清单读不出来的导入课程也列出（标「清单读不出来」），
  保留删除入口——否则这门课在目录页完全不可见，连删都删不掉
- **静态检查补两类语义**：花括号状态机识别正则字面量（含字符类、转义）与模板 `${…}` 内的代码；
  匿名函数（`.catch(function (e){…})`）纳入扫描；别名守卫支持「整函数短路」
- **构建期断言**：替换后仍有 `data-ppt` 标记 → 构建失败（此前只靠 verify 兜底）
- **wrapTables 跳过 `<pre>`**：代码块里的 HTML 示例表格不再被包一层 `div`
- `home.js` 删除永不执行的 `#list` 错误分支

### 工具与文档

- `SKILL.md` 新增 4.5 节（课件截图工作流，含 `--src`）
- `pitfalls.md` 命令补 `--src`；`tools/README.md` 补 `decks.sample.json`
- 清理 3 张无人引用的课件截图；重打 `os-homework-1.0.2.lcr`

## [0.3.1] - 2026-11-11

### 修复（影响发布物）

- **APK 不再夹带课件截图**：`build.mjs` 复制壳层时排除 `web/img/`（此前本地构建的 APK 会多出
  224 张课程截图、+5.5 MB，对外分发等于夹带课件内容）；`pack.mjs` 改从源目录 `web/img/` 取图
- **恢复「删除课程」入口**：P4 把课程列表搬进目录页后，`#list` 在全仓库消失，导致
  `renderLibrary()` 永不可达、用户无法删除已导入课程。现于目录页每门导入课程行内提供「删除」
  （二次确认 → 原生删文件 + 清本地数据）
- **切换动效覆盖首页**：`nav.js` 之前只拦截 `/…` 与 `./` 开头的链接，首页的 `search.html` 这类
  裸相对路径全部漏掉；改为「只放行带 scheme 的链接」
- **壳页资源补版本号**：`index/me/toc/search/stats/review/diagnostics` 引用的 `/shell/*.css|js`
  统一追加 `?v=<版本>`，避免 APK 升级后读到旧缓存

### 修复（工具与校验）

- `verify.mjs` 的「DOM id 可解析」静态检查：识别 `var x = $('id'); if (!x) return` 这类别名守卫
  （此前 6 条误报），并把函数体切分改成**跳过字符串/注释/模板**的花括号状态机
- `verify.mjs` 的表格包裹检查放宽为 `class="…table-wrap…"`，允许追加第二个类名
- `tools/ppt-shots.mjs`：不再写死本机课件路径（改用 `--src` / `COURSE_PDF_DIR`），课程表外置到
  `tools/decks.json`（附 `decks.sample.json`）
- `tools/mark-ppt.mjs`：跨讲标记遇到映射表外的讲次会**打警告**而不是静默跳过
- `tools/check-pages.mjs`：任何退出路径（含 `exit(2)`）都会清理 `adb forward`，不再残留端口

### 清理

- `home.js` 删除 P4 之后不可达的 110 行（`renderLibrary` / `renderItems` / `wireCourseDelete` /
  `doCourseDelete` 与 `#sec-count` 分支），412 → 285 行
- 删除死样式 `.foot`、无用 id `#toc-sub`；`me.html` 的内联 `onclick` 改为 JS 绑定

## [0.3.0] - 2026-11-11

### 新增（阅读体验）

- **正文宽度锁死**：`overflow-x` 提到基础层（此前被关在 `@media(max-width:880px)`，平板/大屏失效），
  同时设 `html` 与 `body`；`img/svg/video/figure` 统一 `max-width:100%`；`pre` 自行横滑
- **表格统一包裹**：构建期 `wrapTables()` 把 170 个表格全部包进 `.table-wrap`
  （此前仅 31 个有 wrapper，其余 139 个把整页撑宽，手机上能左右拖）
- **页面切换动效**：`shell/nav.js` 用 View Transitions 做前进/后退/tab 三种动画，
  不支持或 `prefers-reduced-motion` 时降级
- **底栏三 tab**：主页 / 目录 / 我的；设置项从首页搬到独立的「我的」页
- **目录页（三级）**：课程 → 讲义页 → 小节，右侧 25% 为展开按钮，跳转前二次确认，
  展开状态记忆；自评题不进目录
- **首页精简**：logo/名称 + 篇数 + 三按钮 + 继续学习卡 + 每日一句 + 底栏

### 新增（内容形态）

- **课件页截图内嵌**：`<figure class="sa-ppt" data-ppt="42">` 标记 → 构建期替换为
  宽 900 的 webp（懒加载）+ 图注，点击可全屏放大
  - `tools/ppt-shots.mjs`：按抽取报告的图页清单批量渲染（224 张 / 5.54 MB）
  - `tools/mark-ppt.mjs`：给存量内容机械预标（同讲页码 + `--cross` 跨讲引用）
  - 全量包从 1.73 MB → 7.31 MB（224 张图 / 337 处内嵌）

### 校验

- `verify.mjs`：新增「表格全部包裹」「课件截图标记已展开」「仓库卫生（红线）」三项
- `.gitignore`：`content/os/*`（放行 `*_demo_*`）、`web/img/` —— 课程内容与截图永不进 git

## [0.2.3] - 2026-11-10

### 新增（工具链）

- `tools/apply-patches.mjs`：把复核报告里的 **PATCH 清单**机械应用到片段
  - `--as A|B` 按「文件：」字段过滤（解决了"B 的补丁喂给 A 会整批失败"）
  - **`IMPORT` 指令**：跨文件搬块（`取/到/替换` 三段标记定位，自动改 id 前缀）
  - 任一条失败则整批不写入，避免半成品
- `tools/merge-pages.mjs`：多段合并 + 全局重编号 + 章节 id 唯一性 + 元叙述残留 + **全页题量上限**检查
- `tools/self-check-quizzes.mjs`：**题目可答性**自检（答案唯一 / 干扰项完整 / 解析带页码 / 同页去重）
- `tools/lint-fragment.mjs`：片段预检，新增 `--page`（校验完整内容页）与 `--allow-no-cite`
- `tools/pdf-extract.py`：新增 `--low-text`（文字很少但含内嵌图的页也渲染）与 `--check-deps`
- `scripts/push-retry.sh` + `scripts/gh-tunnel.mjs`：推送重试（以 `ls-remote` 核对远端 SHA）与 github.com 入口 IP 隧道

### 新增（文档）

- `docs/QUICKSTART.md`：三条上手路径（只读课程 / 改界面 / 做成自己的 App）
- `docs/TROUBLESHOOTING.md`：推送排障（含"假成功"现象）、adb 设备身份误判、错误码索引
- `docs/skill/`：生成技能镜像（`SKILL.md` / `prompts.md` / `quality-guide` / `page-template` / `pitfalls` / `merge-playbook`）
- `NOTICE`：版权与第三方组件声明（Mermaid / ts-fsrs 均为 MIT）

### 变更

- **仓库转为公开**（Apache-2.0）：<https://github.com/Albusriddle/lucubratio-public>；
  发布前已审计全历史无令牌/密钥/课程素材，9 张装机截图移出索引

- **`verify-package` 从 10 项增至 11 项**：新增「检索索引与页面清单一致」——此前 `search.json`
  指向不存在页面的包能通过校验（实测悬空键 + bytes 补正的包曾以 10/10、退出码 0 放行）
- `verify.mjs` 壳资源清单补 `shell/diagram-viewer.js`、`shell/ui-extras.js`（此前缺失不会被发现）
- `scripts/test-package.mjs` 夹具改为与 `pack.mjs` 产物一致（`search.json` 覆盖清单每页）

### 修复

- `web/shell/home.js`：浏览器预览（无原生桥）点「删除」不再静默清数据，改为提示后返回
- `web/shell/mermaid-init.js`：库路径改为脚本执行时捕获（`document.currentScript` 在
  IntersectionObserver 回调里已为 null，曾导致丢 `?v=` 版本号）
- `scripts/build.mjs`：`tagQuestions` 去掉 200 字符上限（长题干的自评单元曾被静默漏标）
- `docs/PACKAGE-FORMAT.md`：示例 `appMin` 从 `3.1.0` 改为 `0.1.0`，并说明填自己 App 的基线

### CI

- 新增步骤：空构建冒烟、课程库自测、**题目自检**、工具链冒烟（片段预检 + 多段合并）
- 新增 `gradle/actions/setup-gradle` 缓存 + `networkTimeout` 120s：缓解 runner 下载
  Gradle 发行包被 504 打挂（本机与 Actions 侧都遇到过）

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
- **包校验器** `scripts/verify-package.mjs`：10 项（zip 安全 / 结构 / 一致性 / 标签级内容安全 / 体积）
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
