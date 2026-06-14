import {z} from "zod/v3";

import {executeCreateSubAgentForTool} from "./agent-creation-tool-executors.js";
import {
    CenterStructuredToolBase,
    type DeepAgentsToolExecutionContext,
    type DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";

/**
 * CREATE_SUB_AGENT_SCHEMA：创建子智能体参数 schema。
 */
export const CREATE_SUB_AGENT_SCHEMA = z.object({
    name: z.string(),
    parentAgentId: z.string().optional(),
    parentAgentKind: z.enum([
        "main",
        "long-term",
        "sub",
    ]).optional(),
});

/**
 * CreateSubAgentStructuredTool：创建子智能体结构化工具。
 */
export class CreateSubAgentStructuredTool extends CenterStructuredToolBase<typeof CREATE_SUB_AGENT_SCHEMA> {
    /** description: 工具说明。 */
    override description = "创建子智能体。";
    /** schema: 创建子智能体参数。 */
    override schema = CREATE_SUB_AGENT_SCHEMA;

    /**
     * constructor：创建子智能体结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "builtin.agent.createSubAgent",
            toModelSafeToolName("builtin.agent.createSubAgent"),
        );
    }

    /**
     * executeTool：执行创建子智能体。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof CREATE_SUB_AGENT_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        return executeCreateSubAgentForTool(
            this.context,
            arg,
        );
    }
}
