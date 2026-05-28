// 应用默认端口：中心服务本机监听端口，来自需求中的固定默认值。
export const DEFAULT_CENTER_PORT = 8866;

// 应用中文名：用于窗口标题、通知标题和安装包展示。
export const ZHIXIN_APP_NAME = "致心智能体";

// 主智能体名称：中心服务内置且不可删除的主智能体。
export const PRIMARY_AGENT_NAME = "致心";

// 中心目录名称：固化数据目录的默认展示名称，真实路径由桌面端或中心服务配置决定。
export const DEFAULT_CENTER_DIRECTORY_NAME = "中心";

// 中心目录子目录：中心服务启动时必须确保这些目录存在。
export const CENTER_DIRECTORY_NAMES = [
  "记忆",
  "供应商",
  "智能体",
  "插件",
  "MCP",
  "skills",
  "运行环境",
  "会话",
  "日志",
] as const;

// 客户端类型：用于通知配置、执行模式配置和连接来源区分。
export type ClientType = "desktop" | "web" | "idea";

// 执行模式：影响 agent 执行任务时是否需要用户审批。
export type ExecutionMode = "suggest" | "auto-edit" | "full-auto";

// 智能体状态：所有 UI 同步展示的统一状态集合。
export type AgentStatus = "idle" | "working" | "queued" | "waiting-user" | "ended" | "failed";

// 供应商类型：中心服务按类型决定模型列表和推理深度刷新策略。
export type ProviderType = "openai-compatible" | "custom-http" | "local";

// 网络代理协议：中心服务访问供应商时支持的代理协议集合。
export type ProxyProtocol = "http" | "https" | "socks4" | "socks4a" | "socks5";

// 供应商代理策略：控制供应商后续请求是否使用代理。
export type ProviderProxyMode = "none" | "global" | "specified";

// 运行环境类型：中心服务管理可执行程序和构建工具的分类。
export type RuntimeType = "node" | "python" | "java" | "maven" | "git" | "custom";

// MCP 服务类型：对应需求中的 HTTP 与 stdio 两种配置形态。
export type McpServerType = "http" | "stdio";

// 主题模式：Element Plus 亮色和暗黑主题的统一标识。
export type ThemeMode = "light" | "dark";

// 会话类型：区分普通对话、项目对话和团队智能体对话。
export type ConversationType = "normal" | "project" | "team-agent";

// 消息角色：会话消息在 UI 和记忆写入中的来源。
export type MessageRole = "user" | "assistant" | "system" | "tool";

// 任务状态：中心服务保存任务执行生命周期，供多端实时同步。
export type TaskStatus = "queued" | "running" | "waiting-user" | "completed" | "failed" | "cancelled";

// 引用类型：输入框中插入的项目上下文引用类型。
export type ContextReferenceType = "file" | "directory" | "code";

// 扩展能力类型：中心服务统一管理插件、MCP 和 skill。
export type ExtensionType = "plugin" | "mcp" | "skill";

// 扩展能力作用域：区分全局能力和项目能力。
export type ExtensionScope = "global" | "project";

// 记忆类型：对应用户记忆、短期记忆、长期记忆和永久记忆。
export type MemoryType = "user" | "short-term" | "long-term" | "permanent";

// 供应商配置：保存模型服务连接、模型列表、推理深度和启用状态。
export interface ProviderConfig {
  // id：中心服务生成的供应商唯一标识。
  id: string;
  // name：用户在 UI 中维护的供应商名称。
  name: string;
  // type：供应商协议类型，用于选择刷新逻辑。
  type: ProviderType;
  // baseUrl：供应商接口地址。
  baseUrl: string;
  // apiKeyStored：API Key 是否已在中心电脑保存，客户端不接收明文。
  apiKeyStored: boolean;
  // models：中心服务从供应商刷新或用户手动填写的模型列表。
  models: string[];
  // defaultModel：后续对话默认使用的模型名称。
  defaultModel: string;
  // reasoningDepths：中心服务刷新或用户手动填写的推理深度列表。
  reasoningDepths: string[];
  // defaultReasoningDepth：后续对话默认使用的推理深度。
  defaultReasoningDepth: string;
  // supportsImageInput：该供应商当前默认模型是否允许图片输入，未声明时按不支持处理。
  supportsImageInput?: boolean;
  // enabled：供应商是否允许被智能体选择。
  enabled: boolean;
  // proxyMode：供应商请求代理策略，none 不使用代理，global 使用全局默认代理，specified 使用指定代理。
  proxyMode: ProviderProxyMode;
  // proxyId：proxyMode 为 specified 时使用的代理配置 ID。
  proxyId?: string;
  // lastRefreshError：最近一次刷新模型或推理深度失败原因。
  lastRefreshError?: string;
  // updatedAt：供应商配置最后更新时间，ISO 8601 字符串。
  updatedAt: string;
}

