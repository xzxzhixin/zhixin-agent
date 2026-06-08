import {spawn} from "node:child_process";
import type {ChildProcessWithoutNullStreams} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

import type {
    UnifiedToolCallIntent,
    UnifiedToolCapability,
} from "@zhixin/shared";

import type {CenterEventStore} from "./events.js";
import type {OpenAiToolSpec} from "./openai-chat-protocol.js";
import {resolveUnifiedToolCapability} from "./tool-runtime.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
} from "./turn-graph-domain.js";

/**
 * McpToolRequest：MCP 工具调用请求。
 *
 * 来源：模型工具调用闭环。
 * 含义：中心服务按已保存的 MCP 配置连接指定 Server 并调用工具。
 * 格式：serverId、toolName 和 arguments。
 * 默认值：无。
 * 约束：只能调用中心目录 MCP 配置中明确存在的 Server。
 */
export interface McpToolRequest {
    /** toolCallId: 模型工具调用 ID，用于 UI 聚合同一次 MCP 调用；非模型触发时为 null。 */
    toolCallId?: string | null;
    /** transportType: MCP 传输类型；运行时读取配置后补齐。 */
    transportType?: "http" | "stdio" | null;
    /** serverId: MCP Server ID，来源于 mcp/global.json 或项目级 MCP 配置。 */
    serverId: string;
    /** toolName: MCP Server 暴露的工具名称。 */
    toolName: string;
    /** arguments: MCP 工具参数对象。 */
    arguments: Record<string, unknown>;
    /** inputSummary: MCP 调用用途摘要。 */
    inputSummary: string;
}

/**
 * McpToolResult：MCP 工具调用结果。
 *
 * 来源：MCP Server 的 tools/call 返回。
 * 含义：供模型回填和对话过程卡片展示。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：只返回文本摘要，不在事件中保存敏感认证信息。
 */
export interface McpToolResult {
    /** toolKind: 固定 MCP 工具类型。 */
    toolKind: "mcp";
    /** serverId: MCP Server ID。 */
    serverId: string;
    /** toolName: MCP 工具名称。 */
    toolName: string;
    /** status: MCP 调用状态。 */
    status: "completed" | "failed";
    /** outputSummary: MCP 工具输出摘要。 */
    outputSummary: string;
    /** failureReason: 失败原因，成功时为 null。 */
    failureReason: string | null;
    /** traceId: 完成或失败事件排查 ID。 */
    traceId: string;
}

/**
 * mcpRequestFromUnifiedToolIntent：把统一工具意图转换为 MCP 调用请求。
 *
 * @param intent 统一工具调用意图。
 * @returns MCP 工具请求。
 */
export function mcpRequestFromUnifiedToolIntent(intent: UnifiedToolCallIntent): McpToolRequest {
    const serverId = typeof intent.arguments.serverId === "string"
        ? intent.arguments.serverId
        : "";
    const toolName = typeof intent.arguments.toolName === "string"
        ? intent.arguments.toolName
        : "";
    const toolArguments = isRecord(intent.arguments.arguments)
        ? intent.arguments.arguments
        : {};
    return {
        serverId,
        toolName,
        arguments: toolArguments,
        inputSummary: intent.inputSummary,
    };
}

/**
 * runMcpTool：通过中心服务保存的 MCP 配置调用远端 MCP Server。
 *
 * @param events 事件日志仓储。
 * @param centerDirectory 中心目录绝对路径。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param request MCP 调用请求。
 * @param graphCheckpoint 对话图节点检查点。
 * @returns MCP 工具输出摘要。
 */
export async function runMcpTool(
    events: CenterEventStore,
    centerDirectory: string,
    sessionId: string,
    taskId: string,
    turnId: string,
    request: McpToolRequest,
    graphCheckpoint?: TurnGraphCheckpoint,
): Promise<McpToolResult> {
    const capability = resolveUnifiedToolCapability("builtin.mcp.call");
    const serverConfig = readMcpServerConfig(centerDirectory, request.serverId);
    request.transportType = serverConfig.type;
    events.append({
        eventType: "tool.mcp.started",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "running",
        title: "MCP 调用开始",
        summary: request.inputSummary,
        payload: withOptionalGraphCheckpoint({
            toolId: capability?.toolId ?? "builtin.mcp.call",
            toolKind: "mcp",
            transportType: serverConfig.type,
            toolCallId: request.toolCallId ?? null,
            requiredPermission: capability?.requiredPermission ?? "mcp.call",
            serverId: request.serverId,
            toolName: request.toolName,
            inputSummary: request.inputSummary,
        }, graphCheckpoint),
    });

    try {
        const outputSummary = await callMcpTool(
            serverConfig,
            request.toolName,
            request.arguments,
        );
        return appendMcpToolResult(
            events,
            capability,
            request,
            sessionId,
            taskId,
            turnId,
            "completed",
            outputSummary,
            null,
            graphCheckpoint,
        );
    } catch (error) {
        const failureReason = error instanceof Error ? error.message : "MCP_TOOL_CALL_FAILED";
        return appendMcpToolResult(
            events,
            capability,
            request,
            sessionId,
            taskId,
            turnId,
            "failed",
            "",
            failureReason,
            graphCheckpoint,
        );
    }
}

