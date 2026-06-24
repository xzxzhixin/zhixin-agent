import {randomUUID} from "node:crypto";

import type {StructuredToolInterface} from "@langchain/core/tools";
import type {ToolCallStream} from "@langchain/langgraph";
import {createDeepAgent, type DeepAgentRunStream} from "deepagents";

import {
    CenterModelCallLogMiddleware,
    CenterToolChoiceMiddleware,
} from "./AgentMiddleware/index.js";
import {
    type AgentRunCandidate,
    type AgentSupervisorBudget,
    DeepAgentTurnSupervisor,
} from "./agent-runtime/index.js";
import {SessionRepository} from "./data-access/session-repository.js";
import {
    recordModelUsageAfterTurn,
    createTaskStep,
    updateTaskStep,
    updateSessionTitleAfterTurn,
    updateTurnStatus,
} from "./domain/session-domain.js";
import {
    isTurnRuntimeAbortLikeError,
    registerRunningTurnRuntime,
    throwIfTurnRuntimeAborted,
    unregisterRunningTurnRuntime,
} from "./domain/turn-runtime-cancel-registry.js";
import {commitMainAgentMemoryAfterTurn} from "./domain/session-turn-effects.js";
import {handleWorkerMessage, startWorkerTask} from "./domain/workflow-domain.js";
import {
    buildMainAgentMemoryPrompt,
    listMainAgentMemoryPromptEntries,
} from "./model-provider/MainAgentMemoryPrompt.js";
import {ModelProviderRuntimeFactory} from "./model-provider/ModelProviderRuntimeFactory.js";
import type {ProviderModelGatewayResult} from "./model-provider/ModelProviderRuntimeTypes.js";
import {formatCenterLocalDateTime} from "./time.js";
import type {
    DeepAgentsAgentRunInput,
    DeepAgentsToolExecutionContext,
} from "./StructuredTool/index.js";
import {
    appendToolVisibilityEvents,
    createDeepAgentsStructuredToolFactory,
    createDeepAgentsToolExecutionContext,
} from "./StructuredTool/index.js";

type CenterDeepAgentRunStream = DeepAgentRunStream<
    Record<string, unknown>,
    readonly StructuredToolInterface[]
>;

type DeepAgentOutputState = {
    /** messages: Deep Agents 最终状态中的消息列表。 */
    messages?: DeepAgentOutputMessage[];
};

type DeepAgentOutputMessage = {
    /** role: 消息角色。 */
    role?: string;
    /** content: 消息正文。 */
    content?: unknown;
    /** _getType: LangChain BaseMessage 内部消息类型读取函数。 */
    _getType?: () => string;
    /** getType: 部分 LangChain 消息对象暴露的消息类型读取函数。 */
    getType?: () => string;
};

type DeepAgentMessageContentPart = {
    /** type: Deep Agents 消息内容块类型。 */
    type?: unknown;
    /** text: 文本内容块正文。 */
    text?: unknown;
};

type DeepAgentsWriteTodosTaskStepInput = {
    /** title: 用户可见任务步骤标题，来源于 Deep Agents 原生 write_todos 的 todo.content。 */
    title: string;
    /** status: 中心服务任务步骤状态，由 Deep Agents todo.status 映射。 */
    status: "queued" | "running" | "completed";
    /** stepOrder: 同一任务内的顺序，从 1 开始。 */
    stepOrder: number;
};

/**
 * runDeepAgentsAgentTurn：直接用 Deep Agents 原生 agent 执行当前轮次。
 *
 * @param input 运行输入。
 * @returns 没有返回值。
 */
export async function runDeepAgentsAgentTurn(input: DeepAgentsAgentRunInput): Promise<void> {
    const runtimeController = registerRunningTurnRuntime(input.sent.turnId);
    const runtimeInput: DeepAgentsAgentRunInput = {
        ...input,
        runtimeSignal: runtimeController.signal,
    };
    try {
        startWorkerTask(
            runtimeInput.database,
            runtimeInput.events,
            runtimeInput.sent.taskId,
        );
        const supervisor = new DeepAgentTurnSupervisor({
            input: runtimeInput,
            budget: createDefaultSupervisorBudget(),
            runCandidate: async (request) => {
                return runSingleDeepAgentCandidate(
                    runtimeInput,
                    request.attemptIndex,
                    request.internalPrompt,
                );
            },
            finalize: async (candidate) => {
                await finalizeDeepAgentTurn(
                    runtimeInput,
                    candidate.visibleText,
                    candidate.modelResult,
                );
            },
            fail: async (_candidate, decision) => {
                await failDeepAgentTurn(
                    runtimeInput,
                    new Error(decision.reason),
                );
            },
        });
        await supervisor.run();
    } catch (error) {
        if (isTurnRuntimeAbortLikeError(
            error,
            runtimeInput.runtimeSignal,
        )) {
            return;
        }
        await failDeepAgentTurn(
            runtimeInput,
            error,
        );
    } finally {
        unregisterRunningTurnRuntime(
            input.sent.turnId,
            runtimeController,
        );
    }
}

