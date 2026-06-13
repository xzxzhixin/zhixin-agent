/**
 * 应用中文名。
 *
 * 来源：产品需求中的项目中文名。
 * 含义：用于窗口标题、通知标题和 UI 品牌展示。
 * 格式：固定中文字符串。
 * 默认值：致心智能体。
 * 约束：不得作为数据身份字段使用。
 */
export const APP_NAME = "致心智能体";

/**
 * 应用英文名。
 *
 * 来源：产品需求中的项目英文名。
 * 含义：用于包名、日志命名和英文路径。
 * 格式：小写英文加连字符。
 * 默认值：zhixin-agent。
 * 约束：不得用于替代用户可见中文名。
 */
export const APP_ENGLISH_NAME = "zhixin-agent";

/**
 * 中心服务默认端口。
 *
 * 来源：需求和架构约定。
 * 含义：桌面壳、Web 和 IDE 插件默认连接的本机端口。
 * 格式：TCP 端口号。
 * 默认值：8866。
 * 约束：用户修改端口后只影响后续中心服务启动。
 */
export const DEFAULT_CENTER_PORT = 8866;

/**
 * 默认中心目录名。
 *
 * 来源：新版架构的绿色版交付约定。
 * 含义：开发期和绿色版默认数据目录名称。
 * 格式：英文目录名。
 * 默认值：center-data。
 * 约束：这是目录名，不是绝对路径。
 */
export const CENTER_DATA_DIR_NAME = "center-data";

/**
 * 客户端类型。
 *
 * 来源：架构中的客户端能力适配层。
 * 含义：标识当前连接中心服务的宿主形态。
 * 格式：固定字符串枚举。
 * 默认值：由客户端启动入口决定。
 * 约束：服务端权限判断必须使用该字段和连接信息共同判断，不能只信任前端传值。
 */
export type ClientType =
  | "desktop-shell"
  | "web-local"
  | "web-remote"
  | "web-mobile"
  | "ide-plugin"
  | "worker"
  | "plugin";

/**
 * 前端入口模式。
 *
 * 来源：统一前端多入口架构。
 * 含义：控制前端加载主工作台、手机布局或 IDE 紧凑布局。
 * 格式：固定字符串枚举。
 * 默认值：由 HTML 入口和客户端能力适配层决定。
 * 约束：不能作为服务端业务授权依据。
 */
export type EntryMode =
  | "workspace"
  | "mobile"
  | "plugin-compact";

/**
 * 任务状态。
 *
 * 来源：会话、轮次、任务与同步架构。
 * 含义：描述中心服务任务当前生命周期。
 * 格式：固定字符串枚举。
 * 默认值：queued。
 * 约束：状态变更必须写入事件日志。
 */
export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "superseded";

/**
 * 智能体运行状态。
 *
 * 来源：需求中的智能体状态。
 * 含义：描述智能体或子智能体当前可展示状态。
 * 格式：固定字符串枚举。
 * 默认值：idle。
 * 约束：状态来自中心服务，不由 UI 本地猜测。
 */
export type AgentRuntimeStatus =
  | "idle"
  | "working"
  | "queued"
  | "waiting_user"
  | "ended"
  | "failed";

/**
 * 执行模式。
 *
 * 来源：需求中的对话执行模式。
 * 含义：影响副作用操作是否需要用户审批。
 * 格式：固定字符串枚举。
 * 默认值：full_auto。
 * 约束：切换后只影响后续操作，不回改历史任务。
 */
export type ExecutionMode =
  | "suggest"
  | "auto_edit"
  | "full_auto";

/**
 * Tokenizer 输入片段类型。
 *
 * 来源：上下文 token 统计协议。
 * 含义：标识 token 统计覆盖的上下文来源。
 * 格式：固定字符串枚举。
 * 默认值：无。
 * 约束：不能用字符数或字符串长度替代该协议口径。
 */
export type TokenizerInputSegmentKind =
  | "system"
  | "developer"
  | "history"
  | "current-message"
  | "tool-description"
  | "reference"
  | "attachment"
  | "runtime-context";

/**
 * Tokenizer 输入片段。
 *
 * 来源：中心服务实际送入模型的上下文包。
 * 含义：保存一段待统计文本及其业务来源。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：sourceId 必须指向明确消息、附件、引用或内置上下文 ID。
 */
export interface TokenizerInputSegment {
  /** segmentKind: 片段类型。 */
  segmentKind: TokenizerInputSegmentKind;
  /** sourceId: 片段来源 ID。 */
  sourceId: string;
  /** content: 参与 token 统计的实际文本。 */
  content: string;
}

/**
 * Tokenizer 统计请求。
 *
 * 来源：前端输入区和中心服务模型调用链路。
 * 含义：描述模型、输入范围、窗口上限和实际上下文片段。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：windowLimitTokens 为 token 数，不是 K 字符或字符数。
 */
