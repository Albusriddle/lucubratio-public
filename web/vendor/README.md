# vendor

| 文件 | 来源 | 版本 | 许可 |
|---|---|---|---|
| `ts-fsrs.mjs` | https://github.com/open-spaced-repetition/ts-fsrs | 4.7.0 | MIT |
| `LICENSE-ts-fsrs` | 同上 | — | MIT |
| `mermaid.min.js` | https://unpkg.com/mermaid@12.3.0/dist/mermaid.min.js | 12.3.0 | MIT |

- 两者都是**整文件 vendored**，不做修改；升级时整文件替换并更新本表。
- mermaid 用 IIFE 单文件版（`window.mermaid`），因为 ESM 版会拆成几十个 chunk，离线打包麻烦。
- ts-fsrs 会在加载时给 `Date.prototype` 挂 `scheduler/diff/format/dueFormat`。
