import {
    isRecord,
    randomMcpRequestId,
    tryParseRecord,
} from "@zhixin/shared";
import type {UnifiedToolCapability} from "@zhixin/shared";

import {
    type McpServerConfig,
    readMcpServerConfig,
} from "./mcp-tool-specs.js";
import {StdioMcpSession} from "./StdioMcpSession.js";
import type {CenterEventStore} from "../events.js";
import {resolveUnifiedToolCapability} from "./tool-capability-registry.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
} from "../domain/turn-graph-domain.js";

/**
 * McpToolExecutionRequest：MCP 工具调用请求。
 *
 * 来源：Deep Agents 结构化工具调用。
 * 含义：中心服务按已保存的 MCP 配置连接指定 Server 并调用工具。
 * 格式：serverId、toolName 和 arguments。
 * 默认值：无。
 * 约束：只能调用中心目录 MCP 配置中明确存在的 Server。
 */
export interface McpToolExecutionRequest {
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
 * McpToolExecutionResult：MCP 工具调用结果。
 *
 * 来源：MCP Server 的 tools/call 返回。
 * 含义：供模型回填和对话过程卡片展示。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：只返回文本摘要，不在事件中保存敏感认证信息。
 */
export interface McpToolExecutionResult {
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

/**
 * executeMcpTool：通过中心服务保存的 MCP 配置调用远端 MCP Server。
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
export async function executeMcpTool(
    events: CenterEventStore,
    centerDirectory: string,
    sessionId: string,
    taskId: string,
    turnId: string,
    request: McpToolExecutionRequest,
    graphCheckpoint?: TurnGraphCheckpoint,
): Promise<McpToolExecutionResult> {
    const capability = resolveUnifiedToolCapability("builtin.mcp.call");
    const serverConfig = readMcpServerConfig(
        centerDirectory,
        request.serverId,
    );
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
 * callHttpMcpTool：通过 MCP tools/call 执行指定工具。
 *
 * @param serverConfig MCP Server 配置。
 * @param toolName MCP 工具名。
 * @param toolArguments MCP 工具参数。
 * @returns 工具输出摘要。
 */
async function callHttpMcpTool(
    serverConfig: HttpMcpServerConfig,
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
    request: McpToolExecutionRequest,
    sessionId: string,
    taskId: string,
    turnId: string,
    status: "completed" | "failed",
    outputSummary: string,
    failureReason: string | null,
    graphCheckpoint?: TurnGraphCheckpoint,
): McpToolExecutionResult {
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
 * stringifyMcpValue：把 MCP 返回值转为稳定文本。
 *
 * @param value MCP 返回值。
 * @returns 文本摘要。
 */
function stringifyMcpValue(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
}

