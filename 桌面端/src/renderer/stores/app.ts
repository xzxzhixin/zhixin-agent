import { defineStore } from "pinia";
import {
  AgentDefinition,
  CenterServiceLocalConfig,
  ClientPreferenceState,
  ClientType,
  ConversationSession,
  ExecutionMode,
  ExtensionManifest,
  HealthResponse,
  MemoryReadResult,
  ModelUsageSummary,
  NetworkProxyConfig,
  NotificationEvent,
  PendingMessageRecord,
  ProjectRegistration,
  ProviderConfig,
  RealtimeSyncSnapshot,
  RuntimeConfig,
  ThemeMode,
  TaskRecord,
} from "@zhixin/shared";
import {
  fetchAgents,
  fetchCenterConfig,
  fetchClientPreferences,
  fetchHealth,
  fetchMemories,
  fetchNotifications,
  fetchProjects,
  fetchProxies,
  fetchProviders,
  fetchRuntimes,
  fetchSessions,
  fetchSyncSnapshot,
  fetchTasks,
  fetchUsageSummary,
  saveClientPreference,
} from "../api";

// centerStateLoadingPromise：合并同一时间内的状态刷新请求，避免多个页面同时触发接口风暴。
let centerStateLoadingPromise: Promise<void> | null = null;
// reconnectTimerId：当前自动重连定时器，存在时不再重复排队新的重连。
let reconnectTimerId: number | null = null;