interface HttpMcpServerConfig {
    /** serverId: MCP Server ID，来源于 mcpServers 对象 key。 */
    serverId: string;
    /** type: MCP HTTP Streamable transport。 */
    type: "http";
    /** url: MCP HTTP Streamable endpoint。 */
    url: string;
}

interface StdioMcpServerConfig {
    /** serverId: MCP Server ID，来源于 mcpServers 对象 key。 */
    serverId: string;
    /** type: MCP stdio transport。 */
    type: "stdio";
    /** command: 启动 MCP Server 的可执行命令。 */
    command: string;
    /** args: 启动 MCP Server 的参数数组。 */
    args: string[];
    /** env: 追加环境变量；事件中不得泄露具体值。 */
    env: Record<string, string>;
    /** cwd: MCP Server 工作目录；未配置时继承中心服务工作目录。 */
    cwd: string | null;
}

type McpServerConfig = HttpMcpServerConfig | StdioMcpServerConfig;

interface JsonRpcResponse {
    /** id: JSON-RPC 请求 ID。 */
    id?: string | number | null;
    /** result: JSON-RPC 成功结果。 */
    result?: unknown;
    /** error: JSON-RPC 错误对象。 */
    error?: {
        /** code: MCP Server 返回的错误码。 */
        code?: number;
        /** message: MCP Server 返回的错误消息。 */
        message?: string;
    };
}

/**
 * listConfiguredMcpModelToolSpecs：把已配置 MCP Server 暴露的工具转换成模型工具定义。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 可供模型直接选择的 MCP 动态工具列表。
 */
export async function listConfiguredMcpModelToolSpecs(centerDirectory: string): Promise<OpenAiToolSpec[]> {
    const specs: OpenAiToolSpec[] = [];
    for (const serverConfig of readAllMcpServerConfigs(centerDirectory)) {
        const tools = await listMcpTools(serverConfig).catch(() => {
            // catch: MCP Server 不可达时不阻断模型调用，静态 builtin.mcp.call 仍可返回失败事件。
            return [];
        });
        for (const tool of tools) {
            specs.push({
                name: toDynamicMcpModelToolName(
                    serverConfig.serverId,
                    tool.name,
                ),
                sourceToolId: "builtin.mcp.call",
                description: `调用 MCP Server ${serverConfig.serverId} 的 ${tool.name} 工具。${tool.description}`,
                parametersJsonSchema: tool.inputSchema,
            });
        }
    }
    return specs;
}

/**
 * listConfiguredMcpToolViews：读取已配置 MCP Server 暴露的工具，供管理页展示。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 已发现工具列表；单个 Server 失败时返回一条错误行。
 */
export async function listConfiguredMcpToolViews(centerDirectory: string): Promise<Array<{
    serverId: string;
    transportType: "http" | "stdio";
    toolName: string;
    description: string;
    inputSchema: Record<string, unknown>;
    errorMessage: string | null;
}>> {
    const rows: Array<{
        serverId: string;
        transportType: "http" | "stdio";
        toolName: string;
        description: string;
        inputSchema: Record<string, unknown>;
        errorMessage: string | null;
    }> = [];
    for (const serverConfig of readAllMcpServerConfigs(centerDirectory)) {
        try {
            const tools = await listMcpTools(serverConfig);
            for (const tool of tools) {
                rows.push({
                    serverId: serverConfig.serverId,
                    transportType: serverConfig.type,
                    toolName: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    errorMessage: null,
                });
            }
        } catch (error) {
            rows.push({
                serverId: serverConfig.serverId,
                transportType: serverConfig.type,
                toolName: "",
                description: "",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
                errorMessage: error instanceof Error ? error.message.slice(0, 500) : "MCP_TOOLS_LIST_FAILED",
            });
        }
    }
    return rows;
}

/**
 * listConfiguredMcpToolViewsByServer：按单个 MCP Server 读取工具列表。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param serverId MCP Server ID，来源于 mcpServers 对象 key。
 * @returns 当前 Server 的工具列表；失败时返回一条错误行用于 UI 展示。
 */
