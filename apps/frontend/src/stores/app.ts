import {defineStore} from "pinia";
import {marked} from "marked";
import {
    ElMessageBox,
} from "element-plus";

import {
    CenterApiClient,
    ReconnectingWebSocketClient,
    type AccessAuthorizeResult,
    type AgentConfigView,
    type McpConfigView,
    type PluginConfigView,
    type ProviderCapabilityDeclaration,
    type ProviderConfigView,
    type ProviderModelListView,
    type ProviderProtocolPluginView,
    type ProviderProxyPolicy,
    type ProxyConfigView,
    type RuntimeConfigView,
    type SessionDetailResult,
    type SessionUpdatedPayload,
    type SkillConfigView,
    type UsageFilters,
} from "@zhixin/api-client";
import {
    createEmptyComposerDraft,
    type ComposerDraftModel,
} from "@zhixin/ui";
import type {
    ConversationSession,
    EntryMode,
    EventRecord,
    ProjectRecord,
    TaskRecord,
} from "@zhixin/shared";

import {
    detectRuntimeEnvironment,
    type RuntimeEnvironment,
    type ThemeMode,
} from "../runtime";
import {
    buildProviderModelRefreshDraft, convertIdePayloadToReference, createDefaultAgentStatusTree,
    createMcpDraft, createPluginDraft, createAgentDraft, createProjectCodeSuggestion,
    createProjectFileSuggestion, createProjectFolderSuggestion, createProviderDraft,
    createProxyDraft, createRuntimeDraft, createSkillDraft, createUsageFilters,
    fallbackProjectsFromSessions, formatReferenceMarkdown,
    mergeAgentStatusTree, normalizeOptionalText, parseEnvironmentVariables, readPluginConfig,
    formatJsonText, resolveComposerProjectId,
} from "./app-helpers";
import {
    createManagementActions,
} from "./app-management-actions";
import {
    createDesktopActions,
} from "./app-desktop-actions";
import {
    createConversationActions,
} from "./app-conversation-actions";
import {
    createProjectActions,
} from "./app-project-actions";

/**
 * SessionDeletedPayload：中心服务 `session.deleted` 专项 WebSocket 载荷。
 *
 * 来源：中心服务删除会话事件 payload。
 * 含义：通知其他端某个会话已被中心服务删除。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：sessionId 必须来自中心服务事件，前端不能自行拼装其他候选字段。
 */
interface SessionDeletedPayload {
    /** sessionId: 被删除会话的中心服务事实 ID。 */
    sessionId: string;
    /** sessionType: 被删除会话类型，用于导航刷新和审计展示。 */
    sessionType: "normal" | "project";
    /** projectId: 项目会话所属项目 ID；普通会话为 null。 */
    projectId: string | null;
}
import type {
    AgentStatusTreeNode,
    AgentDraft,
    ComposerEditFile,
    ComposerSettings,
    DesktopCenterStatus,
    IdeContextReferenceMessage,
    IdeContextReferencePayload,
    McpDraft,
    PendingSessionDraft,
    PluginDraft,
    ProjectCapabilitySummary,
    ProjectConversationGroup,
    ProjectReferenceSuggestion,
    ProviderDraft,
    ProxyDraft,
    RuntimeDraft,
    SkillDraft,
    ComposerContextUsageState,
    RunningTurnSnapshotRecoveryState,
    QueuedComposerMessage,
} from "./app-types";

/**
 * useAppStore：统一前端状态容器。
 *
 * 用途：保存 UI 状态、中心服务连接状态和当前会话订阅状态。
 * 关键逻辑：核心事实从中心服务接口读取，Pinia 不作为业务事实源。
 */
