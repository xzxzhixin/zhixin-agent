import {
    APP_NAME,
    CENTER_DATA_DIR_NAME,
    DEFAULT_CENTER_PORT,
    type AgentRuntimeStatus,
    type ApiError,
    type ApiResponse,
    type ClientType,
    type ConversationMessage,
    type ConversationSession,
    type ConversationTurn,
    type ExecutionMode,
    type EventRecord,
    type ProjectRecord,
    type SessionType,
    type TaskRecord,
    type TokenizerCountResponse,
    type WebSocketEnvelope,
} from "@zhixin/shared";

export interface CenterServiceConfig {
    /**
     * port: 中心服务监听端口，来源于 ZHIXIN_CENTER_PORT 或架构默认值。
     */
    port: number;

    /**
     * centerDirectory: 中心目录绝对路径，来源于 ZHIXIN_CENTER_DIR 或开发期默认目录。
     */
    centerDirectory: string;

    /**
     * frontendDistDirectory: 前端构建产物目录，来源于 ZHIXIN_FRONTEND_DIST 或开发期默认目录。
     */
    frontendDistDirectory: string | null;

    /**
     * frontendDevServerUrl: 开发期前端 Vite 服务地址，来源于 ZHIXIN_FRONTEND_DEV_URL。
     *
     * 格式：http://127.0.0.1:5173 或 http://localhost:5173。
     * 默认值：null，表示中心服务直接托管 frontendDistDirectory。
     * 约束：只允许本机开发地址，避免中心服务把页面请求跳转到外部站点。
     */
    frontendDevServerUrl: string | null;

    /**
     * builtinPluginsDirectory: 随包或开发同步后的内置插件目录，来源于 ZHIXIN_BUILTIN_PLUGINS_DIR。
     *
     * 格式：绝对路径。
     * 默认值：中心目录 plugins。
     * 约束：中心服务只把该目录同步到中心目录 plugins，不直接把插件代码打入中心服务。
     */
    builtinPluginsDirectory: string;
}

/**
 * 配置读取输入。
 *
 * 来源：检查脚本、桌面壳或真实进程环境。
 * 含义：让配置读取逻辑可以脱离 process 直接测试。
 * 格式：可选对象。
 * 默认值：使用 process.env 和 process.cwd()。
 * 约束：不保存到磁盘，只用于本次启动。
 */
export interface CenterServiceConfigInput {
    /**
     * env: 环境变量键值表，来源于调用方传入或进程环境。
     */
    env?: Record<string, string | undefined>;

    /**
     * cwd: 当前工作目录，来源于调用方传入或进程工作目录。
     */
    cwd?: string;

    /**
     * frontendDistDirectory: 前端构建产物目录，检查脚本可显式传入。
     */
    frontendDistDirectory?: string;
}

/**
 * 中心目录布局项。
 *
 * 来源：新版架构的 center-data 目录结构。
 * 含义：描述中心服务启动时必须创建的目录。
 * 格式：相对中心目录路径。
 * 默认值：固定布局。
 * 约束：目录路径必须使用英文架构名，不能回到旧中文中心目录。
 */
export interface CenterDirectoryLayoutItem {
    /**
     * relativePath: 相对中心目录路径，使用 POSIX 风格片段表达嵌套目录。
     */
    relativePath: string;
}

/**
 * ProviderCapabilityDeclaration：供应商模型能力声明。
 *
 * 来源：供应商配置和协议适配器能力。
 * 含义：中心服务判断附件、工具调用、JSON 输出、推理深度、缓存用量、模型列表和流式输出是否可用。
 * 格式：JSON 布尔字段对象。
 * 默认值：未声明时所有能力为 false，避免前端自行猜测。
 * 约束：字段名贯穿保存、查询和模型网关准备链路。
 */
export interface ProviderCapabilityDeclaration {
    /**
     * supportsVision: 是否支持图片输入。
     */
    supportsVision: boolean;

    /**
     * supportsToolCalling: 是否支持工具调用。
     */
    supportsToolCalling: boolean;

