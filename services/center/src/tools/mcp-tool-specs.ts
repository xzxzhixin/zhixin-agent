import {existsSync, readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {
    isRecord,
    randomMcpRequestId,
    tryParseRecord,
} from "@zhixin/shared";

import type {OpenAiToolSpec} from "../openai-chat-protocol.js";
import {StdioMcpSession} from "./StdioMcpSession.js";

/** MCP_MODEL_TOOL_NAME_MAX_LENGTH：OpenAI 函数工具名长度上限，动态 MCP 名称必须短于该值。 */
export const MCP_MODEL_TOOL_NAME_MAX_LENGTH = 64;

/** McpModelToolNameRecord：模型可见短工具名与真实 MCP 工具定位的映射。 */
export interface McpModelToolNameRecord {
    /** modelToolName: 模型可见短工具名。 */
    modelToolName: string;
    /** serverId: MCP Server ID。 */
    serverId: string;
    /** toolName: MCP 真实工具名。 */
    toolName: string;
}

/** mcpModelToolNameRegistry：当前进程内动态 MCP 短名注册表，来源于 tools/list 发现结果。 */
const mcpModelToolNameRegistry = new Map<string, McpModelToolNameRecord>();

/**
 * McpToolView：MCP 管理页工具展示行。
 */
export interface McpToolView {
    /** serverId: MCP Server ID。 */
    serverId: string;
    /** transportType: MCP 传输类型。 */
    transportType: "http" | "stdio";
    /** toolName: MCP 工具名称。 */
    toolName: string;
    /** description: MCP 工具描述。 */
    description: string;
    /** inputSchema: MCP 工具输入 schema。 */
    inputSchema: Record<string, unknown>;
    /** errorMessage: 读取失败时的错误消息。 */
    errorMessage: string | null;
}

/**
 * HttpMcpServerConfig：HTTP MCP Server 配置。
 */
export interface HttpMcpServerConfig {
    /** serverId: MCP Server ID，来源于 mcpServers 对象 key。 */
    serverId: string;
    /** type: MCP HTTP Streamable transport。 */
    type: "http";
    /** url: MCP HTTP Streamable endpoint。 */
    url: string;
}

/**
 * StdioMcpServerConfig：stdio MCP Server 配置。
 */
export interface StdioMcpServerConfig {
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

/**
 * McpServerConfig：MCP Server 配置联合类型。
 */
export type McpServerConfig = HttpMcpServerConfig | StdioMcpServerConfig;

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
            return [];
        });
        for (const tool of tools) {
            specs.push({
                name: registerDynamicMcpModelToolName(
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
export async function listConfiguredMcpToolViews(centerDirectory: string): Promise<McpToolView[]> {
    const rows: McpToolView[] = [];
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
            rows.push(createMcpToolViewFailureRow(
                serverConfig.serverId,
                serverConfig.type,
                error,
            ));
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
): Promise<McpToolView[]> {
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
        return [
            createMcpToolViewFailureRow(
                serverConfig.serverId,
                serverConfig.type,
                error,
            ),
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
): Promise<McpToolView[]> {
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
        return [
            createMcpToolViewFailureRow(
                serverConfig.serverId,
                serverConfig.type,
                error,
            ),
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
    const record = mcpModelToolNameRegistry.get(modelToolName);
    return record
        ? {
            serverId: record.serverId,
            toolName: record.toolName,
        }
        : null;
}

/**
 * toDynamicMcpModelToolName：把 MCP Server 和工具名编码成模型协议安全名称。
 *
 * @param serverId MCP Server ID。
 * @param toolName MCP 工具名。
 * @returns 只包含字母、数字和下划线的模型工具名。
 */
export function toDynamicMcpModelToolName(
    serverId: string,
    toolName: string,
): string {
    const digest = createHash("sha256")
        .update(`${serverId}\u0000${toolName}`)
        .digest("hex")
        .slice(
            0,
            24,
        );
    return `mcp_${digest}`;
}

/**
 * registerDynamicMcpModelToolName：注册一个模型可见短 MCP 工具名。
 *
 * @param serverId MCP Server ID。
 * @param toolName MCP 真实工具名。
 * @returns 模型可见短工具名。
 */
export function registerDynamicMcpModelToolName(
    serverId: string,
    toolName: string,
): string {
    const modelToolName = toDynamicMcpModelToolName(
        serverId,
        toolName,
    );
    if (modelToolName.length > MCP_MODEL_TOOL_NAME_MAX_LENGTH) {
        throw new Error(`MCP_MODEL_TOOL_NAME_TOO_LONG:${modelToolName}`);
    }
    const existing = mcpModelToolNameRegistry.get(modelToolName);
    if (
        existing
        && (
            existing.serverId !== serverId
            || existing.toolName !== toolName
        )
    ) {
        throw new Error(`MCP_MODEL_TOOL_NAME_COLLISION:${modelToolName}`);
    }
    mcpModelToolNameRegistry.set(
        modelToolName,
        {
            modelToolName,
            serverId,
            toolName,
        },
    );
    return modelToolName;
}

/**
 * createMcpModelToolNameRegistry：为测试和诊断生成独立 MCP 短名注册表。
 *
 * @param tools 真实 MCP 工具定位列表。
 * @returns 模型可见短工具名映射。
 */
export function createMcpModelToolNameRegistry(
    tools: Array<{
        serverId: string;
        toolName: string;
    }>,
): Map<string, McpModelToolNameRecord> {
    const registry = new Map<string, McpModelToolNameRecord>();
    for (const tool of tools) {
        const modelToolName = toDynamicMcpModelToolName(
            tool.serverId,
            tool.toolName,
        );
        if (modelToolName.length > MCP_MODEL_TOOL_NAME_MAX_LENGTH) {
            throw new Error(`MCP_MODEL_TOOL_NAME_TOO_LONG:${modelToolName}`);
        }
        const existing = registry.get(modelToolName);
        if (
            existing
            && (
                existing.serverId !== tool.serverId
                || existing.toolName !== tool.toolName
            )
        ) {
            throw new Error(`MCP_MODEL_TOOL_NAME_COLLISION:${modelToolName}`);
        }
        registry.set(
            modelToolName,
            {
                modelToolName,
                serverId: tool.serverId,
                toolName: tool.toolName,
            },
        );
    }
    return registry;
}

/**
 * readAllMcpServerConfigs：读取全局 MCP 配置中的 Server。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 可执行 MCP Server 配置列表。
 */
export function readAllMcpServerConfigs(centerDirectory: string): McpServerConfig[] {
    const globalConfig = readMcpConfigJson(join(centerDirectory, "mcp", "global.json"));
    const servers = isRecord(globalConfig.mcpServers)
        ? globalConfig.mcpServers
        : {};
    return Object.entries(servers)
        .map(([serverId, rawConfig]) => readMcpServerConfigFromValue(serverId, rawConfig))
        .filter((config): config is McpServerConfig => config !== null);
}

/**
 * readMcpServerConfig：按 Server ID 读取单个 MCP 配置。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param serverId MCP Server ID。
 * @returns MCP Server 配置。
 */
export function readMcpServerConfig(
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
 * readMcpServerConfigFromValue：从 mcpServers 条目解析 MCP 配置。
 *
 * @param serverId MCP Server ID。
 * @param rawConfig 原始配置对象。
 * @returns 可执行配置；不支持时返回 null。
 */
export function readMcpServerConfigFromValue(
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
async function listHttpMcpTools(serverConfig: HttpMcpServerConfig): Promise<Array<{
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
    return normalizeMcpToolsResult(result);
}

/**
 * initializeHttpMcpSession：初始化一次 HTTP MCP 会话。
 *
 * @param serverConfig MCP Server 配置。
 * @returns MCP Session ID，Server 未返回时为 null。
 */
async function initializeHttpMcpSession(serverConfig: HttpMcpServerConfig): Promise<{
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
    serverConfig: HttpMcpServerConfig,
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
    serverConfig: HttpMcpServerConfig,
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
    serverConfig: HttpMcpServerConfig,
    sessionId: string | null,
    body: Record<string, unknown>,
): Promise<{
    sessionId: string | null;
    body: {
        result?: unknown;
        error?: {
            code?: number;
            message?: string;
        };
    } | null;
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
function parseMcpHttpResponse(text: string): {
    result?: unknown;
    error?: {
        code?: number;
        message?: string;
    };
} {
    const directJson = tryParseRecord(text);
    if (directJson) {
        return directJson;
    }
    const dataLine = text.split(/\r?\n/u).find((line) => line.startsWith("data:"));
    if (!dataLine) {
        throw new Error("MCP_RESPONSE_NOT_JSON");
    }
    const sseJson = tryParseRecord(dataLine.slice("data:".length).trim());
    if (!sseJson) {
        throw new Error("MCP_SSE_RESPONSE_NOT_JSON");
    }
    return sseJson;
}

/**
 * assertJsonRpcSuccess：检查 JSON-RPC 响应并读取 result。
 *
 * @param response JSON-RPC 响应。
 * @returns result 字段。
 */
function assertJsonRpcSuccess(response: {
    result?: unknown;
    error?: {
        code?: number;
        message?: string;
    };
} | null): unknown {
    if (!response) {
        return null;
    }
    if (response.error) {
        throw new Error(`MCP_JSON_RPC_ERROR:${response.error.message ?? response.error.code ?? "UNKNOWN"}`);
    }
    return response.result ?? null;
}

/**
 * createMcpToolViewFailureRow：创建管理页工具读取失败行。
 *
 * @param serverId MCP Server ID。
 * @param transportType MCP 传输类型。
 * @param error 失败原因。
 * @returns 错误展示行。
 */
function createMcpToolViewFailureRow(
    serverId: string,
    transportType: "http" | "stdio",
    error: unknown,
): McpToolView {
    return {
        serverId,
        transportType,
        toolName: "",
        description: "",
        inputSchema: {
            type: "object",
            properties: {},
        },
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "MCP_TOOLS_LIST_FAILED",
    };
}