export interface TokenizerCountRequest {
  /** modelId: 模型标识。 */
  modelId: string;
  /** inputRange: 统计范围。 */
  inputRange: "composer-window" | "model-request";
  /** windowLimitTokens: 模型窗口上限，单位 token。 */
  windowLimitTokens: number;
  /** segments: 实际纳入统计的上下文片段。 */
  segments: TokenizerInputSegment[];
}

/**
 * Tokenizer 错误结构。
 *
 * 来源：中心服务 tokenizer 适配器。
 * 含义：记录 tokenizer 匹配或统计失败原因。
 * 格式：统一错误码和中文消息。
 * 默认值：正常统计时为 null。
 * 约束：不能包含 API Key、代理密码等敏感明文。
 */
export interface TokenizerError {
  /** code: tokenizer 错误码。 */
  code: string;
  /** message: 可展示错误消息。 */
  message: string;
}

/**
 * Tokenizer 统计响应。
 *
 * 来源：中心服务 tokenizer 模块。
 * 含义：返回统计来源、模型、输入范围、已用 token 和窗口上限。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：usedTokens 必须来自 tokenizer 适配器，不允许使用字符串长度估算。
 */
export interface TokenizerCountResponse {
  /** tokenizerId: tokenizer 适配器 ID。 */
  tokenizerId: string;
  /** tokenizerName: tokenizer 用户可见名称。 */
  tokenizerName: string;
  /** source: tokenizer 来源。 */
  source: "built-in" | "external";
  /** modelId: 当前统计匹配的模型标识。 */
  modelId: string;
  /** inputRange: 当前统计范围。 */
  inputRange: "composer-window" | "model-request";
  /** usedTokens: 已使用 token 数。 */
  usedTokens: number;
  /** windowLimitTokens: 模型窗口上限，单位 token。 */
  windowLimitTokens: number;
  /** includedSegmentKinds: 本次统计覆盖的片段类型。 */
  includedSegmentKinds: TokenizerInputSegmentKind[];
  /** error: tokenizer 错误；成功时为 null。 */
  error: TokenizerError | null;
}

/**
 * Tokenizer 适配器接口。
 *
 * 来源：中心服务 tokenizer 模块与外部 tokenizer 扩展边界。
 * 含义：约束内置和外部 tokenizer 的统一统计能力。
 * 格式：TypeScript 接口。
 * 默认值：无。
 * 约束：适配器不得自行访问客户端敏感信息。
 */
export interface TokenizerAdapter {
  /** tokenizerId: 适配器 ID。 */
  tokenizerId: string;
  /** tokenizerName: 适配器名称。 */
  tokenizerName: string;
  /** source: 适配器来源。 */
  source: "built-in" | "external";
  /** count: 执行 token 统计。 */
  count: (request: TokenizerCountRequest) => TokenizerCountResponse;
}

/**
 * API 错误结构。
 *
 * 来源：中心服务 REST API 统一响应规范。
 * 含义：承载业务错误、可展示原因和排查编号。
 * 格式：JSON 对象。
 * 默认值：成功响应中为 null。
 * 约束：业务失败通过该结构表达，不用 404 表示实体不存在。
 */
export interface ApiError {
  /**
   * code: 机器可读错误码，来源于中心服务错误枚举。
   */
  code: string;

  /**
   * message: 面向开发和日志排查的错误消息。
   */
  message: string;

  /**
   * displayMessage: 可直接展示给用户的中文原因。
   */
  displayMessage: string;

  /**
   * traceId: 排查 ID，来源于中心服务请求或事件链路。
   */
  traceId: string;

  /**
   * details: 可选调试详情，不能包含敏感明文。
   */
  details?: unknown;
}

/**
 * API 统一响应包。
 *
 * 来源：中心服务 REST API 规范。
 * 含义：统一包装所有 GET 和 POST 接口响应。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：success 为 true 时 error 必须为 null；success 为 false 时 data 必须为 null。
 */
export interface ApiResponse<TData> {
  /**
   * success: 表示业务处理是否成功。
   */
  success: boolean;

  /**
   * data: 成功时返回的业务数据。
   */
  data: TData | null;

  /**
   * error: 失败时返回的统一错误结构。
   */
  error: ApiError | null;
}

/**
 * 项目记录。
 *
 * 来源：SQLite `projects` 表。
 * 含义：中心服务识别项目身份和展示名称的结构化记录。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：projectId 来自 `致心项目ID.md`，不能用路径替代。
 */
export interface ProjectRecord {
  /**
   * projectId: 项目 UUID，来源于项目根目录 `致心项目ID.md`。
   */
  projectId: string;

  /**
   * displayName: 当前展示名称，来源于项目文件夹名。
   */
  displayName: string;

