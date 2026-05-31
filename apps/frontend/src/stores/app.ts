import {defineStore} from "pinia";
import {marked} from "marked";

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
    type ProviderProxyPolicy,
    type ProxyConfigView,
    type RuntimeConfigView,
    type SessionDetailResult,
    type SkillConfigView,
    type UsageFilters,
} from "@zhixin/api-client";
import {
    createEmptyComposerDraft,
    canSendComposerDraft,
    type ComposerAttachmentDraft,
    type ComposerDraftModel,
    type ComposerReferenceDraft,
} from "@zhixin/ui";
import type {
    ConversationSession,
    EntryMode,
    EventRecord,
    InternalFileLink,
    ProjectRecord,
    TaskRecord,
} from "@zhixin/shared";

import {
    detectRuntimeEnvironment,
    type RuntimeEnvironment,
    type ThemeMode,
} from "../runtime";

/**
 * DesktopCenterStatus：桌面壳中心服务状态。
 *
 * 来源：Electron preload 的 zhixinDesktop 桥接。
 * 含义：前端展示中心服务端口、中心目录、运行状态和外部目录提示。
 * 格式：JSON 对象。
 * 默认值：无桌面桥接时为 null。
 * 约束：只用于桌面壳 UI，浏览器入口不具备该能力。
 */
export interface DesktopCenterStatus {
    /**
     * running: 桌面壳是否持有中心服务进程。
     */
    running: boolean;

    /**
     * errorMessage: 最近一次中心服务错误摘要。
     */
    errorMessage: string;

    /**
     * port: 中心服务监听端口。
     */
    port: number;

    /**
     * centerDirectory: 中心目录绝对路径。
     */
    centerDirectory: string;

    /**
     * isExternalCenterDirectory: 是否为外部中心目录。
     */
    isExternalCenterDirectory: boolean;
}

/**
 * DesktopBridge：桌面壳桥接能力声明。
 *
 * 来源：Electron preload。
 * 含义：统一前端仅通过白名单 IPC 调用桌面壳能力。
 * 格式：函数集合。
 * 默认值：非桌面壳环境不存在。
 * 约束：不能绕过中心服务读写核心事实源。
 */
interface DesktopBridge {
    /**
     * getCenterStatus: 获取中心服务状态。
     */
    getCenterStatus: () => Promise<DesktopCenterStatus>;

    /**
     * updateCenterConfig: 保存中心服务端口和中心目录。
     */
    updateCenterConfig: (payload: {
        port: number;
        centerDirectory: string;
    }) => Promise<DesktopCenterStatus & {
        ok: boolean;
        errorMessage: string;
    }>;

    /**
     * saveAccessAccount: 保存远程 Web 账号密码。
     */
    saveAccessAccount: (payload: {
        account: string;
        password: string;
    }) => Promise<{
        ok: boolean;
        errorMessage: string;
    }>;

    /**
     * getNotificationPermission: 检测系统通知权限。
     */
    getNotificationPermission: () => Promise<{
        permission: string;
        checkedAt: string;
    }>;
}

declare global {
    interface Window {
        /**
         * zhixinDesktop: Electron preload 暴露的桌面壳桥接对象。
         */
        zhixinDesktop?: DesktopBridge;
    }
}

/**
 * IdeContextReferenceMessage：IDE 宿主向 plugin.html 投递的上下文引用消息。
 *
 * 来源：IDEA 插件 `insertContextReference` 桥接事件。
 * 含义：右键菜单选择文件、文件夹或代码后，只插入输入区引用标签，不直接发送。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：普通 Web 入口忽略该消息，最终发送仍由用户手动触发。
 */
export interface IdeContextReferenceMessage {
    /**
     * type: 固定消息类型，用于区分其他 window message。
     */
    type: "zhixin.ide.insertContextReference";

    /**
     * reference: IDE 宿主提供的结构化上下文引用。
     */
    reference: IdeContextReferencePayload;
}

/**
 * IdeContextReferencePayload：IDE 上下文引用载荷。
 *
 * 来源：IDEA 插件右键菜单桥接。
 * 含义：承载文件、文件夹或代码选区引用。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：字段名与 IDEA 插件 `ContextReference` 语义一致。
 */
export interface IdeContextReferencePayload {
    /**
     * type: 引用类型，允许 file、folder、code 三类。
     */
    type: "file" | "folder" | "code";

    /**
     * projectId: 项目 UUID，来源于项目根目录 `致心项目ID.md`。
     */
    projectId: string;

    /**
     * absolutePath: 引用目标绝对路径。
     */
    absolutePath: string;

    /**
     * relativePath: 引用目标相对项目路径。
     */
    relativePath: string;

    /**
     * displayText: IDE 插件生成的输入框标签展示文本。
     */
    displayText: string;

    /**
     * startLine: 代码引用起始行号，文件或文件夹引用为 0。
     */
    startLine: number;

    /**
     * endLine: 代码引用结束行号，文件或文件夹引用为 0。
     */
    endLine: number;

    /**
     * selectedText: 代码选区文本，非代码引用为空字符串。
     */
    selectedText: string;
}

/**
 * ProjectReferenceSuggestion：输入框 @ 项目引用候选。
 *
 * 来源：阶段 12 前端草稿结构，当前先基于当前项目上下文提供本地候选。
 * 含义：用户输入 @ 后可插入的文件、文件夹或代码位置草稿。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：只在项目会话中展示，普通会话不展示项目文件检索。
 */
export interface ProjectReferenceSuggestion {
    /**
     * key: 候选唯一键，用于 Vue 列表渲染。
     */
    key: string;

    /**
     * label: 候选展示文本。
     */
    label: string;

    /**
     * description: 候选说明，展示引用来源。
     */
    description: string;

    /**
     * reference: 插入草稿时使用的结构化引用。
     */
    reference: ComposerReferenceDraft;
}

/**
 * ProviderDraft：供应商配置表单草稿。
 *
 * 来源：供应商管理页面。
 * 含义：承载新增或修改供应商基础配置。
 * 格式：JSON 对象。
 * 默认值：见 `createProviderDraft`。
 * 约束：apiKey 只用于本次提交，保存后立即清空，不回显已保存密钥。
 */
export interface ProviderDraft {
    /** providerId: 修改时的供应商 ID，新增时为 null。 */
    providerId: string | null;
    /** providerName: 供应商名称。 */
    providerName: string;
    /** protocolPluginId: 模型协议插件 ID。 */
    protocolPluginId: string;
    /** protocolMode: 协议模式。 */
    protocolMode: string;
    /** baseUrl: 供应商接口地址。 */
    baseUrl: string;
    /** apiKey: 本次提交的 API Key 明文，保存后清空。 */
    apiKey: string;
    /** model: 默认模型。 */
    model: string;
    /** enabled: 是否启用。 */
    enabled: boolean;
    /** capabilities: 模型能力声明。 */
    capabilities: ProviderCapabilityDeclaration;
    /** proxyPolicy: 代理策略。 */
    proxyPolicy: ProviderProxyPolicy;
    /** refreshModelsText: 手动刷新模型列表的多行文本。 */
    refreshModelsText: string;
    /** refreshReasoningText: 手动刷新推理深度的多行文本。 */
    refreshReasoningText: string;
}

/**
 * ProxyDraft：网络代理表单草稿。
 *
 * 来源：网络代理管理页面。
 * 含义：承载新增或修改代理配置。
 * 格式：JSON 对象。
 * 默认值：见 `createProxyDraft`。
 * 约束：username/password 都为空时表示无认证代理。
 */
export interface ProxyDraft {
    /** proxyId: 修改时的代理 ID，新增时为 null。 */
    proxyId: string | null;
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
    /** password: 本次提交的代理密码明文，保存后清空。 */
    password: string;
    /** enabled: 是否启用。 */
    enabled: boolean;
    /** note: 备注。 */
    note: string;
}

