import {randomUUID} from "node:crypto";

import {
    StructuredTool,
    type StructuredToolInterface,
    type ToolInputSchemaBase,
    type ToolInputSchemaOutputType,
} from "@langchain/core/tools";
import type {z} from "zod/v3";

import {createAgentForTask} from "../agents/index.js";
import type {CenterDatabase} from "../database.js";
import {SessionRepository} from "../data-access/session-repository.js";
import type {CenterEventStore} from "../events.js";
import {extractCenterDirectory, resolveProviderModelRuntime} from "../model-gateway-runtime.js";
import type {
    MemoryQueueState,
    SendMessageResponse,
    SubAgentRuntimeRecord,
} from "../types.js";

/**
 * DeepAgentsAgentRunInput：直接驱动 Deep Agents 原生 agent 的输入。
 */
export interface DeepAgentsAgentRunInput {
    /** database: 中心服务数据库。 */
    database: CenterDatabase;
    /** events: 中心服务事件仓储。 */
    events: CenterEventStore;
    /** sent: 当前轮次身份。 */
    sent: SendMessageResponse;
    /** userText: 用户原始输入。 */
    userText: string;
    /** centerDirectory: 中心目录。 */
    centerDirectory?: string;
    /** memoryQueues: 记忆单写队列。 */
    memoryQueues?: Map<string, MemoryQueueState>;
}

/**
 * DeepAgentsToolExecutionContext：Deep Agents 工具执行上下文。
 */
export interface DeepAgentsToolExecutionContext {
    /** input: 当前轮次输入。 */
    input: DeepAgentsAgentRunInput;
    /** centerDirectory: 当前中心目录。 */
    centerDirectory: string;
    /** executionAgent: 当前执行智能体。 */
    executionAgent: ReturnType<typeof createAgentForTask>;
    /** runtime: 当前模型运行时。 */
    runtime: ReturnType<typeof resolveProviderModelRuntime>;
    /** subAgents: 当前轮次运行期子智能体表。 */
    subAgents: Map<string, SubAgentRuntimeRecord>;
}

/**
 * DeepAgentsToolExecutionResult：工具执行后返回给模型的文本和状态。
 */
export interface DeepAgentsToolExecutionResult {
    /** outputText: 回填给模型的文本。 */
    outputText: string;
    /** status: 工具执行状态。 */
    status: "completed" | "failed";
}

/**
 * createDeepAgentsToolExecutionContext：构造 Deep Agents 工具执行上下文。
 *
 * @param input 当前轮次输入。
 * @returns 已解析的工具执行上下文。
 */
export async function createDeepAgentsToolExecutionContext(
    input: DeepAgentsAgentRunInput,
): Promise<DeepAgentsToolExecutionContext> {
    const centerDirectory = input.centerDirectory ?? extractCenterDirectory(input.database);
    if (!centerDirectory) {
        throw new Error("CENTER_DIRECTORY_NOT_AVAILABLE");
    }
    const task = new SessionRepository(input.database).findTask(input.sent.taskId);
    return {
        input,
        centerDirectory,
        executionAgent: createAgentForTask(task),
        runtime: resolveProviderModelRuntime(
            input.database,
            input.sent.taskId,
        ),
        subAgents: new Map<string, SubAgentRuntimeRecord>(),
    };
}

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
 * DeepAgentsStructuredToolFactory：中间件注册器统一构造工具数组。
 */
export interface DeepAgentsStructuredToolFactory {
    /**
     * buildTools：构造当前轮次可用结构化工具。
     *
     * @returns 结构化工具数组。
     */
    buildTools(): Promise<StructuredToolInterface[]>;
}

/**
 * DeepAgentsStructuredToolSchemaRecord：通用对象 schema 类型别名。
 */
export type DeepAgentsStructuredToolSchemaRecord = z.ZodObject<
    z.ZodRawShape,
    "strip",
    z.ZodTypeAny,
    Record<string, unknown>,
    Record<string, unknown>
>;
