import {
  AgentDefinition,
  AttachmentUploadRequest,
  CenterServiceLocalConfig,
  ClientPreferenceState,
  ConversationSession,
  DEFAULT_CENTER_PORT,
  ExtensionCallRecord,
  ExtensionManifest,
  HealthResponse,
  MemoryReadResult,
  MessageAttachment,
  ModelUsageRecord,
  ModelUsageSummary,
  NotificationEvent,
  ProjectRegistration,
  NetworkProxyConfig,
  PendingMessageRecord,
  ProviderConfig,
  ProviderUpsertRequest,
  RealtimeSyncSnapshot,
  RuntimeConfig,
  RuntimeExecutionRequest,
  RuntimeExecutionSelection,
  TaskRecord,
} from "@zhixin/shared";

// CENTER_BASE_URL：桌面端渲染层连接由桌面端管理的本机中心服务。
const CENTER_BASE_URL = `http://127.0.0.1:${DEFAULT_CENTER_PORT}`;

// requestJson：桌面端渲染层访问中心服务的统一 JSON 请求方法。
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  // response：中心服务 API 当前返回 JSON。
  const response = await fetch(`${CENTER_BASE_URL}${path}`, {
    // headers：所有写入接口都使用 JSON 协议。
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  // ok：非 2xx 转成错误，用于页面展示启动失败或端口错误。
  if (!response.ok) {
    throw new Error(`中心服务请求失败：${response.status}`);
  }
  // json：调用方获得结构化响应。
  return response.json() as Promise<T>;
}

// fetchHealth：读取中心服务健康状态。
export function fetchHealth(): Promise<HealthResponse> {
  // /health：桌面端启动后用于确认中心服务已就绪。
  return requestJson<HealthResponse>("/health");
}

// fetchCenterConfig：读取中心服务本机配置。
export function fetchCenterConfig(): Promise<CenterServiceLocalConfig> {
  // /config：包含端口、中心目录、Web 账号和通知权限状态。
  return requestJson<CenterServiceLocalConfig>("/config");
}

// saveCenterConfig：保存中心服务本机配置。
export function saveCenterConfig(config: Partial<CenterServiceLocalConfig> & { webPassword?: string }): Promise<CenterServiceLocalConfig> {
  // PUT /config：端口和中心目录修改后由桌面端提示重启生效。
  return requestJson<CenterServiceLocalConfig>("/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

// fetchProviders：读取供应商配置列表。
export function fetchProviders(): Promise<ProviderConfig[]> {
  // /providers：API Key 明文不会返回给渲染层。
  return requestJson<ProviderConfig[]>("/providers");
}

// fetchProxies：读取网络代理配置列表。
export function fetchProxies(): Promise<NetworkProxyConfig[]> {
  // /proxies：代理用户名和密码明文不会返回给渲染层。
  return requestJson<NetworkProxyConfig[]>("/proxies");
}

// fetchRuntimes：读取运行环境配置列表。
export function fetchRuntimes(): Promise<RuntimeConfig[]> {
  // /runtimes：用于桌面端配置 Node、Python、Java、Maven、Git。
  return requestJson<RuntimeConfig[]>("/runtimes");
}

// fetchClientPreferences：读取客户端执行模式和通知配置。
export function fetchClientPreferences(): Promise<ClientPreferenceState[]> {
  // /client-preferences：不同客户端类型之间不强制同步。
  return requestJson<ClientPreferenceState[]>("/client-preferences");
}

// saveClientPreference：保存当前客户端类型的执行模式和通知偏好。
export function saveClientPreference(preference: ClientPreferenceState): Promise<ClientPreferenceState[]> {
  // /client-preferences：中心服务按 clientType 替换对应偏好。
  return requestJson<ClientPreferenceState[]>("/client-preferences", {
    method: "POST",
    body: JSON.stringify(preference),
  });
}

// fetchProjects：读取项目列表。
export function fetchProjects(): Promise<ProjectRegistration[]> {
  // /projects：工程对话按项目分组展示。
  return requestJson<ProjectRegistration[]>("/projects");
}

// fetchSessions：读取会话列表。
export function fetchSessions(): Promise<ConversationSession[]> {
  // /sessions：普通对话、项目对话和团队智能体会话统一读取。
  return requestJson<ConversationSession[]>("/sessions");
}

// fetchAgents：读取智能体定义列表。
export function fetchAgents(): Promise<AgentDefinition[]> {
  // /agents：用于展示主智能体、团队智能体和子智能体状态。
  return requestJson<AgentDefinition[]>("/agents");
}

// fetchTasks：读取任务记录列表。
export function fetchTasks(): Promise<TaskRecord[]> {
  // /tasks：用于同步任务执行状态。
  return requestJson<TaskRecord[]>("/tasks");
}

// fetchNotifications：读取通知事件列表。
export function fetchNotifications(): Promise<NotificationEvent[]> {
  // /notifications：客户端只做未读状态、提示条和跳转定位。
  return requestJson<NotificationEvent[]>("/notifications");
}

// uploadAttachment：保存剪贴板图片附件到中心服务会话附件目录。
export function uploadAttachment(request: AttachmentUploadRequest): Promise<MessageAttachment> {
  // /attachments：中心服务生成附件 ID 和受控存储路径。
  return requestJson<MessageAttachment>("/attachments", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// createSession：创建普通或项目会话。
export function createSession(request: Partial<ConversationSession>): Promise<ConversationSession> {
  // /sessions：中心服务补齐 ID、时间和默认智能体。
  return requestJson<ConversationSession>("/sessions", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// appendMessage：追加会话消息，已发送消息由中心服务继续处理状态。
export function appendMessage(request: Partial<import("@zhixin/shared").ConversationMessage> & { sessionId: string }): Promise<import("@zhixin/shared").ConversationMessage> {
  // /messages：消息包含文本、附件和上下文引用。
  return requestJson<import("@zhixin/shared").ConversationMessage>("/messages", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// savePendingMessage：保存断线后待用户确认的排队消息。
export function savePendingMessage(request: Partial<PendingMessageRecord> & { sessionId: string; content: string }): Promise<PendingMessageRecord> {
  // /pending-messages：恢复连接后不能自动发送。
  return requestJson<PendingMessageRecord>("/pending-messages", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// fetchSyncSnapshot：读取多端同步快照。
export function fetchSyncSnapshot(): Promise<RealtimeSyncSnapshot> {
  // /sync：同步业务状态，不同步当前窗口和滚动位置。
  return requestJson<RealtimeSyncSnapshot>("/sync");
}

// saveProvider：新增或修改供应商，中心服务自动刷新模型和推理深度。
export function saveProvider(request: ProviderUpsertRequest): Promise<ProviderConfig> {
  // /providers：API Key 只在本次请求中进入中心服务。
  return requestJson<ProviderConfig>("/providers", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// saveAgent：保存主智能体或团队智能体配置。
export function saveAgent(request: Partial<AgentDefinition>): Promise<AgentDefinition> {
  // /agents：团队智能体会同步固化 Markdown 定义。
  return requestJson<AgentDefinition>("/agents", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// fetchMemories：快速查看中心目录记忆 Markdown。
export function fetchMemories(): Promise<MemoryReadResult[]> {
  // /memories：中心服务并发读取记忆文件。
  return requestJson<MemoryReadResult[]>("/memories");
}

// saveUsageRecord：追加模型调用用量记录。
export function saveUsageRecord(request: ModelUsageRecord): Promise<ModelUsageRecord> {
  // /usage：用量统计只追加记录。
  return requestJson<ModelUsageRecord>("/usage", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// fetchUsageSummary：读取供应商、模型、项目和时间范围聚合用量。
export function fetchUsageSummary(): Promise<ModelUsageSummary[]> {
  // /usage：当前页面默认读取全部聚合。
  return requestJson<ModelUsageSummary[]>("/usage");
}

// saveExtension：安装或更新插件、MCP 或 skill。
export function saveExtension(request: Partial<ExtensionManifest> & { name: string; type: ExtensionManifest["type"] }): Promise<ExtensionManifest> {
  // /extensions：扩展权限和能力声明由中心服务保存。
  return requestJson<ExtensionManifest>("/extensions", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// appendExtensionCall：记录扩展能力调用审计。
export function appendExtensionCall(request: ExtensionCallRecord): Promise<ExtensionCallRecord> {
  // /extensions/calls：MCP 工具调用等进入调用记录。
  return requestJson<ExtensionCallRecord>("/extensions/calls", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// selectRuntime：为插件、MCP、skill 或命令任务选择运行环境。
export function selectRuntime(request: RuntimeExecutionRequest): Promise<RuntimeExecutionSelection> {
  // /runtime-selection：未指定时使用默认启用环境。
  return requestJson<RuntimeExecutionSelection>("/runtime-selection", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
