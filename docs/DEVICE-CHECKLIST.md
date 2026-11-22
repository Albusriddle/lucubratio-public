# 真机验收清单 · 签名配置

> 这份文档是**发版前最后一道人工关口**：签名怎么配、包装上去要验什么。
> 机械检查（`npm run test:all`）覆盖不到"装到真机上是什么样"，所以留了这份清单。
> 相关：[`QUICKSTART.md`](QUICKSTART.md)（构建/打包流程）· [`../AGENTS.md`](../AGENTS.md)（发版规则）

## 1. 三种包名，别搞混

| 构建 | 包名 | 用途 |
|---|---|---|
| release | `com.lucubratio.reader.public` | 对外发布（GitHub Releases） |
| debug | `com.lucubratio.reader.dev` | 本机调试，可与正式版共存 |
| 私有仓库自用版 | `com.lucubratio.reader` | **不在本仓库**；与 release 同机安装会冲突 |

## 2. 签名材料

正式包**必须**用正式 keystore 签名；没有 `android/keystore.properties` 时 gradle 会**直接中止**（不会静默出未签名包）。

### 2.1 本地文件

```
F:/Android/keys/lucubratio-public.keystore     # PKCS12
F:/Android/keys/lucubratio-public.pass         # 口令（明文，仅本机）
android/keystore.properties                    # gitignored，指向上面两个
```

`android/keystore.properties` 格式（四行，缺一不可）：

```properties
storeFile=F:/Android/keys/lucubratio-public.keystore
storePassword=<口令>
keyAlias=lucubratio-public
keyPassword=<口令>
```

> `storeFile` 可以写绝对路径（Windows 用正斜杠）；`git check-ignore android/keystore.properties` 应命中，**绝不入库**。

### 2.2 指纹（发版后核对）

| 项 | 值 |
|---|---|
| DN | `CN=Lucubratio Public Pipeline, OU=Personal, O=Personal, L=Local, ST=Local, C=CN` |
| SHA-256 | `3B:48:73:70:C2:28:3B:E7:67:5E:7B:07:D5:31:E2:B3:AC:F6:74:69:2C:BC:4B:91:2C:B5:47:AE:73:E5:4D:6E` |
| 签名方案 | v2（`minSdk 26`，v1/v3 未启用） |

核对命令：

```bash
export JAVA_HOME="C:\Users\Albus\.jdks\jbr-17.0.14"
"$JAVA_HOME/bin/apksigner.bat" verify --print-certs lucubratio-v<版本>-release.apk
```

### 2.3 CI 里的 Secrets（GitHub Actions 用）

| Secret | 内容 |
|---|---|
| `KEYSTORE_BASE64` | `base64 -w0 lucubratio-public.keystore` |
| `KEYSTORE_PASSWORD` | store 口令 |
| `KEY_ALIAS` | `lucubratio-public` |
| `KEY_PASSWORD` | key 口令 |

四个**全部**配好，`release.yml` 才会签出正式包并建 Release；缺任意一项会退化成 debug 包，并在 Actions 日志里**点名缺了哪几个**（`::warning::` + 一行 `缺少:…`）。

> 判定逻辑见 `release.yml` 的 `Detect signing secrets` 步骤：它逐个检查四个 Secret，不是只看 `KEYSTORE_BASE64`（早期只看一个，另三个缺失时会以一个与签名无关的错误挂掉）。

## 3. 出正式包

```bash
node scripts/build.mjs                 # web 产物
node scripts/gradle.mjs assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk
```

发版（打 tag 触发 CI 签名 + 建 Release）：

```bash
npm run test:all                       # ← 必须全绿才能继续
git tag -a v<版本> -m "v<版本>：<一句话>"
git -c http.proxy=http://127.0.0.1:7892 push <url> v<版本>   # 单个推，别批量
```

> 批量推多个 tag 曾出现"tag 建好了但 Actions 没跑"的情况（见 `TROUBLESHOOTING.md`）。

## 4. 真机验收清单

装 `release` 包后逐项走一遍（✅ 打勾才算发版完成）：

### 4.1 安装与身份
- [ ] `adb install -r` 成功；`aapt2 dump badging` 显示 `com.lucubratio.reader.public` 与正确 versionName
- [ ] 与 debug 包（`.dev`）**可共存**；与私有自用版（`com.lucubratio.reader`）同机时按预期冲突
- [ ] 首次启动有 splash，底部三个 tab（主页 / 目录 / 我的）都在

