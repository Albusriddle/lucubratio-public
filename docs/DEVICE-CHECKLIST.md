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
| 2026-11-14 | 0.3.15（release） | MuMu · Android 15 · WebView 110 | ✅ 通过（0 到期时首页显示「今日复习 / 看看 ›」并可进空态页；自评后统计累计 +1；过渡亮度 233→21→148→248） | 复习入口常显 + 统计页空态文案可点 |
| 2026-11-13 | 0.3.9（debug） | MuMu 模拟器 · Android 15 · 1080×2340@440dpi · 440dpi | ✅ 通过（`smoke` 18/18、`check-pages` 9/9；§4 各项均达标） | 8 项：首页按钮被 CSS 重置字号而换行、demo 解析不合规致折叠不可见、`verify` 报错不指路、`lucubratio-probe` 库残留、ROADMAP 复跑措辞过时、`QUESTION_RULES` 描述不准、术语混用、`toc.js` 兜底静默 → 均已在 **0.3.10** 修复 |
