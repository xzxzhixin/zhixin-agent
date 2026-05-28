import {
  AgentDefinition,
  AttachmentUploadRequest,
  CenterServiceLocalConfig,
  ClientPreferenceState,
  ConversationSession,
  ConversationMessage,
  DEFAULT_CENTER_PORT,
  ExtensionCallRecord,
  ExtensionManifest,
  HealthResponse,
  AuthStatusResponse,
  LoginRequest,
  LoginResponse,
  MemoryReadResult,
  MessageAttachment,
  ModelUsageRecord,
  ModelUsageSummary,
  NetworkProxyConfig,
  NotificationEvent,
  PendingMessageRecord,
  ProjectRegistration,
  ProviderConfig,
  ProviderUpsertRequest,
  RealtimeSyncSnapshot,
  RuntimeConfig,
  RuntimeExecutionRequest,
  RuntimeExecutionSelection,
  TaskRecord,
} from "@zhixin/shared";

// VITE_DEV_PORTS：Vite 开发预览端口，开发时需要跨端口访问本机中心服务。
const VITE_DEV_PORTS = [
  "5173",
  "4173",
];

// CENTER_BASE_URL：生产环境使用当前中心服务来源，Vite 开发时连接本机默认中心服务端口。
const CENTER_BASE_URL = VITE_DEV_PORTS.includes(window.location.port)
  ? `http://127.0.0.1:${DEFAULT_CENTER_PORT}`
  : window.location.origin;

