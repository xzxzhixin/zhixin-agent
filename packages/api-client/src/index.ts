import type {
  ApiResponse,
  AgentSubConversationDetail,
  ClientType,
  ConversationMessage,
  ConversationSession,
  ConversationTurn,
  DeleteProjectResult,
  EventRecord,
  ProjectRecord,
  SessionUpdatedPayload,
  SessionType,
  TaskRecord,
  TaskStatus,
  PendingEditDiff,
  PendingEditRecord,
  TokenizerCountResponse,
} from "@zhixin/shared";
export {ReconnectingWebSocketClient} from "./websocket-client";

export type {
  SessionUpdatedPayload,
};

/**
 * ProviderSettingsExtraJson：供应商设置扩展字段结构。
 *
 * 来源：中心服务 `model_provider_settings.extra_json`。
 * 含义：保存不影响模型调用主协议的 UI 候选数据。
 */
interface ProviderSettingsExtraJson {
  /** reasoningEfforts: 供应商刷新得到的推理深度候选值列表。 */
  reasoningEfforts: string[];
}

/**
 * parseProviderSettingsExtraJson：解析供应商设置扩展 JSON。
 *
 * @param value 中心服务返回的扩展 JSON 字符串。
 * @returns 规范化后的扩展设置；历史空值或非法值按空候选处理。
 */
export function parseProviderSettingsExtraJson(value: string): ProviderSettingsExtraJson {
  try {
    const parsed = JSON.parse(value);
    const reasoningEfforts = Array.isArray(parsed.reasoningEfforts)
      ? parsed.reasoningEfforts.filter((item: unknown): item is string => {
        return typeof item === "string" && item.trim().length > 0;
      })
      : [];
    return {
      reasoningEfforts,
    };
  } catch {
    return {
      reasoningEfforts: [],
    };
  }
}

/**
 * 中心服务客户端配置。
 *
 * 来源：前端能力适配层、桌面壳和 IDE 插件本地配置。
 * 含义：描述中心服务 REST 和 WebSocket 访问地址。
 * 格式：JSON 对象。
 * 默认值：baseUrl 由运行时按端口拼接。
 * 约束：IDE 插件必须固定 127.0.0.1，不使用远程账号密码。
 */
export interface CenterApiClientOptions {
  /**
   * baseUrl: 中心服务 HTTP 根地址，例如 http://127.0.0.1:8866。
   */
  baseUrl: string;
}

/**
 * 本机访问授权入参。
 *
 * 来源：`POST /api/access/authorize-local`。
 * 含义：客户端声明自身类型，由服务端结合来源地址判断是否允许本机授权。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：不能作为唯一授权依据。
 */
export interface AuthorizeLocalRequest {
  /**
   * clientType: 客户端类型，来源于运行时识别结果。
   */
  clientType: ClientType;

  /**
   * projectId: IDE 插件当前项目 ID；非项目端固定为空。
   */
  projectId?: string | null;
}

/**
 * 登录入参。
 *
 * 来源：远程 Web 登录页。
 * 含义：用户输入账号和密码，中心服务校验摘要。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：密码只通过 HTTPS 或本机可信网络传输，客户端不保存明文。
 */
export interface LoginRequest {
  /**
   * account: 远程 Web 访问账号。
   */
  account: string;

  /**
   * password: 远程 Web 访问密码明文，仅用于本次提交。
   */
  password: string;
}

/**
 * 访问授权响应。
 *
 * 来源：阶段 3 中心服务访问接口。
 * 含义：保存服务端识别的客户端身份和访问类型。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：客户端只展示和后续连接使用，不自行提升权限。
 */
export interface AccessAuthorizeResult {
  /**
   * clientId: 中心服务生成的同步客户端 ID。
   */
  clientId: string;

  /**
   * clientType: 已授权客户端类型。
   */
  clientType: ClientType;

  /**
   * accessKind: 服务端识别出的访问方式。
   */
  accessKind: "local" | "remote-web";

  /**
   * isLocalRequest: 服务端是否判定请求来自本机。
   */
  isLocalRequest: boolean;
}

/**
 * HealthResponse：中心服务健康检查响应。
 *
 * 来源：`GET /api/health`。
 * 含义：返回当前中心服务进程身份和时间边界。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：时间字段均使用中心服务本机时间字符串。
 */
export interface HealthResponse {
  /** appName: 应用中文名。 */
  appName: string;
  /** version: 中心服务版本。 */
  version: string;
  /** port: 当前中心服务端口。 */
  port: number;
  /** centerDirectory: 当前中心目录绝对路径。 */
  centerDirectory: string;
  /** processStartedAt: 当前中心服务进程启动时间。 */
  processStartedAt: string;
  /** now: 当前健康检查时间。 */
  now: string;
}

/**
 * 会话详情响应。
 *
 * 来源：`POST /api/session/detail`。
 * 含义：一次返回会话、消息、轮次和任务。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：所有事实来自中心服务。
 */
export interface SessionDetailResult {
  /**
   * session: 会话基础信息。
   */
  session: ConversationSession;

  /**
   * messages: 会话消息列表。
   */
  messages: ConversationMessage[];

  /**
   * turns: 会话轮次列表。
   */
  turns: ConversationTurn[];

  /**
   * tasks: 会话任务列表。
   */
  tasks: TaskRecord[];

  /**
   * taskSteps: 会话任务步骤列表，来源于中心服务 `task_steps` 表。
   */
  taskSteps: TaskStepRecordView[];

  /**
   * tokenUsage: 当前主智能体窗口 token 用量快照，来源于中心服务数据库；无记录时为 null。
   */
  tokenUsage: ConversationTokenUsageView | null;

  /**
   * lastAssistantMessageCreatedAt: 最近助手回复创建时间，用于对比轮次时间和最后回复时间。
   */
  lastAssistantMessageCreatedAt: string | null;
}

/**
 * ConversationTokenUsageView：当前会话窗口 token 用量展示快照。
 *
 * 来源：中心服务 `conversation_token_usage` 表。
 * 含义：用于打开会话后恢复输入区上下文 token 用量。
 * 格式：JSON 对象。
 * 默认值：无快照时为 null。
 * 约束：只表示当前窗口总览，不替代模型调用 usage_records。
 */
export interface ConversationTokenUsageView {
  /** sessionId: 所属会话 ID。 */
  sessionId: string;
  /** turnId: 最近一次统计关联的轮次 ID；没有轮次时为 null。 */
  turnId: string | null;
  /** agentId: 所属智能体 ID，主智能体固定为 main。 */
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
}

/**
 * TaskStepRecordView：任务步骤展示结构。
 *
 * 来源：中心服务 `POST /api/session/detail`。
 * 含义：让前端任务详情弹框展示编排步骤、耗时、失败原因和排查线索。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：只使用中心服务返回字段，不在前端推断步骤。
 */