### 4.2 内容包
- [ ] 导入 `.lcr` 成功，目录页显示课程与讲数
- [ ] 打开讲义：正文、公式、表格（窄表居中、宽表可横滑）、代码块正常
- [ ] 课件截图可点开：**居中、倍率与正文一致、可双指放大、✕ 关闭**
- [ ] 解析默认折叠，「查看解析」可展开；自评（不会/模糊/会）后自动展开
- [ ] 目录侧栏：章行左 75% 跳转、右 25% 展开；点完**抽屉不关**且正文滚到位；长标题**两行**不截断
- [ ] 关掉抽屉后**位置不回退**（无"虚假跳转"）

### 4.3 学习功能
- [ ] 断点续读：退出重进仍回到原位置
- [ ] 搜索命中并跳转到对应小节
- [ ] 学习统计有数据；复习（FSRS）能出卡并记录
      （入口：首页「今日复习」常显——有到期显示张数，无到期也可点进空态页；统计页空态文案可点）
- [ ] 我的页：主题/字号切换生效、备份导出与导入可用

### 4.4 版式（横竖屏各一遍）
- [ ] 竖屏：底栏不遮挡最后一项；目录页无横向滚动
- [ ] 横屏：顶栏 ☰ 存在、侧栏可开；底部内边距正确
- [ ] 深色 / 浅色主题下文字与按钮对比度正常
- [ ] **超长 Mermaid（竖屏 + 横屏各一张截图）**：整图必须一屏内看全、比例不变形；
      点开放大查看器时按原尺寸渲染，可拖动查看细节
      （0.3.18–0.3.22 在这块连改 5 次，固定成验收项，别只靠手感）
- [ ] **页面切换有过渡**：点底栏 / 进正文 / 返回，都应看到"淡出到黑 → 淡入"（不是瞬切）
- [ ] **弹窗有动画**：目录页删除确认弹窗出现时缩放淡入，关闭时淡出后消失
- [ ] **返回键优先级**：打开课件截图/图表放大后按返回 → **只关图片**、仍停在当前课程页
- [ ] 再按一次返回 → 才回到上一页（目录 / 封面）
- [ ] 打开目录抽屉后按返回 → **只关抽屉**，不离开当前页
- [ ] **PPT 悬浮球**：任意内容页（含期中串讲/速记卡/模拟卷这些纯文字页）右下区域有一个 `▤ PPT` 圆球
- [ ] 点球 → 右侧出现本讲全部页缩略图；拖球到另一边松手 → 吸附到最近边缘，退出再进页面位置还在
- [ ] **缩略图能看清**：每格显示整页幻灯片（不是一条细线、也不是叠在一起的白条纹），右下角页码正确；
      计网课件（16:9）不被裁掉两侧
- [ ] **点 ✕ 真的关闭**：侧栏消失、悬浮球恢复；全屏翻页的 ✕ 同样能关
- [ ] 拖动球时页面**不跟着滚**；在正文其他位置滑动正常
- [ ] 打开抽屉 / 打开图片放大 / 切页幕布 → 球被盖住且点不到
- [ ] 点任一缩略图 → 全屏；左右按钮/滑动能翻页，顶部计数随之变化
- [ ] 「跳页」输入 42 + 回车 → 直接到第 42 页
- [ ] 侧栏/全屏都能用返回键逐层关闭，且不会离开课程页
- [ ] **点开 .lcr 导入**：文件管理器里点 `os-1.1.0.lcr` → 弹出 Lucubratio（或「打开方式」里有它）→ 确认框显示
      《标题》/id/页数/题数/体积 → 点「导入」后首页篇数增加、提示「已导入」