    /**
     * supportsJsonOutput: 是否支持 JSON 输出。
     */
    supportsJsonOutput: boolean;

    /**
     * supportsReasoningEffort: 是否支持推理深度参数。
     */
    supportsReasoningEffort: boolean;

    /**
     * providesCacheUsage: 是否返回缓存命中和未命中用量字段。
     */
    providesCacheUsage: boolean;

    /**
     * supportsModelList: 是否支持自动拉取模型列表。
     */
    supportsModelList: boolean;

    /**
     * supportsStreaming: 是否支持流式输出。
     */
    supportsStreaming: boolean;
}

/**
 * ProviderModelContextWindow：供应商模型上下文窗口配置。
 *
 * 来源：供应商页面用户手填模型窗口。
 * 含义：保存某个模型可用上下文上限，供前端计算当前窗口上下文占用比例。
 * 格式：模型名称加 token 数值。
 * 默认值：没有配置时不创建条目，前端展示未知窗口。
 * 约束：contextWindowTokens 必须是大于 0 的整数。
 */
export interface ProviderModelContextWindow {
    /**
     * model: 模型名称，来源于供应商模型列表或用户手填。
     */
    model: string;

    /**
     * contextWindowTokens: 模型上下文窗口上限，单位为 token。
     */
    contextWindowTokens: number;
}

/**
 * ProviderProxyPolicy：供应商代理策略。
 *
 * 来源：供应商配置页面。
 * 含义：决定供应商请求不使用代理、使用全局默认代理或使用指定代理配置。
 * 格式：JSON 对象。
 * 默认值：use-global-default，沿用中心服务全局默认代理策略。
 * 约束：只影响后续请求，不回改历史记录。
 */
export interface ProviderProxyPolicy {
    /**
     * mode: 代理策略模式。
     */
    mode: "none" | "use-global-default" | "use-specified";

    /**
     * proxyId: 指定代理配置 ID；仅 mode 为 use-specified 时使用。
     */
    proxyId: string | null;
}

/**
 * NetworkProxyConfigFile：网络代理配置文件结构。
 *
 * 来源：中心目录 `config/proxy-*.json`。
 * 含义：保存中心服务访问供应商时可选的网络代理。
 * 格式：JSON 对象。
 * 默认值：enabled 默认 true，username 默认空字符串，passwordSecretRef 默认 null。
 * 约束：客户端列表不能回显 passwordSecretRef 或密码明文，也不能把空用户名密码当作错误。
 */
export interface NetworkProxyConfigFile {
    /**
     * proxyId: 代理配置 ID，来源于中心服务生成 UUID。
     */
    proxyId: string;

    /**
     * proxyName: 用户填写的代理名称。
     */
    proxyName: string;

    /**
     * protocol: 代理协议，来源于前端枚举 HTTP/HTTPS/SOCKS4/SOCKS4a/SOCKS5。
     */
    protocol: string;

    /**
     * host: 代理主机名或 IP。
     */
    host: string;

    /**
     * port: 代理端口，范围由前端和中心服务共同限制为 TCP 端口。
     */
    port: number;

    /**
     * username: 代理用户名；空字符串表示无认证。
     */
    username: string;

    /**
     * passwordSecretRef: 中心服务敏感信息引用；null 表示未配置密码。
     */
    passwordSecretRef: string | null;

    /**
     * note: 用户备注，来源于网络代理管理页。
     */
    note: string;

    /**
     * enabled: 是否启用该代理。
     */
    enabled: boolean;

    /**
     * updatedAt: 最近更新时间，ISO 字符串。
     */
    updatedAt: string;
}

/**
 * RuntimeConfigRecord：运行环境配置文件结构。
 *
 * 来源：中心目录 `runtimes/*.json`。
 * 含义：保存插件、MCP、skill 和命令任务可选择的工具链路径。
 * 格式：JSON 对象。
 * 默认值：enabled 默认 true，isDefault 默认 false。
 * 约束：默认环境只在同一 runtimeType 内唯一。
 */