export interface TaskStepRecordView {
  /** stepId: 任务步骤 ID。 */
  stepId: string;
  /** taskId: 所属任务 ID。 */
  taskId: string;
  /** planVersion: 步骤所属计划版本，来源于中心服务 task_steps.plan_version。 */
  planVersion: number;
  /** stepOrder: 同一任务内步骤顺序，来源于中心服务 task_steps.step_order。 */
  stepOrder: number;
  /** source: 步骤来源，graph 表示内部图节点，todoList/model/user/system 表示可见拆解来源。 */
  source: "graph" | "model" | "todoList" | "user" | "system";
  /** status: 步骤状态。 */
  status: TaskStatus;
  /** title: 步骤标题。 */
  title: string;
  /** dependsOn: 依赖步骤 ID 列表。 */
  dependsOn: string[];
  /** acceptance: 步骤完成验收口径。 */
  acceptance: string | null;
  /** startedAt: 步骤开始时间，中心服务本机时间字符串或 null。 */
  startedAt: string | null;
  /** endedAt: 步骤结束时间，中心服务本机时间字符串或 null。 */
  endedAt: string | null;
  /** summary: 步骤摘要、失败原因或排查信息。 */
  summary: string | null;
  /** supersededBy: 替换当前步骤的新步骤 ID，未替换时为 null。 */
  supersededBy: string | null;
  /** supersededReason: 当前步骤被替换的原因，未替换时为 null。 */
  supersededReason: string | null;
}

/**
 * DeleteSessionResult：会话删除结果。
 *
 * 来源：`POST /api/session/delete`。
 * 含义：中心服务确认指定会话已从当前会话事实表删除。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：deleted 为 true 时前端必须刷新列表和当前选中会话，不能只做本地移除。
 */
export interface DeleteSessionResult {
  /**
   * sessionId: 已删除会话 ID。
   */
  sessionId: string;

  /**
   * deleted: 是否删除成功。
   */
  deleted: boolean;
}

/**
 * TemporaryAttachmentResult：临时附件创建结果。
 *
 * 来源：`POST /api/file/temp/create`。
 * 含义：中心服务在 temp 目录中创建的未发送附件占位记录。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：发送消息后必须再调用正式附件提交接口绑定到消息。
 */
export interface TemporaryAttachmentResult {
  /**
   * temporaryAttachmentId: 临时附件 ID，来源于中心服务生成。
   */
  temporaryAttachmentId: string;

  /**
   * relativePath: 临时附件相对中心目录路径，位于 temp/{temporaryAttachmentId}/。
   */
  relativePath: string;
}

/**
 * CommittedAttachmentResult：正式附件提交结果。
 *
 * 来源：`POST /api/session/attachment/commit`。
 * 含义：中心服务把临时附件移动为正式归档附件后的元数据。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：archivePath 位于 memory/attachments，relativePath 是兼容字段且等同于 archivePath。
 */
export interface CommittedAttachmentResult {
  /**
   * attachmentId: 正式附件 ID，来源于中心服务生成。
   */
  attachmentId: string;

  /**
   * relativePath: 兼容字段，等同于 archivePath。
   */
  relativePath: string;

  /**
   * archivePath: 归档附件相对中心目录路径，位于 memory/attachments。
   */
  archivePath: string;
}

/**
 * ProviderCapabilityDeclaration：供应商模型能力声明。
 *
 * 来源：中心服务模型协议配置协议。
 * 含义：描述供应商配置声明的模型能力开关。
 * 格式：布尔字段对象。
 * 默认值：创建表单默认全部 false。
 * 约束：前端只提交明确字段，不猜测能力。
 */
export interface ProviderCapabilityDeclaration {
  /** supportsVision: 是否支持图片输入。 */
  supportsVision: boolean;
  /** supportsToolCalling: 是否支持工具调用。 */
  supportsToolCalling: boolean;
  /** supportsJsonOutput: 是否支持 JSON 输出。 */
  supportsJsonOutput: boolean;
  /** supportsReasoningEffort: 是否支持推理深度。 */
  supportsReasoningEffort: boolean;
  /** providesCacheUsage: 是否提供缓存用量字段。 */
  providesCacheUsage: boolean;
  /** supportsModelList: 是否支持模型列表接口。 */
  supportsModelList: boolean;
  /** supportsStreaming: 是否支持流式输出。 */
  supportsStreaming: boolean;
  /** responsesSupported: 是否支持 OpenAI Responses 接口。 */
  responsesSupported: boolean;
  /** chatCompletionsSupported: 是否支持 OpenAI Chat Completions 接口。 */
  chatCompletionsSupported: boolean;
  /** responsesStreamSupported: 是否支持 Responses 流式事件。 */
  responsesStreamSupported: boolean;
  /** chatCompletionsStreamSupported: 是否支持 Chat Completions 流式事件。 */
  chatCompletionsStreamSupported: boolean;
  /** streamToolCallsSupported: 是否支持流式工具调用。 */
  streamToolCallsSupported: boolean;
  /** selectedRuntimeMode: 自动探测选择的运行时模式。 */
  selectedRuntimeMode: "responses" | "chat_completions_to_responses" | null;
  /** lastTestStatus: 最近探测状态。 */
  lastTestStatus: "passed" | "failed" | null;
  /** lastTestMessage: 最近探测摘要。 */
  lastTestMessage: string | null;
  /** lastTestedAt: 最近探测时间。 */
  lastTestedAt: string | null;
}

/** ModelProtocol：模型协议稳定值，由中心服务映射到 LangChain 模型协议能力。 */
export type ModelProtocol =
  | "openai"
  | "anthropic";

/**
 * ModelProtocolOption：模型协议下拉选项。
 *
 * 来源：`POST /api/model-provider/protocol-options`。
 * 含义：供应商页只展示模型协议，不暴露底层 SDK 或适配实现。
 */
export interface ModelProtocolOption {
  /** modelProtocol: 模型协议稳定值，仅允许 openai 或 anthropic。 */
  modelProtocol: ModelProtocol;
  /** label: 模型协议展示名。 */
  label: string;
  /** description: 模型协议说明。 */
  description: string;
  /** defaultBaseUrl: 默认接口地址，没有默认值时为 null。 */
  defaultBaseUrl: string | null;
  /** defaultCapabilities: 当前协议推荐的默认能力声明。 */
  defaultCapabilities: ProviderCapabilityDeclaration;
}

/**
 * ModelProviderCapabilityView：数据库化模型供应商能力声明。
 *
 * 来源：`model_provider_capabilities` 表。
 * 含义：展示和编辑供应商能力开关。
 * 约束：字段只表达业务能力，不包含底层实现包信息。
 */
export interface ModelProviderCapabilityView extends ProviderCapabilityDeclaration {
  /** providerId: 所属供应商 ID。 */
  providerId: string;
  /** updatedAt: 更新时间，中心服务本机时间字符串。 */
  updatedAt: string;
}

/**
 * ModelProviderSettingsView：数据库化模型供应商默认调用设置。
 *
 * 来源：`model_provider_settings` 表。
 * 含义：保存默认模型、推理深度和后续运行时参数。
 */
