# 更新日志

本仓库（`lucubratio-public`）是 Lucubratio 的**流水线 + 查看器**部分，不含任何课程素材。

<!-- 书写约定：新版本段插在 [Unreleased] 之后；「暂无」占位符只保留在 [Unreleased] 里那一处，
     写新版时不要把它往下挤（历史上因此出现过 2 处孤立占位符）。npm run test:all 会检查这一点。 -->

## [Unreleased]

### 工具

- `scripts/push-retry.sh`：远端核对改为**同时查 `refs/heads/` 与 `refs/tags/`**。
  此前只查分支，推 tag 时会一直报"远端不可达"并重试 8 次（v0.3.9 首发就这样白等约 2 分钟，
  实际 tag 早已推上去）。顺带删掉后面那段"heads 不匹配再查 tags"的补丁逻辑。

### 文档

- `AGENTS.md`：红线 1 的条目与「仓库分两类」表格对齐（原文说"课程正文页不得进 git"，
  但表格里私有仓库是允许的，自相矛盾）；自查清单拆成「两仓库通用」与「仅公开仓库」两组
  （原来那条 `content/os/ | grep -v _demo_` 空检查会让私有仓库永远"不达标"）

## [0.3.11] - 2026-11-13

### 新增（全站过渡动效）

- **任意两页之间都有过渡**：淡出到黑 → 淡入新页（幕布过渡，`#sa-curtain`）
  - `boot.js` 在 `<head>` **同步**插入幕布（首帧即黑，顺带消掉两页之间的白闪），
    并在 `DOMContentLoaded` 后 160ms 淡出
  - 统一入口 `window.saLeave(url)` / `saReload()`：链接点击（`nav.js`）、目录跳转、导入后刷新、
    删除后刷新、诊断页跳转全部走它；`diagnostics.html` 补上 `boot.js`
  - 返回键 / 返回手势：拦不住"出"，用 `pagehide` 把幕布置黑（视觉上仍是"瞬黑 + 淡入"）；
    `pageshow`（含 bfcache 恢复）清黑幕，避免返回后停在全黑
- **弹窗过渡**：打开 `scale(.96)+fade` 160ms；关闭由 `saCloseDialog()` 先演 120ms 再 `close()`
  （本机 WebView 110 不支持 `transition-behavior: allow-discrete`，纯 CSS 做不了关闭动画）
- **渐进增强**：检测到 `document.startViewTransition` 时自动改用 View Transitions（含方向滑动），
  与幕布互斥、不会双重动效；未来 WebView 升到 126+ 时连返回手势都能被 VT 接管

### 修复（动效实现细节）

- 页面加载后**立刻点击**会失效：`reveal()` 的 rAF 在点击后把幕布又设回透明 → 过渡被掐断。
  加 `leaving` 互斥
- **`transitionend` 在慢渲染设备上提前触发**（模拟器实测 138ms 就到，opacity 才 0.5）：
  改为「完成度 ≥0.98 才采信」，并在 130ms 到点**强制置黑**再跳（跳转瞬间一定是全黑）

### 验证（真机客观测量）

- CDP screencast 抓真实合成帧算平均亮度：
  - 首页 → 目录：`21 → 10 → 0.3（全黑）→ 13 → 21`
  - 硬件返回：`21 → 0.2（全黑）→ 12 → 18 → 21`
- 弹窗：`getComputedStyle(dlg).animationName = sa-dlg-in`，关闭走 `is-closing` 后 130ms 关闭
- 回归：`test:all` 11 步、`check-pages` 9/9、`smoke` 18 项 全绿

### 已知限制

- 返回手势/硬件返回的"离开帧"由浏览器接管，无法先演淡出；表现为"瞬黑 + 淡入"（已是同类方案的最佳折中）
- 内容页较大（1.7MB）时，慢设备上黑屏等待会略长（当前实测 <400ms）

## [0.3.10] - 2026-11-13

### 修复（真机验收发现的问题）