/**
 * createDefaultSupervisorBudget：创建当前轮次监督循环默认预算。
 *
 * @returns 监督循环预算。
 */
function createDefaultSupervisorBudget(): AgentSupervisorBudget {
    return {
        maxSupervisorAttempts: 6,
        continuationRetryBudget: 6,
        toolFailureRetryBudget: 6,
    };
}

/**
 * runSingleDeepAgentCandidate：执行一次 Deep Agents graph 并返回候选终态。
 *
 * @param input 当前轮次运行输入。
 * @param attemptIndex 监督循环尝试序号。
 * @param internalPrompt 内部续跑提示，不写入用户可见消息。
 * @returns Deep Agents 单次运行候选结果。
 */
async function runSingleDeepAgentCandidate(
    input: DeepAgentsAgentRunInput,
    attemptIndex: number,
    internalPrompt: string | null,
): Promise<AgentRunCandidate> {
    let context: DeepAgentsToolExecutionContext | null = null;
    let messageCollector: Promise<string> | null = null;
    let toolCollector: Promise<ProviderModelGatewayResult> | null = null;
    let outputCollector: Promise<DeepAgentOutputState | null> | null = null;
    try {
        const startedAfterSequence = readLatestTurnEventSequence(input);
        context = await createDeepAgentsToolExecutionContext(input);
        throwIfTurnRuntimeAborted(input.runtimeSignal);
        appendToolVisibilityEvents(
            input.events,
            input.sent.sessionId,
            input.sent.taskId,
            input.sent.turnId,
        );

        const deepAgent = await createCenterDeepAgent(context);
        throwIfTurnRuntimeAborted(input.runtimeSignal);
        const run = await deepAgent.streamEvents(
            {
                messages: [
                    {
                        role: "user",
                        content: buildDeepAgentUserContent(
                            input.userText,
                            internalPrompt,
                        ),
                    },
                ],
            },
            {
                version: "v3",
                // 取消信号只在中心服务自有边界内消费，不直接交给 Deep Agents。
                // Deep Agents/LangGraph 的 abort 监听器可能同步抛出异常，导致 Node 作为未捕获异常退出。
            },
        ) as CenterDeepAgentRunStream;

        messageCollector = collectDeepAgentMessages(input, run);
        toolCollector = collectDeepAgentToolCalls(context, run);
        outputCollector = resolveDeepAgentOutputWhenActive(input, run);

        const [
            streamedAssistantText,
            finalModelResult,
            output,
        ] = await Promise.all([
            messageCollector,
            toolCollector,
            outputCollector,
        ]);

        throwIfTurnRuntimeAborted(input.runtimeSignal);
        const assistantText = resolveFinalAssistantText(
            output ?? {},
            streamedAssistantText,
        );
        throwIfTurnRuntimeAborted(input.runtimeSignal);
        return buildAgentRunCandidate(
            input,
            context,
            attemptIndex,
            startedAfterSequence,
            assistantText,
            streamedAssistantText,
            finalModelResult,
        );
    } catch (error) {
        if (isTurnRuntimeAbortLikeError(
            error,
            input.runtimeSignal,
        )) {
            await consumeDeepAgentCancellation(
                input,
                [
                    messageCollector,
                    toolCollector,
                    outputCollector,
                ],
            );
        } else {
            detachDeepAgentCollectors([
                messageCollector,
                toolCollector,
                outputCollector,
            ]);
        }
        throw error;
    } finally {
        await cleanupDeepAgentsTurnResources(
            input,
            context,
        );
    }
}

/**
 * buildDeepAgentUserContent：拼接用户输入和内部续跑提示。
 *
 * @param userText 用户原始输入。
 * @param internalPrompt 中心服务内部续跑提示。
 * @returns 本次 Deep Agents 输入正文。
 */
function buildDeepAgentUserContent(
    userText: string,
    internalPrompt: string | null,
): string {
    if (!internalPrompt) {
        return userText;
    }
    return [
        userText,
        "",
        "中心服务内部续跑提示：",
        internalPrompt,
    ].join("\n");
}

/**
 * resolveDeepAgentOutputWhenActive：提前消费 Deep Agents 最终输出 Promise。
 *
 * @param input 当前轮次输入。
 * @param run Deep Agents 运行流。
 * @returns 未取消时返回最终状态；取消时返回 null。
 */
async function resolveDeepAgentOutputWhenActive(
    input: DeepAgentsAgentRunInput,
    run: CenterDeepAgentRunStream,
): Promise<DeepAgentOutputState | null> {
    try {
        return await run.output as DeepAgentOutputState;
    } catch (error) {
        if (isTurnRuntimeAbortLikeError(
            error,
            input.runtimeSignal,
        )) {
            return null;
        }
        throw error;
    }
}

