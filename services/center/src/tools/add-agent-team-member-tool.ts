import {createDataAccess} from "../data-access/index.js";
import {
    type AgentTeamToolScope,
    appendAgentTeamToolEvent,
    assertEnabledLongTermAgent,
    assertMainAgentCreator,
    createTeamMemberId,
} from "./agent-team-tool-shared.js";

/**
 * AddAgentTeamMemberToolInput：添加 team 成员工具输入。
 */
export interface AddAgentTeamMemberToolInput {
    /** teamId: 目标 team ID。 */
    teamId: string;
    /** agentId: 要加入的启用长期智能体 ID。 */
    agentId: string;
    /** role: 成员角色；未指定时为 member。 */
    role?: string;
}

/**
 * executeAddAgentTeamMemberTool：添加启用长期智能体到会话 team。
 *
 * @param scope team 工具公共上下文。
 * @param input 工具输入。
 * @returns 添加结果。
 */
export function executeAddAgentTeamMemberTool(
    scope: AgentTeamToolScope,
    input: AddAgentTeamMemberToolInput,
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
            addedAt: new Date().toISOString(),
        });
    }
    appendAgentTeamToolEvent(
        scope,
        {
            eventType: "agent.team.member.added",
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
