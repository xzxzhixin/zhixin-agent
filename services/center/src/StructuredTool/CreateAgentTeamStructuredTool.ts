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
    createTeamId,
    createTeamMemberId,
} from "./agent-team-tool-shared.js";
import {
    type DeepAgentsToolExecutionContext,
} from "./deepagents-tool-runtime.js";
import {formatCenterLocalDateTime} from "../time.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";
import {BaseAgentTeamStructuredTool} from "./BaseAgentTeamStructuredTool.js";

/**
 * CREATE_AGENT_TEAM_SCHEMA：创建 team 参数 schema。
 */
export const CREATE_AGENT_TEAM_SCHEMA = z.object({
    name: z.string(),
    description: z.string().optional(),
    memberAgentIds: z.array(z.string()),
});

/**
 * CreateAgentTeamStructuredTool：创建 team 结构化工具。
 */
export class CreateAgentTeamStructuredTool extends BaseAgentTeamStructuredTool<typeof CREATE_AGENT_TEAM_SCHEMA> {
    /** description: 工具说明。 */
    override description = "创建会话 team。";
    /** schema: 创建 team 参数。 */
    override schema = CREATE_AGENT_TEAM_SCHEMA;

    /**
     * constructor：创建 team 结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "create-agent-team",
            toModelSafeToolName("create-agent-team"),
        );
    }

    /**
     * executeTool：执行创建 team。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override executeAgentTeamTool(
        scope: AgentTeamToolScope,
        arg: z.output<typeof CREATE_AGENT_TEAM_SCHEMA>,
    ): Record<string, unknown> {
        return executeCreateAgentTeamInStructuredTool(
            scope,
            arg,
        );
    }
}

/**
 * executeCreateAgentTeamInStructuredTool：在结构化工具内直接执行创建 team。
 *
 * @param scope team 工具公共上下文。
 * @param input 工具输入。
 * @returns 创建结果。
 */
function executeCreateAgentTeamInStructuredTool(
    scope: AgentTeamToolScope,
    input: {
        name: string;
        description?: string;
        memberAgentIds: string[];
    },
): {
    /** teamId: 创建出的 team ID。 */
    teamId: string;
    /** memberCount: 初始成员数量。 */
    memberCount: number;
} {
    assertMainAgentCreator(scope.creatorAgentId);
    const dataAccess = createDataAccess(scope.database);
    const now = formatCenterLocalDateTime();
    const teamId = createTeamId();
    dataAccess.agentTeams.createTeam({
        teamId,
        sessionId: scope.sessionId,
        name: input.name,
        description: input.description ?? null,
        createdByAgentId: "main",
        createdAt: now,
        updatedAt: now,
    });

    for (const agentId of input.memberAgentIds) {
        assertEnabledLongTermAgent(
            scope.database,
            agentId,
        );
        if (dataAccess.agentTeams.findMember(
            teamId,
            agentId,
        )) {
            continue;
        }
        dataAccess.agentTeams.addMember({
            memberId: createTeamMemberId(),
            teamId,
            agentId,
            role: "member",
            addedAt: now,
        });
    }

    appendAgentTeamToolEvent(
        scope,
        {
            eventType: EVENT_TYPES.AGENT_TEAM_CREATED,
            title: "创建协作 team",
            summary: `已创建会话 team：${input.name}`,
            payload: {
                teamId,
                name: input.name,
                memberAgentIds: input.memberAgentIds,
            },
        },
    );

    return {
        teamId,
        memberCount: input.memberAgentIds.length,
    };
}