- **首页第三个按钮被 CSS 重置字号**：`.quick button{font:inherit}` 把上面那条
  `font-size:13.5px;font-weight:600` 一起冲掉了，实测按钮是 16px/400、链接是 13.5px/600，
  于是「＋ 导入课程包」在 393px 竖屏下换行成两行。改为只继承字族（`font-family:inherit`）
- **demo 页的解析不合规，折叠功能在示例上永不出现**：两页 demo 共 3 处写的是
  `<p><strong>题解</strong></p><ul>…</ul>`，而规范（AGENTS.md 约定 1 / CONTENT-SPEC）要求
  `<blockquote><strong>解析</strong>：X 对。…</blockquote>`；已按原文改写成规范结构
- **`self-check-quizzes` 对「没有解析块」只报警告**：demo 因此一路放行到 CI。现在
  「有检测题但没有 `<blockquote>` 解析块」直接算失败（历史内容可加 `--allow-nonblockquote` 暂放）
- **`verify` 的「自评标题与标记数不一致」不给指引**：新增一行提示，直接指出
  「在 scripts/build.mjs 的 QUESTION_RULES 里为 <cid> 加一条 { level: 3, test: /^检测\s*\d+/ }」，
  并说明规则是按页 cid 配置的
- **`web/diagnostics.html` 的探针库残留**：环境自检会建 `lucubratio-probe` 却从不删除，
  设备上会永久留一个空库。现在两层清理：① 自检结束先试一次 `deleteDatabase`（同一文档里常被
  `blocked`，失败时记 INFO）；② `boot.js` 在**每个页面启动时**顺手删一次——那时没有任何连接占用，
  实测离开自检页后库即消失。启动计数改记 `localStorage`，持久化检查不再依赖这个临时库
- **`toc.js` 的确认弹窗兜底静默失败**：兜底路径原本调用 `window.confirm`（本壳没有
  WebChromeClient，恒返回 false），表现为"点了删除没反应"。改为显式取消 + `saToast` 提示

### 文档

- **CONTENT-SPEC §5 重写**：原表格列的是私有仓库的 cid（`os-11…os-22`，本仓库不存在），
  改成「每页一条规则」的通用说明 + 本仓库真实配置（`os-01`/`os-02`）+ 新页怎么加
- **术语统一**：`AGENTS-SPEC` / `CONTENT-SPEC` 里的「详细题解」统一为「解析」，并说明
  「旧稿的『题解』是同一概念，但壳层只折叠以『解析』开头的引用块」
- **ROADMAP**：`0.3.4–0.3.10` 的版面改动已在 2026-11-13 用 MuMu（Android 15）复跑，结论写回
- **[`DEVICE-CHECKLIST`](docs/DEVICE-CHECKLIST.md) 新增 §6 验收记录**：日期/版本/设备/结论/发现的问题，
  以后每次发版在此追加一行

### 已知遗留

- **私有仓库的 9 个课程页同样是「题解 + ul」写法**（0 个规范解析块）——也就是说
  「解析折叠」在实际课程上从未生效。两条路线待定：① 把内容机械迁移成 `blockquote`；
  ② 让壳层兼容「题解」写法。本轮先修公开侧与检查工具

## [0.3.9] - 2026-11-13

### 修复（提示机制 / 发版闸门 / 合规）

- **统一全局提示 `window.saToast`**（放进 `boot.js`：三个壳页都加载且最先执行）
  - `home.js` 的 `toast()` 改为委托它；浏览器预览也有 DOM 兜底（此前只走原生桥，无桥时静默）
  - `toc.js` 的两处 `window.alert` 改为 `notify()` → `saToast`。**本壳没有 WebChromeClient，
    `alert()` 在 App 内是空操作**，所以"浏览器预览不能删课"和"删除失败"这两条提示此前从未显示
  - 顺带补上 `home.js` 里**调用了却从未定义**的 `window.saToast(...)`：导入成功/失败提示此前只进 `console.log`，
    用户看不到（失败时尤其误导——课程没导入却毫无反馈）
- **`release.yml` 检查全部四个签名 Secrets**（此前只看 `KEYSTORE_BASE64`）：
  另三个缺失时会走"正式签名"分支、写出空口令的 `keystore.properties`，然后以一个与签名无关的错误挂掉。
  现在缺任一项就退化为 debug 包，并在日志里 `::warning::` **点名缺了哪几个**