export async function listConfiguredMcpToolViewsByServer(
    centerDirectory: string,
    serverId: string,
): Promise<Array<{
    serverId: string;
    transportType: "http" | "stdio";
    toolName: string;
    description: string;
    inputSchema: Record<string, unknown>;
    errorMessage: string | null;
}>> {
    const serverConfig = readMcpServerConfig(
        centerDirectory,
        serverId,
    );
    try {
        const tools = await listMcpTools(serverConfig);
        return tools.map((tool) => ({
            serverId: serverConfig.serverId,
            transportType: serverConfig.type,
            toolName: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            errorMessage: null,
        }));
    } catch (error) {
        // errorMessage: 管理页按需查看工具时要能看到失败原因，但不能让单个 Server 失败导致整页不可用。
        return [
            {
                serverId: serverConfig.serverId,
                transportType: serverConfig.type,
                toolName: "",
                description: "",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
                errorMessage: error instanceof Error ? error.message.slice(0, 500) : "MCP_TOOLS_LIST_FAILED",
            },
        ];
    }
}

/**
 * listMcpToolViewsForServerConfig：从单个 mcpServers 条目读取工具列表。
 *
 * @param serverId MCP Server ID，来源于当前配置文件的 mcpServers key。
 * @param rawConfig 当前 Server 原始配置对象。
 * @returns 当前 Server 的工具列表；失败或配置无效时返回错误展示行。
 */
export async function listMcpToolViewsForServerConfig(
    serverId: string,
    rawConfig: unknown,
): Promise<Array<{
    serverId: string;
    transportType: "http" | "stdio";
    toolName: string;
    description: string;
    inputSchema: Record<string, unknown>;
    errorMessage: string | null;
}>> {
    const serverConfig = readMcpServerConfigFromValue(
        serverId,
        rawConfig,
    );
    if (!serverConfig) {
        return [
            {
                serverId,
                transportType: "http",
                toolName: "",
                description: "",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
                errorMessage: "MCP_SERVER_CONFIG_INVALID",
            },
        ];
    }

    try {
        const tools = await listMcpTools(serverConfig);
        return tools.map((tool) => ({
            serverId: serverConfig.serverId,
            transportType: serverConfig.type,
            toolName: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            errorMessage: null,
        }));
    } catch (error) {
        // errorMessage: 按需加载只影响当前行，错误返回给 UI 展示，不中断整个 MCP 页面。
        return [
            {
                serverId: serverConfig.serverId,
                transportType: serverConfig.type,
                toolName: "",
                description: "",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
                errorMessage: error instanceof Error ? error.message.slice(0, 500) : "MCP_TOOLS_LIST_FAILED",
            },
        ];
    }
}

/**
 * readMcpDynamicToolName：把动态 MCP 模型工具名解码为 serverId 和 toolName。
 *
 * @param modelToolName 模型返回的工具名。
 * @returns 动态 MCP 工具定位；不是动态 MCP 工具时返回 null。
 */
export function readMcpDynamicToolName(modelToolName: string): {
    serverId: string;
    toolName: string;
} | null {
    if (!modelToolName.startsWith("mcp_")) {
        return null;
    }
    const parts = modelToolName.split("_");
    if (parts.length !== 3 || !parts[1] || !parts[2]) {
        return null;
    }
    return {
        serverId: decodeHexUtf8(parts[1]),
        toolName: decodeHexUtf8(parts[2]),
    };
}

/**
 * toDynamicMcpModelToolName：把 MCP Server 和工具名编码成模型协议安全名称。
 *
 * @param serverId MCP Server ID。
 * @param toolName MCP 工具名。
 * @returns 只包含字母、数字和下划线的模型工具名。
 */
function toDynamicMcpModelToolName(
    serverId: string,
    toolName: string,
): string {
    return `mcp_${encodeHexUtf8(serverId)}_${encodeHexUtf8(toolName)}`;
}

/**
 * encodeHexUtf8：把任意 UTF-8 文本编码为工具名安全 hex。
 *
 * @param value 原始文本。
 * @returns 十六进制文本。
 */
function encodeHexUtf8(value: string): string {
    return Buffer.from(value, "utf-8").toString("hex");
}

/**
 * decodeHexUtf8：把工具名中的 hex 还原为 UTF-8 文本。
 *
 * @param value 十六进制文本。
 * @returns 还原后的文本。
 */
function decodeHexUtf8(value: string): string {
    return Buffer.from(value, "hex").toString("utf-8");
}

/**
 * readAllMcpServerConfigs：读取全局 MCP 配置中的 HTTP Server。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 可执行 MCP Server 配置列表。
 */
function readAllMcpServerConfigs(centerDirectory: string): McpServerConfig[] {
    const globalConfig = readMcpConfigJson(join(centerDirectory, "mcp", "global.json"));
    const servers = isRecord(globalConfig.mcpServers)
        ? globalConfig.mcpServers
        : {};
    return Object.entries(servers)
        .map(([serverId, rawConfig]) => readMcpServerConfigFromValue(serverId, rawConfig))
        .filter((config): config is McpServerConfig => config !== null);
}

