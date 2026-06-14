import {z} from "zod/v3";

import {executeCreateAgentTeamForTool} from "./agent-team-tool-executors.js";
import {
    CenterStructuredToolBase,
    type DeepAgentsToolExecutionContext,
    type DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";

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
export class CreateAgentTeamStructuredTool extends CenterStructuredToolBase<typeof CREATE_AGENT_TEAM_SCHEMA> {
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
    protected override async executeTool(
        arg: z.output<typeof CREATE_AGENT_TEAM_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        return executeCreateAgentTeamForTool(
            this.context,
            arg,
        );
    }
}