export interface RuntimeConfigRecord {
    /**
     * runtimeId: 运行环境 ID，来源于中心服务生成 UUID。
     */
    runtimeId: string;

    /**
     * runtimeName: 用户填写的环境名称。
     */
    runtimeName: string;

    /**
     * runtimeType: 环境类型，例如 Node.js、Python、Java、Maven、Git 或用户自定义类型。
     */
    runtimeType: string;

    /**
     * executablePath: 可执行文件路径。
     */
    executablePath: string;

    /**
     * rootPath: 工具链根目录。
     */
    rootPath: string;

    /**
     * version: 用户记录或检测得到的版本号。
     */
    version: string;

    /**
     * environmentVariables: 运行该环境时追加的环境变量键值。
     */
    environmentVariables: Record<string, string>;

    /**
     * pathEntries: 运行该环境时追加到 PATH 的目录数组。
     */
    pathEntries: string[];

    /**
     * isDefault: 是否为同类型默认环境。
     */
    isDefault: boolean;

    /**
     * enabled: 是否启用该环境。
     */
    enabled: boolean;

    /**
     * note: 用户备注。
     */
    note: string;

    /**
     * updatedAt: 最近更新时间，ISO 字符串。
     */
    updatedAt: string;
}

/**
 * 中心目录固定布局。
 *
 * 来源：`架构.md` 中“中心目录与数据存储”章节。
 * 含义：中心服务启动时创建完整可迁移目录。
 * 格式：只读数组。
 * 默认值：架构约定目录。
 * 约束：新增目录必须先更新架构和计划。
 */
export const CENTER_DIRECTORY_LAYOUT: readonly CenterDirectoryLayoutItem[] = [
    {
        relativePath: "db",
    },
    {
        relativePath: "db/migrations",
    },
    {
        relativePath: "config",
    },
    {
        relativePath: "memory",
    },
    {
        relativePath: "memory/agents",
    },
    {
        relativePath: "agents",
    },
    {
        relativePath: "providers",
    },
    {
        relativePath: "plugins",
    },
    {
        relativePath: "mcp",
    },
    {
        relativePath: "skills",
    },
    {
        relativePath: "runtimes",
    },
    {
        relativePath: "sessions",
    },
    {
        relativePath: "sessions/attachments",
    },
    {
        relativePath: "personal",
    },
    {
        relativePath: "personal/todos",
    },
    {
        relativePath: "personal/calendar",
    },
    {
        relativePath: "personal/knowledge",
    },
    {
        relativePath: "temp",
    },
    {
        relativePath: "logs",
    },
];

/**
 * 核心 SQLite 状态表。
 *
 * 来源：架构中的 SQLite 当前状态表清单。
 * 含义：阶段 2 必须由迁移创建的基础表。
 * 格式：SQLite 表名数组。
 * 默认值：固定表名。
 * 约束：表名作为迁移和检查脚本共同协议，不能随意改名。
 */
export const CORE_SQLITE_TABLES = [
    "projects",
    "sessions",
    "messages",
    "conversation_turns",
    "tasks",
    "task_steps",
    "agents_index",
    "agent_runtime_states",
    "memory_index",
    "attachments",
    "notifications",
    "usage_records",
    "usage_daily_stats",
    "todos",
    "calendar_events",
    "knowledge_items",
    "plugin_installs",
    "extension_call_records",
    "sync_clients",
    "pending_messages",
    "events",
] as const;

/**
 * 已应用迁移记录。
 *
 * 来源：SQLite `schema_migrations` 表。
 * 含义：描述中心服务已经执行过的迁移。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：version 必须唯一。
 */
export interface AppliedMigration {
    /**
     * version: 迁移版本号，格式为固定字符串。
     */
    version: string;

    /**
     * appliedAt: 迁移执行时间，ISO 8601 字符串。
     */
    appliedAt: string;
}

/**
 * 中心服务健康信息。
 *
 * 来源：`GET /api/health`。
 * 含义：客户端确认中心服务是否可用。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：不能包含敏感信息。
 */