// ProviderSecretPatch：供应商敏感字段写入请求，API Key 只允许进入中心服务。
export interface ProviderSecretPatch {
  // apiKey：用户在桌面端或 Web 端输入的 API Key 明文，只用于本次保存。
  apiKey?: string;
}

// ProviderUpsertRequest：供应商新增或修改请求，客户端不读取已保存的 API Key 明文。
export interface ProviderUpsertRequest extends ProviderSecretPatch {
  // id：修改已有供应商时传入；新增时由中心服务生成。
  id?: string;
  // name：用户维护的供应商名称。
  name: string;
  // type：供应商协议类型，用于选择刷新逻辑。
  type: ProviderType;
  // baseUrl：供应商接口地址。
  baseUrl: string;
  // models：供应商返回或用户手动维护的模型列表。
  models: string[];
  // defaultModel：后续对话默认使用的模型名称。
  defaultModel: string;
  // reasoningDepths：供应商返回或用户手动维护的推理深度列表。
  reasoningDepths: string[];
  // defaultReasoningDepth：后续对话默认使用的推理深度。
  defaultReasoningDepth: string;
  // supportsImageInput：发送前判断图片附件是否可用的明确能力开关。
  supportsImageInput?: boolean;
  // enabled：供应商是否可被智能体选择。
  enabled: boolean;
  // proxyMode：供应商请求代理策略，只影响后续供应商访问。
  proxyMode: ProviderProxyMode;
  // proxyId：指定代理配置 ID，仅 proxyMode 为 specified 时使用。
  proxyId?: string;
}

// NetworkProxyConfig：中心服务网络代理配置，敏感认证信息只保存在中心电脑。
export interface NetworkProxyConfig {
  // id：代理配置唯一标识。
  id: string;
  // name：用户维护的代理名称。
  name: string;
  // protocol：代理协议，支持 HTTP、HTTPS、SOCKS4、SOCKS4a、SOCKS5。
  protocol: ProxyProtocol;
  // host：代理主机名或 IP 地址。
  host: string;
  // port：代理端口号。
  port: number;
  // usernameStored：是否已保存代理用户名；用户名允许为空。
  usernameStored: boolean;
  // passwordStored：是否已保存代理密码；密码允许为空。
  passwordStored: boolean;
  // enabled：该代理配置是否启用。
  enabled: boolean;
  // default：是否作为全局默认代理。
  default: boolean;
  // remark：用户备注。
  remark: string;
  // lastError：最近一次代理连接或认证失败原因。
  lastError?: string;
  // updatedAt：代理配置最后更新时间，ISO 8601 字符串。
  updatedAt: string;
}

// NetworkProxyUpsertRequest：网络代理新增或修改请求。
export interface NetworkProxyUpsertRequest {
  // id：修改已有代理时传入；新增时由中心服务生成。
  id?: string;
  // name：用户维护的代理名称。
  name: string;
  // protocol：代理协议。
  protocol: ProxyProtocol;
  // host：代理主机名或 IP 地址。
  host: string;
  // port：代理端口号。
  port: number;
  // username：代理用户名，允许为空字符串，空字符串表示无认证用户名。
  username: string;
  // password：代理密码，允许为空字符串，空字符串表示无认证密码。
  password: string;
  // enabled：该代理配置是否启用。
  enabled: boolean;
  // default：是否作为全局默认代理。
  default: boolean;
  // remark：用户备注。
  remark: string;
}

// ProxyFailureKind：供应商访问失败原因分类，用于区分代理和供应商错误。
export type ProxyFailureKind =
  | "proxy-connect-failed"
  | "proxy-auth-failed"
  | "provider-connect-failed"
  | "provider-api-failed";

