import {z} from "zod/v3";

import {executeRemoveAgentTeamMemberForTool} from "./agent-team-tool-executors.js";
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
        return executeRemoveAgentTeamMemberForTool(
            this.context,
            arg,
        );
    }
}