- [ ] 点「取消」→ 不导入，且 `cache/incoming` 里不残留临时包（App 重启后应被清空）
- [ ] **分享导入**：文件管理器里长按 `.lcr` → 分享 → Lucubratio → 同样出现确认框
- [ ] 坏包（把文本改名成 `.lcr`）→ 提示「不是可用的课程包」，不崩溃
- [ ] **带版本号的文件名也能点开**：在文件管理器里点 `os-1.1.0.lcr`（文件名含额外点号）→ 能弹出 Lucubratio
- [ ] 从「下载」列表点已下载的 `.lcr`（Downloads provider 的数字 id URI）→ 也能进 App
- [ ] **批量分享**：文件管理器里多选两个 `.lcr` → 分享 → Lucubratio → 弹「导入 2 个课程包？（共 X MB）」→ 导入后篇数一次性增加
- [ ] **App 内多选**：「＋ 导入课程包」里多选两个 `.lcr` → 同样出现批量确认框
- [ ] 批量里混一个坏包：确认框用 ⚠️ 标注原因并只导入好的那个
- [ ] **抽屉吸顶无缝**：课程页打开目录抽屉，往上滑让章标题吸顶 → 章标题应紧贴顶栏下沿（无 10px 缝隙）
- [ ] **开屏只在冷启动**：杀掉 App 再打开 → 有 logo 开屏（≤1s）；进课程页后点底栏「主页」→ **不再出现开屏**，
      而是与切页一致的幕布（淡出到黑→淡入）
- [ ] 系统开启「移除动画」后，上述过渡立即变瞬时（不再有黑屏等待）

### 4.5 收尾
- [ ] 删除课程可用，确认弹窗按钮为**红色「删除」**
- [ ] 卸载重装后数据仍可通过备份恢复

## 5. 发版后核对

- [ ] Releases 页有本次 tag，附件是 `lucubratio-v<版本>-release.apk` + `checksums.txt`，**没有** `.lcr` / 课程页 / 课件截图
- [ ] `apksigner` 指纹与 §2.2 一致
- [ ] 下载该 APK 再跑一次 §4 的 4.1–4.4（至少抽查）

---

**发现清单里的项过时或缺失时，直接改这份文档并提交**——它是发版流程的一部分，不是一次性记录。

## 6. 验收记录

每次发版跑完 §4 就在这里加一行（设备、版本、结论、发现的问题）。