export interface HealthResponse {
    /**
     * appName: 应用中文名，来源于共享协议常量。
     */
    appName: string;

    /**
     * version: 中心服务版本，来源于当前包版本。
     */
    version: string;

    /**
     * port: 当前中心服务端口。
     */
    port: number;

    /**
     * centerDirectory: 当前中心目录绝对路径。
     */
    centerDirectory: string;

    /**
     * processStartedAt: 当前中心服务进程启动时间，使用中心服务本机时间格式。
     */
    processStartedAt: string;

    /**
     * now: 当前健康检查返回时间，使用中心服务本机时间格式。
     */
    now: string;
}

/**
 * 启动状态信息。
 *
 * 来源：`GET /api/bootstrap/state`。
 * 含义：展示中心目录、数据库和迁移状态。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：只返回基础状态，不返回敏感配置。
 */
export interface BootstrapStateResponse {
    /**
     * ready: 中心服务是否完成启动前初始化。
     */
    ready: boolean;

    /**
     * centerDirectory: 当前中心目录绝对路径。
     */
    centerDirectory: string;

    /**
     * coreTables: 已要求创建的核心表名。
     */
    coreTables: string[];

    /**
     * appliedMigrations: 已应用迁移记录。
     */
    appliedMigrations: AppliedMigration[];
}

/**
 * 访问授权结果。
 *
 * 来源：阶段 3 访问控制接口。
 * 含义：返回中心服务识别出的客户端和访问类型。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：clientType 必须结合请求来源校验，不能只信任前端传值。
 */
export interface AccessAuthorizeResponse {
    /**
     * clientId: 中心服务生成的同步客户端 ID。
     */
    clientId: string;

    /**
     * clientType: 客户端声明类型，来源于请求体并经服务端校验。
     */
    clientType: ClientType;

    /**
     * accessKind: 服务端识别出的访问方式。
     */
    accessKind: "local" | "remote-web";

    /**
     * isLocalRequest: 是否由中心服务判定为本机请求。
     */
    isLocalRequest: boolean;
}

/**
 * Web 远程访问配置。
 *
 * 来源：桌面壳写入的 `config/access.json`。
 * 含义：中心服务用来校验非本机 Web 登录。
 * 格式：JSON 对象。
 * 默认值：webAccountConfigured 为 false。
 * 约束：passwordSha256 是密码 SHA-256 摘要，客户端不能读取明文密码。
 */
export interface AccessConfigFile {
    /**
     * webAccountConfigured: 是否已经由桌面壳配置远程访问账号。
     */
    webAccountConfigured: boolean;

    /**
     * account: Web 远程访问账号；未配置时可省略。
     */
    account?: string;

    /**
     * passwordSha256: Web 远程访问密码 SHA-256 摘要；未配置时可省略。
     */
    passwordSha256?: string;

    /**
     * updatedAt: 配置更新时间，ISO 8601 字符串。
     */
    updatedAt?: string;
}

/**
 * ConversationTokenUsageSnapshot：当前会话窗口上下文 token 用量快照。
 *
 * 来源：SQLite `conversation_token_usage` 表。
 * 含义：保存某个会话内某个智能体当前窗口最新 token 总览。
 * 格式：JSON 对象，字段名映射为前端可直接消费的驼峰格式。
 * 默认值：无记录时会话快照返回 null。
 * 约束：同一个 `sessionId + agentId` 只保留最新快照，不能替代模型调用 `usage_records`。
 */
