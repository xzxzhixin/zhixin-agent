import {createHash, randomUUID} from "node:crypto";
import {open, readFile, rm, stat, writeFile} from "node:fs/promises";
import {appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, extname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import Database from "better-sqlite3";
import websocket from "@fastify/websocket";
import Fastify, {
    type FastifyReply,
    type FastifyInstance,
} from "fastify";

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
    type WebSocketEnvelope,
} from "@zhixin/shared";

/**
 * 中心服务启动配置。
 *
 * 来源：桌面壳环境变量或开发期默认值。
 * 含义：决定中心服务监听端口、中心目录位置和前端资源目录。
 * 格式：JSON 对象。
 * 默认值：端口为 8866，中心目录为当前工作目录下 center-data。
 * 约束：中心目录和前端资源目录必须在启动前规范化为绝对路径。
 */
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
 * 来源：供应商配置和模型协议插件能力。
 * 含义：中心服务判断附件、工具调用、JSON 输出、推理深度、缓存用量、模型列表和流式输出是否可用。
 * 格式：JSON 布尔字段对象。
 * 默认值：未声明时所有能力为 false，避免前端自行猜测。
 * 约束：字段名贯穿保存、查询和模型网关准备链路。
 */
interface ProviderCapabilityDeclaration {
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
interface ProviderModelContextWindow {
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
interface ProviderProxyPolicy {
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
interface NetworkProxyConfigFile {
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
interface RuntimeConfigRecord {
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
     * now: 服务端当前时间，ISO 8601 字符串。
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
 * 含义：保存任务执行过程中的单步状态。
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
     * status: 步骤状态。
     */
    status: TaskRecord["status"];

    /**
     * title: 步骤标题。
     */
    title: string;

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
interface MemoryQueueState {
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
interface SubAgentRuntimeRecord {
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
interface FrontendAsset {
    /**
     * content: 前端资源文件内容。
     */
    content: Buffer;

    /**
     * contentType: HTTP Content-Type 响应头。
     */
    contentType: string;
}

/**
 * readCenterServiceConfig：读取中心服务启动配置。
 *
 * @param input 可选配置输入，检查脚本和桌面壳可显式传入。
 * @returns 规范化后的中心服务配置。
 */
export function readCenterServiceConfig(input: CenterServiceConfigInput = {}): CenterServiceConfig {
    // env: 默认读取进程环境变量，桌面壳后续可传入隔离环境。
    const env = input.env ?? process.env;
    // cwd: 默认读取进程当前目录，开发期 center-data 以这里为基准。
    const cwd = input.cwd ?? process.cwd();
    // rawPort: 桌面壳传入的端口文本。
    const rawPort = env.ZHIXIN_CENTER_PORT;
    // parsedPort: 端口必须是有限数字，否则回到架构默认值。
    const parsedPort = rawPort ? Number.parseInt(rawPort, 10) : DEFAULT_CENTER_PORT;
    // port: 只接受合法 TCP 用户端口，避免启动失败后难以排查。
    const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
        ? parsedPort
        : DEFAULT_CENTER_PORT;
    // rawCenterDirectory: 桌面壳可传入用户选择的中心目录。
    const rawCenterDirectory = env.ZHIXIN_CENTER_DIR;
    // centerDirectory: 未传入时按新版架构使用 cwd/center-data。
    const centerDirectory = rawCenterDirectory
        ? resolve(rawCenterDirectory)
        : resolve(cwd, CENTER_DATA_DIR_NAME);
    // rawFrontendDistDirectory: 桌面壳或开发脚本传入的前端构建产物目录。
    const rawFrontendDistDirectory = input.frontendDistDirectory ?? env.ZHIXIN_FRONTEND_DIST;
    // defaultFrontendDistDirectory: 开发期中心服务从仓库根目录启动时使用 apps/frontend/dist。
    const defaultFrontendDistDirectory = resolve(cwd, "apps", "frontend", "dist");
    // frontendDistDirectory: 存在入口文件时才启用静态资源托管，避免 API 检查脚本误依赖前端构建。
    const frontendDistDirectory = rawFrontendDistDirectory
        ? resolve(rawFrontendDistDirectory)
        : existsSync(join(defaultFrontendDistDirectory, "index.html"))
            ? defaultFrontendDistDirectory
            : null;

    return {
        port,
        centerDirectory,
        frontendDistDirectory,
    };
}

/**
 * resolveFrontendAssetPath：把请求路径映射到前端构建产物文件。
 *
 * @param frontendDistDirectory 前端构建产物目录。
 * @param requestPath HTTP 请求路径。
 * @returns 位于前端产物目录内的文件路径；不应托管时返回 null。
 */
function resolveFrontendAssetPath(frontendDistDirectory: string | null, requestPath: string): string | null {
    if (frontendDistDirectory === null) {
        return null;
    }

    // pathname: 去掉查询参数后的 URL 路径，避免把 query 当作文件名。
    const pathname = requestPath.split("?")[0] ?? "/";

    if (pathname.startsWith("/api/")) {
        return null;
    }

    // relativeAssetPath: 前端资源相对路径，根路径和业务 hash 路由都回退到 index.html。
    const relativeAssetPath = pathname === "/" || pathname === "/index.html"
        ? "index.html"
        : pathname === "/plugin.html"
            ? "plugin.html"
            : pathname.startsWith("/assets/")
                ? pathname.slice(1)
                : "index.html";
    // assetPath: 规范化后的资源绝对路径。
    const assetPath = resolve(frontendDistDirectory, relativeAssetPath);
    // frontendRoot: 规范化后的前端产物根目录。
    const frontendRoot = resolve(frontendDistDirectory);

    if (assetPath !== frontendRoot && !assetPath.startsWith(`${frontendRoot}\\`) && !assetPath.startsWith(`${frontendRoot}/`)) {
        return null;
    }

    return assetPath;
}

/**
 * readFrontendAsset：读取前端静态资源。
 *
 * @param frontendDistDirectory 前端构建产物目录。
 * @param requestPath HTTP 请求路径。
 * @returns 前端资源内容和 MIME；缺失或越界时返回 null。
 */
async function readFrontendAsset(frontendDistDirectory: string | null, requestPath: string): Promise<FrontendAsset | null> {
    // assetPath: 请求映射后的前端资源路径。
    const assetPath = resolveFrontendAssetPath(frontendDistDirectory, requestPath);

    if (assetPath === null || !existsSync(assetPath)) {
        return null;
    }

    // assetStat: 只允许返回文件，目录请求继续走入口回退。
    const assetStat = await stat(assetPath);
    if (!assetStat.isFile()) {
        return null;
    }

    return {
        content: await readFile(assetPath),
        contentType: resolveFrontendContentType(assetPath),
    };
}

/**
 * resolveFrontendContentType：根据扩展名返回前端资源 MIME。
 *
 * @param assetPath 前端资源文件路径。
 * @returns HTTP Content-Type。
 */
function resolveFrontendContentType(assetPath: string): string {
    // extension: 文件扩展名，来自 Vite 构建产物。
    const extension = extname(assetPath).toLowerCase();

    if (extension === ".html") {
        return "text/html; charset=utf-8";
    }

    if (extension === ".js") {
        return "text/javascript; charset=utf-8";
    }

    if (extension === ".css") {
        return "text/css; charset=utf-8";
    }

    if (extension === ".svg") {
        return "image/svg+xml";
    }

    if (extension === ".png") {
        return "image/png";
    }

    if (extension === ".woff2") {
        return "font/woff2";
    }

    return "application/octet-stream";
}

/**
 * CenterLogger：中心服务追加式日志写入器。
 *
 * 用途：记录启动、迁移、错误和基础审计事件。
 * 关键逻辑：日志只追加到 center-data/logs/center.log，避免覆盖历史。
 */
export class CenterLogger {
    /**
     * logFilePath: 日志文件绝对路径，来源于中心目录 logs 子目录。
     */
    private readonly logFilePath: string;

    /**
     * constructor：绑定日志文件路径。
     *
     * @param centerDirectory 中心目录绝对路径。
     */
    constructor(centerDirectory: string) {
        this.logFilePath = join(centerDirectory, "logs", "center.log");
    }

    /**
     * info：写入信息级日志。
     *
     * @param event 固定事件名，便于后续按文本排查。
     * @param payload 结构化日志载荷，不能包含敏感明文。
     * @returns 日志写入完成后没有返回值。
     */
    async info(event: string, payload: Record<string, unknown>): Promise<void> {
        await this.write("info", event, payload);
    }

    /**
     * error：写入错误级日志。
     *
     * @param event 固定事件名，便于追踪错误来源。
     * @param payload 结构化错误载荷，不能包含敏感明文。
     * @returns 日志写入完成后没有返回值。
     */
    async error(event: string, payload: Record<string, unknown>): Promise<void> {
        await this.write("error", event, payload);
    }

    /**
     * write：追加一行 JSON 日志。
     *
     * @param level 日志级别。
     * @param event 固定事件名。
     * @param payload 结构化载荷。
     * @returns 写入完成后没有返回值。
     */
    private async write(
        level: "info" | "error",
        event: string,
        payload: Record<string, unknown>,
    ): Promise<void> {
        // line: 每行一个 JSON 对象，方便后续增量读取和 grep。
        const line = JSON.stringify({
            level,
            event,
            payload,
            occurredAt: new Date().toISOString(),
        });
        // mkdirSync: 日志可能在初始化早期调用，先确保父目录存在。
        mkdirSync(dirname(this.logFilePath), {
            recursive: true,
        });
        // appendFileSync: 阶段 2 日志体量小，同步追加能避免进程退出时丢日志。
        appendFileSync(this.logFilePath, `${line}\n`, "utf-8");
    }
}

/**
 * CenterDirectory：中心目录初始化器。
 *
 * 用途：创建 center-data 固定目录、清理 temp 并写入基础配置文件。
 */
export class CenterDirectory {
    /**
     * config: 中心服务启动配置。
     */
    private readonly config: CenterServiceConfig;

    /**
     * constructor：保存中心服务配置。
     *
     * @param config 中心服务启动配置。
     */
    constructor(config: CenterServiceConfig) {
        this.config = config;
    }

    /**
     * initialize：创建中心目录和固定子目录。
     *
     * @returns 初始化完成后没有返回值。
     */
    async initialize(): Promise<void> {
        // mkdirSync: 先创建中心根目录，后续相对目录才有明确边界。
        mkdirSync(this.config.centerDirectory, {
            recursive: true,
        });

        for (const directory of CENTER_DIRECTORY_LAYOUT) {
            // directoryPath: 每个相对目录都限定在 center-data 下。
            const directoryPath = join(this.config.centerDirectory, directory.relativePath);
            mkdirSync(directoryPath, {
                recursive: true,
            });
        }

        await this.cleanTempDirectory();
        await this.ensureJsonFile(
            join(this.config.centerDirectory, "config", "center.json"),
            {
                port: this.config.port,
                centerDirectory: this.config.centerDirectory,
                updatedAt: new Date().toISOString(),
            },
        );
        await this.ensureJsonFile(
            join(this.config.centerDirectory, "config", "access.json"),
            {
                webAccountConfigured: false,
                updatedAt: new Date().toISOString(),
            },
        );
        await this.ensureJsonFile(
            join(this.config.centerDirectory, "config", "notification.json"),
            {
                systemPermission: "unknown",
                updatedAt: new Date().toISOString(),
            },
        );
        await this.ensureTextFile(
            join(this.config.centerDirectory, "memory", "user.md"),
            "",
        );
    }

    /**
     * close：停止阶段清理临时目录。
     *
     * @returns 清理完成后没有返回值。
     */
    async close(): Promise<void> {
        await this.cleanTempDirectory();
    }

    /**
     * cleanTempDirectory：清理未绑定正式消息的临时附件目录。
     *
     * @returns 清理完成后没有返回值。
     */
    private async cleanTempDirectory(): Promise<void> {
        // tempDirectory: temp 不属于迁移事实源，启动和停止时清理。
        const tempDirectory = join(this.config.centerDirectory, "temp");
        await rm(tempDirectory, {
            force: true,
            recursive: true,
        });
        mkdirSync(tempDirectory, {
            recursive: true,
        });
    }

    /**
     * ensureJsonFile：缺失时创建 JSON 文件。
     *
     * @param filePath 目标文件绝对路径。
     * @param value 初始 JSON 值。
     * @returns 文件存在或创建完成后没有返回值。
     */
    private async ensureJsonFile(filePath: string, value: Record<string, unknown>): Promise<void> {
        if (existsSync(filePath)) {
            return;
        }

        mkdirSync(dirname(filePath), {
            recursive: true,
        });
        await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    }

    /**
     * ensureTextFile：缺失时创建文本文件。
     *
     * @param filePath 目标文件绝对路径。
     * @param value 初始文本内容。
     * @returns 文件存在或创建完成后没有返回值。
     */
    private async ensureTextFile(filePath: string, value: string): Promise<void> {
        if (existsSync(filePath)) {
            return;
        }

        mkdirSync(dirname(filePath), {
            recursive: true,
        });
        await writeFile(filePath, value, "utf-8");
    }
}

/**
 * CenterDatabase：中心服务 SQLite 连接封装。
 *
 * 用途：保证只有中心服务主进程持有 better-sqlite3 连接，并集中执行迁移。
 */
export class CenterDatabase {
    /**
     * config: 中心服务启动配置。
     */
    private readonly config: CenterServiceConfig;

    /**
     * databasePath: SQLite 数据库绝对路径。
     */
    private readonly databasePath: string;

    /**
     * db: better-sqlite3 同步连接，只在中心服务主进程内使用。
     */
    private db: Database.Database | null = null;

    /**
     * constructor：保存配置并生成数据库路径。
     *
     * @param config 中心服务启动配置。
     */
    constructor(config: CenterServiceConfig) {
        this.config = config;
        this.databasePath = join(config.centerDirectory, "db", "zhixin.sqlite");
    }