// ProxyFailureRecord：代理相关访问失败记录。
export interface ProxyFailureRecord {
  // kind：失败分类。
  kind: ProxyFailureKind;
  // providerId：相关供应商 ID。
  providerId?: string;
  // proxyId：相关代理 ID。
  proxyId?: string;
  // message：开发者可读错误消息。
  message: string;
  // displayReason：用户可展示失败原因。
  displayReason: string;
  // traceId：排查 ID，用于关联日志。
  traceId: string;
  // occurredAt：失败发生时间，ISO 8601 字符串。
  occurredAt: string;
}

// 运行环境配置：用于插件、MCP、skill、命令任务选择执行环境。
export interface RuntimeConfig {
  // id：运行环境唯一标识。
  id: string;
  // name：用户可读的环境名称。
  name: string;
  // type：运行环境分类，例如 node、python、java、maven。
  type: RuntimeType;
  // executablePath：可执行文件绝对路径。
  executablePath: string;
  // rootPath：运行环境根目录绝对路径。
  rootPath: string;
  // version：检测或用户填写的版本号。
  version: string;
  // env：执行任务时追加的环境变量。
  env: Record<string, string>;
  // pathEntries：执行任务时追加到 PATH 的目录列表。
  pathEntries: string[];
  // default：是否为该类型默认启用环境。
  default: boolean;
  // enabled：该运行环境是否可用。
  enabled: boolean;
  // remark：用户备注。
  remark: string;
}

// RuntimeUpsertRequest：运行环境新增或修改请求。
export interface RuntimeUpsertRequest {
  // id：修改已有运行环境时传入；新增时由中心服务生成。
  id?: string;
  // name：用户可读的环境名称。
  name: string;
  // type：运行环境分类，例如 node、python、java、maven。
  type: RuntimeType;
  // executablePath：可执行文件绝对路径。
  executablePath: string;
  // rootPath：运行环境根目录绝对路径。
  rootPath: string;
  // version：检测或用户填写的版本号。
  version: string;
  // env：执行任务时追加的环境变量。
  env: Record<string, string>;
  // pathEntries：执行任务时追加到 PATH 的目录列表。
  pathEntries: string[];
  // default：是否为该类型默认启用环境。
  default: boolean;
  // enabled：该运行环境是否可用。
  enabled: boolean;
  // remark：用户备注。
  remark: string;
}

// 项目身份：IDE 插件、桌面端和 Web 端识别工程会话的统一信息。
export interface ProjectIdentity {
  // projectId：项目 UUID，存放在“致心项目ID.md”。
  projectId: string;
  // displayName：默认项目显示名，通常来自项目文件夹名。
  displayName: string;
  // alias：用户手动设置的项目别名。
  alias?: string;
  // rootPath：项目根目录绝对路径。
  rootPath: string;
}

// ProjectRegistration：中心服务登记项目时保存的结构。
export interface ProjectRegistration extends ProjectIdentity {
  // lastSeenAt：最近一次客户端打开该项目的时间，ISO 8601 字符串。
  lastSeenAt: string;
}

// ContextReference：输入框中的文件、文件夹或代码引用。
export interface ContextReference {
  // id：引用唯一标识，由客户端或中心服务生成。
  id: string;
  // type：引用类型，区分文件、文件夹和代码行。
  type: ContextReferenceType;
  // projectId：引用所属项目 UUID，普通会话不使用。
  projectId: string;
  // absolutePath：引用目标的绝对路径。
  absolutePath: string;
  // relativePath：引用目标相对项目根目录的路径。
  relativePath: string;
  // displayText：UI 展示文本，例如 文件名 或 文件名#L1-L3。
  displayText: string;
  // startLine：代码引用起始行号，从 1 开始；文件和文件夹引用为空。
  startLine?: number;
  // endLine：代码引用结束行号，从 1 开始；文件和文件夹引用为空。
  endLine?: number;
  // selectedText：代码引用中的选中文本；文件和文件夹引用为空。
  selectedText?: string;
}

