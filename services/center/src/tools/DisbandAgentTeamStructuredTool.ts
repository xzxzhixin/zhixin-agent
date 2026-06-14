import {z} from "zod/v3";

import {executeDisbandAgentTeamForTool} from "./agent-team-tool-executors.js";
import {
    CenterStructuredToolBase,
    type DeepAgentsToolExecutionContext,
    type DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";

/**
 * DISBAND_AGENT_TEAM_SCHEMA：解散 team 参数 schema。
 */
export const DISBAND_AGENT_TEAM_SCHEMA = z.object({
    teamId: z.string(),
});

/**
 * DisbandAgentTeamStructuredTool：解散 team 结构化工具。
 */
export class DisbandAgentTeamStructuredTool extends CenterStructuredToolBase<typeof DISBAND_AGENT_TEAM_SCHEMA> {
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
    protected override async executeTool(
        arg: z.output<typeof DISBAND_AGENT_TEAM_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        return executeDisbandAgentTeamForTool(
            this.context,
            arg,
        );
    }
}