/**
 * readMcpServerConfig：按 Server ID 读取单个 MCP HTTP 配置。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param serverId MCP Server ID。
 * @returns MCP Server 配置。
 */
function readMcpServerConfig(
    centerDirectory: string,
    serverId: string,
): McpServerConfig {
    const config = readAllMcpServerConfigs(centerDirectory).find((item) => item.serverId === serverId);
    if (!config) {
        throw new Error(`MCP_SERVER_NOT_CONFIGURED:${serverId}`);
    }
    return config;
}

/**
 * readMcpConfigJson：读取 MCP JSON 配置文件。
 *
 * @param filePath 配置文件绝对路径。
 * @returns 配置对象；不存在时返回空对象。
 */
function readMcpConfigJson(filePath: string): Record<string, unknown> {
    if (!existsSync(filePath)) {
        return {};
    }
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    return isRecord(parsed) ? parsed : {};
}

/**
 * readMcpServerConfigFromValue：从 mcpServers 条目解析 HTTP MCP 配置。
 *
 * @param serverId MCP Server ID。
 * @param rawConfig 原始配置对象。
 * @returns 可执行配置；不支持时返回 null。
 */
function readMcpServerConfigFromValue(
    serverId: string,
    rawConfig: unknown,
): McpServerConfig | null {
    if (!isRecord(rawConfig)) {
        return null;
    }
    const type = typeof rawConfig.type === "string" ? rawConfig.type : "";
    if (type === "http") {
        const url = typeof rawConfig.url === "string" ? rawConfig.url : "";
        if (!url) {
            return null;
        }
        return {
            serverId,
            type,
            url,
        };
    }
    if (type === "stdio") {
        const command = typeof rawConfig.command === "string" ? rawConfig.command : "";
        if (!command) {
            return null;
        }
        return {
            serverId,
            type,
            command,
            args: Array.isArray(rawConfig.args)
                ? rawConfig.args.map((arg) => String(arg))
                : [],
            env: isRecord(rawConfig.env)
                ? Object.fromEntries(Object.entries(rawConfig.env).map(([key, value]) => [
                    key,
                    String(value),
                ]))
                : {},
            cwd: typeof rawConfig.cwd === "string" && rawConfig.cwd.length > 0
                ? rawConfig.cwd
                : null,
        };
    }
    return null;
}

/**
 * listMcpTools：按 MCP transport 分发工具发现请求。
 *
 * @param serverConfig MCP Server 配置。
 * @returns 工具定义列表。
 */
async function listMcpTools(serverConfig: McpServerConfig): Promise<Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}>> {
    if (serverConfig.type === "http") {
        return listHttpMcpTools(serverConfig);
    }
    return listStdioMcpTools(serverConfig);
}

/**
 * callMcpTool：按 MCP transport 分发工具调用请求。
 *
 * @param serverConfig MCP Server 配置。
 * @param toolName MCP 工具名。
 * @param toolArguments MCP 工具参数。
 * @returns 工具输出摘要。
 */
async function callMcpTool(
    serverConfig: McpServerConfig,
    toolName: string,
    toolArguments: Record<string, unknown>,
): Promise<string> {
    if (serverConfig.type === "http") {
        return callHttpMcpTool(
            serverConfig,
            toolName,
            toolArguments,
        );
    }
    return callStdioMcpTool(
        serverConfig,
        toolName,
        toolArguments,
    );
}

/**
 * normalizeMcpToolsResult：把 tools/list result 转换为内部工具定义。
 *
 * @param result MCP tools/list result。
 * @returns 规范化后的工具定义列表。
 */
function normalizeMcpToolsResult(result: unknown): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}> {
    const tools = isRecord(result) && Array.isArray(result.tools)
        ? result.tools
        : [];
    return tools.map((tool) => {
        if (!isRecord(tool) || typeof tool.name !== "string") {
            return null;
        }
        return {
            name: tool.name,
            description: typeof tool.description === "string" ? tool.description : "",
            inputSchema: isRecord(tool.inputSchema)
                ? tool.inputSchema
                : {
                    type: "object",
                    properties: {},
                },
        };
    }).filter((tool): tool is {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
    } => tool !== null);
}

/**
 * listStdioMcpTools：通过 stdio MCP tools/list 读取 Server 工具清单。
 *
 * @param serverConfig stdio MCP Server 配置。
 * @returns 工具定义列表。
 */
async function listStdioMcpTools(serverConfig: StdioMcpServerConfig): Promise<Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}>> {
    return withStdioMcpSession(serverConfig, async (session) => {
        await session.initialize();
        const result = await session.request(
            "tools/list",
            {},
        );
        return normalizeMcpToolsResult(result);
    });
}