| 日期 | 版本 | 设备 | 结论 | 发现的问题 |
|---|---|---|---|---|
| 2026-11-13 | 0.3.10（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（`test:all` 11 步（当时；现为 13 步）、`check-pages` 9/9、`smoke` 18 项） | 修复 0.3.9 验收发现的 8 项；新增 §4.4 动效验收项 |
| 2026-11-13 | 0.3.11（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（screencast 亮度曲线：首页→目录 `21→10→0.3→13→21`；返回 `21→0.2→12→18→21`） | 已知限制：返回手势的"离开帧"由浏览器接管（瞬黑 + 淡入） |
| 2026-11-13 | 0.3.12（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（`test:all` 12 步、`check-pages` 9/9） | 修复 VT 设备三入口未定义（桩注入验证）、reduce 实时读取、幕布 z-index 让位 splash；新增 `check-nav` 守则 |
| 2026-11-13 | 0.3.13（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（`test:all` 12 步） | 技能/文档对齐（§5 五步校验、新页配 `QUESTION_RULES`、pitfalls3 类错误、prompts 首句要求）；`check-nav` 跳过 vendor |
| 2026-11-14 | 0.3.14（release） | MuMu · Android 15 · WebView 110 | ✅ 通过（`test:all` 13 步；真机：Mermaid 节点恢复自然尺寸；搜索页不再出现 `fork/MLFQ/僵尸`） | 修 Mermaid 窄图尺寸、搜索示例词改按索引生成 |
| 2026-11-17 | 0.3.31（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（抽屉 `gap 10px→0`；冷启动 `sa-booted=1` 播开屏；同会话回首页 `sa-no-splash` 生效、`#sa-splash` 不存在） | 抽屉吸顶 + 开屏只在冷启动；`check-pages` 新增两条断言后 19 页全通过 |
| 2026-11-17 | 0.3.30（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（批量分享 2 包「导入 2 个课程包」→ 首页 12→40 篇；混坏包只导好的；`query-activities` 三组断言全命中） | 批量导入 + 点开 `.lcr` 修复 |
| 2026-11-17 | 0.3.29（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（正文 28 张 `slide-fig` 全部可点开放大；样式 0.7px 边框 / 10px 圆角） | 第十四轮审阅 16 项 |
| 2026-11-22 | 0.3.38（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（缩略图 204×154/204×116 正常；✕ 关闭 `display:none`；全屏 ✕ 生效 `1/83`；osq 页 83 页 / cnq 页 89 页；`check-pages` 73 页全通过） | 侧栏细线/条纹/关闭/讲次四项修复 |
| 2026-11-22 | 0.3.36（release） | MuMu · Android 15 · WebView 110 | ✅ 通过（CI 构建不再因 osq/cnq 缺失失败；`test:all` 77 步） | 本地刷题内容改 optional 组 + 体积上限 300MB |
| 2026-11-22 | 0.3.35（release） | MuMu · Android 15 · WebView 110 | ✅ 通过（旧包 os-course-1.8.1 抽查 5/5 页出现悬浮球；公开 66/66 页注入） | 修公开仓漏注入 + 旧包运行期兜底 |
| 2026-11-17 | 0.3.34（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（12/12 内容页有球；拖动吸附 left=8；重载后位置保留；拖动不劫持滚动） | PPT 入口改可拖动悬浮球 |
| 2026-11-17 | 0.3.33（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（6 包导入中取消 → `cache/incoming` 无残留；正常 2 包落地） | 取消不泄漏暂存 + 上限判定修正 |
| 2026-11-17 | 0.3.32（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（进度框「1/2：书名」+ 取消生效；抽屉 gap=0；开屏判定通过） | 批量导入上限/进度/取消 + 文档与护栏 |
| 2026-11-16 | 0.3.28（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（候选解析含 Lucubratio；冷启动点开 `.lcr` 弹确认框《操作系统（个人课程）》14 页·166 题·20.7 MB；导入后 2→16 篇；取消不残留；连点 2→2→1；坏包/分享均正常） | 新增「文件管理器点开 .lcr 直接导入」；`test:all` 13 步、`check-pages` 9/9 |
| 2026-11-15 | 0.3.27（release） | MuMu · Android 15 · WebView 110 | ✅ 通过（`test:all` 13 步；工具链：conc-2/conc-3 讲次、5 份练习 deck、`migrate-slide-fig` 迁移） | 工具与讲次扩展（无 App 行为变更） |
| 2026-11-15 | 0.3.26（release） | MuMu · Android 15 · WebView 110 | ✅ 通过（`test:all` 13 步；侧栏检查「52 页缩略图，关闭正常」） | 第十二轮审阅 12 项：写法统一、`--full` 说明、滚动锁、`check-pages` 侧栏检查 |
| 2026-11-15 | 0.3.25（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（侧栏 52 页；点第 5 页 `5/52` → 下一页 `6/52`；跳页 42 → `42/52`；返回键①只关全屏 ②关侧栏且 URL 不变；图注角标 28 个） | 新增 PPT 原版截图侧栏；`test:all` 13 步、`verify-package` 13 项 |
| 2026-11-14 | 0.3.24（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（开图→返回只关图 URL 不变；再返回回封面；开抽屉→返回只关抽屉；再返回回封面） | 返回键改为「原生返回先问 JS」；`history.back()` 替代 `goBack()`；`check-pages` 9/9、`smoke` 18 项 |
| 2026-11-14 | 0.3.16–0.3.23（debug） | MuMu · Android 15 · WebView 110 | ✅ 通过（搜索示例词/对比度、Mermaid 超长图三轮修正后真机收进一屏、文档口径统一） | 逐版明细见 CHANGELOG；`test:all` 13 步 |
| 2026-11-14 | 0.3.15（release） | MuMu · Android 15 · WebView 110 | ✅ 通过（0 到期时首页显示「今日复习 / 看看 ›」并可进空态页；自评后统计累计 +1；过渡亮度 233→21→148→248） | 复习入口常显 + 统计页空态文案可点 |
| 2026-11-13 | 0.3.9（debug） | MuMu 模拟器 · Android 15 · 1080×2340@440dpi · 440dpi | ✅ 通过（`smoke` 18/18、`check-pages` 9/9；§4 各项均达标） | 8 项：首页按钮被 CSS 重置字号而换行、demo 解析不合规致折叠不可见、`verify` 报错不指路、`lucubratio-probe` 库残留、ROADMAP 复跑措辞过时、`QUESTION_RULES` 描述不准、术语混用、`toc.js` 兜底静默 → 均已在 **0.3.10** 修复 |
