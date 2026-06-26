import {z} from "zod/v3";

import {
    EVENT_TYPES,
} from "@zhixin/shared";

import {createDataAccess} from "../data-access/index.js";
import {
    type AgentTeamToolScope,
    appendAgentTeamToolEvent,
    assertMainAgentCreator,
} from "./agent-team-tool-shared.js";
import {
    type DeepAgentsToolExecutionContext,
} from "./deepagents-tool-runtime.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";
import {BaseAgentTeamStructuredTool} from "./BaseAgentTeamStructuredTool.js";

/**
 * DISBAND_AGENT_TEAM_SCHEMA：解散 team 参数 schema。
 */
export const DISBAND_AGENT_TEAM_SCHEMA = z.object({
    teamId: z.string(),
});

/**
 * DisbandAgentTeamStructuredTool：解散 team 结构化工具。
 */
export class DisbandAgentTeamStructuredTool extends BaseAgentTeamStructuredTool<typeof DISBAND_AGENT_TEAM_SCHEMA> {
    /** description: 工具说明。 */
    override description = "解散会话 team。";
    /** schema: 解散 team 参数。 */
    override schema = DISBAND_AGENT_TEAM_SCHEMA;

    /**
     * constructor：创建解散 team 结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "disband-agent-team",
            toModelSafeToolName("disband-agent-team"),
        );
    }

    /**
     * executeTool：执行解散 team。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override executeAgentTeamTool(
        scope: AgentTeamToolScope,
        arg: z.output<typeof DISBAND_AGENT_TEAM_SCHEMA>,
    ): Record<string, unknown> {
        return executeDisbandAgentTeamInStructuredTool(
            scope,
            arg,
        );
    }
}

/**
 * executeDisbandAgentTeamInStructuredTool：在结构化工具内直接执行解散 team。
 *
 * @param scope team 工具公共上下文。
 * @param input 工具输入。
 * @returns 删除结果。
 */
function executeDisbandAgentTeamInStructuredTool(
    scope: AgentTeamToolScope,
    input: {
        teamId: string;
    },
): {
    /** deleted: 是否删除了 team 记录。 */
    deleted: boolean;
} {
    assertMainAgentCreator(scope.creatorAgentId);
    const deletedCount = createDataAccess(scope.database).agentTeams.deleteTeam(input.teamId);
    appendAgentTeamToolEvent(
        scope,
        {
            eventType: EVENT_TYPES.AGENT_TEAM_DISBANDED,
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