// useAppStore：桌面端公共状态，保存主题、连接、会话、项目、登录态、通知、执行模式和供应商选择。
export const useAppStore = defineStore("desktop-app", {
  state: () => ({
    // clientType：当前客户端类型固定为桌面端。
    clientType: "desktop" as ClientType,
    // themeMode：桌面端当前主题模式。
    themeMode: "light" as ThemeMode,
    // health：中心服务健康状态。
    health: null as HealthResponse | null,
    // centerConfig：中心服务本机配置。
    centerConfig: null as CenterServiceLocalConfig | null,
    // providers：中心服务供应商列表。
    providers: [] as ProviderConfig[],
    // proxies：中心服务网络代理配置列表，不包含认证明文。
    proxies: [] as NetworkProxyConfig[],
    // runtimes：中心服务运行环境列表。
    runtimes: [] as RuntimeConfig[],
    // preferences：按客户端类型保存的执行模式和通知配置。
    preferences: [] as ClientPreferenceState[],
    // sessions：普通会话、项目会话和团队智能体会话。
    sessions: [] as ConversationSession[],
    // projects：中心服务登记的项目列表。
    projects: [] as ProjectRegistration[],
    // agents：主智能体、团队智能体和子智能体定义。
    agents: [] as AgentDefinition[],
    // tasks：任务记录列表。
    tasks: [] as TaskRecord[],
    // notifications：中心服务同步的通知事件。
    notifications: [] as NotificationEvent[],
    // extensions：插件、MCP 和 skill 扩展能力状态。
    extensions: [] as ExtensionManifest[],
    // pendingMessages：断线后等待用户确认的本地排队消息。
    pendingMessages: [] as PendingMessageRecord[],
    // memories：中心目录记忆 Markdown 快速查看结果。
    memories: [] as MemoryReadResult[],
    // usageSummary：模型调用用量聚合结果。
    usageSummary: [] as ModelUsageSummary[],
    // reconnectAttempt：断线后自动重连次数。
    reconnectAttempt: 0,
    // reconnectLimit：自动重连最大次数，达到后进入停止状态。
    reconnectLimit: 5,
    // reconnectStopped：是否已经停止自动重连。
    reconnectStopped: false,
    // currentSessionId：当前桌面端窗口选中的会话 ID，属于本地 UI 状态。
    currentSessionId: "",
    // currentProjectId：当前桌面端窗口选中的项目 ID，属于本地 UI 状态。
    currentProjectId: "",
    // loginToken：桌面端本机使用不需要 Web 登录态，字段保留用于公共状态边界。
    loginToken: "",
    // selectedProviderId：供应商公共选择，只影响后续对话。
    selectedProviderId: "",
    // loading：中心状态加载中。
    loading: false,
    // errorMessage：中心服务连接或接口错误。
    errorMessage: "",
  }),
  getters: {
    // executionMode：当前客户端类型对应的执行模式，默认全自动。
    executionMode(state): ExecutionMode {
      // preference：只读取 desktop 对应配置，不跨客户端同步。
      const preference = state.preferences.find((item) => item.clientType === state.clientType);
      // return：中心服务缺失配置时使用需求默认值全自动。
      return preference?.executionMode ?? "full-auto";
    },
    // enabledProviderCount：启用供应商数量。
    enabledProviderCount(state): number {
      // filter：只统计 enabled 为 true 的供应商。
      return state.providers.filter((provider) => provider.enabled).length;
    },
    // connectionText：顶部连接状态文本。
    connectionText(state): string {
      // health：没有健康状态说明中心服务尚未连接。
      if (!state.health) {
        return "中心服务未连接";
      }
      // port：连接成功后展示端口。
      return `已连接 127.0.0.1:${state.health.port}`;
    },
  },
  actions: {
    // saveExecutionMode：保存桌面端执行模式，后续任务按新模式执行。
    async saveExecutionMode(mode: ExecutionMode): Promise<void> {
      // existing：优先复用中心服务已保存的桌面端偏好。
      const existing = this.preferences.find((item) => item.clientType === this.clientType);
      // fallback：中心服务尚未返回偏好时创建同协议默认通知配置，避免只保存半截偏好。
      const fallback: ClientPreferenceState = {
        // clientType：当前桌面端客户端类型。
        clientType: this.clientType,
        // executionMode：用户在输入框下拉框中选择的模式。
        executionMode: mode,
        // notificationConfig：缺少中心偏好时使用需求默认通知配置。
        notificationConfig: {
          // clientType：通知配置归属桌面端。
          clientType: this.clientType,
          // enabled：默认开启通知，来源于中心服务默认偏好。
          enabled: true,
          // inactiveOnly：默认仅窗口不活跃时通知，来源于中心服务默认偏好。
          inactiveOnly: true,
          // notifyNormalChat：默认通知普通对话。
          notifyNormalChat: true,
          // notifyProjectChat：默认通知项目对话。
          notifyProjectChat: true,
          // notifyTeamAgentChat：默认通知团队智能体对话。
          notifyTeamAgentChat: true,
          // notifyFailures：默认通知失败或需要处理的对话。
          notifyFailures: true,
        },
      };
      // next：只替换执行模式，保留原有通知配置。
      const next: ClientPreferenceState = {
        ...(existing ?? fallback),
        executionMode: mode,
      };
      // preferences：保存后使用中心服务返回的完整偏好列表。
      this.preferences = await saveClientPreference(next);
    },
    // loadMemories：按需读取中心目录记忆全文，避免普通状态刷新反复加载大文件。
    async loadMemories(): Promise<void> {
      // memories：记忆查看页面或显式动作需要时再加载。
      this.memories = await fetchMemories();
    },
    // loadUsageSummary：按需读取用量统计聚合，避免每次状态同步都解析完整用量记录。
    async loadUsageSummary(): Promise<void> {
      // usageSummary：用量统计页面进入时单独刷新。
      this.usageSummary = await fetchUsageSummary();
    },
    // clearReconnectTimer：连接恢复或手动刷新成功后清理待执行重连。
    clearReconnectTimer(): void {
      // reconnectTimerId：只清理本 store 管理的重连定时器。
      if (reconnectTimerId === null) {
        return;
      }
      // clearTimeout：成功连接后不需要再执行旧的失败重试。
      window.clearTimeout(reconnectTimerId);
      reconnectTimerId = null;
    },
    // loadCenterState：并发读取中心服务公共状态，不包含记忆全文和用量全量聚合。
    async loadCenterState(): Promise<void> {
      // inFlight：已有刷新时复用同一个 Promise，避免重复打中心服务接口。
      if (centerStateLoadingPromise) {
        return centerStateLoadingPromise;
      }
      centerStateLoadingPromise = (async () => {
        // loading：进入刷新态。
        this.loading = true;
        // errorMessage：清理旧错误。
        this.errorMessage = "";
        try {
          // Promise.all：这些接口互不依赖，可以并发读取。
          const [
            health,
            centerConfig,
            providers,
            proxies,
            runtimes,
            preferences,
            sessions,
            projects,
            agents,
            tasks,
            notifications,
            syncSnapshot,
          ] = await Promise.all([
            fetchHealth(),
            fetchCenterConfig(),
            fetchProviders(),
            fetchProxies(),
            fetchRuntimes(),
            fetchClientPreferences(),
            fetchSessions(),
            fetchProjects(),
            fetchAgents(),
            fetchTasks(),
            fetchNotifications(),
            fetchSyncSnapshot(),
          ]);
          // health：保存中心服务状态。
          this.health = health;
          // centerConfig：保存本机配置。
          this.centerConfig = centerConfig;
          // providers：保存供应商列表。
          this.providers = providers;
          // proxies：保存代理配置列表。
          this.proxies = proxies;
          // runtimes：保存运行环境列表。
          this.runtimes = runtimes;
          // preferences：保存客户端偏好。
          this.preferences = preferences;
          // sessions：保存会话列表。
          this.sessions = sessions;
          // projects：保存项目列表。
          this.projects = projects;
          // agents：保存智能体列表。
          this.agents = agents;
          // tasks：保存任务列表。
          this.tasks = tasks;
          // notifications：保存通知事件。
          this.notifications = notifications;
          // extensions：同步插件、MCP 和 skill 状态。
          this.extensions = syncSnapshot.extensions;
          // pendingMessages：恢复连接后等待用户确认。
          this.pendingMessages = syncSnapshot.pendingMessages;
          // reconnectAttempt：成功连接后重置重试状态。
          this.reconnectAttempt = 0;
          // reconnectStopped：成功连接后允许后续断线重新重试。
          this.reconnectStopped = false;
          // clearReconnectTimer：连接已经恢复，取消旧的重连计划。
          this.clearReconnectTimer();
        } catch (error) {
          // health：请求失败说明当前 HTTP 健康状态不可用，必须清空旧连接状态。
          this.health = null;
          // message：桌面端展示启动失败或连接失败原因。
          this.errorMessage = error instanceof Error ? error.message : "中心服务连接失败";
          // scheduleReconnect：连接失败时按明确次数自动重连。
          this.scheduleReconnect();
        } finally {
          // loading：结束刷新态。
          this.loading = false;
          // centerStateLoadingPromise：本轮请求结束后允许下一次真实刷新。
          centerStateLoadingPromise = null;
        }
      })();
      return centerStateLoadingPromise;
    },
    // scheduleReconnect：中心服务断开后按次数和间隔自动重连。
    scheduleReconnect(): void {
      // stopped：超过次数后停止，避免无限静默重试。
      if (this.reconnectAttempt >= this.reconnectLimit) {
        this.reconnectStopped = true;
        return;
      }
      // pending：已有重连定时器时不重复排队，避免失败路径叠加请求风暴。
      if (reconnectTimerId !== null) {
        return;
      }
      // reconnectAttempt：记录本轮重试次数，UI 可展示。
      this.reconnectAttempt += 1;
      // delayMs：固定间隔 2 秒，首版保持明确可理解。
      const delayMs = 2000;
      // setTimeout：到点后重新加载中心状态。
      reconnectTimerId = window.setTimeout(() => {
        // reconnectTimerId：定时器已触发，允许后续失败重新排队下一轮。
        reconnectTimerId = null;
        void this.loadCenterState();
      }, delayMs);
    },
    // applySyncSnapshot：应用中心服务业务状态快照。
    applySyncSnapshot(snapshot: RealtimeSyncSnapshot): void {
      // projects：同步项目列表。
      this.projects = snapshot.projects;
      // sessions：同步聊天会话。
      this.sessions = snapshot.sessions;
      // agents：同步智能体状态。
      this.agents = snapshot.agents;
      // tasks：同步任务状态。
      this.tasks = snapshot.tasks;
      // providers：同步供应商状态。
      this.providers = snapshot.providers;
      // extensions：同步插件、MCP 和 skill 状态。
      this.extensions = snapshot.extensions;
      // notifications：同步通知事件。
      this.notifications = snapshot.notifications;
      // pendingMessages：同步待确认排队消息。
      this.pendingMessages = snapshot.pendingMessages;
    },
    // toggleTheme：切换桌面端亮色和暗黑主题。
    toggleTheme(): void {
      // themeMode：只影响桌面端当前窗口。
      this.themeMode = this.themeMode === "light" ? "dark" : "light";
      // classList：Element Plus 暗黑变量使用 html.dark。
      document.documentElement.classList.toggle("dark", this.themeMode === "dark");
    },
  },
});