/**
 * callStdioMcpTool：通过 stdio MCP tools/call 执行指定工具。
 *
 * @param serverConfig stdio MCP Server 配置。
 * @param toolName MCP 工具名。
 * @param toolArguments MCP 工具参数。
 * @returns 工具输出摘要。
 */
async function callStdioMcpTool(
    serverConfig: StdioMcpServerConfig,
    toolName: string,
    toolArguments: Record<string, unknown>,
): Promise<string> {
    return withStdioMcpSession(serverConfig, async (session) => {
        await session.initialize();
        const result = await session.request(
            "tools/call",
            {
                name: toolName,
                arguments: toolArguments,
            },
        );
        return summarizeMcpToolResult(result);
    });
}

class StdioMcpSession {
    /** child: 当前 stdio MCP Server 子进程。 */
    private readonly child: ChildProcessWithoutNullStreams;
    /** buffer: stdout 累积缓冲，用于解析换行 JSON 或 Content-Length 帧。 */
    private buffer = "";
    /** stderrChunks: 子进程 stderr 诊断摘要，失败时用于定位启动问题。 */
    private readonly stderrChunks: string[] = [];
    /** pending: JSON-RPC 请求等待表，按 id 关联响应。 */
    private readonly pending = new Map<string, {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }>();

    /**
     * constructor：创建 stdio MCP 会话。
     *
     * @param serverConfig stdio MCP Server 配置。
     */
    constructor(private readonly serverConfig: StdioMcpServerConfig) {
        const execution = resolveStdioExecution(serverConfig);
        this.child = spawn(
            execution.command,
            execution.args,
            {
                cwd: serverConfig.cwd ?? undefined,
                env: createStdioProcessEnv(serverConfig.env),
                windowsHide: true,
                stdio: "pipe",
            },
        );
        this.child.stdout.on("data", (chunk: Buffer) => {
            this.handleStdout(chunk.toString("utf-8"));
        });
        this.child.stderr.on("data", (chunk: Buffer) => {
            // stderr: MCP Server 调试日志不进入 JSON-RPC 协议流，只在启动或调用失败时作为短摘要返回。
            const text = chunk.toString("utf-8").trim();
            if (text) {
                this.stderrChunks.push(text);
            }
        });
        this.child.on("error", (error) => {
            this.rejectAll(error);
        });
        this.child.on("close", (code) => {
            const stderrSummary = this.stderrChunks.join("\n").slice(0, 500);
            this.rejectAll(new Error(`MCP_STDIO_CLOSED:${code ?? "UNKNOWN"}${stderrSummary ? `:${stderrSummary}` : ""}`));
        });
    }

    /**
     * initialize：完成 MCP initialize 和 initialized 通知。
     *
     * @returns 没有返回值。
     */
    async initialize(): Promise<void> {
        await this.request(
            "initialize",
            {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: {
                    name: "zhixin-agent-center",
                    version: "0.1.0",
                },
            },
        );
        this.notify(
            "notifications/initialized",
            {},
        );
    }

