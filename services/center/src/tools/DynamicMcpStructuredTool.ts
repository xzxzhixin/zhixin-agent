import type {ToolInputSchemaBase} from "@langchain/core/tools";

import {CenterStructuredToolBase} from "./CenterStructuredToolBase.js";
import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {
    type McpToolExecutionRequest,
    executeMcpTool,
} from "./mcp-tool-executor.js";
import {isRecord} from "@zhixin/shared";

/** McpToolInput：MCP 动态工具参数对象，来源于 MCP tools/list 返回的 inputSchema。 */
export type McpToolInput = Record<string, unknown>;

/**
 * DynamicMcpStructuredTool：动态 MCP 结构化工具。
 */
export class DynamicMcpStructuredTool extends CenterStructuredToolBase<ToolInputSchemaBase> {
    /** description: 工具说明。 */
    override description: string;
    /** schema: 模型可见 MCP 参数 schema，来源于 MCP Server 的 tools/list 结果。 */
    override schema: ToolInputSchemaBase;
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
     * @param inputJsonSchema MCP tools/list 返回的输入 JSON Schema。
     */
    constructor(
        context: DeepAgentsToolExecutionContext,
        modelToolName: string,
        description: string,
        serverId: string,
        innerToolName: string,
        inputJsonSchema: Record<string, unknown>,
    ) {
        super(
            context,
            "builtin.mcp.call",
            modelToolName,
        );
        this.description = description;
        this.schema = createMcpToolSchema(inputJsonSchema);
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
        arg: McpToolInput,
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

/**
 * createMcpToolSchema：把 MCP 原始 JSON Schema 规范成 LangChain 可直接暴露给模型的工具 schema。
 *
 * @param inputJsonSchema MCP tools/list 返回的输入 JSON Schema。
 * @returns LangChain StructuredTool 支持的 JSON Schema；无参数工具返回明确空对象。
 */
export function createMcpToolSchema(inputJsonSchema: Record<string, unknown>): ToolInputSchemaBase {
    const schemaType = inputJsonSchema.type;
    if (schemaType !== "object") {
        return {
            type: "object",
            properties: {},
            additionalProperties: true,
        };
    }

    const properties = isRecord(inputJsonSchema.properties)
        ? inputJsonSchema.properties
        : {};
    return {
        ...inputJsonSchema,
        type: "object",
        properties,
    };
}
