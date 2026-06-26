import {z} from "zod/v3";

import {
    EVENT_TYPES,
} from "@zhixin/shared";

import {createDataAccess} from "../data-access/index.js";
import {
    type AgentTeamToolScope,
    appendAgentTeamToolEvent,
    assertEnabledLongTermAgent,
    assertMainAgentCreator,
    createTeamMemberId,
} from "./agent-team-tool-shared.js";
import {
    type DeepAgentsToolExecutionContext,
} from "./deepagents-tool-runtime.js";
import {formatCenterLocalDateTime} from "../time.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";
import {BaseAgentTeamStructuredTool} from "./BaseAgentTeamStructuredTool.js";

/**
 * ADD_AGENT_TEAM_MEMBER_SCHEMA：添加 team 成员参数 schema。
 */
export const ADD_AGENT_TEAM_MEMBER_SCHEMA = z.object({
    teamId: z.string(),
    agentId: z.string(),
    role: z.string().optional(),
});

/**
 * AddAgentTeamMemberStructuredTool：添加 team 成员结构化工具。
 */
export class AddAgentTeamMemberStructuredTool extends BaseAgentTeamStructuredTool<typeof ADD_AGENT_TEAM_MEMBER_SCHEMA> {
    /** description: 工具说明。 */
    override description = "添加会话 team 成员。";
    /** schema: 添加 team 成员参数。 */
    override schema = ADD_AGENT_TEAM_MEMBER_SCHEMA;

    /**
     * constructor：创建添加 team 成员结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "add-agent-team-member",
            toModelSafeToolName("add-agent-team-member"),
        );
    }

    /**
     * executeTool：执行添加 team 成员。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override executeAgentTeamTool(
        scope: AgentTeamToolScope,
        arg: z.output<typeof ADD_AGENT_TEAM_MEMBER_SCHEMA>,
    ): Record<string, unknown> {
        return executeAddAgentTeamMemberInStructuredTool(
            scope,
            arg,
        );
    }
}

/**
 * executeAddAgentTeamMemberInStructuredTool：在结构化工具内直接执行添加 team 成员。
 *
 * @param scope team 工具公共上下文。
 * @param input 工具输入。
 * @returns 添加结果。
 */
function executeAddAgentTeamMemberInStructuredTool(
    scope: AgentTeamToolScope,
    input: {
        teamId: string;
        agentId: string;
        role?: string;
    },
): {
    /** added: 是否新增成员关系。 */
    added: boolean;
    /** agentName: 成员智能体名称。 */
    agentName: string;
} {
    assertMainAgentCreator(scope.creatorAgentId);
    const agentName = assertEnabledLongTermAgent(
        scope.database,
        input.agentId,
    );
    const dataAccess = createDataAccess(scope.database);
    const exists = dataAccess.agentTeams.findMember(
        input.teamId,
        input.agentId,
    );
    if (!exists) {
        dataAccess.agentTeams.addMember({
            memberId: createTeamMemberId(),
            teamId: input.teamId,
            agentId: input.agentId,
            role: input.role ?? "member",
            addedAt: formatCenterLocalDateTime(),
        });
    }
    appendAgentTeamToolEvent(
        scope,
        {
            eventType: EVENT_TYPES.AGENT_TEAM_MEMBER_ADDED,
            title: `加入智能体：${agentName}`,
            summary: exists
                ? "该长期智能体已经在 team 中。"
                : "已把长期智能体加入 team。",
            payload: {
                teamId: input.teamId,
                agentId: input.agentId,
                agentName,
                added: !exists,
            },
        },
    );
    return {
        added: !exists,
        agentName,
    };
}
