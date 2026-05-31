import type {
  ApiResponse,
  ClientType,
  ConversationMessage,
  ConversationSession,
  ConversationTurn,
  EventRecord,
  ProjectRecord,
  SessionType,
  TaskRecord,
  WebSocketEnvelope,
} from "@zhixin/shared";

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
   * relativePath: 临时附件相对中心目录路径。
   */
  relativePath: string;
}

/**
 * CommittedAttachmentResult：正式附件提交结果。
 *
 * 来源：`POST /api/session/attachment/commit`。
 * 含义：中心服务把临时附件转为正式会话附件后的元数据。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：只能绑定到已经成功创建的会话消息。
 */
export interface CommittedAttachmentResult {
  /**
   * attachmentId: 正式附件 ID，来源于中心服务生成。
   */
  attachmentId: string;

  /**
   * relativePath: 正式附件相对中心目录路径。
   */
  relativePath: string;
}

/**
 * ProviderCapabilityDeclaration：供应商模型能力声明。
 *
 * 来源：中心服务供应商配置协议。
 * 含义：描述模型协议插件暴露给 UI 的能力开关。
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
 * 来源：`POST /api/provider/list`。
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
  /** protocolPluginId: 模型协议插件 ID。 */
  protocolPluginId: string;
  /** protocolMode: 协议模式。 */
  protocolMode: string;
  /** baseUrl: 供应商接口地址。 */
  baseUrl: string;
  /** defaultModel: 默认模型。 */
  defaultModel: string;
  /** enabled: 是否启用。 */
  enabled: boolean;
  /** hasApiKey: 是否已保存 API Key。 */
  hasApiKey: boolean;
  /** capabilities: 能力声明。 */
  capabilities: ProviderCapabilityDeclaration;
  /** proxyPolicy: 代理策略。 */
  proxyPolicy: ProviderProxyPolicy;
  /** updatedAt: 更新时间。 */
  updatedAt: string;
}

/**
 * ProviderModelListView：供应商模型列表展示结构。
 *
 * 来源：`POST /api/provider/model-list`。
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
  /** model: 模型名称。 */
  model: string | null;
  /** projectId: 项目 ID。 */
  projectId: string | null;
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
 * 含义：展示全局或项目级 MCP JSON 配置。
 * 格式：根字段固定为 mcpServers。
 * 默认值：没有配置时由中心服务返回空对象。
 * 约束：保存时仍按 mcpServers 根字段提交。
 */
