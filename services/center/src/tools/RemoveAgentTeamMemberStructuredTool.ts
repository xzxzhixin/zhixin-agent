import {z} from "zod/v3";

import {createDataAccess} from "../data-access/index.js";
import {
    type AgentTeamToolScope,
    appendAgentTeamToolEvent,
    assertEnabledLongTermAgent,
    assertMainAgentCreator,
} from "./agent-team-tool-shared.js";
import {
    CenterStructuredToolBase,
    type DeepAgentsToolExecutionContext,
    type DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";

/**
 * REMOVE_AGENT_TEAM_MEMBER_SCHEMA：移除 team 成员参数 schema。
 */
export const REMOVE_AGENT_TEAM_MEMBER_SCHEMA = z.object({
    teamId: z.string(),
    agentId: z.string(),
});

/**
 * RemoveAgentTeamMemberStructuredTool：移除 team 成员结构化工具。
 */
export class RemoveAgentTeamMemberStructuredTool extends CenterStructuredToolBase<typeof REMOVE_AGENT_TEAM_MEMBER_SCHEMA> {
    /** description: 工具说明。 */
    override description = "移除会话 team 成员。";
    /** schema: 移除 team 成员参数。 */
    override schema = REMOVE_AGENT_TEAM_MEMBER_SCHEMA;

    /**
     * constructor：创建移除 team 成员结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "remove-agent-team-member",
            toModelSafeToolName("remove-agent-team-member"),
        );
    }

    /**
     * executeTool：执行移除 team 成员。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof REMOVE_AGENT_TEAM_MEMBER_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        const scope = createAgentTeamToolScope(
            this.context,
        );
        const result = executeRemoveAgentTeamMemberInStructuredTool(
            scope,
            arg,
        );
        return {
            outputText: JSON.stringify(result),
            status: "completed",
        };
    }
}

/**
 * createAgentTeamToolScope：从当前工具上下文生成 team 工具公共作用域。
 *
 * @param context 当前工具执行上下文。
 * @returns team 工具公共作用域。
 */
function createAgentTeamToolScope(
    context: DeepAgentsToolExecutionContext,
): AgentTeamToolScope {
    return {
        database: context.input.database,
        events: context.input.events,
        sessionId: context.input.sent.sessionId,
        turnId: context.input.sent.turnId,
        taskId: context.input.sent.taskId,
        creatorAgentId: "main",
        toolCallId: null,
    };
}

/**
 * executeRemoveAgentTeamMemberInStructuredTool：在结构化工具内直接执行移除 team 成员。
 *
 * @param scope team 工具公共上下文。
 * @param input 工具输入。
 * @returns 移除结果。
 */
function executeRemoveAgentTeamMemberInStructuredTool(
    scope: AgentTeamToolScope,
    input: {
        teamId: string;
        agentId: string;
    },
): {
    /** removed: 是否删除了成员关系。 */
    removed: boolean;
    /** agentName: 长期智能体名称。 */
    agentName: string;
} {
    assertMainAgentCreator(scope.creatorAgentId);
    const agentName = assertEnabledLongTermAgent(
        scope.database,
        input.agentId,
    );
    const removedCount = createDataAccess(scope.database).agentTeams.removeMember(
        input.teamId,
        input.agentId,
    );
    appendAgentTeamToolEvent(
        scope,
        {
            eventType: "agent.team.member.removed",
            title: `移除智能体：${agentName}`,
            summary: removedCount > 0
                ? "已从 team 移除该成员。"
                : "该长期智能体不在 team 中。",
            payload: {
                teamId: input.teamId,
                agentId: input.agentId,
                agentName,
                removed: removedCount > 0,
            },
        },
    );
    return {
        removed: removedCount > 0,
        agentName,
    };
}