/**
 * RuntimeDraft：运行环境表单草稿。
 *
 * 来源：运行环境管理页面。
 * 含义：承载新增或修改工具链配置。
 * 格式：JSON 对象。
 * 默认值：见 `createRuntimeDraft`。
 * 约束：environmentVariablesText 使用 KEY=VALUE 多行文本转换为对象。
 */
export interface RuntimeDraft {
    /** runtimeId: 修改时的运行环境 ID，新增时为 null。 */
    runtimeId: string | null;
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
    /** environmentVariablesText: 环境变量多行文本。 */
    environmentVariablesText: string;
    /** pathEntriesText: PATH 追加目录多行文本。 */
    pathEntriesText: string;
    /** isDefault: 是否同类型默认环境。 */
    isDefault: boolean;
    /** enabled: 是否启用。 */
    enabled: boolean;
    /** note: 备注。 */
    note: string;
}

/**
 * PluginDraft：插件管理表单草稿。
 *
 * 来源：插件管理页面。
 * 含义：承载插件清单 JSON、配置 JSON 和当前选择的插件 ID。
 * 格式：JSON 文本字段。
 * 默认值：见 `createPluginDraft`。
 * 约束：manifestJson 必须解析为对象后提交给中心服务唯一入口。
 */
export interface PluginDraft {
    /** pluginId: 当前要配置的插件 ID，未选择时为空字符串。 */
    pluginId: string;
    /** manifestJson: 待安装插件清单 JSON 文本。 */
    manifestJson: string;
    /** configJson: 待保存插件配置 JSON 文本。 */
    configJson: string;
}

/**
 * McpDraft：MCP 管理表单草稿。
 *
 * 来源：MCP 管理页面。
 * 含义：承载全局或项目级 MCP 配置 JSON。
 * 格式：根字段固定为 mcpServers。
 * 默认值：见 `createMcpDraft`。
 * 约束：保存时只提交 mcpServers 字段，不兼容其他根字段。
 */
export interface McpDraft {
    /** projectId: 项目级配置所属项目 ID，空字符串表示全局配置。 */
    projectId: string;
    /** configJson: MCP 配置 JSON 文本，根字段必须是 mcpServers。 */
    configJson: string;
}

/**
 * SkillDraft：skill 管理表单草稿。
 *
 * 来源：skill 管理页面。
 * 含义：承载待安装 skill 名称、内容和可选项目 ID。
 * 格式：文本字段。
 * 默认值：见 `createSkillDraft`。
 * 约束：skillName 对应中心目录下的 skill 文件夹名称。
 */
export interface SkillDraft {
    /** skillName: skill 名称。 */
    skillName: string;
    /** content: SKILL.md 内容。 */
    content: string;
    /** projectId: 项目级安装所属项目 ID，空字符串表示全局。 */
    projectId: string;
}

/**
 * ProjectCapabilityItem：项目能力详情弹框中的单条能力。
 *
 * 来源：当前项目明确归属的插件、MCP 和 skill 配置。
 * 含义：保留来源、范围、启用状态和不可用原因，避免弹框用硬编码文案伪造能力状态。
 * 格式：展示行对象。
 * 默认值：没有对应能力时不生成。
 * 约束：项目级插件必须有明确 projectId 才能进入当前项目能力列表。
 */
export interface ProjectCapabilityItem {
    /** key: 当前能力展示唯一键。 */
    key: string;
    /** kind: 能力类型。 */
    kind: "插件" | "MCP" | "skill";
    /** name: 能力名称。 */
    name: string;
    /** source: 能力来源。 */
    source: string;
    /** scope: 能力范围。 */
    scope: "项目级";
    /** status: 启用状态或配置状态。 */
    status: string;
    /** unavailableReason: 不可用原因，没有不可用原因时为“无”。 */
    unavailableReason: string;
}

/**
 * ProjectCapabilitySummary：项目对话可用扩展能力摘要。
 *
 * 来源：当前项目会话 ID 与中心服务返回的插件、MCP、skill 列表。
 * 含义：只用于项目对话页展示当前项目扫描到的能力，不作为全局管理入口。
 * 格式：三类结构化能力数组加项目 ID。
 * 默认值：无项目会话时返回 null。
 * 约束：项目级能力由打开项目目录扫描或登记项目上下文产生，全局页不编辑项目级能力。
 */
export interface ProjectCapabilitySummary {
    /** projectId: 当前项目会话绑定的项目 UUID，来源于中心服务 session.projectId。 */
    projectId: string;
    /** plugins: 当前项目可见的项目级插件列表，来源于明确 projectId 归属。 */
    plugins: ProjectCapabilityItem[];
    /** mcpServers: 当前项目 MCP Server 列表，来源于当前项目 mcpServers 根字段。 */
    mcpServers: ProjectCapabilityItem[];
    /** skills: 当前项目已安装 skill 列表，来源于当前项目 skills/project-{projectId} 目录。 */
    skills: ProjectCapabilityItem[];
}

/**
 * ProjectConversationGroup：左侧项目对话树分组。
 *
 * 来源：中心服务项目列表和项目会话列表。
 * 含义：第一级是项目，第二级是该项目下的项目对话。
 * 格式：项目记录、会话数组和本地展开状态。
 * 默认值：无项目时为空数组。
 * 约束：projectName 只能来自项目事实源，不能从会话标题猜测。
 */
export interface ProjectConversationGroup {
    /** project: 中心服务登记的项目事实记录。 */
    project: ProjectRecord;
    /** sessions: 绑定当前项目 ID 的项目会话列表。 */
    sessions: ConversationSession[];
    /** expanded: 当前客户端本地展开状态，不同步到中心服务。 */
    expanded: boolean;
}

/**
 * AgentStatusTreeNode：输入区“智能体状态”入口的状态树节点。
 *
 * 来源：第一级来自中心服务长期智能体列表，第二级来自后续中心服务子智能体运行事件或当前前端单一临时约定。
 * 含义：表达团队智能体、主智能体和各自创建的子智能体状态与对话入口。
 * 格式：可递归树节点。
 * 默认值：长期智能体列表为空时仍保留主智能体“致心”节点。
 * 约束：不兼容候选字段；缺少独立智能体会话 API 时，对话发送仍通过当前会话消息接口。
 */
export interface AgentStatusTreeNode {
    /** agentId: 智能体 ID，主智能体为 main，子智能体为运行期 ID。 */
    agentId: string;
    /** parentAgentId: 父智能体 ID；一级团队智能体为空字符串。 */
    parentAgentId: string;
    /** name: 智能体展示名称。 */
    name: string;
    /** status: 智能体运行状态中文文案。 */
    status: string;
    /** taskSummary: 当前任务摘要；空闲时说明当前没有执行任务。 */
    taskSummary: string;
    /** conversationHint: 智能体对话弹框中展示的上下文说明。 */
    conversationHint: string;
    /** nodeKind: 节点类型，用于区分主智能体、长期智能体和子智能体。 */
    nodeKind: "主智能体" | "长期智能体" | "子智能体";
    /** children: 第二级子智能体节点；子智能体不能继续创建下一级。 */
    children: AgentStatusTreeNode[];
}

/**
 * ComposerEditDiffLine：输入区“编辑”入口的临时 diff 行。
 *
 * 来源：后续中心服务文件写入事件或编辑摘要协议。
 * 含义：表达真实文件编辑 diff 行。
 * 格式：行类型和文本内容。
 * 默认值：中心服务协议未齐备时为空数组。
 * 约束：待中心服务协议明确后仅接入真实编辑事件，不写入演示 diff。
 */
export interface ComposerEditDiffLine {
    /** kind: diff 行类型。 */
    kind: "added" | "removed" | "context";
    /** content: diff 行文本，包含必要前缀。 */
    content: string;
}

/**
 * ComposerEditFile：输入区“编辑”入口的临时文件编辑记录。
 *
 * 来源：后续中心服务文件写入事件或编辑摘要协议。
 * 含义：描述真实文件路径、变更类型和与上一次编辑的 diff。
 * 格式：文件记录对象。
 * 默认值：中心服务协议未齐备时为空数组。
 * 约束：待中心服务协议明确后仅接入真实编辑事件，不写入演示 diff。
 */