export interface ConversationTokenUsageSnapshot {
    /** sessionId: 所属会话 ID，来源于 tokenizer.count 请求。 */
    sessionId: string;
    /** turnId: 最近一次统计关联的轮次 ID；草稿或无轮次时为 null。 */
    turnId: string | null;
    /** agentId: 所属智能体 ID，主智能体固定为 main。 */
    agentId: string;
    /** usedTokens: 当前窗口已用 token 数。 */
    usedTokens: number;
    /** windowLimitTokens: 当前模型窗口上限 token 数。 */
    windowLimitTokens: number;
    /** usagePercent: 已用比例，允许超过 100。 */
    usagePercent: number;
    /** tokenizerName: 本次统计使用的 tokenizer 名称。 */
    tokenizerName: string;
    /** tokenizerSource: tokenizer 来源，沿用中心服务统计响应。 */
    tokenizerSource: TokenizerCountResponse["source"];
    /** modelId: 本次统计使用的模型 ID 或模型名称。 */
    modelId: string;
    /** updatedAt: 快照更新时间，ISO 8601 字符串。 */
    updatedAt: string;
}

/**
 * 会话详情响应。
 *
 * 来源：阶段 6 会话详情接口。
 * 含义：一次返回会话、消息、轮次和任务当前状态。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：项目会话数据仍由中心服务维护，客户端不能直接读文件。
 */
export interface SessionDetailResponse {
    /**
     * session: 会话基础信息。
     */
    session: ConversationSession;

    /**
     * messages: 会话内消息列表。
     */
    messages: ConversationMessage[];

    /**
     * turns: 会话内轮次列表。
     */
    turns: ConversationTurn[];

    /**
     * tasks: 会话内任务列表。
     */
    tasks: TaskRecord[];

    /**
     * taskSteps: 会话内任务步骤列表。
     */
    taskSteps: TaskStepRecord[];

    /**
     * tokenUsage: 当前主智能体窗口 token 用量快照，来源于 `conversation_token_usage`。
     */
    tokenUsage: ConversationTokenUsageSnapshot | null;

    /**
     * lastAssistantMessageCreatedAt: 最近助手回复创建时间，用于对比轮次完成时间和最后回复时间。
     */
    lastAssistantMessageCreatedAt: string | null;
}

/**
 * 消息发送响应。
 *
 * 来源：阶段 6 消息发送接口。
 * 含义：返回本次用户消息、轮次和任务的身份字段。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：发送成功后必须追加事件日志，便于断线补齐。
 */
export interface SendMessageResponse {
    /**
     * sessionId: 当前用户消息所属会话 ID。
     *
     * 来源：发送接口已校验的会话记录。
     * 含义：后续任务、用量和附件提交继续绑定同一会话事实。
     * 格式：中心服务生成的会话 ID。
     * 默认值：无。
     * 约束：不能用轮次反查失败后的候选会话替代。
     */
    sessionId: string;

    /**
     * messageId: 用户消息 ID。
     */
    messageId: string;

    /**
     * turnId: 本轮对话 ID。
     */
    turnId: string;

    /**
     * taskId: 本轮默认任务 ID。
     */
    taskId: string;
}

/**
 * 任务步骤记录。
 *
 * 来源：SQLite `task_steps` 表。
 * 含义：保存用户可见任务拆解步骤状态，内部执行图过程不进入该表。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：状态变化必须写入事件日志。
 */
export interface TaskStepRecord {
    /**
     * stepId: 任务步骤 ID。
     */
    stepId: string;

    /**
     * taskId: 所属任务 ID。
     */
    taskId: string;

    /**
     * planVersion: 步骤所属计划版本，来源于 task_steps.plan_version，旧数据默认 1。
     */
    planVersion: number;

    /**
     * stepOrder: 同一任务内步骤顺序，来源于 task_steps.step_order，从 1 开始。
     */
    stepOrder: number;

    /**
     * source: 步骤来源，来源于 task_steps.source；graph 仅用于历史兼容，新执行图过程不再写入用户可见步骤。
     */
    source: "graph" | "model" | "todoList" | "user" | "system";

    /**
     * status: 步骤状态。
     */
    status: TaskRecord["status"];

    /**
     * title: 步骤标题。
     */
    title: string;

    /**
     * dependsOn: 依赖步骤 ID 列表，来源于 task_steps.depends_on JSON 数组。
     */
    dependsOn: string[];

    /**
     * acceptance: 步骤完成验收口径，来源于模型计划、todoList 或用户引导。
     */
    acceptance: string | null;