  /**
   * alias: 用户设置的项目别名或备注；只能作为备注展示，不能替代文件夹名。
   */
  alias: string | null;

  /**
   * latestPath: 最近一次登记的项目绝对路径。
   */
  latestPath: string;

  /**
   * createdAt: 首次登记时间，ISO 8601 字符串。
   */
  createdAt: string;

  /**
   * updatedAt: 最近更新时间，ISO 8601 字符串。
   */
  updatedAt: string;
}

/**
 * 会话类型。
 *
 * 来源：需求中的普通会话和项目会话。
 * 含义：区分是否绑定项目。
 * 格式：固定字符串枚举。
 * 默认值：普通入口创建时为 normal，项目入口创建时为 project。
 * 约束：project 会话必须绑定 projectId。
 */
export type SessionType =
  | "normal"
  | "project";

/**
 * 会话记录。
 *
 * 来源：SQLite `sessions` 表。
 * 含义：普通会话或项目会话的结构化状态。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：项目会话必须设置 projectId。
 */
export interface ConversationSession {
  /**
   * sessionId: 会话 ID，来源于中心服务生成。
   */
  sessionId: string;

  /**
   * sessionType: 会话类型，区分普通会话和项目会话。
   */
  sessionType: SessionType;

  /**
   * projectId: 项目会话绑定的项目 ID；普通会话为 null。
   */
  projectId: string | null;

  /**
   * title: 会话标题，来源于用户命名或中心服务摘要。
   */
  title: string;

  /**
   * createdAt: 创建时间，ISO 8601 字符串。
   */
  createdAt: string;

  /**
   * updatedAt: 更新时间，ISO 8601 字符串。
   */
  updatedAt: string;

  /**
   * lastUserMessagePreview: 最近一条用户消息摘要，来源于 messages 表 role=user 的最新消息；没有用户消息时为 null。
   */
  lastUserMessagePreview: string | null;
}

/**
 * 会话更新实时载荷。
 *
 * 来源：中心服务 `session.updated` 事件。
 * 含义：会话标题、更新时间或摘要类状态变化后同步给前端列表和详情。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：session 必须来自中心服务事实源，前端不能自行推断标题。
 */
export interface SessionUpdatedPayload {
  /**
   * session: 更新后的会话事实记录。
   */
  session: ConversationSession;

  /**
   * previousTitle: 更新前标题，用于审计和 UI 判断是否需要刷新。
   */
  previousTitle: string;

  /**
   * titleSummarySource: 标题摘要来源，当前为本轮用户输入和助手回复。
   */
  titleSummarySource: "turn-completion";
}

/**
 * 消息角色。
 *
 * 来源：会话消息展示协议。
 * 含义：描述消息来源或过程类型。
 * 格式：固定字符串枚举。
 * 默认值：用户发送为 user。
 * 约束：工具过程、错误和系统过程不要混写为 assistant。
 */
export type MessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "error";

/**
 * 会话消息。
 *
 * 来源：SQLite `messages` 表。
 * 含义：最终可展示消息和过程消息的统一结构。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：附件和引用通过结构化 ID 关联，不把二进制写入消息内容。
 */
export interface ConversationMessage {
  /**
   * messageId: 消息 ID，来源于中心服务生成。
   */
  messageId: string;

  /**
   * sessionId: 所属会话 ID。
   */
  sessionId: string;

  /**
   * agentId: 所属智能体 ID，主智能体固定为 main。
   */
  agentId: string;

  /**
   * turnId: 所属轮次 ID；系统初始化消息可为空。
   */
  turnId: string | null;

  /**
   * role: 消息角色或过程类型。
   */
  role: MessageRole;

  /**
   * contentMarkdown: Markdown 文本内容。
   */
  contentMarkdown: string;

  /**
   * createdAt: 创建时间，ISO 8601 字符串。
   */
  createdAt: string;
}

/**
 * 对话轮次状态。
 *
 * 来源：会话轮次生命周期。
 * 含义：描述一轮用户输入到 Agent 收尾之间的状态。
 * 格式：固定字符串枚举。
 * 默认值：running。
 * 约束：结束后持续时间固定，不再随客户端本地时钟变化。
 */
export type ConversationTurnStatus =
  | "running"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * 对话轮次。
 *
 * 来源：SQLite `conversation_turns` 表。
 * 含义：保存一轮用户与 Agent 完整交互边界。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：turnNumber 在同一会话内递增。
 */
export interface ConversationTurn {
  /**
   * turnId: 轮次 ID，来源于中心服务生成。
   */
  turnId: string;

  /**
   * sessionId: 所属会话 ID。
   */
  sessionId: string;

  /**
   * turnNumber: 会话内用户发起轮次编号。
   */
  turnNumber: number;