export interface ModelProviderSettingsView {
  /** providerId: 所属供应商 ID。 */
  providerId: string;
  /** defaultModelName: 默认模型名称。 */
  defaultModelName: string | null;
  /** reasoningEffort: 推理深度。 */
  reasoningEffort: string | null;
  /** temperature: 温度参数。 */
  temperature: number | null;
  /** maxOutputTokens: 最大输出 token。 */
  maxOutputTokens: number | null;
  /** extraJson: 额外业务设置 JSON 字符串。 */
  extraJson: string;
  /** updatedAt: 更新时间，中心服务本机时间字符串。 */
  updatedAt: string;
}

/**
 * ModelProviderModelView：数据库化模型列表项。
 *
 * 来源：`model_provider_models` 表。
 * 含义：作为模型下拉和上下文窗口配置事实源。
 */
export interface ModelProviderModelView {
  /** modelId: 模型记录 ID。 */
  modelId: string;
  /** providerId: 所属供应商 ID。 */
  providerId: string;
  /** modelName: 供应商模型真实名称。 */
  modelName: string;
  /** displayName: UI 展示名。 */
  displayName: string;
  /** contextWindowTokens: 上下文窗口 token 数，未知时为 null。 */
  contextWindowTokens: number | null;
  /** enabled: 是否启用该模型。 */
  enabled: boolean;
  /** sortOrder: 排序值。 */
  sortOrder: number;
  /** createdAt: 创建时间，中心服务本机时间字符串。 */
  createdAt: string;
  /** updatedAt: 更新时间，中心服务本机时间字符串。 */
  updatedAt: string;
}

/**
 * ProviderProxyPolicy：供应商代理策略。
 *
 * 来源：中心服务供应商配置协议。
 * 含义：决定供应商请求是否使用代理。
 * 格式：mode + proxyId。
 * 默认值：use-global-default。
 * 约束：proxyId 仅在 use-specified 时有业务意义。
 */
export interface ProviderProxyPolicy {
  /** mode: 代理策略模式。 */
  mode: "none" | "use-global-default" | "use-specified";
  /** proxyId: 指定代理 ID，未指定时为 null。 */
  proxyId: string | null;
}

/**
 * ProviderConfigView：供应商列表展示结构。
 *
 * 来源：`POST /api/model-provider/list`。
 * 含义：客户端可展示和编辑的供应商配置摘要。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：不包含 API Key 明文或摘要字段。
 */
export interface ProviderConfigView {
  /** providerId: 供应商 ID。 */
  providerId: string;
  /** providerName: 供应商名称。 */
  providerName: string;
  /** modelProtocol: 模型协议稳定值。 */
  modelProtocol: ModelProtocol;
  /** modelProtocolLabel: 模型协议展示名，来源于中心服务协议注册表。 */
  modelProtocolLabel: string;
  /** apiBaseUrl: 供应商接口地址。 */
  apiBaseUrl: string | null;
  /** customHeadersJson: 自定义请求头 JSON 文本。 */
  customHeadersJson: string;
  /** proxyMode: 代理策略模式。 */
  proxyMode: ProviderProxyPolicy["mode"];
  /** proxyId: 指定代理 ID，未指定时为 null。 */
  proxyId: string | null;
  /** enabled: 是否启用。 */
  enabled: boolean;
  /** hasApiKey: 是否已保存 API Key。 */
  hasApiKey: boolean;
  /** createdAt: 创建时间，中心服务本机时间字符串。 */
  createdAt: string;
  /** updatedAt: 更新时间。 */
  updatedAt: string;
  /** settings: 默认调用设置。 */
  settings: ModelProviderSettingsView;
  /** defaultModel: 默认模型兼容展示字段，来源于 settings.defaultModelName。 */
  defaultModel: string;
  /** capabilities: 能力声明。 */
  capabilities: ModelProviderCapabilityView;
  /** models: 模型列表。 */
  models: ModelProviderModelView[];
  /** latestCheck: 最近检测结果；没有检测记录时为 null。 */
  latestCheck: ModelProviderCheckView | null;
  /** proxyPolicy: 代理策略兼容对象，来源于 proxyMode 和 proxyId。 */
  proxyPolicy: ProviderProxyPolicy;
}

/**
 * ModelProviderCheckView：模型协议检测结果。
 *
 * 来源：`model_provider_checks` 表或检测接口返回。
 * 含义：用于列表展示最近一次检测状态和失败原因。
 */
export interface ModelProviderCheckView {
  /** checkId: 检测记录 ID。 */
  checkId: string;
  /** providerId: 所属供应商 ID。 */
  providerId: string;
  /** checkType: 检测类型。 */
  checkType: string;
  /** status: 检测状态。 */
  status: "passed" | "failed";
  /** errorMessage: 检测失败原因，成功时为 null。 */
  errorMessage: string | null;
  /** checkedAt: 检测时间，中心服务本机时间字符串。 */
  checkedAt: string;
}

/**
 * CreateModelProviderPayload：新增数据库化模型供应商入参。
 *
 * 来源：供应商管理页表单。
 * 含义：提交模型协议、连接信息、默认设置和能力声明。
 */
export interface CreateModelProviderPayload {
  /** providerName: 供应商名称。 */
  providerName: string;
  /** modelProtocol: 模型协议。 */
  modelProtocol: ModelProtocol;
  /** apiBaseUrl: 接口基础地址。 */
  apiBaseUrl?: string | null;
  /** apiKey: 新 API Key 明文，仅用于本次保存。 */
  apiKey?: string;
  /** customHeadersJson: 自定义请求头 JSON 对象字符串。 */
  customHeadersJson: string;
  /** proxyMode: 代理策略模式。 */
  proxyMode: ProviderProxyPolicy["mode"];
  /** proxyId: 指定代理 ID。 */
  proxyId?: string | null;
  /** enabled: 是否启用。 */
  enabled: boolean;
  /** defaultModelName: 默认模型名称。 */
  defaultModelName?: string | null;
  /** reasoningEffort: 推理深度。 */
  reasoningEffort?: string | null;
  /** temperature: 温度参数。 */
  temperature?: number | null;
  /** maxOutputTokens: 最大输出 token。 */
  maxOutputTokens?: number | null;
  /** extraJson: 额外业务设置 JSON 对象字符串。 */
  extraJson?: string;
  /** capabilities: 能力声明。 */
  capabilities: ProviderCapabilityDeclaration;
}

/**
 * UpdateModelProviderPayload：更新数据库化模型供应商入参。
 *
 * 来源：供应商管理页编辑表单。
 * 含义：只提交需要修改的字段。
 */
export interface UpdateModelProviderPayload extends Partial<CreateModelProviderPayload> {
  /** providerId: 要更新的供应商 ID。 */
  providerId: string;
  /** clearApiKey: 是否清空已保存 API Key。 */
  clearApiKey?: boolean;
}

/**
 * SaveModelProviderModelsPayload：保存供应商模型列表入参。
 *
 * 来源：手填模型与上下文区域。
 * 含义：把模型下拉事实源保存到 SQLite。
 */
