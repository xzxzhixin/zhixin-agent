import {executeCreateLongTermAgentTool} from "./create-long-term-agent-tool.js";
import {executeCreateSubAgentTool} from "./create-sub-agent-tool.js";
import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";

/**
 * executeCreateLongTermAgentForTool：执行创建长期智能体 helper。
 *
 * @param context 当前工具执行上下文。
 * @param arg 工具参数。
 * @returns 工具结果。
 */
export function executeCreateLongTermAgentForTool(
    context: DeepAgentsToolExecutionContext,
    arg: {
        name: string;
        roleDescription: string;
        capabilityBoundary?: string;
    },
): DeepAgentsToolExecutionResult {
    return {
        outputText: JSON.stringify(
            executeCreateLongTermAgentTool(
                context.input.database,
                context.input.events,
                context.centerDirectory,
                arg,
            ),
        ),
        status: "completed",
    };
}

/**
 * executeCreateSubAgentForTool：执行创建子智能体 helper。
 *
 * @param context 当前工具执行上下文。
 * @param arg 工具参数。
 * @returns 工具结果。
 */
export function executeCreateSubAgentForTool(
    context: DeepAgentsToolExecutionContext,
    arg: {
        name: string;
        parentAgentId?: string;
        parentAgentKind?: "main" | "long-term" | "sub";
    },
): DeepAgentsToolExecutionResult {
    return {
        outputText: JSON.stringify(
            executeCreateSubAgentTool(
                context.input.events,
                context.subAgents,
                {
                    parentAgentId: arg.parentAgentId ?? "main",
                    parentAgentKind: arg.parentAgentKind ?? "main",
                    taskId: context.input.sent.taskId,
                    parentProviderId: context.runtime.provider.providerId,
                    parentModelId: context.runtime.modelSelection.model,
                    parentReasoningEffort: context.runtime.modelSelection.reasoningEffort,
                    name: arg.name,
                },
            ),
        ),
        status: "completed",
    };
}
