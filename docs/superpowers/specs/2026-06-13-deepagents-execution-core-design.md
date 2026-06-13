# Deep Agents 执行内核迁移设计

## 背景

致心智能体当前中心服务已经具备 LangChain 模型运行时、统一工具注册表、任务步骤、事件日志、WebSocket 同步、Markdown 记忆和 SQLite 事实源。用户确认采用“中心服务外壳 + Deep Agents 执行内核”的方案：Deep Agents 已提供的同类执行能力全部迁移到 Deep Agents，中心服务继续保留事实源、安全、审计、多端同步和本机配置边界。

## 目标

- 把中心服务自研模型循环、工具调度、todoList 规划和子智能体委派迁移到 Deep Agents 执行内核。
- 保持中心服务作为唯一事实源和唯一安全边界。
- 保持现有前端过程卡片、任务步骤、多端同步和审计事件协议可继续使用。
- 迁移完成后删除确认未使用的旧执行文件、旧工具循环文件和旧适配文件。

## 范围

包含：

- 在 `services/center` 引入精确版本 `deepagents` 依赖。
- 新增或改造 Deep Agents runner，作为当前轮次主执行路径。
- 把中心服务供应商配置解析出的 LangChain ChatModel 传入 Deep Agents。
- 把中心服务统一工具注册表包装成 Deep Agents 可调用工具。
- 将 Deep Agents planning/todo 同步到现有 `task_steps`。
- 将 Deep Agents subagents 委派同步到现有 `SubAgent` 运行记录和事件。
- 将 Deep Agents 运行事件适配为现有 UI 与审计事件。
- 删除确认没有真实调用方的旧执行文件。

不包含：

- 不让 Deep Agents 直接写核心 SQLite、Markdown 记忆、中心目录或供应商密钥。
- 不改变桌面壳管理中心服务生命周期的规则。
- 不改变 WebSocket 作为对话首屏、发送、事件补齐和多端同步入口的规则。
- 不改变前端过程卡片的大协议和展示口径。

## 设计方案

采用方案 2：中心服务外壳 + Deep Agents 执行内核。

中心服务在收到用户消息后仍创建 `message`、`conversation_turn`、`task` 和基础事件。之后由 Deep Agents runner 创建当前轮次 agent graph。Deep Agents 负责规划、上下文管理、模型工具循环、todo、虚拟文件上下文和子智能体委派。中心服务通过工具包装层承接所有副作用操作，并把运行过程转换为现有事件、任务步骤和 WebSocket 消息。

## 模块边界

- `services/center/src/agents`：继续裁决主智能体、长期智能体和子智能体身份、工具权限和模型可见能力。
- `services/center/src/tools`：继续承载命令、MCP、skill、创建智能体、team 和 todoList 的中心服务工具执行器。
- `services/center/src/domain`：继续承载会话、任务、事件、记忆、用量和同步领域逻辑。
- Deep Agents runner：只负责把 Deep Agents 执行过程接入中心服务工具、模型和事件桥，不直接成为事实源。
- 旧执行 runner：迁移完成后如果没有真实调用方必须删除；如果需要临时兼容，必须有明确调用方和中文注释说明。

## 数据流

```text
用户发送消息
-> 中心服务创建消息、轮次、任务和基础事件
-> 中心服务解析当前智能体、供应商、模型、推理深度、记忆摘要和可用工具
-> Deep Agents runner 创建当前轮次 agent graph
-> Deep Agents 执行 planning/todo、工具调用、subagents 和上下文管理
-> 中心服务包装工具执行权限审批、命令、MCP、skill、文件副作用和创建类操作
-> 中心服务把 Deep Agents 运行事件写成现有 events、task_steps 和过程卡片事件
-> 中心服务固化助手消息、轮次状态、用量和记忆索引
-> WebSocket 同步桌面端、Web端和 IDE 插件端
```

## 工具桥接

Deep Agents 可见工具只能来自中心服务包装层。工具包装层需要保留现有字段：

- 工具安全名。
- 内部工具 ID。
- 输入 schema。
- 权限要求。
- 风险等级。
- 审批需求。
- 展示文案。
- 不可用原因。

命令、MCP、skill、文件读写和创建类工具都不能让 Deep Agents 直接执行本机副作用。Deep Agents 调用工具时，中心服务先做权限和执行模式裁决，再执行或进入等待用户状态。

## todoList 映射

Deep Agents 的 planning/todo 能力作为主规划入口。中心服务需要把 Deep Agents todo 更新映射到 `task_steps`：

- 写入范围是 `sessionId + taskId + agentId`。
- 简单任务不生成可见 todoList。
- 任务步骤状态仍使用当前项目状态枚举。
- 任务入口、任务面板和智能体弹框继续按当前 UI 口径展示。

## 子智能体映射

Deep Agents subagents 能力作为子任务委派入口。中心服务仍负责：

- 创建 `SubAgent` 运行记录。
- 保存父级 `agentId`、供应商 ID、模型和推理深度。
- 拒绝子智能体继续创建下级智能体。
- 写入智能体状态事件和协作过程事件。
- 按 `parentSessionId + agentId` 隔离子对话。

## 事件适配

Deep Agents 运行事件需要适配到现有事件协议。至少覆盖：

- `model.stream.delta`
- `model.stream.completed`
- `model.tool.requested`
- `tool.plan.created`
- `tool.command.*`
- `tool.mcp.*`
- `tool.todo.list.*`
- `agent.*`
- `task.step.*`
- `model.tool.result.appended`
- `message.created`
- `turn.updated`
- `task.updated`

前端不因为执行内核迁移而修改过程卡片聚合主协议。

## 清理策略

实现时必须检查旧文件和旧入口真实调用方。确认无调用方后删除：

- 旧手写 LangGraph 主执行 runner。
- 旧模型工具循环。
- 旧工具结果回填主路径。
- 旧子智能体委派主路径。
- 旧 todoList 主规划路径。
- 迁移后没有引用的类型、脚本、测试辅助和导入。

不能删除仍有真实调用方的文件。保留兼容入口时必须写明保留原因。

## 验收口径

- `services/center/package.json` 包含精确版本 `deepagents`。
- 当前轮次主执行路径通过 Deep Agents runner 执行。
- Deep Agents todo 能同步为当前会话当前智能体的任务步骤。
- Deep Agents subagents 能同步为中心服务子智能体运行记录和过程事件。
- 命令、MCP、skill 和文件副作用仍经过中心服务权限、审批、审计和 WebSocket 同步。
- 前端过程卡片和任务入口协议保持可用。
- 确认未使用的旧执行文件已删除，保留文件都有真实调用方。

## 规格自检

- 没有保留“待定”范围。
- 没有要求 Deep Agents 绕过中心服务事实源。
- 没有扩大到插件市场、外置插件安装或前端重做。
- 旧文件删除只针对确认无真实调用方的文件，避免误删仍在使用的兼容入口。