// InternalFileLink：Markdown 和插件页面内部文件定位链接协议。
export interface InternalFileLink {
  // projectId：目标文件所属项目 UUID。
  projectId: string;
  // absolutePath：目标文件绝对路径，用于本机 IDE 精确定位。
  absolutePath: string;
  // relativePath：目标文件相对项目路径，用于迁移和展示。
  relativePath: string;
  // startLine：跳转起始行号，从 1 开始。
  startLine?: number;
  // endLine：跳转结束行号，从 1 开始。
  endLine?: number;
  // label：链接展示短文本。
  label: string;
}

// 输入附件：图片等混合输入进入消息上下文时的统一结构。
export interface MessageAttachment {
  // id：附件唯一标识。
  id: string;
  // fileName：原始文件名。
  fileName: string;
  // mimeType：附件 MIME 类型。
  mimeType: string;
  // size：文件大小，单位字节。
  size: number;
  // width：图片宽度，单位像素。
  width?: number;
  // height：图片高度，单位像素。
  height?: number;
  // storagePath：中心目录中的附件文件路径。
  storagePath: string;
  // sessionId：附件所属会话 ID。
  sessionId: string;
  // messageId：附件所属消息 ID。
  messageId: string;
}

// ConversationMessage：中心服务持久化的会话消息结构。
export interface ConversationMessage {
  // id：消息唯一标识。
  id: string;
  // sessionId：消息所属会话 ID。
  sessionId: string;
  // role：消息来源角色。
  role: MessageRole;
  // content：消息正文，Markdown 内容也保存在这里。
  content: string;
  // attachments：本条消息关联的附件列表。
  attachments: MessageAttachment[];
  // references：本条消息关联的项目上下文引用列表。
  references: ContextReference[];
  // createdAt：消息创建时间，ISO 8601 字符串。
  createdAt: string;
}

// ConversationSession：普通会话、项目会话和团队智能体会话的统一结构。
export interface ConversationSession {
  // id：会话唯一标识。
  id: string;
  // type：会话类型。
  type: ConversationType;
  // title：会话标题，允许用户后续修改。
  title: string;
  // projectId：项目会话所属项目 UUID，普通会话为空。
  projectId?: string;
  // agentId：当前会话主处理智能体 ID。
  agentId: string;
  // clientType：创建或最近使用该会话的客户端类型。
  clientType: ClientType;
  // status：会话当前展示状态，复用智能体状态枚举。
  status: AgentStatus;
  // createdAt：会话创建时间，ISO 8601 字符串。
  createdAt: string;
  // updatedAt：会话更新时间，ISO 8601 字符串。
  updatedAt: string;
}

// AgentDefinition：主智能体、团队智能体和子智能体的统一定义。
export interface AgentDefinition {
  // id：智能体唯一标识。
  id: string;
  // name：智能体显示名称。
  name: string;
  // kind：智能体类别，主智能体不可删除。
  kind: "primary" | "team" | "child";
  // status：智能体当前状态。
  status: AgentStatus;
  // providerId：承载该智能体的供应商 ID。
  providerId?: string;
  // model：该智能体后续对话默认模型。
  model?: string;
  // reasoningDepth：该智能体后续对话默认推理深度。
  reasoningDepth?: string;
  // removable：是否允许用户删除。
  removable: boolean;
  // description：智能体职责说明。
  description: string;
  // updatedAt：智能体定义最后更新时间，ISO 8601 字符串。
  updatedAt: string;
}

// AgentCollaborationRecord：管线通话和群聊讨论记录。
export interface AgentCollaborationRecord {
  // id：协作记录唯一标识。
  id: string;
  // type：协作类型，pipeline 表示管线，group-chat 表示群聊。
  type: "pipeline" | "group-chat";
  // sessionId：协作归属会话 ID。
  sessionId: string;
  // participantAgentIds：参与协作的智能体 ID 列表。
  participantAgentIds: string[];
  // status：协作当前任务状态。
  status: TaskStatus;
  // summary：阶段结论或最终结果摘要。
  summary: string;
  // createdAt：协作创建时间，ISO 8601 字符串。
  createdAt: string;
  // updatedAt：协作更新时间，ISO 8601 字符串。
  updatedAt: string;
}