/**
 * consumeDeepAgentCancellation：消费取消后 Deep Agents 残留异步投影。
 *
 * @param input 当前轮次输入。
 * @param collectors 已挂载的消息、工具和最终输出收集器。
 * @returns 没有返回值。
 */
async function consumeDeepAgentCancellation(
    input: DeepAgentsAgentRunInput,
    collectors: Array<Promise<unknown> | null>,
): Promise<void> {
    if (!input.runtimeSignal?.aborted) {
        return;
    }
    await settleDeepAgentCollectors(collectors);
}

/**
 * settleDeepAgentCollectors：等待已创建的 Deep Agents 异步投影落定。
 *
 * @param collectors 已挂载的异步投影 Promise。
 * @returns 没有返回值。
 */
async function settleDeepAgentCollectors(collectors: Array<Promise<unknown> | null>): Promise<void> {
    await Promise.allSettled(collectors.filter((collector): collector is Promise<unknown> => {
        return collector !== null;
    }));
}

/**
 * detachDeepAgentCollectors：后台消费失败路径残留投影，避免形成未处理拒绝。
 *
 * @param collectors 已挂载的异步投影 Promise。
 * @returns 没有返回值。
 */
function detachDeepAgentCollectors(collectors: Array<Promise<unknown> | null>): void {
    for (const collector of collectors) {
        collector?.catch(() => {
            // 普通失败已经由 failDeepAgentTurn 收尾；这里仅消费残留投影拒绝，避免进程级未处理异常。
        });
    }
}

/**
 * cleanupDeepAgentsTurnResources：释放当前轮次创建的外部连接资源。
 *
 * @param input 当前轮次运行输入。
 * @param context 当前轮次工具执行上下文；上下文创建失败时允许为空。
 * @returns 没有返回值。
 */
async function cleanupDeepAgentsTurnResources(
    input: DeepAgentsAgentRunInput,
    context: DeepAgentsToolExecutionContext | null,
): Promise<void> {
    if (!context) {
        return;
    }
    for (const cleanupCallback of context.cleanupCallbacks) {
        try {
            await cleanupCallback();
        } catch (error) {
            const errorMessage = error instanceof Error
                ? error.message
                : "DEEPAGENTS_RESOURCE_CLEANUP_FAILED";
            input.events.append({
                eventType: "tool.resource.cleanup.failed",
                scopeType: "tool",
                scopeId: input.sent.taskId,
                sessionId: input.sent.sessionId,
                turnId: input.sent.turnId,
                taskId: input.sent.taskId,
                status: "failed",
                title: "工具资源释放失败",
                summary: errorMessage,
                payload: {
                    errorMessage,
                },
            });
        }
    }
}

/**
 * createCenterDeepAgent：创建当前中心服务轮次的 Deep Agents 原生 agent。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 已组装好的 Deep Agents agent。
 */
async function createCenterDeepAgent(context: DeepAgentsToolExecutionContext) {
    const tools = await createDeepAgentsStructuredToolFactory(context).buildTools();
    throwIfTurnRuntimeAborted(context.runtimeSignal);
    const mainAgentMemoryPrompt = buildMainAgentMemoryPrompt(await listMainAgentMemoryPromptEntries(
        context.input.database,
        context.input.userText,
    ));
    throwIfTurnRuntimeAborted(context.runtimeSignal);
    context.input.events.append({
        eventType: "tool.available.snapshot",
        scopeType: "tool",
        scopeId: context.input.sent.taskId,
        sessionId: context.input.sent.sessionId,
        turnId: context.input.sent.turnId,
        taskId: context.input.sent.taskId,
        status: "completed",
        title: "可用工具快照",
        summary: tools.length > 0
            ? `当前轮次已注入 ${tools.length} 个工具。`
            : "当前轮次没有可用工具。",
        payload: {
            toolNames: tools.map((tool) => tool.name),
            // tools: 记录本轮真实注入给模型的工具名与描述，便于和 MCP 管理页展示做事实对照。
            tools: tools.map((tool) => {
                return {
                    name: tool.name,
                    description: tool.description,
                };
            }),
            toolCount: tools.length,
        },
    });
    return createDeepAgent({
        model: new ModelProviderRuntimeFactory(context.input.database).createChatModel(context.runtime),
        tools,
        systemPrompt: [
            "长任务要拆解成小任务执行。",
            mainAgentMemoryPrompt,
        ].filter((promptPart) => {
            return typeof promptPart === "string" && promptPart.length > 0;
        }).join("\n\n"),
        middleware: [
            new CenterModelCallLogMiddleware(context),
            new CenterToolChoiceMiddleware(context),
        ],
    });
}

/**
 * collectDeepAgentMessages：收集 Deep Agents 文本流。
 *
 * @param input 当前轮次输入。
 * @param run Deep Agents 运行流。
 * @returns 最终累积的助手文本。
 */
