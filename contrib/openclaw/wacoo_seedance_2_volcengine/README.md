# OpenClaw skill: `wacoo_seedance_2_volcengine`

- **SKILL.md**：主文件，供 OpenClaw 注入技能说明。  
- 符合 [Creating Skills](https://docs.openclaw.ai/tools/creating-skills)：`name` 为 snake_case，含 YAML frontmatter。

## 使用方式

解压后把目录放到 OpenClaw 扫描路径之一，例如：

- `~/.openclaw/skills/wacoo_seedance_2_volcengine/`
- 或工作区 `skills/`（依你的 `skills.load.extraDirs` 配置）

然后重启 gateway 或新开会话，`openclaw skills list` 应能看到该 skill。

## 来源

从 Wacoo 仓库中的 Seedance 2.0 接入与异步轮询逻辑整理，版本与主代码一致时可同步更新 `SKILL.md`。
