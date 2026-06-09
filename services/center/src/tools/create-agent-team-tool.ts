import {createDataAccess} from "../data-access/index.js";
import {
    type AgentTeamToolScope,
    appendAgentTeamToolEvent,
    assertEnabledLongTermAgent,
    assertMainAgentCreator,
    createTeamId,
    createTeamMemberId,
} from "./agent-team-tool-shared.js";

/**
 * CreateAgentTeamToolInput：创建会话级 team 工具输入。
 *
 * 来源：主智能体模型工具调用。
 * 含义：描述要在当前会话中创建的 team 和初始长期智能体成员。
 * 格式：名称、说明和长期智能体 ID 列表。
 * 默认值：description 可为空。
 * 约束：成员只能是启用状态的长期智能体。
 */
export interface CreateAgentTeamToolInput {
    /** name: team 展示名称。 */
    name: string;
    /** description: team 说明。 */
    description?: string | null;
    /** memberAgentIds: 初始长期智能体成员 ID 列表。 */
    memberAgentIds: string[];
}

/**
 * executeCreateAgentTeamTool：创建跟随会话生命周期的 team。
 *
 * @param scope team 工具公共上下文。
 * @param input 工具输入。
 * @returns 创建出的 team ID 和成员数量。
 */
export function executeCreateAgentTeamTool(
    scope: AgentTeamToolScope,
    input: CreateAgentTeamToolInput,
): {
    /** teamId: 创建出的 team ID。 */
    teamId: string;
    /** memberCount: 初始成员数量。 */
    memberCount: number;
} {
    assertMainAgentCreator(scope.creatorAgentId);
    const dataAccess = createDataAccess(scope.database);
    const now = new Date().toISOString();
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
            eventType: "agent.team.created",
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