export interface SaveModelProviderModelsPayload {
  /** providerId: 所属供应商 ID。 */
  providerId: string;
  /** defaultModelName: 保存后同步使用的默认模型。 */
  defaultModelName?: string | null;
  /** reasoningEfforts: 供应商可选推理深度列表，只作为下拉候选保存。 */
  reasoningEfforts?: string[];
  /** models: 模型列表。 */
  models: Array<{
    /** modelName: 模型真实名称。 */
    modelName: string;
    /** displayName: UI 展示名。 */
    displayName: string;
    /** contextWindowTokens: 上下文窗口 token 数。 */
    contextWindowTokens: number | null;
    /** enabled: 是否启用该模型。 */
    enabled: boolean;
    /** sortOrder: 排序值。 */
    sortOrder: number;
  }>;
}

/**
 * ProviderModelListView：供应商模型列表展示结构。
 *
 * 来源：模型协议供应商详情。
 * 含义：返回中心服务已保存或刷新得到的模型与推理深度列表。
 * 格式：JSON 对象。
 * 默认值：未刷新时 models 和 reasoningEfforts 为空数组。
 * 约束：只读取中心服务保存结果，不由客户端猜测模型名。
 */
export interface ProviderModelListView {
  /** providerId: 供应商 ID。 */
  providerId: string;
  /** models: 供应商提供或用户手动刷新保存的模型名称列表。 */
  models: string[];
  /** contextWindows: 模型上下文窗口配置，单位为 token。 */
  contextWindows: Array<{
    /** model: 模型名称，必须来自 models。 */
    model: string;
    /** contextWindowTokens: 模型上下文窗口上限，单位为 token。 */
    contextWindowTokens: number;
  }>;
  /** reasoningEfforts: 供应商提供或用户手动刷新保存的推理深度列表。 */
  reasoningEfforts: string[];
  /** updatedAt: 模型列表保存时间，未保存时为 null。 */
  updatedAt: string | null;
}

/**
 * ProxyConfigView：代理列表展示结构。
 *
 * 来源：`POST /api/proxy/list`。
 * 含义：客户端可展示和编辑的代理配置摘要。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：不包含代理密码明文或摘要字段。
 */
export interface ProxyConfigView {
  /** proxyId: 代理 ID。 */
  proxyId: string;
  /** proxyName: 代理名称。 */
  proxyName: string;
  /** protocol: 代理协议。 */
  protocol: string;
  /** host: 代理主机。 */
  host: string;
  /** port: 代理端口。 */
  port: number;
  /** username: 代理用户名，空字符串表示无认证。 */
  username: string;
  /** enabled: 是否启用。 */
  enabled: boolean;
  /** hasAuth: 是否配置认证。 */
  hasAuth: boolean;
  /** note: 代理备注。 */
  note: string;
  /** updatedAt: 更新时间。 */
  updatedAt: string;
}

/**
 * RuntimeConfigView：运行环境列表展示结构。
 *
 * 来源：`POST /api/runtime/list`。
 * 含义：客户端可展示和编辑的运行环境配置。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：同一 runtimeType 默认项由中心服务保持唯一。
 */
export interface RuntimeConfigView {
  /** runtimeId: 运行环境 ID。 */
  runtimeId: string;
  /** runtimeName: 环境名称。 */
  runtimeName: string;
  /** runtimeType: 环境类型。 */
  runtimeType: string;
  /** executablePath: 可执行文件路径。 */
  executablePath: string;
  /** rootPath: 根目录路径。 */
  rootPath: string;
  /** version: 版本号。 */
  version: string;
  /** environmentVariables: 追加环境变量。 */
  environmentVariables: Record<string, string>;
  /** pathEntries: PATH 追加目录。 */
  pathEntries: string[];
  /** isDefault: 是否默认环境。 */
  isDefault: boolean;
  /** enabled: 是否启用。 */
  enabled: boolean;
  /** note: 备注。 */
  note: string;
  /** updatedAt: 更新时间。 */
  updatedAt: string;
}

/**
 * UsageFilters：用量统计筛选条件。
 *
 * 来源：用量统计页面。
 * 含义：按供应商、模型、项目/会话和时间范围筛选。
 * 格式：空字符串在前端提交前转为 null。
 * 默认值：全部 null。
 * 约束：字段名与中心服务接口一致。
 */
export interface UsageFilters {
  /** providerId: 供应商 ID。 */
  providerId: string | null;
  /** providerName: 供应商名称，来源于中心目录供应商配置 providerName。 */
  providerName: string | null;
  /** model: 模型名称。 */
  model: string | null;
  /** modelName: 模型名称筛选展示字段，和 model 使用同一 usage_records.model 来源。 */
  modelName: string | null;
  /** projectId: 项目 ID。 */
  projectId: string | null;
  /** projectName: 项目文件夹主名称，来源于 projects.display_name。 */
  projectName: string | null;
  /** sessionId: 会话 ID。 */
  sessionId: string | null;
  /** startedAt: 开始时间 ISO 字符串。 */
  startedAt: string | null;
  /** endedAt: 结束时间 ISO 字符串。 */
  endedAt: string | null;
}

/**
 * PluginConfigView：插件管理列表展示结构。
 *
 * 来源：`POST /api/plugin/list`。
 * 含义：中心服务已登记插件的清单、来源、作用域和启用状态。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：manifestJson 保留中心服务持久化的清单 JSON 文本，不包含额外候选协议。
 */
export interface PluginConfigView {
  /** pluginId: 插件安装 ID。 */
  pluginId: string;
  /** source: 插件来源，来自插件清单 source 字段。 */
  source: string;
  /** scope: 插件适用范围，来自插件清单 scope 字段。 */
  scope: string;
  /** projectId: 项目级插件所属项目 ID，来自插件清单 projectId；全局插件为 null。 */
  projectId: string | null;
  /** enabled: 是否启用，来源于中心服务 plugin_installs 表。 */
  enabled: boolean;
  /** manifestJson: 插件清单 JSON 文本，来源于中心服务持久化字段。 */
  manifestJson: string;
  /** updatedAt: 更新时间 ISO 字符串。 */
  updatedAt: string;
}

/**
 * McpConfigView：MCP 配置列表展示结构。
 *
 * 来源：`POST /api/mcp/list`。
 * 含义：展示全局 MCP JSON 配置中的单个 MCP Server 行。
 * 格式：根字段固定为 mcpServers。
 * 默认值：没有配置时由中心服务返回空对象。
 * 约束：页面编辑框使用完整 `{"mcpServers":{"服务 ID":{...}}}`，保存前抽取唯一 serverId 和 serverConfig。
 */
export interface McpConfigView {
  /** scope: 配置来源，当前全局管理页只展示 global。 */
  scope: "global" | "project";
  /** projectId: 项目级配置 ID，全局配置为 null。 */
  projectId: string | null;
  /** relativePath: 配置文件相对中心目录路径。 */
  relativePath: string;
  /** mcpServers: 当前配置文件完整 MCP Server 配置对象，只用于兼容旧保存入口和调试。 */
  mcpServers: Record<string, unknown>;
  /** serverId: 当前行对应的 MCP Server ID，来自 mcpServers 对象 key。 */
  serverId: string;
  /** serverConfig: 当前行对应的单个 MCP Server 原始配置，不包含工具发现结果。 */
  serverConfig: unknown;
  /** transportType: 当前行 MCP Server 配置声明的传输类型。 */
  transportType: string;
  /** updatedAt: 更新时间 ISO 字符串，文件缺失时为 null。 */
  updatedAt: string | null;
}

