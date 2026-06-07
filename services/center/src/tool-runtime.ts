import {spawn} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

import type {
    UnifiedToolCallIntent,
    UnifiedToolCapability,
} from "@zhixin/shared";
import type {ModelToolCall, ModelToolSpec} from "@zhixin/model-protocol";

import type {CenterEventStore} from "./events.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
} from "./turn-graph-domain.js";

/**
 * UNIFIED_TOOL_CAPABILITY_REGISTRY：中心服务统一工具能力注册表。
 *
 * 来源：架构中的命令、插件、MCP 和 skill 统一能力链路。
 * 含义：所有智能体和子智能体先从该注册表发现工具，再进入权限、执行和审计。
 * 约束：插件和 skill 尚未绑定具体执行器时只登记不可用原因；MCP 已接入中心服务配置执行器。
 */
export const UNIFIED_TOOL_CAPABILITY_REGISTRY: UnifiedToolCapability[] = [
    {
        toolId: "builtin.command.run",
        toolKind: "command",
        displayName: "命令工具",
        requiredPermission: "command.run",
        availability: "available",
        unavailableReason: null,
        description: "在中心服务受控环境中执行明确的本机命令，并返回标准输出或错误摘要。",
        inputSchema: {
            type: "object",
            required: [
                "inputSummary",
            ],
            properties: {
                shellCommand: {
                    type: "string",
                    description: "需要 shell 语法时使用的完整命令行；Windows 由 PowerShell 执行，macOS/Linux 由 sh 执行。",
                },
                executablePath: {
                    type: "string",
                    description: "不需要 shell 语法时要执行的可执行文件路径或命令名。",
                },
                args: {
                    type: "array",
                    description: "不需要 shell 语法时的命令参数数组。",
                    items: {
                        type: "string",
                    },
                },
                inputSummary: {
                    type: "string",
                    description: "模型请求执行命令的目的摘要。",
                },
            },
        },
        riskLevel: "high",
        scope: "session",
        approvalRequired: true,
        displayText: "执行命令",
    },
    {
        toolId: "builtin.plugin.call",
        toolKind: "plugin",
        displayName: "插件工具",
        requiredPermission: "plugin.call",
        availability: "unavailable",
        unavailableReason: "PLUGIN_NOT_SELECTED",
        description: "调用当前会话可用的中心服务插件能力。",
        inputSchema: {
            type: "object",
            required: [
                "pluginId",
                "operation",
                "arguments",
            ],
            properties: {
                pluginId: {
                    type: "string",
                    description: "要调用的插件 ID。",
                },
                operation: {
                    type: "string",
                    description: "插件能力操作名。",
                },
                arguments: {
                    type: "object",
                    description: "插件操作参数。",
                },
            },
        },
        riskLevel: "medium",
        scope: "session",
        approvalRequired: true,
        displayText: "调用插件",
    },
    {
        toolId: "builtin.mcp.call",
        toolKind: "mcp",
        displayName: "MCP 工具",
        requiredPermission: "mcp.call",
        availability: "available",
        unavailableReason: null,
        description: "调用当前会话可用的 MCP Server 工具；优先使用动态列出的 mcp_<server>_<tool> 工具。",
        inputSchema: {
            type: "object",
            required: [
                "serverId",
                "toolName",
                "arguments",
            ],
            properties: {
                serverId: {
                    type: "string",
                    description: "MCP Server ID，例如全局配置里的 idea。",
                },
                toolName: {
                    type: "string",
                    description: "MCP 工具名称，例如 get_all_open_file_paths 或 get_file_text_by_path。",
                },
                arguments: {
                    type: "object",
                    description: "MCP 工具参数。",
                },
            },
        },
        riskLevel: "medium",
        scope: "session",
        approvalRequired: true,
        displayText: "调用 MCP",
    },
    {
        toolId: "builtin.skill.use",
        toolKind: "skill",
        displayName: "skill",
        requiredPermission: "skill.use",
        availability: "unavailable",
        unavailableReason: "SKILL_NOT_SELECTED",
        description: "解析并注入当前会话可用的 skill 工作流。",
        inputSchema: {
            type: "object",
            required: [
                "skillId",
                "request",
            ],
            properties: {
                skillId: {
                    type: "string",
                    description: "要使用的 skill ID。",
                },
                request: {
                    type: "string",
                    description: "请求 skill 处理的任务摘要。",
                },
            },
        },
        riskLevel: "low",
        scope: "session",
        approvalRequired: false,
        displayText: "使用 skill",
    },
];