export interface McpConfigView {
  /** scope: 配置作用域，global 或 project。 */
  scope: "global" | "project";
  /** projectId: 项目级配置 ID，全局配置为 null。 */
  projectId: string | null;
  /** relativePath: 配置文件相对中心目录路径。 */
  relativePath: string;
  /** mcpServers: MCP Server 配置对象。 */
  mcpServers: Record<string, unknown>;
  /** updatedAt: 更新时间 ISO 字符串，文件缺失时为 null。 */
  updatedAt: string | null;
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
   * sendMessage：发送用户消息。
   *
   * @param payload 会话 ID 和 Markdown 内容。
   * @returns 消息、轮次和任务身份。
   */
  sendMessage(payload: {
    sessionId: string;
    contentMarkdown: string;
  }): Promise<{
    messageId: string;
    turnId: string;
    taskId: string;
  }> {
    return this.post("/api/session/message/send", payload);
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
    // formData：当前中心服务临时接口只消费元数据；这里保留 FormData 组装，确保后续接入二进制上传时 API 客户端边界不变。
    const formData = new FormData();
    formData.set("fileName", payload.fileName);
    formData.set("mimeType", payload.mimeType);
    formData.set("sizeBytes", String(payload.sizeBytes));
    if (payload.file) {
      formData.set("file", payload.file, payload.fileName);
    }

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
   * listProviders：查询供应商列表。
   *
   * @returns 供应商列表。
   */
  listProviders(): Promise<{
    providers: ProviderConfigView[];
  }> {
    return this.post("/api/provider/list", {});
  }

  /**
   * createProvider：新增供应商配置。
   *
   * @param payload 供应商配置表单。
   * @returns 新建供应商 ID 和密钥状态。
   */
  createProvider(payload: {
    providerName: string;
    protocolPluginId: string;
    protocolMode: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    enabled: boolean;
    capabilities: ProviderCapabilityDeclaration;
    proxyPolicy: ProviderProxyPolicy;
  }): Promise<{
    providerId: string;
    hasApiKey: boolean;
  }> {
    return this.post("/api/provider/create", payload);
  }

  /**
   * updateProvider：修改供应商配置。
   *
   * @param payload 供应商更新字段。
   * @returns 更新结果。
   */
  updateProvider(payload: {
    providerId: string;
    providerName?: string;
    protocolPluginId?: string;
    protocolMode?: string;
    baseUrl?: string;
    apiKey?: string;
    enabled?: boolean;
    defaultModel?: string;
    capabilities?: ProviderCapabilityDeclaration;
    proxyPolicy?: ProviderProxyPolicy;
  }): Promise<{
    providerId: string;
    enabled?: boolean;
    defaultModel?: string;
  }> {
    return this.post("/api/provider/update", payload);
  }

  /**
   * deleteProvider：按中心服务能力停用供应商。
   *
   * @param payload 供应商 ID。
   * @returns 更新结果。
   */
  deleteProvider(payload: {
    providerId: string;
  }): Promise<unknown> {
    return this.post("/api/provider/delete", payload);
  }

  /**
   * refreshProviderModels：刷新模型列表和推理深度。
   *
   * @param payload 供应商 ID、模型和推理深度数组。
   * @returns 刷新结果。
   */
  refreshProviderModels(payload: {
    providerId: string;
    models: string[];
    reasoningEfforts: string[];
  }): Promise<{
    providerId: string;
    models: string[];
    reasoningEfforts: string[];
  }> {
    return this.post("/api/provider/model-refresh", payload);
  }

  /**
   * listProviderModels：查询指定供应商已保存的模型列表。
   *
   * @param payload 供应商 ID。
   * @returns 模型列表和推理深度列表。
   */
  listProviderModels(payload: {
    providerId: string;
  }): Promise<ProviderModelListView> {
    return this.post("/api/provider/model-list", payload);
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
   * saveMcpConfig：保存 MCP 配置。
   *
   * @param payload 根字段为 mcpServers 的 MCP 配置。
   * @returns 保存文件路径。
   */
  saveMcpConfig(payload: {
    mcpServers: Record<string, unknown>;
    projectId?: string | null;
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

/**
 * ReconnectingWebSocketClient：中心服务 WebSocket 自动重连客户端。
 *
 * 用途：前端订阅实时事件，并在断线后按固定次数尝试重连。
 * 关键逻辑：重连次数和间隔显式配置，达到上限后进入停止状态，不无限静默重试。
 */
export class ReconnectingWebSocketClient {
  /**
   * socket: 当前 WebSocket 连接。
   */
  private socket: WebSocket | null = null;

  /**
   * retryCount: 已重试次数。
   */
  private retryCount = 0;

  /**
   * constructor：保存连接配置。
   *
   * @param options WebSocket 连接选项。
   */
  constructor(private readonly options: {
    url: string;
    clientId: string;
    clientType: ClientType;
    projectId: string | null;
    maxRetries: number;
    retryIntervalMs: number;
    onMessage: (message: WebSocketEnvelope) => void;
    onStateChange: (state: "connecting" | "open" | "retrying" | "stopped") => void;
  }) {}

  /**
   * connect：建立 WebSocket 连接。
   *
   * @returns 没有返回值。
   */
  connect(): void {
    this.options.onStateChange("connecting");
    this.socket = new WebSocket(this.options.url);
    this.socket.addEventListener("open", () => {
      this.retryCount = 0;
      this.options.onStateChange("open");
      this.sendHello();
    });
    this.socket.addEventListener("message", (event) => {
      this.options.onMessage(JSON.parse(String(event.data)) as WebSocketEnvelope);
    });
    this.socket.addEventListener("close", () => {
      this.scheduleReconnect();
    });
  }

  /**
   * close：主动关闭连接并停止重连。
   *
   * @returns 没有返回值。
   */
  close(): void {
    this.retryCount = this.options.maxRetries;
    this.socket?.close();
    this.options.onStateChange("stopped");
  }

  /**
   * sendHello：连接建立后发送 client.hello。
   *
   * @returns 没有返回值。
   */
  private sendHello(): void {
    this.socket?.send(JSON.stringify({
      type: "client.hello",
      payload: {
        clientId: this.options.clientId,
        clientType: this.options.clientType,
        projectId: this.options.projectId,
      },
    } satisfies WebSocketEnvelope));
  }

  /**
   * scheduleReconnect：按固定次数和间隔重连。
   *
   * @returns 没有返回值。
   */
  private scheduleReconnect(): void {
    if (this.retryCount >= this.options.maxRetries) {
      this.options.onStateChange("stopped");
      return;
    }

    this.retryCount += 1;
    this.options.onStateChange("retrying");
    window.setTimeout(() => {
      this.connect();
    }, this.options.retryIntervalMs);
  }
}