// TaskRecord：中心服务保存的任务执行记录。
export interface TaskRecord {
  // id：任务唯一标识。
  id: string;
  // sessionId：任务所属会话 ID。
  sessionId: string;
  // title：任务标题。
  title: string;
  // status：任务当前状态。
  status: TaskStatus;
  // runtimeSnapshot：任务执行时使用的运行环境快照，未使用运行环境时为空。
  runtimeSnapshot?: RuntimeConfig;
  // createdAt：任务创建时间，ISO 8601 字符串。
  createdAt: string;
  // updatedAt：任务更新时间，ISO 8601 字符串。
  updatedAt: string;
}

// RuntimeExecutionRequest：插件、MCP、skill 或命令任务请求运行环境时的入参。
export interface RuntimeExecutionRequest {
  // runtimeType：需要的运行环境类型，例如 node、python、java、maven、git。
  runtimeType: RuntimeType;
  // runtimeId：显式选择的运行环境 ID，未传时使用同类型默认启用环境。
  runtimeId?: string;
}

// RuntimeExecutionSelection：中心服务选择运行环境后的结果。
export interface RuntimeExecutionSelection {
  // runtime：最终用于执行的运行环境配置。
  runtime: RuntimeConfig;
  // source：运行环境来源，specified 表示显式指定，default 表示使用默认启用环境。
  source: "specified" | "default";
}

// 代码引用：IDE 插件和项目聊天 @ 检索插入的代码位置上下文。
export interface CodeReference {
  // projectId：引用所属项目 UUID。
  projectId: string;
  // absolutePath：被引用文件的绝对路径。
  absolutePath: string;
  // relativePath：被引用文件相对项目根目录的路径。
  relativePath: string;
  // startLine：引用起始行号，从 1 开始。
  startLine: number;
  // endLine：引用结束行号，从 1 开始。
  endLine: number;
  // selectedText：用户选中的代码内容。
  selectedText: string;
}

// 通知配置：按客户端类型保存，不在不同客户端类型之间同步。
export interface NotificationConfig {
  // clientType：配置归属的客户端类型。
  clientType: ClientType;
  // enabled：是否开启对话完成通知。
  enabled: boolean;
  // inactiveOnly：是否仅在窗口不活跃时通知。
  inactiveOnly: boolean;
  // notifyNormalChat：是否通知普通对话。
  notifyNormalChat: boolean;
  // notifyProjectChat：是否通知项目对话。
  notifyProjectChat: boolean;
  // notifyTeamAgentChat：是否通知团队智能体对话。
  notifyTeamAgentChat: boolean;
  // notifyFailures：是否通知失败或需要用户处理的对话。
  notifyFailures: boolean;
}

// ClientPreferenceState：按客户端类型保存的执行模式和通知配置。
export interface ClientPreferenceState {
  // clientType：配置归属客户端类型。
  clientType: ClientType;
  // executionMode：该客户端类型后续任务审批模式。
  executionMode: ExecutionMode;
  // notificationConfig：该客户端类型通知开关。
  notificationConfig: NotificationConfig;
}

// 通知事件：中心服务生成并同步给相关客户端的消息。
export interface NotificationEvent {
  // id：通知唯一标识。
  id: string;
  // type：通知业务类型。
  type: "conversation-complete" | "conversation-failed" | "action-required";
  // targetClientType：通知目标客户端类型。
  targetClientType: ClientType;
  // sessionId：通知关联会话 ID。
  sessionId: string;
  // projectId：通知关联项目 ID，普通会话为空。
  projectId?: string;
  // agentId：通知关联智能体 ID。
  agentId: string;
  // title：通知标题。
  title: string;
  // summary：通知内容摘要。
  summary: string;
  // notifiedAt：通知时间，ISO 8601 字符串。
  notifiedAt: string;
  // requiresAction：是否需要用户处理。
  requiresAction: boolean;
  // jumpTarget：客户端跳转定位数据。
  jumpTarget: string;
}