/**
 * listUnifiedToolCapabilities：读取统一工具能力注册表。
 *
 * @returns 工具能力副本。
 */
export function listUnifiedToolCapabilities(): UnifiedToolCapability[] {
    return UNIFIED_TOOL_CAPABILITY_REGISTRY.map((capability) => ({
        ...capability,
    }));
}

/**
 * resolveUnifiedToolCapability：按工具 ID 读取注册能力。
 *
 * @param toolId 工具 ID。
 * @returns 工具能力；不存在时返回 null。
 */
export function resolveUnifiedToolCapability(toolId: string): UnifiedToolCapability | null {
    return listUnifiedToolCapabilities().find((capability) => {
        return capability.toolId === toolId;
    }) ?? null;
}

/**
 * toModelSafeToolName：把中心服务内部工具 ID 转成模型协议安全名称。
 *
 * @param toolId 中心服务内部工具 ID。
 * @returns 只包含字母、数字、下划线或连字符的模型工具名。
 */
export function toModelSafeToolName(toolId: string): string {
    // safeName: OpenAI 兼容工具名不允许点号，统一替换成下划线并保留可读来源。
    return toolId.replace(/[^a-zA-Z0-9_-]/gu, "_");
}

/**
 * listAvailableModelToolSpecs：把中心服务工具能力转换为内部模型工具定义。
 *
 * @returns 模型请求可携带的工具定义列表。
 */
export function listAvailableModelToolSpecs(): ModelToolSpec[] {
    return listUnifiedToolCapabilities()
        .filter((capability) => {
            return capability.availability === "available";
        })
        .map((capability) => ({
            name: toModelSafeToolName(capability.toolId),
            sourceToolId: capability.toolId,
            description: capability.description,
            parametersJsonSchema: capability.inputSchema,
        }));
}

/**
 * listAvailableModelToolSpecsForCenter：读取静态工具和中心目录中的 MCP 动态工具。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 模型请求可携带的工具定义列表。
 */
export async function listAvailableModelToolSpecsForCenter(centerDirectory: string | null | undefined): Promise<ModelToolSpec[]> {
    const staticTools = listAvailableModelToolSpecs();
    const dynamicMcpTools = centerDirectory
        ? await listConfiguredMcpModelToolSpecs(centerDirectory)
        : [];
    return [
        ...staticTools,
        ...dynamicMcpTools,
    ];
}

/**
 * appendToolVisibilityEvents：写入自动工具使用可见过程。
 *
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @returns 没有返回值。
 */
export function appendToolVisibilityEvents(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    graphCheckpoint?: TurnGraphCheckpoint,
): void {
    for (const capability of listUnifiedToolCapabilities()) {
        if (capability.availability === "available") {
            continue;
        }
        appendUnifiedToolUnavailableEvent(
            events,
            sessionId,
            taskId,
            turnId,
            capability,
            graphCheckpoint,
        );
    }
}

/**
 * appendUnifiedToolUnavailableEvent：用统一事件模型写入不可用工具状态。
 *
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param capability 工具能力。
 * @returns 没有返回值。
 */
function appendUnifiedToolUnavailableEvent(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    capability: UnifiedToolCapability,
    graphCheckpoint?: TurnGraphCheckpoint,
): void {
    events.append({
        eventType: `tool.${capability.toolKind}.unavailable`,
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "completed",
        title: `${capability.displayName}状态`,
        summary: `当前会话未解析到可执行${capability.displayName}，已记录为不可用状态。`,
        payload: withOptionalGraphCheckpoint({
            toolId: capability.toolId,
            toolKind: capability.toolKind,
            availability: capability.availability,
            requiredPermission: capability.requiredPermission,
            unavailableReason: capability.unavailableReason,
        }, graphCheckpoint),
    });
}