    /**
     * request：发送 JSON-RPC 请求并等待 result。
     *
     * @param method MCP 方法名。
     * @param params MCP 参数对象。
     * @returns JSON-RPC result。
     */
    request(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = randomMcpRequestId(method);
        const body = {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        this.writeJsonRpc(body);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP_STDIO_TIMEOUT:${method}`));
            }, 30_000);
            this.pending.set(
                id,
                {
                    resolve,
                    reject,
                    timeout,
                },
            );
        });
    }

    /**
     * notify：发送 JSON-RPC notification。
     *
     * @param method MCP 通知方法名。
     * @param params MCP 通知参数。
     * @returns 没有返回值。
     */
    notify(method: string, params: Record<string, unknown>): void {
        this.writeJsonRpc({
            jsonrpc: "2.0",
            method,
            params,
        });
    }

    /**
     * close：关闭当前 stdio MCP 子进程。
     *
     * @returns 没有返回值。
     */
    close(): void {
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timeout);
        }
        this.pending.clear();
        if (!this.child.killed) {
            this.child.kill();
        }
    }

    /**
     * writeJsonRpc：按 stdio transport 写入 JSON-RPC 消息。
     *
     * @param body JSON-RPC 消息体。
     * @returns 没有返回值。
     */
    private writeJsonRpc(body: Record<string, unknown>): void {
        // JSON 行协议：chrome-devtools-mcp 等 Node stdio MCP Server 接受每行一个 JSON-RPC 消息。
        this.child.stdin.write(`${JSON.stringify(body)}\n`);
    }

    /**
     * handleStdout：解析 stdout 中的换行 JSON 或 Content-Length 帧。
     *
     * @param chunk stdout 文本块。
     * @returns 没有返回值。
     */
    private handleStdout(chunk: string): void {
        this.buffer += chunk;
        this.drainContentLengthFrames();
        this.drainJsonLines();
    }

    /**
     * drainContentLengthFrames：兼容 Content-Length framed stdio 消息。
     *
     * @returns 没有返回值。
     */
    private drainContentLengthFrames(): void {
        while (this.buffer.startsWith("Content-Length:")) {
            const headerEnd = this.buffer.indexOf("\r\n\r\n");
            if (headerEnd < 0) {
                return;
            }
            const header = this.buffer.slice(0, headerEnd);
            const lengthMatch = /Content-Length:\s*(\d+)/iu.exec(header);
            if (!lengthMatch) {
                return;
            }
            const length = Number(lengthMatch[1]);
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + length;
            if (this.buffer.length < bodyEnd) {
                return;
            }
            this.handleJsonRpcText(this.buffer.slice(bodyStart, bodyEnd));
            this.buffer = this.buffer.slice(bodyEnd);
        }
    }

    /**
     * drainJsonLines：解析每行一个 JSON-RPC 消息的 stdio 输出。
     *
     * @returns 没有返回值。
     */
    private drainJsonLines(): void {
        let newlineIndex = this.buffer.indexOf("\n");
        while (newlineIndex >= 0) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);
            if (line.length > 0) {
                this.handleJsonRpcText(line);
            }
            newlineIndex = this.buffer.indexOf("\n");
        }
    }

    /**
     * handleJsonRpcText：处理一条 JSON-RPC 响应或通知。
     *
     * @param text JSON-RPC 文本。
     * @returns 没有返回值。
     */
    private handleJsonRpcText(text: string): void {
        const parsed = tryParseRecord(text);
        if (!parsed || typeof parsed.id !== "string") {
            return;
        }
        const pending = this.pending.get(parsed.id);
        if (!pending) {
            return;
        }
        this.pending.delete(parsed.id);
        clearTimeout(pending.timeout);
        if (isRecord(parsed.error)) {
            pending.reject(new Error(`MCP_JSON_RPC_ERROR:${String(parsed.error.message ?? parsed.error.code ?? "UNKNOWN")}`));
            return;
        }
        pending.resolve(parsed.result ?? null);
    }

    /**
     * rejectAll：子进程异常时拒绝所有等待中的请求。
     *
     * @param error 失败原因。
     * @returns 没有返回值。
     */
    private rejectAll(error: Error): void {
        for (const [
            id,
            entry,
        ] of this.pending.entries()) {
            clearTimeout(entry.timeout);
            entry.reject(error);
            this.pending.delete(id);
        }
    }
}

/**
 * createStdioProcessEnv：创建 stdio MCP 子进程环境变量。
 *
 * @param extraEnv MCP 配置追加环境变量。
 * @returns 只包含字符串值的环境变量对象。
 */
function createStdioProcessEnv(extraEnv: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [
        key,
        value,
    ] of Object.entries(process.env)) {
        if (typeof value === "string") {
            result[key] = value;
        }
    }
    return {
        ...result,
        ...extraEnv,
    };
}

/**
 * resolveStdioCommandExecutable：修正 Windows 下 npm 系命令需要 .cmd 才能 spawn 的问题。
 *
 * @param command MCP 配置中的命令。
 * @returns 可传给 spawn 的命令。
 */
function resolveStdioExecution(serverConfig: StdioMcpServerConfig): {
    command: string;
    args: string[];
} {
    if (process.platform === "win32" && [
        "npx",
        "npm",
        "pnpm",
        "yarn",
    ].includes(serverConfig.command)) {
        return {
            command: "cmd.exe",
            args: [
                "/d",
                "/s",
                "/c",
                serverConfig.command,
                ...serverConfig.args,
            ],
        };
    }
    return {
        command: serverConfig.command,
        args: serverConfig.args,
    };
}

/**
 * withStdioMcpSession：创建短生命周期 stdio MCP 会话并自动关闭。
 *
 * @param serverConfig stdio MCP Server 配置。
 * @param handler 会话使用逻辑。
 * @returns handler 的返回值。
 */
async function withStdioMcpSession<T>(
    serverConfig: StdioMcpServerConfig,
    handler: (session: StdioMcpSession) => Promise<T>,
): Promise<T> {
    const session = new StdioMcpSession(serverConfig);
    try {
        return await handler(session);
    } finally {
        session.close();
    }
}

/**
 * listHttpMcpTools：通过 MCP tools/list 读取 Server 工具清单。
 *
 * @param serverConfig MCP Server 配置。
 * @returns 工具定义列表。
 */
async function listHttpMcpTools(serverConfig: McpServerConfig): Promise<Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}>> {
    const session = await initializeHttpMcpSession(serverConfig);
    await sendHttpMcpNotification(
        serverConfig,
        session.sessionId,
        "notifications/initialized",
        {},
    );
    const result = await sendHttpMcpRequest(
        serverConfig,
        session.sessionId,
        "tools/list",
        {},
    );
    const tools = isRecord(result) && Array.isArray(result.tools)
        ? result.tools
        : [];
    return tools.map((tool) => {
        if (!isRecord(tool) || typeof tool.name !== "string") {
            return null;
        }
        return {
            name: tool.name,
            description: typeof tool.description === "string" ? tool.description : "",
            inputSchema: isRecord(tool.inputSchema)
                ? tool.inputSchema
                : {
                    type: "object",
                    properties: {},
                },
        };
    }).filter((tool): tool is {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
    } => tool !== null);
}

/**
 * callHttpMcpTool：通过 MCP tools/call 执行指定工具。
 *
 * @param serverConfig MCP Server 配置。
 * @param toolName MCP 工具名。
 * @param toolArguments MCP 工具参数。
 * @returns 工具输出摘要。
 */
async function callHttpMcpTool(
    serverConfig: McpServerConfig,
    toolName: string,
    toolArguments: Record<string, unknown>,
): Promise<string> {
    const session = await initializeHttpMcpSession(serverConfig);
    await sendHttpMcpNotification(
        serverConfig,
        session.sessionId,
        "notifications/initialized",
        {},
    );
    const result = await sendHttpMcpRequest(
        serverConfig,
        session.sessionId,
        "tools/call",
        {
            name: toolName,
            arguments: toolArguments,
        },
    );
    return summarizeMcpToolResult(result);
}

/**
 * initializeHttpMcpSession：初始化一次 HTTP MCP 会话。
 *
 * @param serverConfig MCP Server 配置。
 * @returns MCP Session ID，Server 未返回时为 null。
 */
async function initializeHttpMcpSession(serverConfig: McpServerConfig): Promise<{
    sessionId: string | null;
}> {
    const response = await postHttpMcpJsonRpc(
        serverConfig,
        null,
        {
            jsonrpc: "2.0",
            id: "initialize",
            method: "initialize",
            params: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: {
                    name: "zhixin-agent-center",
                    version: "0.1.0",
                },
            },
        },
    );
    assertJsonRpcSuccess(response.body);
    return {
        sessionId: response.sessionId,
    };
}

/**
 * sendHttpMcpNotification：发送无需结果的 MCP 通知。
 *
 * @param serverConfig MCP Server 配置。
 * @param sessionId MCP Session ID。
 * @param method 通知方法名。
 * @param params 通知参数。
 * @returns 没有返回值。
 */
async function sendHttpMcpNotification(
    serverConfig: McpServerConfig,
    sessionId: string | null,
    method: string,
    params: Record<string, unknown>,
): Promise<void> {
    await postHttpMcpJsonRpc(
        serverConfig,
        sessionId,
        {
            jsonrpc: "2.0",
            method,
            params,
        },
    );
}

/**
 * sendHttpMcpRequest：发送 MCP JSON-RPC 请求并返回 result。
 *
 * @param serverConfig MCP Server 配置。
 * @param sessionId MCP Session ID。
 * @param method 请求方法名。
 * @param params 请求参数。
 * @returns JSON-RPC result。
 */
async function sendHttpMcpRequest(
    serverConfig: McpServerConfig,
    sessionId: string | null,
    method: string,
    params: Record<string, unknown>,
): Promise<unknown> {
    const response = await postHttpMcpJsonRpc(
        serverConfig,
        sessionId,
        {
            jsonrpc: "2.0",
            id: randomMcpRequestId(method),
            method,
            params,
        },
    );
    return assertJsonRpcSuccess(response.body);
}

/**
 * postHttpMcpJsonRpc：向 Streamable HTTP MCP endpoint 发送 JSON-RPC。
 *
 * @param serverConfig MCP Server 配置。
 * @param sessionId MCP Session ID。
 * @param body JSON-RPC 请求体。
 * @returns 解析后的 JSON-RPC 响应和 Session ID。
 */
async function postHttpMcpJsonRpc(
    serverConfig: McpServerConfig,
    sessionId: string | null,
    body: Record<string, unknown>,
): Promise<{
    sessionId: string | null;
    body: JsonRpcResponse | null;
}> {
    const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
    };
    if (sessionId) {
        headers["mcp-session-id"] = sessionId;
    }
    const response = await fetch(
        serverConfig.url,
        {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        },
    );
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`MCP_HTTP_${response.status}:${text.slice(0, 240)}`);
    }
    return {
        sessionId: response.headers.get("mcp-session-id") ?? sessionId,
        body: text.trim().length > 0 ? parseMcpHttpResponse(text) : null,
    };
}

/**
 * parseMcpHttpResponse：解析 JSON 或 SSE 包装的 MCP JSON-RPC 响应。
 *
 * @param text HTTP 响应文本。
 * @returns JSON-RPC 响应对象。
 */
function parseMcpHttpResponse(text: string): JsonRpcResponse {
    const directJson = tryParseRecord(text);
    if (directJson) {
        return directJson as JsonRpcResponse;
    }
    const dataLine = text.split(/\r?\n/u).find((line) => line.startsWith("data:"));
    if (!dataLine) {
        throw new Error("MCP_RESPONSE_NOT_JSON");
    }
    const sseJson = tryParseRecord(dataLine.slice("data:".length).trim());
    if (!sseJson) {
        throw new Error("MCP_SSE_RESPONSE_NOT_JSON");
    }
    return sseJson as JsonRpcResponse;
}

/**
 * assertJsonRpcSuccess：检查 JSON-RPC 响应并读取 result。
 *
 * @param response JSON-RPC 响应。
 * @returns result 字段。
 */
function assertJsonRpcSuccess(response: JsonRpcResponse | null): unknown {
    if (!response) {
        return null;
    }
    if (response.error) {
        throw new Error(`MCP_JSON_RPC_ERROR:${response.error.message ?? response.error.code ?? "UNKNOWN"}`);
    }
    return response.result ?? null;
}

/**
 * summarizeMcpToolResult：把 MCP tools/call 结果压缩为模型可读文本。
 *
 * @param result MCP tools/call result。
 * @returns 输出摘要。
 */
function summarizeMcpToolResult(result: unknown): string {
    if (!isRecord(result)) {
        return stringifyMcpValue(result);
    }
    if (result.isError === true) {
        throw new Error(`MCP_TOOL_RETURNED_ERROR:${stringifyMcpValue(result.content)}`);
    }
    const content = Array.isArray(result.content)
        ? result.content
        : [];
    const textParts = content.map((item) => {
        if (!isRecord(item)) {
            return stringifyMcpValue(item);
        }
        if (typeof item.text === "string") {
            return item.text;
        }
        return stringifyMcpValue(item);
    });
    return textParts.join("\n").trim() || stringifyMcpValue(result);
}

/**
 * appendMcpToolResult：根据 MCP 调用状态追加完成或失败事件。
 *
 * @param events 事件日志仓储。
 * @param capability MCP 工具能力定义。
 * @param request MCP 工具请求。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param status 调用状态。
 * @param outputSummary 输出摘要。
 * @param failureReason 失败原因。
 * @param graphCheckpoint 对话图检查点。
 * @returns MCP 工具结果。
 */
function appendMcpToolResult(
    events: CenterEventStore,
    capability: UnifiedToolCapability | null,
    request: McpToolRequest,
    sessionId: string,
    taskId: string,
    turnId: string,
    status: "completed" | "failed",
    outputSummary: string,
    failureReason: string | null,
    graphCheckpoint?: TurnGraphCheckpoint,
): McpToolResult {
    const event = events.append({
        eventType: status === "completed" ? "tool.mcp.completed" : "tool.mcp.failed",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status,
        title: status === "completed" ? "MCP 调用完成" : "MCP 调用失败",
        summary: status === "completed" ? outputSummary : failureReason ?? "MCP_TOOL_CALL_FAILED",
        payload: withOptionalGraphCheckpoint({
            toolId: capability?.toolId ?? "builtin.mcp.call",
            toolKind: "mcp",
            transportType: request.transportType ?? null,
            toolCallId: request.toolCallId ?? null,
            requiredPermission: capability?.requiredPermission ?? "mcp.call",
            serverId: request.serverId,
            toolName: request.toolName,
            outputSummary,
            failureReason,
        }, graphCheckpoint),
    });
    return {
        toolKind: "mcp",
        serverId: request.serverId,
        toolName: request.toolName,
        status,
        outputSummary,
        failureReason,
        traceId: event.traceId,
    };
}

/**
 * randomMcpRequestId：为 MCP JSON-RPC 请求生成可读 ID。
 *
 * @param method MCP 方法名。
 * @returns 请求 ID。
 */
function randomMcpRequestId(method: string): string {
    return `${method}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

/**
 * tryParseRecord：尝试把 JSON 字符串解析成对象。
 *
 * @param text JSON 字符串。
 * @returns 对象；解析失败或不是对象时返回 null。
 */
function tryParseRecord(text: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(text) as unknown;
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * stringifyMcpValue：把 MCP 返回值转为稳定文本。
 *
 * @param value MCP 返回值。
 * @returns 文本摘要。
 */
function stringifyMcpValue(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
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