- **壳资源清单补 `vendor/LICENSE-mermaid`、`vendor/README.md`**：
  `LICENSE-ts-fsrs` 在清单里而 mermaid 的许可文件不在，删了也不会被 `verify` 发现（第三方许可合规）

### 文档

- **README 命令段重排**：去掉重复的 `build:empty`；把 `verify:device`（数据/404 体检）与
  `check:pages`（逐页抓 JS 异常）分开描述——两者此前注释一模一样，无法判断该跑哪个
- **README 目录结构**：`scripts/` 行点名 `check-changelog`（守则脚本）
- **`CHANGELOG` 断链**：`DEVICE-CHECKLIST.md` → `docs/DEVICE-CHECKLIST.md`
- **`DEVICE-CHECKLIST` §2.3**：改为与 `release.yml` 实现一致（缺任一项退化 + 点名），并指向判定步骤
- **[`ROADMAP`](docs/ROADMAP.md) 补「阶段 4 · 0.3.x」**：0.3.1–0.3.8 的真实工作逐版记录；
  D2（`/courses/` PathHandler + 导入入口）标为已完成；「设备验收结果」注明是 0.2.x 时期，
  0.3.4–0.3.8 的版面改动**待在真机上复跑**

## [0.3.8] - 2026-11-13

### 修复（发版闸门与文档一致性）

- **`release.yml` 补齐检查项**：补上 `CHANGELOG structure` 与 `Empty build smoke` 两步
  （此前这两项只在 `ci.yml` 里，打 tag 触发发版时并不检查——0.3.4–0.3.6 就是从这个缺口漏出去的）
- **`toc.html` 删掉一条永不生效的声明**：`body` 同时带 `.toc-wrap` 与 `.has-tabbar`，
  后者的 `padding-bottom` 优先级更高，`.toc-wrap` 里那句 `+24px` 从未生效
- **`check-changelog.mjs` 缺文件时给友好提示**（原来直接抛 ENOENT 堆栈），并新增 `npm run check:changelog` 入口
- **Secrets 单一来源**：`QUICKSTART.md` 不再重复列四个 Secrets 名字，改为指向
  [`DEVICE-CHECKLIST.md`](docs/DEVICE-CHECKLIST.md) §2.3（两处维护迟早漂移）

### 文档

- `README.md`：`docs/` 目录结构行补全（含 `DEVICE-CHECKLIST.md`）；命令表补
  `test:library` / `check:changelog` / `smoke` / `verify:device`
- `CHANGELOG.md`：`0.1.0` 段标注「仓库初始化（内部版本，未发布）」——该版本号从未打 tag 发布

## [0.3.7] - 2026-11-12

### 修复（发版流程与文档）

- **CHANGELOG 结构归位**：`（暂无）` 曾被连续三次插入新版本段时逐段下挤，累计 **4 处**，
  导致 `npm run test:all` 在 v0.3.4 / v0.3.5 / v0.3.6 三个版本上都是红的（CI 不查这一项，所以没拦住）。
  现在只保留 `[Unreleased]` 内 1 处
- **CHANGELOG 检查抽成独立脚本** `scripts/check-changelog.mjs`：`test:all` 与 `ci.yml` 共用一份实现，
  CI 新增 `CHANGELOG structure` 步骤，结构腐化不再能混过 CI
- **失败信息不再被吞**：`test-all.mjs` 的自定义步骤失败时会打印 `Error.message`
  （以前只打 stdout/stderr，抛 Error 时是一片空白）
- **新增 [`docs/DEVICE-CHECKLIST.md`](docs/DEVICE-CHECKLIST.md)**：签名材料/指纹/四个 Secrets、出正式包命令、
  真机验收清单（安装身份 · 内容包 · 学习功能 · 横竖屏版式 · 收尾）。此前 `AGENTS.md` 与
  `android/app/build.gradle` 都指向这个文档，但它一直不存在
- **发版规则补门槛**：`AGENTS.md` 明确「打 tag 之前必须 `npm run test:all` 全绿」