/**
 * CommandToolRequest：通用命令工具请求。
 *
 * 来源：Agent 工具规划结果。
 * 含义：中心服务按明确命令执行，并把过程写入事件日志。
 * 格式：可执行路径、参数和输入摘要。
 * 默认值：无。
 * 约束：只能由对话编排触发，浏览器端不直接调用。
 */
export interface CommandToolRequest {
    /** toolCallId: 模型工具调用 ID，用于 UI 把每次调用拆成独立命令框；非模型触发时为 null。 */
    toolCallId?: string | null;
    /** shellCommand: 需要 shell 语法时的完整命令行；优先于 executablePath 和 args。 */
    shellCommand?: string | null;
    /** executablePath: 可执行文件路径或命令名。 */
    executablePath: string;
    /** args: 命令参数数组。 */
    args: string[];
    /** inputSummary: 命令用途摘要。 */
    inputSummary: string;
}

/**
 * planUnifiedToolCallForUserText：兼容旧调用方的临时入口。
 *
 * @param userText 用户输入。
 * @returns 固定返回 null，避免继续通过用户文本硬编码触发工具。
 */
export function planUnifiedToolCallForUserText(userText: string): UnifiedToolCallIntent | null {
    void userText;
    return null;
}

/**
 * buildUnifiedToolCallIntentFromModelCall：把模型工具调用转换为中心服务工具意图。
 *
 * @param toolCall 模型返回的结构化工具调用。
 * @returns 可执行工具意图；工具不存在或不可用时返回 null。
 */