export const useAppStore = defineStore("app", {
    state: () => ({
        /**
         * runtime: 当前前端运行时环境。
         */
        runtime: detectRuntimeEnvironment() as RuntimeEnvironment,

        /**
         * authorization: 中心服务返回的客户端授权结果。
         */
        authorization: null as AccessAuthorizeResult | null,

        /**
         * connectionState: WebSocket 或 REST 连接状态。
         */
        connectionState: "stopped" as "connecting" | "open" | "retrying" | "stopped",

        /**
         * sessions: 当前客户端可见会话列表。
         */
        sessions: [] as ConversationSession[],

        /**
         * projects: 中心服务已登记项目列表。
         */
        projects: [] as ProjectRecord[],

        /**
         * expandedProjectIds: 左侧项目对话树展开状态。
         */
        expandedProjectIds: [] as string[],

        /** 
         * activeSessionId: 当前打开会话 ID。
         */
        activeSessionId: null as string | null,

        /**
         * activeConversationAgentId: 当前输入框 token 统计所属智能体 ID。
         *
         * 来源：主对话默认为 main，智能体子对话打开后可由后续交互切换。
         * 默认值：main，表示主智能体“致心”的上下文。
         */
        activeConversationAgentId: "main",

        /**
         * sessionDetail: 当前会话详情。
         */
        sessionDetail: null as SessionDetailResult | null,

        /**
         * pendingSessionDraft: 用户点击新增后形成的本地待发送会话草稿。
         */
        pendingSessionDraft: null as PendingSessionDraft | null,

        /**
         * queuedComposerMessages: 当前对话窗口本地排队消息。
         *
         * 来源：运行中轮次存在时用户按 Enter 或点击发送。
         * 默认值：空数组，不从中心服务恢复。
         */
        queuedComposerMessages: [] as QueuedComposerMessage[],

        /**
         * events: 当前订阅范围内已拉取事件。
         */
        events: [] as EventRecord[],

        /**
         * usageRecords: 用量统计原始记录。
         */
        usageRecords: [] as unknown[],

        /**
         * usageAggregate: 用量聚合统计记录。
         */
        usageAggregate: [] as unknown[],

        /**
         * usageDailyStats: 中心服务刷新后的每日用量聚合。
         */
        usageDailyStats: [] as unknown[],

        /**
         * usageFilters: 用量统计筛选条件。
         */
        usageFilters: createUsageFilters() as UsageFilters,

        /**
         * providers: 供应商配置列表。
         */
        providers: [] as ProviderConfigView[],

        /**
         * providerProtocolPlugins: 中心服务返回的协议适配器列表。
         */
        providerProtocolPlugins: [] as ProviderProtocolPluginView[],

        /**
         * providerDraft: 供应商编辑表单草稿。
         */
        providerDraft: createProviderDraft() as ProviderDraft,

        /**
         * providerModelOptions: 每个供应商已保存或刷新得到的模型列表。
         */
        providerModelOptions: {} as Record<string, ProviderModelListView>,

        /**
         * proxies: 网络代理配置列表。
         */
        proxies: [] as ProxyConfigView[],

        /**
         * defaultProxyId: 全局默认代理 ID。
         */
        defaultProxyId: null as string | null,

        /**
         * proxyDraft: 网络代理编辑表单草稿。
         */
        proxyDraft: createProxyDraft() as ProxyDraft,

        /**
         * runtimes: 运行环境配置列表。
         */
        runtimes: [] as RuntimeConfigView[],

        /**
         * runtimeDraft: 运行环境编辑表单草稿。
         */
        runtimeDraft: createRuntimeDraft() as RuntimeDraft,

        /**
         * plugins: 插件安装列表。
         */
        plugins: [] as PluginConfigView[],

        /**
         * pluginDraft: 插件安装和配置草稿。
         */
        pluginDraft: createPluginDraft() as PluginDraft,

        /**
         * mcpConfigs: MCP 配置列表。
         */
        mcpConfigs: [] as McpConfigView[],

        /**
         * mcpDraft: MCP 配置编辑草稿。
         */
        mcpDraft: createMcpDraft() as McpDraft,

        /**
         * skills: 已安装 skill 列表。
         */
        skills: [] as SkillConfigView[],

        /**
         * skillDraft: skill 安装草稿。
         */
        skillDraft: createSkillDraft() as SkillDraft,

        /**
         * agentDraft: 智能体管理草稿。
         */
        agentDraft: createAgentDraft() as AgentDraft,

        /**
         * draft: 当前输入框草稿。
         */
        draft: createEmptyComposerDraft() as ComposerDraftModel,

        /**
         * agents: 中心服务已固化的主智能体和长期智能体列表。
         *
         * 来源：`POST /api/agent/list`。
         * 默认值：空数组，加载失败时不伪造长期智能体。
         */
        agents: [] as AgentConfigView[],

        /**
         * mainAgentStatusTree: 输入框“智能体状态”入口两级树。
         *
         * 来源：第一级由中心服务 agents 列表派生，第二级待中心服务子智能体运行事件协议明确后接入。
         * 默认值：空数组；主智能体不展示在该状态树中。
         */
        mainAgentStatusTree: createDefaultAgentStatusTree() as AgentStatusTreeNode[],

        /**
         * composerEditFiles: 输入框“编辑”入口文件 diff 列表。
         *
         * 来源：待中心服务文件写入事件或编辑摘要协议明确后接入。
         * 默认值：当前协议未齐备，必须为空数组，避免把演示文件 diff 误当成本次编辑。
         */
        composerEditFiles: [] as ComposerEditFile[],

        /**
         * composerSettings: 输入框执行模式和推理深度选择。
         */
        composerSettings: {
            executionMode: "full_auto",
            selectedProviderId: null,
            selectedModel: "",
            contextUsedTokens: 0,
            contextTokenizerName: "",
            contextTokenizerSource: "",
            reasoningEffort: "medium",
        } as ComposerSettings,

        /**
         * composerContextUsageState: 输入区上下文统计节流状态。
         *
         * 来源：本地输入、附件、引用和模型选择变化。
         * 默认值：无待执行请求，最近请求键为空，序号从 0 开始。
         */
        composerContextUsageState: {
            composerContextUsageTimer: null,
            lastComposerContextUsageKey: "",
            contextUsageWindowKey: "",
            composerContextUsageRequestSerial: 0,
        } as ComposerContextUsageState,

        /**
         * runningTurnSnapshotRecovery: 运行中轮次快照恢复兜底状态。
         *
         * 来源：当前会话发送后本地调度。
         * 默认值：无恢复目标，避免空闲会话产生轮询。
         */
        runningTurnSnapshotRecovery: {
            recoveryTimer: null,
            sessionId: null,
            turnId: null,
            attempts: 0,
        } as RunningTurnSnapshotRecoveryState,

        /**
         * projectReferenceQuery: 输入框内 @ 后面的检索词。
         */
        projectReferenceQuery: "",

        /**
         * showProjectReferencePopover: 是否展示 @ 项目引用候选。
         */
        showProjectReferencePopover: false,

        /**
         * ideContextListenerRegistered: IDE window message 监听是否已经注册。
         */
        ideContextListenerRegistered: false,

        /**
         * lastError: 最近一次可展示错误。
         */
        lastError: "",

        /**
         * managementErrors: 管理页最近一次可见错误。
         */
        managementErrors: {
            providers: "",
            proxies: "",
            runtimes: "",
            usage: "",
            plugins: "",
            mcp: "",
            skills: "",
            agents: "",
        } as Record<"providers" | "proxies" | "runtimes" | "usage" | "plugins" | "mcp" | "skills" | "agents", string>,

        /**
         * webSocketClient: 运行期 WebSocket 客户端实例。
         */
        webSocketClient: null as ReconnectingWebSocketClient | null,

        /**
         * desktopStatus: 桌面壳中心服务状态。
         */
        desktopStatus: null as DesktopCenterStatus | null,

        /**
         * desktopConfigDraft: 中心服务配置表单草稿。
         */
        desktopConfigDraft: {
            port: 8866,
            centerDirectory: "",
        },

        /**
         * restartRequired: 最近一次中心服务配置保存后的重启状态。
         *
         * 来源：桌面壳 `updateCenterConfig` 的返回结果。
         * 默认值：false，表示尚未发生需要展示的配置切换。
         * 约束：中心服务切换目录时桌面壳会立即停止、初始化并重启，这里只表达 UI 状态。
         */
        restartRequired: false,

        /**
         * remoteAccessDraft: 远程 Web 账号密码配置草稿。
         */
        remoteAccessDraft: {
            account: "",
            password: "",
        },

        /**
         * notificationPermission: 桌面壳检测到的系统通知权限状态。
         */
        notificationPermission: "",

        /**
         * themeMode: 当前客户端主题模式，属于本地 UI 状态。
         */
        themeMode: "light" as ThemeMode,
    }),
    getters: {
        /**
         * entryMode：当前布局模式。
         *
         * @returns 入口模式。
         */
        entryMode(state): EntryMode {
            return state.runtime.entryMode;
        },

        /**
         * activeTasks：当前会话任务列表。
         *
         * @returns 任务数组。
         */
        activeTasks(state): TaskRecord[] {
            return state.sessionDetail?.tasks ?? [];
        },

        /**
         * canUseProjectReferences：当前输入区是否允许使用项目文件检索。
         *
         * @returns 有明确项目上下文时返回 true。
         */
        canUseProjectReferences(state): boolean {
            return resolveComposerProjectId(state) !== null;
        },

        /**
         * projectReferenceSuggestions：基于当前输入区明确项目上下文生成 @ 引用候选。
         *
         * @returns 项目引用候选数组。
         */
        projectReferenceSuggestions(state): ProjectReferenceSuggestion[] {
            const projectId = resolveComposerProjectId(state);
            if (!projectId) {
                return [];
            }

            const query = state.projectReferenceQuery.trim().toLowerCase();
            const baseSuggestions = [
                createProjectFileSuggestion(projectId),
                createProjectFolderSuggestion(projectId),
                createProjectCodeSuggestion(projectId),
            ];

            return baseSuggestions.filter((item) => {
                return query.length === 0
                    || item.label.toLowerCase().includes(query)
                    || item.description.toLowerCase().includes(query);
            });
        },

        /**
         * projectCapabilitySummary：计算当前项目对话可用的插件、MCP 和 skill 摘要。
         *
         * @returns 项目会话返回摘要，普通会话返回 null。
         */
        projectCapabilitySummary(state): ProjectCapabilitySummary | null {
            if (state.sessionDetail?.session.sessionType !== "project" || !state.sessionDetail.session.projectId) {
                return null;
            }

            // projectId: 当前项目会话绑定的唯一 ID；只按该明确字段筛选项目级能力。
            const projectId = state.sessionDetail.session.projectId;
            // plugins: 项目级插件必须携带明确 projectId；缺少项目归属时不能猜测属于当前项目。
            const plugins = state.plugins.filter((plugin) => {
                return plugin.scope === "project" && plugin.projectId === projectId;
            }).map((plugin) => {
                return {
                    key: `plugin-${plugin.pluginId}`,
                    kind: "插件" as const,
                    name: plugin.pluginId,
                    source: plugin.source,
                    scope: "项目级" as const,
                    status: plugin.enabled ? "启用" : "停用",
                    unavailableReason: plugin.enabled ? "无" : "插件已停用",
                };
            });
            // projectMcpConfigs: MCP 项目级配置按 projectId 精确匹配，空全局配置不参与摘要。
            const projectMcpConfigs = state.mcpConfigs.filter((config) => {
                return config.scope === "project" && config.projectId === projectId;
            });
            // mcpServers: MCP server 名称来自 mcpServers 对象的显式 key。
            const mcpServers = projectMcpConfigs.flatMap((config) => {
                return Object.keys(config.mcpServers).map((serverName) => {
                    return {
                        key: `mcp-${config.relativePath}-${serverName}`,
                        kind: "MCP" as const,
                        name: serverName,
                        source: config.relativePath,
                        scope: "项目级" as const,
                        status: "已配置",
                        unavailableReason: "无",
                    };
                });
            });
            // skills: skill 项目级安装按 projectId 精确匹配，避免全局 skill 混入项目摘要。
            const skills = state.skills.filter((skill) => {
                return skill.scope === "project" && skill.projectId === projectId;
            }).map((skill) => {
                return {
                    key: `skill-${skill.relativePath}`,
                    kind: "skill" as const,
                    name: skill.skillName,
                    source: skill.relativePath,
                    scope: "项目级" as const,
                    status: "已安装",
                    unavailableReason: skill.content.trim().length > 0 ? "无" : "SKILL.md 内容为空",
                };
            });

            return {
                projectId,
                plugins,
                mcpServers,
                skills,
            };
        },

        /**
         * projectConversationGroups：按项目事实源和项目会话兜底组织左侧项目对话树。
         *
         * @returns 项目对话树分组数组。
         */
        projectConversationGroups(state): ProjectConversationGroup[] {
            const projects = [
                ...state.projects,
                ...fallbackProjectsFromSessions(
                    state.projects,
                    state.sessions,
                ),
            ];

            return projects.map((project) => {
                // sessions: 只使用 session.projectId 精确匹配，避免按标题或路径猜测项目归属。
                const sessions = state.sessions.filter((session) => {
                    return session.sessionType === "project" && session.projectId === project.projectId;
                });

                return {
                    project,
                    sessions,
                    expanded: state.expandedProjectIds.includes(project.projectId),
                };
            });
        },

        /**
         * enabledProviders：当前可用于后续发送的启用供应商列表。
         *
         * @returns 已启用供应商数组。
         */
        enabledProviders(state): ProviderConfigView[] {
            return state.providers.filter((provider) => {
                return provider.enabled;
            });
        },

        /**
         * composerSelectedProvider：输入区当前选中的供应商。
         *
         * @returns 供应商记录；未选择或供应商已停用时返回 null。
         */
        composerSelectedProvider(state): ProviderConfigView | null {
            if (!state.composerSettings.selectedProviderId) {
                return null;
            }

            return state.providers.find((provider) => {
                return provider.providerId === state.composerSettings.selectedProviderId;
            }) ?? null;
        },

        /**
         * composerSelectedModelOptions：输入区模型下拉来源。
         *
         * @returns 当前供应商已保存或刷新得到的模型列表。
         */
        composerSelectedModelOptions(state): string[] {
            const providerId = state.composerSettings.selectedProviderId;
            if (!providerId) {
                return [];
            }

            return state.providerModelOptions[providerId]?.models ?? [];
        },

        /**
         * composerSelectedModelContextWindowTokens：当前模型上下文窗口上限。
         *
         * @returns token 数；未配置时为 0，展示层显示未知窗口。
         */
        composerSelectedModelContextWindowTokens(state): number {
            const providerId = state.composerSettings.selectedProviderId;
            if (!providerId) {
                return 0;
            }
            const modelOptions = state.providerModelOptions[providerId];
            if (!modelOptions || !Array.isArray(modelOptions.contextWindows)) {
                return 0;
            }
            const contextWindow = modelOptions?.contextWindows.find((item) => {
                return item.model === state.composerSettings.selectedModel;
            });
            return contextWindow?.contextWindowTokens ?? 0;
        },

        /**
         * globalPlugins：顶部插件管理页只展示全局插件。
         *
         * @returns 全局插件数组。
         */
        globalPlugins(state): PluginConfigView[] {
            return state.plugins.filter((plugin) => {
                return (plugin.scope === "global" || plugin.scope === "both")
                    && plugin.projectId === null
                    && plugin.source !== "project-local";
            });
        },

        /**
         * globalMcpConfigs：顶部 MCP 管理页只展示全局配置。
         *
         * @returns 全局 MCP 配置数组。
         */
        globalMcpConfigs(state): McpConfigView[] {
            return state.mcpConfigs.filter((config) => {
                return config.scope === "global";
            });
        },

        /**
         * globalSkills：顶部 skill 管理页只展示全局 skill。
         *
         * @returns 全局 skill 数组。
         */
        globalSkills(state): SkillConfigView[] {
            return state.skills.filter((skill) => {
                return skill.scope === "global";
            });
        },

        /**
         * agentStatusTree：输入区“智能体状态”两级树。
         *
         * @returns 第一级为长期智能体，第二级为各自子智能体。
         */
        agentStatusTree(state): AgentStatusTreeNode[] {
            return mergeAgentStatusTree(
                state.agents,
                state.mainAgentStatusTree,
            );
        },
    },
    actions: {
        /**
         * api：创建中心服务 API 客户端。
         *
         * @returns REST API 客户端。
         */
        api(): CenterApiClient {
            return new CenterApiClient({
                baseUrl: this.runtime.centerBaseUrl,
            });
        },

        /**
         * bootstrap：进入应用时初始化授权和会话列表。
         *
         * @returns 初始化完成后没有返回值。
         */
        async bootstrap(): Promise<void> {
            this.applyTheme();

            if (!this.runtime.capabilities.canUseRemoteLogin) {
                await this.authorizeLocal();
            }

            await this.connectRealtime();
            await this.registerRuntimeProject();
            await this.loadProviders();
            await this.loadNavigationData();
            await this.loadAgents();
            await this.ensureSession();
            await this.syncDesktopStatus();
            await this.requestBrowserNotificationPermission();
            this.registerIdeContextListener();
        },

        /**
         * themeStorageKey：生成当前客户端主题保存键。
         *
         * @returns 当前客户端专属主题保存键。
         */
        themeStorageKey(): string {
            return `zhixin.theme.${this.runtime.clientType}.${this.runtime.entryMode}`;
        },

        /**
         * applyTheme：应用当前客户端主题。
         *
         * @returns 没有返回值。
         */
        applyTheme(): void {
            // savedTheme: 用户手动切换后保存的当前客户端主题，优先于系统或 IDE 默认主题。
            const savedTheme = window.localStorage.getItem(this.themeStorageKey());
            // nextTheme: 只有明确保存 light/dark 时才使用保存值，否则使用运行时默认主题。
            const nextTheme: ThemeMode = savedTheme === "light" || savedTheme === "dark"
                ? savedTheme
                : this.runtime.preferredTheme;
            this.themeMode = nextTheme;
            document.documentElement.dataset.theme = nextTheme;
            document.documentElement.classList.toggle("dark", nextTheme === "dark");
            document.documentElement.style.colorScheme = nextTheme;
        },

        /**
         * toggleTheme：切换亮色和暗黑主题。
         *
         * @returns 没有返回值。
         */
        toggleTheme(): void {
            const nextTheme: ThemeMode = this.themeMode === "dark"
                ? "light"
                : "dark";
            this.themeMode = nextTheme;
            window.localStorage.setItem(
                this.themeStorageKey(),
                nextTheme,
            );
            this.applyTheme();
        },

        ...createDesktopActions(),

        /**
         * authorizeLocal：本机客户端向中心服务申请授权。
         *
         * @returns 授权完成后没有返回值。
         */
        async authorizeLocal(): Promise<void> {
            this.authorization = await this.api().authorizeLocal({
                clientType: this.runtime.clientType,
                projectId: this.runtime.clientType === "ide-plugin"
                    ? this.runtime.projectContext?.projectId ?? null
                    : null,
            });
        },

        /**
         * registerRuntimeProject：插件入口登记当前 IDEA 项目。
         *
         * @returns 登记完成后没有返回值。
         */
        async registerRuntimeProject(): Promise<void> {
            if (!this.runtime.projectContext) {
                return;
            }

            await this.requireRealtimeRequest<ProjectRecord>("project.register", {
                projectId: this.runtime.projectContext.projectId,
                displayName: this.runtime.projectContext.displayName,
                latestPath: this.runtime.projectContext.rootPath,
            });
        },

        /**
         * login：远程 Web 登录。
         *
         * @param payload 账号密码。
         * @returns 登录完成后没有返回值。
         */
        async login(payload: {
            account: string;
            password: string;
        }): Promise<void> {
            this.authorization = await this.api().login(payload);
        },

        /**
         * loadSessions：按入口模式加载会话列表。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadSessions(): Promise<void> {
            const result = await this.requireRealtimeRequest<{
                /** sessions: 当前入口可见会话列表。 */
                sessions: ConversationSession[];
                /** projects: 导航快照中的项目列表；本函数不消费该字段。 */
                projects: ProjectRecord[];
            }>("navigation.snapshot", {
                sessionType: this.runtime.entryMode === "plugin-compact" ? "project" : undefined,
                projectId: this.runtime.entryMode === "plugin-compact"
                    ? this.runtime.projectContext?.projectId ?? null
                    : null,
            });
            this.sessions = result.sessions;
            // activeSessionId: 刷新导航时优先保留当前真实会话，避免新草稿发送后被列表第一项覆盖。
            const activeSessionStillVisible = this.sessions.some((session) => {
                return session.sessionId === this.activeSessionId;
            });
            if (!activeSessionStillVisible) {
                this.activeSessionId = this.sessions[0]?.sessionId ?? null;
            }
        },

        /**
         * loadProjects：通过实时通道加载中心服务项目列表。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadProjects(): Promise<void> {
            if (this.runtime.entryMode === "plugin-compact") {
                this.projects = this.runtime.projectContext
                    ? [
                        {
                            projectId: this.runtime.projectContext.projectId,
                            displayName: this.runtime.projectContext.displayName,
                            alias: null,
                            latestPath: this.runtime.projectContext.rootPath,
                            createdAt: "",
                            updatedAt: "",
                        },
                    ]
                    : [];
                return;
            }

            const snapshot = await this.requireRealtimeRequest<{
                /** sessions: 导航快照返回的会话列表；本函数只消费项目列表，避免项目刷新覆盖当前会话选择。 */
                sessions: ConversationSession[];
                /** projects: 中心服务项目列表，来源于 WebSocket navigation.snapshot。 */
                projects: ProjectRecord[];
            }>("navigation.snapshot", {
                sessionType: undefined,
                projectId: null,
            });
            this.projects = snapshot.projects;
        },

        /**
         * loadNavigationData：加载左侧导航所需项目和会话数据。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadNavigationData(): Promise<void> {
            const snapshot = await this.requireRealtimeRequest<{
                /** sessions: 当前入口可见会话列表。 */
                sessions: ConversationSession[];
                /** projects: 中心服务项目列表。 */
                projects: ProjectRecord[];
            }>("navigation.snapshot", {
                sessionType: this.runtime.entryMode === "plugin-compact" ? "project" : undefined,
                projectId: this.runtime.entryMode === "plugin-compact"
                    ? this.runtime.projectContext?.projectId ?? null
                    : null,
            });
            this.sessions = snapshot.sessions;
            this.projects = this.runtime.entryMode === "plugin-compact"
                ? this.runtime.projectContext
                    ? [
                        {
                            projectId: this.runtime.projectContext.projectId,
                            displayName: this.runtime.projectContext.displayName,
                            alias: null,
                            latestPath: this.runtime.projectContext.rootPath,
                            createdAt: "",
                            updatedAt: "",
                        },
                    ]
                    : []
                : snapshot.projects;
            const activeSessionStillVisible = this.sessions.some((session) => {
                return session.sessionId === this.activeSessionId;
            });
            if (!activeSessionStillVisible) {
                this.activeSessionId = this.sessions[0]?.sessionId ?? null;
            }
            this.ensureProjectTreeExpandedState();
        },

        /**
         * handleSessionUpdated：处理中心服务推送的会话更新。
         *
         * @param payload WebSocket `session.updated` 载荷，来源于中心服务事实源。
         * @returns 导航和当前详情同步完成后没有返回值。
         */
        async handleSessionUpdated(payload: SessionUpdatedPayload): Promise<void> {
            // sessions: 先用专项载荷更新本地列表，保证 WebSocket 到达后标题立即变化。
            this.sessions = this.sessions.map((session) => {
                if (session.sessionId !== payload.session.sessionId) {
                    return session;
                }
                return payload.session;
            });
            await this.loadNavigationData();
            if (this.activeSessionId === payload.session.sessionId) {
                // session.updated 可能比 message.created、turn.updated 等事件更稳定到达；当前会话必须直接拉完整快照，补齐多端漏收的消息、任务和事件终态。
                await this.loadActiveSessionSnapshot();
                // recoverActiveRunningTurnSnapshot: 其他端如果只收到本轮起始会话更新，也要启动短轮询等待中心服务终态快照。
                this.recoverActiveRunningTurnSnapshot();
            }
        },

        /**
         * handleSessionDeleted：处理其他端删除会话后的实时同步。
         *
         * @param payload WebSocket `session.deleted` 载荷，来源于中心服务删除事件。
         * @returns 导航、详情和本地草稿迁移完成后没有返回值。
         */
        async handleSessionDeleted(payload: SessionDeletedPayload): Promise<void> {
            // sessions: 先移除本地列表项，避免广播到达后被删除会话继续短暂显示。
            this.sessions = this.sessions.filter((session) => {
                return session.sessionId !== payload.sessionId;
            });

            const deletingActiveSession = this.activeSessionId === payload.sessionId;
            if (deletingActiveSession) {
                // 当前会话已被其他端删除，必须立即清空详情和过程事件，防止继续展示过期事实。
                this.clearDeletedActiveSessionState();
            }

            await this.loadNavigationData();
            if (deletingActiveSession) {
                // ensureSession: 删除当前会话后进入普通草稿或插件项目草稿，保持输入区处于可继续使用状态。
                await this.ensureSession();
                return;
            }

            if (this.activeSessionId) {
                await this.loadActiveSessionSnapshot();
            }
        },

        /**
         * ensureSession：没有会话时创建默认会话。
         *
         * @returns 创建或确认完成后没有返回值。
         */
        async ensureSession(): Promise<void> {
            if (this.activeSessionId) {
                await this.loadActiveSessionDetail();
                return;
            }

            // 初始无会话时只准备本地草稿，避免打开应用或点击新增时污染过去对话列表。
            if (this.runtime.entryMode === "plugin-compact" && this.runtime.projectContext) {
                this.startProjectConversationDraft({
                    projectId: this.runtime.projectContext.projectId,
                    displayName: this.runtime.projectContext.displayName,
                    alias: null,
                    latestPath: this.runtime.projectContext.rootPath,
                    createdAt: "",
                    updatedAt: "",
                });
                return;
            }

            this.startNewNormalConversationDraft();
        },

        /**
         * startNewNormalConversationDraft：从普通对话标题图标进入本地草稿。
         *
         * @returns 没有返回值。
         */
        startNewNormalConversationDraft(): void {
            // pendingSessionDraft: 点击新增只影响本地输入区，真实发送前不进入中心服务事实源。
            this.pendingSessionDraft = {
                sessionType: "normal",
                projectId: null,
                title: "新的对话",
            };
            this.activeSessionId = null;
            this.sessionDetail = null;
            this.events = [];
            this.resetComposerContextUsageForWindow();
        },

        /**
         * createNormalSession：保留旧模板调用入口，实际只启动本地草稿。
         *
         * @returns 没有返回值。
         */
        createNormalSession(): void {
            this.startNewNormalConversationDraft();
        },

        /**
         * startProjectConversationDraft：为指定项目进入本地项目对话草稿。
         *
         * @param project 项目事实记录。
         * @returns 没有返回值。
         */
        startProjectConversationDraft(project: ProjectRecord): void {
            // projectName: 项目主名称固定使用文件夹名；alias 只作为备注，不能替代标题来源。
            const projectName = project.displayName;
            const existingCount = this.sessions.filter((session) => {
                return session.sessionType === "project" && session.projectId === project.projectId;
            }).length;
            this.pendingSessionDraft = {
                sessionType: "project",
                projectId: project.projectId,
                title: `${projectName}对话 ${existingCount + 1}`,
            };
            this.expandProject(project.projectId);
            this.activeSessionId = null;
            this.sessionDetail = null;
            this.events = [];
            this.resetComposerContextUsageForWindow();
        },

        /**
         * createProjectConversationForProject：保留旧模板调用入口，实际只启动项目草稿。
         *
         * @param project 项目事实记录。
         * @returns 没有返回值。
         */
        createProjectConversationForProject(project: ProjectRecord): void {
            this.startProjectConversationDraft(project);
        },

        /**
         * createDefaultBrowserProjectConversation：浏览器端没有项目时登记默认测试项目并进入项目草稿。
         *
         * @returns 登记并切换到项目对话草稿后没有返回值。
         */
        async createDefaultBrowserProjectConversation(): Promise<void> {
            // projectId: 默认浏览器项目固定绑定“项目对话测试”目录，保证本轮项目对话闭环使用同一测试项目。
            const projectId = "00000000-0000-4000-8000-000000000102";
            const project = await this.requireRealtimeRequest<ProjectRecord>("project.register", {
                projectId,
                displayName: "项目对话测试",
                latestPath: "项目对话测试",
            });
            await this.loadProjects();
            this.startProjectConversationDraft(project);
        },

        /**
         * createProjectConversationTab：为当前项目创建一个本地待发送页签。
         *
         * @returns 没有返回值。
         */
        createProjectConversationTab(): void {
            if (this.runtime.entryMode !== "plugin-compact" || !this.runtime.projectContext) {
                return;
            }

            this.startProjectConversationDraft({
                projectId: this.runtime.projectContext.projectId,
                displayName: this.runtime.projectContext.displayName,
                alias: null,
                latestPath: this.runtime.projectContext.rootPath,
                createdAt: "",
                updatedAt: "",
            });
        },

        /**
         * toggleProjectExpanded：切换左侧项目对话树展开状态。
         *
         * @param projectId 项目 UUID。
         * @returns 没有返回值。
         */
        toggleProjectExpanded(projectId: string): void {
            if (this.expandedProjectIds.includes(projectId)) {
                this.expandedProjectIds = this.expandedProjectIds.filter((item) => {
                    return item !== projectId;
                });
                return;
            }

            this.expandProject(projectId);
        },

        /**
         * expandProject：展开指定项目节点。
         *
         * @param projectId 项目 UUID。
         * @returns 没有返回值。
         */
        expandProject(projectId: string): void {
            if (this.expandedProjectIds.includes(projectId)) {
                return;
            }
            this.expandedProjectIds = [
                ...this.expandedProjectIds,
                projectId,
            ];
        },

        /**
         * ensureProjectTreeExpandedState：保证有会话或当前会话的项目默认展开。
         *
         * @returns 没有返回值。
         */
        ensureProjectTreeExpandedState(): void {
            const projectIdsWithSessions = this.sessions.filter((session) => {
                return session.sessionType === "project" && typeof session.projectId === "string";
            }).map((session) => {
                return session.projectId as string;
            });
            const activeProjectId = this.sessions.find((session) => {
                return session.sessionId === this.activeSessionId;
            })?.projectId;
            const nextProjectIds = [
                ...this.expandedProjectIds,
                ...projectIdsWithSessions,
            ];
            if (activeProjectId) {
                nextProjectIds.push(activeProjectId);
            }
            this.expandedProjectIds = Array.from(new Set(nextProjectIds));
        },

        /**
         * deleteConversation：删除中心服务中的会话并刷新导航。
         *
         * @param sessionId 会话 ID。
         * @returns 删除和刷新完成后没有返回值。
         */
        async deleteConversation(sessionId: string): Promise<void> {
            try {
                const deletingActiveSession = this.activeSessionId === sessionId;
                await this.requireRealtimeRequest<{
                    /** sessionId: 已删除会话 ID。 */
                    sessionId: string;
                    /** deleted: 是否删除成功。 */
                    deleted: boolean;
                }>("session.delete", {
                    sessionId,
                });
                if (deletingActiveSession) {
                    // 删除当前会话后必须先清空详情，避免旧消息在刷新前继续显示或被误选中。
                    this.activeSessionId = null;
                    this.sessionDetail = null;
                    this.events = [];
                    this.pendingSessionDraft = null;
                    this.resetComposerContextUsageForWindow();
                }
                await this.loadNavigationData();
                if (this.activeSessionId) {
                    await this.loadActiveSessionSnapshot();
                    return;
                }
                await this.ensureSession();
                this.lastError = "";
            } catch (error) {
                // 错误文案必须进入可见状态，避免删除失败时用户误以为已删除。
                this.lastError = error instanceof Error
                    ? error.message
                    : "删除对话失败，请稍后重试。";
                console.error("删除对话失败", error);
            }
        },

        /**
         * requestDeleteConversation：按会话类型弹出确认后删除会话。
         *
         * @param session 会话记录。
         * @returns 确认删除、取消或失败处理完成后没有返回值。
         */
        async requestDeleteConversation(session: ConversationSession): Promise<void> {
            const label = session.sessionType === "project"
                ? "项目对话删除"
                : "普通对话删除";
            try {
                await ElMessageBox.confirm(
                    `确认删除“${session.title}”？`,
                    label,
                    {
                        confirmButtonText: "确认删除",
                        cancelButtonText: "取消",
                        type: "warning",
                    },
                );
                await this.deleteConversation(session.sessionId);
            } catch {
                // 用户取消删除时不写错误，避免取消路径被误判为删除失败。
            }
        },

        /**
         * resetComposerContextUsageForWindow：重置当前对话窗口 token 展示并作废旧响应。
         *
         * @returns 没有返回值。
         */
        resetComposerContextUsageForWindow(): void {
            this.composerContextUsageState.lastComposerContextUsageKey = "";
            this.composerContextUsageState.contextUsageWindowKey = "";
            this.composerContextUsageState.composerContextUsageRequestSerial += 1;
        },

        /**
         * applyPersistedTokenUsage：应用中心服务数据库返回的 token 用量快照。
         *
         * @param tokenUsage 当前会话当前智能体 token 用量快照。
         * @returns 没有返回值。
         */
        applyPersistedTokenUsage(tokenUsage: SessionDetailResult["tokenUsage"]): void {
            if (!tokenUsage) {
                return;
            }
            // tokenUsage: 只恢复当前窗口对应智能体的数据库事实，避免旧会话快照覆盖当前 UI。
            if (tokenUsage.sessionId !== this.activeSessionId) {
                return;
            }
            this.activeConversationAgentId = tokenUsage.agentId;
            this.composerSettings.contextUsedTokens = tokenUsage.usedTokens;
            this.composerSettings.contextTokenizerName = tokenUsage.tokenizerName;
            this.composerSettings.contextTokenizerSource = tokenUsage.tokenizerSource;
        },

        /**
         * loadActiveSessionDetail：加载当前会话详情。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadActiveSessionDetail(): Promise<void> {
            await this.loadActiveSessionSnapshot();
        },

        /**
         * loadActiveSessionSnapshot：统一加载当前会话详情和事件快照。
         *
         * @returns 详情、过程事件和会话相关能力加载完成后没有返回值。
         */
        async loadActiveSessionSnapshot(): Promise<void> {
            if (!this.activeSessionId) {
                this.sessionDetail = null;
                this.events = [];
                return;
            }

            const snapshot = await this.requireRealtimeRequest<{
                /** detail: 会话详情快照。 */
                detail: SessionDetailResult;
                /** events: 当前会话事件快照。 */
                events: EventRecord[];
            }>("session.snapshot", {
                sessionId: this.activeSessionId,
            });
            this.sessionDetail = snapshot.detail;
            this.activeConversationAgentId = "main";
            this.applyPersistedTokenUsage(snapshot.detail.tokenUsage);
            this.events = [
                ...snapshot.events,
            ].sort((left: EventRecord, right: EventRecord) => {
                return left.sequence - right.sequence;
            });
            if (this.sessionDetail.session.sessionType === "project") {
                await this.loadProjectCapabilitySources();
            }
            this.applyDefaultComposerModelSettings();
        },

        ...createProjectActions(),
        ...createConversationActions(),

        /**
         * ensureSessionForSending：真实发送前把本地草稿转成中心服务会话。
         *
         * @returns 可发送消息的会话 ID；无法创建时返回 null。
         */
        async ensureSessionForSending(): Promise<string | null> {
            if (this.activeSessionId) {
                return this.activeSessionId;
            }

            if (!this.pendingSessionDraft) {
                this.startNewNormalConversationDraft();
            }

            if (!this.pendingSessionDraft) {
                return null;
            }

            // pendingSessionDraft: 只在发送时消费，确保空草稿不会出现在历史会话列表中。
            const session = await this.requireRealtimeRequest<ConversationSession>("session.create", {
                sessionType: this.pendingSessionDraft.sessionType,
                projectId: this.pendingSessionDraft.projectId,
                title: this.pendingSessionDraft.title,
            });
            // session: 发送成功前只作为本次 sendMessage 的目标 ID；可见历史列表必须等消息落库后由 loadNavigationData 刷新。
            this.pendingSessionDraft = null;
            this.activeSessionId = session.sessionId;
            this.resetComposerContextUsageForWindow();
            this.ensureProjectTreeExpandedState();
            return session.sessionId;
        },

        /**
         * applyDefaultComposerModelSettings：初始化当前会话后续发送模型选择。
         *
         * @returns 没有返回值。
         */
        applyDefaultComposerModelSettings(): void {
            // enabledProviders: 只从中心服务返回的启用供应商里选择默认值，避免把停用供应商放入后续发送配置。
            const enabledProviders = this.providers.filter((provider) => {
                return provider.enabled;
            });
            const currentProvider = enabledProviders.find((provider) => {
                return provider.providerId === this.composerSettings.selectedProviderId;
            });
            const nextProvider = currentProvider ?? enabledProviders[0] ?? null;
            if (!nextProvider) {
                this.composerSettings.selectedProviderId = null;
                this.composerSettings.selectedModel = "";
                return;
            }

            this.composerSettings.selectedProviderId = nextProvider.providerId;
            const providerModels = this.providerModelOptions[nextProvider.providerId]?.models ?? [];
            const selectedModelBelongsToProvider = providerModels.includes(this.composerSettings.selectedModel);
            if (this.composerSettings.selectedModel.length === 0
                || !currentProvider
                || (providerModels.length > 0 && !selectedModelBelongsToProvider)) {
                this.composerSettings.selectedModel = this.resolveComposerDefaultModel(nextProvider);
            }
        },

        /**
         * resolveComposerDefaultModel：解析输入区模型默认值。
         *
         * @param provider 当前选择的供应商。
         * @returns 供应商默认模型；默认模型为空时使用模型列表第一项。
         */
        resolveComposerDefaultModel(provider: ProviderConfigView): string {
            // savedModels: 模型列表来自中心服务保存或刷新结果；只在供应商默认模型为空时作为明确兜底。
            const savedModels = this.providerModelOptions[provider.providerId]?.models ?? [];
            return provider.defaultModel || savedModels[0] || "";
        },

        /**
         * handleComposerProviderChange：切换输入区供应商后同步默认模型。
         *
         * @param providerId 用户选择的供应商 ID。
         * @returns 没有返回值。
         */
        handleComposerProviderChange(providerId: string): void {
            const provider = this.providers.find((item) => {
                return item.providerId === providerId;
            });
            this.composerSettings.selectedProviderId = provider?.providerId ?? null;
            this.composerSettings.selectedModel = provider ? this.resolveComposerDefaultModel(provider) : "";
        },

        /**
         * handleComposerPaste：处理输入框剪贴板图片粘贴。
         *
         * @param event 浏览器粘贴事件。
         * @returns 处理完成后没有返回值。
         */
        async handleComposerPaste(event: ClipboardEvent): Promise<void> {
            const files = Array.from(event.clipboardData?.files ?? []);
            const imageFiles = files.filter((file) => {
                return file.type.startsWith("image/");
            });

            if (imageFiles.length === 0) {
                return;
            }

            event.preventDefault();
            for (const file of imageFiles) {
                await this.addClipboardImageAttachment(file);
            }
        },

        /**
         * updateProjectReferenceQuery：根据输入文本更新 @ 项目引用检索状态。
         *
         * @returns 没有返回值。
         */
        updateProjectReferenceQuery(): void {
            if (!this.canUseProjectReferences) {
                this.showProjectReferencePopover = false;
                this.projectReferenceQuery = "";
                return;
            }

            const atIndex = this.draft.text.lastIndexOf("@");
            const afterAt = atIndex >= 0
                ? this.draft.text.slice(atIndex + 1)
                : "";
            const hasWhitespace = /\s/u.test(afterAt);
            this.showProjectReferencePopover = atIndex >= 0 && !hasWhitespace;
            this.projectReferenceQuery = this.showProjectReferencePopover
                ? afterAt
                : "";
        },

        /**
         * insertProjectReference：把 @ 候选插入输入框结构化引用。
         *
         * @param suggestion 用户选择的项目引用候选。
         * @returns 没有返回值。
         */
        insertProjectReference(suggestion: ProjectReferenceSuggestion): void {
            this.draft.references.push(suggestion.reference);
            this.draft.text = this.removeActiveAtQuery(this.draft.text);
            this.showProjectReferencePopover = false;
            this.projectReferenceQuery = "";
        },

        /**
         * removeReference：移除输入框中的结构化引用标签。
         *
         * @param index 引用数组下标。
         * @returns 没有返回值。
         */
        removeReference(index: number): void {
            this.draft.references.splice(index, 1);
        },

        /**
         * removeAttachment：移除输入框中的临时附件标签。
         *
         * @param index 附件数组下标。
         * @returns 没有返回值。
         */
        removeAttachment(index: number): void {
            this.draft.attachments.splice(index, 1);
        },

        /**
         * insertIdeContextReference：把 IDEA 插件上下文插入输入框。
         *
         * @param payload IDEA 插件提供的上下文引用。
         * @returns 没有返回值。
         */
        insertIdeContextReference(payload: IdeContextReferencePayload): void {
            if (!this.runtime.capabilities.canSendIdeContext) {
                return;
            }

            this.draft.references.push(convertIdePayloadToReference(payload));
        },

        /**
         * registerIdeContextListener：监听 IDEA WebView 投递的上下文插入消息。
         *
         * @returns 没有返回值。
         */
        registerIdeContextListener(): void {
            if (this.ideContextListenerRegistered) {
                return;
            }

            window.addEventListener("message", (event) => {
                const data = event.data as Partial<IdeContextReferenceMessage> | undefined;
                if (data?.type !== "zhixin.ide.insertContextReference" || !data.reference) {
                    return;
                }

                this.insertIdeContextReference(data.reference);
            });
            this.ideContextListenerRegistered = true;
        },

        ...createManagementActions(),

        /**
         * renderMarkdown：渲染 Markdown 内容。
         *
         * @param contentMarkdown Markdown 文本。
         * @returns HTML 字符串。
         */
        renderMarkdown(contentMarkdown: string): string {
            return marked.parse(contentMarkdown, {
                async: false,
            });
        },

        /**
         * buildDraftMarkdown：把文本、引用和附件摘要组合成发送内容。
         *
         * @returns 中心服务当前消息接口接收的 Markdown 文本。
         */
        buildDraftMarkdown(): string {
            const parts = [
                this.draft.text.trim(),
            ].filter((part) => {
                return part.length > 0;
            });

            for (const reference of this.draft.references) {
                parts.push(formatReferenceMarkdown(reference));
            }

            for (const attachment of this.draft.attachments) {
                parts.push(`![${attachment.fileName}](temp://${attachment.temporaryAttachmentId})`);
            }

            return parts.join("\n\n");
        },

        /**
         * removeActiveAtQuery：移除输入文本中当前正在编辑的 @ 检索片段。
         *
         * @param value 输入框文本。
         * @returns 移除 @ 片段后的文本。
         */
        removeActiveAtQuery(value: string): string {
            const atIndex = value.lastIndexOf("@");
            if (atIndex < 0) {
                return value;
            }

            return `${value.slice(0, atIndex)}${value.slice(atIndex).replace(/^@\S*/u, "")}`;
        },
    },
});

