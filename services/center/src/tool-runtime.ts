import type {
    UnifiedToolCallIntent,
    UnifiedToolCapability,
} from "@zhixin/shared";

import type {
    OpenAiToolCall,
    OpenAiToolSpec,
} from "./openai-chat-protocol.js";
import type {CenterEventStore} from "./events.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
} from "./turn-graph-domain.js";
import {
    listConfiguredMcpModelToolSpecs,
    readMcpDynamicToolName,
} from "./tool-runtime-mcp.js";

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
 * listAvailableModelToolSpecs：把中心服务工具能力转换为 OpenAI 工具定义。
 *
 * @returns OpenAI Chat Completions 请求可携带的工具定义列表。
 */
export function listAvailableModelToolSpecs(): OpenAiToolSpec[] {
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
 * @returns OpenAI Chat Completions 请求可携带的工具定义列表。
 */
export async function listAvailableModelToolSpecsForCenter(centerDirectory: string | null | undefined): Promise<OpenAiToolSpec[]> {
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
 * @param toolCall OpenAI 返回的结构化工具调用。
 * @returns 可执行工具意图；工具不存在或不可用时返回 null。
 */
export function buildUnifiedToolCallIntentFromModelCall(toolCall: OpenAiToolCall): UnifiedToolCallIntent | null {
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

export {
    commandRequestFromUnifiedToolIntent,
    planCommandToolForUserText,
    runCommandTool,
} from "./tool-runtime-command.js";
export type {
    CommandToolRequest,
    CommandToolResult,
} from "./tool-runtime-command.js";
export {
    listConfiguredMcpToolViews,
    listConfiguredMcpToolViewsByServer,
    listMcpToolViewsForServerConfig,
    mcpRequestFromUnifiedToolIntent,
    runMcpTool,
} from "./tool-runtime-mcp.js";
export type {
    McpToolRequest,
    McpToolResult,
} from "./tool-runtime-mcp.js";