// requestJson：Web端访问中心服务的统一 JSON 请求方法。
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  // response：中心服务 API 当前返回 JSON。
  const response = await fetch(`${CENTER_BASE_URL}${path}`, {
    ...init,
    // credentials：登录态由中心服务 HttpOnly Cookie 保存和传递，前端不保存 token。
    credentials: "include",
    // headers：所有写入接口都使用 JSON 协议，认证凭据由 credentials 携带 Cookie。
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  // ok：非 2xx 统一转成错误，便于页面提示失败原因。
  if (!response.ok) {
    throw new Error(`中心服务请求失败：${response.status}`);
  }
  // json：调用方通过泛型获得结构化结果。
  return response.json() as Promise<T>;
}

// fetchAuthStatus：读取中心服务判定后的 Web 访问控制状态。
export function fetchAuthStatus(): Promise<AuthStatusResponse> {
  // /auth/status：本机访问和 Cookie 登录态都由中心服务判断。
  return requestJson<AuthStatusResponse>("/auth/status");
}

// loginWeb：非本机 Web 访问登录。
export function loginWeb(request: LoginRequest): Promise<LoginResponse> {
  // /auth/login：中心服务校验桌面端配置的账号密码。
  return requestJson<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// fetchHealth：读取中心服务健康状态。
export function fetchHealth(): Promise<HealthResponse> {
  // /health：中心服务连接检查接口。
  return requestJson<HealthResponse>("/health");
}

// fetchCenterConfig：读取中心服务本机配置。
export function fetchCenterConfig(): Promise<CenterServiceLocalConfig> {
  // /config：Web端只读取，不负责修改账号密码。
  return requestJson<CenterServiceLocalConfig>("/config");
}

// fetchProviders：读取供应商配置列表。
export function fetchProviders(): Promise<ProviderConfig[]> {
  // /providers：不包含 API Key 明文。
  return requestJson<ProviderConfig[]>("/providers");
}

// fetchProxies：读取网络代理配置列表。
export function fetchProxies(): Promise<NetworkProxyConfig[]> {
  // /proxies：不包含代理用户名和密码明文。
  return requestJson<NetworkProxyConfig[]>("/proxies");
}

// fetchRuntimes：读取运行环境配置列表。
export function fetchRuntimes(): Promise<RuntimeConfig[]> {
  // /runtimes：包含 Node.js、Python、Java、Maven、Git 环境模板。
  return requestJson<RuntimeConfig[]>("/runtimes");
}

// fetchClientPreferences：读取客户端执行模式和通知配置。
export function fetchClientPreferences(): Promise<ClientPreferenceState[]> {
  // /client-preferences：Web端只同步 web 类型配置。
  return requestJson<ClientPreferenceState[]>("/client-preferences");
}

// fetchProjects：读取项目列表。
export function fetchProjects(): Promise<ProjectRegistration[]> {
  // /projects：Web端可查看所有项目对话。
  return requestJson<ProjectRegistration[]>("/projects");
}

// fetchSessions：读取会话列表。
export function fetchSessions(): Promise<ConversationSession[]> {
  // /sessions：Web端展示所有普通对话和项目对话。
  return requestJson<ConversationSession[]>("/sessions");
}

// fetchAgents：读取智能体定义列表。
export function fetchAgents(): Promise<AgentDefinition[]> {
  // /agents：用于展示主智能体和团队智能体状态。
  return requestJson<AgentDefinition[]>("/agents");
}

// fetchTasks：读取任务记录列表。
export function fetchTasks(): Promise<TaskRecord[]> {
  // /tasks：用于同步任务执行状态。
  return requestJson<TaskRecord[]>("/tasks");
}

// fetchNotifications：读取通知事件列表。
export function fetchNotifications(): Promise<NotificationEvent[]> {
  // /notifications：Web端收到后可触发浏览器通知或页面内通知。
  return requestJson<NotificationEvent[]>("/notifications");
}

// uploadAttachment：保存剪贴板图片附件到中心服务会话附件目录。
export function uploadAttachment(request: AttachmentUploadRequest): Promise<MessageAttachment> {
  // /attachments：中心服务控制附件存储路径。
  return requestJson<MessageAttachment>("/attachments", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// createSession：创建普通、项目或团队智能体会话。
export function createSession(request: Partial<ConversationSession>): Promise<ConversationSession> {
  // /sessions：中心服务补齐默认智能体和时间。
  return requestJson<ConversationSession>("/sessions", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// appendMessage：追加会话消息。
export function appendMessage(request: Partial<ConversationMessage> & { sessionId: string }): Promise<ConversationMessage> {
  // /messages：发送成功后由中心服务继续维护会话状态。
  return requestJson<ConversationMessage>("/messages", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// savePendingMessage：保存断线排队且待用户确认的消息。
export function savePendingMessage(request: Partial<PendingMessageRecord> & { sessionId: string; content: string }): Promise<PendingMessageRecord> {
  // /pending-messages：恢复连接后不能自动发送。
  return requestJson<PendingMessageRecord>("/pending-messages", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// fetchSyncSnapshot：读取多端业务状态同步快照。
export function fetchSyncSnapshot(): Promise<RealtimeSyncSnapshot> {
  // /sync：不包含本地布局、页签和滚动位置。
  return requestJson<RealtimeSyncSnapshot>("/sync");
}

// saveProvider：新增或修改供应商。
export function saveProvider(request: ProviderUpsertRequest): Promise<ProviderConfig> {
  // /providers：中心服务自动刷新模型和推理深度。
  return requestJson<ProviderConfig>("/providers", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// saveAgent：新增或修改智能体。
export function saveAgent(request: Partial<AgentDefinition>): Promise<AgentDefinition> {
  // /agents：团队智能体定义会固化为 Markdown。
  return requestJson<AgentDefinition>("/agents", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// fetchMemories：读取中心目录记忆文件。
export function fetchMemories(): Promise<MemoryReadResult[]> {
  // /memories：供 UI 快速查看记忆。
  return requestJson<MemoryReadResult[]>("/memories");
}

// saveUsageRecord：追加模型调用用量记录。
export function saveUsageRecord(request: ModelUsageRecord): Promise<ModelUsageRecord> {
  // /usage：历史记录只追加，不回改。
  return requestJson<ModelUsageRecord>("/usage", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// fetchUsageSummary：读取用量统计聚合。
export function fetchUsageSummary(): Promise<ModelUsageSummary[]> {
  // /usage：默认读取全部供应商和项目聚合。
  return requestJson<ModelUsageSummary[]>("/usage");
}

// saveExtension：安装或更新插件、MCP 或 skill。
export function saveExtension(request: Partial<ExtensionManifest> & { name: string; type: ExtensionManifest["type"] }): Promise<ExtensionManifest> {
  // /extensions：扩展能力不能绕过中心服务核心状态。
  return requestJson<ExtensionManifest>("/extensions", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// appendExtensionCall：记录扩展调用审计。
export function appendExtensionCall(request: ExtensionCallRecord): Promise<ExtensionCallRecord> {
  // /extensions/calls：MCP 工具调用进入调用记录。
  return requestJson<ExtensionCallRecord>("/extensions/calls", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// selectRuntime：按任务需要选择运行环境。
export function selectRuntime(request: RuntimeExecutionRequest): Promise<RuntimeExecutionSelection> {
  // /runtime-selection：未指定时使用同类型默认启用环境。
  return requestJson<RuntimeExecutionSelection>("/runtime-selection", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
