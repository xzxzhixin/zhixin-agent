import {randomUUID} from "node:crypto";

import {
    StructuredTool,
    type CallbackManagerForToolRun,
    type ToolInputSchemaBase,
    type ToolInputSchemaOutputType,
} from "@langchain/core/tools";
import type {RunnableConfig} from "@langchain/core/runnables";

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
     * @param runManager LangChain 工具运行管理器。
     * @param parentConfig LangChain 传入的父级运行配置，包含原始模型工具调用 ID。
     * @returns 返回给模型的结果文本。
     */
    protected override async _call(
        arg: ToolInputSchemaOutputType<SchemaT>,
        runManager?: CallbackManagerForToolRun,
        parentConfig?: RunnableConfig,
    ): Promise<string> {
        throwIfTurnRuntimeAborted(this.context.runtimeSignal);
        const runtimeToolCallId = resolveRuntimeToolCallId(
            runManager,
            parentConfig,
        );
        const toolCallId = runtimeToolCallId || randomUUID();
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
 * resolveRuntimeToolCallId：优先继承 Deep Agents/LangChain 的原始工具调用 ID。
 *
 * @param runManager LangChain 工具运行管理器。
 * @param parentConfig LangChain 父级运行配置。
 * @returns 原始模型工具调用 ID；不存在时返回空字符串。
 */
function resolveRuntimeToolCallId(
    runManager: CallbackManagerForToolRun | undefined,
    parentConfig: RunnableConfig | undefined,
): string {
    return readNestedString(
        parentConfig,
        [
            "toolCall",
            "id",
        ],
    ) || readNestedString(
        parentConfig,
        [
            "metadata",
            "toolCallId",
        ],
    ) || readNestedString(
        runManager,
        [
            "toolCall",
            "id",
        ],
    );
}

/**
 * readNestedString：按路径读取嵌套字符串字段。
 *
 * @param value 待读取对象。
 * @param path 字段路径。
 * @returns 字段存在且为非空字符串时返回字段值。
 */
function readNestedString(
    value: unknown,
    path: string[],
): string {
    let currentValue = value;
    for (const key of path) {
        if (typeof currentValue !== "object" || currentValue === null) {
            return "";
        }
        currentValue = (currentValue as Record<string, unknown>)[key];
    }
    return typeof currentValue === "string" && currentValue.length > 0
        ? currentValue
        : "";
}
