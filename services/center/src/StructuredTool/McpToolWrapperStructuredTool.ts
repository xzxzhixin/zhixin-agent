import type {
    StructuredToolInterface,
    ToolInputSchemaBase,
    ToolInputSchemaOutputType,
} from "@langchain/core/tools";

import {
    EVENT_SCOPE_TYPES,
    EVENT_TYPES,
    TASK_STATUSES,
} from "@zhixin/shared";

import {CenterStructuredToolBase} from "./CenterStructuredToolBase.js";
import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {
    type McpToolNormalizedResult,
    normalizeMcpToolResult,
} from "./McpToolResultNormalizer.js";

/** MCP_TOOL_INTERNAL_TOOL_ID：官方 MCP adapter 工具统一继承的中心服务权限 ID。 */
export const MCP_TOOL_INTERNAL_TOOL_ID = "builtin.mcp.call";

/** McpToolWrapperStructuredTool：中心服务对官方 MCP adapter tool 的审计包装。 */
export class McpToolWrapperStructuredTool extends CenterStructuredToolBase<ToolInputSchemaBase> {
    /** description: 复用官方 adapter tool 描述，不做额外增强。 */
    override description: string;
    /** schema: 复用官方 adapter tool schema。 */
    override schema: ToolInputSchemaBase;
    /** adapterTool: 官方 adapter 返回的 LangChain tool。 */
    private readonly adapterTool: StructuredToolInterface;

    /**
     * constructor：创建 MCP adapter 工具包装。
     *
     * @param context 当前轮次工具执行上下文。
     * @param adapterTool 官方 adapter 返回的 LangChain tool。
     */
    constructor(
        context: DeepAgentsToolExecutionContext,
        adapterTool: StructuredToolInterface,
    ) {
        super(
            context,
            MCP_TOOL_INTERNAL_TOOL_ID,
            adapterTool.name,
        );
        this.adapterTool = adapterTool;
        this.description = adapterTool.description;
        this.schema = adapterTool.schema;
    }

    /**
     * executeTool：调用官方 adapter tool 并归一化返回文本。
     *
     * @param arg 模型传入的 MCP 工具参数。
     * @param toolCallId 当前工具调用 ID。
     * @returns 工具执行结果。
     */
    protected override async executeTool(
        arg: ToolInputSchemaOutputType<ToolInputSchemaBase>,
        toolCallId: string,
    ): Promise<DeepAgentsToolExecutionResult> {
        this.appendMcpStartedEvent(
            arg as Record<string, unknown>,
            toolCallId,
        );
        try {
            const output = await this.adapterTool.invoke(arg);
            const normalizedResult = normalizeMcpToolResult(output);
            this.appendMcpCompletedEvent(
                normalizedResult,
                toolCallId,
            );
            return {
                outputText: normalizedResult.modelText,
                status: TASK_STATUSES.COMPLETED,
            };
        } catch (error) {
            const failureReason = error instanceof Error
                ? error.message
                : "MCP_ADAPTER_TOOL_CALL_FAILED";
            this.appendMcpFailedEvent(
                failureReason,
                toolCallId,
            );
            return {
                outputText: failureReason,
                status: TASK_STATUSES.FAILED,
            };
        }
    }

    /**
     * appendMcpStartedEvent：写入 MCP 调用开始事件。
     *
     * @param arg 工具参数。
     * @param toolCallId 当前工具调用 ID。
     * @returns 没有返回值。
     */
    private appendMcpStartedEvent(
        arg: Record<string, unknown>,
        toolCallId: string,
    ): void {
        this.context.input.events.append({
            eventType: EVENT_TYPES.TOOL_MCP_STARTED,
            scopeType: EVENT_SCOPE_TYPES.TOOL,
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: TASK_STATUSES.RUNNING,
            title: "MCP 调用开始",
            summary: `调用 MCP 工具 ${this.name}`,
            payload: {
                toolId: MCP_TOOL_INTERNAL_TOOL_ID,
                toolKind: "mcp",
                toolCallId,
                toolName: this.name,
                argumentsJson: arg,
            },
        });
    }

    /**
     * appendMcpCompletedEvent：写入 MCP 调用完成事件。
     *
     * @param normalizedResult 规范化后的 MCP 工具结果。
     * @param toolCallId 当前工具调用 ID。
     * @returns 没有返回值。
     */
    private appendMcpCompletedEvent(
        normalizedResult: McpToolNormalizedResult,
        toolCallId: string,
    ): void {
        this.context.input.events.append({
            eventType: EVENT_TYPES.TOOL_MCP_COMPLETED,
            scopeType: EVENT_SCOPE_TYPES.TOOL,
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: TASK_STATUSES.COMPLETED,
            title: "MCP 调用完成",
            summary: normalizedResult.uiSummary,
            payload: {
                toolId: MCP_TOOL_INTERNAL_TOOL_ID,
                toolKind: "mcp",
                toolCallId,
                toolName: this.name,
                outputSummary: normalizedResult.modelText.slice(
                    0,
                    2000,
                ),
                auditArtifact: normalizedResult.auditArtifact,
            },
        });
    }

    /**
     * appendMcpFailedEvent：写入 MCP 调用失败事件。
     *
     * @param failureReason 失败原因。
     * @param toolCallId 当前工具调用 ID。
     * @returns 没有返回值。
     */
    private appendMcpFailedEvent(
        failureReason: string,
        toolCallId: string,
    ): void {
        this.context.input.events.append({
            eventType: EVENT_TYPES.TOOL_MCP_FAILED,
            scopeType: EVENT_SCOPE_TYPES.TOOL,
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: TASK_STATUSES.FAILED,
            title: "MCP 调用失败",
            summary: failureReason,
            payload: {
                toolId: MCP_TOOL_INTERNAL_TOOL_ID,
                toolKind: "mcp",
                toolCallId,
                toolName: this.name,
                failureReason,
            },
        });
    }
}
