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
     * selectCenterDirectory: 打开桌面原生目录选择器选择中心目录。
     */
    selectCenterDirectory: () => Promise<string | null>;

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

/**
 * IdePluginBridge：IDE 插件宿主桥接能力。
 *
 * 来源：IDEA 插件 WebView 注入对象。
 * 含义：提供 Web 端无法完成的宿主级能力，例如打开 IDE 原生 diff。
 * 格式：函数集合。
 * 默认值：普通浏览器入口不存在。
 * 约束：只能用于宿主 UI 能力，不绕过中心服务读写核心事实。
 */
interface IdePluginBridge {
    /** openEditDiff: 打开 IDE 原生编辑前后对比视图。 */
    openEditDiff: (payload: {
        /** filePath: 被编辑文件路径。 */
        filePath: string;
        /** beforeContent: 编辑前内容。 */
        beforeContent: string;
        /** afterContent: 编辑后内容。 */
        afterContent: string;
        /** title: 对比窗口标题。 */
        title: string;
    }) => Promise<void>;
}

declare global {
    interface Window {
        /**
         * zhixinDesktop: Electron preload 暴露的桌面壳桥接对象。
         */
        zhixinDesktop?: DesktopBridge;
        /**
         * zhixinPlugin: IDE 插件 WebView 暴露的宿主桥接对象。
         */
        zhixinPlugin?: IdePluginBridge;
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
    /** protocolPluginId: 协议适配器 ID，OpenAI 内置固定为 openai-builtin。 */
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
    /** refreshModelContextWindowsText: 手动模型窗口配置，每行格式为 模型名=数字K。 */
    refreshModelContextWindowsText: string;
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
    /** clearAuth: 是否清除中心服务已保存的代理认证。 */
    clearAuth: boolean;
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
 * 含义：承载全局 MCP Server 的标准 MCP 配置 JSON。
 * 格式：configJson 使用完整 `{"mcpServers":{"服务 ID":{...}}}`，但一次只允许一个服务。
 * 默认值：见 `createMcpDraft`。
 * 约束：保存时从完整 JSON 抽取唯一 serverId 和 serverConfig，由中心服务合并写回全局配置。
 */
export interface McpDraft {
    /** projectId: 历史兼容字段；MCP 管理页固定全局配置，因此保持空字符串。 */
    projectId: string;
    /** serverId: 当前编辑的 MCP Server ID，来源于 configJson.mcpServers 的唯一 key。 */
    serverId: string;
    /** configJson: 标准 MCP 配置 JSON 文本，根字段固定为 mcpServers。 */
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
 * AgentDraft：智能体管理表单草稿。
 *
 * 来源：智能体管理页面。
 * 含义：承载长期智能体创建和修改所需字段。
 * 格式：JSON 对象。
 * 默认值：创建页使用空值，编辑页由选中智能体回填。
 * 约束：主智能体不使用该草稿编辑。
 */
export interface AgentDraft {
    /** agentId: 智能体 ID，新增时为 null。 */
    agentId: string | null;
    /** name: 智能体名称。 */
    name: string;
    /** roleDescription: 角色说明。 */
    roleDescription: string;
    /** defaultProviderId: 默认供应商 ID，未选择时为 null。 */
    defaultProviderId: string | null;
    /** defaultModel: 默认模型。 */
    defaultModel: string;
    /** reasoningEffort: 推理深度。 */
    reasoningEffort: string;
    /** archiveMemoryOnDelete: 删除时是否归档专属记忆。 */
    archiveMemoryOnDelete: boolean;
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
 * ComposerEditFile：输入区“编辑”入口的真实待确认编辑记录。
 *
 * 来源：中心服务 `pending_edit_records` 表。
 * 含义：描述真实文件路径、保存/撤回状态和编辑前后 diff。
 * 格式：文件记录对象。
 * 默认值：中心服务没有待确认编辑时为空数组。
 * 约束：保存和撤回必须调用中心服务接口，不能只更新前端状态。
 */
export interface ComposerEditFile {
    /** editId: 中心服务待确认编辑记录 ID。 */
    editId: string;
    /** filePath: 文件相对路径或可展示路径。 */
    filePath: string;
    /** changeKind: 变更类型中文文案。 */
    changeKind: string;
    /** status: 编辑确认状态，来源于中心服务。 */
    status: "pending" | "accepted" | "reverted" | "conflicted";
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
 * QueuedComposerMessage：当前对话本地排队消息。
 *
 * 来源：当前会话存在运行中或等待用户轮次时，用户按 Enter 或点击发送产生。
 * 含义：只表示当前前端窗口中等待转为引导的消息，不代表中心服务全局队列。
 * 格式：排队 ID、会话 ID、正文和创建时间。
 * 默认值：无排队消息时为空数组。
 * 约束：点击“引导”后必须立即移除；刷新或切换会话时不自动发送。
 */
export interface QueuedComposerMessage {
    /** queuedMessageId: 前端本地排队消息 ID，使用时间戳和随机片段生成。 */
    queuedMessageId: string;
    /** sessionId: 排队消息所属会话 ID；没有真实会话时为空字符串。 */
    sessionId: string;
    /** contentMarkdown: 排队消息 Markdown 正文，来源于发送时的输入区草稿。 */
    contentMarkdown: string;
    /** createdAt: 排队消息创建时间，ISO 字符串，仅用于当前 UI 展示。 */
    createdAt: string;
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
    /** contextUsedTokens: 当前对话窗口已使用上下文数量，单位为 token。 */
    contextUsedTokens: number;
    /** contextTokenizerName: 当前上下文统计使用的 tokenizer 名称。 */
    contextTokenizerName: string;
    /** contextTokenizerSource: tokenizer 来源，来自中心服务统计响应。 */
    contextTokenizerSource: "built-in" | "external" | "";
    /** reasoningEffort: 推理深度协议值。 */
    reasoningEffort: "low" | "medium" | "high" | "xhigh";
}

/**
 * ComposerContextUsageState：输入区上下文统计调度状态。
 *
 * 来源：前端本地输入区。
 * 含义：用于节流 tokenizer 请求、去重相同请求，并防止旧响应覆盖新状态。
 * 格式：定时器 ID、最近请求键和递增序号。
 * 默认值：timer 为 null，key 为空，serial 为 0。
 * 约束：只影响 UI 刷新频率，不替代中心服务 tokenizer 事实。
 */
export interface ComposerContextUsageState {
    /** composerContextUsageTimer: 浏览器 setTimeout 返回的定时器 ID；没有待执行统计时为 null。 */
    composerContextUsageTimer: number | null;
    /** lastComposerContextUsageKey: 最近一次已经发送到中心服务的统计请求签名。 */
    lastComposerContextUsageKey: string;
    /** composerContextUsageRequestSerial: 统计请求递增序号，用于忽略较早返回的旧响应。 */
    composerContextUsageRequestSerial: number;
}

import type {
    AgentConfigView,
    ProviderCapabilityDeclaration,
    ProviderProxyPolicy,
} from "@zhixin/api-client";
import type {
    ComposerDraftModel,
    ComposerReferenceDraft,
} from "@zhixin/ui";
import type {ProjectRecord} from "@zhixin/shared";