async function collectDeepAgentMessages(
    input: DeepAgentsAgentRunInput,
    run: CenterDeepAgentRunStream,
): Promise<string> {
    let finalAssistantText = "";
    try {
        for await (const message of run.messages) {
            throwIfTurnRuntimeAborted(input.runtimeSignal);
            for await (const textChunk of message.text) {
                throwIfTurnRuntimeAborted(input.runtimeSignal);
                finalAssistantText += textChunk;
                input.events.append({
                    eventType: "model.stream.delta",
                    scopeType: "model",
                    scopeId: input.sent.taskId,
                    sessionId: input.sent.sessionId,
                    turnId: input.sent.turnId,
                    taskId: input.sent.taskId,
                    status: "running",
                    title: "模型流式片段",
                    summary: textChunk.slice(0, 120),
                    payload: {
                        deltaText: textChunk,
                        streamSource: "deepagents-v3",
                    },
                });
            }
        }
    } catch (error) {
        if (isTurnRuntimeAbortLikeError(
            error,
            input.runtimeSignal,
        )) {
            throwIfTurnRuntimeAborted(input.runtimeSignal);
        }
        throw error;
    }
    throwIfTurnRuntimeAborted(input.runtimeSignal);
    input.events.append({
        eventType: "model.stream.completed",
        scopeType: "model",
        scopeId: input.sent.taskId,
        sessionId: input.sent.sessionId,
        turnId: input.sent.turnId,
        taskId: input.sent.taskId,
        status: "completed",
        title: "模型流式结束",
        summary: "Deep Agents 模型流式输出已结束。",
        payload: {
            streamSource: "deepagents-v3",
        },
    });
    return finalAssistantText;
}

/**
 * collectDeepAgentToolCalls：消费 Deep Agents 工具调用流并提取最终模型信息。
 *
 * @param context 当前工具执行上下文。
 * @param run Deep Agents 运行流。
 * @returns 模型元数据。
 */
async function collectDeepAgentToolCalls(
    context: DeepAgentsToolExecutionContext,
    run: CenterDeepAgentRunStream,
): Promise<ProviderModelGatewayResult> {
    try {
        for await (const toolCall of run.toolCalls) {
            throwIfTurnRuntimeAborted(context.runtimeSignal);
            await recordToolCallLifecycle(
                context,
                toolCall,
            );
        }
    } catch (error) {
        if (isTurnRuntimeAbortLikeError(
            error,
            context.runtimeSignal,
        )) {
            throwIfTurnRuntimeAborted(context.runtimeSignal);
        }
        throw error;
    }
    throwIfTurnRuntimeAborted(context.runtimeSignal);

    return {
        providerId: context.runtime.provider.providerId,
        providerSource: context.runtime.provider.providerSource,
        model: context.runtime.modelSelection.model,
        reasoningEffort: context.runtime.modelSelection.reasoningEffort,
        assistantText: "",
        usage: null,
        toolCall: null,
        toolCalls: [],
    };
}

/**
 * recordToolCallLifecycle：为 Deep Agents 工具调用流写入计划事件。
 *
 * @param context 当前工具执行上下文。
 * @param toolCall 工具调用流。
 * @returns 没有返回值。
 */
async function recordToolCallLifecycle(
    context: DeepAgentsToolExecutionContext,
    toolCall: ToolCallStream<string, unknown, unknown>,
): Promise<void> {
    attachToolCallCancellationGuards(
        context,
        toolCall,
    );
    context.input.events.append({
        eventType: "tool.plan.created",
        scopeType: "tool-plan",
        scopeId: toolCall.callId,
        sessionId: context.input.sent.sessionId,
        turnId: context.input.sent.turnId,
        taskId: context.input.sent.taskId,
        status: "running",
        title: "工具计划",
        summary: `Deep Agents 已计划调用 ${toolCall.name}`,
        payload: {
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            input: toolCall.input,
        },
    });

    const status = await resolveToolCallValueWhenActive(
        context,
        toolCall.status,
    );
    throwIfTurnRuntimeAborted(context.runtimeSignal);
    const output = status === "finished"
        ? await resolveToolCallValueWhenActive(
            context,
            toolCall.output,
        )
        : null;
    const error = await resolveToolCallValueWhenActive(
        context,
        toolCall.error,
    );
    throwIfTurnRuntimeAborted(context.runtimeSignal);
    context.input.events.append({
        eventType: status === "finished" ? "tool.plan.completed" : "tool.plan.failed",
        scopeType: "tool-plan",
        scopeId: toolCall.callId,
        sessionId: context.input.sent.sessionId,
        turnId: context.input.sent.turnId,
        taskId: context.input.sent.taskId,
        status: status === "finished" ? "completed" : "failed",
        title: status === "finished" ? "工具计划完成" : "工具计划失败",
        summary: status === "finished"
            ? `Deep Agents 工具 ${toolCall.name} 已完成。`
            : error ?? `Deep Agents 工具 ${toolCall.name} 执行失败。`,
        payload: {
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            input: toolCall.input,
            output,
            error,
        },
    });
    if (status === "finished") {
        bridgeDeepAgentsWriteTodosToTaskSteps(
            context,
            toolCall.name,
            output,
        );
    }
    if (status !== "finished") {
        throw new Error(error ?? `DEEPAGENTS_TOOL_PLAN_FAILED:${toolCall.name}`);
    }
}