// CenterServiceLocalConfig：中心服务本机配置文件结构。
export interface CenterServiceLocalConfig {
  // port：中心服务监听端口，修改后需要重启生效。
  port: number;
  // centerDirectory：中心目录绝对路径。
  centerDirectory: string;
  // webAccount：Web端非本机访问账号。
  webAccount: string;
  // webPasswordHash：Web端非本机访问密码摘要，不保存明文。
  webPasswordHash: string;
  // systemNotificationPermission：中心电脑系统通知权限状态。
  systemNotificationPermission: "unknown" | "granted" | "denied";
  // updatedAt：配置最后更新时间，ISO 8601 字符串。
  updatedAt: string;
}

// ApiErrorResponse：中心服务统一错误响应。
export interface ApiErrorResponse {
  // code：机器可读错误码。
  code: string;
  // message：面向开发者的错误消息。
  message: string;
  // displayReason：可直接展示给用户的失败原因。
  displayReason: string;
  // traceId：排查 ID，用于关联日志。
  traceId: string;
}

// FileRepositoryMode：文件仓储层读写模式。
export type FileRepositoryMode = "config-write" | "append-only" | "readonly-scan" | "migration";

// MemoryRecord：永久记忆写入时的结构化内容。
export interface MemoryRecord {
  // type：记忆类型。
  type: MemoryType;
  // agentName：记忆归属智能体名称。
  agentName: string;
  // occurredAt：对话完成时间，ISO 8601 字符串。
  occurredAt: string;
  // keywords：本轮对话关键词列表。
  keywords: string[];
  // summary：本轮对话总结。
  summary: string;
  // computerName：产生记忆的中心电脑名称。
  computerName: string;
  // userText：本轮用户原始输入摘要。
  userText: string;
  // assistantText：本轮 agent 回答摘要。
  assistantText: string;
  // attachmentIds：本轮记忆引用的会话附件 ID 列表，原始媒体仍保存在会话附件目录。
  attachmentIds?: string[];
}

// MemoryReadResult：UI 快速查看记忆内容时的返回项。
export interface MemoryReadResult {
  // path：记忆文件在中心目录中的绝对路径。
  path: string;
  // content：Markdown 记忆内容。
  content: string;
}

// AttachmentUploadRequest：客户端把粘贴图片提交给中心服务保存的请求。
export interface AttachmentUploadRequest {
  // sessionId：附件所属会话 ID。
  sessionId: string;
  // messageId：附件所属消息 ID，尚未发送消息时可使用预生成 ID。
  messageId: string;
  // fileName：原始文件名。
  fileName: string;
  // mimeType：附件 MIME 类型。
  mimeType: string;
  // size：文件大小，单位字节。
  size: number;
  // width：图片宽度，单位像素。
  width?: number;
  // height：图片高度，单位像素。
  height?: number;
  // base64Data：图片原始内容的 base64，不含 data URL 前缀。
  base64Data: string;
}

// PendingMessageRecord：断线后尚未成功发送到中心服务的本地排队消息记录。
export interface PendingMessageRecord {
  // id：待确认消息唯一标识。
  id: string;
  // clientType：产生该排队消息的客户端类型。
  clientType: ClientType;
  // sessionId：目标会话 ID。
  sessionId: string;
  // content：用户准备发送的文本内容。
  content: string;
  // attachments：待发送消息携带的附件。
  attachments: MessageAttachment[];
  // references：待发送消息携带的上下文引用。
  references: ContextReference[];
  // status：排队消息固定使用待用户确认状态，恢复连接后不能自动发送。
  status: "waiting-user-confirmation";
  // createdAt：排队消息创建时间，ISO 8601 字符串。
  createdAt: string;
}

// RealtimeSyncSnapshot：客户端轮询或实时通道获取的中心服务业务状态快照。
export interface RealtimeSyncSnapshot {
  // projects：项目列表同步数据。
  projects: ProjectRegistration[];
  // sessions：会话列表同步数据。
  sessions: ConversationSession[];
  // agents：智能体状态同步数据。
  agents: AgentDefinition[];
  // tasks：任务状态同步数据。
  tasks: TaskRecord[];
  // providers：供应商配置同步数据。
  providers: ProviderConfig[];
  // extensions：插件、MCP 和 skill 状态同步数据。
  extensions: ExtensionManifest[];
  // notifications：通知事件同步数据。
  notifications: NotificationEvent[];
  // pendingMessages：恢复连接后等待用户确认的本地排队消息。
  pendingMessages: PendingMessageRecord[];
  // syncedAt：快照生成时间，ISO 8601 字符串。
  syncedAt: string;
}