### 文档

- `ROADMAP.md`：「首页课程库」条目改正为**目录页**课程树（P4 起首页只留三卡）
- `README.md`：`test:all` 说明更新为实际的 **11 步**
- `TROUBLESHOOTING.md`：补「`timeout` 撞 Windows 同名命令导致误判代理不通」与「代理端口空窗」两条实战坑
- `web/toc.html`：删除一条空的 CSS 规则

## [0.3.6] - 2026-11-12

### 修复（目录页与侧栏）

- **底栏不再压住最后一项**：底栏高度不再写死 72px，`tabbar.js` 挂载后量 `offsetHeight` 写入
  `--sa-tabbar-h`，页面底部内边距按它算（换机型 / 改字体 / 横竖屏都跟得上）
- **目录大页标题两行截断**：`white-space:nowrap` 改两行 clamp + `word-break`，
  `.toc-main` 改 `align-items:stretch`（原来按内容撑宽，导致文字冲出屏幕、整页可横向滑动）
- **跳转弹窗钉在视口正中**：`dialog{position:fixed;inset:0;margin:auto;max-height:82vh}`，
  即使页面出现横向偏移也不会偏到一边
- **课程页侧栏标题两行截断**：`.sa-toc-main` / `.sa-toc-leaf` 由单行省略号改为两行 clamp，
  「…（p11、p13、p14）」这类区分信息不再被吃掉

### 修复（虚假跳转）

点小节后关掉侧栏，浏览位置会退回跳转前。两条独立成因都已处理：

- `body.sa-nav-open{overflow:hidden}` 让抽屉打开时文档不可滚动，`smoothTo()` 的 `window.scrollTo` 无效
  → 改为只锁横向（`overflow-x:hidden`），正文可以在抽屉后面真正滚动
- 抽屉用 `history.pushState` / `history.back()` 集成返回键，浏览器**在历史回退时恢复滚动位置**
  → 设置 `history.scrollRestoration = 'manual'`，阅读位置交回本文件的 `savePosition()` 管理
- 遮罩加 `overscroll-behavior: contain`，减少背景惯性滚动

验收：竖屏（360 / 393 CSS px）与横屏（780 CSS px）各测一遍，5 项全部通过。

## [0.3.5] - 2026-11-12

### 修复

- **删除课程的确认按钮文案错误**：目录页的二次确认框是「跳转 / 删除」共用的，
  但确认按钮文案写死在 HTML 里（永远是「跳转」），删除确认也显示「跳转」，属于危险操作配正向文案。
  现在 `confirmAsk()` 接受 `{ okText, danger }`：删除显示**红色「删除」**、跳转显示蓝色「跳转」，
  且每次打开都显式重设（避免上次的红色残留），并补 `aria-label`。
  副文案同步补「不可恢复」。

## [0.3.4] - 2026-11-11

### 阅读与导航体验

- **课件截图放大改为自绘查看器**：以前点图走 `<a href="/img/…">` 的原生整页看图（900px 原图、1:1 倍率、
  左上角对齐）；现在拦截点击，用 `.sa-viewer` 打开——按 `naturalWidth/Height` 计算适屏倍率并居中，
  双指可继续放大，返回键只关查看器
- **目录跳转加缓动**：`smoothTo()`（420ms，easeInOutCubic）替代瞬时锚点跳转，起步慢→中段快→收尾减速
- **表格对齐**：窄表格居中（`.table-fit`），宽表格仍贴边横滑（`overflow-x:auto`）
- **侧栏目录行重构**：章行 = 左 75% 跳转 + 右 25% 展开/收起；节行整行跳转、无展开按钮；
  **点击后不再关闭抽屉**，改为该行 200ms 高亮闪烁反馈；跳转不弹二次确认
- **章标题吸顶**：`position:sticky` 让当前章标题钉在侧栏顶部，小节再多也能随时收起

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

## [0.1.0] - 仓库初始化（内部版本，未发布）

从主项目（含个人课程内容的私有仓库）提炼出「流水线 + 查看器」平台部分，Apache-2.0 发布。
