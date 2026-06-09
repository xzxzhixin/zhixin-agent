import {createDataAccess} from "../data-access/index.js";
import {
    type AgentTeamToolScope,
    appendAgentTeamToolEvent,
    assertMainAgentCreator,
} from "./agent-team-tool-shared.js";

/**
 * DisbandAgentTeamToolInput：解散会话级 team 工具输入。
 */
export interface DisbandAgentTeamToolInput {
    /** teamId: 要物理删除的 team ID。 */
    teamId: string;
}

/**
 * executeDisbandAgentTeamTool：物理删除会话级 team 和成员关系。
 *
 * @param scope team 工具公共上下文。
 * @param input 工具输入。
 * @returns 删除结果。
 */
export function executeDisbandAgentTeamTool(
    scope: AgentTeamToolScope,
    input: DisbandAgentTeamToolInput,
): {
    /** deleted: 是否删除了 team 记录。 */
    deleted: boolean;
} {
    assertMainAgentCreator(scope.creatorAgentId);
    const deletedCount = createDataAccess(scope.database).agentTeams.deleteTeam(input.teamId);
    appendAgentTeamToolEvent(
        scope,
        {
            eventType: "agent.team.disbanded",
            title: "解散协作 team",
            summary: deletedCount > 0
                ? "已物理删除 team 记录和成员关系。"
                : "未找到要解散的 team。",
            payload: {
                teamId: input.teamId,
                deleted: deletedCount > 0,
            },
        },
    );
    return {
        deleted: deletedCount > 0,
    };
}