// ExtensionManifest：插件、MCP 和 skill 的统一能力清单。
export interface ExtensionManifest {
  // id：扩展能力唯一标识。
  id: string;
  // type：扩展能力类型。
  type: ExtensionType;
  // scope：扩展能力作用域。
  scope: ExtensionScope;
  // projectId：项目级能力所属项目 ID，全局能力为空。
  projectId?: string;
  // name：扩展能力名称，同名时项目级优先。
  name: string;
  // version：扩展能力版本。
  version: string;
  // entry：扩展能力入口文件、命令或 URL。
  entry: string;
  // capabilities：扩展声明的能力列表。
  capabilities: string[];
  // permissions：文件、网络、命令、记忆、项目访问等权限声明。
  permissions: string[];
  // enabled：扩展能力是否启用。
  enabled: boolean;
  // description：扩展能力说明。
  description: string;
  // callRecords：扩展能力调用记录，用于审计工具、命令和 MCP 使用情况。
  callRecords?: ExtensionCallRecord[];
  // updatedAt：扩展能力最后更新时间，ISO 8601 字符串。
  updatedAt: string;
}

// ExtensionCallRecord：插件、MCP 和 skill 的调用审计记录。
export interface ExtensionCallRecord {
  // id：调用记录唯一标识。
  id: string;
  // extensionId：被调用扩展能力 ID。
  extensionId: string;
  // sessionId：调用所属会话 ID。
  sessionId?: string;
  // taskId：调用所属任务 ID。
  taskId?: string;
  // capability：本次调用的能力名称。
  capability: string;
  // status：调用状态。
  status: "success" | "failed";
  // message：调用摘要或失败原因。
  message: string;
  // calledAt：调用时间，ISO 8601 字符串。
  calledAt: string;
}

// PluginManifestFile：插件清单文件格式。
export interface PluginManifestFile {
  // name：插件名称。
  name: string;
  // version：插件版本。
  version: string;
  // entry：插件入口文件、命令或 URL。
  entry: string;
  // capabilities：插件声明的工具、UI、命令、项目、记忆或第三方集成能力。
  capabilities: string[];
  // permissions：插件请求的文件、网络、命令、记忆或项目访问权限。
  permissions: string[];
  // scope：插件默认作用域。
  scope: ExtensionScope;
  // description：插件说明。
  description: string;
}

// SkillManifestFile：skill 目录说明文件格式。
export interface SkillManifestFile {
  // name：skill 名称。
  name: string;
  // description：skill 触发说明。
  description: string;
  // workflowPath：工作流程文档相对路径。
  workflowPath: string;
  // templatePaths：模板文件相对路径列表。
  templatePaths: string[];
  // scriptPaths：脚本文件相对路径列表。
  scriptPaths: string[];
  // referencePaths：参考资料相对路径列表。
  referencePaths: string[];
  // examplePaths：示例文件相对路径列表。
  examplePaths: string[];
}

// UsageCacheTokenValue：缓存 token 统计值，null 表示供应商未提供，不能用 0 冒充。
export type UsageCacheTokenValue = number | null;

// ModelUsageRecord：模型调用用量追加记录。
export interface ModelUsageRecord {
  // id：用量记录唯一标识。
  id: string;
  // providerId：调用时的供应商 ID。
  providerId: string;
  // providerName：调用时的供应商名称快照。
  providerName: string;
  // model：调用时的模型名称。
  model: string;
  // projectId：项目会话所属项目 ID；普通会话为空并归入全局统计。
  projectId?: string;
  // sessionId：调用所属会话 ID。
  sessionId: string;
  // taskId：调用所属任务 ID。
  taskId?: string;
  // calledAt：调用时间，ISO 8601 字符串。
  calledAt: string;
  // inputTokens：输入 token 数。
  inputTokens: number;
  // outputTokens：输出 token 数。
  outputTokens: number;
  // totalTokens：总 token 数。
  totalTokens: number;
  // cacheHitTokens：缓存命中 token 数；null 表示供应商未提供。
  cacheHitTokens: UsageCacheTokenValue;
  // cacheMissTokens：缓存未命中 token 数；null 表示供应商未提供。
  cacheMissTokens: UsageCacheTokenValue;
  // status：调用结果状态。
  status: "success" | "failed";
  // failureReason：失败原因，成功时为空。
  failureReason?: string;
  // rawUsage：供应商原始用量返回，便于后续审计和适配。
  rawUsage?: Record<string, unknown>;
}