/**
 * McpToolView：MCP 管理页工具展示结构。
 *
 * 来源：中心服务读取 MCP 配置后调用 tools/list 得到。
 * 含义：用于展示 HTTP 或 stdio MCP Server 当前暴露的工具。
 * 格式：serverId、transportType、toolName、description 和错误信息。
 * 默认值：无工具时为空数组。
 * 约束：不包含敏感 env、认证头或完整参数值。
 */
export interface McpToolView {
  /** serverId: MCP Server ID，来自 mcpServers 对象 key。 */
  serverId: string;
  /** transportType: MCP 传输协议类型。 */
  transportType: "http" | "stdio";
  /** toolName: MCP Server 暴露的工具名称。 */
  toolName: string;
  /** description: MCP Server 返回的工具说明。 */
  description: string;
  /** inputSchema: 工具参数 schema，用于展示和模型工具定义。 */
  inputSchema: Record<string, unknown>;
  /** errorMessage: 工具发现失败时的错误摘要；成功时为 null。 */
  errorMessage: string | null;
}

/**
 * SkillConfigView：skill 管理列表展示结构。
 *
 * 来源：`POST /api/skill/list`。
 * 含义：展示中心目录中已安装的全局或项目级 skill。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：content 为 SKILL.md 当前内容，不读取其他任意文件。
 */
export interface SkillConfigView {
  /** skillName: skill 目录名称。 */
  skillName: string;
  /** scope: 安装作用域，global 或 project。 */
  scope: "global" | "project";
  /** projectId: 项目级 skill 所属项目 ID，全局为 null。 */
  projectId: string | null;
  /** relativePath: SKILL.md 相对中心目录路径。 */
  relativePath: string;
  /** content: SKILL.md 文本内容。 */
  content: string;
}

/**
 * AgentConfigView：智能体管理列表展示结构。
 *
 * 来源：`POST /api/agent/list`。
 * 含义：展示中心服务已固化的主智能体和长期智能体定义摘要。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：子智能体不在该接口固化，仍来自运行期事件或前端单一临时状态树。
 */
export interface AgentConfigView {
  /** agentId: 智能体 ID，主智能体固定为 main。 */
  agentId: string;
  /** name: 智能体展示名称。 */
  name: string;
  /** enabled: 是否启用。 */
  enabled: boolean;
  /** roleDescription: 角色说明。 */
  roleDescription: string;
  /** capabilityBoundary: 中心服务兼容旧定义文件的动态能力说明；前端不再编辑。 */
  capabilityBoundary: string;
  /** defaultProviderId: 默认供应商 ID，没有配置时为 null。 */
  defaultProviderId: string | null;
  /** defaultModel: 默认模型，没有配置时为空字符串。 */
  defaultModel: string;
  /** reasoningEffort: 推理深度配置。 */
  reasoningEffort: string;
  /** memoryIndexPath: 智能体记忆索引路径。 */
  memoryIndexPath: string;
  /** createdBy: 创建来源。 */
  createdBy: string;
  /** definitionPath: Markdown 定义文件路径。 */
  definitionPath: string;
  /** updatedAt: 更新时间 ISO 字符串。 */
  updatedAt: string;
}

/**
 * AgentActionResult：智能体管理动作结果。
 *
 * 来源：`POST /api/agent/create`、`POST /api/agent/update`、`POST /api/agent/disable`、`POST /api/agent/delete`。
 * 含义：展示长期智能体管理动作的统一结果。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：前端必须依赖中心服务返回值刷新列表，不得本地猜测删除或停用结果。
 */
export interface AgentActionResult {
  /** agentId: 受影响的智能体 ID。 */
  agentId: string;
  /** updated: 是否更新成功。 */
  updated?: boolean;
  /** deleted: 是否删除成功。 */
  deleted?: boolean;
  /** enabled: 删除或停用后的启用状态。 */
  enabled?: boolean;
  /** archiveMemory: 删除或停用时是否归档专属记忆。 */
  archiveMemory?: boolean;
}

/**
 * CenterApiClient：中心服务 REST 客户端。
 *
 * 用途：让前端、桌面壳和 IDE 插件通过统一方法访问中心服务。
 * 关键逻辑：所有 POST 都走统一响应包解析，业务错误直接抛出带错误码的异常。
 */
export class CenterApiClient {
  /**
   * baseUrl: 中心服务 HTTP 根地址。
   */
  private readonly baseUrl: string;

