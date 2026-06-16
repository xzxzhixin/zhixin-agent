import {z} from "zod/v3";

import {executeCreateLongTermAgentForTool} from "./agent-creation-tool-executors.js";
import {CenterStructuredToolBase} from "./CenterStructuredToolBase.js";
import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";

/**
 * CREATE_LONG_TERM_AGENT_SCHEMA：创建长期智能体参数 schema。
 */
export const CREATE_LONG_TERM_AGENT_SCHEMA = z.object({
    name: z.string(),
    roleDescription: z.string(),
    capabilityBoundary: z.string().optional(),
});

/**
 * CreateLongTermAgentStructuredTool：创建长期智能体结构化工具。
 */
export class CreateLongTermAgentStructuredTool extends CenterStructuredToolBase<typeof CREATE_LONG_TERM_AGENT_SCHEMA> {
    /** description: 工具说明。 */
    override description = "创建长期智能体。";
    /** schema: 创建长期智能体参数。 */
    override schema = CREATE_LONG_TERM_AGENT_SCHEMA;

    /**
     * constructor：创建长期智能体结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "builtin.agent.createLongTerm",
            toModelSafeToolName("builtin.agent.createLongTerm"),
        );
    }

    /**
     * executeTool：执行创建长期智能体。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof CREATE_LONG_TERM_AGENT_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        return executeCreateLongTermAgentForTool(
            this.context,
            arg,
        );
    }
}