export interface ComposerEditFile {
    /** filePath: 文件相对路径或可展示路径。 */
    filePath: string;
    /** changeKind: 变更类型中文文案。 */
    changeKind: "新增" | "编辑";
    /** previousEditLabel: 上一次编辑版本标签。 */
    previousEditLabel: string;
    /** currentEditLabel: 本次编辑版本标签。 */
    currentEditLabel: string;
    /** diffLines: 与上一次编辑对比的 diff 行。 */
    diffLines: ComposerEditDiffLine[];
}

/**
 * PendingSessionDraft：尚未真实发送的本地新对话草稿。
 *
 * 来源：用户点击新增普通对话、项目对话或插件页签。
 * 含义：只标记输入区准备创建哪类会话，不进入中心服务会话列表。
 * 格式：会话类型、项目 ID 和标题。
 * 默认值：没有本地草稿时为 null。
 * 约束：只有用户真实发送内容后，才能据此创建中心服务可见会话。
 */
export interface PendingSessionDraft {
    /** sessionType: 待创建会话类型。 */
    sessionType: "normal" | "project";
    /** projectId: 项目会话绑定项目 ID，普通会话固定为 null。 */
    projectId: string | null;
    /** title: 真实发送时写入中心服务的会话标题。 */
    title: string;
}

/**
 * ComposerSettings：输入框本地执行设置。
 *
 * 来源：对话输入区控件。
 * 含义：保存执行模式和推理深度的当前选择，供后续发送消息或中心服务配置接口接入。
 * 格式：固定字符串字段。
 * 默认值：执行模式为 full_auto，推理深度为 medium。
 * 约束：当前只作为客户端 UI 状态，不替代中心服务审批事实。
 */