/**
 * bridgeDeepAgentsWriteTodosToTaskSteps：把 Deep Agents 原生 write_todos 结果桥接到用户可见 task_steps。
 *
 * 约束：只消费 Deep Agents 原生结构化 output.update.todos，不恢复旧中心服务 todoList 包装工具。
 *
 * @param context 当前工具执行上下文。
 * @param toolName Deep Agents 工具名。
 * @param output Deep Agents 工具输出。
 */
function bridgeDeepAgentsWriteTodosToTaskSteps(
    context: DeepAgentsToolExecutionContext,
    toolName: string,
    output: unknown,
): void {
    const taskStepInputs = convertDeepAgentsWriteTodosForTaskSteps({
        toolName,
        output,
    });
    if (taskStepInputs.length === 0) {
        return;
    }
    const repository = new SessionRepository(context.input.database);
    const task = repository.findTask(context.input.sent.taskId);
    if (!task) {
        return;
    }
    const existingSteps = repository.listTaskStepsByTaskForAgent({
        sessionId: context.input.sent.sessionId,
        taskId: context.input.sent.taskId,
        agentId: task.agentId,
    }).filter((step) => {
        return step.source === "todoList"
            && step.status !== "superseded";
    });
    const existingByOrder = new Map(existingSteps.map((step) => {
        return [
            step.stepOrder,
            step,
        ];
    }));
    for (const taskStepInput of taskStepInputs) {
        const existingStep = existingByOrder.get(taskStepInput.stepOrder);
        if (existingStep) {
            updateTaskStep(
                context.input.database,
                context.input.events,
                existingStep.stepId,
                taskStepInput.status,
                taskStepInput.title,
                undefined,
                {
                    title: taskStepInput.title,
                    source: "todoList",
                    stepOrder: taskStepInput.stepOrder,
                },
            );
            continue;
        }
        createTaskStep(
            context.input.database,
            context.input.events,
            {
                taskId: context.input.sent.taskId,
                sessionId: context.input.sent.sessionId,
                turnId: context.input.sent.turnId,
            },
            taskStepInput.title,
            {
                source: "todoList",
                stepOrder: taskStepInput.stepOrder,
                initialStatus: taskStepInput.status,
                summary: taskStepInput.title,
            },
        );
    }
}

/**
 * convertDeepAgentsWriteTodosForTaskSteps：提取 Deep Agents 原生 write_todos 的用户可见步骤。
 *
 * @param input Deep Agents 工具名和工具输出。
 * @returns 可写入 task_steps 的步骤输入。
 */
function convertDeepAgentsWriteTodosForTaskSteps(input: {
    /** toolName: Deep Agents 工具名。 */
    toolName: string;
    /** output: Deep Agents 工具输出。 */
    output: unknown;
}): DeepAgentsWriteTodosTaskStepInput[] {
    if (input.toolName !== "write_todos") {
        return [];
    }
    const output = readObject(input.output);
    const update = readObject(output?.update);
    const todos = Array.isArray(update?.todos)
        ? update.todos
        : [];
    return todos.flatMap((todo, index) => {
        const todoObject = readObject(todo);
        const content = typeof todoObject?.content === "string"
            ? todoObject.content.trim()
            : "";
        const status = mapDeepAgentsTodoStatus(todoObject?.status);
        if (content.length === 0 || !status) {
            return [];
        }
        return [
            {
                title: content,
                status,
                stepOrder: index + 1,
            },
        ];
    });
}

/**
 * convertDeepAgentsWriteTodosForTaskStepsTest：暴露给回归脚本的纯转换入口。
 *
 * @param input Deep Agents 工具名和工具输出。
 * @returns 可写入 task_steps 的步骤输入。
 */
export function convertDeepAgentsWriteTodosForTaskStepsTest(input: {
    /** toolName: Deep Agents 工具名。 */
    toolName: string;
    /** output: Deep Agents 工具输出。 */
    output: unknown;
}): DeepAgentsWriteTodosTaskStepInput[] {
    return convertDeepAgentsWriteTodosForTaskSteps(input);
}

/**
 * readObject：把未知值收窄为普通对象。
 *
 * @param value 未知值。
 * @returns 普通对象；非对象或数组返回 null。
 */
