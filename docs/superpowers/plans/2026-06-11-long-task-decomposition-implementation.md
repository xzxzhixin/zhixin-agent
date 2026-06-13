# 智能体长任务拆解实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现智能体长任务拆解的数据、事件、todoList 写入和前端单行展示规则。

**架构：** 后端以 `tasks/task_steps/events` 为事实源，补齐步骤计划字段并通过 `builtin.todo.list` 写入当前 `agentId` 的拆解步骤。前端只展示拆解步骤，不把单个默认任务或执行过程卡片冒充任务列表。

**技术栈：** TypeScript、SQLite、LangGraphJS、Vue 3、Pinia、WebSocket。

---

## 文件结构

- 修改 `需求.md`：同步长任务拆解产品口径和展示验收。
- 修改 `设计.md`：同步交互、数据流、重规划和 UI 规则。
- 修改 `架构.md`：同步 SQLite 字段、事件协议、执行链路和 WebSocket 边界。
- 修改 `packages/shared/src/index.ts`：扩展共享 `TaskStepRecord` 字段注释。
- 修改 `services/center/src/types.ts`：扩展中心服务 `TaskStepRecord`。
- 修改 `services/center/src/database.ts`：迁移 `task_steps` 新字段。
- 修改 `services/center/src/data-access/session-repository.ts`：查询、创建、更新任务步骤新字段。
- 修改 `services/center/src/domain/session-domain.ts`：创建步骤、重规划、中心本机时间和引导合并。
- 修改 `services/center/src/domain/session-turn-effects.ts`：把 `builtin.todo.list` 分派到明确执行器。
- 创建 `services/center/src/tools/todo-list-tool.ts`：维护当前智能体拆解步骤。
- 修改 `apps/frontend/src/views/Chat/useChatConversation.ts`：只生成可见拆解步骤行。
- 修改 `apps/frontend/src/views/Chat/components/ChatConversationPanel.vue`：任务入口仅在存在拆解步骤时显示。
- 修改 `apps/frontend/src/views/Chat/dialogs/TaskDetailDialog.vue`：单行展示拆解步骤。

## 任务 1：文档事实源同步

**文件：**
- 修改：`需求.md`
- 修改：`设计.md`
- 修改：`架构.md`

- [ ] **步骤 1：同步需求口径**

写入“只有拆解步骤才展示任务入口；单默认任务不展示；主对话和智能体弹框按 agentId 隔离任务拆解视图”。

- [ ] **步骤 2：同步设计口径**

写入单行任务步骤展示规则：左侧状态和标题，右侧不显示时间、耗时、序号、总数或任何附加信息，不展示第二行。

- [ ] **步骤 3：同步架构口径**

写入 `task_steps` 新字段、`builtin.todo.list` 执行器、`session.guidance.submit` 重规划和 WebSocket 事件边界。

## 任务 2：后端步骤事实源与 todoList 执行器

**文件：**
- 修改：`packages/shared/src/index.ts`
- 修改：`services/center/src/types.ts`
- 修改：`services/center/src/database.ts`
- 修改：`services/center/src/data-access/session-repository.ts`
- 修改：`services/center/src/domain/session-domain.ts`
- 修改：`services/center/src/domain/session-turn-effects.ts`
- 创建：`services/center/src/tools/todo-list-tool.ts`

- [ ] **步骤 1：写入失败检查**

新增或更新静态回归检查，确认 `TaskStepRecord` 包含 `planVersion`、`stepOrder`、`source`、`dependsOn`、`acceptance`、`supersededBy` 和 `supersededReason`。

- [ ] **步骤 2：扩展数据库迁移**

给 `task_steps` 增加可重复迁移字段，旧库默认 `plan_version = 1`，旧步骤 `source = graph`。

- [ ] **步骤 3：扩展仓储读写**

所有 `SELECT task_steps` 查询都返回新字段；创建和更新步骤时写入计划版本、顺序、来源和验收口径。

- [ ] **步骤 4：实现 todoList 执行器**

`builtin.todo.list` 接收当前 `sessionId/taskId/agentId` 和步骤列表，只更新当前智能体范围内的任务步骤，不跨会话或跨智能体写入。

- [ ] **步骤 5：接入工具执行链路**

`session-turn-effects.ts` 识别 `builtin.todo.list` 并调用执行器，输出可回填模型的结果摘要。

## 任务 3：前端任务入口和单行展示

**文件：**
- 修改：`apps/frontend/src/views/Chat/useChatConversation.ts`
- 修改：`apps/frontend/src/views/Chat/components/ChatConversationPanel.vue`
- 修改：`apps/frontend/src/views/Chat/dialogs/TaskDetailDialog.vue`

- [ ] **步骤 1：写入失败检查**

检查任务入口不能在单个默认任务时显示 `任务 0/1`；任务详情行不能出现第二行摘要或右侧重复状态。

- [ ] **步骤 2：筛选可见拆解步骤**

`createTaskPanelRows` 只在同一任务存在大于 `1` 个可见步骤时返回任务行，否则返回空数组。

- [ ] **步骤 3：调整入口计数**

底部任务入口按可见拆解步骤计算，不按默认任务数量计算。

- [ ] **步骤 4：调整弹框展示**

任务详情弹框展示单行步骤：状态和标题，右侧不显示时间、耗时、序号、总数或任何附加信息。

## 任务 4：验证与浏览器验收

**文件：**
- 修改：`启动进程.md`
- 修改：`浏览器页面.md`

- [ ] **步骤 1：运行静态回归检查**

运行本轮新增或更新的回归检查，确认失败后修复，再确认通过。

- [ ] **步骤 2：使用用户环境启动前端和桌面壳**

按项目规则记录 PID、端口和启动命令。

- [ ] **步骤 3：Chrome DevTools 验收**

按真实用户方式打开对话页面，确认单默认任务不显示任务入口，拆解步骤按单行规则展示，右侧任务状态只显示概览。

- [ ] **步骤 4：Git 处理**

发现远端领先先拉取，提交工作区所有非忽略改动并推送。
