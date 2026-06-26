/**
 * TASK_STATUSES：任务和任务步骤生命周期状态常量。
 *
 * 来源：中心服务会话、任务和多端同步协议。
 * 含义：为现有 TaskStatus 类型提供运行时常量，避免前后端重复写字符串。
 * 格式：大写键映射固定协议值。
 * 默认值：queued 由中心服务创建任务时写入。
 * 约束：新增状态必须同步 TaskStatus 类型和终态数组。
 */
export const TASK_STATUSES = {
    QUEUED: "queued",
    RUNNING: "running",
    WAITING_USER: "waiting_user",
    COMPLETED: "completed",
    FAILED: "failed",
    CANCELLED: "cancelled",
    SUPERSEDED: "superseded",
} as const;

/**
 * CONVERSATION_TURN_STATUSES：对话轮次生命周期状态常量。
 *
 * 来源：conversation_turns 表和 session.turn.state 轻量状态协议。
 * 含义：约束一轮用户输入到 Agent 收尾之间的状态。
 * 格式：大写键映射固定协议值。
 * 默认值：running。
 * 约束：waiting_user 是等待用户状态，不代表 endedAt 已写入。
 */
export const CONVERSATION_TURN_STATUSES = {
    RUNNING: TASK_STATUSES.RUNNING,
    WAITING_USER: TASK_STATUSES.WAITING_USER,
    COMPLETED: TASK_STATUSES.COMPLETED,
    FAILED: TASK_STATUSES.FAILED,
    CANCELLED: TASK_STATUSES.CANCELLED,
} as const;

/**
 * ACTIVE_TURN_STATE_STATUSES：轻量轮次状态接口额外使用的状态常量。
 *
 * 来源：session.turn.state 前端恢复协议。
 * 含义：在真实轮次状态之外补充没有活动轮次时的 idle 和本地排队状态 queued。
 * 格式：大写键映射固定协议值。
 * 默认值：idle 表示当前会话没有可恢复轮次。
 * 约束：queued 只用于轻量状态和任务，不写入 ConversationTurnStatus。
 */
export const ACTIVE_TURN_STATE_STATUSES = {
    IDLE: "idle",
    QUEUED: TASK_STATUSES.QUEUED,
    RUNNING: TASK_STATUSES.RUNNING,
    WAITING_USER: TASK_STATUSES.WAITING_USER,
    COMPLETED: TASK_STATUSES.COMPLETED,
    FAILED: TASK_STATUSES.FAILED,
    CANCELLED: TASK_STATUSES.CANCELLED,
} as const;

/**
 * AGENT_RUNTIME_STATUSES：智能体运行状态常量。
 *
 * 来源：智能体状态树和中心服务 agent.state.changed 事件。
 * 含义：描述主智能体、长期智能体和子智能体的展示状态。
 * 格式：大写键映射固定协议值。
 * 默认值：idle。
 * 约束：前端只展示中心服务推送状态，不本地猜测智能体状态。
 */
export const AGENT_RUNTIME_STATUSES = {
    IDLE: "idle",
    WORKING: "working",
    QUEUED: TASK_STATUSES.QUEUED,
    WAITING_USER: TASK_STATUSES.WAITING_USER,
    ENDED: "ended",
    FAILED: TASK_STATUSES.FAILED,
} as const;

/**
 * FINAL_TASK_STATUSES：任务和任务步骤终态集合。
 *
 * 来源：任务生命周期协议。
 * 含义：用于前后端统一判断任务是否已经不再运行。
 * 格式：只读字符串数组。
 * 默认值：无。
 * 约束：superseded 只用于任务步骤，不用于任务主状态。
 */
export const FINAL_TASK_STATUSES = [
    TASK_STATUSES.COMPLETED,
    TASK_STATUSES.FAILED,
    TASK_STATUSES.CANCELLED,
    TASK_STATUSES.SUPERSEDED,
] as const;

