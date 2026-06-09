import {createDataAccess} from "../data-access/index.js";
import {
    type AgentTeamToolScope,
    appendAgentTeamToolEvent,
    assertEnabledLongTermAgent,
    assertMainAgentCreator,
} from "./agent-team-tool-shared.js";

/**
 * RemoveAgentTeamMemberToolInput：移除 team 成员工具输入。
 */
export interface RemoveAgentTeamMemberToolInput {
    /** teamId: 目标 team ID。 */
    teamId: string;
    /** agentId: 要移除的长期智能体 ID。 */
    agentId: string;
}

/**
 * executeRemoveAgentTeamMemberTool：从会话 team 移除长期智能体。
 *
 * @param scope team 工具公共上下文。
 * @param input 工具输入。
 * @returns 移除结果。
 */
export function executeRemoveAgentTeamMemberTool(
    scope: AgentTeamToolScope,
    input: RemoveAgentTeamMemberToolInput,
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
