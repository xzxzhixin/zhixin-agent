import { defineStore } from "pinia";
import {
  AgentDefinition,
  AuthStatusResponse,
  CenterServiceLocalConfig,
  ClientPreferenceState,
  ClientType,
  ConversationSession,
  ExecutionMode,
  ExtensionManifest,
  HealthResponse,
  MemoryReadResult,
  ModelUsageSummary,
  LoginRequest,
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
  fetchAuthStatus,
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
  loginWeb,
} from "../api";

// centerStateLoadingPromise：合并同一时间内的状态刷新请求，避免页面和发送动作重复打接口。
let centerStateLoadingPromise: Promise<void> | null = null;
// reconnectTimerId：当前自动重连定时器，存在时不再重复排队新的重连。
let reconnectTimerId: number | null = null;

// useAppStore：Web端公共状态，桌面浏览器和手机浏览器共用。
export const useAppStore = defineStore("web-app", {
  state: () => ({
    // clientType：当前客户端类型固定为 Web。
    clientType: "web" as ClientType,
    // themeMode：Web端当前主题模式。
    themeMode: "light" as ThemeMode,
    // health：中心服务健康状态。
    health: null as HealthResponse | null,
    // centerConfig：中心服务本机配置，Web端只读。
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
    // agents：智能体定义列表。
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
    // authStatus：中心服务判定后的 Web 访问控制状态，前端不自行推断本机访问。
    authStatus: null as AuthStatusResponse | null,
    // currentSessionId：当前 Web 页面选中的会话 ID，属于本地 UI 状态。
    currentSessionId: "",
    // currentProjectId：当前 Web 页面选中的项目 ID，属于本地 UI 状态。
    currentProjectId: "",
    // selectedProviderId：供应商公共选择，只影响后续对话。
    selectedProviderId: "",
    // loading：中心状态加载中。
    loading: false,
    // errorMessage：中心服务连接或接口错误。
    errorMessage: "",
    // reconnectAttempt：自动重连次数。
    reconnectAttempt: 0,
    // reconnectLimit：自动重连最大次数。
    reconnectLimit: 5,
    // reconnectStopped：是否已停止自动重连。
    reconnectStopped: false,
    // pageNotificationMessage：浏览器通知不可用时显示的页面内通知。
    pageNotificationMessage: "",
  }),
  getters: {
    // executionMode：当前 Web 客户端类型对应的执行模式，默认全自动。
    executionMode(state): ExecutionMode {
      // preference：只读取 web 对应配置，不跨客户端同步。
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
      // health：没有健康状态时展示未连接。
      if (!state.health) {
        return "中心服务未连接";
      }
      // port：连接成功后展示端口。
      return `已连接 127.0.0.1:${state.health.port}`;
    },
  },
  actions: {
    // login：非本机 Web 访问登录，真实登录态由中心服务写入 HttpOnly Cookie。
    async login(request: LoginRequest): Promise<void> {
      // response：中心服务返回认证摘要，不返回 Cookie 中的真实 token。
      const response = await loginWeb(request);
      // authStatus：保存服务端认证结果，刷新后通过 /auth/status 重新确认。
      this.authStatus = response;
    },
    // refreshAuthStatus：读取中心服务认证状态供路由守卫使用。
    async refreshAuthStatus(): Promise<AuthStatusResponse> {
      // status：本机访问、非本机访问和 Cookie 有效性都由中心服务判断。
      const status = await fetchAuthStatus();
      // authStatus：保存最新访问控制状态。
      this.authStatus = status;
      // return：路由守卫需要同步使用判定结果。
      return status;
    },
    // loadMemories：按需读取中心目录记忆全文，避免普通状态刷新反复加载大文件。
    async loadMemories(): Promise<void> {
      // memories：记忆查看入口需要时再加载。
      this.memories = await fetchMemories();
    },
    // loadUsageSummary：按需读取用量统计聚合，避免每次状态同步都解析完整用量记录。
    async loadUsageSummary(): Promise<void> {
      // usageSummary：用量统计相关页面或侧栏需要时单独刷新。
      this.usageSummary = await fetchUsageSummary();
    },
    // clearReconnectTimer：连接恢复后清理待执行重连。
    clearReconnectTimer(): void {
      // reconnectTimerId：只清理本 store 管理的重连定时器。
      if (reconnectTimerId === null) {
        return;
      }
      // clearTimeout：成功连接后不执行旧失败重试。
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
            authStatus,
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
            fetchAuthStatus(),
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
          // authStatus：保存中心服务端认证状态。
          this.authStatus = authStatus;
          // centerConfig：保存中心服务配置。
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
          // notifyInBrowser：Web端收到通知事件后按浏览器或页面内通知提醒。
          this.notifyInBrowser(notifications);
        } catch (error) {
          // message：页面提示用户需要启动桌面端或中心服务。
          this.errorMessage = error instanceof Error ? error.message : "中心服务连接失败";
          // scheduleReconnect：连接失败后按明确次数重连。
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
      // stopped：超过次数后进入停止状态，不无限静默重试。
      if (this.reconnectAttempt >= this.reconnectLimit) {
        this.reconnectStopped = true;
        return;
      }
      // pending：已有重连定时器时不重复排队，避免失败路径叠加请求风暴。
      if (reconnectTimerId !== null) {
        return;
      }
      // reconnectAttempt：记录当前重试次数，供 UI 展示。
      this.reconnectAttempt += 1;
      // delayMs：固定间隔 2 秒。
      const delayMs = 2000;
      // setTimeout：延迟后重新读取中心状态。
      reconnectTimerId = window.setTimeout(() => {
        // reconnectTimerId：定时器已触发，允许后续失败重新排队下一轮。
        reconnectTimerId = null;
        void this.loadCenterState();
      }, delayMs);
    },
    // applySyncSnapshot：应用中心服务业务状态快照。
    applySyncSnapshot(snapshot: RealtimeSyncSnapshot): void {
      // projects：同步项目状态。
      this.projects = snapshot.projects;
      // sessions：同步聊天状态。
      this.sessions = snapshot.sessions;
      // agents：同步智能体状态。
      this.agents = snapshot.agents;
      // tasks：同步任务状态。
      this.tasks = snapshot.tasks;
      // providers：同步供应商状态。
      this.providers = snapshot.providers;
      // extensions：同步扩展能力状态。
      this.extensions = snapshot.extensions;
      // notifications：同步通知事件。
      this.notifications = snapshot.notifications;
      // pendingMessages：同步待确认排队消息。
      this.pendingMessages = snapshot.pendingMessages;
    },
    // notifyInBrowser：Web端收到通知事件后尝试浏览器通知，失败则页面内提示。
    notifyInBrowser(events: NotificationEvent[]): void {
      // latest：只处理最近一条通知，避免首次加载大量历史通知打扰用户。
      const latest = events.at(-1);
      // missing：没有通知时不处理。
      if (!latest) {
        return;
      }
      // granted：浏览器通知权限允许时发送系统通知。
      if ("Notification" in window && Notification.permission === "granted") {
        // Notification：Web端需要在浏览器里再提醒一次。
        new Notification(latest.title, {
          body: latest.summary,
        });
        return;
      }
      // request：未决定权限时请求一次权限。
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission().then((permission) => {
          if (permission === "granted") {
            new Notification(latest.title, {
              body: latest.summary,
            });
          } else {
            this.pageNotificationMessage = `${latest.title}：${latest.summary}`;
          }
        });
        return;
      }
      // fallback：没有权限或浏览器不支持时至少展示页面内通知。
      this.pageNotificationMessage = `${latest.title}：${latest.summary}`;
    },
    // toggleTheme：切换亮色和暗黑主题。
    toggleTheme(): void {
      // themeMode：只切换当前 Web 端本地 UI 状态，不强制同步其他端。
      this.themeMode = this.themeMode === "light" ? "dark" : "light";
      // classList：Element Plus 暗黑主题通过 html.dark 生效。
      document.documentElement.classList.toggle("dark", this.themeMode === "dark");
    },
  },
});