/**
 * FINAL_TURN_STATUSES：轮次执行收敛状态集合。
 *
 * 来源：Agent 轮次终态收敛协议。
 * 含义：用于前端和中心服务判断当前轮次是否需要停止本地运行态展示。
 * 格式：只读字符串数组。
 * 默认值：无。
 * 约束：waiting_user 表示进入权限或补充输入等待，也需要隐藏停止按钮。
 */
export const FINAL_TURN_STATUSES = [
    CONVERSATION_TURN_STATUSES.WAITING_USER,
    CONVERSATION_TURN_STATUSES.COMPLETED,
    CONVERSATION_TURN_STATUSES.FAILED,
    CONVERSATION_TURN_STATUSES.CANCELLED,
] as const;

/**
 * EVENT_TYPE_PREFIXES：事件类型固定前缀常量。
 *
 * 来源：events.event_type 协议。
 * 含义：供动态事件拼装和前端分类判断复用。
 * 格式：点号结尾的固定前缀。
 * 默认值：无。
 * 约束：只能放协议前缀，不放 UI 文案。
 */
export const EVENT_TYPE_PREFIXES = {
    THINKING: "thinking.",
    GRAPH_NODE: "graph.node.",
    MODEL: "model.",
    MODEL_TOOL: "model.tool.",
    TOOL: "tool.",
    TOOL_COMMAND: "tool.command.",
    TOOL_MCP: "tool.mcp.",
    TOOL_CALL: "tool.call.",
    TOOL_SKILL: "tool.skill.",
    TOOL_PLUGIN: "tool.plugin.",
    TOOL_AGENT: "tool.agent.",
    TASK: "task.",
    TASK_STEP: "task.step.",
    AGENT_LOOP: "agent.loop.",
    AGENT_TEAM: "agent.team.",
    WORKER: "worker.",
} as const;

/**
 * EVENT_TYPE_SUFFIXES：事件类型固定后缀常量。
 *
 * 来源：events.event_type 协议。
 * 含义：供前端过程卡片状态推导和中心服务流式判断复用。
 * 格式：点号开头的固定后缀。
 * 默认值：无。
 * 约束：只描述协议后缀，不承担业务终态判断。
 */
export const EVENT_TYPE_SUFFIXES = {
    STARTED: ".started",
    DELTA: ".delta",
    OUTPUT: ".output",
    COMPLETED: ".completed",
    FAILED: ".failed",
    ERROR: ".error",
    REJECTED: ".rejected",
    UNAVAILABLE: ".unavailable",
} as const;

/**
 * EVENT_SCOPE_TYPES：事件作用域类型常量。
 *
 * 来源：events.scope_type 字段。
 * 含义：描述事件归属的业务作用域，供中心服务写入和审计查询使用。
 * 格式：大写键映射固定协议值。
 * 默认值：无。
 * 约束：新增中心服务事件作用域必须先补入这里。
 */
export const EVENT_SCOPE_TYPES = {
    AGENT: "agent",
    AGENT_COLLABORATION: "agent-collaboration",
    AGENT_TEAM: "agent-team",
    APPROVAL: "approval",
    ATTACHMENT: "attachment",
    EXTENSION: "extension",
    FILE: "file",
    MEMORY: "memory",
    MESSAGE: "message",
    MODEL: "model",
    PERSONAL: "personal",
    PLUGIN: "plugin",
    PROJECT: "project",
    SESSION: "session",
    TASK: "task",
    TASK_STEP: "task_step",
    TOOL: "tool",
    TOOL_PLAN: "tool-plan",
    TURN: "turn",
    USAGE: "usage",
    WORKER: "worker",
} as const;

/**
 * EVENT_TYPES：核心事件类型常量。
 *
 * 来源：events.event_type 字段。
 * 含义：收敛前端和中心服务共同理解的精确事件名。
 * 格式：大写键映射固定协议值。
 * 默认值：无。
 * 约束：动态事件可继续由前缀拼装，但固定核心事件必须使用本常量。
 */