  /**
   * userMessageId: 本轮触发的用户消息 ID。
   */
  userMessageId: string;

  /**
   * status: 当前轮次状态。
   */
  status: ConversationTurnStatus;

  /**
   * startedAt: 开始时间，ISO 8601 字符串。
   */
  startedAt: string;

  /**
   * endedAt: 结束时间；未结束时为 null。
   */
  endedAt: string | null;

  /**
   * durationMs: 总持续毫秒数；未结束时为 null。
   */
  durationMs: number | null;
}

/**
 * 任务记录。
 *
 * 来源：SQLite `tasks` 表。
 * 含义：保存中心服务调度的任务当前状态。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：状态变化必须追加事件日志。
 */
export interface TaskRecord {
  /**
   * taskId: 任务 ID，来源于中心服务生成。
   */
  taskId: string;

  /**
   * turnId: 所属轮次 ID。
   */
  turnId: string;

  /**
   * sessionId: 所属会话 ID。
   */
  sessionId: string;

  /**
   * status: 当前任务状态。
   */
  status: TaskStatus;

  /**
   * title: 任务标题，来源于中心服务或 Agent 计划。
   */
  title: string;

  /**
   * createdAt: 创建时间，ISO 8601 字符串。
   */
  createdAt: string;

  /**
   * updatedAt: 更新时间，ISO 8601 字符串。
   */
  updatedAt: string;
}

/**
 * TaskStepRecord：任务步骤记录。
 *
 * 来源：SQLite `task_steps` 表。
 * 含义：保存用户可见任务拆解步骤状态，内部执行图过程不进入该表。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：只能通过所属任务的 `agentId` 间接归属到智能体 todoList。
 */
export interface TaskStepRecord {
  /** stepId: 任务步骤 ID。 */
  stepId: string;
  /** taskId: 所属任务 ID。 */
  taskId: string;
  /** planVersion: 步骤所属计划版本，来源于 task_steps.plan_version，旧数据默认 1。 */
  planVersion: number;
  /** stepOrder: 同一任务内的步骤顺序，来源于 task_steps.step_order，从 1 开始。 */
  stepOrder: number;
  /** source: 步骤来源，来源于 task_steps.source；graph 仅用于历史兼容，新执行图过程不再写入用户可见步骤。 */
  source: "graph" | "model" | "todoList" | "user" | "system";
  /** status: 步骤状态。 */
  status: TaskStatus;
  /** title: 步骤标题。 */
  title: string;
  /** dependsOn: 依赖步骤 ID 列表，来源于 task_steps.depends_on JSON 数组。 */
  dependsOn: string[];
  /** acceptance: 步骤完成验收口径，来源于模型计划、todoList 或用户引导。 */
  acceptance: string | null;
  /** startedAt: 步骤开始时间，ISO 字符串或 null。 */
  startedAt: string | null;
  /** endedAt: 步骤结束时间，ISO 字符串或 null。 */
  endedAt: string | null;
  /** summary: 步骤摘要、失败原因或排查信息。 */
  summary: string | null;
  /** supersededBy: 替换当前步骤的新步骤 ID，未替换时为 null。 */
  supersededBy: string | null;
  /** supersededReason: 当前步骤被替换的原因，未替换时为 null。 */
  supersededReason: string | null;
}

/**
 * 事件记录。
 *
 * 来源：SQLite `events` 表。
 * 含义：保存流式过程、状态变化、审计和断线补齐事件。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：eventType 使用固定枚举，sequence 在同一轮次内递增。
 */
export interface EventRecord {
  /**
   * eventId: 事件 ID，来源于中心服务生成。
   */
  eventId: string;

  /**
   * eventType: 固定事件类型。
   */
  eventType: string;

  /**
   * turnId: 所属轮次 ID。
   */
  turnId: string | null;

  /**
   * taskId: 所属任务 ID。
   */
  taskId: string | null;

  /**
   * sequence: 同一轮次内递增序号。
   */
  sequence: number;

  /**
   * occurredAt: 事件发生时间，ISO 8601 字符串。
   */
  occurredAt: string;

  /**
   * summary: 事件摘要，允许 UI 快速展示。
   */
  summary: string;

  /**
   * payload: 结构化事件载荷，不能包含敏感明文；payload.graph 可携带 TurnGraphCheckpoint，用于恢复对话内复杂任务编排。
   */
  payload: unknown;

  /**
   * traceId: 排查 ID。
   */
  traceId: string;
}

/**
 * TurnGraphCheckpoint：对话图检查点。
 *
 * 来源：中心服务每个可恢复任务节点写入的事件 `payload.graph`。
 * 含义：描述当前对话线程、轮次图运行、节点、superstep 和恢复边界。
 * 格式：JSON 对象。
 * 默认值：普通事件可以没有该字段。
 * 约束：只保存恢复索引和摘要，不保存模型 token、命令输出正文或敏感信息。
 */
