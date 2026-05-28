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
} from "../api";

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
    // loadCenterState：并发读取中心服务公共状态。
    async loadCenterState(): Promise<void> {
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
          memories,
          usageSummary,
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
          fetchMemories(),
          fetchUsageSummary(),
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
        // memories：保存记忆快速查看结果。
        this.memories = memories;
        // usageSummary：保存用量统计聚合。
        this.usageSummary = usageSummary;
        // reconnectAttempt：成功连接后重置重试状态。
        this.reconnectAttempt = 0;
        // reconnectStopped：成功连接后允许后续断线重新重试。
        this.reconnectStopped = false;
      } catch (error) {
        // message：桌面端展示启动失败或连接失败原因。
        this.errorMessage = error instanceof Error ? error.message : "中心服务连接失败";
        // scheduleReconnect：连接失败时按明确次数自动重连。
        this.scheduleReconnect();
      } finally {
        // loading：结束刷新态。
        this.loading = false;
      }
    },
    // scheduleReconnect：中心服务断开后按次数和间隔自动重连。
    scheduleReconnect(): void {
      // stopped：超过次数后停止，避免无限静默重试。
      if (this.reconnectAttempt >= this.reconnectLimit) {
        this.reconnectStopped = true;
        return;
      }
      // reconnectAttempt：记录本轮重试次数，UI 可展示。
      this.reconnectAttempt += 1;
      // delayMs：固定间隔 2 秒，首版保持明确可理解。
      const delayMs = 2000;
      // setTimeout：到点后重新加载中心状态。
      window.setTimeout(() => {
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