    /**
     * initialize：打开数据库并执行迁移。
     *
     * @returns 初始化完成后没有返回值。
     */
    initialize(): void {
        // mkdirSync: SQLite 文件所在目录必须先存在。
        mkdirSync(dirname(this.databasePath), {
            recursive: true,
        });
        // db: better-sqlite3 连接只保存在当前类，避免 Worker 直接访问。
        this.db = new Database(this.databasePath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
        this.runMigrations();
    }

    /**
     * hasTable：检查指定表是否存在。
     *
     * @param tableName SQLite 表名。
     * @returns 存在时返回 true。
     */
    hasTable(tableName: string): boolean {
        const db = this.requireDatabase();
        const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
        return Boolean(row);
    }

    /**
     * listAppliedMigrations：读取已执行迁移。
     *
     * @returns 迁移记录数组。
     */
    listAppliedMigrations(): AppliedMigration[] {
        const db = this.requireDatabase();
        return db.prepare("SELECT version, applied_at AS appliedAt FROM schema_migrations ORDER BY version").all() as AppliedMigration[];
    }

    /**
     * connection：获取中心服务主进程持有的 SQLite 连接。
     *
     * @returns better-sqlite3 数据库连接。
     */
    connection(): Database.Database {
        return this.requireDatabase();
    }

    /**
     * close：关闭 SQLite 连接。
     *
     * @returns 关闭后没有返回值。
     */
    close(): void {
        if (!this.db) {
            return;
        }

        this.db.close();
        this.db = null;
    }

    /**
     * runMigrations：执行阶段 2 初始迁移。
     *
     * @returns 迁移完成后没有返回值。
     */
    private runMigrations(): void {
        const db = this.requireDatabase();
        db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations
            (
                version
                TEXT
                PRIMARY
                KEY,
                applied_at
                TEXT
                NOT
                NULL
            );
        `);

        const migrationVersion = "0001_center_bootstrap";
        const exists = db
            .prepare("SELECT version FROM schema_migrations WHERE version = ?")
            .get(migrationVersion);

        if (exists) {
            this.createCoreTables(db);
            return;
        }

        const transaction = db.transaction(() => {
            this.createCoreTables(db);
            db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
                migrationVersion,
                new Date().toISOString(),
            );
        });

        transaction();
    }

    /**
     * createCoreTables：创建阶段 2 核心状态表和事件表。
     *
     * @param db better-sqlite3 数据库连接。
     * @returns 建表完成后没有返回值。
     */
    private createCoreTables(db: Database.Database): void {
        db.exec(`
            CREATE TABLE IF NOT EXISTS projects
            (
                id
                TEXT
                PRIMARY
                KEY,
                display_name
                TEXT
                NOT
                NULL,
                alias
                TEXT,
                latest_path
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS sessions
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_type
                TEXT
                NOT
                NULL,
                project_id
                TEXT,
                title
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS messages
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_id
                TEXT
                NOT
                NULL,
                turn_id
                TEXT,
                role
                TEXT
                NOT
                NULL,
                content_markdown
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS conversation_turns
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_id
                TEXT
                NOT
                NULL,
                turn_number
                INTEGER
                NOT
                NULL,
                user_message_id
                TEXT
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                started_at
                TEXT
                NOT
                NULL,
                ended_at
                TEXT,
                duration_ms
                INTEGER
            );

            CREATE TABLE IF NOT EXISTS tasks
            (
                id
                TEXT
                PRIMARY
                KEY,
                turn_id
                TEXT
                NOT
                NULL,
                session_id
                TEXT
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                title
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS task_steps
            (
                id
                TEXT
                PRIMARY
                KEY,
                task_id
                TEXT
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                title
                TEXT
                NOT
                NULL,
                started_at
                TEXT,
                ended_at
                TEXT,
                summary
                TEXT
            );

            CREATE TABLE IF NOT EXISTS agents_index
            (
                id
                TEXT
                PRIMARY
                KEY,
                name
                TEXT
                NOT
                NULL,
                enabled
                INTEGER
                NOT
                NULL,
                role_description
                TEXT,
                capability_boundary
                TEXT,
                default_provider_id
                TEXT,
                default_model
                TEXT,
                reasoning_effort
                TEXT,
                memory_index_path
                TEXT,
                created_by
                TEXT,
                definition_path
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS memory_index
            (
                id
                TEXT
                PRIMARY
                KEY,
                agent_id
                TEXT
                NOT
                NULL,
                keywords
                TEXT
                NOT
                NULL,
                summary
                TEXT
                NOT
                NULL,
                source_session_id
                TEXT,
                source_turn_id
                TEXT,
                attachment_refs_json
                TEXT
                NOT
                NULL,
                memory_path
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS agent_runtime_states
            (
                agent_id
                TEXT
                PRIMARY
                KEY,
                status
                TEXT
                NOT
                NULL,
                current_task_id
                TEXT,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS attachments
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_id
                TEXT
                NOT
                NULL,
                message_id
                TEXT
                NOT
                NULL,
                file_name
                TEXT
                NOT
                NULL,
                mime_type
                TEXT
                NOT
                NULL,
                size_bytes
                INTEGER
                NOT
                NULL,
                relative_path
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS notifications
            (
                id
                TEXT
                PRIMARY
                KEY,
                target_client_type
                TEXT
                NOT
                NULL,
                session_id
                TEXT,
                project_id
                TEXT,
                title
                TEXT
                NOT
                NULL,
                summary
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL,
                requires_user_action
                INTEGER
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS usage_records
            (
                id
                TEXT
                PRIMARY
                KEY,
                provider_id
                TEXT
                NOT
                NULL,
                model
                TEXT
                NOT
                NULL,
                project_id
                TEXT,
                session_id
                TEXT,
                input_tokens
                INTEGER,
                output_tokens
                INTEGER,
                cache_hit_tokens
                INTEGER,
                cache_miss_tokens
                INTEGER,
                status
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS usage_daily_stats
            (
                id
                TEXT
                PRIMARY
                KEY,
                stat_date
                TEXT
                NOT
                NULL,
                provider_id
                TEXT
                NOT
                NULL,
                model
                TEXT
                NOT
                NULL,
                project_id
                TEXT,
                payload_json
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS todos
            (
                id
                TEXT
                PRIMARY
                KEY,
                title
                TEXT
                NOT
                NULL,
                completed
                INTEGER
                NOT
                NULL,
                due_at
                TEXT,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS calendar_events
            (
                id
                TEXT
                PRIMARY
                KEY,
                title
                TEXT
                NOT
                NULL,
                starts_at
                TEXT
                NOT
                NULL,
                ends_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS knowledge_items
            (
                id
                TEXT
                PRIMARY
                KEY,
                title
                TEXT
                NOT
                NULL,
                summary
                TEXT
                NOT
                NULL,
                source_ref
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS plugin_installs
            (
                id
                TEXT
                PRIMARY
                KEY,
                source
                TEXT
                NOT
                NULL,
                scope
                TEXT
                NOT
                NULL,
                enabled
                INTEGER
                NOT
                NULL,
                manifest_json
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS extension_call_records
            (
                id
                TEXT
                PRIMARY
                KEY,
                extension_id
                TEXT
                NOT
                NULL,
                session_id
                TEXT,
                task_id
                TEXT,
                status
                TEXT
                NOT
                NULL,
                input_summary
                TEXT
                NOT
                NULL,
                output_summary
                TEXT,
                created_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS sync_clients
            (
                id
                TEXT
                PRIMARY
                KEY,
                client_type
                TEXT
                NOT
                NULL,
                project_id
                TEXT,
                last_seen_at
                TEXT
                NOT
                NULL,
                last_event_sequence
                INTEGER
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS pending_messages
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_id
                TEXT
                NOT
                NULL,
                client_id
                TEXT,
                content_markdown
                TEXT
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS events
            (
                id
                TEXT
                PRIMARY
                KEY,
                event_type
                TEXT
                NOT
                NULL,
                scope_type
                TEXT
                NOT
                NULL,
                scope_id
                TEXT,
                session_id
                TEXT,
                turn_id
                TEXT,
                task_id
                TEXT,
                step_id
                TEXT,
                agent_id
                TEXT,
                project_id
                TEXT,
                client_id
                TEXT,
                sequence
                INTEGER
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                occurred_at
                TEXT
                NOT
                NULL,
                title
                TEXT
                NOT
                NULL,
                summary
                TEXT
                NOT
                NULL,
                payload_json
                TEXT
                NOT
                NULL,
                error_code
                TEXT,
                trace_id
                TEXT
                NOT
                NULL
            );

            CREATE INDEX IF NOT EXISTS idx_events_turn_sequence ON events (turn_id, sequence);
        `);

        // usage_records.session_id: 旧开发库可能已存在 0001 表结构；这里按字段探测补列，避免迁移记录已存在时遗漏会话筛选字段。
        const usageColumns = db.prepare("PRAGMA table_info(usage_records)").all() as Array<{
            name: string;
        }>;
        const hasUsageSessionId = usageColumns.some((column) => {
            return column.name === "session_id";
        });
        if (!hasUsageSessionId) {
            db.exec("ALTER TABLE usage_records ADD COLUMN session_id TEXT");
        }
    }

    /**
     * requireDatabase：获取已经初始化的数据库连接。
     *
     * @returns better-sqlite3 数据库连接。
     */
    private requireDatabase(): Database.Database {
        if (!this.db) {
            throw new Error("中心服务数据库尚未初始化");
        }

        return this.db;
    }
}

/**
 * CenterEventStore：事件日志序号和追加入口。
 *
 * 用途：阶段 2 先提供同一轮次 sequence 递增能力，后续阶段写入完整事件。
 */
export class CenterEventStore {
    /**
     * database: 中心服务数据库封装，用于把事件追加到 SQLite。
     */
    private readonly database: CenterDatabase;

    /**
     * sequenceByTurn: 内存中的轮次序号缓存，来源于当前进程运行期。
     */
    private readonly sequenceByTurn = new Map<string, number>();

    /**
     * constructor：绑定中心服务数据库。
     *
     * @param database 中心服务 SQLite 封装。
     */
    constructor(database: CenterDatabase) {
        this.database = database;
    }

    /**
     * nextSequenceForTurn：获取同一轮次内下一个事件序号。
     *
     * @param turnId 轮次 ID。
     * @returns 从 1 开始递增的序号。
     */
    nextSequenceForTurn(turnId: string): number {
        // persisted: 先读取数据库最大序号，避免服务重启后从 1 重复。
        const persisted = this.database.connection()
            .prepare("SELECT MAX(sequence) AS maxSequence FROM events WHERE turn_id = ?")
            .get(turnId) as {
            maxSequence: number | null;
        } | undefined;
        // current: 同时考虑内存缓存和 SQLite 已落库事件。
        const current = Math.max(
            this.sequenceByTurn.get(turnId) ?? 0,
            persisted?.maxSequence ?? 0,
        );
        // next: 同一轮次内严格递增。
        const next = current + 1;
        this.sequenceByTurn.set(turnId, next);
        return next;
    }

    /**
     * append：追加中心服务事件日志。
     *
     * @param input 事件写入参数。
     * @returns 已写入的事件记录。
     */
    append(input: {
        eventType: string;
        scopeType: string;
        scopeId: string | null;
        sessionId: string | null;
        turnId: string | null;
        taskId: string | null;
        stepId?: string | null;
        agentId?: string | null;
        projectId?: string | null;
        clientId?: string | null;
        status: string;
        title: string;
        summary: string;
        payload: unknown;
        errorCode?: string | null;
        traceId?: string;
    }): EventRecord {
        // traceId: 每条事件都生成排查 ID，方便 UI 和日志关联。
        const traceId = input.traceId ?? randomUUID();
        // sequence: 无轮次事件使用 0，轮次内事件严格递增。
        const sequence = input.turnId ? this.nextSequenceForTurn(input.turnId) : 0;
        // occurredAt: 服务端事件发生时间，作为断线补齐排序依据。
        const occurredAt = new Date().toISOString();
        // eventId: 事件持久化身份。
        const eventId = randomUUID();

        this.database.connection()
            .prepare(`
                INSERT INTO events (id,
                                    event_type,
                                    scope_type,
                                    scope_id,
                                    session_id,
                                    turn_id,
                                    task_id,
                                    step_id,
                                    agent_id,
                                    project_id,
                                    client_id,
                                    sequence,
                                    status,
                                    occurred_at,
                                    title,
                                    summary,
                                    payload_json,
                                    error_code,
                                    trace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
                eventId,
                input.eventType,
                input.scopeType,
                input.scopeId,
                input.sessionId,
                input.turnId,
                input.taskId,
                input.stepId ?? null,
                input.agentId ?? null,
                input.projectId ?? null,
                input.clientId ?? null,
                sequence,
                input.status,
                occurredAt,
                input.title,
                input.summary,
                JSON.stringify(input.payload),
                input.errorCode ?? null,
                traceId,
            );

        return {
            eventId,
            eventType: input.eventType,
            turnId: input.turnId,
            taskId: input.taskId,
            sequence,
            occurredAt,
            summary: input.summary,
            payload: input.payload,
            traceId,
        };
    }
}

/**
 * CenterStartupLock：中心服务启动锁。
 *
 * 用途：避免多个中心服务进程同时使用同一个中心目录。
 */
export class CenterStartupLock {
    /**
     * lockFilePath: 锁文件绝对路径。
     */
    private readonly lockFilePath: string;

    /**
     * constructor：绑定中心目录锁文件。
     *
     * @param centerDirectory 中心目录绝对路径。
     */
    constructor(centerDirectory: string) {
        this.lockFilePath = join(centerDirectory, ".zhixin-center.lock");
    }

    /**
     * acquire：创建独占启动锁。
     *
     * @returns 获取成功后没有返回值。
     */
    async acquire(): Promise<void> {
        // mkdirSync: 锁文件位于中心目录根部，创建前确保目录存在。
        mkdirSync(dirname(this.lockFilePath), {
            recursive: true,
        });

        try {
            // handle: wx 保证文件已存在时失败，避免并发覆盖锁。
            await this.writeLockFile();
        } catch {
            if (await this.isStaleLock()) {
                // 陈旧锁边界：只有 JSON 损坏、pid 无效或 pid 已确认退出时才清理；pid 仍存活时必须继续阻止启动，避免两个中心服务同时写同一中心目录。
                await rm(this.lockFilePath, {
                    force: true,
                });
                try {
                    await this.writeLockFile();
                } catch {
                    throw new Error(`中心目录启动锁刚被其他进程获取：${this.lockFilePath}`);
                }
                return;
            }

            throw new Error(`中心目录已有启动锁：${this.lockFilePath}`);
        }
    }

    /**
     * release：释放当前启动锁。
     *
     * @returns 释放完成后没有返回值。
     */
    async release(): Promise<void> {
        await rm(this.lockFilePath, {
            force: true,
        });
    }

    /**
     * isStaleLock：判断启动锁是否可以清理。
     *
     * @returns 锁文件不存在、格式损坏或记录进程已退出时返回 true。
     */
    private async isStaleLock(): Promise<boolean> {
        // lockStat: 锁文件不存在时可以直接重建，存在时继续读取 pid 判活。
        const lockStat = await stat(this.lockFilePath).catch(() => null);
        if (lockStat === null) {
            return true;
        }

        const lockContent = await readFile(this.lockFilePath, "utf-8").catch(() => "");
        const lockInfo = parseStartupLockFile(lockContent);
        if (!lockInfo) {
            return true;
        }

        // pid 判活是清理陈旧锁的唯一运行时依据；仅靠 createdAt 过期会误伤仍在迁移或慢启动的真实中心服务。
        return !isProcessAlive(lockInfo.pid);
    }

    /**
     * writeLockFile：写入当前进程启动锁。
     *
     * @returns 写入完成后没有返回值。
     */
    private async writeLockFile(): Promise<void> {
        const handle = await open(this.lockFilePath, "wx");
        try {
            await handle.writeFile(JSON.stringify({
                pid: process.pid,
                createdAt: new Date().toISOString(),
            }, null, 2));
        } finally {
            await handle.close();
        }
    }
}

/**
 * StartupLockFile：启动锁文件结构。
 *
 * 来源：中心目录 `.zhixin-center.lock`。
 * 含义：保存持锁进程 ID 和创建时间，供异常退出后判定是否陈旧。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：pid 必须为正整数，createdAt 必须可被 Date 解析。
 */
interface StartupLockFile {
    /**
     * pid: 持有锁的进程 ID。
     */
    pid: number;

    /**
     * createdAt: 锁创建时间，ISO 8601 字符串。
     */
    createdAt: string;
}

/**
 * parseStartupLockFile：解析启动锁文件。
 *
 * @param content 锁文件文本。
 * @returns 格式有效时返回锁信息，否则返回 null。
 */
function parseStartupLockFile(content: string): StartupLockFile | null {
    try {
        const parsed = JSON.parse(content) as Partial<StartupLockFile>;
        if (
            typeof parsed.pid !== "number"
            || !Number.isInteger(parsed.pid)
            || parsed.pid <= 0
            || typeof parsed.createdAt !== "string"
            || Number.isNaN(Date.parse(parsed.createdAt))
        ) {
            return null;
        }

        return {
            pid: parsed.pid,
            createdAt: parsed.createdAt,
        };
    } catch {
        return null;
    }
}

/**
 * isProcessAlive：跨平台判断进程是否仍存活。
 *
 * @param pid 进程 ID。
 * @returns 进程存在时返回 true。
 */
function isProcessAlive(pid: number): boolean {
    if (pid === process.pid) {
        return true;
    }

    try {
        // process.kill(pid, 0) 不发送信号，只做存在性和权限检查；Windows 和类 Unix 均支持。
        process.kill(pid, 0);
        return true;
    } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
            ? String((error as {code?: unknown}).code)
            : "";
        return code === "EPERM";
    }
}

/**
 * CenterService：中心服务模块化实例。
 *
 * 来源：桌面壳、开发命令和检查脚本共同使用。
 * 含义：封装 Fastify、目录、数据库、日志和启动锁。
 */
export interface CenterService {
    /**
     * config: 当前中心服务启动配置。
     */
    config: CenterServiceConfig;

    /**
     * app: Fastify 应用实例，检查脚本使用 inject 验证 API。
     */
    app: FastifyInstance;

    /**
     * directory: 中心目录初始化器。
     */
    directory: CenterDirectory;

    /**
     * database: SQLite 数据库封装。
     */
    database: CenterDatabase;

    /**
     * events: 事件日志封装。
     */
    events: CenterEventStore;

    /**
     * startupLock: 启动锁封装。
     */
    startupLock: CenterStartupLock;

    /**
     * initialize: 执行中心目录、数据库和日志初始化。
     */
    initialize: () => Promise<void>;

    /**
     * listen: 获取启动锁后监听端口。
     */
    listen: () => Promise<CenterListenResult>;

    /**
     * close: 释放资源并清理临时目录。
     */
    close: () => Promise<void>;
}

/**
 * CenterListenResult：中心服务监听结果。
 *
 * 来源：桌面壳和命令行启动流程。
 * 含义：区分本进程真实监听和复用同中心目录的既有健康实例。
 * 格式：JSON 对象。
 * 默认值：reusedExisting 为 false 表示本进程持有启动锁和端口。
 * 约束：复用既有实例时不能释放对方启动锁。
 */
export interface CenterListenResult {
    /**
     * reusedExisting: 是否复用同端口同中心目录的既有健康中心服务。
     */
    reusedExisting: boolean;

    /**
     * port: 中心服务端口。
     */
    port: number;

    /**
     * centerDirectory: 中心目录绝对路径。
     */
    centerDirectory: string;
}

/**
 * createCenterService：创建中心服务实例。
 *
 * @param config 中心服务启动配置。
 * @returns 中心服务模块化实例。
 */
export async function createCenterService(config: CenterServiceConfig): Promise<CenterService> {
    // app: logger=false 避免检查脚本输出噪音，日志统一写 center.log。
    const app = Fastify({
        logger: false,
        trustProxy: true,
    });
    // directory: 中心目录初始化职责。
    const directory = new CenterDirectory(config);
    // database: SQLite 连接封装。
    const database = new CenterDatabase(config);
    // events: 事件序号封装。
    const events = new CenterEventStore(database);
    // startupLock: 同目录多实例保护。
    const startupLock = new CenterStartupLock(config.centerDirectory);
    // logger: 追加式文件日志。
    const logger = new CenterLogger(config.centerDirectory);
    // realtimeClients: 运行期 WebSocket 客户端集合，事件事实仍以 SQLite 为准。
    const realtimeClients = new Map<string, RealtimeClientConnection>();
    // memoryQueues: 按智能体隔离的记忆单写队列状态，避免同一 Markdown 文件竞争写入。
    const memoryQueues = new Map<string, MemoryQueueState>();
    // subAgents: 当前中心服务运行期的一次性子智能体记录，不写长期智能体定义文件。
    const subAgents = new Map<string, SubAgentRuntimeRecord>();
    // initialized: 标记启动前初始化是否完成。
    let initialized = false;
    // lockAcquired: 只在本进程持有启动锁时为 true，避免复用已有服务时误删对方锁文件。
    let lockAcquired = false;
    // appListening: 只在本 Fastify 实例真正监听端口时为 true，复用已有服务不关闭未监听实例。
    let appListening = false;

    await app.register(websocket);

    app.addHook("onRequest", async (request, reply) => {
        // corsOrigin: 浏览器跨端口开发请求会携带 Origin，同源或非浏览器请求通常没有该头。
        const corsOrigin = resolveAllowedLocalDevCorsOrigin(request.headers.origin);

        if (corsOrigin) {
            // CORS 只服务本机 Vite 开发前端，生产期由中心服务同源托管前端资源。
            applyLocalDevCorsHeaders(reply, corsOrigin);
        }

        if (request.method === "OPTIONS") {
            if (corsOrigin) {
                // OPTIONS 预检不进入业务路由，避免浏览器在真实 POST 前被统一 API 404 拦截。
                await reply
                    .code(204)
                    .send();
                return;
            }

            if (request.url.startsWith("/api/") && request.headers.origin) {
                // 未声明来源不返回 CORS 放行头，避免把中心服务暴露给任意公网页面调用。
                await reply
                    .code(403)
                    .send(createErrorResponse(
                        "CORS_ORIGIN_NOT_ALLOWED",
                        "当前跨源来源不允许访问中心服务",
                        "只允许本机开发前端来源跨端口访问中心服务。",
                    ));
                return;
            }
        }
    });

    /**
     * initialize：执行启动前初始化。
     *
     * @returns 初始化完成后没有返回值。
     */
    async function initialize(): Promise<void> {
        await directory.initialize();
        database.initialize();
        await logger.info("center.bootstrap.initialized", {
            centerDirectory: config.centerDirectory,
            port: config.port,
        });
        initialized = true;
    }

    /**
     * close：关闭资源并释放锁。
     *
     * @returns 关闭完成后没有返回值。
     */
    async function close(): Promise<void> {
        database.close();
        await directory.close();
        if (lockAcquired) {
            await startupLock.release();
            lockAcquired = false;
        }
        if (appListening) {
            await app.close();
            appListening = false;
        }
    }

    app.addHook("onRequest", async (request, reply) => {
        // method: REST API 只允许 GET 和 POST，OPTIONS 留给浏览器预检。
        const method = request.method;
        if (method === "GET" || method === "POST" || method === "OPTIONS") {
            return;
        }

        await reply
            .code(405)
            .send(createErrorResponse(
                "METHOD_NOT_ALLOWED",
                "中心服务 REST API 只允许 GET 和 POST",
                "当前接口不支持该请求方法。",
            ));
    });

    app.setNotFoundHandler(async (request, reply) => {
        // frontendAsset: 非 API 请求优先按前端静态资源或 SPA 入口处理，中心服务负责提供 Web 页面资源。
        const frontendAsset = await readFrontendAsset(config.frontendDistDirectory, request.url);
        if (frontendAsset) {
            await reply
                .type(frontendAsset.contentType)
                .send(frontendAsset.content);
            return;
        }

        // notFound: API 路径不存在用统一响应包表达，不用 HTTP 404 表示业务实体缺失。
        await reply
            .code(200)
            .send(createErrorResponse(
                "API_NOT_FOUND",
                "接口不存在",
                "中心服务没有提供该接口。",
            ));
    });

    app.setErrorHandler(async (error: Error, _request, reply) => {
        // traceId: 错误响应和日志共同使用的排查编号。
        const traceId = randomUUID();
        // businessErrorCode: 领域函数可抛出固定业务错误码，由统一错误处理包装为业务失败响应。
        const businessErrorCode = error.message === "PROVIDER_NOT_FOUND"
            ? "PROVIDER_NOT_FOUND"
            : null;
        await logger.error("center.api.error", {
            traceId,
            message: error.message,
        });
        await reply
            .code(businessErrorCode === null ? 500 : 200)
            .send(createErrorResponse(
                businessErrorCode ?? "CENTER_INTERNAL_ERROR",
                error.message,
                businessErrorCode === "PROVIDER_NOT_FOUND"
                    ? "没有找到指定供应商。"
                    : "中心服务处理请求失败。",
                traceId,
            ));
    });

    app.get("/api/health", async () => createSuccessResponse<HealthResponse>({
        appName: APP_NAME,
        version: "0.1.0",
        port: config.port,
        centerDirectory: config.centerDirectory,
        now: new Date().toISOString(),
    }));

    app.get("/api/bootstrap/state", async () => createSuccessResponse<BootstrapStateResponse>({
        ready: initialized,
        centerDirectory: config.centerDirectory,
        coreTables: [...CORE_SQLITE_TABLES],
        appliedMigrations: database.listAppliedMigrations(),
    }));

    app.post("/api/access/authorize-local", async (request) => {
        // body: 本机授权只接受明确客户端类型，服务端再结合来源地址判断。
        const body = request.body as {
            clientType?: ClientType;
        };
        // isLocalRequest: 不能依赖前端 hostname，必须由服务端从连接来源判断。
        const isLocalRequest = isRequestFromLocalHost(request.ip);

        if (!isLocalRequest) {
            return createErrorResponse(
                "LOCAL_ACCESS_REQUIRED",
                "本机授权请求来源不是本机地址",
                "只有本机访问可以直接授权。",
            );
        }

        if (body.clientType === "ide-plugin" && !isLocalRequest) {
            return createErrorResponse(
                "IDE_PLUGIN_LOCAL_ONLY",
                "IDE 插件只能连接本机中心服务",
                "IDE 插件只允许连接 127.0.0.1。",
            );
        }

        if (!body.clientType) {
            return createErrorResponse(
                "CLIENT_TYPE_REQUIRED",
                "本机授权缺少 clientType",
                "客户端类型不能为空。",
            );
        }

        const clientId = upsertSyncClient(database, {
            clientType: body.clientType,
            projectId: null,
        });

        return createSuccessResponse<AccessAuthorizeResponse>({
            clientId,
            clientType: body.clientType,
            accessKind: "local",
            isLocalRequest,
        });
    });

    app.post("/api/auth/login", async (request, reply) => {
        // body: 远程 Web 登录账号和密码来自用户输入，中心服务只校验摘要。
        const body = request.body as {
            account?: string;
            password?: string;
        };
        // accessConfig: 桌面壳负责写入账号和密码摘要，中心服务负责校验。
        const accessConfig = await readAccessConfig(config.centerDirectory);

        if (!accessConfig.webAccountConfigured) {
            return createErrorResponse(
                "WEB_ACCOUNT_NOT_CONFIGURED",
                "远程 Web 账号尚未配置",
                "请先在桌面端配置远程访问账号和密码。",
            );
        }

        const passwordSha256 = createHash("sha256")
            .update(body.password ?? "")
            .digest("hex");

        if (body.account !== accessConfig.account || passwordSha256 !== accessConfig.passwordSha256) {
            return createErrorResponse(
                "WEB_LOGIN_FAILED",
                "远程 Web 登录账号或密码错误",
                "账号或密码不正确。",
            );
        }

        const clientId = upsertSyncClient(database, {
            clientType: "web-remote",
            projectId: null,
        });
        const sessionToken = randomUUID();

        await reply.header(
            "set-cookie",
            buildSessionCookie(sessionToken, isRequestFromLocalHost(request.ip)),
        );

        return createSuccessResponse<AccessAuthorizeResponse>({
            clientId,
            clientType: "web-remote",
            accessKind: "remote-web",
            isLocalRequest: isRequestFromLocalHost(request.ip),
        });
    });

    app.post("/api/project/register", async (request) => {
        const body = request.body as {
            projectId?: string;
            displayName?: string;
            latestPath?: string;
        };
        // latestPath: 项目登记仍要求客户端传入当前项目路径，中心服务用它记录最近位置并在缺少名称时派生文件夹名。
        const latestPath = body.latestPath?.trim() ?? "";
        // displayName: 项目主名称必须来自显式项目名或 latestPath 最后一级目录，不能使用项目 ID 兜底。
        const displayName = body.displayName && body.displayName.trim().length > 0
            ? body.displayName.trim()
            : deriveProjectDisplayNameFromPath(latestPath);

        if (!body.projectId || !latestPath || !displayName) {
            return createErrorResponse(
                "PROJECT_REGISTER_INVALID",
                "项目登记缺少 projectId、latestPath，或无法从 displayName/latestPath 得出项目名称",
                "项目登记信息不完整。",
            );
        }

        const now = new Date().toISOString();
        database.connection()
            .prepare(`
                INSERT INTO projects (id,
                                      display_name,
                                      alias,
                                      latest_path,
                                      created_at,
                                      updated_at)
                VALUES (?, ?, NULL, ?, ?, ?) ON CONFLICT(id) DO
                UPDATE SET
                    display_name = excluded.display_name,
                    latest_path = excluded.latest_path,
                    updated_at = excluded.updated_at
            `)
            .run(
                body.projectId,
                displayName,
                latestPath,
                now,
                now,
            );

        return createSuccessResponse<ProjectRecord>({
            projectId: body.projectId,
            displayName,
            alias: null,
            latestPath,
            createdAt: now,
            updatedAt: now,
        });
    });

    app.post("/api/project/detail", async (request) => {
        const body = request.body as {
            projectId?: string;
        };
        const project = findProject(database, body.projectId ?? "");

        if (!project) {
            return createErrorResponse(
                "PROJECT_NOT_FOUND",
                "项目不存在",
                "没有找到指定项目。",
            );
        }

        return createSuccessResponse(project);
    });

    app.post("/api/project/list", async () => {
        return createSuccessResponse({
            projects: listProjects(database),
        });
    });

    app.post("/api/session/create", async (request) => {
        const body = request.body as {
            sessionType?: SessionType;
            projectId?: string | null;
            title?: string;
        };

        if (!body.sessionType || !body.title) {
            return createErrorResponse(
                "SESSION_CREATE_INVALID",
                "会话创建缺少 sessionType 或 title",
                "会话创建信息不完整。",
            );
        }

        if (body.sessionType === "project" && !body.projectId) {
            return createErrorResponse(
                "PROJECT_SESSION_REQUIRES_PROJECT",
                "项目会话缺少 projectId",
                "项目会话必须绑定项目。",
            );
        }

        const sessionId = randomUUID();
        const now = new Date().toISOString();
        database.connection()
            .prepare(`
                INSERT INTO sessions (id,
                                      session_type,
                                      project_id,
                                      title,
                                      created_at,
                                      updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `)
            .run(
                sessionId,
                body.sessionType,
                body.projectId ?? null,
                body.title,
                now,
                now,
            );

        return createSuccessResponse<ConversationSession>({
            sessionId,
            sessionType: body.sessionType,
            projectId: body.projectId ?? null,
            title: body.title,
            createdAt: now,
            updatedAt: now,
            lastUserMessagePreview: null,
        });
    });

    app.post("/api/session/list", async (request) => {
        const body = request.body as {
            sessionType?: SessionType;
            projectId?: string | null;
        };
        const sessions = listSessions(database, body);

        return createSuccessResponse({
            sessions,
        });
    });

    app.post("/api/session/detail", async (request) => {
        const body = request.body as {
            sessionId?: string;
        };
        const session = findSession(database, body.sessionId ?? "");

        if (!session) {
            return createErrorResponse(
                "SESSION_NOT_FOUND",
                "会话不存在",
                "没有找到指定会话。",
            );
        }

        return createSuccessResponse<SessionDetailResponse>({
            session,
            messages: listMessages(database, session.sessionId),
            turns: listTurns(database, session.sessionId),
            tasks: listTasks(database, session.sessionId),
            taskSteps: listTaskSteps(database, session.sessionId),
        });
    });

    app.post("/api/session/message/send", async (request) => {
        const body = request.body as {
            sessionId?: string;
            contentMarkdown?: string;
        };
        const session = findSession(database, body.sessionId ?? "");

        if (!session) {
            return createErrorResponse(
                "SESSION_NOT_FOUND",
                "发送消息时会话不存在",
                "没有找到要发送消息的会话。",
            );
        }

        if (!body.contentMarkdown) {
            return createErrorResponse(
                "MESSAGE_CONTENT_REQUIRED",
                "发送消息缺少 contentMarkdown",
                "消息内容不能为空。",
            );
        }

        const sent = createMessageTurnAndTask(database, events, session, body.contentMarkdown);
        const eventRows = listEvents(database, {
            sessionId: session.sessionId,
            turnId: sent.turnId,
            afterSequence: 0,
        });
        broadcastEvents(realtimeClients, session, eventRows);

        return createSuccessResponse<SendMessageResponse>(sent);
    });

    app.post("/api/session/pending-message/save", async (request) => {
        const body = request.body as {
            sessionId?: string;
            clientId?: string | null;
            contentMarkdown?: string;
        };

        if (!body.sessionId || !body.contentMarkdown) {
            return createErrorResponse("PENDING_MESSAGE_INVALID", "待确认消息缺少必要字段", "待确认消息信息不完整。");
        }

        return createSuccessResponse(savePendingMessage(database, body.sessionId, body.clientId ?? null, body.contentMarkdown));
    });

    app.post("/api/session/pending-message/list", async (request) => {
        const body = request.body as {
            sessionId?: string;
        };

        if (!body.sessionId) {
            return createErrorResponse("SESSION_ID_REQUIRED", "查询待确认消息缺少 sessionId", "会话 ID 不能为空。");
        }

        return createSuccessResponse({
            pendingMessages: listPendingMessages(database, body.sessionId),
        });
    });

    app.post("/api/session/event/list", async (request) => {
        const body = request.body as {
            sessionId?: string;
            turnId?: string | null;
            afterSequence?: number;
        };
        const eventRows = listEvents(database, {
            sessionId: body.sessionId ?? null,
            turnId: body.turnId ?? null,
            afterSequence: body.afterSequence ?? 0,
        });

        return createSuccessResponse({
            events: eventRows,
        });
    });

    app.post("/api/task/step/create", async (request) => {
        const body = request.body as {
            taskId?: string;
            title?: string;
        };

        if (!body.taskId || !body.title) {
            return createErrorResponse(
                "TASK_STEP_CREATE_INVALID",
                "任务步骤创建缺少 taskId 或 title",
                "任务步骤创建信息不完整。",
            );
        }

        const task = findTask(database, body.taskId);

        if (!task) {
            return createErrorResponse(
                "TASK_NOT_FOUND",
                "任务步骤创建时任务不存在",
                "没有找到要创建步骤的任务。",
            );
        }

        const step = createTaskStep(database, events, task, body.title);
        return createSuccessResponse(step);
    });

    app.post("/api/task/step/update", async (request) => {
        const body = request.body as {
            stepId?: string;
            status?: TaskRecord["status"];
            summary?: string | null;
        };

        if (!body.stepId || !body.status) {
            return createErrorResponse(
                "TASK_STEP_UPDATE_INVALID",
                "任务步骤更新缺少 stepId 或 status",
                "任务步骤更新信息不完整。",
            );
        }

        const step = updateTaskStep(database, events, body.stepId, body.status, body.summary ?? null);

        if (!step) {
            return createErrorResponse(
                "TASK_STEP_NOT_FOUND",
                "任务步骤不存在",
                "没有找到要更新的任务步骤。",
            );
        }

        return createSuccessResponse(step);
    });

    app.post("/api/turn/update-status", async (request) => {
        const body = request.body as {
            turnId?: string;
            status?: "waiting_user" | "completed" | "failed" | "cancelled";
        };

        if (!body.turnId || !body.status) {
            return createErrorResponse(
                "TURN_UPDATE_INVALID",
                "轮次状态更新缺少 turnId 或 status",
                "轮次状态更新信息不完整。",
            );
        }

        const turn = updateTurnStatus(database, events, body.turnId, body.status);

        if (!turn) {
            return createErrorResponse(
                "TURN_NOT_FOUND",
                "轮次不存在",
                "没有找到要更新的轮次。",
            );
        }

        return createSuccessResponse(turn);
    });

    app.post("/api/agent/bootstrap-main", async () => {
        const agent = ensureMainAgent(database, events, config.centerDirectory);
        return createSuccessResponse(agent);
    });

    app.post("/api/agent/create", async (request) => {
        const body = request.body as {
            name?: string;
            roleDescription?: string;
            capabilityBoundary?: string;
            defaultProviderId?: string | null;
            defaultModel?: string | null;
            reasoningEffort?: string | null;
            createdBy?: string;
        };

        if (!body.name || !body.roleDescription || !body.capabilityBoundary) {
            return createErrorResponse(
                "AGENT_CREATE_INVALID",
                "智能体创建缺少 name、roleDescription 或 capabilityBoundary",
                "智能体信息不完整。",
            );
        }

        return createSuccessResponse(createAgent(database, events, config.centerDirectory, body));
    });

    app.post("/api/agent/update", async (request) => {
        const body = request.body as {
            agentId?: string;
            name?: string;
            roleDescription?: string;
            capabilityBoundary?: string;
            defaultProviderId?: string | null;
            defaultModel?: string | null;
            reasoningEffort?: string | null;
        };

        if (!body.agentId) {
            return createErrorResponse("AGENT_ID_REQUIRED", "智能体更新缺少 agentId", "智能体 ID 不能为空。");
        }

        return createSuccessResponse(updateAgent(database, events, config.centerDirectory, body));
    });

    app.post("/api/agent/disable", async (request) => {
        const body = request.body as {
            agentId?: string;
            archiveMemory?: boolean;
            impactAccepted?: boolean;
        };

        if (!body.agentId || body.impactAccepted !== true) {
            return createErrorResponse("AGENT_DISABLE_REQUIRES_CONFIRM", "停用智能体需要确认影响", "停用长期智能体前必须确认记忆、调度入口和历史会话影响。");
        }

        return createSuccessResponse(disableAgent(database, events, config.centerDirectory, body.agentId, Boolean(body.archiveMemory)));
    });

    app.post("/api/agent/list", async () => createSuccessResponse({
        agents: listAgents(database),
    }));

    app.post("/api/agent/runtime-state/set", async (request) => {
        const body = request.body as {
            agentId?: string;
            status?: AgentRuntimeStatus;
            currentTaskId?: string | null;
        };

        if (!body.agentId || !body.status) {
            return createErrorResponse(
                "AGENT_RUNTIME_STATE_INVALID",
                "智能体运行状态缺少 agentId 或 status",
                "智能体运行状态信息不完整。",
            );
        }

        const runtimeState = setAgentRuntimeState(
            database,
            events,
            realtimeClients,
            body.agentId,
            body.status,
            body.currentTaskId ?? null,
        );

        return createSuccessResponse(runtimeState);
    });

    app.post("/api/memory/write", async (request) => {
        const body = request.body as {
            agentId?: string;
            keywords?: string;
            summary?: string;
            userText?: string;
            assistantText?: string;
        };

        if (!body.agentId || !body.keywords || !body.summary || !body.userText || !body.assistantText) {
            return createErrorResponse(
                "MEMORY_WRITE_INVALID",
                "记忆写入缺少必要字段",
                "记忆写入信息不完整。",
            );
        }

        return createSuccessResponse(writeAgentMemory(database, events, config.centerDirectory, memoryQueues, body));
    });

    app.post("/api/memory/queue-state", async (request) => {
        const body = request.body as {
            agentId?: string;
        };

        if (!body.agentId) {
            return createErrorResponse(
                "MEMORY_QUEUE_AGENT_REQUIRED",
                "查询记忆队列缺少 agentId",
                "智能体 ID 不能为空。",
            );
        }

        return createSuccessResponse(readMemoryQueueState(memoryQueues, body.agentId));
    });

    app.post("/api/sub-agent/create", async (request) => {
        const body = request.body as {
            parentAgentId?: string;
            taskId?: string;
            name?: string;
        };

        if (!body.parentAgentId || !body.taskId || !body.name) {
            return createErrorResponse(
                "SUB_AGENT_CREATE_INVALID",
                "创建子智能体缺少 parentAgentId、taskId 或 name",
                "子智能体信息不完整。",
            );
        }

        const parentIsSubAgent = subAgents.has(body.parentAgentId);
        if (parentIsSubAgent) {
            return createErrorResponse(
                "SUB_AGENT_NESTING_FORBIDDEN",
                "子智能体不能继续创建子智能体",
                "子智能体任务需要继续拆分时，必须回到创建它的长期智能体统一调度。",
            );
        }

        return createSuccessResponse(createSubAgentRuntime(events, subAgents, body.parentAgentId, body.taskId, body.name));
    });

    app.post("/api/agent/collaboration/event", async (request) => {
        const body = request.body as {
            taskId?: string;
            collaborationKind?: "pipeline" | "group-chat";
            title?: string;
            summary?: string;
        };

        if (!body.taskId || !body.collaborationKind || !body.title || !body.summary) {
            return createErrorResponse(
                "AGENT_COLLABORATION_EVENT_INVALID",
                "智能体协作事件缺少必要字段",
                "协作事件信息不完整。",
            );
        }

        return createSuccessResponse(recordAgentCollaborationEvent(events, body.taskId, body.collaborationKind, body.title, body.summary));
    });

    app.post("/api/provider/create", async (request) => {
        const body = request.body as {
            providerName?: string;
            protocolPluginId?: string;
            protocolMode?: string;
            baseUrl?: string;
            apiKey?: string;
            model?: string;
            enabled?: boolean;
            capabilities?: ProviderCapabilityDeclaration;
            proxyPolicy?: ProviderProxyPolicy;
        };

        if (!body.providerName || !body.protocolPluginId || !body.protocolMode || !body.baseUrl || !body.model) {
            return createErrorResponse(
                "PROVIDER_CREATE_INVALID",
                "供应商创建缺少必要字段",
                "供应商信息不完整。",
            );
        }

        return createSuccessResponse(createProvider(database, events, config.centerDirectory, body));
    });

    app.post("/api/provider/list", async () => createSuccessResponse({
        providers: listProviderConfigs(config.centerDirectory),
    }));

    app.post("/api/provider/update", async (request) => {
        const body = request.body as {
            providerId?: string;
            providerName?: string;
            protocolPluginId?: string;
            protocolMode?: string;
            baseUrl?: string;
            apiKey?: string;
            enabled?: boolean;
            defaultModel?: string;
            capabilities?: ProviderCapabilityDeclaration;
            proxyPolicy?: ProviderProxyPolicy;
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "供应商更新缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(updateProviderConfig(config.centerDirectory, body));
    });

    app.post("/api/provider/delete", async (request) => {
        const body = request.body as {
            providerId?: string;
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "供应商删除缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(updateProviderConfig(config.centerDirectory, {
            providerId: body.providerId,
            enabled: false,
        }));
    });

    app.post("/api/provider/model-refresh", async (request) => {
        const body = request.body as {
            providerId?: string;
            models?: string[];
            reasoningEfforts?: string[];
            contextWindows?: ProviderModelContextWindow[];
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "刷新模型列表缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(refreshProviderModels(
            config.centerDirectory,
            body.providerId,
            body.models ?? [],
            body.reasoningEfforts ?? [],
            body.contextWindows ?? [],
        ));
    });

    app.post("/api/provider/model-list", async (request) => {
        const body = request.body as {
            providerId?: string;
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "查询模型列表缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(readProviderModelList(config.centerDirectory, body.providerId));
    });

    app.post("/api/proxy/save", async (request) => {
        const body = request.body as {
            proxyId?: string;
            proxyName?: string;
            protocol?: string;
            host?: string;
            port?: number;
            username?: string;
            password?: string;
            enabled?: boolean;
            note?: string;
        };

        if (!body.proxyName || !body.protocol || !body.host || typeof body.port !== "number") {
            return createErrorResponse("PROXY_SAVE_INVALID", "代理配置缺少必要字段", "代理配置不完整。");
        }

        return createSuccessResponse(saveProxyConfig(config.centerDirectory, body));
    });

    app.post("/api/proxy/list", async () => createSuccessResponse({
        proxies: listProxyConfigs(config.centerDirectory),
        defaultProxyId: readGlobalDefaultProxyId(config.centerDirectory),
    }));

    app.post("/api/proxy/default/set", async (request) => {
        const body = request.body as {
            proxyId?: string | null;
        };

        return createSuccessResponse(setGlobalDefaultProxy(config.centerDirectory, body.proxyId ?? null));
    });

    app.post("/api/proxy/delete", async (request) => {
        const body = request.body as {
            proxyId?: string;
        };

        if (!body.proxyId) {
            return createErrorResponse("PROXY_ID_REQUIRED", "代理删除缺少 proxyId", "代理 ID 不能为空。");
        }

        return createSuccessResponse(deleteProxyConfig(config.centerDirectory, body.proxyId));
    });

    app.post("/api/runtime/save", async (request) => {
        const body = request.body as {
            runtimeId?: string;
            runtimeName?: string;
            runtimeType?: string;
            executablePath?: string;
            rootPath?: string;
            version?: string;
            environmentVariables?: Record<string, string>;
            pathEntries?: string[];
            isDefault?: boolean;
            enabled?: boolean;
            note?: string;
        };

        if (!body.runtimeName || !body.runtimeType || !body.executablePath || !body.rootPath) {
            return createErrorResponse("RUNTIME_SAVE_INVALID", "运行环境缺少必要字段", "运行环境信息不完整。");
        }

        return createSuccessResponse(saveRuntimeConfig(config.centerDirectory, body));
    });

    app.post("/api/runtime/list", async () => createSuccessResponse({
        runtimes: listRuntimeConfigs(config.centerDirectory),
    }));

    app.post("/api/runtime/delete", async (request) => {
        const body = request.body as {
            runtimeId?: string;
        };

        if (!body.runtimeId) {
            return createErrorResponse("RUNTIME_ID_REQUIRED", "运行环境删除缺少 runtimeId", "运行环境 ID 不能为空。");
        }

        return createSuccessResponse(deleteRuntimeConfig(config.centerDirectory, body.runtimeId));
    });

    app.post("/api/model-gateway/prepare", async (request) => {
        const body = request.body as {
            request?: unknown;
            protocolMode?: "responses" | "chat-completions" | "messages";
        };

        if (!body.request || !body.protocolMode) {
            return createErrorResponse("MODEL_GATEWAY_INVALID", "模型网关缺少 request 或 protocolMode", "模型请求不完整。");
        }

        return createSuccessResponse(prepareModelGatewayRequest(body.request, body.protocolMode));
    });

    app.post("/api/model-gateway/classify-error", async (request) => {
        const body = request.body as {
            failureStage?: string;
            statusCode?: number;
            message?: string;
        };

        if (!body.failureStage) {
            return createErrorResponse(
                "MODEL_GATEWAY_ERROR_STAGE_REQUIRED",
                "模型网关错误分类缺少 failureStage",
                "模型调用失败阶段不能为空。",
            );
        }

        return createSuccessResponse(classifyModelGatewayError(body.failureStage, body.statusCode ?? null, body.message ?? ""));
    });

    app.post("/api/plugin/install", async (request) => {
        const body = request.body as {
            manifest?: Record<string, unknown>;
        };

        if (!body.manifest) {
            return createErrorResponse(
                "PLUGIN_MANIFEST_REQUIRED",
                "插件安装缺少 manifest",
                "插件清单不能为空。",
            );
        }

        return createSuccessResponse(installPlugin(database, events, body.manifest));
    });

    app.post("/api/plugin/enable", async (request) => {
        const body = request.body as {
            pluginId?: string;
        };

        if (!body.pluginId) {
            return createErrorResponse("PLUGIN_ID_REQUIRED", "插件启用缺少 pluginId", "插件 ID 不能为空。");
        }

        return createSuccessResponse(setPluginEnabled(database, events, body.pluginId, true));
    });

    app.post("/api/plugin/disable", async (request) => {
        const body = request.body as {
            pluginId?: string;
        };

        if (!body.pluginId) {
            return createErrorResponse("PLUGIN_ID_REQUIRED", "插件停用缺少 pluginId", "插件 ID 不能为空。");
        }

        return createSuccessResponse(setPluginEnabled(database, events, body.pluginId, false));
    });

    app.post("/api/plugin/configure", async (request) => {
        const body = request.body as {
            pluginId?: string;
            config?: Record<string, unknown>;
        };

        if (!body.pluginId || !body.config) {
            return createErrorResponse("PLUGIN_CONFIG_INVALID", "插件配置缺少 pluginId 或 config", "插件配置信息不完整。");
        }

        return createSuccessResponse(configurePlugin(database, events, body.pluginId, body.config));
    });

    app.post("/api/plugin/delete", async (request) => {
        const body = request.body as {
            pluginId?: string;
        };

        if (!body.pluginId) {
            return createErrorResponse("PLUGIN_ID_REQUIRED", "插件删除缺少 pluginId", "插件 ID 不能为空。");
        }

        return createSuccessResponse(deletePlugin(database, events, body.pluginId));
    });

    app.post("/api/plugin/list", async () => createSuccessResponse({
        plugins: listPlugins(database),
    }));

    app.post("/api/extension/call-record", async (request) => {
        const body = request.body as {
            extensionId?: string;
            sessionId?: string | null;
            taskId?: string | null;
            status?: string;
            inputSummary?: string;
            outputSummary?: string | null;
        };

        if (!body.extensionId || !body.status || !body.inputSummary) {
            return createErrorResponse("EXTENSION_CALL_INVALID", "扩展调用记录缺少必要字段", "扩展调用记录不完整。");
        }

        return createSuccessResponse(recordExtensionCall(database, events, body));
    });

    app.post("/api/extension/call-list", async () => createSuccessResponse({
        records: database.connection().prepare("SELECT * FROM extension_call_records ORDER BY created_at ASC").all(),
    }));

    app.post("/api/mcp/save", async (request) => {
        const body = request.body as {
            mcpServers?: Record<string, unknown>;
            projectId?: string | null;
        };

        if (!body.mcpServers) {
            return createErrorResponse("MCP_CONFIG_INVALID", "MCP 配置缺少 mcpServers", "MCP 配置不完整。");
        }

        return createSuccessResponse(saveExtensionJson(config.centerDirectory, body.projectId ? `mcp/project-${body.projectId}.json` : "mcp/global.json", {
            mcpServers: body.mcpServers,
        }));
    });

    app.post("/api/mcp/list", async () => createSuccessResponse({
        configs: listMcpConfigs(config.centerDirectory),
    }));

    app.post("/api/skill/install", async (request) => {
        const body = request.body as {
            skillName?: string;
            content?: string;
            projectId?: string | null;
        };

        if (!body.skillName || !body.content) {
            return createErrorResponse("SKILL_INSTALL_INVALID", "skill 安装缺少必要字段", "skill 信息不完整。");
        }

        return createSuccessResponse(saveSkillContent(config.centerDirectory, body.skillName, body.content, body.projectId ?? null));
    });

    app.post("/api/skill/list", async () => createSuccessResponse({
        skills: listInstalledSkills(config.centerDirectory),
    }));

    app.post("/api/capability/resolve", async () => createSuccessResponse({
        priority: [
            "project-local",
            "user-installed",
            "system-builtin",
        ],
    }));

    app.post("/api/model/capability/check-image", async (request) => {
        const body = request.body as {
            supportsImage?: boolean;
        };

        return createSuccessResponse({
            canSendImage: Boolean(body.supportsImage),
        });
    });

    app.post("/api/personal/todo/create", async (request) => {
        const body = request.body as {
            title?: string;
            dueAt?: string | null;
        };

        if (!body.title) {
            return createErrorResponse("TODO_TITLE_REQUIRED", "待办缺少标题", "待办标题不能为空。");
        }

        return createSuccessResponse(createTodo(database, events, body.title, body.dueAt ?? null));
    });

    app.post("/api/personal/calendar/create", async (request) => {
        const body = request.body as {
            title?: string;
            startsAt?: string;
            endsAt?: string;
        };

        if (!body.title || !body.startsAt || !body.endsAt) {
            return createErrorResponse("CALENDAR_CREATE_INVALID", "日程缺少必要字段", "日程信息不完整。");
        }

        return createSuccessResponse(createCalendarEvent(database, events, body.title, body.startsAt, body.endsAt));
    });

    app.post("/api/personal/knowledge/create", async (request) => {
        const body = request.body as {
            title?: string;
            summary?: string;
            sourceRef?: string;
        };

        if (!body.title || !body.summary || !body.sourceRef) {
            return createErrorResponse("KNOWLEDGE_CREATE_INVALID", "知识条目缺少必要字段", "知识条目信息不完整。");
        }

        return createSuccessResponse(createKnowledgeItem(database, events, body.title, body.summary, body.sourceRef));
    });

    app.post("/api/notification/create", async (request) => {
        const body = request.body as {
            targetClientType?: ClientType;
            title?: string;
            summary?: string;
            requiresUserAction?: boolean;
        };

        if (!body.targetClientType || !body.title || !body.summary) {
            return createErrorResponse("NOTIFICATION_CREATE_INVALID", "通知缺少必要字段", "通知信息不完整。");
        }

        return createSuccessResponse(createNotification(database, events, realtimeClients, body.targetClientType, body.title, body.summary, Boolean(body.requiresUserAction)));
    });

    app.post("/api/execution-mode/set", async (request) => {
        const body = request.body as {
            clientType?: ClientType;
            executionMode?: ExecutionMode;
        };

        if (!body.clientType || !body.executionMode) {
            return createErrorResponse("EXECUTION_MODE_INVALID", "执行模式缺少必要字段", "执行模式信息不完整。");
        }

        return createSuccessResponse(saveExecutionMode(config.centerDirectory, body.clientType, body.executionMode));
    });

    app.post("/api/usage/record", async (request) => {
        const body = request.body as {
            providerId?: string;
            sessionId?: string | null;
            model?: string;
            projectId?: string | null;
            inputTokens?: number | null;
            outputTokens?: number | null;
            cacheHitTokens?: number | null;
            cacheMissTokens?: number | null;
            status?: string;
        };

        if (!body.providerId || !body.model || !body.status) {
            return createErrorResponse("USAGE_RECORD_INVALID", "用量记录缺少必要字段", "用量记录信息不完整。");
        }

        return createSuccessResponse(recordUsage(database, events, body));
    });

    app.post("/api/worker/task-failed", async (request) => {
        const body = request.body as {
            taskId?: string;
            reason?: string;
        };

        return createSuccessResponse(markWorkerTaskFailed(database, events, body.taskId ?? "", body.reason ?? "Worker 任务失败"));
    });

    app.post("/api/worker/handle", async (request) => {
        const body = request.body as {
            type?: string;
            taskId?: string;
            payload?: unknown;
        };

        if (!body.type) {
            return createErrorResponse("WORKER_MESSAGE_INVALID", "Worker 消息缺少 type", "Worker 消息不完整。");
        }

        return createSuccessResponse(handleWorkerMessage(database, events, body.type, body.taskId ?? null, body.payload ?? null));
    });

    app.post("/api/worker/start", async (request) => {
        const body = request.body as {
            taskId?: string;
        };

        if (!body.taskId) {
            return createErrorResponse("WORKER_TASK_ID_REQUIRED", "启动 Worker 缺少 taskId", "任务 ID 不能为空。");
        }

        return createSuccessResponse(startWorkerTask(database, events, body.taskId));
    });

    app.post("/api/worker/cancel", async (request) => {
        const body = request.body as {
            taskId?: string;
            reason?: string;
        };

        if (!body.taskId) {
            return createErrorResponse("WORKER_TASK_ID_REQUIRED", "取消 Worker 缺少 taskId", "任务 ID 不能为空。");
        }

        return createSuccessResponse(cancelWorkerTask(database, events, body.taskId, body.reason ?? "用户取消 Worker 任务"));
    });

    app.post("/api/worker/context-request", async (request) => {
        const body = request.body as {
            taskId?: string;
        };

        if (!body.taskId) {
            return createErrorResponse("WORKER_TASK_ID_REQUIRED", "上下文请求缺少 taskId", "任务 ID 不能为空。");
        }

        return createSuccessResponse(buildWorkerContext(database, body.taskId));
    });

    app.post("/api/engine/turn-runner/run", async (request) => {
        const body = request.body as {
            sessionId?: string;
            userText?: string;
        };

        if (!body.sessionId || !body.userText) {
            return createErrorResponse(
                "TURN_RUNNER_INVALID",
                "轮次执行编排缺少 sessionId 或 userText",
                "轮次执行信息不完整。",
            );
        }

        return createSuccessResponse(runTurnEngine(database, events, config.centerDirectory, memoryQueues, body.sessionId, body.userText));
    });

    app.post("/api/approval/evaluate", async (request) => {
        const body = request.body as {
            clientType?: ClientType;
            operationKind?: "read" | "write" | "delete" | "command" | "plugin" | "mcp" | "skill";
        };

        if (!body.clientType || !body.operationKind) {
            return createErrorResponse("APPROVAL_EVALUATE_INVALID", "审批判断缺少 clientType 或 operationKind", "审批判断信息不完整。");
        }

        return createSuccessResponse(evaluateApprovalPolicy(config.centerDirectory, body.clientType, body.operationKind));
    });

    app.post("/api/audit/events", async (request) => {
        const body = request.body as {
            eventType?: string | null;
        };

        return createSuccessResponse({
            events: queryAuditEvents(database, body.eventType ?? null),
        });
    });

    app.post("/api/usage/query", async (request) => {
        const body = request.body as {
            providerId?: string | null;
            model?: string | null;
            projectId?: string | null;
            sessionId?: string | null;
            startedAt?: string | null;
            endedAt?: string | null;
        };

        return createSuccessResponse({
            records: queryUsageRecords(database, {
                providerId: body.providerId ?? null,
                model: body.model ?? null,
                projectId: body.projectId ?? null,
                sessionId: body.sessionId ?? null,
                startedAt: body.startedAt ?? null,
                endedAt: body.endedAt ?? null,
            }),
        });
    });

    app.post("/api/usage/aggregate", async (request) => {
        const body = request.body as {
            providerId?: string | null;
            model?: string | null;
            projectId?: string | null;
            sessionId?: string | null;
            startedAt?: string | null;
            endedAt?: string | null;
        };

        return createSuccessResponse({
            stats: aggregateUsageRecords(database, {
                providerId: body.providerId ?? null,
                model: body.model ?? null,
                projectId: body.projectId ?? null,
                sessionId: body.sessionId ?? null,
                startedAt: body.startedAt ?? null,
                endedAt: body.endedAt ?? null,
            }),
            refreshedDailyStats: refreshUsageDailyStats(database),
        });
    });

    app.post("/api/audit/task-steps", async () => createSuccessResponse({
        taskSteps: database.connection().prepare("SELECT * FROM task_steps ORDER BY started_at ASC").all(),
    }));

    app.post("/api/notification/config/set", async (request) => {
        const body = request.body as {
            clientType?: ClientType;
            enabled?: boolean;
            notifyOnFailure?: boolean;
            notifyOnWaitingUser?: boolean;
            systemPermission?: string;
        };

        if (!body.clientType) {
            return createErrorResponse("NOTIFICATION_CONFIG_INVALID", "通知配置缺少 clientType", "通知配置不完整。");
        }

        return createSuccessResponse(saveNotificationConfig(config.centerDirectory, body));
    });

    app.post("/api/notification/should-send", async (request) => {
        const body = request.body as {
            enabled?: boolean;
            status?: string;
        };

        return createSuccessResponse({
            shouldSend: Boolean(body.enabled) && (body.status === "completed" || body.status === "failed" || body.status === "waiting_user"),
        });
    });

    app.post("/api/approval/record", async (request) => {
        const body = request.body as {
            taskId?: string;
            approved?: boolean;
            reason?: string;
        };

        return createSuccessResponse(events.append({
            eventType: "approval.recorded",
            scopeType: "approval",
            scopeId: body.taskId ?? null,
            sessionId: null,
            turnId: null,
            taskId: body.taskId ?? null,
            status: body.approved ? "completed" : "cancelled",
            title: "审批结果",
            summary: body.reason ?? "",
            payload: {
                approved: Boolean(body.approved),
            },
        }));
    });

    app.post("/api/file/temp/create", async (request) => {
        const body = request.body as {
            fileName?: string;
            mimeType?: string;
            sizeBytes?: number;
        };

        if (!body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
            return createErrorResponse("TEMP_FILE_CREATE_INVALID", "临时附件缺少必要字段", "临时附件信息不完整。");
        }

        return createSuccessResponse(createTemporaryAttachment(config.centerDirectory, body.fileName, body.mimeType, body.sizeBytes));
    });

    app.post("/api/session/attachment/commit", async (request) => {
        const body = request.body as {
            sessionId?: string;
            messageId?: string;
            temporaryAttachmentId?: string;
            fileName?: string;
            mimeType?: string;
            sizeBytes?: number;
        };

        if (!body.sessionId || !body.messageId || !body.temporaryAttachmentId || !body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
            return createErrorResponse("ATTACHMENT_COMMIT_INVALID", "正式附件保存缺少必要字段", "附件保存信息不完整。");
        }

        return createSuccessResponse(commitAttachment(database, events, config.centerDirectory, body));
    });

    app.get("/api/sync", {
        websocket: true,
    }, (socket) => {
        // activeClientId: 当前 WebSocket 连接握手成功后的客户端 ID，用于关闭时清理。
        let activeClientId: string | null = null;

        socket.on("message", (rawMessage: Buffer | ArrayBuffer | Buffer[]) => {
            // envelope: WebSocket 消息必须使用共享协议包。
            const envelope = JSON.parse(rawMessage.toString()) as WebSocketEnvelope<{
                clientId?: string;
                clientType?: ClientType;
                projectId?: string | null;
            }>;

            if (envelope.type !== "client.hello") {
                sendSocketEnvelope(socket, {
                    type: "connection.state",
                    payload: {
                        status: "ignored",
                    },
                });
                return;
            }

            const clientId = envelope.payload.clientId;
            const clientType = envelope.payload.clientType;

            if (!clientId || !clientType || !isSyncClientAllowed(database, clientId, clientType, envelope.payload.projectId ?? null)) {
                sendSocketEnvelope(socket, {
                    type: "connection.state",
                    payload: {
                        status: "rejected",
                    },
                });
                socket.close();
                return;
            }

            realtimeClients.set(clientId, {
                clientId,
                clientType,
                projectId: envelope.payload.projectId ?? null,
                send: (message) => {
                    sendSocketEnvelope(socket, message);
                },
            });
            activeClientId = clientId;

            sendSocketEnvelope(socket, {
                type: "server.ready",
                payload: {
                    clientId,
                    clientType,
                },
            });
        });

        socket.on("close", () => {
            if (activeClientId) {
                realtimeClients.delete(activeClientId);
            }
        });
    });

    return {
        config,
        app,
        directory,
        database,
        events,
        startupLock,
        initialize,
        listen: async () => {
            if (await isHealthyCenterServiceAlreadyListening(config)) {
                return {
                    reusedExisting: true,
                    port: config.port,
                    centerDirectory: config.centerDirectory,
                };
            }

            await initialize();
            try {
                await startupLock.acquire();
                lockAcquired = true;
                await app.listen({
                    host: "127.0.0.1",
                    port: config.port,
                });
                appListening = true;
                return {
                    reusedExisting: false,
                    port: config.port,
                    centerDirectory: config.centerDirectory,
                };
            } catch (error) {
                if (await isHealthyCenterServiceAlreadyListening(config)) {
                    if (lockAcquired) {
                        await startupLock.release();
                        lockAcquired = false;
                    }
                    return {
                        reusedExisting: true,
                        port: config.port,
                        centerDirectory: config.centerDirectory,
                    };
                }

                if (lockAcquired) {
                    await startupLock.release();
                    lockAcquired = false;
                }
                throw error;
            }
        },
        close,
    };
}

/**
 * isHealthyCenterServiceAlreadyListening：检查同端口是否已有同中心目录的健康中心服务。
 *
 * @param config 当前中心服务启动配置。
 * @returns 已有健康服务且中心目录一致时返回 true。
 */
async function isHealthyCenterServiceAlreadyListening(config: CenterServiceConfig): Promise<boolean> {
    try {
        // response: 只探测本机端口的健康接口，避免把远程服务误判为可复用中心。
        const response = await fetch(`http://127.0.0.1:${config.port}/api/health`);
        if (!response.ok) {
            return false;
        }

        const result = await response.json() as ApiResponse<HealthResponse>;
        return result.success
            && result.data?.port === config.port
            && resolve(result.data.centerDirectory) === resolve(config.centerDirectory);
    } catch {
        // 网络失败说明端口无健康中心服务，后续仍按启动锁逻辑处理。
        return false;
    }
}

/**
 * isRequestFromLocalHost：根据服务端收到的来源 IP 判断是否本机访问。
 *
 * @param ip Fastify 根据连接和代理头识别出的客户端 IP。
 * @returns 来源属于本机地址时返回 true。
 */
function isRequestFromLocalHost(ip: string): boolean {
    // normalizedIp: IPv6 映射地址统一转成可比较文本。
    const normalizedIp = ip.trim().toLowerCase();
    return normalizedIp === "127.0.0.1"
        || normalizedIp === "::1"
        || normalizedIp === "::ffff:127.0.0.1"
        || normalizedIp === "localhost";
}

/**
 * resolveAllowedLocalDevCorsOrigin：解析允许跨端口访问中心服务的本机开发来源。
 *
 * @param origin 浏览器 Origin 请求头。
 * @returns 允许时返回需要回显的来源；不允许时返回 null。
 */
function resolveAllowedLocalDevCorsOrigin(origin: string | string[] | undefined): string | null {
    if (typeof origin !== "string") {
        return null;
    }

    // allowedOrigins: 仅包含本机 Vite 开发来源；生产 Web 由中心服务同源托管，不需要 CORS。
    const allowedOrigins = new Set([
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8877",
        "http://localhost:8877",
    ]);

    return allowedOrigins.has(origin)
        ? origin
        : null;
}

/**
 * applyLocalDevCorsHeaders：为本机开发来源写入 CORS 响应头。
 *
 * @param reply Fastify 响应对象。
 * @param origin 已通过白名单校验的本机开发来源。
 * @returns 没有返回值。
 */
function applyLocalDevCorsHeaders(reply: FastifyReply, origin: string): void {
    // Access-Control-Allow-Origin 必须回显明确本机来源，不能使用 `*`，否则会破坏 Cookie 登录态边界。
    reply.header("access-control-allow-origin", origin);
    // Access-Control-Allow-Credentials 允许本机开发前端携带远程 Web Cookie 登录态。
    reply.header("access-control-allow-credentials", "true");
    // Access-Control-Allow-Methods 与架构约定保持一致，只允许 GET、POST 和浏览器预检 OPTIONS。
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    // Access-Control-Allow-Headers 只允许管理页当前需要的 JSON Content-Type 请求头。
    reply.header("access-control-allow-headers", "content-type");
    // Vary: Origin 避免代理或浏览器缓存把某个本机来源的 CORS 头复用到其他来源。
    reply.header("vary", "Origin");
}

/**
 * readAccessConfig：读取桌面壳写入的远程 Web 访问配置。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 访问配置文件内容。
 */
async function readAccessConfig(centerDirectory: string): Promise<AccessConfigFile> {
    // accessConfigPath: 访问控制配置只由中心服务读取，桌面壳负责写入。
    const accessConfigPath = join(centerDirectory, "config", "access.json");
    // rawContent: 配置文件缺失时返回未配置状态，便于首次启动。
    const rawContent = await readFile(accessConfigPath, "utf-8").catch(() => "");

    if (!rawContent) {
        return {
            webAccountConfigured: false,
        };
    }

    return JSON.parse(rawContent) as AccessConfigFile;
}

/**
 * buildSessionCookie：构造远程 Web 登录态 Cookie。
 *
 * @param sessionToken 中心服务生成的登录态令牌。
 * @param isLocalRequest 当前登录请求是否来自本机。
 * @returns Set-Cookie 响应头内容。
 */
function buildSessionCookie(sessionToken: string, isLocalRequest: boolean): string {
    // secureFlag: 本机开发 HTTP 不加 Secure，远程部署若使用 HTTPS 则加 Secure 约束浏览器传输。
    const secureFlag = isLocalRequest ? "" : "; Secure";
    return `zhixin_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureFlag}`;
}

/**
 * upsertSyncClient：登记或刷新同步客户端在线记录。
 *
 * @param database 中心服务数据库。
 * @param input 客户端登记参数。
 * @returns 客户端 ID。
 */
function upsertSyncClient(
    database: CenterDatabase,
    input: {
        clientType: ClientType;
        projectId: string | null;
    },
): string {
    // clientId: 当前阶段每次授权生成新客户端 ID，后续 WebSocket 可绑定该 ID。
    const clientId = randomUUID();
    // now: 同步客户端最后访问时间。
    const now = new Date().toISOString();
    database.connection()
        .prepare(`
            INSERT INTO sync_clients (id,
                                      client_type,
                                      project_id,
                                      last_seen_at,
                                      last_event_sequence)
            VALUES (?, ?, ?, ?, ?)
        `)
        .run(
            clientId,
            input.clientType,
            input.projectId,
            now,
            0,
        );

    return clientId;
}

/**
 * findProject：按项目 ID 查询项目记录。
 *
 * @param database 中心服务数据库。
 * @param projectId 项目 UUID。
 * @returns 找到时返回项目记录，否则返回 null。
 */
function findProject(database: CenterDatabase, projectId: string): ProjectRecord | null {
    const row = database.connection()
        .prepare(`
            SELECT id           AS projectId,
                   display_name AS displayName,
                   alias,
                   latest_path  AS latestPath,
                   created_at   AS createdAt,
                   updated_at   AS updatedAt
            FROM projects
            WHERE id = ?
        `)
        .get(projectId) as ProjectRecord | undefined;

    return row ?? null;
}

/**
 * listProjects：读取已登记项目列表。
 *
 * @param database 中心服务数据库。
 * @returns 按最近更新时间倒序排列的项目记录数组。
 */
function listProjects(database: CenterDatabase): ProjectRecord[] {
    return database.connection()
        .prepare(`
            SELECT id           AS projectId,
                   display_name AS displayName,
                   alias,
                   latest_path  AS latestPath,
                   created_at   AS createdAt,
                   updated_at   AS updatedAt
            FROM projects
            ORDER BY updated_at DESC
        `)
        .all() as ProjectRecord[];
}

/**
 * findSession：按会话 ID 查询会话记录。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 找到时返回会话记录，否则返回 null。
 */
function findSession(database: CenterDatabase, sessionId: string): ConversationSession | null {
    const row = database.connection()
        .prepare(`
            SELECT id           AS sessionId,
                   session_type AS sessionType,
                   project_id   AS projectId,
                   title,
                   created_at   AS createdAt,
                   updated_at   AS updatedAt,
                   (
                       SELECT substr(content_markdown, 1, 120)
                       FROM messages
                       WHERE messages.session_id = sessions.id
                         AND messages.role = 'user'
                       ORDER BY messages.created_at DESC
                       LIMIT 1
                   )            AS lastUserMessagePreview
            FROM sessions
            WHERE id = ?
        `)
        .get(sessionId) as ConversationSession | undefined;

    return row ?? null;
}

/**
 * listSessions：按类型和项目筛选会话列表。
 *
 * @param database 中心服务数据库。
 * @param filter 会话筛选条件。
 * @returns 会话记录数组。
 */
function listSessions(
    database: CenterDatabase,
    filter: {
        sessionType?: SessionType;
        projectId?: string | null;
    },
): ConversationSession[] {
    if (filter.sessionType === "project" && filter.projectId) {
        return database.connection()
            .prepare(`
                SELECT id           AS sessionId,
                       session_type AS sessionType,
                       project_id   AS projectId,
                       title,
                       created_at   AS createdAt,
                       updated_at   AS updatedAt,
                       (
                           SELECT substr(content_markdown, 1, 120)
                           FROM messages
                           WHERE messages.session_id = sessions.id
                             AND messages.role = 'user'
                           ORDER BY messages.created_at DESC
                           LIMIT 1
                       )            AS lastUserMessagePreview
                FROM sessions
                WHERE session_type = ?
                  AND project_id = ?
                ORDER BY updated_at DESC
            `)
            .all(
                filter.sessionType,
                filter.projectId,
            ) as ConversationSession[];
    }

    if (filter.sessionType) {
        return database.connection()
            .prepare(`
                SELECT id           AS sessionId,
                       session_type AS sessionType,
                       project_id   AS projectId,
                       title,
                       created_at   AS createdAt,
                       updated_at   AS updatedAt,
                       (
                           SELECT substr(content_markdown, 1, 120)
                           FROM messages
                           WHERE messages.session_id = sessions.id
                             AND messages.role = 'user'
                           ORDER BY messages.created_at DESC
                           LIMIT 1
                       )            AS lastUserMessagePreview
                FROM sessions
                WHERE session_type = ?
                ORDER BY updated_at DESC
            `)
            .all(filter.sessionType) as ConversationSession[];
    }

    return database.connection()
        .prepare(`
            SELECT id           AS sessionId,
                   session_type AS sessionType,
                   project_id   AS projectId,
                   title,
                   created_at   AS createdAt,
                   updated_at   AS updatedAt,
                   (
                       SELECT substr(content_markdown, 1, 120)
                       FROM messages
                       WHERE messages.session_id = sessions.id
                         AND messages.role = 'user'
                       ORDER BY messages.created_at DESC
                       LIMIT 1
                   )            AS lastUserMessagePreview
            FROM sessions
            ORDER BY updated_at DESC
        `)
        .all() as ConversationSession[];
}

/**
 * listMessages：查询会话消息列表。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 消息记录数组。
 */
function listMessages(database: CenterDatabase, sessionId: string): ConversationMessage[] {
    return database.connection()
        .prepare(`
            SELECT id               AS messageId,
                   session_id       AS sessionId,
                   turn_id          AS turnId,
                   role,
                   content_markdown AS contentMarkdown,
                   created_at       AS createdAt
            FROM messages
            WHERE session_id = ?
            ORDER BY created_at ASC
        `)
        .all(sessionId) as ConversationMessage[];
}

/**
 * listTurns：查询会话轮次列表。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 轮次记录数组。
 */
function listTurns(database: CenterDatabase, sessionId: string): ConversationTurn[] {
    return database.connection()
        .prepare(`
            SELECT id              AS turnId,
                   session_id      AS sessionId,
                   turn_number     AS turnNumber,
                   user_message_id AS userMessageId,
                   status,
                   started_at      AS startedAt,
                   ended_at        AS endedAt,
                   duration_ms     AS durationMs
            FROM conversation_turns
            WHERE session_id = ?
            ORDER BY turn_number ASC
        `)
        .all(sessionId) as ConversationTurn[];
}

/**
 * listTasks：查询会话任务列表。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 任务记录数组。
 */
function listTasks(database: CenterDatabase, sessionId: string): TaskRecord[] {
    return database.connection()
        .prepare(`
            SELECT id         AS taskId,
                   turn_id    AS turnId,
                   session_id AS sessionId,
                   status,
                   title,
                   created_at AS createdAt,
                   updated_at AS updatedAt
            FROM tasks
            WHERE session_id = ?
            ORDER BY created_at ASC
        `)
        .all(sessionId) as TaskRecord[];
}

/**
 * listTaskSteps：查询会话下所有任务步骤。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 任务步骤数组。
 */
function listTaskSteps(database: CenterDatabase, sessionId: string): TaskStepRecord[] {
    return database.connection()
        .prepare(`
            SELECT task_steps.id         AS stepId,
                   task_steps.task_id    AS taskId,
                   task_steps.status,
                   task_steps.title,
                   task_steps.started_at AS startedAt,
                   task_steps.ended_at   AS endedAt,
                   task_steps.summary
            FROM task_steps
                     INNER JOIN tasks ON tasks.id = task_steps.task_id
            WHERE tasks.session_id = ?
            ORDER BY task_steps.started_at ASC
        `)
        .all(sessionId) as TaskStepRecord[];
}

/**
 * findTask：按任务 ID 查询任务。
 *
 * @param database 中心服务数据库。
 * @param taskId 任务 ID。
 * @returns 找到时返回任务记录，否则返回 null。
 */
function findTask(database: CenterDatabase, taskId: string): TaskRecord | null {
    const row = database.connection()
        .prepare(`
            SELECT id         AS taskId,
                   turn_id    AS turnId,
                   session_id AS sessionId,
                   status,
                   title,
                   created_at AS createdAt,
                   updated_at AS updatedAt
            FROM tasks
            WHERE id = ?
        `)
        .get(taskId) as TaskRecord | undefined;

    return row ?? null;
}

/**
 * createTaskStep：创建任务步骤并写入事件。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param task 任务记录。
 * @param title 步骤标题。
 * @returns 创建后的任务步骤记录。
 */
function createTaskStep(
    database: CenterDatabase,
    events: CenterEventStore,
    task: TaskRecord,
    title: string,
): TaskStepRecord {
    // stepId: 任务步骤身份。
    const stepId = randomUUID();
    // now: 步骤开始时间。
    const now = new Date().toISOString();

    database.connection()
        .prepare(`
            INSERT INTO task_steps (id,
                                    task_id,
                                    status,
                                    title,
                                    started_at,
                                    ended_at,
                                    summary)
            VALUES (?, ?, ?, ?, ?, NULL, NULL)
        `)
        .run(
            stepId,
            task.taskId,
            "running",
            title,
            now,
        );

    database.connection()
        .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
        .run(
            "running",
            now,
            task.taskId,
        );

    events.append({
        eventType: "task.step.started",
        scopeType: "task_step",
        scopeId: stepId,
        sessionId: task.sessionId,
        turnId: task.turnId,
        taskId: task.taskId,
        stepId,
        status: "running",
        title: "任务步骤开始",
        summary: title,
        payload: {
            stepId,
            title,
        },
    });

    return {
        stepId,
        taskId: task.taskId,
        status: "running",
        title,
        startedAt: now,
        endedAt: null,
        summary: null,
    };
}

/**
 * updateTaskStep：更新任务步骤状态和摘要。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param stepId 步骤 ID。
 * @param status 新状态。
 * @param summary 步骤摘要。
 * @returns 更新后的步骤记录；不存在时返回 null。
 */
function updateTaskStep(
    database: CenterDatabase,
    events: CenterEventStore,
    stepId: string,
    status: TaskRecord["status"],
    summary: string | null,
): TaskStepRecord | null {
    const existing = database.connection()
        .prepare(`
            SELECT task_steps.id         AS stepId,
                   task_steps.task_id    AS taskId,
                   task_steps.status,
                   task_steps.title,
                   task_steps.started_at AS startedAt,
                   task_steps.ended_at   AS endedAt,
                   task_steps.summary,
                   tasks.session_id      AS sessionId,
                   tasks.turn_id         AS turnId
            FROM task_steps
                     INNER JOIN tasks ON tasks.id = task_steps.task_id
            WHERE task_steps.id = ?
        `)
        .get(stepId) as (TaskStepRecord & {
        sessionId: string;
        turnId: string;
    }) | undefined;

    if (!existing) {
        return null;
    }

    // now: 终态步骤保存结束时间，运行态保留空结束时间。
    const now = new Date().toISOString();
    const endedAt = isFinalTaskStatus(status) ? now : null;

    database.connection()
        .prepare("UPDATE task_steps SET status = ?, ended_at = ?, summary = ? WHERE id = ?")
        .run(
            status,
            endedAt,
            summary,
            stepId,
        );

    events.append({
        eventType: "task.step.updated",
        scopeType: "task_step",
        scopeId: stepId,
        sessionId: existing.sessionId,
        turnId: existing.turnId,
        taskId: existing.taskId,
        stepId,
        status,
        title: "任务步骤更新",
        summary: summary ?? existing.title,
        payload: {
            stepId,
            status,
        },
    });

    return {
        stepId,
        taskId: existing.taskId,
        status,
        title: existing.title,
        startedAt: existing.startedAt,
        endedAt,
        summary,
    };
}

/**
 * updateTurnStatus：更新轮次状态，并同步默认任务终态。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param turnId 轮次 ID。
 * @param status 新轮次状态。
 * @returns 更新后的轮次记录；不存在时返回 null。
 */
function updateTurnStatus(
    database: CenterDatabase,
    events: CenterEventStore,
    turnId: string,
    status: "waiting_user" | "completed" | "failed" | "cancelled",
): ConversationTurn | null {
    const turn = database.connection()
        .prepare(`
            SELECT id              AS turnId,
                   session_id      AS sessionId,
                   turn_number     AS turnNumber,
                   user_message_id AS userMessageId,
                   status,
                   started_at      AS startedAt,
                   ended_at        AS endedAt,
                   duration_ms     AS durationMs
            FROM conversation_turns
            WHERE id = ?
        `)
        .get(turnId) as ConversationTurn | undefined;

    if (!turn) {
        return null;
    }

    // now: 终态轮次固定结束时间，等待用户状态仍不写结束时间。
    const now = new Date().toISOString();
    const endedAt = status === "waiting_user" ? null : now;
    const durationMs = endedAt ? Math.max(0, new Date(endedAt).getTime() - new Date(turn.startedAt).getTime()) : null;

    database.connection()
        .prepare("UPDATE conversation_turns SET status = ?, ended_at = ?, duration_ms = ? WHERE id = ?")
        .run(
            status,
            endedAt,
            durationMs,
            turnId,
        );

    const taskStatus = mapTurnStatusToTaskStatus(status);
    database.connection()
        .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE turn_id = ?")
        .run(
            taskStatus,
            now,
            turnId,
        );

    events.append({
        eventType: "turn.updated",
        scopeType: "turn",
        scopeId: turnId,
        sessionId: turn.sessionId,
        turnId,
        taskId: null,
        status,
        title: "轮次状态更新",
        summary: `轮次状态更新为 ${status}`,
        payload: {
            turnId,
            status,
            endedAt,
            durationMs,
        },
    });

    return {
        ...turn,
        status,
        endedAt,
        durationMs,
    };
}

/**
 * isFinalTaskStatus：判断任务步骤是否进入终态。
 *
 * @param status 任务状态。
 * @returns 终态返回 true。
 */
function isFinalTaskStatus(status: TaskRecord["status"]): boolean {
    return status === "completed"
        || status === "failed"
        || status === "cancelled";
}

/**
 * mapTurnStatusToTaskStatus：把轮次状态映射到任务状态。
 *
 * @param status 轮次状态。
 * @returns 任务状态。
 */
function mapTurnStatusToTaskStatus(status: "waiting_user" | "completed" | "failed" | "cancelled"): TaskRecord["status"] {
    if (status === "waiting_user") {
        return "waiting_user";
    }

    return status;
}

/**
 * createMessageTurnAndTask：创建用户消息、轮次、默认任务并追加事件。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param session 会话记录。
 * @param contentMarkdown 用户发送的 Markdown 内容。
 * @returns 消息、轮次和任务 ID。
 */
function createMessageTurnAndTask(
    database: CenterDatabase,
    events: CenterEventStore,
    session: ConversationSession,
    contentMarkdown: string,
): SendMessageResponse {
    // now: 消息、轮次和任务共享同一服务端创建时间，便于审计。
    const now = new Date().toISOString();
    // messageId: 用户消息身份。
    const messageId = randomUUID();
    // turnId: 本轮对话身份。
    const turnId = randomUUID();
    // taskId: 默认任务身份，后续 Worker 接管后继续更新该任务。
    const taskId = randomUUID();
    // turnNumber: 同一会话内用户发起轮次递增。
    const turnNumberRow = database.connection()
        .prepare("SELECT MAX(turn_number) AS maxTurnNumber FROM conversation_turns WHERE session_id = ?")
        .get(session.sessionId) as {
        maxTurnNumber: number | null;
    } | undefined;
    const turnNumber = (turnNumberRow?.maxTurnNumber ?? 0) + 1;

    const transaction = database.connection().transaction(() => {
        database.connection()
            .prepare(`
                INSERT INTO messages (id,
                                      session_id,
                                      turn_id,
                                      role,
                                      content_markdown,
                                      created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `)
            .run(
                messageId,
                session.sessionId,
                turnId,
                "user",
                contentMarkdown,
                now,
            );

        database.connection()
            .prepare(`
                INSERT INTO conversation_turns (id,
                                                session_id,
                                                turn_number,
                                                user_message_id,
                                                status,
                                                started_at,
                                                ended_at,
                                                duration_ms)
                VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
            `)
            .run(
                turnId,
                session.sessionId,
                turnNumber,
                messageId,
                "running",
                now,
            );

        database.connection()
            .prepare(`
                INSERT INTO tasks (id,
                                   turn_id,
                                   session_id,
                                   status,
                                   title,
                                   created_at,
                                   updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
                taskId,
                turnId,
                session.sessionId,
                "queued",
                "等待 Agent 执行",
                now,
                now,
            );

        database.connection()
            .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
            .run(
                now,
                session.sessionId,
            );
    });

    transaction();

    events.append({
        eventType: "turn.started",
        scopeType: "turn",
        scopeId: turnId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: "running",
        title: "轮次开始",
        summary: "用户发送消息后创建新轮次。",
        payload: {
            turnId,
            turnNumber,
            userMessageId: messageId,
        },
    });

    events.append({
        eventType: "message.created",
        scopeType: "message",
        scopeId: messageId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: "completed",
        title: "消息创建",
        summary: "用户消息已写入中心服务。",
        payload: {
            messageId,
            role: "user",
        },
    });

    events.append({
        eventType: "task.updated",
        scopeType: "task",
        scopeId: taskId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: "queued",
        title: "任务排队",
        summary: "消息发送后默认任务进入排队状态。",
        payload: {
            taskId,
        },
    });

    return {
        messageId,
        turnId,
        taskId,
    };
}

function savePendingMessage(
    database: CenterDatabase,
    sessionId: string,
    clientId: string | null,
    contentMarkdown: string,
): {
    pendingMessageId: string;
    status: string;
} {
    const pendingMessageId = randomUUID();
    const now = new Date().toISOString();
    database.connection()
        .prepare("INSERT INTO pending_messages (id, session_id, client_id, content_markdown, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
            pendingMessageId,
            sessionId,
            clientId,
            contentMarkdown,
            "waiting_user",
            now,
            now,
        );
    return {
        pendingMessageId,
        status: "waiting_user",
    };
}

function listPendingMessages(
    database: CenterDatabase,
    sessionId: string,
): unknown[] {
    return database.connection()
        .prepare("SELECT id AS pendingMessageId, session_id AS sessionId, client_id AS clientId, content_markdown AS contentMarkdown, status, created_at AS createdAt, updated_at AS updatedAt FROM pending_messages WHERE session_id = ? ORDER BY created_at ASC")
        .all(sessionId);
}

/**
 * listEvents：查询断线补齐事件。
 *
 * @param database 中心服务数据库。
 * @param filter 事件筛选条件。
 * @returns 事件记录数组。
 */
function listEvents(
    database: CenterDatabase,
    filter: {
        sessionId: string | null;
        turnId: string | null;
        afterSequence: number;
    },
): EventRecord[] {
    const rows = database.connection()
        .prepare(`
            SELECT id           AS eventId,
                   event_type   AS eventType,
                   turn_id      AS turnId,
                   task_id      AS taskId,
                   sequence,
                   occurred_at  AS occurredAt,
                   summary,
                   payload_json AS payloadJson,
                   trace_id     AS traceId
            FROM events
            WHERE (? IS NULL OR session_id = ?)
              AND (? IS NULL OR turn_id = ?)
              AND sequence > ?
            ORDER BY occurred_at ASC, sequence ASC
        `)
        .all(
            filter.sessionId,
            filter.sessionId,
            filter.turnId,
            filter.turnId,
            filter.afterSequence,
        ) as Array<{
        eventId: string;
        eventType: string;
        turnId: string | null;
        taskId: string | null;
        sequence: number;
        occurredAt: string;
        summary: string;
        payloadJson: string;
        traceId: string;
    }>;

    return rows.map((row) => ({
        eventId: row.eventId,
        eventType: row.eventType,
        turnId: row.turnId,
        taskId: row.taskId,
        sequence: row.sequence,
        occurredAt: row.occurredAt,
        summary: row.summary,
        payload: JSON.parse(row.payloadJson),
        traceId: row.traceId,
    }));
}

/**
 * isSyncClientAllowed：校验 WebSocket 订阅范围。
 *
 * @param database 中心服务数据库。
 * @param clientId 客户端 ID。
 * @param clientType 客户端类型。
 * @param projectId 客户端订阅项目 ID。
 * @returns 允许连接时返回 true。
 */
function isSyncClientAllowed(
    database: CenterDatabase,
    clientId: string,
    clientType: ClientType,
    projectId: string | null,
): boolean {
    // row: sync_clients 是授权后的客户端事实来源。
    const row = database.connection()
        .prepare("SELECT id, client_type AS clientType, project_id AS projectId FROM sync_clients WHERE id = ?")
        .get(clientId) as {
        id: string;
        clientType: ClientType;
        projectId: string | null;
    } | undefined;

    if (!row || row.clientType !== clientType) {
        return false;
    }

    if (clientType === "ide-plugin") {
        // IDE 插件只能订阅当前项目范围；当前阶段允许项目 ID 为空以兼容插件页面初始化。
        return row.projectId === projectId;
    }

    return true;
}

/**
 * broadcastEvents：按客户端订阅范围推送事件。
 *
 * @param clients WebSocket 客户端集合。
 * @param session 事件所属会话。
 * @param events 待推送事件。
 * @returns 没有返回值。
 */
function broadcastEvents(
    clients: Map<string, RealtimeClientConnection>,
    session: ConversationSession,
    events: EventRecord[],
): void {
    for (const client of clients.values()) {
        if (client.clientType === "ide-plugin" && client.projectId !== session.projectId) {
            continue;
        }

        for (const event of events) {
            client.send({
                type: "event.appended",
                payload: event,
            });
            broadcastDomainEnvelopeForEvent(client, event);
        }
    }
}

/**
 * broadcastDomainEnvelopeForEvent：把通用事件同步转换为领域专项 WebSocket 包。
 *
 * @param client 已通过握手的实时客户端。
 * @param event 中心服务已经落库的事件记录。
 * @returns 没有返回值。
 */
function broadcastDomainEnvelopeForEvent(
    client: RealtimeClientConnection,
    event: EventRecord,
): void {
    // task.updated: 任务状态需要独立协议包，前端可以不解析通用事件就刷新任务卡片。
    if (event.eventType === "task.updated") {
        client.send({
            type: "task.updated",
            payload: event.payload,
            traceId: event.traceId,
        });
        return;
    }

    // agent.state.changed: 智能体状态栏使用专项协议，避免 UI 从事件类型猜测运行状态。
    if (event.eventType === "agent.state.changed") {
        client.send({
            type: "agent.state.changed",
            payload: event.payload,
            traceId: event.traceId,
        });
        return;
    }

    // notification.created: 通知需要直接触发浏览器或页面内提醒，不能只依赖审计事件列表。
    if (event.eventType === "notification.created") {
        client.send({
            type: "notification.created",
            payload: event.payload,
            traceId: event.traceId,
        });
    }
}

/**
 * broadcastGlobalEvent：推送不绑定具体会话的全局事件。
 *
 * @param clients WebSocket 客户端集合。
 * @param event 已写入 SQLite 的全局事件。
 * @returns 没有返回值。
 */
function broadcastGlobalEvent(
    clients: Map<string, RealtimeClientConnection>,
    event: EventRecord,
): void {
    for (const client of clients.values()) {
        // ide-plugin: 插件端只关注当前项目会话，全局通知和全局智能体状态先不越权推送给插件。
        if (client.clientType === "ide-plugin") {
            continue;
        }

        client.send({
            type: "event.appended",
            payload: event,
        });
        broadcastDomainEnvelopeForEvent(client, event);
    }
}

/**
 * sendSocketEnvelope：发送 WebSocket 协议包。
 *
 * @param socket Fastify WebSocket 连接。
 * @param envelope 协议包。
 * @returns 没有返回值。
 */
function sendSocketEnvelope(
    socket: {
        send: (data: string) => void;
    },
    envelope: WebSocketEnvelope,
): void {
    socket.send(JSON.stringify(envelope));
}

/**
 * ensureMainAgent：初始化或恢复内置主智能体。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @returns 主智能体记录。
 */
function ensureMainAgent(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
): {
    agentId: string;
    name: string;
} {
    const agentId = "main";
    const definitionPath = join(centerDirectory, "agents", "main.md");
    mkdirSync(dirname(definitionPath), {
        recursive: true,
    });
    writeFileSyncUtf8IfMissing(definitionPath, [
        "---",
        "id: main",
        "name: 致心",
        "enabled: true",
        "createdBy: system-builtin",
        "---",
        "",
        "# 致心",
        "",
        "系统内置主智能体，不可删除。",
        "",
    ].join("\n"));
    database.connection()
        .prepare(`
            INSERT INTO agents_index (id,
                                      name,
                                      enabled,
                                      role_description,
                                      capability_boundary,
                                      default_provider_id,
                                      default_model,
                                      reasoning_effort,
                                      memory_index_path,
                                      created_by,
                                      definition_path,
                                      updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO
            UPDATE SET
                name = excluded.name,
                enabled = excluded.enabled,
                role_description = excluded.role_description,
                capability_boundary = excluded.capability_boundary,
                default_provider_id = excluded.default_provider_id,
                default_model = excluded.default_model,
                reasoning_effort = excluded.reasoning_effort,
                memory_index_path = excluded.memory_index_path,
                created_by = excluded.created_by,
                definition_path = excluded.definition_path,
                updated_at = excluded.updated_at
        `)
        .run(
            agentId,
            "致心",
            1,
            "系统内置主智能体，直接与用户对话并调度其他智能体。",
            "遵守中心服务权限、执行模式和当前会话能力边界。",
            null,
            null,
            null,
            "memory/agents/main",
            "system-builtin",
            "agents/main.md",
            new Date().toISOString(),
        );
    events.append({
        eventType: "agent.bootstrap",
        scopeType: "agent",
        scopeId: agentId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "主智能体初始化",
        summary: "内置主智能体致心已恢复。",
        payload: {
            agentId,
        },
    });

    return {
        agentId,
        name: "致心",
    };
}

/**
 * createAgent：创建长期智能体定义。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param input 智能体创建参数。
 * @returns 智能体身份。
 */
function createAgent(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    input: {
        name?: string;
        roleDescription?: string;
        capabilityBoundary?: string;
        defaultProviderId?: string | null;
        defaultModel?: string | null;
        reasoningEffort?: string | null;
        createdBy?: string;
    },
): {
    agentId: string;
    name: string;
} {
    const agentId = randomUUID();
    const relativePath = `agents/${agentId}.md`;
    const definitionPath = join(centerDirectory, relativePath);
    mkdirSync(dirname(definitionPath), {
        recursive: true,
    });
    appendFileSync(definitionPath, [
        "---",
        `id: ${agentId}`,
        `name: ${input.name}`,
        `roleDescription: ${input.roleDescription}`,
        `capabilityBoundary: ${input.capabilityBoundary}`,
        `defaultProviderId: ${input.defaultProviderId ?? ""}`,
        `defaultModel: ${input.defaultModel ?? ""}`,
        `reasoningEffort: ${input.reasoningEffort ?? ""}`,
        `memoryIndex: memory/agents/${agentId}`,
        "enabled: true",
        `createdBy: ${input.createdBy ?? "user"}`,
        "---",
        "",
        `# ${input.name}`,
        "",
        "## 角色说明",
        "",
        input.roleDescription,
        "",
        "## 能力边界",
        "",
        input.capabilityBoundary,
        "",
    ].join("\n"), "utf-8");
    database.connection()
        .prepare(`
            INSERT INTO agents_index (id,
                                      name,
                                      enabled,
                                      role_description,
                                      capability_boundary,
                                      default_provider_id,
                                      default_model,
                                      reasoning_effort,
                                      memory_index_path,
                                      created_by,
                                      definition_path,
                                      updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
            agentId,
            input.name,
            1,
            input.roleDescription,
            input.capabilityBoundary,
            input.defaultProviderId ?? null,
            input.defaultModel ?? null,
            input.reasoningEffort ?? null,
            `memory/agents/${agentId}`,
            input.createdBy ?? "user",
            relativePath,
            new Date().toISOString(),
        );
    events.append({
        eventType: "agent.created",
        scopeType: "agent",
        scopeId: agentId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "智能体创建",
        summary: `长期智能体 ${input.name} 已创建。`,
        payload: {
            agentId,
        },
    });

    return {
        agentId,
        name: input.name ?? "",
    };
}

/**
 * updateAgent：更新长期智能体定义和索引。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param input 智能体更新参数。
 * @returns 更新后的智能体摘要。
 */
function updateAgent(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    input: {
        agentId?: string;
        name?: string;
        roleDescription?: string;
        capabilityBoundary?: string;
        defaultProviderId?: string | null;
        defaultModel?: string | null;
        reasoningEffort?: string | null;
    },
): {
    agentId: string | undefined;
    updated: boolean;
} {
    const existing = database.connection()
        .prepare("SELECT id, name, role_description AS roleDescription, capability_boundary AS capabilityBoundary, default_provider_id AS defaultProviderId, default_model AS defaultModel, reasoning_effort AS reasoningEffort, definition_path AS definitionPath FROM agents_index WHERE id = ?")
        .get(input.agentId) as {
        id: string;
        name: string;
        roleDescription: string | null;
        capabilityBoundary: string | null;
        defaultProviderId: string | null;
        defaultModel: string | null;
        reasoningEffort: string | null;
        definitionPath: string;
    } | undefined;

    if (!existing) {
        return {
            agentId: input.agentId,
            updated: false,
        };
    }

    const next = {
        name: input.name ?? existing.name,
        roleDescription: input.roleDescription ?? existing.roleDescription ?? "",
        capabilityBoundary: input.capabilityBoundary ?? existing.capabilityBoundary ?? "",
        defaultProviderId: input.defaultProviderId ?? existing.defaultProviderId,
        defaultModel: input.defaultModel ?? existing.defaultModel,
        reasoningEffort: input.reasoningEffort ?? existing.reasoningEffort,
    };
    const now = new Date().toISOString();
    database.connection()
        .prepare("UPDATE agents_index SET name = ?, role_description = ?, capability_boundary = ?, default_provider_id = ?, default_model = ?, reasoning_effort = ?, updated_at = ? WHERE id = ?")
        .run(
            next.name,
            next.roleDescription,
            next.capabilityBoundary,
            next.defaultProviderId,
            next.defaultModel,
            next.reasoningEffort,
            now,
            input.agentId,
        );

    writeFileSyncUtf8(join(centerDirectory, existing.definitionPath), renderAgentDefinition({
        agentId: existing.id,
        name: next.name,
        roleDescription: next.roleDescription,
        capabilityBoundary: next.capabilityBoundary,
        defaultProviderId: next.defaultProviderId,
        defaultModel: next.defaultModel,
        reasoningEffort: next.reasoningEffort,
        enabled: true,
        createdBy: "user",
    }));
    events.append({
        eventType: "agent.updated",
        scopeType: "agent",
        scopeId: input.agentId ?? null,
        sessionId: null,
        turnId: null,
        taskId: null,
        agentId: input.agentId,
        status: "completed",
        title: "智能体更新",
        summary: next.name,
        payload: {agentId: input.agentId}
    });

    return {
        agentId: input.agentId,
        updated: true,
    };
}

/**
 * disableAgent：停用长期智能体并记录删除影响确认。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param agentId 智能体 ID。
 * @param archiveMemory 是否归档记忆。
 * @returns 停用结果。
 */
function disableAgent(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    agentId: string,
    archiveMemory: boolean,
): {
    agentId: string;
    enabled: boolean;
    archiveMemory: boolean;
} {
    const now = new Date().toISOString();
    database.connection()
        .prepare("UPDATE agents_index SET enabled = 0, updated_at = ? WHERE id = ? AND id <> 'main'")
        .run(
            now,
            agentId,
        );
    writeJsonFile(join(centerDirectory, "agents", `${agentId}.delete-impact.json`), {
        agentId,
        archiveMemory,
        impactAcceptedAt: now,
        impactSummary: "已确认记忆处理、调度入口移除和历史会话保留影响。",
    });
    events.append({
        eventType: "agent.disabled",
        scopeType: "agent",
        scopeId: agentId,
        sessionId: null,
        turnId: null,
        taskId: null,
        agentId,
        status: "completed",
        title: "智能体停用",
        summary: "长期智能体已停用，历史会话保留。",
        payload: {agentId, archiveMemory}
    });

    return {
        agentId,
        enabled: false,
        archiveMemory,
    };
}

/**
 * listAgents：查询长期智能体索引。
 *
 * @param database 中心服务数据库。
 * @returns 智能体列表。
 */
function listAgents(database: CenterDatabase): unknown[] {
    return database.connection()
        .prepare("SELECT id AS agentId, name, enabled, role_description AS roleDescription, capability_boundary AS capabilityBoundary, default_provider_id AS defaultProviderId, default_model AS defaultModel, reasoning_effort AS reasoningEffort, memory_index_path AS memoryIndexPath, created_by AS createdBy, definition_path AS definitionPath, updated_at AS updatedAt FROM agents_index ORDER BY updated_at DESC")
        .all();
}

/**
 * renderAgentDefinition：渲染智能体 Markdown 定义。
 *
 * @param input 智能体定义字段。
 * @returns Markdown 定义文本。
 */
function renderAgentDefinition(input: {
    agentId: string;
    name: string;
    roleDescription: string;
    capabilityBoundary: string;
    defaultProviderId: string | null;
    defaultModel: string | null;
    reasoningEffort: string | null;
    enabled: boolean;
    createdBy: string;
}): string {
    return [
        "---",
        `id: ${input.agentId}`,
        `name: ${input.name}`,
        `roleDescription: ${input.roleDescription}`,
        `capabilityBoundary: ${input.capabilityBoundary}`,
        `defaultProviderId: ${input.defaultProviderId ?? ""}`,
        `defaultModel: ${input.defaultModel ?? ""}`,
        `reasoningEffort: ${input.reasoningEffort ?? ""}`,
        `memoryIndex: memory/agents/${input.agentId}`,
        `enabled: ${input.enabled ? "true" : "false"}`,
        `createdBy: ${input.createdBy}`,
        "---",
        "",
        `# ${input.name}`,
        "",
        "## 角色说明",
        "",
        input.roleDescription,
        "",
        "## 能力边界",
        "",
        input.capabilityBoundary,
        "",
    ].join("\n");
}

/**
 * formatMemoryTimeTitle：生成永久记忆段落标题时间。
 *
 * @param value 记忆写入时间。
 * @returns 只包含 HH:mm:ss 的标题时间文本。
 */
function formatMemoryTimeTitle(value: Date): string {
    // timeText: 永久记忆 Markdown 标题只允许写时间，日期由目录 year/month/day 表达。
    const timeText = value.toISOString()
        .slice(
            11,
            19,
        );

    return timeText;
}

/**
 * writeAgentMemory：追加写入智能体 Markdown 记忆。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param input 记忆写入参数。
 * @returns 记忆文件相对路径。
 */
function writeAgentMemory(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    memoryQueues: Map<string, MemoryQueueState>,
    input: {
        agentId?: string;
        keywords?: string;
        summary?: string;
        userText?: string;
        assistantText?: string;
    },
): {
    relativePath: string;
} {
    const queueState = enterMemoryQueue(memoryQueues, input.agentId ?? "");
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const relativePath = `memory/agents/${input.agentId}/${year}/${month}/${day}.md`;
    const filePath = join(centerDirectory, relativePath);
    const memoryTimeTitle = formatMemoryTimeTitle(now);
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    appendFileSync(filePath, [
        `# ${memoryTimeTitle}`,
        "",
        "## 关键词",
        "",
        input.keywords,
        "",
        "## 总结",
        "",
        input.summary,
        "",
        "## 使用的电脑",
        "",
        "center",
        "",
        "## 用户说的",
        "",
        input.userText,
        "",
        "## 回答的",
        "",
        input.assistantText,
        "",
    ].join("\n"), "utf-8");
    const memoryIndexId = randomUUID();
    database.connection()
        .prepare("INSERT INTO memory_index (id, agent_id, keywords, summary, source_session_id, source_turn_id, attachment_refs_json, memory_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
            memoryIndexId,
            input.agentId,
            input.keywords,
            input.summary,
            null,
            null,
            "[]",
            relativePath,
            now.toISOString(),
        );
    events.append({
        eventType: "memory.write",
        scopeType: "agent",
        scopeId: input.agentId ?? null,
        sessionId: null,
        turnId: null,
        taskId: null,
        agentId: input.agentId,
        status: "completed",
        title: "记忆写入",
        summary: input.summary ?? "",
        payload: {
            relativePath,
            memoryIndexId,
        },
    });
    leaveMemoryQueue(queueState);

    return {
        relativePath,
    };
}

/**
 * enterMemoryQueue：进入指定智能体的记忆单写队列。
 *
 * @param memoryQueues 运行期记忆队列表。
 * @param agentId 智能体 ID。
 * @returns 当前智能体的队列状态。
 */
function enterMemoryQueue(memoryQueues: Map<string, MemoryQueueState>, agentId: string): MemoryQueueState {
    // existing: 同一 agentId 复用同一队列状态，表达单写边界。
    const existing = memoryQueues.get(agentId);
    if (existing) {
        existing.pendingWrites += existing.running ? 1 : 0;
        existing.running = true;
        return existing;
    }

    const created: MemoryQueueState = {
        agentId,
        running: true,
        pendingWrites: 0,
    };
    memoryQueues.set(agentId, created);
    return created;
}

/**
 * leaveMemoryQueue：离开指定智能体的记忆单写队列。
 *
 * @param queueState 当前智能体队列状态。
 * @returns 没有返回值。
 */
function leaveMemoryQueue(queueState: MemoryQueueState): void {
    // pendingWrites: 当前实现同步写入，写完后没有遗留等待项。
    queueState.pendingWrites = Math.max(0, queueState.pendingWrites - 1);
    queueState.running = false;
}

/**
 * readMemoryQueueState：读取智能体记忆队列状态。
 *
 * @param memoryQueues 运行期记忆队列表。
 * @param agentId 智能体 ID。
 * @returns 可展示的单写队列状态。
 */
function readMemoryQueueState(
    memoryQueues: Map<string, MemoryQueueState>,
    agentId: string,
): {
    agentId: string;
    queueMode: "single-writer";
    running: boolean;
    pendingWrites: number;
} {
    const state = memoryQueues.get(agentId);
    return {
        agentId,
        queueMode: "single-writer",
        running: state?.running ?? false,
        pendingWrites: state?.pendingWrites ?? 0,
    };
}

/**
 * createProvider：保存供应商配置并隐藏 API Key 明文。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param input 供应商配置。
 * @returns 供应商 ID 和敏感信息状态。
 */
function createProvider(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    input: {
        providerName?: string;
        protocolPluginId?: string;
        protocolMode?: string;
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        enabled?: boolean;
        capabilities?: ProviderCapabilityDeclaration;
        proxyPolicy?: ProviderProxyPolicy;
    },
): {
    providerId: string;
    hasApiKey: boolean;
} {
    const providerId = randomUUID();
    const relativePath = `providers/${providerId}.json`;
    // apiKeySecretRef: 中心服务私有 secret 引用；客户端只拿 hasApiKey，后续模型网关可用该引用读取明文调用供应商。
    const apiKeySecretRef = saveSecretValue(
        centerDirectory,
        "provider-api-key",
        providerId,
        input.apiKey ?? "",
        null,
    );
    const capabilities = normalizeProviderCapabilities(input.capabilities);
    const proxyPolicy = normalizeProviderProxyPolicy(input.proxyPolicy);
    writeJsonFile(join(centerDirectory, relativePath), {
        providerId,
        providerName: input.providerName,
        protocolPluginId: input.protocolPluginId,
        protocolMode: input.protocolMode,
        baseUrl: input.baseUrl,
        apiKeySecretRef,
        defaultModel: input.model,
        enabled: input.enabled ?? true,
        capabilities,
        proxyPolicy,
        updatedAt: new Date().toISOString(),
    });
    events.append({
        eventType: "provider.created",
        scopeType: "provider",
        scopeId: providerId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "供应商创建",
        summary: input.providerName ?? providerId,
        payload: {
            providerId,
            hasApiKey: apiKeySecretRef !== null,
        },
    });
    void database;

    return {
        providerId,
        hasApiKey: apiKeySecretRef !== null,
    };
}

function listProviderConfigs(centerDirectory: string): unknown[] {
    const providersDirectory = join(centerDirectory, "providers");
    if (!existsSync(providersDirectory)) {
        return [];
    }

    return readdirSync(providersDirectory)
        .filter((fileName) => fileName.endsWith(".json") && !fileName.endsWith(".models.json") && !fileName.endsWith(".patch.json"))
        .map((fileName) => JSON.parse(readFileSync(join(providersDirectory, fileName), "utf-8")) as Record<string, unknown>)
        .map((provider) => ({
            providerId: provider.providerId,
            providerName: provider.providerName,
            protocolPluginId: provider.protocolPluginId,
            protocolMode: provider.protocolMode,
            baseUrl: provider.baseUrl,
            defaultModel: provider.defaultModel,
            enabled: provider.enabled,
            capabilities: provider.capabilities,
            proxyPolicy: provider.proxyPolicy,
            updatedAt: provider.updatedAt,
            hasApiKey: typeof provider.apiKeySecretRef === "string",
        }));
}

function updateProviderConfig(
    centerDirectory: string,
    input: {
        providerId?: string;
        providerName?: string;
        protocolPluginId?: string;
        protocolMode?: string;
        baseUrl?: string;
        apiKey?: string;
        enabled?: boolean;
        defaultModel?: string;
        capabilities?: ProviderCapabilityDeclaration;
        proxyPolicy?: ProviderProxyPolicy;
    },
): {
    providerId: string | undefined;
    enabled: boolean | undefined;
    defaultModel: string | undefined;
} {
    const providerPath = join(centerDirectory, "providers", `${input.providerId}.json`);
    if (!existsSync(providerPath)) {
        throw new Error("PROVIDER_NOT_FOUND");
    }

    const existing = JSON.parse(readFileSync(providerPath, "utf-8")) as Record<string, unknown>;
    // apiKeySecretRef: API Key 为空表示保留既有 secret，新输入才覆盖中心服务私有值。
    const apiKeySecretRef = typeof input.apiKey === "string" && input.apiKey.length > 0
        ? saveSecretValue(
            centerDirectory,
            "provider-api-key",
            String(input.providerId),
            input.apiKey,
            typeof existing.apiKeySecretRef === "string"
                ? existing.apiKeySecretRef
                : null,
        )
        : typeof existing.apiKeySecretRef === "string"
            ? existing.apiKeySecretRef
            : null;
    writeJsonFile(providerPath, {
        ...existing,
        providerName: input.providerName ?? existing.providerName,
        protocolPluginId: input.protocolPluginId ?? existing.protocolPluginId,
        protocolMode: input.protocolMode ?? existing.protocolMode,
        baseUrl: input.baseUrl ?? existing.baseUrl,
        apiKeySecretRef,
        enabled: input.enabled ?? existing.enabled,
        defaultModel: input.defaultModel ?? existing.defaultModel,
        capabilities: input.capabilities
            ? normalizeProviderCapabilities(input.capabilities)
            : existing.capabilities,
        proxyPolicy: input.proxyPolicy
            ? normalizeProviderProxyPolicy(input.proxyPolicy)
            : existing.proxyPolicy,
        updatedAt: new Date().toISOString(),
    });
    return {
        providerId: input.providerId,
        enabled: input.enabled,
        defaultModel: input.defaultModel,
    };
}

function refreshProviderModels(
    centerDirectory: string,
    providerId: string,
    models: string[],
    reasoningEfforts: string[],
    contextWindows: ProviderModelContextWindow[] = [],
): {
    providerId: string;
    models: string[];
    reasoningEfforts: string[];
    contextWindows: ProviderModelContextWindow[];
} {
    const normalizedContextWindows = normalizeProviderModelContextWindows(
        models,
        contextWindows,
    );
    writeJsonFile(join(centerDirectory, "providers", `${providerId}.models.json`), {
        providerId,
        models,
        reasoningEfforts,
        contextWindows: normalizedContextWindows,
        updatedAt: new Date().toISOString(),
    });
    return {
        providerId,
        models,
        reasoningEfforts,
        contextWindows: normalizedContextWindows,
    };
}

/**
 * readProviderModelList：读取供应商已经保存的模型列表。
 *
 * @param centerDirectory 中心目录。
 * @param providerId 供应商 ID。
 * @returns 模型列表、推理深度列表和更新时间。
 */
function readProviderModelList(
    centerDirectory: string,
    providerId: string,
): {
    providerId: string;
    models: string[];
    reasoningEfforts: string[];
    contextWindows: ProviderModelContextWindow[];
    updatedAt: string | null;
} {
    const modelListPath = join(centerDirectory, "providers", `${providerId}.models.json`);
    if (!existsSync(modelListPath)) {
        return {
            providerId,
            models: [],
            reasoningEfforts: [],
            contextWindows: [],
            updatedAt: null,
        };
    }

    const value = JSON.parse(readFileSync(modelListPath, "utf-8")) as {
        providerId?: string;
        models?: unknown;
        reasoningEfforts?: unknown;
        contextWindows?: unknown;
        updatedAt?: unknown;
    };
    const models = Array.isArray(value.models)
        ? value.models.filter((model): model is string => typeof model === "string")
        : [];

    return {
        providerId,
        models,
        reasoningEfforts: Array.isArray(value.reasoningEfforts)
            ? value.reasoningEfforts.filter((effort): effort is string => typeof effort === "string")
            : [],
        contextWindows: normalizeProviderModelContextWindows(
            models,
            Array.isArray(value.contextWindows)
                ? value.contextWindows
                : [],
        ),
        updatedAt: typeof value.updatedAt === "string"
            ? value.updatedAt
            : null,
    };
}

/**
 * normalizeProviderModelContextWindows：规范化模型上下文窗口配置。
 *
 * @param models 当前已保存模型名称列表。
 * @param input 用户提交或文件读取到的窗口配置。
 * @returns 去重后的模型上下文窗口配置。
 */
function normalizeProviderModelContextWindows(
    models: string[],
    input: unknown[],
): ProviderModelContextWindow[] {
    // allowedModels: 只允许为已保存模型名称记录窗口，避免孤立窗口配置污染默认模型下拉。
    const allowedModels = new Set(models);
    const normalized = new Map<string, ProviderModelContextWindow>();
    for (const item of input) {
        if (typeof item !== "object" || item === null) {
            continue;
        }
        const record = item as {
            model?: unknown;
            contextWindowTokens?: unknown;
        };
        if (typeof record.model !== "string" || !allowedModels.has(record.model)) {
            continue;
        }
        if (typeof record.contextWindowTokens !== "number" || !Number.isFinite(record.contextWindowTokens) || record.contextWindowTokens <= 0) {
            continue;
        }
        normalized.set(record.model, {
            model: record.model,
            contextWindowTokens: Math.round(record.contextWindowTokens),
        });
    }

    return [...normalized.values()];
}

/**
 * normalizeProviderCapabilities：规范化供应商能力声明。
 *
 * @param input 外部传入的能力声明。
 * @returns 完整能力声明。
 */
function normalizeProviderCapabilities(input?: Partial<ProviderCapabilityDeclaration>): ProviderCapabilityDeclaration {
    return {
        supportsVision: input?.supportsVision ?? false,
        supportsToolCalling: input?.supportsToolCalling ?? false,
        supportsJsonOutput: input?.supportsJsonOutput ?? false,
        supportsReasoningEffort: input?.supportsReasoningEffort ?? false,
        providesCacheUsage: input?.providesCacheUsage ?? false,
        supportsModelList: input?.supportsModelList ?? false,
        supportsStreaming: input?.supportsStreaming ?? false,
    };
}

/**
 * normalizeProviderProxyPolicy：规范化供应商代理策略。
 *
 * @param input 外部传入的代理策略。
 * @returns 完整代理策略。
 */
function normalizeProviderProxyPolicy(input?: Partial<ProviderProxyPolicy>): ProviderProxyPolicy {
    if (input?.mode === "none") {
        return {
            mode: "none",
            proxyId: null,
        };
    }

    if (input?.mode === "use-specified") {
        return {
            mode: "use-specified",
            proxyId: input.proxyId ?? null,
        };
    }

    return {
        mode: "use-global-default",
        proxyId: null,
    };
}

/**
 * SecretConfigFile：中心服务私有敏感信息文件结构。
 *
 * 来源：中心目录 `config/secrets.json`。
 * 含义：保存中心服务后续调用供应商或代理所需明文，客户端列表只拿引用状态。
 * 格式：按 secretRef 索引的 JSON 对象。
 * 默认值：文件不存在时 secrets 为空对象。
 * 约束：该文件只能由中心服务本机使用，任何 list 接口都不能返回 value。
 */
interface SecretConfigFile {
    /**
     * secrets: secretRef 到敏感值记录的映射。
     */
    secrets: Record<string, {
        /**
         * secretKind: 敏感信息类型，用于区分供应商 API Key 和代理密码。
         */
        secretKind: "provider-api-key" | "proxy-password";

        /**
         * ownerId: 关联实体 ID，例如 providerId 或 proxyId。
         */
        ownerId: string;

        /**
         * value: 中心服务调用外部供应商或代理时使用的明文值。
         */
        value: string;

        /**
         * updatedAt: 更新时间，ISO 字符串。
         */
        updatedAt: string;
    }>;
}

/**
 * saveSecretValue：保存中心服务私有敏感信息并返回引用。
 *
 * @param centerDirectory 中心目录。
 * @param secretKind 敏感信息类型。
 * @param ownerId 关联实体 ID。
 * @param value 本次提交的敏感明文。
 * @param existingSecretRef 既有 secret 引用，存在时覆盖原记录。
 * @returns secret 引用；空值表示未配置敏感信息。
 */
function saveSecretValue(
    centerDirectory: string,
    secretKind: "provider-api-key" | "proxy-password",
    ownerId: string,
    value: string,
    existingSecretRef: string | null,
): string | null {
    if (value.length === 0) {
        return existingSecretRef;
    }

    // secretsPath: 所有低频敏感配置统一放在 config 下，符合中心服务本地 JSON 边界。
    const secretsPath = join(centerDirectory, "config", "secrets.json");
    const config = readJsonFileIfExists<SecretConfigFile>(secretsPath) ?? {
        secrets: {},
    };
    const secretRef = existingSecretRef ?? `${secretKind}:${ownerId}`;
    config.secrets[secretRef] = {
        secretKind,
        ownerId,
        value,
        updatedAt: new Date().toISOString(),
    };
    writeJsonFile(secretsPath, config);
    return secretRef;
}

function saveProxyConfig(
    centerDirectory: string,
    input: {
        proxyId?: string;
        proxyName?: string;
        protocol?: string;
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        enabled?: boolean;
        note?: string;
    },
): {
    proxyId: string;
    hasAuth: boolean;
} {
    // proxyId: 修改时沿用既有 ID，新增时由中心服务生成，避免前端猜测实体身份。
    const proxyId = input.proxyId ?? randomUUID();
    // existing: 修改代理且密码为空时保留既有 secret 引用，因为空值在 UI 中表示“不修改已保存密码”。
    const existing = readJsonFileIfExists<NetworkProxyConfigFile>(join(centerDirectory, "config", `proxy-${proxyId}.json`));
    // passwordSecretRef: 只有用户提交非空密码时才更新中心服务私有明文；客户端永不回显引用或明文。
    const passwordSecretRef = saveSecretValue(
        centerDirectory,
        "proxy-password",
        proxyId,
        input.password ?? "",
        existing?.passwordSecretRef ?? null,
    );
    writeJsonFile(join(centerDirectory, "config", `proxy-${proxyId}.json`), {
        proxyId,
        proxyName: input.proxyName,
        protocol: input.protocol,
        host: input.host,
        port: input.port,
        username: input.username ?? "",
        passwordSecretRef,
        enabled: input.enabled ?? true,
        note: input.note ?? "",
        updatedAt: new Date().toISOString(),
    });
    return {
        proxyId,
        hasAuth: Boolean(input.username || passwordSecretRef),
    };
}

/**
 * listProxyConfigs：读取代理配置列表并隐藏密码摘要。
 *
 * @param centerDirectory 中心目录。
 * @returns 可展示代理配置数组。
 */
function listProxyConfigs(centerDirectory: string): Array<Omit<NetworkProxyConfigFile, "passwordSecretRef"> & {
    hasAuth: boolean;
}> {
    const configDirectory = join(centerDirectory, "config");
    if (!existsSync(configDirectory)) {
        return [];
    }

    return readdirSync(configDirectory)
        .filter((fileName) => {
            return fileName.startsWith("proxy-") && fileName.endsWith(".json");
        })
        .map((fileName) => readJsonFileIfExists<NetworkProxyConfigFile>(join(configDirectory, fileName)))
        .filter((proxy): proxy is NetworkProxyConfigFile => {
            return proxy !== null;
        })
        .map((proxy) => ({
            proxyId: proxy.proxyId,
            proxyName: proxy.proxyName,
            protocol: proxy.protocol,
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            enabled: proxy.enabled,
            updatedAt: proxy.updatedAt,
            hasAuth: Boolean(proxy.username || proxy.passwordSecretRef),
        }));
}

/**
 * readGlobalDefaultProxyId：读取全局默认代理 ID。
 *
 * @param centerDirectory 中心目录。
 * @returns 默认代理 ID；未设置时返回 null。
 */
function readGlobalDefaultProxyId(centerDirectory: string): string | null {
    const config = readJsonFileIfExists<{
        defaultProxyId: string | null
    }>(join(centerDirectory, "config", "proxy-default.json"));
    return config?.defaultProxyId ?? null;
}

/**
 * setGlobalDefaultProxy：保存全局默认代理 ID。
 *
 * @param centerDirectory 中心目录。
 * @param proxyId 代理 ID，null 表示不使用全局默认代理。
 * @returns 保存后的默认代理 ID。
 */
function setGlobalDefaultProxy(centerDirectory: string, proxyId: string | null): {
    defaultProxyId: string | null;
} {
    writeJsonFile(join(centerDirectory, "config", "proxy-default.json"), {
        defaultProxyId: proxyId,
        updatedAt: new Date().toISOString(),
    });
    return {
        defaultProxyId: proxyId,
    };
}

/**
 * deleteProxyConfig：删除代理配置文件并清理默认代理指向。
 *
 * @param centerDirectory 中心目录。
 * @param proxyId 代理 ID。
 * @returns 删除结果。
 */
function deleteProxyConfig(centerDirectory: string, proxyId: string): {
    proxyId: string;
    deleted: boolean;
} {
    const proxyPath = join(centerDirectory, "config", `proxy-${proxyId}.json`);
    if (existsSync(proxyPath)) {
        rmSync(proxyPath, {
            force: true,
        });
    }
    if (readGlobalDefaultProxyId(centerDirectory) === proxyId) {
        setGlobalDefaultProxy(centerDirectory, null);
    }
    return {
        proxyId,
        deleted: true,
    };
}

/**
 * saveRuntimeConfig：保存运行环境配置，同类型默认环境保持唯一。
 *
 * @param centerDirectory 中心目录。
 * @param input 运行环境表单。
 * @returns 运行环境 ID 和默认状态。
 */
function saveRuntimeConfig(
    centerDirectory: string,
    input: {
        runtimeId?: string;
        runtimeName?: string;
        runtimeType?: string;
        executablePath?: string;
        rootPath?: string;
        version?: string;
        environmentVariables?: Record<string, string>;
        pathEntries?: string[];
        isDefault?: boolean;
        enabled?: boolean;
        note?: string;
    },
): {
    runtimeId: string;
    isDefault: boolean;
} {
    const runtimeId = input.runtimeId ?? randomUUID();
    const runtimeDirectory = join(centerDirectory, "runtimes");
    if (input.isDefault && input.runtimeType) {
        clearDefaultRuntimeByType(runtimeDirectory, input.runtimeType, runtimeId);
    }
    writeJsonFile(join(runtimeDirectory, `${runtimeId}.json`), {
        runtimeId,
        runtimeName: input.runtimeName,
        runtimeType: input.runtimeType,
        executablePath: input.executablePath,
        rootPath: input.rootPath,
        version: input.version ?? "",
        environmentVariables: input.environmentVariables ?? {},
        pathEntries: input.pathEntries ?? [],
        isDefault: input.isDefault ?? false,
        enabled: input.enabled ?? true,
        note: input.note ?? "",
        updatedAt: new Date().toISOString(),
    });
    return {
        runtimeId,
        isDefault: input.isDefault ?? false,
    };
}

/**
 * listRuntimeConfigs：读取运行环境配置列表。
 *
 * @param centerDirectory 中心目录。
 * @returns 运行环境配置数组。
 */
function listRuntimeConfigs(centerDirectory: string): RuntimeConfigRecord[] {
    const runtimeDirectory = join(centerDirectory, "runtimes");
    if (!existsSync(runtimeDirectory)) {
        return [];
    }

    return readdirSync(runtimeDirectory)
        .filter((fileName) => {
            return fileName.endsWith(".json");
        })
        .map((fileName) => readJsonFileIfExists<RuntimeConfigRecord>(join(runtimeDirectory, fileName)))
        .filter((runtime): runtime is RuntimeConfigRecord => {
            return runtime !== null;
        });
}

/**
 * deleteRuntimeConfig：删除运行环境配置。
 *
 * @param centerDirectory 中心目录。
 * @param runtimeId 运行环境 ID。
 * @returns 删除结果。
 */
function deleteRuntimeConfig(centerDirectory: string, runtimeId: string): {
    runtimeId: string;
    deleted: boolean;
} {
    rmSync(join(centerDirectory, "runtimes", `${runtimeId}.json`), {
        force: true,
    });
    return {
        runtimeId,
        deleted: true,
    };
}

/**
 * readJsonFileIfExists：读取可选 JSON 文件。
 *
 * @param filePath JSON 文件绝对路径。
 * @returns 文件存在且可解析时返回对象；不存在时返回 null。
 */
function readJsonFileIfExists<TValue>(filePath: string): TValue | null {
    if (!existsSync(filePath)) {
        return null;
    }

    return JSON.parse(readFileSync(filePath, "utf-8")) as TValue;
}

/**
 * clearDefaultRuntimeByType：设置默认环境前清理同类型其他默认项。
 *
 * @param runtimeDirectory 运行环境目录。
 * @param runtimeType 运行环境类型。
 * @param keepRuntimeId 当前保存的运行环境 ID。
 * @returns 没有返回值。
 */
function clearDefaultRuntimeByType(
    runtimeDirectory: string,
    runtimeType: string,
    keepRuntimeId: string,
): void {
    if (!existsSync(runtimeDirectory)) {
        return;
    }

    for (const fileName of readdirSync(runtimeDirectory)) {
        const runtimePath = join(runtimeDirectory, fileName);
        const runtime = readJsonFileIfExists<RuntimeConfigRecord>(runtimePath);
        if (runtime?.runtimeType === runtimeType && runtime.runtimeId !== keepRuntimeId && runtime.isDefault) {
            writeJsonFile(runtimePath, {
                ...runtime,
                isDefault: false,
                updatedAt: new Date().toISOString(),
            });
        }
    }
}

function prepareModelGatewayRequest(
    request: unknown,
    protocolMode: "responses" | "chat-completions" | "messages",
): {
    protocolMode: string;
    request: unknown;
} {
    return {
        protocolMode,
        request,
    };
}

/**
 * classifyModelGatewayError：把模型调用失败阶段归类为统一错误类型。
 *
 * @param failureStage 失败阶段，来源于代理连接、供应商调用或协议解析链路。
 * @param statusCode HTTP 状态码；没有 HTTP 响应时为 null。
 * @param message 原始错误消息，不能包含敏感信息。
 * @returns 统一模型网关错误分类。
 */
function classifyModelGatewayError(
    failureStage: string,
    statusCode: number | null,
    message: string,
): {
    errorKind: string;
    displayMessage: string;
    statusCode: number | null;
    originalMessage: string;
} {
    // normalizedStage: 调用方使用固定阶段名，避免前端自己猜测错误类型。
    const normalizedStage = failureStage.trim().toLowerCase();

    if (normalizedStage === "proxy-connect") {
        return {
            errorKind: "proxy-connect-failed",
            displayMessage: "网络代理连接失败。",
            statusCode,
            originalMessage: message,
        };
    }

    if (normalizedStage === "proxy-auth" || statusCode === 407) {
        return {
            errorKind: "proxy-auth-failed",
            displayMessage: "网络代理认证失败。",
            statusCode,
            originalMessage: message,
        };
    }

    if (normalizedStage === "provider-connect") {
        return {
            errorKind: "provider-connect-failed",
            displayMessage: "供应商连接失败。",
            statusCode,
            originalMessage: message,
        };
    }

    if (normalizedStage === "provider-response") {
        return {
            errorKind: "provider-api-failed",
            displayMessage: "供应商接口返回失败。",
            statusCode,
            originalMessage: message,
        };
    }

    return {
        errorKind: "protocol-parse-failed",
        displayMessage: "模型协议解析失败。",
        statusCode,
        originalMessage: message,
    };
}

/**
 * installPlugin：安装插件清单。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param manifest 插件清单。
 * @returns 插件安装 ID。
 */
function installPlugin(
    database: CenterDatabase,
    events: CenterEventStore,
    manifest: Record<string, unknown>,
): {
    pluginInstallId: string;
} {
    const pluginInstallId = String(manifest.id ?? randomUUID());
    database.connection()
        .prepare("INSERT OR REPLACE INTO plugin_installs (id, source, scope, enabled, manifest_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(
            pluginInstallId,
            String(manifest.source),
            String(manifest.scope),
            1,
            JSON.stringify(manifest),
            new Date().toISOString(),
        );
    events.append({
        eventType: "plugin.installed",
        scopeType: "plugin",
        scopeId: pluginInstallId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "插件安装",
        summary: String(manifest.name ?? pluginInstallId),
        payload: {
            pluginInstallId,
        },
    });

    return {
        pluginInstallId,
    };
}

function setPluginEnabled(
    database: CenterDatabase,
    events: CenterEventStore,
    pluginId: string,
    enabled: boolean,
): {
    pluginId: string;
    enabled: boolean;
} {
    database.connection()
        .prepare("UPDATE plugin_installs SET enabled = ?, updated_at = ? WHERE id = ?")
        .run(
            enabled ? 1 : 0,
            new Date().toISOString(),
            pluginId,
        );
    events.append({
        eventType: enabled ? "plugin.enabled" : "plugin.disabled",
        scopeType: "plugin",
        scopeId: pluginId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: enabled ? "插件启用" : "插件停用",
        summary: pluginId,
        payload: {
            pluginId,
        },
    });
    return {
        pluginId,
        enabled,
    };
}

function configurePlugin(
    database: CenterDatabase,
    events: CenterEventStore,
    pluginId: string,
    config: Record<string, unknown>,
): {
    pluginId: string;
    configured: boolean;
} {
    const row = database.connection()
        .prepare("SELECT manifest_json AS manifestJson FROM plugin_installs WHERE id = ?")
        .get(pluginId) as {
        manifestJson: string;
    } | undefined;
    const manifest = row ? JSON.parse(row.manifestJson) as Record<string, unknown> : {};
    database.connection()
        .prepare("UPDATE plugin_installs SET manifest_json = ?, updated_at = ? WHERE id = ?")
        .run(
            JSON.stringify({
                ...manifest,
                config,
            }),
            new Date().toISOString(),
            pluginId,
        );
    events.append({
        eventType: "plugin.configured",
        scopeType: "plugin",
        scopeId: pluginId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "插件配置",
        summary: pluginId,
        payload: {pluginId}
    });
    return {
        pluginId,
        configured: true,
    };
}

function deletePlugin(
    database: CenterDatabase,
    events: CenterEventStore,
    pluginId: string,
): {
    pluginId: string;
    deleted: boolean;
} {
    const result = database.connection()
        .prepare("DELETE FROM plugin_installs WHERE id = ? AND source <> 'system-builtin'")
        .run(pluginId);
    const deleted = result.changes > 0;
    events.append({
        eventType: deleted ? "plugin.deleted" : "plugin.delete.skipped",
        scopeType: "plugin",
        scopeId: pluginId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: deleted ? "completed" : "cancelled",
        title: deleted ? "插件删除" : "插件删除跳过",
        summary: deleted ? pluginId : "系统内置插件不可卸载。",
        payload: {pluginId, deleted}
    });
    return {
        pluginId,
        deleted,
    };
}

function listPlugins(database: CenterDatabase): unknown[] {
    const rows = database.connection()
        .prepare("SELECT id AS pluginId, source, scope, enabled, manifest_json AS manifestJson, updated_at AS updatedAt FROM plugin_installs ORDER BY updated_at DESC")
        .all() as Array<{
            pluginId: string;
            source: string;
            scope: string;
            enabled: number;
            manifestJson: string;
            updatedAt: string;
        }>;

    return rows.map((row) => {
        const manifest = JSON.parse(row.manifestJson) as {
            projectId?: unknown;
        };

        return {
            ...row,
            // projectId: 项目级插件归属只能来自插件清单中的明确 projectId；没有该字段时不能猜测归属到当前项目。
            projectId: typeof manifest.projectId === "string"
                ? manifest.projectId
                : null,
        };
    });
}

function recordExtensionCall(
    database: CenterDatabase,
    events: CenterEventStore,
    input: {
        extensionId?: string;
        sessionId?: string | null;
        taskId?: string | null;
        status?: string;
        inputSummary?: string;
        outputSummary?: string | null;
    },
): {
    callId: string;
} {
    const callId = randomUUID();
    database.connection()
        .prepare("INSERT INTO extension_call_records (id, extension_id, session_id, task_id, status, input_summary, output_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
            callId,
            input.extensionId,
            input.sessionId ?? null,
            input.taskId ?? null,
            input.status,
            input.inputSummary,
            input.outputSummary ?? null,
            new Date().toISOString(),
        );
    events.append({
        eventType: "extension.called",
        scopeType: "extension",
        scopeId: input.extensionId ?? null,
        sessionId: input.sessionId ?? null,
        turnId: null,
        taskId: input.taskId ?? null,
        status: input.status ?? "completed",
        title: "扩展能力调用",
        summary: input.inputSummary ?? "",
        payload: {
            callId,
        },
    });
    return {
        callId,
    };
}

function saveExtensionJson(
    centerDirectory: string,
    relativePath: string,
    value: Record<string, unknown>,
): {
    relativePath: string;
} {
    writeJsonFile(join(centerDirectory, relativePath), {
        ...value,
        updatedAt: new Date().toISOString(),
    });
    return {
        relativePath,
    };
}

/**
 * listMcpConfigs：扫描中心目录中的 MCP 配置。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 全局和项目级 MCP 配置列表。
 */
function listMcpConfigs(centerDirectory: string): Array<{
    scope: "global" | "project";
    projectId: string | null;
    relativePath: string;
    mcpServers: Record<string, unknown>;
    updatedAt: string | null;
}> {
    const mcpDirectory = join(centerDirectory, "mcp");
    const configs: Array<{
        scope: "global" | "project";
        projectId: string | null;
        relativePath: string;
        mcpServers: Record<string, unknown>;
        updatedAt: string | null;
    }> = [];

    configs.push(readMcpConfigFile(centerDirectory, "mcp/global.json", "global", null));
    if (!existsSync(mcpDirectory)) {
        return configs;
    }

    for (const entry of readdirSync(mcpDirectory, {
        withFileTypes: true,
    })) {
        if (!entry.isFile() || !entry.name.startsWith("project-") || !entry.name.endsWith(".json")) {
            continue;
        }
        // projectId: 文件名协议来自 /api/mcp/save 的 project-{projectId}.json，反向列表时只按同一协议解析。
        const projectId = entry.name.slice("project-".length, -".json".length);
        configs.push(readMcpConfigFile(
            centerDirectory,
            `mcp/${entry.name}`,
            "project",
            projectId,
        ));
    }

    return configs;
}

/**
 * readMcpConfigFile：读取单个 MCP 配置文件。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param relativePath 配置文件相对路径。
 * @param scope 配置作用域。
 * @param projectId 项目 ID，全局配置为 null。
 * @returns MCP 配置展示对象。
 */
function readMcpConfigFile(
    centerDirectory: string,
    relativePath: string,
    scope: "global" | "project",
    projectId: string | null,
): {
    scope: "global" | "project";
    projectId: string | null;
    relativePath: string;
    mcpServers: Record<string, unknown>;
    updatedAt: string | null;
} {
    const filePath = join(centerDirectory, relativePath);
    if (!existsSync(filePath)) {
        return {
            scope,
            projectId,
            relativePath,
            mcpServers: {},
            updatedAt: null,
        };
    }

    const value = JSON.parse(readFileSync(filePath, "utf-8")) as {
        mcpServers?: Record<string, unknown>;
        updatedAt?: string;
    };

    return {
        scope,
        projectId,
        relativePath,
        mcpServers: isRecord(value.mcpServers)
            ? value.mcpServers
            : {},
        updatedAt: typeof value.updatedAt === "string"
            ? value.updatedAt
            : null,
    };
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

function saveSkillContent(
    centerDirectory: string,
    skillName: string,
    content: string,
    projectId: string | null,
): {
    relativePath: string;
} {
    const relativePath = projectId
        ? `skills/project-${projectId}/${skillName}/SKILL.md`
        : `skills/${skillName}/SKILL.md`;
    const filePath = join(centerDirectory, relativePath);
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    appendFileSync(filePath, content, "utf-8");
    return {
        relativePath,
    };
}

/**
 * listInstalledSkills：扫描中心目录中的 skill。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 已安装 skill 列表。
 */
function listInstalledSkills(centerDirectory: string): Array<{
    skillName: string;
    scope: "global" | "project";
    projectId: string | null;
    relativePath: string;
    content: string;
}> {
    const skillsDirectory = join(centerDirectory, "skills");
    if (!existsSync(skillsDirectory)) {
        return [];
    }

    const skills: Array<{
        skillName: string;
        scope: "global" | "project";
        projectId: string | null;
        relativePath: string;
        content: string;
    }> = [];

    for (const entry of readdirSync(skillsDirectory, {
        withFileTypes: true,
    })) {
        if (!entry.isDirectory()) {
            continue;
        }
        if (entry.name.startsWith("project-")) {
            const projectId = entry.name.slice("project-".length);
            collectSkillDirectory(
                centerDirectory,
                join("skills", entry.name),
                "project",
                projectId,
                skills,
            );
            continue;
        }
        collectOneSkill(
            centerDirectory,
            join("skills", entry.name),
            entry.name,
            "global",
            null,
            skills,
        );
    }

    return skills;
}

/**
 * collectSkillDirectory：扫描项目级 skill 目录。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param baseRelativePath 项目级 skill 父目录相对路径。
 * @param scope skill 作用域。
 * @param projectId 项目 ID。
 * @param output 输出数组。
 * @returns 没有返回值。
 */
function collectSkillDirectory(
    centerDirectory: string,
    baseRelativePath: string,
    scope: "project",
    projectId: string,
    output: Array<{
        skillName: string;
        scope: "global" | "project";
        projectId: string | null;
        relativePath: string;
        content: string;
    }>,
): void {
    const directoryPath = join(centerDirectory, baseRelativePath);
    for (const entry of readdirSync(directoryPath, {
        withFileTypes: true,
    })) {
        if (!entry.isDirectory()) {
            continue;
        }
        collectOneSkill(
            centerDirectory,
            join(baseRelativePath, entry.name),
            entry.name,
            scope,
            projectId,
            output,
        );
    }
}

/**
 * collectOneSkill：读取单个 SKILL.md。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param skillRelativeDirectory skill 目录相对路径。
 * @param skillName skill 名称。
 * @param scope skill 作用域。
 * @param projectId 项目 ID，全局为 null。
 * @param output 输出数组。
 * @returns 没有返回值。
 */
function collectOneSkill(
    centerDirectory: string,
    skillRelativeDirectory: string,
    skillName: string,
    scope: "global" | "project",
    projectId: string | null,
    output: Array<{
        skillName: string;
        scope: "global" | "project";
        projectId: string | null;
        relativePath: string;
        content: string;
    }>,
): void {
    const relativePath = join(skillRelativeDirectory, "SKILL.md");
    const filePath = join(centerDirectory, relativePath);
    if (!existsSync(filePath)) {
        return;
    }
    output.push({
        skillName,
        scope,
        projectId,
        relativePath,
        content: readFileSync(filePath, "utf-8"),
    });
}

function createTodo(database: CenterDatabase, events: CenterEventStore, title: string, dueAt: string | null): {
    todoId: string
} {
    const todoId = randomUUID();
    database.connection().prepare("INSERT INTO todos (id, title, completed, due_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(todoId, title, 0, dueAt, new Date().toISOString());
    events.append({
        eventType: "personal.todo.created",
        scopeType: "personal",
        scopeId: todoId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "待办创建",
        summary: title,
        payload: {todoId}
    });
    return {todoId};
}

function createCalendarEvent(database: CenterDatabase, events: CenterEventStore, title: string, startsAt: string, endsAt: string): {
    eventId: string
} {
    const eventId = randomUUID();
    database.connection().prepare("INSERT INTO calendar_events (id, title, starts_at, ends_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(eventId, title, startsAt, endsAt, new Date().toISOString());
    events.append({
        eventType: "personal.calendar.created",
        scopeType: "personal",
        scopeId: eventId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "日程创建",
        summary: title,
        payload: {eventId}
    });
    return {eventId};
}

function createKnowledgeItem(database: CenterDatabase, events: CenterEventStore, title: string, summary: string, sourceRef: string): {
    itemId: string
} {
    const itemId = randomUUID();
    database.connection().prepare("INSERT INTO knowledge_items (id, title, summary, source_ref, updated_at) VALUES (?, ?, ?, ?, ?)").run(itemId, title, summary, sourceRef, new Date().toISOString());
    events.append({
        eventType: "personal.knowledge.created",
        scopeType: "personal",
        scopeId: itemId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "知识条目创建",
        summary,
        payload: {itemId}
    });
    return {itemId};
}

function createNotification(database: CenterDatabase, events: CenterEventStore, realtimeClients: Map<string, RealtimeClientConnection>, targetClientType: ClientType, title: string, summary: string, requiresUserAction: boolean): {
    notificationId: string
} {
    const notificationId = randomUUID();
    database.connection().prepare("INSERT INTO notifications (id, target_client_type, session_id, project_id, title, summary, created_at, requires_user_action) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)").run(notificationId, targetClientType, title, summary, new Date().toISOString(), requiresUserAction ? 1 : 0);
    const event = events.append({
        eventType: "notification.created",
        scopeType: "notification",
        scopeId: notificationId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title,
        summary,
        payload: {notificationId, targetClientType}
    });
    broadcastGlobalEvent(realtimeClients, event);
    return {notificationId};
}

/**
 * createSubAgentRuntime：创建一次性子智能体运行记录。
 *
 * @param events 事件日志仓储。
 * @param subAgents 运行期子智能体表。
 * @param parentAgentId 创建它的长期智能体 ID。
 * @param taskId 所属任务 ID。
 * @param name 子智能体展示名称。
 * @returns 子智能体运行期身份。
 */
function createSubAgentRuntime(
    events: CenterEventStore,
    subAgents: Map<string, SubAgentRuntimeRecord>,
    parentAgentId: string,
    taskId: string,
    name: string,
): {
    subAgentId: string;
    parentAgentId: string;
    taskId: string;
    persistent: false;
    createdAt: string;
} {
    // subAgentId: 使用运行期前缀，避免和长期智能体 Markdown 定义混淆。
    const subAgentId = `sub-${randomUUID()}`;
    // createdAt: 子智能体只存在于当前任务上下文和事件日志。
    const createdAt = new Date().toISOString();
    subAgents.set(subAgentId, {
        subAgentId,
        parentAgentId,
        taskId,
        name,
        createdAt,
    });
    events.append({
        eventType: "subagent.created",
        scopeType: "agent",
        scopeId: subAgentId,
        sessionId: null,
        turnId: null,
        taskId,
        agentId: parentAgentId,
        status: "running",
        title: "子智能体创建",
        summary: name,
        payload: {
            subAgentId,
            parentAgentId,
            persistent: false,
        },
    });

    return {
        subAgentId,
        parentAgentId,
        taskId,
        persistent: false,
        createdAt,
    };
}

/**
 * recordAgentCollaborationEvent：记录智能体协作展示事件。
 *
 * @param events 事件日志仓储。
 * @param taskId 所属任务 ID。
 * @param collaborationKind 协作类型，支持管线通话和群聊讨论。
 * @param title 事件标题。
 * @param summary 事件摘要。
 * @returns 已写入事件的展示信息。
 */
function recordAgentCollaborationEvent(
    events: CenterEventStore,
    taskId: string,
    collaborationKind: "pipeline" | "group-chat",
    title: string,
    summary: string,
): {
    taskId: string;
    collaborationKind: "pipeline" | "group-chat";
    eventType: string;
} {
    // eventType: UI 按固定事件类型展示管线和群聊协作过程。
    const eventType = collaborationKind === "pipeline"
        ? "agent.collaboration.pipeline"
        : "agent.collaboration.group_chat";
    events.append({
        eventType,
        scopeType: "agent-collaboration",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        status: "running",
        title,
        summary,
        payload: {
            collaborationKind,
        },
    });

    return {
        taskId,
        collaborationKind,
        eventType,
    };
}

/**
 * setAgentRuntimeState：保存智能体运行状态并实时广播。
 *
 * @param database 中心服务数据库。
 * @param events 事件日志仓储。
 * @param realtimeClients WebSocket 客户端集合。
 * @param agentId 智能体 ID，来源于中心服务智能体索引。
 * @param status 智能体运行状态，来源于共享协议 AgentRuntimeStatus。
 * @param currentTaskId 当前任务 ID；空值表示智能体没有绑定具体任务。
 * @returns 已保存的智能体运行状态。
 */
function setAgentRuntimeState(
    database: CenterDatabase,
    events: CenterEventStore,
    realtimeClients: Map<string, RealtimeClientConnection>,
    agentId: string,
    status: AgentRuntimeStatus,
    currentTaskId: string | null,
): {
    agentId: string;
    status: AgentRuntimeStatus;
    currentTaskId: string | null;
    updatedAt: string;
} {
    // updatedAt: 服务端状态更新时间，作为多端展示的事实时间。
    const updatedAt = new Date().toISOString();
    database.connection()
        .prepare(`
            INSERT INTO agent_runtime_states (agent_id,
                                              status,
                                              current_task_id,
                                              updated_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(agent_id) DO
            UPDATE SET
                status = excluded.status,
                current_task_id = excluded.current_task_id,
                updated_at = excluded.updated_at
        `)
        .run(
            agentId,
            status,
            currentTaskId,
            updatedAt,
        );

    const event = events.append({
        eventType: "agent.state.changed",
        scopeType: "agent",
        scopeId: agentId,
        sessionId: null,
        turnId: null,
        taskId: currentTaskId,
        agentId,
        status,
        title: "智能体状态变更",
        summary: `智能体 ${agentId} 状态更新为 ${status}。`,
        payload: {
            agentId,
            status,
            currentTaskId,
            updatedAt,
        },
    });
    broadcastGlobalEvent(realtimeClients, event);

    return {
        agentId,
        status,
        currentTaskId,
        updatedAt,
    };
}

function saveExecutionMode(centerDirectory: string, clientType: ClientType, executionMode: string): {
    clientType: ClientType;
    executionMode: string
} {
    writeJsonFile(join(centerDirectory, "config", `execution-mode-${clientType}.json`), {
        clientType,
        executionMode,
        updatedAt: new Date().toISOString(),
    });
    return {clientType, executionMode};
}

function readExecutionMode(centerDirectory: string, clientType: ClientType): ExecutionMode {
    const filePath = join(centerDirectory, "config", `execution-mode-${clientType}.json`);
    if (!existsSync(filePath)) {
        return "full_auto";
    }

    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as {
        executionMode?: ExecutionMode;
    };
    return parsed.executionMode ?? "full_auto";
}

function evaluateApprovalPolicy(
    centerDirectory: string,
    clientType: ClientType,
    operationKind: "read" | "write" | "delete" | "command" | "plugin" | "mcp" | "skill",
): {
    clientType: ClientType;
    executionMode: ExecutionMode;
    operationKind: string;
    requiresApproval: boolean;
    reason: string;
} {
    const executionMode = readExecutionMode(centerDirectory, clientType);
    if (executionMode === "suggest") {
        return {
            clientType,
            executionMode,
            operationKind,
            requiresApproval: true,
            reason: "建议模式下所有副作用步骤都需要用户确认。"
        };
    }

    if (executionMode === "auto_edit") {
        const requiresApproval = operationKind === "delete" || operationKind === "command" || operationKind === "plugin" || operationKind === "mcp";
        return {
            clientType,
            executionMode,
            operationKind,
            requiresApproval,
            reason: requiresApproval ? "自动编辑模式下高风险操作需要审批。" : "自动编辑模式允许低风险读写流程自动执行。"
        };
    }

    return {
        clientType,
        executionMode,
        operationKind,
        requiresApproval: false,
        reason: "全自动模式在沙箱和权限范围内自动执行。"
    };
}

function recordUsage(database: CenterDatabase, events: CenterEventStore, input: {
    providerId?: string;
    model?: string;
    projectId?: string | null;
    sessionId?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheHitTokens?: number | null;
    cacheMissTokens?: number | null;
    status?: string
}): { usageId: string } {
    const usageId = randomUUID();
    database.connection().prepare("INSERT INTO usage_records (id, provider_id, model, project_id, session_id, input_tokens, output_tokens, cache_hit_tokens, cache_miss_tokens, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(usageId, input.providerId, input.model, input.projectId ?? null, input.sessionId ?? null, input.inputTokens ?? null, input.outputTokens ?? null, input.cacheHitTokens ?? null, input.cacheMissTokens ?? null, input.status, new Date().toISOString());
    events.append({
        eventType: "usage.recorded",
        scopeType: "usage",
        scopeId: usageId,
        sessionId: input.sessionId ?? null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "用量记录",
        summary: input.model ?? "",
        payload: {usageId}
    });
    return {usageId};
}

function markWorkerTaskFailed(database: CenterDatabase, events: CenterEventStore, taskId: string, reason: string): {
    taskId: string;
    status: string
} {
    const now = new Date().toISOString();
    database.connection().prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run("failed", now, taskId);
    events.append({
        eventType: "task.failed",
        scopeType: "task",
        scopeId: taskId || null,
        sessionId: null,
        turnId: null,
        taskId: taskId || null,
        status: "failed",
        title: "Worker 任务失败",
        summary: reason,
        payload: {taskId, reason}
    });
    return {taskId, status: "failed"};
}

function startWorkerTask(database: CenterDatabase, events: CenterEventStore, taskId: string): {
    taskId: string;
    status: string;
    heartbeatAt: string
} {
    const now = new Date().toISOString();
    database.connection().prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run("running", now, taskId);
    events.append({
        eventType: "worker.started",
        scopeType: "worker",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        status: "running",
        title: "Worker 启动",
        summary: "中心服务已为任务启动 Worker 生命周期。",
        payload: {taskId, heartbeatAt: now}
    });
    events.append({
        eventType: "task.updated",
        scopeType: "task",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        status: "running",
        title: "任务运行中",
        summary: "Worker 已接管任务。",
        payload: {taskId, status: "running"}
    });
    return {taskId, status: "running", heartbeatAt: now};
}

function cancelWorkerTask(database: CenterDatabase, events: CenterEventStore, taskId: string, reason: string): {
    taskId: string;
    status: string
} {
    const now = new Date().toISOString();
    database.connection().prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run("cancelled", now, taskId);
    events.append({
        eventType: "worker.cancelled",
        scopeType: "worker",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        status: "cancelled",
        title: "Worker 取消",
        summary: reason,
        payload: {taskId, reason}
    });
    return {taskId, status: "cancelled"};
}

function buildWorkerContext(database: CenterDatabase, taskId: string): {
    task: unknown;
    session: unknown;
    project: unknown;
    agents: unknown[];
    memoryIndex: unknown[];
    permissions: string[];
} {
    const task = database.connection().prepare("SELECT id AS taskId, session_id AS sessionId, status, title FROM tasks WHERE id = ?").get(taskId) as {
        sessionId: string
    } | undefined;
    const session = task ? findSession(database, task.sessionId) : null;
    const project = session?.projectId ? findProject(database, session.projectId) : null;
    return {
        task: task ?? null,
        session,
        project,
        agents: listAgents(database),
        memoryIndex: database.connection().prepare("SELECT agent_id AS agentId, keywords, summary, memory_path AS memoryPath FROM memory_index ORDER BY created_at DESC").all(),
        permissions: [
            "file.read",
            "file.write",
            "command.run",
            "plugin.call",
            "mcp.call",
            "skill.use",
            "memory.write",
        ],
    };
}

/**
 * runTurnEngine：执行一轮最小 Agent 编排闭环。
 *
 * @param database 中心服务数据库。
 * @param events 事件日志仓储。
 * @param centerDirectory 中心目录。
 * @param memoryQueues 智能体记忆单写队列。
 * @param sessionId 会话 ID。
 * @param userText 用户输入文本。
 * @returns 执行引擎各分层产物身份。
 */
function runTurnEngine(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    memoryQueues: Map<string, MemoryQueueState>,
    sessionId: string,
    userText: string,
): {
    turnId: string;
    taskId: string;
    agentId: string;
    contextKeys: string[];
    modelEventType: string;
    toolPlanId: string;
    collaborationEventTypes: string[];
    memoryRelativePath: string;
    usageId: string;
} {
    // sent: 复用会话消息发送事实源，保证轮次、任务和事件一致。
    const session = findSession(database, sessionId);
    if (!session) {
        throw new Error("执行引擎无法找到会话");
    }

    const sent = createMessageTurnAndTask(database, events, session, userText);
    // context: context-builder 分层产物，后续执行只消费中心服务返回上下文。
    const context = buildWorkerContext(database, sent.taskId);
    // agentId: agent-router 当前最小策略选择主智能体，后续可替换为多智能体路由。
    const agentId = routeAgentForTurn(context);
    // modelEventType: model-orchestrator 只写内部编排事件，不直连供应商。
    const modelEventType = orchestrateModelCall(events, sent.taskId, agentId, userText);
    // toolPlanId: tool-planner 生成审计可见的工具计划。
    const toolPlanId = planToolCalls(events, sent.taskId, agentId);
    // collaborationEventTypes: collaboration-engine 记录管线通话和群聊讨论事件。
    const collaborationEventTypes = [
        recordAgentCollaborationEvent(events, sent.taskId, "pipeline", "管线协作", "主智能体把阶段结论传给执行步骤。").eventType,
        recordAgentCollaborationEvent(events, sent.taskId, "group-chat", "群聊讨论", "多个智能体协作讨论形成结论。").eventType,
    ];
    // memory: memory-committer 在轮次结束后按单写队列追加主智能体记忆。
    const memory = writeAgentMemory(database, events, centerDirectory, memoryQueues, {
        agentId,
        keywords: "执行引擎",
        summary: "轮次执行编排完成",
        userText,
        assistantText: "执行引擎已完成最小编排闭环。",
    });
    // usageId: usage-collector 写入一条模型用量原始记录。
    const usage = recordUsage(database, events, {
        providerId: "engine-internal",
        model: "engine-orchestrator",
        projectId: null,
        sessionId,
        inputTokens: userText.length,
        outputTokens: 1,
        cacheHitTokens: null,
        cacheMissTokens: null,
        status: "completed",
    });

    handleWorkerMessage(database, events, "task.complete", sent.taskId, {
        agentId,
        toolPlanId,
    });

    return {
        turnId: sent.turnId,
        taskId: sent.taskId,
        agentId,
        contextKeys: Object.keys(context),
        modelEventType,
        toolPlanId,
        collaborationEventTypes,
        memoryRelativePath: memory.relativePath,
        usageId: usage.usageId,
    };
}

/**
 * routeAgentForTurn：选择当前轮次执行智能体。
 *
 * @param context context-builder 产物。
 * @returns 智能体 ID。
 */
function routeAgentForTurn(context: {
    agents: unknown[];
}): string {
    // mainAgent: 当前最小路由策略优先选择系统内置主智能体。
    const mainAgent = context.agents.find((agent) => {
        return typeof agent === "object"
            && agent !== null
            && "agentId" in agent
            && (agent as { agentId?: string }).agentId === "main";
    });
    return mainAgent ? "main" : "main";
}

/**
 * orchestrateModelCall：记录模型编排事件。
 *
 * @param events 事件日志仓储。
 * @param taskId 任务 ID。
 * @param agentId 智能体 ID。
 * @param userText 用户输入。
 * @returns 模型编排事件类型。
 */
function orchestrateModelCall(events: CenterEventStore, taskId: string, agentId: string, userText: string): string {
    const eventType = "model.orchestrated";
    events.append({
        eventType,
        scopeType: "model",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        agentId,
        status: "completed",
        title: "模型编排",
        summary: "已按内部模型协议准备模型调用。",
        payload: {
            requestSummary: userText.slice(0, 120),
        },
    });
    return eventType;
}

/**
 * planToolCalls：生成工具调用计划事件。
 *
 * @param events 事件日志仓储。
 * @param taskId 任务 ID。
 * @param agentId 智能体 ID。
 * @returns 工具计划 ID。
 */
function planToolCalls(events: CenterEventStore, taskId: string, agentId: string): string {
    const toolPlanId = `tool-plan-${randomUUID()}`;
    events.append({
        eventType: "tool.plan.created",
        scopeType: "tool-plan",
        scopeId: toolPlanId,
        sessionId: null,
        turnId: null,
        taskId,
        agentId,
        status: "completed",
        title: "工具计划",
        summary: "已生成需要审批策略评估的工具调用计划。",
        payload: {
            toolPlanId,
            requiredPermissions: [
                "file.read",
                "plugin.call",
                "mcp.call",
            ],
        },
    });
    return toolPlanId;
}

function handleWorkerMessage(
    database: CenterDatabase,
    events: CenterEventStore,
    type: string,
    taskId: string | null,
    payload: unknown,
): {
    type: string;
    accepted: boolean;
} {
    if (type === "task.complete" && taskId) {
        database.connection()
            .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
            .run(
                "completed",
                new Date().toISOString(),
                taskId,
            );
    }

    if (type === "task.failed" && taskId) {
        database.connection()
            .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
            .run(
                "failed",
                new Date().toISOString(),
                taskId,
            );
    }

    events.append({
        eventType: `worker.${type}`,
        scopeType: "worker",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        status: "completed",
        title: "Worker 消息",
        summary: type,
        payload,
    });

    return {
        type,
        accepted: true,
    };
}

function queryAuditEvents(database: CenterDatabase, eventType: string | null): EventRecord[] {
    const rows = eventType
        ? database.connection().prepare("SELECT id AS eventId, event_type AS eventType, turn_id AS turnId, task_id AS taskId, sequence, occurred_at AS occurredAt, summary, payload_json AS payloadJson, trace_id AS traceId FROM events WHERE event_type = ? ORDER BY occurred_at ASC").all(eventType)
        : database.connection().prepare("SELECT id AS eventId, event_type AS eventType, turn_id AS turnId, task_id AS taskId, sequence, occurred_at AS occurredAt, summary, payload_json AS payloadJson, trace_id AS traceId FROM events ORDER BY occurred_at ASC").all();
    return (rows as Array<{
        eventId: string;
        eventType: string;
        turnId: string | null;
        taskId: string | null;
        sequence: number;
        occurredAt: string;
        summary: string;
        payloadJson: string;
        traceId: string
    }>).map((row) => ({
        eventId: row.eventId,
        eventType: row.eventType,
        turnId: row.turnId,
        taskId: row.taskId,
        sequence: row.sequence,
        occurredAt: row.occurredAt,
        summary: row.summary,
        payload: JSON.parse(row.payloadJson),
        traceId: row.traceId
    }));
}

/**
 * UsageQueryFilters：用量查询筛选条件。
 *
 * 来源：用量统计页面和中心服务接口。
 * 含义：按供应商、模型、项目/会话和时间范围筛选原始或聚合用量。
 * 格式：JSON 对象，空值表示不筛选该维度。
 * 默认值：全部 null。
 * 约束：SQLite 用量表使用明确字段 session_id，服务端必须让会话筛选真实生效。
 */
interface UsageQueryFilters {
    /**
     * providerId: 供应商 ID。
     */
    providerId: string | null;

    /**
     * model: 模型名称。
     */
    model: string | null;

    /**
     * projectId: 项目 ID；null 表示不限制项目。
     */
    projectId: string | null;

    /**
     * sessionId: 会话 ID；对应 SQLite usage_records.session_id。
     */
    sessionId: string | null;

    /**
     * startedAt: 开始时间 ISO 字符串。
     */
    startedAt: string | null;

    /**
     * endedAt: 结束时间 ISO 字符串。
     */
    endedAt: string | null;
}

/**
 * queryUsageRecords：按明确筛选条件查询用量原始记录。
 *
 * @param database 中心服务数据库。
 * @param filters 用量筛选条件。
 * @returns 用量原始记录数组。
 */
function queryUsageRecords(database: CenterDatabase, filters: UsageQueryFilters): unknown[] {
    const whereParts: string[] = [];
    const params: Array<string> = [];
    appendUsageWhereClause(whereParts, params, filters);
    const whereSql = whereParts.length > 0
        ? ` WHERE ${whereParts.join(" AND ")}`
        : "";
    return database.connection()
        .prepare(`SELECT *
                  FROM usage_records${whereSql}
                  ORDER BY created_at ASC`)
        .all(...params);
}

/**
 * aggregateUsageRecords：按筛选条件聚合 token 和调用次数。
 *
 * @param database 中心服务数据库。
 * @param filters 用量筛选条件。
 * @returns 聚合统计数组。
 */
function aggregateUsageRecords(database: CenterDatabase, filters: UsageQueryFilters): unknown[] {
    const whereParts: string[] = [];
    const params: Array<string> = [];
    appendUsageWhereClause(whereParts, params, filters);
    const whereSql = whereParts.length > 0
        ? ` WHERE ${whereParts.join(" AND ")}`
        : "";
    return database.connection()
        .prepare(`
            SELECT provider_id                                                 AS providerId,
                   model,
                   project_id                                                  AS projectId,
                   SUM(COALESCE(input_tokens, 0))                              AS inputTokens,
                   SUM(COALESCE(output_tokens, 0))                             AS outputTokens,
                   SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS totalTokens,
                   SUM(COALESCE(cache_hit_tokens, 0))                          AS cacheHitTokens,
                   SUM(COALESCE(cache_miss_tokens, 0))                         AS cacheMissTokens,
                   COUNT(*)                                                    AS callCount,
                   SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)       AS successCount,
                   SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)          AS failureCount,
                   MIN(created_at)                                             AS startedAt,
                   MAX(created_at)                                             AS endedAt
            FROM usage_records${whereSql}
            GROUP BY provider_id, model, project_id
            ORDER BY provider_id ASC, model ASC
        `)
        .all(...params);
}

/**
 * appendUsageWhereClause：根据筛选条件追加 SQL 条件。
 *
 * @param whereParts SQL WHERE 片段数组。
 * @param params SQL 参数数组。
 * @param filters 用量筛选条件。
 * @returns 没有返回值。
 */
function appendUsageWhereClause(
    whereParts: string[],
    params: Array<string>,
    filters: UsageQueryFilters,
): void {
    if (filters.providerId !== null) {
        whereParts.push("provider_id = ?");
        params.push(filters.providerId);
    }
    if (filters.model !== null) {
        whereParts.push("model = ?");
        params.push(filters.model);
    }
    if (filters.projectId !== null) {
        whereParts.push("project_id = ?");
        params.push(filters.projectId);
    }
    if (filters.sessionId !== null) {
        whereParts.push("session_id = ?");
        params.push(filters.sessionId);
    }
    if (filters.startedAt !== null) {
        whereParts.push("created_at >= ?");
        params.push(filters.startedAt);
    }
    if (filters.endedAt !== null) {
        whereParts.push("created_at <= ?");
        params.push(filters.endedAt);
    }
}

function refreshUsageDailyStats(database: CenterDatabase): unknown[] {
    const rows = database.connection()
        .prepare(`
            SELECT provider_id                     AS providerId,
                   model,
                   project_id                      AS projectId,
                   substr(created_at, 1, 10)       AS statDate,
                   SUM(COALESCE(input_tokens, 0))  AS inputTokens,
                   SUM(COALESCE(output_tokens, 0)) AS outputTokens,
                   COUNT(*)                        AS callCount
            FROM usage_records
            GROUP BY provider_id, model, project_id, substr(created_at, 1, 10)
        `)
        .all() as Array<{
        providerId: string;
        model: string;
        projectId: string | null;
        statDate: string;
        inputTokens: number;
        outputTokens: number;
        callCount: number;
    }>;

    for (const row of rows) {
        const id = `${row.statDate}:${row.providerId}:${row.model}:${row.projectId ?? "global"}`;
        database.connection()
            .prepare("INSERT OR REPLACE INTO usage_daily_stats (id, stat_date, provider_id, model, project_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(
                id,
                row.statDate,
                row.providerId,
                row.model,
                row.projectId,
                JSON.stringify(row),
                new Date().toISOString(),
            );
    }

    return rows;
}

function saveNotificationConfig(
    centerDirectory: string,
    input: {
        clientType?: ClientType;
        enabled?: boolean;
        notifyOnFailure?: boolean;
        notifyOnWaitingUser?: boolean;
        systemPermission?: string;
    },
): {
    clientType: ClientType | undefined;
    enabled: boolean;
} {
    writeJsonFile(join(centerDirectory, "config", `notification-${input.clientType}.json`), {
        clientType: input.clientType,
        enabled: input.enabled ?? true,
        notifyOnFailure: input.notifyOnFailure ?? true,
        notifyOnWaitingUser: input.notifyOnWaitingUser ?? true,
        systemPermission: input.systemPermission ?? "unknown",
        updatedAt: new Date().toISOString(),
    });
    return {
        clientType: input.clientType,
        enabled: input.enabled ?? true,
    };
}

/**
 * createTemporaryAttachment：创建临时附件占位文件。
 *
 * @param centerDirectory 中心目录。
 * @param fileName 原始文件名。
 * @param mimeType MIME 类型。
 * @param sizeBytes 文件大小。
 * @returns 临时附件元数据。
 */
function createTemporaryAttachment(
    centerDirectory: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
): {
    temporaryAttachmentId: string;
    storageFileName: string;
    relativePath: string;
} {
    const temporaryAttachmentId = randomUUID();
    const storageFileName = `${temporaryAttachmentId}.tmp`;
    const relativePath = `temp/${storageFileName}`;
    const filePath = join(centerDirectory, relativePath);
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    appendFileSync(filePath, JSON.stringify({
        fileName,
        mimeType,
        sizeBytes,
    }), "utf-8");
    return {
        temporaryAttachmentId,
        storageFileName,
        relativePath,
    };
}

/**
 * commitAttachment：把临时附件转为正式会话附件记录。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param input 正式附件参数。
 * @returns 正式附件 ID。
 */
function commitAttachment(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    input: {
        sessionId?: string;
        messageId?: string;
        temporaryAttachmentId?: string;
        fileName?: string;
        mimeType?: string;
        sizeBytes?: number;
    },
): {
    attachmentId: string;
    relativePath: string;
} {
    const attachmentId = randomUUID();
    const storageFileName = `${attachmentId}.attachment`;
    const relativePath = `sessions/attachments/${storageFileName}`;
    const filePath = join(centerDirectory, relativePath);
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    appendFileSync(filePath, JSON.stringify({
        temporaryAttachmentId: input.temporaryAttachmentId,
        fileName: input.fileName,
    }), "utf-8");
    database.connection()
        .prepare("INSERT INTO attachments (id, session_id, message_id, file_name, mime_type, size_bytes, relative_path) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
            attachmentId,
            input.sessionId,
            input.messageId,
            input.fileName,
            input.mimeType,
            input.sizeBytes,
            relativePath,
        );
    events.append({
        eventType: "attachment.committed",
        scopeType: "attachment",
        scopeId: attachmentId,
        sessionId: input.sessionId ?? null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "附件转正",
        summary: input.fileName ?? attachmentId,
        payload: {
            attachmentId,
            temporaryAttachmentId: input.temporaryAttachmentId,
        },
    });

    return {
        attachmentId,
        relativePath,
    };
}

function writeJsonFile(filePath: string, value: Record<string, unknown>): void {
    mkdirSync(dirname(filePath), {recursive: true});
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function writeFileSyncUtf8IfMissing(filePath: string, value: string): void {
    if (existsSync(filePath)) {
        return;
    }
    appendFileSync(filePath, value, "utf-8");
}

/**
 * writeFileSyncUtf8：覆盖写入 UTF-8 文本文件。
 *
 * @param filePath 文件绝对路径。
 * @param value 文件内容。
 * @returns 没有返回值。
 */
function writeFileSyncUtf8(filePath: string, value: string): void {
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    if (existsSync(filePath)) {
        rmSync(filePath);
    }
    writeFileSync(filePath, value, "utf-8");
}

/**
 * deriveProjectDisplayNameFromPath：从项目最近路径派生项目显示名。
 *
 * @param latestPath 项目登记传入的当前项目根目录路径。
 * @returns 路径最后一级目录名；路径为空、只有分隔符或无法派生时返回空字符串。
 */
function deriveProjectDisplayNameFromPath(latestPath: string): string {
    // normalizedPath: 去掉首尾空白和末尾路径分隔符，确保 `C:\项目\对话测试\` 能派生出 `对话测试`。
    const normalizedPath = latestPath.trim().replace(/[\\/]+$/u, "");
    if (normalizedPath.length === 0) {
        return "";
    }

    // pathParts: 同时支持 Windows 反斜杠和 POSIX 正斜杠；只取最后一级目录满足项目文件夹名需求。
    const pathParts = normalizedPath.split(/[\\/]/u);
    return pathParts[pathParts.length - 1]?.trim() ?? "";
}

/**
 * createSuccessResponse：创建统一成功响应包。
 *
 * @param data 成功业务数据。
 * @returns API 统一响应包。
 */
function createSuccessResponse<TData>(data: TData): ApiResponse<TData> {
    return {
        success: true,
        data,
        error: null,
    };
}

/**
 * createErrorResponse：创建统一错误响应包。
 *
 * @param code 机器可读错误码。
 * @param message 开发排查消息。
 * @param displayMessage 用户可展示消息。
 * @param traceId 可选排查 ID，未传入时自动生成。
 * @returns API 统一错误响应包。
 */
function createErrorResponse(
    code: string,
    message: string,
    displayMessage: string,
    traceId = randomUUID(),
): ApiResponse<null> {
    const error: ApiError = {
        code,
        message,
        displayMessage,
        traceId,
    };

    return {
        success: false,
        data: null,
        error,
    };
}

/**
 * runFromCli：作为命令行入口启动中心服务。
 *
 * @returns 进程退出前保持监听。
 */
async function runFromCli(): Promise<void> {
    const config = readCenterServiceConfig();
    const service = await createCenterService(config);
    const listenResult = await service.listen();
    const logger = new CenterLogger(config.centerDirectory);
    if (listenResult.reusedExisting) {
        await logger.info("center.server.reused-existing", {
            port: config.port,
            centerDirectory: config.centerDirectory,
        });
        process.stdout.write(`中心服务已在运行，复用端口 ${config.port}。\n`);
        await service.close();
        return;
    }

    await logger.info("center.server.listening", {
        port: config.port,
    });

    const shutdown = async (): Promise<void> => {
        await service.close();
        process.exit(0);
    };

    process.once("SIGINT", () => {
        void shutdown();
    });
    process.once("SIGTERM", () => {
        void shutdown();
    });
}

// currentFilePath: 当前模块真实路径，用于判断是否由 tsx 直接执行。
const currentFilePath = fileURLToPath(import.meta.url);
// entryFilePath: 进程入口路径，可能不存在于测试注入场景。
const entryFilePath = process.argv[1] ? resolve(process.argv[1]) : "";

if (entryFilePath === currentFilePath) {
    void runFromCli().catch((error) => {
        // stderr: 直接写标准错误，避免中心服务启动早期日志依赖尚未准备好。
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}
