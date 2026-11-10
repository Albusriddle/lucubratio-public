# 课程包格式 `.lcr`（草案 v0）

> 状态：**草案**，尚未实现。目标是把「流水线产出的站点」打成一个可导入 App 的单一文件。

## 1. 为什么需要它

当前内容被编译进 APK，用户想加课程必须重新构建整包。`.lcr` 让课程变成**可导入的数据**：

- 生成侧：跑一遍 `scripts/build.mjs` → 打包 → 得到一个 `.lcr`
- 使用侧：App 内「导入课程包」→ 解压到私有目录 → 首页出现这门课

## 2. 文件形态

就是一个 **zip**（扩展名 `.lcr`），结构固定：

```
course.lcr
├── format.json          # 必需：包元信息与兼容性
├── manifest.json        # 必需：与内置 manifest 同结构（groups / items / questionCount / contentHash）
├── search.json          # 必需：检索索引（与内置同结构）
├── content/             # 必需：已注入壳的成品页
│   └── os/
│       ├── 01_xxx.html
│       └── 02_yyy.html
└── img/                 # 可选：页面引用的图片（页面里写 /courses/<id>/img/...）
    └── deck/
        └── p001.webp
```

> 页面里的 `/shell/...` 引用**不需要**打包——壳层资源仍由 App 内置提供（同源 `appassets.androidplatform.net`）。

## 3. `format.json`

```json
{
  "format": "lcr/1",
  "id": "os-2026",
  "title": "操作系统（2026 秋）",
  "version": "1.0.0",
  "appMin": "0.1.0",
  "builtAt": "2026-11-07T00:00:00Z",
  "pages": 12,
  "questions": 55,
  "bytes": 12345678,
  "sha256": "<打包后对 manifest+content+img 计算的摘要>"
}
```

字段约定：

| 字段 | 要求 |
|---|---|
| `format` | 固定 `lcr/1`；App 遇到未知值直接拒绝并提示升级 |
| `id` | 小写字母/数字/连字符，全局唯一；决定落盘目录 `courses/<id>/` 与 qid 前缀 |
| `version` | 语义化版本；同 id 不同版本视为"更新"，需保留用户进度 |
| `appMin` | 能打开本包的最低 App 版本。填**你自己 App** 的版本基线：公开仓库当前是 `0.x`，私有仓库是 `3.x`，不要照抄示例 |
| `sha256` | 可选但推荐；对包内所有条目排序后哈希，App 校验失败则拒绝导入 |
| `empty` | 仅内置包使用：`true` 表示这个 APK 没有内置内容（课程全靠导入）；用户课程包不需要此字段 |
| `bytes` | **必填**：除 `format.json` 外所有条目解压后的字节和（课程库显示体积、配额检查用）；校验器会交叉核对 |

### 3.1 命名空间（cid / qid）

同一个 App 里可能有多门课，页面也叫 `os-01`，所以**打包期**必须给课程内标识加前缀：

| 位置 | 打包前 | 打包后 |
|---|---|---|
| `<body data-cid>` | `os-01` | `<包id>:os-01` |
| `<body data-file>` | `/content/os/01.html` | `/courses/<包id>/content/os/01.html` |
| 标题 `data-qid` | `os-01#检测 1` | `<包id>:os-01#检测 1` |
| 复选框 `data-ck` | `os-01#1` | `<包id>:os-01#1` |
| `<body data-cver>` | 内容指纹 | `<包id>@<版本>#<逐页指纹>` |
| `manifest.items[].id` | `os-01` | `<包id>:os-01` |
| `search.pages` 键 / `sections[].p` | `os-01` | `<包id>:os-01` |

> `data-cver` **不能**用包 `sha256`（页面里就写着它 → 循环依赖），用逐页 `rawHash` 的 8 位指纹。
> 内置课程的 cid **永远不含 `:`**，这是区分"内置"与"导入"的硬约定。

## 4. 导入时的校验（App 端，必须全部通过）

1. **zip 安全**：拒绝绝对路径、`..`、符号链接、非白名单扩展名（防 Zip Slip）
2. **结构**：`format.json`/`manifest.json`/`search.json` 存在且可解析；`format` 受支持；`appMin ≤ 当前版本`
3. **体积**：单包 ≤ 200MB，解压后文件数 ≤ 5000
4. **内容安全**（**标签级扫描**，不是正则——属性可以无引号/单引号，值可能实体编码）：

   | 规则 | 允许 | 拒绝 |
   |---|---|---|
   | `<script>` | `type="text/plain"`（Mermaid 源码）、`src="/shell/*.js"`（App 内置） | 其余一切内联或带 `src` 的脚本 |
   | 事件属性 | 无 | 任何 `on*=` |
   | URL 属性（`src/href/action/srcset/…`） | 站内相对路径、`/shell/`、`/courses/<id>/`、`#锚点` | `http(s):`、`//`、`javascript:`、`vbscript:`、`data:text/html` |
   | 标签 | — | `iframe / frame / frameset / object / embed / applet / base / portal` |
   | `<link>` | `href` 以 `/shell/` 开头 | 其它 |
   | `<style>` | 内联样式 | 含 `@import` 或 `url(http…)` |
   | `<meta>` | 普通 meta | `http-equiv=refresh` |

   属性值会先做 **HTML 实体解码**再判规则（防 `&#106;avascript:` 这类绕过）。
5. **一致性**：`manifest` 里列出的每个 `file` 都在包内；每个 `img` 引用都能找到

## 5. 生命周期

| 动作 | 行为 |
|---|---|
| 导入 | 解压到 `filesDir/courses/<id>/`，写课程注册表（id/title/version/bytes/pages） |
| 打开 | 首页从注册表聚合内置课程 + 已导入课程 |
| 更新 | 同 `id` 覆盖；页面 hash 变化的旧卡片标记为 `orphaned`，提示"需重新学习" |
| 删除 | 删目录 + 该 cid 下的进度/卡片/日志 |

## 6. 待定问题

- 是否支持**多课程打包**（一个 `.lcr` 含多门课）→ 倾向不支持，保持"一包一课"
- 是否要**签名**（作者公钥）→ 第一版不做，只做 sha256 完整性
- 图片是否允许与页面同级的相对路径 → 统一用 `/courses/<id>/img/...` 绝对路径，避免解析差异