export const EVENT_TYPES = {
    AGENT_BOOTSTRAP: "agent.bootstrap",
    AGENT_COLLABORATION_GROUP_CHAT: "agent.collaboration.group_chat",
    AGENT_COLLABORATION_PIPELINE: "agent.collaboration.pipeline",
    AGENT_CREATED: "agent.created",
    AGENT_DELETED: "agent.deleted",
    AGENT_DISABLED: "agent.disabled",
    AGENT_STATE_CHANGED: "agent.state.changed",
    AGENT_SUB_CONVERSATION_MESSAGE_CREATED: "agent.sub_conversation.message.created",
    AGENT_TEAM_CREATED: "agent.team.created",
    AGENT_TEAM_DISBANDED: "agent.team.disbanded",
    AGENT_TEAM_MEMBER_ADDED: "agent.team.member.added",
    AGENT_TEAM_MEMBER_REMOVED: "agent.team.member.removed",
    AGENT_UPDATED: "agent.updated",
    APPROVAL_RECORDED: "approval.recorded",
    ATTACHMENT_COMMITTED: "attachment.committed",
    EDIT_PENDING_CREATED: "edit.pending.created",
    EXTENSION_CALLED: "extension.called",
    GRAPH_NODE_COMPLETED: "graph.node.completed",
    GRAPH_NODE_FAILED: "graph.node.failed",
    GRAPH_NODE_STARTED: "graph.node.started",
    THINKING_DELTA: "thinking.delta",
    MEMORY_ATTACHMENT_SUMMARY_SKIPPED: "memory.attachment.summary.skipped",
    MEMORY_MEM0_FAILED: "memory.mem0.failed",
    MEMORY_MEM0_SKIPPED: "memory.mem0.skipped",
    MEMORY_MEM0_SYNCED: "memory.mem0.synced",
    MEMORY_WRITE: "memory.write",
    MEMORY_WRITE_GRAPH_CHECKPOINT: "memory.write.graph_checkpoint",
    MEMORY_WRITE_SKIPPED: "memory.write.skipped",
    MESSAGE_ASSISTANT_CREATED: "message.assistant.created",
    MESSAGE_CREATED: "message.created",
    MESSAGE_TURN_FAILED: "message.turn.failed",
    MODEL_CALL_RAW_RESPONSE: "model.call.raw_response",
    MODEL_CALL_RETRYING: "model.call.retrying",
    MODEL_FAILED: "model.failed",
    MODEL_ORCHESTRATED: "model.orchestrated",
    MODEL_OUTPUT_OBSERVER_FAILED: "model.output.observer.failed",
    MODEL_PROVIDER_LANGCHAIN_COMPLETED: "model.provider.langchain.completed",
    MODEL_PROVIDER_LANGCHAIN_FAILED: "model.provider.langchain.failed",
    MODEL_STREAM_COMPLETED: "model.stream.completed",
    MODEL_STREAM_DELTA: "model.stream.delta",
    MODEL_STREAM_STARTED: "model.stream.started",
    MODEL_TOOL_CALL_NAME_MISSING: "model.tool_call.name_missing",
    MODEL_TOOL_CHOICE_EVALUATED: "model.tool_choice.evaluated",
    MODEL_TOOL_REJECTED: "model.tool.rejected",
    MODEL_TOOL_REQUESTED: "model.tool.requested",
    MODEL_TOOL_RESULT_APPENDED: "model.tool.result.appended",
    MODEL_TOOL_CALLS_RECEIVED: "model.tool_calls.received",
    NOTIFICATION_CREATED: "notification.created",
    PERSONAL_CALENDAR_CREATED: "personal.calendar.created",
    PERSONAL_KNOWLEDGE_CREATED: "personal.knowledge.created",
    PERSONAL_TODO_CREATED: "personal.todo.created",
    PLUGIN_CONFIGURED: "plugin.configured",
    PLUGIN_DELETE_SKIPPED: "plugin.delete.skipped",
    PLUGIN_DELETED: "plugin.deleted",
    PLUGIN_DISABLED: "plugin.disabled",
    PLUGIN_ENABLED: "plugin.enabled",
    PLUGIN_INSTALLED: "plugin.installed",
    PROJECT_DELETED: "project.deleted",
    SESSION_DELETED: "session.deleted",
    SESSION_TITLE_SUMMARY_FAILED: "session.title_summary.failed",
    SESSION_TITLE_SUMMARY_SKIPPED: "session.title_summary.skipped",
    SESSION_UPDATED: "session.updated",
    SUBAGENT_CREATED: "subagent.created",
    TASK_FAILED: "task.failed",
    TASK_PLAN_REVISED: "task.plan.revised",
    TASK_STEP_UPDATED: "task.step.updated",
    TASK_UPDATED: "task.updated",
    TOOL_AVAILABLE_SNAPSHOT: "tool.available.snapshot",
    TOOL_CALL_FAILED: "tool.call.failed",
    TOOL_COMMAND_CANCELLED: "tool.command.cancelled",
    TOOL_COMMAND_COMPLETED: "tool.command.completed",
    TOOL_COMMAND_OUTPUT: "tool.command.output",
    TOOL_COMMAND_STARTED: "tool.command.started",
    TOOL_MCP_COMPLETED: "tool.mcp.completed",
    TOOL_MCP_FAILED: "tool.mcp.failed",
    TOOL_MCP_STARTED: "tool.mcp.started",
    TOOL_OBSERVER_FAILED: "tool.observer.failed",
    TOOL_PLAN_COMPLETED: "tool.plan.completed",
    TOOL_PLAN_CREATED: "tool.plan.created",
    TOOL_PLAN_FAILED: "tool.plan.failed",
    TOOL_RESOURCE_CLEANUP_FAILED: "tool.resource.cleanup.failed",
    TURN_CANCELLED: "turn.cancelled",
    TURN_STARTED: "turn.started",
    TURN_STATE_CHANGED: "turn.state.changed",
    TURN_UPDATED: "turn.updated",
    USAGE_RECORDED: "usage.recorded",
    USAGE_RECORDED_GRAPH_CHECKPOINT: "usage.recorded.graph_checkpoint",
    USAGE_RECORD_FAILED: "usage.record.failed",
    USAGE_RECORD_SKIPPED: "usage.record.skipped",
    WORKER_CANCELLED: "worker.cancelled",
    WORKER_STARTED: "worker.started",
    WORKER_TASK_FAILED: "worker.task.failed",
} as const;

/** TaskStatus：任务生命周期协议类型。 */
export type TaskStatus = typeof TASK_STATUSES[keyof typeof TASK_STATUSES];

/** ConversationTurnStatus：对话轮次生命周期协议类型。 */
export type ConversationTurnStatus = typeof CONVERSATION_TURN_STATUSES[keyof typeof CONVERSATION_TURN_STATUSES];

/** AgentRuntimeStatus：智能体运行状态协议类型。 */
export type AgentRuntimeStatus = typeof AGENT_RUNTIME_STATUSES[keyof typeof AGENT_RUNTIME_STATUSES];

/** ActiveTurnStateStatus：轻量轮次状态接口状态协议类型。 */
export type ActiveTurnStateStatus = typeof ACTIVE_TURN_STATE_STATUSES[keyof typeof ACTIVE_TURN_STATE_STATUSES];

/** KnownEventType：当前共享协议已收敛的固定事件类型。 */
export type KnownEventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

/** EventScopeType：中心服务事件作用域类型。 */
export type EventScopeType = typeof EVENT_SCOPE_TYPES[keyof typeof EVENT_SCOPE_TYPES];
