import type {
    UnifiedToolCallIntent,
} from "@zhixin/shared";

import type {
    OpenAiToolCall,
    OpenAiToolSpec,
} from "../openai-chat-protocol.js";
import type {BaseAgent} from "../agents/index.js";
import {
    listConfiguredMcpModelToolSpecs,
    readMcpDynamicToolName,
} from "./mcp-tool.js";
import {
    listUnifiedToolCapabilities,
    resolveUnifiedToolCapability,
    toModelSafeToolName,
} from "./tool-capability-registry.js";

/**
 * listAvailableModelToolSpecs：把中心服务工具能力转换为 OpenAI 工具定义。
 *
 * @param agent 当前执行智能体；未传入时保留旧调用方的完整工具列表。
 * @returns OpenAI Chat Completions 请求可携带的工具定义列表。
 */
export function listAvailableModelToolSpecs(agent?: BaseAgent): OpenAiToolSpec[] {
    return listUnifiedToolCapabilities()
        .filter((capability) => {
            return capability.availability === "available";
        })
        .filter((capability) => {
            // builtin.todo.list: 旧中心服务模型工具只保留为内部兼容入口；模型侧统一使用 Deep Agents 原生 write_todos。
            return capability.toolId !== "builtin.todo.list";
        })
        .filter((capability) => {
            return agent
                ? agent.canUseToolCapability(capability.toolId)
                : true;
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
 * @param agent 当前执行智能体。
 * @returns OpenAI Chat Completions 请求可携带的工具定义列表。
 */
export async function listAvailableModelToolSpecsForCenter(
    centerDirectory: string | null | undefined,
    agent?: BaseAgent,
): Promise<OpenAiToolSpec[]> {
    const staticTools = listAvailableModelToolSpecs(agent);
    const dynamicMcpTools = centerDirectory && (!agent || agent.canUseToolCapability("builtin.mcp.call"))
        ? await listConfiguredMcpModelToolSpecs(centerDirectory)
        : [];
    return [
        ...staticTools,
        ...dynamicMcpTools,
    ];
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
 * @param agent 当前执行智能体；未传入时只按工具注册表可用性判断。
 * @returns 可执行工具意图；工具不存在或不可用时返回 null。
 */
export function buildUnifiedToolCallIntentFromModelCall(
    toolCall: OpenAiToolCall,
    agent?: BaseAgent,
): UnifiedToolCallIntent | null {
    const dynamicMcpTool = readMcpDynamicToolName(toolCall.name);
    if (dynamicMcpTool) {
        if (agent && !agent.canUseToolCapability("builtin.mcp.call")) {
            return null;
        }

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
    if (agent && !agent.canUseToolCapability(capability.toolId)) {
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