function readObject(value: unknown): Record<string, unknown> | null {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

/**
 * mapDeepAgentsTodoStatus：映射 Deep Agents todo 状态到中心服务步骤状态。
 *
 * @param status Deep Agents 原生 todo.status。
 * @returns 中心服务步骤状态；未知状态返回 null。
 */
function mapDeepAgentsTodoStatus(status: unknown): DeepAgentsWriteTodosTaskStepInput["status"] | null {
    if (status === "pending") {
        return "queued";
    }
    if (status === "in_progress") {
        return "running";
    }
    if (status === "completed") {
        return "completed";
    }
    return null;
}

/**
 * attachToolCallCancellationGuards：预先消费工具计划字段的取消拒绝。
 *
 * @param context 当前工具执行上下文。
 * @param toolCall 工具调用流。
 * @returns 没有返回值。
 */
function attachToolCallCancellationGuards(
    context: DeepAgentsToolExecutionContext,
    toolCall: ToolCallStream<string, unknown, unknown>,
): void {
    consumeToolCallValueWhenCancelled(
        context,
        toolCall.status,
    );
    consumeToolCallValueWhenCancelled(
        context,
        toolCall.output,
    );
    consumeToolCallValueWhenCancelled(
        context,
        toolCall.error,
    );
}

/**
 * consumeToolCallValueWhenCancelled：取消后消费 Deep Agents 工具字段 Promise。
 *
 * @param context 当前工具执行上下文。
 * @param valuePromise Deep Agents 工具字段 Promise。
 * @returns 没有返回值。
 */
function consumeToolCallValueWhenCancelled(
    context: DeepAgentsToolExecutionContext,
    valuePromise: Promise<unknown>,
): void {
    valuePromise.catch((error: unknown) => {
        if (isTurnRuntimeAbortLikeError(
            error,
            context.runtimeSignal,
        )) {
            return;
        }
        // 普通工具失败由主收集链路记录；这里仅提前消费取消期异步拒绝，避免进程级未处理异常。
    });
}

/**
 * resolveToolCallValueWhenActive：取消感知地等待 Deep Agents 工具计划字段。
 *
 * @param context 当前工具执行上下文。
 * @param valuePromise Deep Agents 工具计划字段 Promise。
 * @returns 字段解析结果。
 */
async function resolveToolCallValueWhenActive<T>(
    context: DeepAgentsToolExecutionContext,
    valuePromise: Promise<T>,
): Promise<T> {
    try {
        return await valuePromise;
    } catch (error) {
        if (isTurnRuntimeAbortLikeError(
            error,
            context.runtimeSignal,
        )) {
            throwIfTurnRuntimeAborted(context.runtimeSignal);
        }
        throw error;
    }
}

/**
 * resolveFinalAssistantText：按 LangChain ReAct 语义提取最终 AIMessage 正文。
 *
 * @param output Deep Agents 最终输出。
 * @param fallbackText 流式累积正文；仅在最终状态缺少消息时作为兼容文本。
 * @returns 最终助手文本。
 */
function resolveFinalAssistantText(
    output: {
        messages?: DeepAgentOutputMessage[];
    },
    fallbackText: string,
): string {
    const assistantMessages = Array.isArray(output.messages)
        ? output.messages.filter((message) => {
            return isDeepAgentAssistantMessage(message);
        })
        : [];
    const finalAssistantText = assistantMessages.length > 0
        ? extractDeepAgentMessageText(assistantMessages[assistantMessages.length - 1]?.content)
        : fallbackText;
    return finalAssistantText.trim();
}

/**
 * isDeepAgentAssistantMessage：判断 Deep Agents 最终状态里的消息是否为助手消息。
 *
 * @param message Deep Agents 或 LangChain 返回的消息对象。
 * @returns 是助手消息时返回 true。
 */
function isDeepAgentAssistantMessage(message: DeepAgentOutputMessage): boolean {
    if (message.role === "assistant") {
        return true;
    }
    return readDeepAgentMessageType(message) === "ai";
}

/**
 * readDeepAgentMessageType：兼容读取 LangChain BaseMessage 的运行时类型。
 *
 * @param message Deep Agents 或 LangChain 返回的消息对象。
 * @returns 消息类型字符串；无法读取时返回空字符串。
 */
function readDeepAgentMessageType(message: DeepAgentOutputMessage): string {
    for (const readType of [
        message._getType,
        message.getType,
    ]) {
        if (typeof readType !== "function") {
            continue;
        }
        const messageType = readType.call(message);
        if (typeof messageType === "string" && messageType.length > 0) {
            return messageType;
        }
    }
    return "";
}

/**
 * buildAgentRunCandidate：组装 Deep Agents 单次运行候选结果。
 *
 * @param input 当前轮次运行输入。
 * @param context 当前工具执行上下文。
 * @param attemptIndex 监督循环尝试序号。
 * @param startedAfterSequence 本次候选开始前的事件序号，用于判断本次是否产生工具结果。
 * @param assistantText Deep Agents 最终 AIMessage 文本。
 * @param streamedAssistantText 流式累计文本。
 * @param modelResult 模型运行结果。
 * @returns 单次运行候选结果。
 */
function buildAgentRunCandidate(
    input: DeepAgentsAgentRunInput,
    context: DeepAgentsToolExecutionContext,
    attemptIndex: number,
    startedAfterSequence: number,
    assistantText: string,
    streamedAssistantText: string,
    modelResult: ProviderModelGatewayResult | null,
): AgentRunCandidate {
    const task = new SessionRepository(input.database).findTask(input.sent.taskId);
    return {
        attemptIndex,
        visibleText: assistantText || streamedAssistantText.trim(),
        streamedText: streamedAssistantText,
        modelResult,
        lastModelMessageDiagnostics: context.lastModelMessageDiagnostics,
        hasStructuredToolCall: hasStructuredToolCall(context),
        hasToolExecutionEvents: hasTurnToolExecutionEvents(input),
        hasRecentToolResult: hasTurnEventType(
            input,
            "model.tool.result.appended",
            startedAfterSequence,
        ),
        hasPendingTaskState: task?.status === "running" || task?.status === "queued",
        hasToolFailureEvents: hasTurnToolFailureEvents(
            input,
            startedAfterSequence,
        ),
        cancelled: Boolean(input.runtimeSignal?.aborted),
        budget: createDefaultSupervisorBudget(),
        continuationRetryCount: 0,
        toolFailureRetryCount: 0,
    };
}

/**
 * readLatestTurnEventSequence：读取当前轮次已有事件最大序号。
 *
 * @param input 当前轮次运行输入。
 * @returns 当前轮次最新事件序号；没有事件时返回 0。
 */
function readLatestTurnEventSequence(input: DeepAgentsAgentRunInput): number {
    const row = input.database.connection().prepare(`
        SELECT COALESCE(MAX(sequence), 0) AS sequence
        FROM events
        WHERE turn_id = ?
    `).get(input.sent.turnId) as {
        /** sequence: 当前轮次最大事件序号。 */
        sequence: number;
    };
    return row.sequence;
}

/**
 * hasStructuredToolCall：判断最后模型诊断是否包含结构化工具调用。
 *
 * @param context 当前工具执行上下文。
 * @returns 存在结构化工具调用时返回 true。
 */
function hasStructuredToolCall(context: DeepAgentsToolExecutionContext): boolean {
    const toolCalls = context.lastModelMessageDiagnostics?.toolCalls ?? [];
    return toolCalls.some((toolCall) => {
        return typeof toolCall.name === "string" && toolCall.name.length > 0;
    });
}

/**
 * hasTurnToolExecutionEvents：判断当前轮次是否已经出现真实工具执行或回填事件。
 *
 * @param input 当前轮次运行输入。
 * @returns 已存在工具请求、工具完成或工具结果回填时返回 true。
 */
function hasTurnToolExecutionEvents(input: DeepAgentsAgentRunInput): boolean {
    const row = input.database.connection().prepare(`
        SELECT 1
        FROM events
        WHERE turn_id = ?
          AND event_type IN (
                             'model.tool.requested',
                             'model.tool.result.appended',
                             'tool.command.started',
                             'tool.command.completed',
                             'tool.mcp.started',
                             'tool.mcp.completed',
                             'tool.plan.created',
                             'tool.plan.completed'
            )
            LIMIT 1
    `).get(input.sent.turnId);
    return Boolean(row);
}

/**
 * hasTurnToolFailureEvents：判断当前轮次是否出现工具失败事件。
 *
 * @param input 当前轮次运行输入。
 * @param startedAfterSequence 本次候选开始前的事件序号，避免读取旧失败事件。
 * @returns 存在工具失败事件时返回 true。
 */
function hasTurnToolFailureEvents(
    input: DeepAgentsAgentRunInput,
    startedAfterSequence: number,
): boolean {
    const row = input.database.connection().prepare(`
        SELECT 1
        FROM events
        WHERE turn_id = ?
          AND sequence > ?
          AND event_type IN (
                             'tool.plan.failed',
                             'tool.mcp.failed',
                             'tool.call.failed',
                             'model.tool.repeated_failure_blocked',
                             'model.tool_call.name_missing'
            )
            LIMIT 1
    `).get(
        input.sent.turnId,
        startedAfterSequence,
    );
    return Boolean(row);
}

/**
 * hasTurnEventType：判断当前轮次是否存在指定事件类型。
 *
 * @param input 当前轮次运行输入。
 * @param eventType 事件类型。
 * @param startedAfterSequence 本次候选开始前的事件序号，默认 0 表示检查全轮次。
 * @returns 存在时返回 true。
 */
function hasTurnEventType(
    input: DeepAgentsAgentRunInput,
    eventType: string,
    startedAfterSequence = 0,
): boolean {
    const row = input.database.connection().prepare(`
        SELECT 1
        FROM events
        WHERE turn_id = ?
          AND event_type = ?
          AND sequence > ? LIMIT 1
    `).get(
        input.sent.turnId,
        eventType,
        startedAfterSequence,
    );
    return Boolean(row);
}

/**
 * extractDeepAgentMessageText：提取 Deep Agents 最终消息中的可见文本。
 *
 * @param content Deep Agents 消息 content，可能是字符串或 OpenAI 风格内容块数组。
 * @returns 拼接后的文本。
 */
function extractDeepAgentMessageText(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }
    return content.map((part) => {
        if (typeof part === "string") {
            return part;
        }
        if (typeof part !== "object" || part === null) {
            return "";
        }
        const contentPart = part as DeepAgentMessageContentPart;
        if (contentPart.type === "text" && typeof contentPart.text === "string") {
            return contentPart.text;
        }
        return "";
    }).filter((text) => {
        return text.length > 0;
    }).join("");
}