export interface TurnGraphCheckpoint {
  /** graphRunId: 图运行 ID，当前映射为 turnId。 */
  graphRunId: string;
  /** threadId: 对话线程 ID，当前映射为 sessionId。 */
  threadId: string;
  /** nodeId: 图节点稳定 ID。 */
  nodeId: string;
  /** nodeKind: 图节点类型。 */
  nodeKind: string;
  /** superstep: 当前 superstep 序号，从 1 开始。 */
  superstep: number;
  /** checkpointId: 当前检查点 ID。 */
  checkpointId: string;
  /** parentCheckpointId: 上一个检查点 ID，首节点为 null。 */
  parentCheckpointId: string | null;
  /** attempt: 当前节点尝试次数。 */
  attempt: number;
  /** idempotencyKey: 恢复时避免副作用重复执行的幂等键。 */
  idempotencyKey: string;
  /** resumable: 是否允许从该节点边界恢复。 */
  resumable: boolean;
  /** nextNodeIds: 节点完成后可进入的后续节点。 */
  nextNodeIds: string[];
  /** stateSummary: 节点状态摘要。 */
  stateSummary: string;
}

/**
 * AgentSubConversationMessage：智能体子对话消息。
 *
 * 来源：SQLite `agent_sub_conversation_messages` 表。
 * 含义：当前主会话内某个 agentId 独立子对话的可展示消息。
 * 格式：JSON 对象。
 * 默认值：无消息时返回空数组。
 * 约束：parentSessionId 和 agentId 必须同时限定，不能混入主会话消息。
 */
export interface AgentSubConversationMessage {
  /** messageId: 子对话消息 ID，来源于中心服务生成。 */
  messageId: string;
  /** parentSessionId: 所属主会话 ID，来源于当前对话窗口。 */
  parentSessionId: string;
  /** agentId: 所属智能体 ID，来源于智能体状态节点。 */
  agentId: string;
  /** role: 消息角色，沿用主会话消息角色枚举。 */
  role: MessageRole;
  /** contentMarkdown: Markdown 消息正文。 */
  contentMarkdown: string;
  /** createdAt: 创建时间，ISO 8601 字符串。 */
  createdAt: string;
}

/**
 * AgentSubConversationDetail：智能体子对话详情。
 *
 * 来源：`POST /api/agent-sub-conversation/detail`。
 * 含义：返回当前主会话内指定智能体的独立消息流。
 * 格式：JSON 对象。
 * 默认值：首次打开时 messages 为空数组。
 * 约束：只能按 parentSessionId + agentId 查询。
 */
export interface AgentSubConversationDetail {
  /** parentSessionId: 当前主会话 ID。 */
  parentSessionId: string;
  /** agentId: 当前智能体 ID。 */
  agentId: string;
  /** agentName: 当前智能体展示名称，来源于前端状态节点或中心服务索引。 */
  agentName: string;
  /** messages: 当前智能体在当前主会话内的子对话消息。 */
  messages: AgentSubConversationMessage[];
  /** tasks: 当前智能体自己的 todoList 任务，来源于中心服务按 sessionId + agentId 查询。 */
  tasks: TaskRecord[];
  /** taskSteps: 当前智能体 todoList 任务步骤，只包含 tasks 内任务的步骤。 */
  taskSteps: TaskStepRecord[];
  /** events: 当前智能体 todoList 相关事件，只包含当前 agentId 范围。 */
  events: EventRecord[];
  /** tokenUsage: 当前智能体窗口 token 用量快照，来源于中心服务数据库；无记录时为 null。 */
  tokenUsage: {
    /** sessionId: 所属主会话 ID。 */
    sessionId: string;
    /** turnId: 最近一次统计关联的轮次 ID；没有轮次时为 null。 */
    turnId: string | null;
    /** agentId: 所属智能体 ID。 */
    agentId: string;
    /** usedTokens: 当前窗口已用 token 数。 */
    usedTokens: number;
    /** windowLimitTokens: 当前模型窗口上限 token 数。 */
    windowLimitTokens: number;
    /** usagePercent: 已用比例，允许超过 100。 */
    usagePercent: number;
    /** tokenizerName: tokenizer 展示名称。 */
    tokenizerName: string;
    /** tokenizerSource: tokenizer 来源。 */
    tokenizerSource: "built-in" | "external" | "fallback";
    /** modelId: 本次统计使用的模型 ID 或名称。 */
    modelId: string;
    /** updatedAt: 快照更新时间，ISO 8601 字符串。 */
    updatedAt: string;
  } | null;
}

