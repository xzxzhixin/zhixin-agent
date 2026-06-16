import {
    type StructuredToolInterface,
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
    /** runtimeSignal: 当前轮次运行期取消信号，来源于进程内 AbortController。 */
    runtimeSignal?: AbortSignal;
}

/**
 * DeepAgentsToolExecutionContext：Deep Agents 工具执行上下文。
 */
export interface DeepAgentsToolExecutionContext {
    /** input: 当前轮次输入。 */
    input: DeepAgentsAgentRunInput;
    /** centerDirectory: 当前中心目录。 */
    centerDirectory: string;
    /** projectId: 当前会话绑定项目 ID；个人会话或未绑定项目时为 null。 */
    projectId: string | null;
    /** executionAgent: 当前执行智能体。 */
    executionAgent: ReturnType<typeof createAgentForTask>;
    /** runtime: 当前模型运行时。 */
    runtime: ReturnType<typeof resolveProviderModelRuntime>;
    /** subAgents: 当前轮次运行期子智能体表。 */
    subAgents: Map<string, SubAgentRuntimeRecord>;
    /** toolFailureCounts: 轮次内工具失败指纹计数，用于阻断同一错误无限重试。 */
    toolFailureCounts: Map<string, number>;
    /** runtimeSignal: 当前轮次运行期取消信号，供工具执行边界检查用户停止。 */
    runtimeSignal?: AbortSignal;
    /** cleanupCallbacks: 当前轮次结束时需要释放的外部连接资源。 */
    cleanupCallbacks: Array<() => Promise<void>>;
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
    const sessionRepository = new SessionRepository(input.database);
    const task = sessionRepository.findTask(input.sent.taskId);
    const session = sessionRepository.findSession(input.sent.sessionId);
    return {
        input,
        centerDirectory,
        projectId: session?.projectId ?? null,
        executionAgent: createAgentForTask(task),
        runtime: resolveProviderModelRuntime(
            input.database,
            input.sent.taskId,
        ),
        subAgents: new Map<string, SubAgentRuntimeRecord>(),
        toolFailureCounts: new Map<string, number>(),
        runtimeSignal: input.runtimeSignal,
        cleanupCallbacks: [],
    };
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