export function buildUnifiedToolCallIntentFromModelCall(toolCall: ModelToolCall): UnifiedToolCallIntent | null {
    const dynamicMcpTool = readMcpDynamicToolName(toolCall.name);
    if (dynamicMcpTool) {
        return {
            toolId: "builtin.mcp.call",
            toolKind: "mcp",
            inputSummary: readToolInputSummary(
                toolCall.argumentsJson,
                `调用 MCP ${dynamicMcpTool.serverId}.${dynamicMcpTool.toolName}`,
            ),
            arguments: {
                serverId: dynamicMcpTool.serverId,
                toolName: dynamicMcpTool.toolName,
                arguments: toolCall.argumentsJson,
            },
        };
    }

    const capability = resolveUnifiedToolCapability(readInternalToolIdFromModelName(toolCall.name));
    if (!capability || capability.availability !== "available") {
        return null;
    }

    return {
        toolId: capability.toolId,
        toolKind: capability.toolKind,
        inputSummary: readToolInputSummary(toolCall.argumentsJson, capability.displayText),
        arguments: toolCall.argumentsJson,
    };
}

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
            toolCallId: request.toolCallId ?? null,
            requiredPermission: capability?.requiredPermission ?? "mcp.call",
            serverId: request.serverId,
            toolName: request.toolName,
            inputSummary: request.inputSummary,
        }, graphCheckpoint),
    });

    try {
        const serverConfig = readMcpServerConfig(centerDirectory, request.serverId);
        const outputSummary = await callHttpMcpTool(
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
 * readInternalToolIdFromModelName：把模型返回的工具名映射回内部工具 ID。
 *
 * @param modelToolName 模型回复中的工具名。
 * @returns 中心服务内部工具 ID；无法映射时返回原值供拒绝事件记录。
 */
function readInternalToolIdFromModelName(modelToolName: string): string {
    const capability = listUnifiedToolCapabilities().find((item) => {
        return toModelSafeToolName(item.toolId) === modelToolName || item.toolId === modelToolName;
    });
    return capability?.toolId ?? modelToolName;
}

/**
 * readToolInputSummary：从模型参数中读取工具用途摘要。
 *
 * @param argumentsJson 模型传入的工具参数。
 * @param fallbackSummary 工具默认展示文案。
 * @returns 工具用途摘要。
 */
function readToolInputSummary(argumentsJson: Record<string, unknown>, fallbackSummary: string): string {
    const inputSummary = argumentsJson.inputSummary;
    return typeof inputSummary === "string" && inputSummary.trim().length > 0
        ? inputSummary
        : fallbackSummary;
}

interface McpServerConfig {
    /** serverId: MCP Server ID，来源于 mcpServers 对象 key。 */
    serverId: string;
    /** type: MCP 传输类型；当前真实执行只支持 http。 */
    type: "http";
    /** url: MCP HTTP Streamable endpoint。 */
    url: string;
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

/**
 * listConfiguredMcpModelToolSpecs：把已配置 MCP Server 暴露的工具转换成模型工具定义。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 可供模型直接选择的 MCP 动态工具列表。
 */
async function listConfiguredMcpModelToolSpecs(centerDirectory: string): Promise<ModelToolSpec[]> {
    const specs: ModelToolSpec[] = [];
    for (const serverConfig of readAllMcpServerConfigs(centerDirectory)) {
        const tools = await listHttpMcpTools(serverConfig).catch(() => {
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
 * readMcpDynamicToolName：把动态 MCP 模型工具名解码为 serverId 和 toolName。
 *
 * @param modelToolName 模型返回的工具名。
 * @returns 动态 MCP 工具定位；不是动态 MCP 工具时返回 null。
 */
function readMcpDynamicToolName(modelToolName: string): {
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
    const url = typeof rawConfig.url === "string" ? rawConfig.url : "";
    if (type !== "http" || !url) {
        return null;
    }
    return {
        serverId,
        type,
        url,
    };
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
        eventType: status === "completed" ? "tool.mcp.completed" : "tool.call.failed",
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

/**
 * planCommandToolForUserText：兼容旧调用方的命令工具规划入口。
 *
 * @param userText 用户输入。
 * @returns 命令请求；没有命令意图时返回 null。
 */
export function planCommandToolForUserText(userText: string): CommandToolRequest | null {
    const intent = planUnifiedToolCallForUserText(userText);
    if (!intent || intent.toolKind !== "command") {
        return null;
    }
    return commandRequestFromUnifiedToolIntent(intent);
}

/**
 * commandRequestFromUnifiedToolIntent：把统一工具意图转换为命令执行请求。
 *
 * @param intent 统一工具调用意图。
 * @returns 命令工具请求。
 */
export function commandRequestFromUnifiedToolIntent(intent: UnifiedToolCallIntent): CommandToolRequest {
    const shellCommand = typeof intent.arguments.shellCommand === "string"
        ? intent.arguments.shellCommand
        : null;
    const executablePath = typeof intent.arguments.executablePath === "string"
        ? intent.arguments.executablePath
        : "";
    return {
        shellCommand,
        executablePath,
        args: Array.isArray(intent.arguments.args)
            ? intent.arguments.args.map((arg) => String(arg))
            : [],
        inputSummary: intent.inputSummary,
    };
}

/**
 * CommandToolResult：通用命令工具结果。
 *
 * 来源：中心服务命令运行器。
 * 含义：供过程卡片展示命令、状态、输出、失败原因和排查 ID。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：完整输出后续进入命令审计模块，当前只返回摘要。
 */
export interface CommandToolResult {
    /** toolKind: 固定命令工具类型。 */
    toolKind: "command";
    /** command: 展示用命令摘要。 */
    command: string;
    /** status: 命令状态。 */
    status: "completed" | "failed";
    /** outputSummary: 命令输出摘要。 */
    outputSummary: string;
    /** failureReason: 失败原因，成功时为 null。 */
    failureReason: string | null;
    /** traceId: 完成或失败事件排查 ID。 */
    traceId: string;
}

/**
 * runCommandTool：通过中心服务执行通用命令。
 *
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param request 命令请求。
 * @returns 命令输出摘要。
 */
export async function runCommandTool(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    request: CommandToolRequest,
    graphCheckpoint?: TurnGraphCheckpoint,
): Promise<CommandToolResult> {
    const capability = resolveUnifiedToolCapability("builtin.command.run");
    const execution = resolveCommandExecution(request);
    const command = execution.displayCommand;
    events.append({
        eventType: "tool.command.started",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "running",
        title: "命令工具开始",
        summary: request.inputSummary,
        payload: withOptionalGraphCheckpoint({
            toolId: capability?.toolId ?? "builtin.command.run",
            toolKind: "command",
            toolCallId: request.toolCallId ?? null,
            requiredPermission: capability?.requiredPermission ?? "command.run",
            command,
            inputSummary: request.inputSummary,
        }, graphCheckpoint),
    });

    return new Promise<CommandToolResult>((resolve) => {
        const chunks: string[] = [];
        const child = spawn(
            execution.executablePath,
            execution.args,
            {
                windowsHide: true,
            },
        );
        let settled = false;

        /**
         * appendOutputChunk：把命令输出块追加到同一个命令过程卡片。
         *
         * @param chunk 输出块原文。
         * @returns 没有返回值。
         */
        const appendOutputChunk = (chunk: string): void => {
            const normalizedChunk = chunk.trimEnd();
            if (!normalizedChunk) {
                return;
            }
            chunks.push(normalizedChunk);
            events.append({
                eventType: "tool.command.output",
                scopeType: "tool",
                scopeId: taskId,
                sessionId,
                turnId,
                taskId,
                status: "running",
                title: "命令工具输出",
                summary: normalizedChunk,
                payload: withOptionalGraphCheckpoint({
                    toolId: capability?.toolId ?? "builtin.command.run",
                    toolKind: "command",
                    toolCallId: request.toolCallId ?? null,
                    requiredPermission: capability?.requiredPermission ?? "command.run",
                    command,
                    outputChunk: normalizedChunk,
                }, graphCheckpoint),
            });
        };

        child.stdout?.on("data", (chunk: Buffer) => {
            appendOutputChunk(chunk.toString("utf-8"));
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            appendOutputChunk(chunk.toString("utf-8"));
        });
        child.on("error", (error) => {
            if (settled) {
                return;
            }
            settled = true;
            appendOutputChunk(error.message);
            resolveCommandToolResult(
                events,
                capability,
                command,
                request.toolCallId ?? null,
                sessionId,
                taskId,
                turnId,
                chunks,
                null,
                resolve,
                graphCheckpoint,
            );
        });
        child.on("close", (exitCode) => {
            if (settled) {
                return;
            }
            settled = true;
            resolveCommandToolResult(
                events,
                capability,
                command,
                request.toolCallId ?? null,
                sessionId,
                taskId,
                turnId,
                chunks,
                exitCode,
                resolve,
                graphCheckpoint,
            );
        });
    });
}

/**
 * resolveCommandExecution：把命令请求转换为当前系统可执行形式。
 *
 * @param request 命令工具请求。
 * @returns 实际可执行路径、参数和展示命令。
 */
function resolveCommandExecution(request: CommandToolRequest): {
    executablePath: string;
    args: string[];
    displayCommand: string;
} {
    const bashCompatCommand = resolveBashCompatShellCommand(request);
    if (request.shellCommand && request.shellCommand.trim().length > 0) {
        const shellCommand = request.shellCommand.trim();
        if (process.platform === "win32") {
            return {
                executablePath: "powershell.exe",
                args: [
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    shellCommand,
                ],
                displayCommand: shellCommand,
            };
        }

        return {
            executablePath: "sh",
            args: [
                "-lc",
                shellCommand,
            ],
            displayCommand: shellCommand,
        };
    }
    if (bashCompatCommand) {
        return {
            executablePath: "powershell.exe",
            args: [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                bashCompatCommand,
            ],
            displayCommand: bashCompatCommand,
        };
    }
    const normalizedArgs = normalizeCommandArgs(
        request.executablePath,
        request.args,
    );
    const windowsWhichCommand = resolveWindowsWhichCommand(
        request.executablePath,
        normalizedArgs,
    );
    if (windowsWhichCommand) {
        return windowsWhichCommand;
    }

    return {
        executablePath: request.executablePath,
        args: normalizedArgs,
        displayCommand: [
            request.executablePath,
            ...normalizedArgs,
        ].join(" "),
    };
}

/**
 * normalizeCommandArgs：修正模型把可执行名重复放进 args 的常见参数。
 *
 * @param executablePath 可执行命令。
 * @param args 原始参数数组。
 * @returns 修正后的参数数组。
 */
function normalizeCommandArgs(
    executablePath: string,
    args: string[],
): string[] {
    if (args[0] === executablePath) {
        return args.slice(1);
    }
    return args;
}

/**
 * resolveWindowsWhichCommand：把 Windows 上不存在的 which 转为 PowerShell Get-Command。
 *
 * @param executablePath 原始可执行命令。
 * @param args 已规范化参数。
 * @returns Windows 可执行形式；不需要兼容时返回 null。
 */
function resolveWindowsWhichCommand(
    executablePath: string,
    args: string[],
): {
    executablePath: string;
    args: string[];
    displayCommand: string;
} | null {
    if (process.platform !== "win32" || executablePath !== "which" || args.length === 0) {
        return null;
    }
    const commandName = args[0];
    const shellCommand = `Get-Command ${commandName} | Select-Object -ExpandProperty Source`;
    return {
        executablePath: "powershell.exe",
        args: [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            shellCommand,
        ],
        displayCommand: shellCommand,
    };
}

/**
 * resolveBashCompatShellCommand：兼容模型在 Windows 上误选 bash -lc 的常见命令。
 *
 * @param request 命令工具请求。
 * @returns 可交给 PowerShell 执行的命令；不需要兼容时返回 null。
 */
function resolveBashCompatShellCommand(request: CommandToolRequest): string | null {
    if (process.platform !== "win32" || request.executablePath !== "bash" || request.args[0] !== "-lc") {
        return null;
    }
    const shellCommand = request.args.slice(1).join(" ").trim();
    if (!shellCommand) {
        return null;
    }
    return shellCommand
        .replace(/command -v /gu, "Get-Command ")
        .replace(/&&/gu, "; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };");
}

/**
 * resolveCommandToolResult：根据命令退出状态追加完成或失败事件。
 *
 * @param events 事件日志仓储。
 * @param capability 命令工具能力定义。
 * @param command 展示用命令。
 * @param toolCallId 模型工具调用 ID；非模型触发时为 null。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param chunks 已收集的输出块。
 * @param exitCode 进程退出码；启动失败时为 null。
 * @param resolve Promise 完成回调。
 * @returns 没有返回值。
 */
function resolveCommandToolResult(
    events: CenterEventStore,
    capability: UnifiedToolCapability | null,
    command: string,
    toolCallId: string | null,
    sessionId: string,
    taskId: string,
    turnId: string,
    chunks: string[],
    exitCode: number | null,
    resolve: (result: CommandToolResult) => void,
    graphCheckpoint?: TurnGraphCheckpoint,
): void {
    const outputSummary = chunks.join("\n").trim();
    const status = exitCode === 0 ? "completed" : "failed";
    const event = events.append({
        eventType: status === "completed" ? "tool.command.completed" : "tool.call.failed",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status,
        title: status === "completed" ? "命令工具完成" : "命令工具失败",
        summary: outputSummary || "命令没有输出。",
        payload: withOptionalGraphCheckpoint({
            toolId: capability?.toolId ?? "builtin.command.run",
            toolKind: "command",
            toolCallId,
            requiredPermission: capability?.requiredPermission ?? "command.run",
            command,
            outputSummary,
            exitCode,
            failureReason: status === "completed" ? null : outputSummary || "COMMAND_EXIT_NON_ZERO",
        }, graphCheckpoint),
    });

    resolve({
        toolKind: "command",
        command,
        status,
        outputSummary,
        failureReason: status === "completed" ? null : outputSummary || "COMMAND_EXIT_NON_ZERO",
        traceId: event.traceId,
    });
}