    /**
     * startedAt: 步骤开始时间。
     */
    startedAt: string | null;

    /**
     * endedAt: 步骤结束时间。
     */
    endedAt: string | null;

    /**
     * summary: 步骤摘要。
     */
    summary: string | null;

    /**
     * supersededBy: 替换当前步骤的新步骤 ID，未替换时为 null。
     */
    supersededBy: string | null;

    /**
     * supersededReason: 当前步骤被替换的原因，未替换时为 null。
     */
    supersededReason: string | null;
}

/**
 * 实时同步客户端连接。
 *
 * 来源：阶段 3 WebSocket 同步通道。
 * 含义：保存已经通过 client.hello 握手的连接和订阅范围。
 * 格式：运行期内存对象。
 * 默认值：握手前不加入集合。
 * 约束：只用于实时推送，事实仍写入 SQLite。
 */
export interface RealtimeClientConnection {
    /**
     * clientId: sync_clients 表中的客户端 ID。
     */
    clientId: string;

    /**
     * clientType: 客户端类型。
     */
    clientType: ClientType;

    /**
     * projectId: IDE 插件订阅项目 ID；非项目订阅为 null。
     */
    projectId: string | null;

    /**
     * send: WebSocket 发送函数。
     */
    send: (message: WebSocketEnvelope) => void;
}

/**
 * MemoryQueueState：智能体记忆单写队列状态。
 *
 * 来源：中心服务记忆写入边界。
 * 含义：按 agentId 记录记忆写入是否正在执行和等待数量。
 * 格式：运行期内存对象。
 * 默认值：没有写入时不存在。
 * 约束：只协调同一进程内中心服务写入，事实内容仍写入 Markdown 和 SQLite。
 */
export interface MemoryQueueState {
    /**
     * agentId: 智能体 ID，来源于记忆写入请求。
     */
    agentId: string;

    /**
     * running: 当前智能体是否正在执行记忆写入。
     */
    running: boolean;

    /**
     * pendingWrites: 当前智能体等待写入数量。
     */
    pendingWrites: number;
}

/**
 * SubAgentRuntimeRecord：一次性子智能体运行记录。
 *
 * 来源：Worker 执行任务上下文。
 * 含义：保存当前任务内临时子智能体，不落长期智能体定义。
 * 格式：运行期内存对象。
 * 默认值：无。
 * 约束：parentIsSubAgent 为 true 时禁止继续创建子智能体。
 */
export interface SubAgentRuntimeRecord {
    /**
     * subAgentId: 子智能体运行期 ID。
     */
    subAgentId: string;

    /**
     * parentAgentId: 创建它的长期智能体或主智能体 ID。
     */
    parentAgentId: string;

    /**
     * taskId: 所属任务 ID。
     */
    taskId: string;

    /**
     * parentProviderId: 父级智能体创建子智能体时实际使用的供应商 ID。
     */
    parentProviderId: string;

    /**
     * parentModelId: 父级智能体创建子智能体时实际使用的模型 ID 或模型名称。
     */
    parentModelId: string;

    /**
     * parentReasoningEffort: 父级智能体决定传给子智能体的推理深度；null 表示供应商不支持或父级未启用推理深度。
     */
    parentReasoningEffort: string | null;

    /**
     * name: 子智能体展示名称。
     */
    name: string;

    /**
     * createdAt: 创建时间，ISO 8601 字符串。
     */
    createdAt: string;
}

/**
 * FrontendAsset：中心服务静态前端资源读取结果。
 *
 * 来源：apps/frontend/dist 或桌面绿色版 resources/frontend。
 * 含义：让中心服务直接提供 Web 端页面和拆包后的 assets。
 * 格式：二进制 Buffer 加 MIME 类型。
 * 默认值：无。
 * 约束：只能读取前端产物目录内部文件，不能透传任意磁盘路径。
 */
export interface FrontendAsset {
    /**
     * content: 前端资源文件内容。
     */
    content: Buffer;

    /**
     * contentType: HTTP Content-Type 响应头。
     */
    contentType: string;
}
