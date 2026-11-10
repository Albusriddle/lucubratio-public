# 生成技能的镜像

这里的 6 个文件（+ 本说明）是 DSH 技能 `lucubratio-course` 的**原样镜像**，便于版本管理与评审（有 diff 可查）。

| 文件 | 作用 |
|---|---|
| `SKILL.md` | 主流程（抽取 → 双盲生成 → 复核 → 合稿 → 校验 → 交付）+ 硬规则 + 配额 |
| `prompts.md` | **可复制的 producer / reviewer 提示词模板**（含 PATCH 输出格式） |
| `quality-gate.md` | 双盲为什么有效、reviewer 三件事、合稿判定表 |
| `page-template.md` | 页面四块结构、id 命名、篇幅建议 |
| `pitfalls.md` | 按报错查的对照表 |
| `merge-playbook.md` | 合稿分工、决策模板、`IMPORT` 用法、合稿后四项自查 |

## 安装到本机

```bash
mkdir -p ~/.dsh/skills/lucubratio-course
cp docs/skill/*.md ~/.dsh/skills/lucubratio-course/
```

> 技能目录里的 `SKILL.md` 需要 YAML frontmatter（`name` / `description`），仓库里这份保留了它，可直接拷。

## 为什么镜像而不是只放技能目录

技能目录不在版本控制里，改坏了没 diff、也没法在 PR 里评审。仓库这份是**唯一可信源**，
技能目录是它的部署副本。