/**
 * finalizeDeepAgentTurn：把 Deep Agents 最终结果固化回中心服务事实源。
 *
 * @param input 当前轮次运行输入。
 * @param assistantText 最终助手文本。
 * @param modelResult 当前模型元数据。
 * @returns 没有返回值。
 */
async function finalizeDeepAgentTurn(
    input: DeepAgentsAgentRunInput,
    assistantText: string,
    modelResult: ProviderModelGatewayResult | null,
): Promise<void> {
    throwIfTurnRuntimeAborted(input.runtimeSignal);
    const currentTurn = new SessionRepository(input.database).findTurn(input.sent.turnId);
    if (!currentTurn || currentTurn.endedAt !== null || currentTurn.status === "cancelled") {
        return;
    }
    const assistantMessageId = randomUUID();
    new SessionRepository(input.database).insertAssistantMessageForTurn({
        messageId: assistantMessageId,
        turnId: input.sent.turnId,
        contentMarkdown: assistantText,
        createdAt: formatCenterLocalDateTime(),
    });
    input.events.append({
        eventType: "message.created",
        scopeType: "message",
        scopeId: assistantMessageId,
        sessionId: input.sent.sessionId,
        turnId: input.sent.turnId,
        taskId: input.sent.taskId,
        status: "completed",
        title: "消息创建",
        summary: "助手回复已写入中心服务。",
        payload: {
            messageId: assistantMessageId,
            role: "assistant",
        },
    });
    handleWorkerMessage(
        input.database,
        input.events,
        "task.complete",
        input.sent.taskId,
        {
            assistantMessageId,
            providerId: modelResult?.providerId ?? null,
            model: modelResult?.model ?? null,
            usage: modelResult?.usage ?? null,
        },
    );
    if (input.centerDirectory && input.memoryQueues) {
        await commitMainAgentMemoryAfterTurn(
            input.database,
            input.events,
            input.centerDirectory,
            input.memoryQueues,
            input.sent,
            input.userText,
            assistantText,
        );
    }
    if (modelResult) {
        recordModelUsageAfterTurn(
            input.database,
            input.events,
            input.sent,
            modelResult,
        );
    }
    updateSessionTitleAfterTurn(
        input.database,
        input.events,
        input.sent,
        input.userText,
        assistantText,
    );
    updateTurnStatus(
        input.database,
        input.events,
        input.sent.turnId,
        "completed",
        input.sent.taskId,
    );
}

