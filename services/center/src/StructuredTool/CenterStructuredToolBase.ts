import {randomUUID} from "node:crypto";

import {
    StructuredTool,
    type ToolInputSchemaBase,
    type ToolInputSchemaOutputType,
} from "@langchain/core/tools";

import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {throwIfTurnRuntimeAborted} from "../domain/turn-runtime-cancel-registry.js";

/**
 * CenterStructuredToolBase：中心服务 Deep Agents 结构化工具基类。
 */
export abstract class CenterStructuredToolBase<
    SchemaT extends ToolInputSchemaBase,
> extends StructuredTool<SchemaT> {
    /** description: 工具说明。 */
    abstract override description: string;
    /** schema: 工具参数 schema。 */
    abstract override schema: SchemaT;
    /** internalToolId: 中心服务内部工具 ID。 */
    protected readonly internalToolId: string;
    /** context: 当前轮次工具执行上下文。 */
    protected readonly context: DeepAgentsToolExecutionContext;

    /**
     * constructor：初始化结构化工具基类。
     *
     * @param context 当前轮次工具执行上下文。
     * @param internalToolId 中心服务内部工具 ID。
     * @param modelToolName 模型可见工具名。
     */
    protected constructor(
        context: DeepAgentsToolExecutionContext,
        internalToolId: string,
        modelToolName: string,
    ) {
        super();
        this.context = context;
        this.internalToolId = internalToolId;
        this.name = modelToolName;
    }

    /**
     * name：模型可见工具名。
     */
    override name: string;

    /**
     * _call：统一包装模型请求与结果回填事件。
     *
     * @param arg 工具参数。
     * @returns 返回给模型的结果文本。
     */
    protected override async _call(
        arg: ToolInputSchemaOutputType<SchemaT>,
    ): Promise<string> {
        throwIfTurnRuntimeAborted(this.context.runtimeSignal);
        const toolCallId = randomUUID();
        this.context.input.events.append({
            eventType: "model.tool.requested",
            scopeType: "tool",
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: "running",
            title: "模型请求工具",
            summary: `模型请求调用 ${this.name}`,
            payload: {
                toolId: this.internalToolId,
                toolCallId,
                toolName: this.name,
                argumentsJson: arg as Record<string, unknown>,
            },
        });

        const result = await this.executeTool(
            arg,
            toolCallId,
        );
        throwIfTurnRuntimeAborted(this.context.runtimeSignal);
        this.throwIfRepeatedToolFailure(
            arg,
            result,
            toolCallId,
        );

        this.context.input.events.append({
            eventType: "model.tool.result.appended",
            scopeType: "model",
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: "completed",
            title: "工具结果回填模型",
            summary: `已回填工具结果：${this.name}`,
            payload: {
                toolId: this.internalToolId,
                toolCallId,
                toolName: this.name,
                status: result.status,
                resultSummary: result.outputText.slice(0, 240),
            },
        });

        return result.outputText;
    }

    /**
     * throwIfRepeatedToolFailure：阻断同一轮次内同一工具、同一参数、同一错误的重复失败。
     *
     * @param arg 工具参数。
     * @param result 工具执行结果。
     * @param toolCallId 当前工具调用 ID。
     * @returns 没有返回值；重复失败时抛出错误让轮次失败收尾。
     */
    private throwIfRepeatedToolFailure(
        arg: ToolInputSchemaOutputType<SchemaT>,
        result: DeepAgentsToolExecutionResult,
        toolCallId: string,
    ): void {
        if (result.status !== "failed") {
            return;
        }
        const failureFingerprint = createToolFailureFingerprint(
            this.name,
            arg as Record<string, unknown>,
            result.outputText,
        );
        const failureCount = (this.context.toolFailureCounts.get(failureFingerprint) ?? 0) + 1;
        this.context.toolFailureCounts.set(
            failureFingerprint,
            failureCount,
        );
        if (failureCount < 2) {
            return;
        }
        const failureReason = `TOOL_REPEATED_FAILURE:${this.name}`;
        this.context.input.events.append({
            eventType: "model.tool.repeated_failure_blocked",
            scopeType: "tool",
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: "failed",
            title: "工具重复失败阻断",
            summary: "同一工具使用相同参数返回相同错误，已终止本轮以避免循环重试。",
            payload: {
                toolId: this.internalToolId,
                toolCallId,
                toolName: this.name,
                failureCount,
                failureReason,
                resultSummary: result.outputText.slice(
                    0,
                    240,
                ),
            },
        });
        throw new Error(failureReason);
    }

    /**
     * executeTool：执行具体工具逻辑。
     *
     * @param arg 工具参数。
     * @param toolCallId 当前工具调用 ID。
     * @returns 工具结果。
     */
    protected abstract executeTool(
        arg: ToolInputSchemaOutputType<SchemaT>,
        toolCallId: string,
    ): Promise<DeepAgentsToolExecutionResult>;
}

/**
 * createToolFailureFingerprint：创建轮次内工具失败指纹。
 *
 * @param toolName 模型可见工具名。
 * @param arg 工具参数。
 * @param outputText 工具错误输出。
 * @returns 可用于 Map 计数的稳定字符串。
 */
function createToolFailureFingerprint(
    toolName: string,
    arg: Record<string, unknown>,
    outputText: string,
): string {
    return JSON.stringify({
        toolName,
        arg,
        outputText,
    });
}
