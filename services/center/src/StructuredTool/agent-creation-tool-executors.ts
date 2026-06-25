import {executeCreateLongTermAgentTool} from "./create-long-term-agent-tool.js";
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
