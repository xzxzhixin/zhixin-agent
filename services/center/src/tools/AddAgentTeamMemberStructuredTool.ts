import {z} from "zod/v3";

import {executeAddAgentTeamMemberForTool} from "./agent-team-tool-executors.js";
import {
    CenterStructuredToolBase,
    type DeepAgentsToolExecutionContext,
    type DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";

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
export class AddAgentTeamMemberStructuredTool extends CenterStructuredToolBase<typeof ADD_AGENT_TEAM_MEMBER_SCHEMA> {
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
    protected override async executeTool(
        arg: z.output<typeof ADD_AGENT_TEAM_MEMBER_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        return executeAddAgentTeamMemberForTool(
            this.context,
            arg,
        );
    }
}