/**
 * PendingEditStatus：待确认编辑状态。
 *
 * 来源：SQLite `pending_edit_records.status`。
 * 含义：描述本次编辑是否仍可保存、撤回或已经结束。
 * 格式：固定字符串枚举。
 * 默认值：pending。
 * 约束：accepted 和 reverted 都不能再次撤回。
 */
export type PendingEditStatus =
  | "pending"
  | "accepted"
  | "reverted"
  | "conflicted";

/**
 * PendingEditRecord：待确认编辑记录。
 *
 * 来源：SQLite `pending_edit_records` 表。
 * 含义：保存文件编辑前后内容，用于真实保存、撤回和对比。
 * 格式：JSON 对象。
 * 默认值：无编辑时列表为空。
 * 约束：filePath 必须是中心服务可访问的绝对路径或项目内明确路径。
 */
export interface PendingEditRecord {
  /** editId: 编辑记录 ID，来源于中心服务生成。 */
  editId: string;
  /** sessionId: 所属主会话 ID。 */
  sessionId: string;
  /** agentId: 产生编辑的智能体 ID；主智能体或未知来源时为 null。 */
  agentId: string | null;
  /** filePath: 被编辑文件路径。 */
  filePath: string;
  /** changeKind: 编辑类型中文摘要，例如 修改、新增、删除。 */
  changeKind: string;
  /** beforeContent: 编辑前文件内容，用于撤回和对比。 */
  beforeContent: string;
  /** afterContent: 编辑后文件内容，用于保存确认和冲突判断。 */
  afterContent: string;
  /** status: 当前编辑确认状态。 */
  status: PendingEditStatus;
  /** addedLines: diff 中新增行数。 */
  addedLines: number;
  /** removedLines: diff 中删除行数。 */
  removedLines: number;
  /** createdAt: 创建时间，ISO 8601 字符串。 */
  createdAt: string;
  /** updatedAt: 更新时间，ISO 8601 字符串。 */
  updatedAt: string;
}

/**
 * PendingEditDiff：编辑前后对比结果。
 *
 * 来源：`POST /api/edit-pending/diff`。
 * 含义：Web 端展示 diff，IDE 端桥接原生 diff 视图。
 * 格式：before/after 文本和行级 diff。
 * 默认值：无。
 * 约束：不能从当前文件重新猜 before，必须使用编辑记录保存的 beforeContent。
 */
export interface PendingEditDiff {
  /** editId: 编辑记录 ID。 */
  editId: string;
  /** filePath: 被编辑文件路径。 */
  filePath: string;
  /** beforeContent: 编辑前内容。 */
  beforeContent: string;
  /** afterContent: 编辑后内容。 */
  afterContent: string;
  /** diffText: 统一 diff 文本，用于 Web 展示。 */
  diffText: string;
}

/**
 * DeleteProjectResult：项目删除结果。
 *
 * 来源：`POST /api/project/delete`。
 * 含义：中心服务确认指定项目索引及其项目会话事实已删除。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：只删除中心服务事实源，不删除项目根目录或 `致心项目ID.md`。
 */
export interface DeleteProjectResult {
  /**
   * projectId: 已删除项目 ID，来源于项目根目录 `致心项目ID.md`。
   */
  projectId: string;

  /**
   * deletedSessionCount: 本次随项目删除清理的项目会话数量。
   */
  deletedSessionCount: number;

  /**
   * deleted: 是否删除成功。
   */
  deleted: boolean;
}

/**
 * 统一工具能力类型。
 *
 * 来源：中心服务工具能力注册表。
 * 含义：命令、插件、MCP 和 skill 在发现、权限、执行和审计链路中的统一分类。
 * 格式：固定字符串枚举。
 * 默认值：无。
 * 约束：前端过程卡片按该字段展示，不再为每类工具猜测多套状态模型。
 */
export type UnifiedToolKind =
  | "command"
  | "agent"
  | "plugin"
  | "mcp"
  | "skill";

/**
 * 统一工具能力状态。
 *
 * 来源：中心服务能力发现和权限筛选结果。
 * 含义：描述工具当前是否可执行或为何不可用。
 * 格式：固定字符串枚举。
 * 默认值：available。
 * 约束：不可用原因必须进入事件 payload，供 UI 和审计查看。
 */
export type UnifiedToolAvailability =
  | "available"
  | "unavailable";

/**
 * 统一工具风险等级。
 *
 * 来源：真实 Agent 工具调用闭环需求。
 * 含义：中心服务按风险等级和执行模式决定是否需要审批。
 * 格式：固定字符串枚举。
 * 默认值：无。
 * 约束：副作用工具不能标记为 low。
 */
export type UnifiedToolRiskLevel =
  | "low"
  | "medium"
  | "high";

/**
 * 统一工具适用范围。
 *
 * 来源：全局能力和项目级能力边界。
 * 含义：描述工具可在哪类对话或项目上下文中使用。
 * 格式：固定字符串枚举。
 * 默认值：global。
 * 约束：project 只允许当前项目会话使用。
 */
