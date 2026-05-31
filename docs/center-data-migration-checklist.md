# center-data 迁移验收清单

- 复制整个 `center-data` 目录到新位置。
- 使用 `ZHIXIN_CENTER_DIR` 指向复制后的目录启动中心服务。
- 验证 `db/zhixin.sqlite` 存在且迁移记录可读取。
- 验证 `memory/user.md` 和 `memory/agents` 下 Markdown 记忆可读取。
- 验证 `agents/*.md` 智能体定义可读取。
- 验证 `providers`、`mcp`、`skills`、`sessions/attachments` 文件保留。
- 验证 `temp` 可在启动和停止时清理，不作为迁移事实源。