  /**
   * constructor：保存客户端配置。
   *
   * @param options 中心服务客户端配置。
   */
  constructor(options: CenterApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/u, "");
  }

  /**
   * authorizeLocal：申请本机访问授权。
   *
   * @param payload 客户端类型声明。
   * @returns 授权结果。
   */
  authorizeLocal(payload: AuthorizeLocalRequest): Promise<AccessAuthorizeResult> {
    return this.post("/api/access/authorize-local", payload);
  }

  /**
   * login：远程 Web 登录。
   *
   * @param payload 登录账号和密码。
   * @returns 登录授权结果。
   */
  login(payload: LoginRequest): Promise<AccessAuthorizeResult> {
    return this.post("/api/auth/login", payload);
  }

  /**
   * health：读取中心服务健康信息。
   *
   * @returns 健康检查结果。
   */
  health(): Promise<HealthResponse> {
    return this.get("/api/health");
  }

  /**
   * registerProject：登记或更新项目。
   *
   * @param payload 项目登记信息。
   * @returns 项目记录。
   */
  registerProject(payload: {
    projectId: string;
    displayName: string;
    latestPath: string;
  }): Promise<ProjectRecord> {
    return this.post("/api/project/register", payload);
  }

  /**
   * listProjects：查询中心服务已登记项目列表。
   *
   * @returns 项目列表。
   */
  listProjects(): Promise<{
    projects: ProjectRecord[];
  }> {
    return this.post("/api/project/list", {});
  }

  /**
   * createSession：创建普通或项目会话。
   *
   * @param payload 会话创建参数。
   * @returns 新建会话记录。
   */
  createSession(payload: {
    sessionType: SessionType;
    projectId: string | null;
    title: string;
  }): Promise<ConversationSession> {
    return this.post("/api/session/create", payload);
  }

  /**
   * listSessions：查询会话列表。
   *
   * @param payload 会话筛选条件。
   * @returns 会话列表。
   */
  listSessions(payload: {
    sessionType?: SessionType;
    projectId?: string | null;
  }): Promise<{
    sessions: ConversationSession[];
  }> {
    return this.post("/api/session/list", payload);
  }

  /**
   * getSessionDetail：查询会话详情。
   *
   * @param payload 会话 ID。
   * @returns 会话详情。
   */
  getSessionDetail(payload: {
    sessionId: string;
  }): Promise<SessionDetailResult> {
    return this.post("/api/session/detail", payload);
  }

  /**
   * deleteSession：删除指定会话。
   *
   * @param payload 会话 ID。
   * @returns 删除结果。
   */
  deleteSession(payload: {
    sessionId: string;
  }): Promise<DeleteSessionResult> {
    return this.post("/api/session/delete", payload);
  }

  /**
   * deleteProject：删除中心服务中的项目索引及其项目会话事实。
   *
   * @param payload 项目 ID。
   * @returns 删除结果。
   */
  deleteProject(payload: {
    projectId: string;
  }): Promise<DeleteProjectResult> {
    return this.post("/api/project/delete", payload);
  }

  /**
   * sendMessage：发送用户消息。
   *
   * @param payload 会话 ID 和 Markdown 内容。
   * @returns 消息、轮次和任务身份。
   */
  sendMessage(payload: {
    sessionId: string;
    contentMarkdown: string;
  }): Promise<{
    /** sessionId: 中心服务确认的当前会话 ID。 */
    sessionId: string;
    messageId: string;
    turnId: string;
    taskId: string;
  }> {
    return this.post("/api/session/message/send", payload);
  }

  /** getAgentSubConversation：按主会话和 agentId 读取独立子对话，参数来自当前窗口智能体节点，返回中心服务事实消息。 */
  getAgentSubConversation(payload: { parentSessionId: string; agentId: string; agentName: string; }): Promise<AgentSubConversationDetail> {
    return this.post("/api/agent-sub-conversation/detail", payload);
  }

  /** sendAgentSubConversationMessage：向智能体子对话写入真实消息，参数来自弹框草稿，返回更新后的子对话。 */
  sendAgentSubConversationMessage(payload: { parentSessionId: string; agentId: string; agentName: string; contentMarkdown: string; }): Promise<AgentSubConversationDetail> {
    return this.post("/api/agent-sub-conversation/message/send", payload);
  }

  /** listPendingEdits：按会话 ID 查询待确认编辑记录，返回可保存、撤回和对比的真实文件编辑列表。 */
  listPendingEdits(payload: { sessionId: string; }): Promise<{
    edits: PendingEditRecord[];
  }> {
    return this.post("/api/edit-pending/list", payload);
  }

  /** savePendingEdit：按 editId 确认接受已写入文件的编辑，返回更新后的编辑状态。 */
  savePendingEdit(payload: { editId: string; }): Promise<{
    edit: PendingEditRecord;
  }> {
    return this.post("/api/edit-pending/save", payload);
  }

  /** saveAllPendingEdits：按 sessionId 确认接受当前会话全部待确认编辑，返回更新后的编辑列表。 */
  saveAllPendingEdits(payload: { sessionId: string; }): Promise<{
    edits: PendingEditRecord[];
  }> {
    return this.post("/api/edit-pending/save-all", payload);
  }

  /** revertPendingEdit：按 editId 恢复编辑前内容，中心服务会做当前文件内容冲突判断。 */
  revertPendingEdit(payload: { editId: string; }): Promise<{
    edit: PendingEditRecord;
  }> {
    return this.post("/api/edit-pending/revert", payload);
  }

  /** revertAllPendingEdits：按 sessionId 撤回当前会话全部待确认编辑，返回成功撤回的编辑列表。 */
  revertAllPendingEdits(payload: { sessionId: string; }): Promise<{
    edits: PendingEditRecord[];
  }> {
    return this.post("/api/edit-pending/revert-all", payload);
  }

  /** getPendingEditDiff：按 editId 读取 before/after 和统一 diff，供 Web 与 IDE diff 使用。 */
  getPendingEditDiff(payload: { editId: string; }): Promise<PendingEditDiff> {
    return this.post("/api/edit-pending/diff", payload);
  }

  /**
   * createTemporaryAttachment：为剪贴板或拖入文件创建临时附件。
   *
   * @param payload 文件名、MIME 类型、字节数和可选文件对象。
   * @returns 临时附件元数据。
   */
  createTemporaryAttachment(payload: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    file?: File;
  }): Promise<TemporaryAttachmentResult> {
    // 当前中心服务临时接口只消费元数据，二进制上传协议接入前不伪造文件上传。
    return this.post("/api/file/temp/create", {
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
    });
  }

  /**
   * commitAttachment：把临时附件绑定到已经发送的消息。
   *
   * @param payload 会话、消息和临时附件元数据。
   * @returns 正式附件元数据。
   */
  commitAttachment(payload: {
    sessionId: string;
    messageId: string;
    temporaryAttachmentId: string;
    temporaryRelativePath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<CommittedAttachmentResult> {
    return this.post("/api/session/attachment/commit", payload);
  }

  /**
   * listEvents：查询断线补齐事件。
   *
   * @param payload 事件筛选条件。
   * @returns 事件列表。
   */
  listEvents(payload: {
    sessionId: string | null;
    turnId: string | null;
    afterSequence: number;
  }): Promise<{
    events: EventRecord[];
  }> {
    return this.post("/api/session/event/list", payload);
  }

  /**
   * saveNotificationConfig：保存客户端通知配置。
   *
   * @param payload 通知配置和系统权限状态。
   * @returns 保存后的通知配置摘要。
   */
  saveNotificationConfig(payload: {
    clientType: ClientType;
    enabled: boolean;
    notifyOnFailure: boolean;
    notifyOnWaitingUser: boolean;
    systemPermission: string;
  }): Promise<{
    clientType: ClientType;
    enabled: boolean;
  }> {
    return this.post("/api/notification/config/set", payload);
  }

  /**
   * listModelProviders：查询模型协议供应商列表。
   *
   * @returns 供应商列表。
   */
  listModelProviders(): Promise<{
    providers: ProviderConfigView[];
  }> {
    return this.post("/api/model-provider/list", {});
  }

  /**
   * listProviders：兼容既有前端供应商列表调用。
   *
   * @returns 供应商列表。
   */
  listProviders(): Promise<{
    providers: ProviderConfigView[];
  }> {
    return this.listModelProviders();
  }

  /**
   * listModelProtocolOptions：查询模型协议下拉选项。
   *
   * @returns 模型协议选项。
   */
  listModelProtocolOptions(): Promise<{
    modelProtocolOptions: ModelProtocolOption[];
  }> {
    return this.post("/api/model-provider/protocol-options", {});
  }

  /**
   * createModelProvider：新增模型协议供应商配置。
   *
   * @param payload 供应商配置表单。
   * @returns 新建供应商 ID 和密钥状态。
   */
  createModelProvider(payload: CreateModelProviderPayload): Promise<{
    provider: ProviderConfigView;
  }> {
    return this.post("/api/model-provider/create", payload);
  }

  /**
   * updateModelProvider：修改模型协议供应商配置。
   *
   * @param payload 供应商更新字段。
   * @returns 更新结果。
   */
  updateModelProvider(payload: UpdateModelProviderPayload): Promise<{
    provider: ProviderConfigView;
  }> {
    return this.post("/api/model-provider/update", payload);
  }

  /**
   * createAgent：创建长期智能体。
   *
   * @param payload 长期智能体字段。
   * @returns 创建结果。
   */
  createAgent(payload: {
    name: string;
    roleDescription: string;
    defaultProviderId?: string | null;
    defaultModel?: string | null;
    reasoningEffort?: string | null;
  }): Promise<AgentActionResult> {
    return this.post("/api/agent/create", payload);
  }

  /**
   * updateAgent：更新长期智能体。
   *
   * @param payload 智能体更新字段。
   * @returns 更新结果。
   */
  updateAgent(payload: {
    agentId: string;
    name?: string;
    roleDescription?: string;
    defaultProviderId?: string | null;
    defaultModel?: string | null;
    reasoningEffort?: string | null;
  }): Promise<AgentActionResult> {
    return this.post("/api/agent/update", payload);
  }

  /**
   * disableAgent：停用长期智能体。
   *
   * @param payload 智能体 ID 和影响确认。
   * @returns 停用结果。
   */
  disableAgent(payload: {
    agentId: string;
    archiveMemory: boolean;
    impactAccepted: boolean;
  }): Promise<AgentActionResult> {
    return this.post("/api/agent/disable", payload);
  }

  /**
   * deleteAgent：删除长期智能体。
   *
   * @param payload 智能体 ID 和影响确认。
   * @returns 删除结果。
   */
  deleteAgent(payload: {
    agentId: string;
    archiveMemory: boolean;
    impactAccepted: boolean;
  }): Promise<AgentActionResult> {
    return this.post("/api/agent/delete", payload);
  }

  /**
   * deleteModelProvider：从中心服务供应商列表中删除供应商配置。
   *
   * @param payload 供应商 ID。
   * @returns 删除结果。
   */
  deleteModelProvider(payload: {
    providerId: string;
  }): Promise<{
    providerId: string;
    deleted: boolean;
  }> {
    return this.post("/api/model-provider/delete", payload);
  }

  /**
   * deleteProvider：兼容既有前端删除供应商调用。
   *
   * @param payload 供应商 ID。
   * @returns 删除结果。
   */
  deleteProvider(payload: {
    providerId: string;
  }): Promise<{
    providerId: string;
    deleted: boolean;
  }> {
    return this.deleteModelProvider(payload);
  }

  /**
   * saveModelProviderModels：保存模型列表和默认模型。
   *
   * @param payload 供应商 ID、模型列表和默认模型。
   * @returns 保存后的供应商详情。
   */
  saveModelProviderModels(payload: SaveModelProviderModelsPayload): Promise<{
    provider: ProviderConfigView;
  }> {
    return this.post("/api/model-provider/model/save", payload);
  }

  /**
   * listProviderModels：从供应商详情中读取已保存模型列表。
   *
   * @param payload 供应商 ID。
   * @returns 模型列表和默认模型。
   */
  listProviderModels(payload: {
    providerId: string;
  }): Promise<ProviderModelListView | null> {
    return this.listProviders().then((result) => {
      const provider = result.providers.find((item) => {
        return item.providerId === payload.providerId;
      });
      if (!provider) {
        return null;
      }
      const extraSettings = parseProviderSettingsExtraJson(provider.settings.extraJson);
      return {
        providerId: provider.providerId,
        models: provider.models.map((model) => {
          return model.modelName;
        }),
        contextWindows: provider.models
          .filter((model) => {
            return typeof model.contextWindowTokens === "number";
          })
          .map((model) => {
            return {
              model: model.modelName,
              contextWindowTokens: model.contextWindowTokens as number,
            };
          }),
        reasoningEfforts: extraSettings.reasoningEfforts,
        updatedAt: provider.settings.updatedAt || null,
      };
    });
  }

  /**
   * fetchProviderModels：兼容旧页面“获取模型”调用。
   *
   * @param payload 供应商 ID。
   * @returns 当前已保存模型列表；真实上游获取由后续 LangChain 模型运行时任务接入。
   */
  fetchProviderModels(payload: {
    providerId: string;
  }): Promise<ProviderModelListView> {
    return this.listProviderModels(payload).then((result) => {
      if (result) {
        return result;
      }
      return {
        providerId: payload.providerId,
        models: [],
        contextWindows: [],
        reasoningEfforts: [],
        updatedAt: null,
      };
    });
  }

  /**
   * runModelProviderCheck：运行模型协议供应商检测。
   *
   * @param payload 供应商 ID 和检测类型。
   * @returns 检测结果。
   */
  runModelProviderCheck(payload: {
    providerId: string;
    checkType?: string;
  }): Promise<{
    check: ModelProviderCheckView;
  }> {
    return this.post("/api/model-provider/check/run", payload);
  }

  /**
   * listProxies：查询代理列表和全局默认代理。
   *
   * @returns 代理列表和默认代理 ID。
   */
  listProxies(): Promise<{
    proxies: ProxyConfigView[];
    defaultProxyId: string | null;
  }> {
    return this.post("/api/proxy/list", {});
  }

  /**
   * saveProxy：新增或修改网络代理。
   *
   * @param payload 代理配置。
   * @returns 代理 ID 和认证状态。
   */
  saveProxy(payload: {
    proxyId?: string;
    proxyName: string;
    protocol: string;
    host: string;
    port: number;
    username: string;
    password: string;
    clearAuth: boolean;
    enabled: boolean;
    note: string;
  }): Promise<{
    proxyId: string;
    hasAuth: boolean;
  }> {
    return this.post("/api/proxy/save", payload);
  }

  /**
   * setGlobalDefaultProxy：设置全局默认代理。
   *
   * @param payload 代理 ID，null 表示取消默认代理。
   * @returns 保存后的默认代理 ID。
   */
  setGlobalDefaultProxy(payload: {
    proxyId: string | null;
  }): Promise<{
    defaultProxyId: string | null;
  }> {
    return this.post("/api/proxy/default/set", payload);
  }

  /**
   * deleteProxy：删除代理配置。
   *
   * @param payload 代理 ID。
   * @returns 删除结果。
   */
  deleteProxy(payload: {
    proxyId: string;
  }): Promise<unknown> {
    return this.post("/api/proxy/delete", payload);
  }

  /**
   * listRuntimes：查询运行环境列表。
   *
   * @returns 运行环境列表。
   */
  listRuntimes(): Promise<{
    runtimes: RuntimeConfigView[];
  }> {
    return this.post("/api/runtime/list", {});
  }

  /**
   * saveRuntime：新增或修改运行环境。
   *
   * @param payload 运行环境配置。
   * @returns 运行环境 ID 和默认状态。
   */
  saveRuntime(payload: {
    runtimeId?: string;
    runtimeName: string;
    runtimeType: string;
    executablePath: string;
    rootPath: string;
    version: string;
    environmentVariables: Record<string, string>;
    pathEntries: string[];
    isDefault: boolean;
    enabled: boolean;
    note: string;
  }): Promise<{
    runtimeId: string;
    isDefault: boolean;
  }> {
    return this.post("/api/runtime/save", payload);
  }

  /**
   * deleteRuntime：删除运行环境。
   *
   * @param payload 运行环境 ID。
   * @returns 删除结果。
   */
  deleteRuntime(payload: {
    runtimeId: string;
  }): Promise<unknown> {
    return this.post("/api/runtime/delete", payload);
  }

  /**
   * queryUsageRecords：查询用量原始记录。
   *
   * @param payload 用量筛选条件。
   * @returns 原始记录数组。
   */
  queryUsageRecords(payload: UsageFilters): Promise<{
    records: unknown[];
  }> {
    return this.post("/api/usage/query", payload);
  }

  /**
   * loadUsageAggregate：查询用量聚合统计。
   *
   * @param payload 用量筛选条件。
   * @returns 聚合统计数组和刷新后的日统计。
   */
  loadUsageAggregate(payload: UsageFilters): Promise<{
    stats: unknown[];
    refreshedDailyStats: unknown[];
  }> {
    return this.post("/api/usage/aggregate", payload);
  }

  /**
   * listPlugins：查询中心服务插件列表。
   *
   * @returns 插件列表。
   */
  listPlugins(): Promise<{
    plugins: PluginConfigView[];
  }> {
    return this.post("/api/plugin/list", {});
  }

  /**
   * installPlugin：安装插件清单 JSON。
   *
   * @param payload 插件清单对象。
   * @returns 插件安装 ID。
   */
  installPlugin(payload: {
    manifest: Record<string, unknown>;
  }): Promise<{
    pluginInstallId: string;
  }> {
    return this.post("/api/plugin/install", payload);
  }

  /**
   * enablePlugin：启用插件。
   *
   * @param payload 插件 ID。
   * @returns 启用结果。
   */
  enablePlugin(payload: {
    pluginId: string;
  }): Promise<{
    pluginId: string;
    enabled: boolean;
  }> {
    return this.post("/api/plugin/enable", payload);
  }

  /**
   * disablePlugin：停用插件。
   *
   * @param payload 插件 ID。
   * @returns 停用结果。
   */
  disablePlugin(payload: {
    pluginId: string;
  }): Promise<{
    pluginId: string;
    enabled: boolean;
  }> {
    return this.post("/api/plugin/disable", payload);
  }

  /**
   * configurePlugin：保存插件配置 JSON。
   *
   * @param payload 插件 ID 和配置对象。
   * @returns 配置保存结果。
   */
  configurePlugin(payload: {
    pluginId: string;
    config: Record<string, unknown>;
  }): Promise<{
    pluginId: string;
    configured: boolean;
  }> {
    return this.post("/api/plugin/configure", payload);
  }

  /**
   * deletePlugin：删除可删除插件。
   *
   * @param payload 插件 ID。
   * @returns 删除结果。
   */
  deletePlugin(payload: {
    pluginId: string;
  }): Promise<{
    pluginId: string;
    deleted: boolean;
  }> {
    return this.post("/api/plugin/delete", payload);
  }

  /**
   * listMcpConfigs：查询 MCP 配置列表。
   *
   * @returns 全局和项目级 MCP 配置。
   */
  listMcpConfigs(): Promise<{
    configs: McpConfigView[];
  }> {
    return this.post("/api/mcp/list", {});
  }

  /**
   * listMcpTools：按单个 MCP Server 查询工具列表。
   *
   * @param payload 配置文件相对路径和 MCP Server ID。
   * @returns 当前 MCP Server 的工具列表。
   */
  listMcpTools(payload: {
    relativePath: string;
    serverId: string;
  }): Promise<{
    tools: McpToolView[];
  }> {
    return this.post("/api/mcp/tools", payload);
  }

  /**
   * saveMcpConfig：保存 MCP 配置。
   *
   * @param payload 前端从完整 MCP JSON 抽取唯一 serverId 和 serverConfig 后提交，mcpServers 仅用于旧整包兼容。
   * @returns 保存文件路径。
   */
  saveMcpConfig(payload: {
    mcpServers?: Record<string, unknown>;
    projectId?: string | null;
    serverConfig?: Record<string, unknown>;
    serverId?: string;
  }): Promise<{
    relativePath: string;
  }> {
    return this.post("/api/mcp/save", payload);
  }

  /**
   * listSkills：查询已安装 skill。
   *
   * @returns skill 列表。
   */
  listSkills(): Promise<{
    skills: SkillConfigView[];
  }> {
    return this.post("/api/skill/list", {});
  }

  /**
   * installSkill：安装或追加 skill 内容。
   *
   * @param payload skill 名称、内容和可选项目 ID。
   * @returns 保存文件路径。
   */
  installSkill(payload: {
    skillName: string;
    content: string;
    projectId?: string | null;
  }): Promise<{
    relativePath: string;
  }> {
    return this.post("/api/skill/install", payload);
  }

  /**
   * countComposerContextTokens：统计当前输入区真实上下文 token。
   *
   * @param payload 当前会话、草稿、引用、附件和模型窗口。
   * @returns tokenizer 统计结果。
   */
  countComposerContextTokens(payload: {
    sessionId: string | null;
    draftText: string;
    referenceSummaries: string[];
    attachmentSummaries: string[];
    modelId: string;
    windowLimitTokens: number;
  }): Promise<TokenizerCountResponse> {
    return this.post("/api/tokenizer/count", payload);
  }

  /**
   * listAgents：查询主智能体和长期智能体列表。
   *
   * @returns 智能体列表。
   */
  listAgents(): Promise<{
    agents: AgentConfigView[];
  }> {
    return this.post("/api/agent/list", {});
  }

  /**
   * post：发送 POST 请求并解析统一响应包。
   *
   * @param path API 路径。
   * @param payload JSON 请求体。
   * @returns 成功响应中的 data。
   */
  private async post<TData>(path: string, payload: unknown): Promise<TData> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return this.readResponse<TData>(response);
  }

  /**
   * get：发送 GET 请求并解析统一响应包。
   *
   * @param path API 路径。
   * @returns 成功响应中的 data。
   */
  private async get<TData>(path: string): Promise<TData> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      credentials: "include",
    });
    return this.readResponse<TData>(response);
  }

  /**
   * readResponse：解析中心服务统一响应包。
   *
   * @param response fetch 响应对象。
   * @returns 成功响应中的 data。
   */
  private async readResponse<TData>(response: Response): Promise<TData> {
    const result = await response.json() as ApiResponse<TData>;

    if (!result.success || result.data === null) {
      throw new CenterApiError(result.error?.code ?? "CENTER_API_ERROR", result.error?.displayMessage ?? "中心服务请求失败");
    }

    return result.data;
  }
}

/**
 * CenterApiError：中心服务业务错误。
 *
 * 用途：让 UI 可以直接展示 displayMessage，同时保留错误码用于排查。
 */
export class CenterApiError extends Error {
  /**
   * code: 中心服务错误码。
   */
  readonly code: string;

  /**
   * constructor：创建 API 错误。
   *
   * @param code 错误码。
   * @param message 可展示错误消息。
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = "CenterApiError";
    this.code = code;
  }
}