export interface ComposerSettings {
    /** executionMode: 执行模式协议值。 */
    executionMode: "suggest" | "auto_edit" | "full_auto";
    /** selectedProviderId: 当前会话发送前选择的供应商 ID，null 表示尚未选中启用供应商。 */
    selectedProviderId: string | null;
    /** selectedModel: 当前会话发送前选择或手动输入的模型名称。 */
    selectedModel: string;
    /** reasoningEffort: 推理深度协议值。 */
    reasoningEffort: "low" | "medium" | "high" | "xhigh";
}

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
         * sessionDetail: 当前会话详情。
         */
        sessionDetail: null as SessionDetailResult | null,

        /**
         * pendingSessionDraft: 用户点击新增后形成的本地待发送会话草稿。
         */
        pendingSessionDraft: null as PendingSessionDraft | null,

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
         * usageFilters: 用量统计筛选条件。
         */
        usageFilters: createUsageFilters() as UsageFilters,

        /**
         * providers: 供应商配置列表。
         */
        providers: [] as ProviderConfigView[],

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
         * 默认值：包含主智能体“致心”，避免团队树缺少系统内置入口。
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
            reasoningEffort: "medium",
        } as ComposerSettings,

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
        } as Record<"providers" | "proxies" | "runtimes" | "usage" | "plugins" | "mcp" | "skills", string>,

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
         * @returns 第一级为主智能体和长期智能体，第二级为各自子智能体。
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

            await this.registerRuntimeProject();
            await this.loadProviders();
            await this.loadNavigationData();
            await this.loadAgents();
            await this.ensureSession();
            await this.syncDesktopStatus();
            await this.requestBrowserNotificationPermission();
            this.registerIdeContextListener();
            this.connectRealtime();
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

        /**
         * syncDesktopStatus：同步桌面壳中心服务状态。
         *
         * @returns 同步完成后没有返回值。
         */
        async syncDesktopStatus(): Promise<void> {
            if (!window.zhixinDesktop) {
                return;
            }

            this.desktopStatus = await window.zhixinDesktop.getCenterStatus();
            this.desktopConfigDraft = {
                port: this.desktopStatus.port,
                centerDirectory: this.desktopStatus.centerDirectory,
            };
            const permission = await window.zhixinDesktop.getNotificationPermission();
            this.notificationPermission = `${permission.permission} · ${permission.checkedAt}`;
            await this.api().saveNotificationConfig({
                clientType: "desktop-shell",
                enabled: true,
                notifyOnFailure: true,
                notifyOnWaitingUser: true,
                systemPermission: permission.permission,
            });
        },

        /**
         * saveDesktopConfig：保存桌面壳中心服务配置。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveDesktopConfig(): Promise<void> {
            if (!window.zhixinDesktop) {
                return;
            }

            const result = await window.zhixinDesktop.updateCenterConfig({
                port: this.desktopConfigDraft.port,
                centerDirectory: this.desktopConfigDraft.centerDirectory,
            });
            this.desktopStatus = result;
            this.lastError = result.errorMessage;
        },

        /**
         * saveRemoteAccessAccount：保存远程 Web 访问账号密码。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveRemoteAccessAccount(): Promise<void> {
            if (!window.zhixinDesktop) {
                return;
            }

            const result = await window.zhixinDesktop.saveAccessAccount({
                account: this.remoteAccessDraft.account,
                password: this.remoteAccessDraft.password,
            });
            this.lastError = result.errorMessage;
            if (result.ok) {
                this.remoteAccessDraft.password = "";
            }
        },

        /**
         * authorizeLocal：本机客户端向中心服务申请授权。
         *
         * @returns 授权完成后没有返回值。
         */
        async authorizeLocal(): Promise<void> {
            this.authorization = await this.api().authorizeLocal({
                clientType: this.runtime.clientType,
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

            await this.api().registerProject({
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
            const result = await this.api().listSessions({
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
         * loadProjects：加载中心服务项目列表。
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

            try {
                const result = await this.api().listProjects();
                this.projects = result.projects;
            } catch (error) {
                // 旧中心服务可能尚未提供 /api/project/list；此处只记录错误，让已返回的普通会话和项目会话继续渲染。
                this.projects = [];
                this.lastError = "项目列表接口失败，已使用项目会话构造兜底项目导航。";
                console.error(this.lastError, error);
            }
        },

        /**
         * loadNavigationData：加载左侧导航所需项目和会话数据。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadNavigationData(): Promise<void> {
            await this.loadSessions();
            await this.loadProjects();
            this.ensureProjectTreeExpandedState();
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
         * deleteConversationPlaceholder：对话删除 UI 占位。
         *
         * @param sessionId 会话 ID。
         * @returns 没有返回值。
         */
        deleteConversationPlaceholder(sessionId: string): void {
            // 当前中心服务尚未提供 /api/session/delete；这里只记录可见状态，避免前端绕过事实源删除本地数据。
            this.lastError = `删除对话接口待中心服务补齐：${sessionId}`;
        },

        /**
         * deleteProjectPlaceholder：项目删除 UI 占位。
         *
         * @param projectId 项目 UUID。
         * @returns 没有返回值。
         */
        deleteProjectPlaceholder(projectId: string): void {
            // 当前中心服务尚未提供 /api/project/delete；项目删除会影响会话、任务和记忆，不能只在前端移除。
            this.lastError = `删除项目接口待中心服务补齐：${projectId}`;
        },

        /**
         * loadActiveSessionDetail：加载当前会话详情。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadActiveSessionDetail(): Promise<void> {
            if (!this.activeSessionId) {
                this.sessionDetail = null;
                return;
            }

            this.sessionDetail = await this.api().getSessionDetail({
                sessionId: this.activeSessionId,
            });
            if (this.sessionDetail.session.sessionType === "project") {
                await this.loadProjectCapabilitySources();
            }
            this.applyDefaultComposerModelSettings();
        },

        /**
         * sendDraft：发送当前输入框文本。
         *
         * @returns 发送完成后没有返回值。
         */
        async sendDraft(): Promise<void> {
            if (!canSendComposerDraft(this.draft)) {
                return;
            }

            const contentMarkdown = this.buildDraftMarkdown();
            const attachments = [
                ...this.draft.attachments,
            ];
            this.draft = createEmptyComposerDraft();
            this.showProjectReferencePopover = false;
            this.projectReferenceQuery = "";

            const sessionId = await this.ensureSessionForSending();
            if (!sessionId) {
                return;
            }

            const sent = await this.api().sendMessage({
                sessionId,
                contentMarkdown,
            });
            await this.commitDraftAttachments(sessionId, sent.messageId, attachments);
            await this.loadNavigationData();
            await this.loadActiveSessionDetail();
            await this.refreshEvents();
        },

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
            const session = await this.api().createSession({
                sessionType: this.pendingSessionDraft.sessionType,
                projectId: this.pendingSessionDraft.projectId,
                title: this.pendingSessionDraft.title,
            });
            // session: 发送成功前只作为本次 sendMessage 的目标 ID；可见历史列表必须等消息落库后由 loadNavigationData 刷新。
            this.pendingSessionDraft = null;
            this.activeSessionId = session.sessionId;
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
            if (this.composerSettings.selectedModel.length === 0 || !currentProvider) {
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

        /**
         * refreshEvents：拉取当前会话缺失事件。
         *
         * @returns 拉取完成后没有返回值。
         */
        async refreshEvents(): Promise<void> {
            const result = await this.api().listEvents({
                sessionId: this.activeSessionId,
                turnId: null,
                afterSequence: 0,
            });
            this.events = result.events;
        },

        /**
         * loadUsageRecords：加载用量原始记录。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadUsageRecords(): Promise<void> {
            try {
                const result = await this.api().queryUsageRecords(this.normalizedUsageFilters());
                this.usageRecords = result.records;
                this.clearManagementError("usage");
            } catch (error) {
                this.recordManagementError("usage", error);
            }
        },

        /**
         * loadUsageAggregate：加载用量聚合统计。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadUsageAggregate(): Promise<void> {
            try {
                const result = await this.api().loadUsageAggregate(this.normalizedUsageFilters());
                this.usageAggregate = result.stats;
                this.clearManagementError("usage");
            } catch (error) {
                this.recordManagementError("usage", error);
            }
        },

        /**
         * loadUsageStatistics：同时加载原始和聚合用量。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadUsageStatistics(): Promise<void> {
            await Promise.all([
                this.loadUsageRecords(),
                this.loadUsageAggregate(),
            ]);
        },

        /**
         * normalizedUsageFilters：把空字符串筛选转为接口需要的 null。
         *
         * @returns 用量筛选条件。
         */
        normalizedUsageFilters(): UsageFilters {
            return {
                providerId: normalizeOptionalText(this.usageFilters.providerId),
                model: normalizeOptionalText(this.usageFilters.model),
                projectId: normalizeOptionalText(this.usageFilters.projectId),
                sessionId: normalizeOptionalText(this.usageFilters.sessionId),
                startedAt: normalizeOptionalText(this.usageFilters.startedAt),
                endedAt: normalizeOptionalText(this.usageFilters.endedAt),
            };
        },

        /**
         * loadProviders：加载供应商列表。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadProviders(): Promise<void> {
            try {
                const result = await this.api().listProviders();
                this.providers = result.providers;
                await Promise.all(result.providers.map((provider) => {
                    return this.loadProviderModelOptions(provider.providerId);
                }));
                this.applyDefaultComposerModelSettings();
                this.clearManagementError("providers");
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * loadProviderModelOptions：加载单个供应商已保存模型列表。
         *
         * @param providerId 供应商 ID。
         * @returns 加载完成后没有返回值。
         */
        async loadProviderModelOptions(providerId: string): Promise<void> {
            try {
                const result = await this.api().listProviderModels({
                    providerId,
                });
                this.providerModelOptions[providerId] = result;
            } catch (error) {
                // 模型列表失败不阻断供应商主列表，页面会显示手动填写兜底说明。
                console.error("供应商模型列表加载失败", {
                    providerId,
                    error,
                });
            }
        },

        /**
         * editProvider：把供应商列表项填入表单。
         *
         * @param provider 供应商列表项。
         * @returns 没有返回值。
         */
        editProvider(provider: ProviderConfigView): void {
            this.providerDraft = {
                providerId: provider.providerId,
                providerName: provider.providerName,
                protocolPluginId: provider.protocolPluginId,
                protocolMode: provider.protocolMode,
                baseUrl: provider.baseUrl,
                apiKey: "",
                model: provider.defaultModel,
                enabled: provider.enabled,
                capabilities: {
                    ...provider.capabilities,
                },
                proxyPolicy: {
                    ...provider.proxyPolicy,
                },
                refreshModelsText: provider.defaultModel,
                refreshReasoningText: "",
            };
            void this.loadProviderModelOptions(provider.providerId);
        },

        /**
         * resetProviderDraft：重置供应商表单。
         *
         * @returns 没有返回值。
         */
        resetProviderDraft(): void {
            this.providerDraft = createProviderDraft();
        },

        /**
         * saveProvider：新增或修改供应商。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveProvider(): Promise<void> {
            try {
                if (this.providerDraft.providerId) {
                    await this.api().updateProvider({
                        providerId: this.providerDraft.providerId,
                        providerName: this.providerDraft.providerName,
                        protocolPluginId: this.providerDraft.protocolPluginId,
                        protocolMode: this.providerDraft.protocolMode,
                        baseUrl: this.providerDraft.baseUrl,
                        apiKey: this.providerDraft.apiKey,
                        defaultModel: this.providerDraft.model,
                        capabilities: this.providerDraft.capabilities,
                        proxyPolicy: this.providerDraft.proxyPolicy,
                        enabled: this.providerDraft.enabled,
                    });
                } else {
                    await this.api().createProvider({
                        providerName: this.providerDraft.providerName,
                        protocolPluginId: this.providerDraft.protocolPluginId,
                        protocolMode: this.providerDraft.protocolMode,
                        baseUrl: this.providerDraft.baseUrl,
                        apiKey: this.providerDraft.apiKey,
                        model: this.providerDraft.model,
                        enabled: this.providerDraft.enabled,
                        capabilities: this.providerDraft.capabilities,
                        proxyPolicy: this.providerDraft.proxyPolicy,
                    });
                }
                this.providerDraft.apiKey = "";
                this.clearManagementError("providers");
                await this.loadProviders();
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * toggleProvider：启用或停用供应商。
         *
         * @param provider 供应商列表项。
         * @returns 更新完成后没有返回值。
         */
        async toggleProvider(provider: ProviderConfigView): Promise<void> {
            try {
                await this.api().updateProvider({
                    providerId: provider.providerId,
                    enabled: !provider.enabled,
                });
                this.clearManagementError("providers");
                await this.loadProviders();
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * deleteProvider：按中心服务当前能力停用供应商。
         *
         * @param provider 供应商列表项。
         * @returns 更新完成后没有返回值。
         */
        async deleteProvider(provider: ProviderConfigView): Promise<void> {
            try {
                await this.api().deleteProvider({
                    providerId: provider.providerId,
                });
                this.clearManagementError("providers");
                await this.loadProviders();
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * refreshProviderModels：提交手动模型和推理深度刷新。
         *
         * @param provider 供应商列表项。
         * @returns 刷新完成后没有返回值。
         */
        async refreshProviderModels(provider: ProviderConfigView): Promise<void> {
            try {
                await this.api().refreshProviderModels({
                    providerId: provider.providerId,
                    models: splitLines(this.providerDraft.refreshModelsText),
                    reasoningEfforts: splitLines(this.providerDraft.refreshReasoningText),
                });
                await this.loadProviderModelOptions(provider.providerId);
                this.clearManagementError("providers");
                await this.loadProviders();
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * loadProxies：加载代理列表和全局默认代理。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadProxies(): Promise<void> {
            try {
                const result = await this.api().listProxies();
                this.proxies = result.proxies;
                this.defaultProxyId = result.defaultProxyId;
                this.clearManagementError("proxies");
            } catch (error) {
                this.recordManagementError("proxies", error);
            }
        },

        /**
         * editProxy：把代理列表项填入表单。
         *
         * @param proxy 代理列表项。
         * @returns 没有返回值。
         */
        editProxy(proxy: ProxyConfigView): void {
            this.proxyDraft = {
                proxyId: proxy.proxyId,
                proxyName: proxy.proxyName,
                protocol: proxy.protocol,
                host: proxy.host,
                port: proxy.port,
                username: proxy.username,
                password: "",
                enabled: proxy.enabled,
                note: "",
            };
        },

        /**
         * resetProxyDraft：重置代理表单。
         *
         * @returns 没有返回值。
         */
        resetProxyDraft(): void {
            this.proxyDraft = createProxyDraft();
        },

        /**
         * saveProxy：新增或修改代理配置。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveProxy(): Promise<void> {
            try {
                await this.api().saveProxy({
                    proxyId: this.proxyDraft.proxyId ?? undefined,
                    proxyName: this.proxyDraft.proxyName,
                    protocol: this.proxyDraft.protocol,
                    host: this.proxyDraft.host,
                    port: this.proxyDraft.port,
                    username: this.proxyDraft.username,
                    password: this.proxyDraft.password,
                    enabled: this.proxyDraft.enabled,
                    note: this.proxyDraft.note,
                });
                this.proxyDraft.password = "";
                this.clearManagementError("proxies");
                await this.loadProxies();
            } catch (error) {
                this.recordManagementError("proxies", error);
            }
        },

        /**
         * toggleProxy：启用或停用代理。
         *
         * @param proxy 代理列表项。
         * @returns 更新完成后没有返回值。
         */
        async toggleProxy(proxy: ProxyConfigView): Promise<void> {
            try {
                await this.api().saveProxy({
                    proxyId: proxy.proxyId,
                    proxyName: proxy.proxyName,
                    protocol: proxy.protocol,
                    host: proxy.host,
                    port: proxy.port,
                    username: proxy.username,
                    password: "",
                    enabled: !proxy.enabled,
                    note: "",
                });
                this.clearManagementError("proxies");
                await this.loadProxies();
            } catch (error) {
                this.recordManagementError("proxies", error);
            }
        },

        /**
         * setGlobalDefaultProxy：设置全局默认代理。
         *
         * @param proxyId 代理 ID，null 表示取消默认代理。
         * @returns 保存完成后没有返回值。
         */
        async setGlobalDefaultProxy(proxyId: string | null): Promise<void> {
            try {
                await this.api().setGlobalDefaultProxy({
                    proxyId,
                });
                this.clearManagementError("proxies");
                await this.loadProxies();
            } catch (error) {
                this.recordManagementError("proxies", error);
            }
        },

        /**
         * deleteProxy：删除代理配置。
         *
         * @param proxy 代理列表项。
         * @returns 删除完成后没有返回值。
         */
        async deleteProxy(proxy: ProxyConfigView): Promise<void> {
            try {
                await this.api().deleteProxy({
                    proxyId: proxy.proxyId,
                });
                this.clearManagementError("proxies");
                await this.loadProxies();
            } catch (error) {
                this.recordManagementError("proxies", error);
            }
        },

        /**
         * loadRuntimes：加载运行环境列表。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadRuntimes(): Promise<void> {
            try {
                const result = await this.api().listRuntimes();
                this.runtimes = result.runtimes;
                this.clearManagementError("runtimes");
            } catch (error) {
                this.recordManagementError("runtimes", error);
            }
        },

        /**
         * editRuntime：把运行环境列表项填入表单。
         *
         * @param runtime 运行环境列表项。
         * @returns 没有返回值。
         */
        editRuntime(runtime: RuntimeConfigView): void {
            this.runtimeDraft = {
                runtimeId: runtime.runtimeId,
                runtimeName: runtime.runtimeName,
                runtimeType: runtime.runtimeType,
                executablePath: runtime.executablePath,
                rootPath: runtime.rootPath,
                version: runtime.version,
                environmentVariablesText: Object.entries(runtime.environmentVariables).map(([
                                                                                                key,
                                                                                                value,
                                                                                            ]) => {
                    return `${key}=${value}`;
                }).join("\n"),
                pathEntriesText: runtime.pathEntries.join("\n"),
                isDefault: runtime.isDefault,
                enabled: runtime.enabled,
                note: runtime.note,
            };
        },

        /**
         * resetRuntimeDraft：重置运行环境表单。
         *
         * @returns 没有返回值。
         */
        resetRuntimeDraft(): void {
            this.runtimeDraft = createRuntimeDraft();
        },

        /**
         * saveRuntime：新增或修改运行环境。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveRuntime(): Promise<void> {
            try {
                await this.api().saveRuntime({
                    runtimeId: this.runtimeDraft.runtimeId ?? undefined,
                    runtimeName: this.runtimeDraft.runtimeName,
                    runtimeType: this.runtimeDraft.runtimeType,
                    executablePath: this.runtimeDraft.executablePath,
                    rootPath: this.runtimeDraft.rootPath,
                    version: this.runtimeDraft.version,
                    environmentVariables: parseEnvironmentVariables(this.runtimeDraft.environmentVariablesText),
                    pathEntries: splitLines(this.runtimeDraft.pathEntriesText),
                    isDefault: this.runtimeDraft.isDefault,
                    enabled: this.runtimeDraft.enabled,
                    note: this.runtimeDraft.note,
                });
                this.clearManagementError("runtimes");
                await this.loadRuntimes();
            } catch (error) {
                this.recordManagementError("runtimes", error);
            }
        },

        /**
         * toggleRuntime：启用或停用运行环境。
         *
         * @param runtime 运行环境列表项。
         * @returns 更新完成后没有返回值。
         */
        async toggleRuntime(runtime: RuntimeConfigView): Promise<void> {
            try {
                await this.api().saveRuntime({
                    runtimeId: runtime.runtimeId,
                    runtimeName: runtime.runtimeName,
                    runtimeType: runtime.runtimeType,
                    executablePath: runtime.executablePath,
                    rootPath: runtime.rootPath,
                    version: runtime.version,
                    environmentVariables: runtime.environmentVariables,
                    pathEntries: runtime.pathEntries,
                    isDefault: runtime.isDefault,
                    enabled: !runtime.enabled,
                    note: runtime.note,
                });
                this.clearManagementError("runtimes");
                await this.loadRuntimes();
            } catch (error) {
                this.recordManagementError("runtimes", error);
            }
        },

        /**
         * setDefaultRuntime：设置同类型默认运行环境。
         *
         * @param runtime 运行环境列表项。
         * @returns 更新完成后没有返回值。
         */
        async setDefaultRuntime(runtime: RuntimeConfigView): Promise<void> {
            try {
                await this.api().saveRuntime({
                    runtimeId: runtime.runtimeId,
                    runtimeName: runtime.runtimeName,
                    runtimeType: runtime.runtimeType,
                    executablePath: runtime.executablePath,
                    rootPath: runtime.rootPath,
                    version: runtime.version,
                    environmentVariables: runtime.environmentVariables,
                    pathEntries: runtime.pathEntries,
                    isDefault: true,
                    enabled: runtime.enabled,
                    note: runtime.note,
                });
                this.clearManagementError("runtimes");
                await this.loadRuntimes();
            } catch (error) {
                this.recordManagementError("runtimes", error);
            }
        },

        /**
         * deleteRuntime：删除运行环境。
         *
         * @param runtime 运行环境列表项。
         * @returns 删除完成后没有返回值。
         */
        async deleteRuntime(runtime: RuntimeConfigView): Promise<void> {
            try {
                await this.api().deleteRuntime({
                    runtimeId: runtime.runtimeId,
                });
                this.clearManagementError("runtimes");
                await this.loadRuntimes();
            } catch (error) {
                this.recordManagementError("runtimes", error);
            }
        },

        /**
         * loadPlugins：加载插件列表。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadPlugins(): Promise<void> {
            try {
                const result = await this.api().listPlugins();
                this.plugins = result.plugins;
                this.clearManagementError("plugins");
            } catch (error) {
                this.recordManagementError("plugins", error);
            }
        },

        /**
         * loadAgents：加载主智能体和长期智能体列表。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadAgents(): Promise<void> {
            try {
                const result = await this.api().listAgents();
                this.agents = result.agents;
            } catch (error) {
                // 当前页面仍保留主智能体默认节点；中心服务接口失败时不伪造长期智能体，只记录排查信息。
                this.lastError = error instanceof Error
                    ? error.message
                    : String(error);
                console.error("智能体列表加载失败", error);
            }
        },

        /**
         * installPlugin：安装插件清单 JSON。
         *
         * @returns 安装完成后没有返回值。
         */
        async installPlugin(): Promise<void> {
            try {
                await this.api().installPlugin({
                    manifest: parseJsonObject(this.pluginDraft.manifestJson),
                });
                this.clearManagementError("plugins");
                await this.loadPlugins();
            } catch (error) {
                this.recordManagementError("plugins", error);
            }
        },

        /**
         * editPlugin：把插件列表项填入配置表单。
         *
         * @param plugin 插件列表项。
         * @returns 没有返回值。
         */
        editPlugin(plugin: PluginConfigView): void {
            this.pluginDraft = {
                pluginId: plugin.pluginId,
                manifestJson: plugin.manifestJson,
                configJson: formatJsonText(readPluginConfig(plugin.manifestJson)),
            };
        },

        /**
         * togglePlugin：启用或停用插件。
         *
         * @param plugin 插件列表项。
         * @returns 更新完成后没有返回值。
         */
        async togglePlugin(plugin: PluginConfigView): Promise<void> {
            try {
                if (plugin.enabled) {
                    await this.api().disablePlugin({
                        pluginId: plugin.pluginId,
                    });
                } else {
                    await this.api().enablePlugin({
                        pluginId: plugin.pluginId,
                    });
                }
                this.clearManagementError("plugins");
                await this.loadPlugins();
            } catch (error) {
                this.recordManagementError("plugins", error);
            }
        },

        /**
         * configurePlugin：保存当前插件配置 JSON。
         *
         * @returns 保存完成后没有返回值。
         */
        async configurePlugin(): Promise<void> {
            try {
                await this.api().configurePlugin({
                    pluginId: this.pluginDraft.pluginId,
                    config: parseJsonObject(this.pluginDraft.configJson),
                });
                this.clearManagementError("plugins");
                await this.loadPlugins();
            } catch (error) {
                this.recordManagementError("plugins", error);
            }
        },

        /**
         * deletePlugin：删除可删除插件。
         *
         * @param plugin 插件列表项。
         * @returns 删除完成后没有返回值。
         */
        async deletePlugin(plugin: PluginConfigView): Promise<void> {
            try {
                await this.api().deletePlugin({
                    pluginId: plugin.pluginId,
                });
                this.clearManagementError("plugins");
                await this.loadPlugins();
            } catch (error) {
                this.recordManagementError("plugins", error);
            }
        },

        /**
         * loadMcpConfigs：加载全局和项目级 MCP 配置。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadMcpConfigs(): Promise<void> {
            try {
                const result = await this.api().listMcpConfigs();
                this.mcpConfigs = result.configs;
                this.clearManagementError("mcp");
            } catch (error) {
                this.recordManagementError("mcp", error);
            }
        },

        /**
         * editMcpConfig：把 MCP 配置项填入编辑区。
         *
         * @param config MCP 配置项。
         * @returns 没有返回值。
         */
        editMcpConfig(config: McpConfigView): void {
            this.mcpDraft = {
                projectId: config.projectId ?? "",
                configJson: formatJsonText({
                    mcpServers: config.mcpServers,
                }),
            };
        },

        /**
         * saveMcpConfig：保存根字段为 mcpServers 的 MCP JSON。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveMcpConfig(): Promise<void> {
            try {
                const config = parseJsonObject(this.mcpDraft.configJson);
                const mcpServers = config.mcpServers;
                if (!isRecord(mcpServers)) {
                    throw new Error("MCP 配置根字段 mcpServers 必须是对象。");
                }
                await this.api().saveMcpConfig({
                    projectId: null,
                    mcpServers,
                });
                this.clearManagementError("mcp");
                await this.loadMcpConfigs();
            } catch (error) {
                this.recordManagementError("mcp", error);
            }
        },

        /**
         * loadSkills：加载已安装 skill。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadSkills(): Promise<void> {
            try {
                const result = await this.api().listSkills();
                this.skills = result.skills;
                this.clearManagementError("skills");
            } catch (error) {
                this.recordManagementError("skills", error);
            }
        },

        /**
         * loadProjectCapabilitySources：加载项目能力摘要需要的中心服务数据源。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadProjectCapabilitySources(): Promise<void> {
            // Promise.allSettled：能力摘要是项目上下文提示，不应因某类能力接口失败阻断对话详情展示。
            await Promise.allSettled([
                this.loadPlugins(),
                this.loadMcpConfigs(),
                this.loadSkills(),
            ]);
        },

        /**
         * installSkill：安装全局或项目级 skill。
         *
         * @returns 安装完成后没有返回值。
         */
        async installSkill(): Promise<void> {
            try {
                await this.api().installSkill({
                    skillName: this.skillDraft.skillName,
                    content: this.skillDraft.content,
                    projectId: null,
                });
                this.clearManagementError("skills");
                await this.loadSkills();
            } catch (error) {
                this.recordManagementError("skills", error);
            }
        },

        /**
         * requestBrowserNotificationPermission：请求浏览器通知权限并降级为页面内状态。
         *
         * @returns 权限处理完成后没有返回值。
         */
        async requestBrowserNotificationPermission(): Promise<void> {
            if (!("Notification" in window)) {
                this.lastError = "浏览器不支持系统通知，已使用页面内通知。";
                return;
            }

            if (Notification.permission === "default") {
                await Notification.requestPermission();
            }

            if (Notification.permission !== "granted") {
                this.lastError = "浏览器通知权限未开启，已使用页面内通知。";
            }
        },

        /**
         * recordManagementError：记录管理页接口错误并保留控制台排查信息。
         *
         * @param page 管理页标识。
         * @param error 捕获到的真实错误对象。
         * @returns 没有返回值。
         */
        recordManagementError(
            page: "providers" | "proxies" | "runtimes" | "usage" | "plugins" | "mcp" | "skills",
            error: unknown,
        ): void {
            // message: 网络层 Failed to fetch 统一转成中文，避免用户只看到浏览器英文错误。
            const rawMessage = error instanceof Error
                ? error.message
                : String(error);
            const message = rawMessage === "Failed to fetch"
                ? "无法连接中心服务，请确认中心服务已启动后重试。"
                : rawMessage;
            this.managementErrors[page] = message;
            this.lastError = message;
            // 控制台保留原始错误对象，方便排查 CORS、网络失败或中心服务业务错误。
            console.error("管理页接口请求失败", {
                page,
                error,
            });
        },

        /**
         * clearManagementError：清除指定管理页错误。
         *
         * @param page 管理页标识。
         * @returns 没有返回值。
         */
        clearManagementError(page: "providers" | "proxies" | "runtimes" | "usage" | "plugins" | "mcp" | "skills"): void {
            this.managementErrors[page] = "";
        },

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
         * connectRealtime：建立 WebSocket 实时同步连接。
         *
         * @returns 没有返回值。
         */
        connectRealtime(): void {
            if (!this.authorization) {
                return;
            }

            const webSocketUrl = this.runtime.centerBaseUrl.replace(/^http/u, "ws");
            this.webSocketClient?.close();
            this.webSocketClient = new ReconnectingWebSocketClient({
                url: `${webSocketUrl}/api/sync`,
                clientId: this.authorization.clientId,
                clientType: this.runtime.clientType,
                projectId: this.runtime.projectContext?.projectId ?? null,
                maxRetries: 5,
                retryIntervalMs: 2000,
                onStateChange: (state) => {
                    this.connectionState = state;
                },
                onMessage: (message) => {
                    if (message.type === "event.appended") {
                        this.events.push(message.payload as EventRecord);
                    }
                },
            });
            this.webSocketClient.connect();
        },

        /**
         * addClipboardImageAttachment：把剪贴板图片登记为临时附件草稿。
         *
         * @param file 剪贴板图片文件。
         * @returns 登记完成后没有返回值。
         */
        async addClipboardImageAttachment(file: File): Promise<void> {
            const fileName = file.name || `clipboard-${Date.now()}.png`;
            const temporary = await this.api().createTemporaryAttachment({
                fileName,
                mimeType: file.type,
                sizeBytes: file.size,
                file,
            });
            this.draft.attachments.push({
                temporaryAttachmentId: temporary.temporaryAttachmentId,
                fileName,
                mimeType: file.type,
                sizeBytes: file.size,
            });
        },

        /**
         * commitDraftAttachments：消息发送成功后提交所有临时附件。
         *
         * @param sessionId 当前会话 ID。
         * @param messageId 已创建消息 ID。
         * @param attachments 临时附件草稿数组。
         * @returns 全部提交完成后没有返回值。
         */
        async commitDraftAttachments(
            sessionId: string,
            messageId: string,
            attachments: ComposerAttachmentDraft[],
        ): Promise<void> {
            for (const attachment of attachments) {
                await this.api().commitAttachment({
                    sessionId,
                    messageId,
                    temporaryAttachmentId: attachment.temporaryAttachmentId,
                    fileName: attachment.fileName,
                    mimeType: attachment.mimeType,
                    sizeBytes: attachment.sizeBytes,
                });
            }
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

function createProjectFileSuggestion(projectId: string): ProjectReferenceSuggestion {
    const link = createInternalFileLink(projectId, "当前文件", null, null);
    return {
        key: "project-current-file",
        label: "当前文件",
        description: "引用当前项目文件",
        reference: {
            type: "file",
            link,
            displayName: "当前文件",
        },
    };
}

/**
 * resolveComposerProjectId：解析当前输入区明确绑定的项目 ID。
 *
 * 来源：依次只读取三类已有明确状态：中心服务项目会话、未发送项目草稿、IDE 插件运行时项目上下文。
 * @param state Pinia 当前状态切片。
 * @returns 有明确项目上下文时返回项目 ID，否则返回 null。
 */
function resolveComposerProjectId(state: {
    sessionDetail: SessionDetailResult | null;
    pendingSessionDraft: PendingSessionDraft | null;
    runtime: RuntimeEnvironment;
}): string | null {
    // sessionProjectId: 已存在项目会话的中心服务事实源，优先级最高。
    const sessionProjectId = state.sessionDetail?.session.sessionType === "project"
        ? state.sessionDetail.session.projectId
        : null;
    if (typeof sessionProjectId === "string" && sessionProjectId.trim().length > 0) {
        return sessionProjectId;
    }

    // draftProjectId: 用户新建项目对话或插件页签后的本地待发送项目意图，来源于 pendingSessionDraft.projectId。
    const draftProjectId = state.pendingSessionDraft?.sessionType === "project"
        ? state.pendingSessionDraft.projectId
        : null;
    if (typeof draftProjectId === "string" && draftProjectId.trim().length > 0) {
        return draftProjectId;
    }

    // runtimeProjectContext: IDE 插件入口明确携带的项目上下文，支持首个项目页签尚未发送时使用文件上下文。
    const runtimeProjectContext = state.runtime.projectContext;
    if (!runtimeProjectContext) {
        return null;
    }
    // runtimeProjectId: 来自 runtime.projectContext.projectId，不从其他字段推断。
    const runtimeProjectId = runtimeProjectContext.projectId;
    if (typeof runtimeProjectId === "string" && runtimeProjectId.trim().length > 0) {
        return runtimeProjectId;
    }

    return null;
}

function createProjectFolderSuggestion(projectId: string): ProjectReferenceSuggestion {
    return {
        key: "project-root-folder",
        label: "项目文件夹",
        description: "引用当前项目根目录",
        reference: {
            type: "folder",
            projectId,
            absolutePath: "",
            relativePath: ".",
            displayName: "项目文件夹",
        },
    };
}

function createProjectCodeSuggestion(projectId: string): ProjectReferenceSuggestion {
    const link = createInternalFileLink(projectId, "当前代码位置", 1, 1);
    return {
        key: "project-current-code",
        label: "当前代码位置",
        description: "引用当前编辑器行或选区",
        reference: {
            type: "code",
            link,
            selectedCode: "",
            displayName: "当前代码位置",
        },
    };
}

/**
 * fallbackProjectsFromSessions：从项目会话构造兜底项目记录。
 *
 * @param projects 中心服务项目列表事实源。
 * @param sessions 中心服务会话列表事实源。
 * @returns 旧中心服务缺少 /api/project/list 时用于导航展示的项目记录。
 */
function fallbackProjectsFromSessions(
    projects: ProjectRecord[],
    sessions: ConversationSession[],
): ProjectRecord[] {
    // existingProjectIds: 已有项目事实源优先，避免项目列表正常时重复构造兜底节点。
    const existingProjectIds = new Set(projects.map((project) => {
        return project.projectId;
    }));
    // projectIds: 项目会话明确携带的 projectId；这是旧中心服务兼容兜底的唯一来源。
    const projectIds = sessions.filter((session) => {
        return session.sessionType === "project" && typeof session.projectId === "string";
    }).map((session) => {
        return session.projectId as string;
    }).filter((projectId) => {
        return !existingProjectIds.has(projectId);
    });

    return Array.from(new Set(projectIds)).map((projectId) => {
        return {
            projectId,
            // displayName: 旧中心服务缺少项目登记事实源时不能用 ID 冒充文件夹名，只显示明确的未登记状态。
            displayName: "未登记项目名称",
            alias: null,
            latestPath: "",
            createdAt: "",
            updatedAt: "",
        };
    });
}

function createInternalFileLink(
    projectId: string,
    relativePath: string,
    startLine: number | null,
    endLine: number | null,
): InternalFileLink {
    return {
        projectId,
        absolutePath: "",
        relativePath,
        startLine,
        endLine,
    };
}

/**
 * createProviderDraft：创建供应商表单默认值。
 *
 * @returns 供应商表单草稿。
 */
function createProviderDraft(): ProviderDraft {
    return {
        providerId: null,
        providerName: "",
        protocolPluginId: "builtin-model-openai-compatible",
        protocolMode: "chat-completions",
        baseUrl: "",
        apiKey: "",
        model: "",
        enabled: true,
        capabilities: {
            supportsVision: false,
            supportsToolCalling: false,
            supportsJsonOutput: false,
            supportsReasoningEffort: false,
            providesCacheUsage: false,
            supportsModelList: false,
            supportsStreaming: false,
        },
        proxyPolicy: {
            mode: "use-global-default",
            proxyId: null,
        },
        refreshModelsText: "",
        refreshReasoningText: "",
    };
}

/**
 * createProxyDraft：创建代理表单默认值。
 *
 * @returns 代理表单草稿。
 */
function createProxyDraft(): ProxyDraft {
    return {
        proxyId: null,
        proxyName: "",
        protocol: "SOCKS5",
        host: "127.0.0.1",
        port: 1080,
        username: "",
        password: "",
        enabled: true,
        note: "",
    };
}

/**
 * createRuntimeDraft：创建运行环境表单默认值。
 *
 * @returns 运行环境表单草稿。
 */
function createRuntimeDraft(): RuntimeDraft {
    return {
        runtimeId: null,
        runtimeName: "",
        runtimeType: "Node.js",
        executablePath: "",
        rootPath: "",
        version: "",
        environmentVariablesText: "",
        pathEntriesText: "",
        isDefault: false,
        enabled: true,
        note: "",
    };
}

/**
 * createPluginDraft：创建插件管理默认草稿。
 *
 * @returns 插件表单草稿。
 */
function createPluginDraft(): PluginDraft {
    return {
        pluginId: "",
        manifestJson: formatJsonText({
            id: "user-plugin",
            name: "用户插件",
            source: "user-installed",
            scope: "global",
            permissions: [],
        }),
        configJson: formatJsonText({}),
    };
}

/**
 * createMcpDraft：创建 MCP 配置默认草稿。
 *
 * @returns MCP 表单草稿。
 */
function createMcpDraft(): McpDraft {
    return {
        projectId: "",
        configJson: formatJsonText({
            mcpServers: {},
        }),
    };
}

/**
 * createSkillDraft：创建 skill 安装默认草稿。
 *
 * @returns skill 表单草稿。
 */
function createSkillDraft(): SkillDraft {
    return {
        skillName: "",
        content: "",
        projectId: "",
    };
}

/**
 * createDefaultAgentStatusTree：创建默认智能体状态树。
 *
 * @returns 至少包含系统内置主智能体的两级树根节点。
 */
function createDefaultAgentStatusTree(): AgentStatusTreeNode[] {
    return [
        {
            agentId: "main",
            parentAgentId: "",
            name: "致心",
            status: "空闲",
            taskSummary: "主智能体当前没有执行任务。",
            conversationHint: "主智能体“致心”负责默认对话、任务派发和长期记忆归纳。",
            nodeKind: "主智能体",
            children: [],
        },
    ];
}

/**
 * mergeAgentStatusTree：合并中心服务长期智能体和当前运行期子智能体树。
 *
 * @param agents 中心服务已固化的智能体列表。
 * @param runtimeTree 当前运行期智能体状态树，第二级子智能体来源于后续运行事件。
 * @returns 输入区弹框展示的两级智能体状态树。
 */
function mergeAgentStatusTree(
    agents: AgentConfigView[],
    runtimeTree: AgentStatusTreeNode[],
): AgentStatusTreeNode[] {
    // childrenByParent: 只按 parentAgentId 精确归属第二级子智能体，避免按名称或摘要猜测父节点。
    const childrenByParent = new Map<string, AgentStatusTreeNode[]>();
    for (const node of runtimeTree.flatMap((root) => {
        return root.children;
    })) {
        const siblings = childrenByParent.get(node.parentAgentId) ?? [];
        siblings.push(node);
        childrenByParent.set(
            node.parentAgentId,
            siblings,
        );
    }

    // mainAgent: 主智能体必须存在；中心服务返回主智能体时用中心服务名称，否则使用内置“致心”语义。
    const mainAgent = agents.find((agent) => {
        return agent.agentId === "main";
    });
    const longTermAgents = agents.filter((agent) => {
        return agent.agentId !== "main";
    });
    const rootAgents: AgentConfigView[] = [
        mainAgent ?? {
            agentId: "main",
            name: "致心",
            enabled: true,
            roleDescription: "系统内置主智能体，直接与用户对话并调度其他智能体。",
            capabilityBoundary: "默认对话、任务派发和长期记忆归纳。",
            defaultProviderId: null,
            defaultModel: "",
            reasoningEffort: "medium",
            memoryIndexPath: "memory/agents/main",
            createdBy: "system",
            definitionPath: "agents/main.md",
            updatedAt: "",
        },
        ...longTermAgents,
    ];

    return rootAgents.map((agent) => {
        const fallbackNode = runtimeTree.find((node) => {
            return node.agentId === agent.agentId;
        });
        return {
            agentId: agent.agentId,
            parentAgentId: "",
            name: agent.name,
            status: agent.enabled ? (fallbackNode?.status ?? "空闲") : "已停用",
            taskSummary: fallbackNode?.taskSummary ?? "当前没有执行任务。",
            conversationHint: fallbackNode?.conversationHint ?? `${agent.name} 的对话查看和发送暂时仍通过当前会话消息接口完成。`,
            nodeKind: agent.agentId === "main"
                ? "主智能体"
                : "长期智能体",
            children: childrenByParent.get(agent.agentId) ?? [],
        };
    });
}

/**
 * createUsageFilters：创建用量筛选默认值。
 *
 * @returns 用量筛选条件。
 */
function createUsageFilters(): UsageFilters {
    return {
        providerId: null,
        model: null,
        projectId: null,
        sessionId: null,
        startedAt: null,
        endedAt: null,
    };
}

/**
 * splitLines：把多行文本转换为去空白数组。
 *
 * @param value 多行文本。
 * @returns 非空行数组。
 */
function splitLines(value: string): string[] {
    return value.split(/\r?\n/u).map((line) => {
        return line.trim();
    }).filter((line) => {
        return line.length > 0;
    });
}

/**
 * parseEnvironmentVariables：解析 KEY=VALUE 多行文本。
 *
 * @param value 环境变量多行文本。
 * @returns 环境变量对象。
 */
function parseEnvironmentVariables(value: string): Record<string, string> {
    const variables: Record<string, string> = {};
    for (const line of splitLines(value)) {
        const equalIndex = line.indexOf("=");
        if (equalIndex <= 0) {
            continue;
        }
        const key = line.slice(0, equalIndex).trim();
        const variableValue = line.slice(equalIndex + 1).trim();
        variables[key] = variableValue;
    }
    return variables;
}

/**
 * isRecord：判断未知值是否为普通对象。
 *
 * @param value 待判断值。
 * @returns 是普通对象时返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * parseJsonObject：把 JSON 文本解析为对象。
 *
 * @param value JSON 文本。
 * @returns 解析后的对象。
 */
function parseJsonObject(value: string): Record<string, unknown> {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
        throw new Error("JSON 内容必须是对象。");
    }
    return parsed;
}

/**
 * formatJsonText：把对象格式化为稳定缩进 JSON 文本。
 *
 * @param value 待格式化对象。
 * @returns JSON 文本。
 */
function formatJsonText(value: Record<string, unknown>): string {
    return JSON.stringify(value, null, 2);
}

/**
 * readPluginConfig：从插件清单 JSON 中读取 config 对象。
 *
 * @param manifestJson 插件清单 JSON 文本。
 * @returns 插件配置对象。
 */
function readPluginConfig(manifestJson: string): Record<string, unknown> {
    const manifest = parseJsonObject(manifestJson);
    return isRecord(manifest.config)
        ? manifest.config
        : {};
}

/**
 * normalizeOptionalText：把空字符串转换为 null。
 *
 * @param value 可选文本。
 * @returns 非空文本或 null。
 */
function normalizeOptionalText(value: string | null): string | null {
    if (value === null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0
        ? trimmed
        : null;
}

function convertIdePayloadToReference(payload: IdeContextReferencePayload): ComposerReferenceDraft {
    const link: InternalFileLink = {
        projectId: payload.projectId,
        absolutePath: payload.absolutePath,
        relativePath: payload.relativePath,
        startLine: payload.startLine > 0
            ? payload.startLine
            : null,
        endLine: payload.endLine > 0
            ? payload.endLine
            : null,
    };

    if (payload.type === "folder") {
        return {
            type: "folder",
            projectId: payload.projectId,
            absolutePath: payload.absolutePath,
            relativePath: payload.relativePath,
            displayName: payload.displayText,
        };
    }

    if (payload.type === "code") {
        return {
            type: "code",
            link,
            selectedCode: payload.selectedText,
            displayName: payload.displayText,
        };
    }

    return {
        type: "file",
        link,
        displayName: payload.displayText,
    };
}

function formatReferenceMarkdown(reference: ComposerReferenceDraft): string {
    if (reference.type === "folder") {
        return `[@${reference.displayName}](zhixin-folder:${encodeURIComponent(JSON.stringify(reference))})`;
    }

    if (reference.type === "code") {
        return `[@${reference.displayName}](zhixin-code:${encodeURIComponent(JSON.stringify(reference))})`;
    }

    return `[@${reference.displayName}](zhixin-file:${encodeURIComponent(JSON.stringify(reference.link))})`;
}
