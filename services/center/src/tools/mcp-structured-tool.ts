import {z} from "zod/v3";

import {
    type DeepAgentsToolExecutionContext,
    type DeepAgentsToolExecutionResult,
    CenterStructuredToolBase,
} from "./deepagents-tool-runtime.js";
import {
    type McpToolExecutionRequest,
    executeMcpTool,
} from "./mcp-tool-executor.js";

/**
 * MCP_TOOL_SCHEMA：动态 MCP 工具参数 schema。
 */
export const MCP_TOOL_SCHEMA = z.record(z.unknown());

/**
 * DynamicMcpStructuredTool：动态 MCP 结构化工具。
 */
export class DynamicMcpStructuredTool extends CenterStructuredToolBase<typeof MCP_TOOL_SCHEMA> {
    /** description: 工具说明。 */
    override description: string;
    /** schema: MCP 参数对象。 */
    override schema = MCP_TOOL_SCHEMA;
    /** serverId: MCP Server ID。 */
    private readonly serverId: string;
    /** innerToolName: MCP 内部工具名。 */
    private readonly innerToolName: string;

    /**
     * constructor：创建动态 MCP 结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     * @param modelToolName 模型可见工具名。
     * @param description 工具说明。
     * @param serverId MCP Server ID。
     * @param innerToolName MCP 内部工具名。
     */
    constructor(
        context: DeepAgentsToolExecutionContext,
        modelToolName: string,
        description: string,
        serverId: string,
        innerToolName: string,
    ) {
        super(
            context,
            "builtin.mcp.call",
            modelToolName,
        );
        this.description = description;
        this.serverId = serverId;
        this.innerToolName = innerToolName;
    }

    /**
     * executeTool：执行动态 MCP 工具。
     *
     * @param arg 工具参数。
     * @param toolCallId 当前工具调用 ID。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof MCP_TOOL_SCHEMA>,
        toolCallId: string,
    ): Promise<DeepAgentsToolExecutionResult> {
        const request: McpToolExecutionRequest = {
            toolCallId,
            serverId: this.serverId,
            toolName: this.innerToolName,
            arguments: arg,
            inputSummary: `调用 MCP ${this.serverId}.${this.innerToolName}`,
        };
        const result = await executeMcpTool(
            this.context.input.events,
            this.context.centerDirectory,
            this.context.input.sent.sessionId,
            this.context.input.sent.taskId,
            this.context.input.sent.turnId,
            request,
        );
        return {
            outputText: result.status === "completed"
                ? result.outputSummary || "工具没有输出。"
                : result.failureReason ?? "工具执行失败。",
            status: result.status,
        };
    }
}