// ModelUsageSummary：供应商、模型、项目和时间范围聚合结果。
export interface ModelUsageSummary {
  // providerId：聚合供应商 ID。
  providerId: string;
  // providerName：聚合供应商名称快照。
  providerName: string;
  // model：聚合模型名称。
  model: string;
  // projectId：项目 ID；全局普通会话统计为空。
  projectId?: string;
  // inputTokens：输入 token 合计。
  inputTokens: number;
  // outputTokens：输出 token 合计。
  outputTokens: number;
  // totalTokens：总 token 合计。
  totalTokens: number;
  // cacheHitTokens：缓存命中 token 合计；null 表示该组记录均未提供。
  cacheHitTokens: UsageCacheTokenValue;
  // cacheMissTokens：缓存未命中 token 合计；null 表示该组记录均未提供。
  cacheMissTokens: UsageCacheTokenValue;
  // callCount：调用次数。
  callCount: number;
  // successCount：成功次数。
  successCount: number;
  // failureCount：失败次数。
  failureCount: number;
}

// McpHttpServerConfig：HTTP 类型 MCP Server 配置。
export interface McpHttpServerConfig {
  // type：固定为 http，对应远端或本机 HTTP MCP Server。
  type: "http";
  // url：MCP Server 连接地址。
  url: string;
}

// McpStdioServerConfig：stdio 类型 MCP Server 配置。
export interface McpStdioServerConfig {
  // type：固定为 stdio，对应命令启动的 MCP Server。
  type: "stdio";
  // command：启动 MCP Server 的命令。
  command: string;
  // args：启动 MCP Server 的命令参数。
  args: string[];
  // env：启动 MCP Server 时注入的环境变量。
  env?: Record<string, string>;
}

// McpServerConfig：MCP Server 支持的配置结构。
export type McpServerConfig = McpHttpServerConfig | McpStdioServerConfig;

// McpConfigFile：MCP 配置文件根结构。
export interface McpConfigFile {
  // mcpServers：按服务名组织的 MCP Server 配置集合。
  mcpServers: Record<string, McpServerConfig>;
}

// LoginRequest：Web端非本机访问登录请求。
export interface LoginRequest {
  // account：桌面端配置的 Web 访问账号。
  account: string;
  // password：桌面端配置的 Web 访问密码明文，只用于本次校验。
  password: string;
}

// AuthStatusResponse：Web端访问控制状态响应。
export interface AuthStatusResponse {
  // localAccess：中心服务根据连接来源判断的本机访问结果，不能由前端自行推断。
  localAccess: boolean;
  // requiresLogin：当前请求是否需要展示 Web 登录页。
  requiresLogin: boolean;
  // authenticated：当前请求是否已经具备访问中心服务的权限。
  authenticated: boolean;
  // webAccountConfigured：桌面端是否已经配置 Web 非本机访问账号。
  webAccountConfigured: boolean;
  // expiresAt：Cookie 登录态过期时间，ISO 8601 字符串；本机访问或未登录时为空。
  expiresAt?: string;
}

// LoginResponse：Web端登录成功后由中心服务返回的 Cookie 登录态摘要。
export interface LoginResponse extends AuthStatusResponse {
  // authenticated：登录接口成功时固定为 true，真实令牌只写入 HttpOnly Cookie。
  authenticated: true;
}

// 健康检查响应：客户端用于确认中心服务连接状态。
export interface HealthResponse {
  // appName：中心服务对应的应用名。
  appName: string;
  // version：中心服务版本。
  version: string;
  // port：中心服务当前监听端口。
  port: number;
  // centerDirectory：中心目录绝对路径。
  centerDirectory: string;
  // now：中心服务当前时间。
  now: string;
}

export {
  decodeInternalFileLink,
  encodeInternalFileLink,
  INTERNAL_FILE_LINK_PROTOCOL,
} from "./markdown.js";