export type UnifiedToolScope =
  | "global"
  | "project"
  | "session";

/**
 * 统一工具输入参数 schema。
 *
 * 来源：模型工具调用协议。
 * 含义：描述工具参数 JSON Schema，供模型请求和中心服务校验共同使用。
 * 格式：JSON Schema 对象。
 * 默认值：无。
 * 约束：只保存 schema，不保存运行时参数值。
 */
export type UnifiedToolInputSchema = Record<string, unknown>;

/**
 * 统一工具能力。
 *
 * 来源：中心服务注册表、插件安装、MCP 配置和 skill 扫描。
 * 含义：Agent 在当前会话窗口内可发现的工具能力。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：权限枚举来源于架构权限模型。
 */
export interface UnifiedToolCapability {
  /** toolId: 工具能力 ID，中心服务注册表内唯一。 */
  toolId: string;
  /** toolKind: 工具类型。 */
  toolKind: UnifiedToolKind;
  /** displayName: 用户可见名称。 */
  displayName: string;
  /** requiredPermission: 执行该工具需要的权限。 */
  requiredPermission: string;
  /** availability: 当前可用状态。 */
  availability: UnifiedToolAvailability;
  /** unavailableReason: 不可用原因；可用时为 null。 */
  unavailableReason: string | null;
  /** description: 提供给模型理解该工具用途的说明。 */
  description: string;
  /** inputSchema: 工具参数 JSON Schema。 */
  inputSchema: UnifiedToolInputSchema;
  /** riskLevel: 工具风险等级，用于执行模式审批。 */
  riskLevel: UnifiedToolRiskLevel;
  /** scope: 工具适用范围。 */
  scope: UnifiedToolScope;
  /** approvalRequired: 该工具在当前能力声明中是否默认需要审批。 */
  approvalRequired: boolean;
  /** displayText: UI 过程卡片展示文案。 */
  displayText: string;
}

/**
 * 统一工具调用意图。
 *
 * 来源：Agent 工具规划。
 * 含义：把自然语言请求解析成明确工具、输入摘要和结构化参数。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：中心服务只能执行注册表里存在且可用的工具。
 */
export interface UnifiedToolCallIntent {
  /** toolId: 目标工具能力 ID。 */
  toolId: string;
  /** toolKind: 目标工具类型。 */
  toolKind: UnifiedToolKind;
  /** inputSummary: 调用用途摘要。 */
  inputSummary: string;
  /** arguments: 工具结构化参数，不包含敏感明文。 */
  arguments: Record<string, unknown>;
}

/**
 * 附件记录。
 *
 * 来源：SQLite `attachments` 表。
 * 含义：保存正式消息附件元数据。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：文件内容保存在附件目录，不直接写入 SQLite。
 */
export interface AttachmentRecord {
  /**
   * attachmentId: 附件 ID，来源于中心服务生成。
   */
  attachmentId: string;

  /**
   * sessionId: 所属会话 ID。
   */
  sessionId: string;

  /**
   * messageId: 所属消息 ID。
   */
  messageId: string;

  /**
   * fileName: 原始文件名。
   */
  fileName: string;

  /**
   * mimeType: MIME 类型。
   */
  mimeType: string;

  /**
   * sizeBytes: 文件大小，单位字节。
   */
  sizeBytes: number;

  /**
   * relativePath: 相对中心目录的附件文件路径。
   */
  relativePath: string;
}

/**
 * 通知事件。
 *
 * 来源：通知配置与通知事件需求。
 * 含义：中心服务生成并同步给客户端的通知。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：通知判断由中心服务完成，客户端只展示。
 */
export interface NotificationEvent {
  /**
   * notificationId: 通知 ID。
   */
  notificationId: string;

  /**
   * targetClientType: 目标客户端类型。
   */
  targetClientType: ClientType;

  /**
   * title: 通知标题。
   */
  title: string;

  /**
   * summary: 通知摘要。
   */
  summary: string;

  /**
   * createdAt: 通知生成时间，ISO 8601 字符串。
   */
  createdAt: string;

  /**
   * requiresUserAction: 是否需要用户处理。
   */
  requiresUserAction: boolean;
}

/**
 * 用量记录。
 *
 * 来源：SQLite `usage_records` 表。
 * 含义：保存模型调用原始用量和归集维度。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：只追加，不因供应商或项目后续变化回改。
 */
export interface UsageRecord {
  /**
   * usageId: 用量记录 ID。
   */
  usageId: string;

  /**
   * providerId: 调用时使用的供应商 ID。
   */
  providerId: string;

  /**
   * model: 调用时使用的模型名。
   */
  model: string;

  /**
   * projectId: 项目 ID；普通会话为 null。
   */
  projectId: string | null;