/**
 * failDeepAgentTurn：统一收尾 Deep Agents 运行异常，避免轮次长期停留在运行中。
 *
 * @param input 当前轮次运行输入。
 * @param error 运行过程中抛出的异常。
 * @returns 没有返回值。
 */
async function failDeepAgentTurn(
    input: DeepAgentsAgentRunInput,
    error: unknown,
): Promise<void> {
    const currentTurn = new SessionRepository(input.database).findTurn(input.sent.turnId);
    if (
        !currentTurn
        || currentTurn.endedAt !== null
        || currentTurn.status === "cancelled"
    ) {
        return;
    }
    // errorMessage: 失败收尾只写入稳定短文本，避免把堆栈或长输出直接推给前端。
    const errorMessage = error instanceof Error
        ? error.message
        : "DEEPAGENT_TURN_FAILED";
    input.events.append({
        eventType: "message.turn.failed",
        scopeType: "turn",
        scopeId: input.sent.turnId,
        sessionId: input.sent.sessionId,
        turnId: input.sent.turnId,
        taskId: input.sent.taskId,
        status: "failed",
        title: "对话执行失败",
        summary: errorMessage,
        payload: {
            errorMessage,
            errorDetail: error instanceof Error
                ? {
                    name: error.name,
                    message: error.message,
                }
                : {
                    value: String(error),
                },
        },
    });
    updateTurnStatus(
        input.database,
        input.events,
        input.sent.turnId,
        "failed",
        input.sent.taskId,
    );
}
