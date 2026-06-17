import {randomUUID} from "node:crypto";

import type {StructuredToolInterface} from "@langchain/core/tools";
import type {ToolCallStream} from "@langchain/langgraph";
import {createDeepAgent, type DeepAgentRunStream} from "deepagents";

import {CenterToolChoiceMiddleware} from "./AgentMiddleware/index.js";
import {SessionRepository} from "./data-access/session-repository.js";
import {
    recordModelUsageAfterTurn,
    updateSessionTitleAfterTurn,
    updateTurnStatus,
} from "./domain/session-domain.js";
import {
    isTurnRuntimeAbortError,
    registerRunningTurnRuntime,
    throwIfTurnRuntimeAborted,
    unregisterRunningTurnRuntime,
} from "./domain/turn-runtime-cancel-registry.js";
import {commitMainAgentMemoryAfterTurn} from "./domain/session-turn-effects.js";
import {handleWorkerMessage, startWorkerTask} from "./domain/workflow-domain.js";
import {
    buildMainAgentMemoryPrompt,
    createLangChainChatModel,
    listMainAgentMemoryPromptEntries,
    type ProviderModelGatewayResult,
} from "./model-gateway-runtime.js";
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
    let context: DeepAgentsToolExecutionContext | null = null;
    let run: CenterDeepAgentRunStream | null = null;
    let messageCollector: Promise<string> | null = null;
    let toolCollector: Promise<ProviderModelGatewayResult> | null = null;
    let outputCollector: Promise<DeepAgentOutputState | null> | null = null;
    try {
        startWorkerTask(
            runtimeInput.database,
            runtimeInput.events,
            runtimeInput.sent.taskId,
        );

        context = await createDeepAgentsToolExecutionContext(runtimeInput);
        throwIfTurnRuntimeAborted(runtimeController.signal);
        appendToolVisibilityEvents(
            runtimeInput.events,
            runtimeInput.sent.sessionId,
            runtimeInput.sent.taskId,
            runtimeInput.sent.turnId,
        );

        const deepAgent = await createCenterDeepAgent(context);
        throwIfTurnRuntimeAborted(runtimeController.signal);
        run = await deepAgent.streamEvents(
            {
                messages: [
                    {
                        role: "user",
                        content: input.userText,
                    },
                ],
            },
            {
                version: "v3",
                // 取消信号只在中心服务自有边界内消费，不直接交给 Deep Agents。
                // Deep Agents/LangGraph 的 abort 监听器可能同步抛出异常，导致 Node 作为未捕获异常退出。
            },
        ) as CenterDeepAgentRunStream;

        messageCollector = collectDeepAgentMessages(runtimeInput, run);
        toolCollector = collectDeepAgentToolCalls(context, run);
        outputCollector = resolveDeepAgentOutputWhenActive(runtimeInput, run);

        const [
            streamedAssistantText,
            finalModelResult,
            output,
        ] = await Promise.all([
            messageCollector,
            toolCollector,
            outputCollector,
        ]);

        throwIfTurnRuntimeAborted(runtimeController.signal);
        const assistantText = resolveFinalAssistantText(
            output ?? {},
            streamedAssistantText,
        );
        throwIfTurnRuntimeAborted(runtimeController.signal);
        if (isIncompleteToolIntentText(
            assistantText,
            streamedAssistantText,
            finalModelResult,
        ) && !hasTurnToolExecutionEvents(
            runtimeInput,
        )) {
            await failIncompleteToolIntentTurn(
                runtimeInput,
                assistantText || streamedAssistantText,
            );
            return;
        }

        await finalizeDeepAgentTurn(
            runtimeInput,
            assistantText,
            finalModelResult,
        );
    } catch (error) {
        if (isTurnRuntimeAbortError(error)) {
            await consumeDeepAgentCancellation(
                runtimeInput,
                [
                    messageCollector,
                    toolCollector,
                    outputCollector,
                ],
            );
            return;
        }
        detachDeepAgentCollectors([
            messageCollector,
            toolCollector,
            outputCollector,
        ]);
        await failDeepAgentTurn(
            runtimeInput,
            error,
        );
    } finally {
        await cleanupDeepAgentsTurnResources(
            runtimeInput,
            context,
        );
        unregisterRunningTurnRuntime(
            input.sent.turnId,
            runtimeController,
        );
    }
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
        if (input.runtimeSignal?.aborted) {
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
        model: createLangChainChatModel(context.runtime),
        tools,
        systemPrompt: [
            "你是通用型智能助手，长任务要拆解成小任务执行。",
            mainAgentMemoryPrompt,
        ].filter((promptPart) => {
            return typeof promptPart === "string" && promptPart.length > 0;
        }).join("\n\n"),
        middleware: [
            new CenterToolChoiceMiddleware(context).create(),
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
        if (input.runtimeSignal?.aborted) {
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
        if (context.runtimeSignal?.aborted) {
            throwIfTurnRuntimeAborted(context.runtimeSignal);
        }
        throw error;
    }
    throwIfTurnRuntimeAborted(context.runtimeSignal);

    return {
        providerId: context.runtime.provider.providerId,
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
    if (status !== "finished") {
        throw new Error(error ?? `DEEPAGENTS_TOOL_PLAN_FAILED:${toolCall.name}`);
    }
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
        if (context.runtimeSignal?.aborted || isTurnRuntimeAbortError(error)) {
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
        if (context.runtimeSignal?.aborted) {
            throwIfTurnRuntimeAborted(context.runtimeSignal);
        }
        throw error;
    }
}

/**
 * resolveFinalAssistantText：从 Deep Agents 输出状态中提取最终助手正文。
 *
 * @param output Deep Agents 最终输出。
 * @param fallbackText 流式累积正文。
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
 * isIncompleteToolIntentText：识别模型表达继续执行但没有返回结构化工具调用的半截回复。
 *
 * @param assistantText 模型本次最终文本。
 * @param streamedAssistantText 模型流式阶段已经发出的可见文本。
 * @param modelResult 模型结构化工具调用结果。
 * @returns 命中半截执行意图时返回 true。
 */
function isIncompleteToolIntentText(
    assistantText: string,
    streamedAssistantText: string,
    modelResult: ProviderModelGatewayResult | null,
): boolean {
    const normalizedText = (assistantText || streamedAssistantText).trim();
    if ((modelResult?.toolCalls.length ?? 0) > 0) {
        return false;
    }
    if (normalizedText.length === 0) {
        return true;
    }
    // intentPatterns: 只判断模型文本是否自称要继续执行，不读取用户提示词，也不匹配具体工具名。
    const intentPatterns = [
        /我先看/u,
        /再重点过滤/u,
        /继续(查询|执行|调用|检查|打开|读取)/u,
        /改用.+(工具|命令|MCP)/u,
        /准备(调用|执行|查询|检查|打开|读取)/u,
        /下一步.+(调用|执行|查询|检查|打开|读取)/u,
    ];
    const hasIntent = intentPatterns.some((pattern) => {
        return pattern.test(normalizedText);
    });
    const hasFinalAnswerSignal = /结论|总结|推荐|如下|分别是|已经完成|结果是|我看到|我发现/u.test(normalizedText);
    return hasIntent && !hasFinalAnswerSignal;
}

/**
 * failIncompleteToolIntentTurn：把半截工具意图收尾为失败，避免错误固化助手回复。
 *
 * @param input 当前轮次运行输入。
 * @param assistantText 模型返回的半截文本。
 * @returns 没有返回值。
 */
async function failIncompleteToolIntentTurn(
    input: DeepAgentsAgentRunInput,
    assistantText: string,
): Promise<void> {
    const currentTurn = new SessionRepository(input.database).findTurn(input.sent.turnId);
    if (!currentTurn || currentTurn.endedAt !== null || currentTurn.status === "cancelled") {
        return;
    }
    const failureReason = "MODEL_INCOMPLETE_TOOL_INTENT";
    input.events.append({
        eventType: "message.turn.incomplete",
        scopeType: "turn",
        scopeId: input.sent.turnId,
        sessionId: input.sent.sessionId,
        turnId: input.sent.turnId,
        taskId: input.sent.taskId,
        status: "failed",
        title: "模型返回了未完成执行意图",
        summary: "模型表达了继续调用工具的意图，但没有返回结构化工具调用，本轮已失败收尾。",
        payload: {
            failureReason,
            assistantTextPreview: assistantText.slice(
                0,
                240,
            ),
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
