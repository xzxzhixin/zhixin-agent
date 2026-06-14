import {executeAddAgentTeamMemberTool} from "./add-agent-team-member-tool.js";
import {executeCreateAgentTeamTool} from "./create-agent-team-tool.js";
import {executeCreateLongTermAgentTool} from "./create-long-term-agent-tool.js";
import {executeCreateSubAgentTool} from "./create-sub-agent-tool.js";
import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {executeDisbandAgentTeamTool} from "./disband-agent-team-tool.js";
import {executeRemoveAgentTeamMemberTool} from "./remove-agent-team-member-tool.js";

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

/**
 * executeCreateAgentTeamForTool：执行创建 team helper。
 *
 * @param context 当前工具执行上下文。
 * @param arg 工具参数。
 * @returns 工具结果。
 */
export function executeCreateAgentTeamForTool(
    context: DeepAgentsToolExecutionContext,
    arg: {
        name: string;
        description?: string;
        memberAgentIds: string[];
    },
): DeepAgentsToolExecutionResult {
    return {
        outputText: JSON.stringify(
            executeCreateAgentTeamTool(
                {
                    database: context.input.database,
                    events: context.input.events,
                    sessionId: context.input.sent.sessionId,
                    turnId: context.input.sent.turnId,
                    taskId: context.input.sent.taskId,
                    creatorAgentId: "main",
                    toolCallId: null,
                },
                {
                    name: arg.name,
                    description: arg.description ?? null,
                    memberAgentIds: arg.memberAgentIds,
                },
            ),
        ),
        status: "completed",
    };
}

/**
 * executeDisbandAgentTeamForTool：执行解散 team helper。
 *
 * @param context 当前工具执行上下文。
 * @param arg 工具参数。
 * @returns 工具结果。
 */
export function executeDisbandAgentTeamForTool(
    context: DeepAgentsToolExecutionContext,
    arg: {
        teamId: string;
    },
): DeepAgentsToolExecutionResult {
    return {
        outputText: JSON.stringify(
            executeDisbandAgentTeamTool(
                {
                    database: context.input.database,
                    events: context.input.events,
                    sessionId: context.input.sent.sessionId,
                    turnId: context.input.sent.turnId,
                    taskId: context.input.sent.taskId,
                    creatorAgentId: "main",
                    toolCallId: null,
                },
                {
                    teamId: arg.teamId,
                },
            ),
        ),
        status: "completed",
    };
}

/**
 * executeAddAgentTeamMemberForTool：执行添加 team 成员 helper。
 *
 * @param context 当前工具执行上下文。
 * @param arg 工具参数。
 * @returns 工具结果。
 */
export function executeAddAgentTeamMemberForTool(
    context: DeepAgentsToolExecutionContext,
    arg: {
        teamId: string;
        agentId: string;
        role?: string;
    },
): DeepAgentsToolExecutionResult {
    return {
        outputText: JSON.stringify(
            executeAddAgentTeamMemberTool(
                {
                    database: context.input.database,
                    events: context.input.events,
                    sessionId: context.input.sent.sessionId,
                    turnId: context.input.sent.turnId,
                    taskId: context.input.sent.taskId,
                    creatorAgentId: "main",
                    toolCallId: null,
                },
                {
                    teamId: arg.teamId,
                    agentId: arg.agentId,
                    role: arg.role,
                },
            ),
        ),
        status: "completed",
    };
}

/**
 * executeRemoveAgentTeamMemberForTool：执行移除 team 成员 helper。
 *
 * @param context 当前工具执行上下文。
 * @param arg 工具参数。
 * @returns 工具结果。
 */
export function executeRemoveAgentTeamMemberForTool(
    context: DeepAgentsToolExecutionContext,
    arg: {
        teamId: string;
        agentId: string;
    },
): DeepAgentsToolExecutionResult {
    return {
        outputText: JSON.stringify(
            executeRemoveAgentTeamMemberTool(
                {
                    database: context.input.database,
                    events: context.input.events,
                    sessionId: context.input.sent.sessionId,
                    turnId: context.input.sent.turnId,
                    taskId: context.input.sent.taskId,
                    creatorAgentId: "main",
                    toolCallId: null,
                },
                {
                    teamId: arg.teamId,
                    agentId: arg.agentId,
                },
            ),
        ),
        status: "completed",
    };
}