  /**
   * inputTokens: 输入 token 数；供应商未提供时为 null。
   */
  inputTokens: number | null;

  /**
   * outputTokens: 输出 token 数；供应商未提供时为 null。
   */
  outputTokens: number | null;

  /**
   * cacheHitTokens: 缓存命中 token 数；供应商未提供时为 null。
   */
  cacheHitTokens: number | null;

  /**
   * cacheMissTokens: 缓存未命中 token 数；供应商未提供时为 null。
   */
  cacheMissTokens: number | null;

  /**
   * createdAt: 调用时间，ISO 8601 字符串。
   */
  createdAt: string;
}

/**
 * 运行环境配置。
 *
 * 来源：运行环境需求。
 * 含义：保存 Node.js、Python、Java、Maven、Git 等可执行环境。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：运行环境选择只影响后续执行。
 */
export interface RuntimeConfig {
  /**
   * runtimeId: 运行环境 ID。
   */
  runtimeId: string;

  /**
   * name: 用户可见环境名称。
   */
  name: string;

  /**
   * type: 环境类型，例如 node、python、java、maven、git。
   */
  type: string;

  /**
   * executablePath: 可执行文件绝对路径。
   */
  executablePath: string;

  /**
   * enabled: 是否启用。
   */
  enabled: boolean;
}

/**
 * 待办事项。
 *
 * 来源：个人事务一等领域模块。
 * 含义：保存用户待办事项。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：属于中心服务事实源，可迁移。
 */
export interface PersonalTodo {
  /**
   * todoId: 待办 ID。
   */
  todoId: string;

  /**
   * title: 待办标题。
   */
  title: string;

  /**
   * completed: 是否已完成。
   */
  completed: boolean;

  /**
   * dueAt: 截止时间；未设置时为 null。
   */
  dueAt: string | null;
}

/**
 * 日程事件。
 *
 * 来源：个人事务一等领域模块。
 * 含义：保存用户日程。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：属于中心服务事实源，可迁移。
 */
export interface CalendarEvent {
  /**
   * eventId: 日程 ID。
   */
  eventId: string;

  /**
   * title: 日程标题。
   */
  title: string;

  /**
   * startsAt: 开始时间，ISO 8601 字符串。
   */
  startsAt: string;

  /**
   * endsAt: 结束时间，ISO 8601 字符串。
   */
  endsAt: string;
}

/**
 * 知识库条目。
 *
 * 来源：个人知识库一等领域模块。
 * 含义：保存个人知识库索引条目。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：正文可在 Markdown 或附件中保存，索引由中心服务维护。
 */
export interface KnowledgeItem {
  /**
   * itemId: 知识条目 ID。
   */
  itemId: string;

  /**
   * title: 条目标题。
   */
  title: string;

  /**
   * summary: 条目摘要。
   */
  summary: string;

  /**
   * sourceRef: 来源引用，例如会话、附件或网页。
   */
  sourceRef: string;
}

/**
 * 内部文件定位链接。
 *
 * 来源：IDE 插件和 Markdown 渲染协议。
 * 含义：在 UI 中展示文件链接，并由 IDE 宿主打开定位。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：不能用普通 http 或 https 链接表达本地文件定位。
 */
export interface InternalFileLink {
  /**
   * projectId: 所属项目 ID。
   */
  projectId: string;

  /**
   * absolutePath: 文件绝对路径。
   */
  absolutePath: string;

  /**
   * relativePath: 相对项目根目录路径。
   */
  relativePath: string;

  /**
   * startLine: 起始行号；未知时为 null。
   */
  startLine: number | null;

  /**
   * endLine: 结束行号；未知时为 null。
   */
  endLine: number | null;
}

/**
 * WebSocket 消息包。
 *
 * 来源：中心服务实时同步协议。
 * 含义：统一包装客户端和服务端之间的实时消息。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：type 使用固定协议名，payload 由具体事件类型定义。
 */
export interface WebSocketEnvelope<TPayload = unknown> {
  /**
   * type: WebSocket 消息类型。
   */
  type: string;

  /**
   * requestId: 请求/响应关联 ID。
   *
   * 来源：WebSocket-only 对话页协议。
   * 含义：客户端发起动作请求时生成，服务端响应时原样带回。
   * 格式：随机字符串；纯推送事件可以省略。
   * 默认值：无。
   * 约束：不能用 traceId 替代，traceId 只用于排查。
   */
  requestId?: string;

  /**
   * payload: 消息载荷。
   */
  payload: TPayload;

  /**
   * traceId: 可选排查 ID。
   */
  traceId?: string;
}

export {
  decodeInternalFileLink,
  encodeInternalFileLink,
  INTERNAL_FILE_LINK_PROTOCOL,
} from "./markdown.js";
