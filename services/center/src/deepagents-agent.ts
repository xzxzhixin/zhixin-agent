import {randomUUID} from "node:crypto";

import type {StructuredToolInterface} from "@langchain/core/tools";
import type {ToolCallStream} from "@langchain/langgraph";
import {createDeepAgent, type DeepAgentRunStream} from "deepagents";

import {SessionRepository} from "./data-access/session-repository.js";
import {
    recordModelUsageAfterTurn,
    updateSessionTitleAfterTurn,
    updateTurnStatus,
} from "./domain/session-domain.js";
import {commitMainAgentMemoryAfterTurn} from "./domain/session-turn-effects.js";
import {handleWorkerMessage, startWorkerTask} from "./domain/workflow-domain.js";
import {
    createLangChainChatModel,
    listMainAgentMemoryPromptEntries,
    listSessionHistoryPromptMessages,
    type ProviderModelGatewayResult,
} from "./model-gateway-runtime.js";
import {formatCenterLocalDateTime} from "./time.js";
import {
    appendToolVisibilityEvents,
    createDeepAgentsStructuredToolMiddleware,
    createDeepAgentsToolExecutionContext,
    listAvailableModelToolSpecsForCenter,
    listUnifiedToolCapabilities,
} from "./tools/index.js";
import type {
    DeepAgentsAgentRunInput,
    DeepAgentsToolExecutionContext,
} from "./tools/index.js";

type CenterDeepAgentRunStream = DeepAgentRunStream<
    Record<string, unknown>,
    readonly StructuredToolInterface[]
>;

/**
 * runDeepAgentsAgentTurn：直接用 Deep Agents 原生 agent 执行当前轮次。
 *
 * @param input 运行输入。
 * @returns 没有返回值。
 */
export async function runDeepAgentsAgentTurn(input: DeepAgentsAgentRunInput): Promise<void> {
    startWorkerTask(
        input.database,
        input.events,
        input.sent.taskId,
    );

    const context = await createDeepAgentsToolExecutionContext(input);
    appendToolVisibilityEvents(
        input.events,
        input.sent.sessionId,
        input.sent.taskId,
        input.sent.turnId,
    );

    const deepAgent = await createCenterDeepAgent(context);
    const run = await deepAgent.streamEvents(
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
        },
    ) as CenterDeepAgentRunStream;

    const messageCollector = collectDeepAgentMessages(input, run);
    const toolCollector = collectDeepAgentToolCalls(context, run);

    const [
        streamedAssistantText,
        finalModelResult,
    ] = await Promise.all([
        messageCollector,
        toolCollector,
    ]);

    const output = await run.output as {
        messages?: Array<{
            role?: string;
            content?: unknown;
        }>;
    };
    const assistantText = resolveFinalAssistantText(
        output,
        streamedAssistantText,
    );

    await finalizeDeepAgentTurn(
        input,
        assistantText,
        finalModelResult,
    );
}

/**
 * createCenterDeepAgent：创建当前中心服务轮次的 Deep Agents 原生 agent。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 已组装好的 Deep Agents agent。
 */
async function createCenterDeepAgent(context: DeepAgentsToolExecutionContext) {
    const tools = await createDeepAgentsStructuredToolMiddleware(context).buildTools();
    const systemPrompt = await buildCenterDeepAgentSystemPrompt(context);
    return createDeepAgent({
        model: createLangChainChatModel(context.runtime),
        tools,
        systemPrompt,
    });
}

/**
 * buildCenterDeepAgentSystemPrompt：构造中心服务当前轮次的系统提示。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 系统提示。
 */
async function buildCenterDeepAgentSystemPrompt(context: DeepAgentsToolExecutionContext): Promise<string> {
    const staticCapabilities = listUnifiedToolCapabilities()
        .filter((capability) => {
            return capability.availability === "available"
                && context.executionAgent.canUseToolCapability(capability.toolId);
        })
        .map((capability) => capability.toolId);
    const mcpSpecs = await listAvailableModelToolSpecsForCenter(
        context.centerDirectory,
        context.executionAgent,
    );
    const dynamicMcpNames = mcpSpecs
        .filter((item) => item.sourceToolId === "builtin.mcp.call")
        .map((item) => item.name);
    const memoryPrompt = listMainAgentMemoryPromptEntries(context.input.database).map((memory, index) => {
        const source = memory.sourceSessionId && memory.sourceTurnId
            ? `来源会话 ${memory.sourceSessionId}，轮次 ${memory.sourceTurnId}`
            : "来源未绑定";
        return `${index + 1}. 关键词：${memory.keywords || "无"}；摘要：${memory.summary || "无"}；${source}`;
    }).join("\n");
    const sessionHistoryPrompt = listSessionHistoryPromptMessages(
        context.input.database,
        context.input.sent.sessionId,
        context.input.sent.turnId,
    ).map((message) => {
        return `${message.role}: ${message.content ?? ""}`;
    }).join("\n");

    return [
        "你运行在致心智能体中心服务的受控 Deep Agents 环境中。",
        "中心服务负责事实源、权限、安全、审计、消息持久化、记忆写入、用量记录和多端同步。",
        "你必须通过结构化工具执行命令、MCP 和智能体领域动作，不得在自然语言里伪造工具已执行。",
        "Deep Agents 自带 todoList、文件系统和 task 工具只作为执行内核能力，不得绕过中心服务事实源去宣称写入核心数据。",
        `当前模型：${context.runtime.modelSelection.model}`,
        context.runtime.modelSelection.reasoningEffort
            ? `当前推理深度：${context.runtime.modelSelection.reasoningEffort}`
            : "当前推理深度：未设置",
        staticCapabilities.length > 0
            ? `当前中心服务静态工具能力：${staticCapabilities.join(", ")}`
            : "当前没有可用静态工具能力。",
        dynamicMcpNames.length > 0
            ? `当前可用 MCP 动态工具：${dynamicMcpNames.join(", ")}`
            : "当前没有可用 MCP 动态工具。",
        memoryPrompt
            ? `主智能体长期记忆：\n${memoryPrompt}`
            : "主智能体长期记忆：无。",
        sessionHistoryPrompt
            ? `当前会话历史：\n${sessionHistoryPrompt}`
            : "当前会话历史：无。",
    ].join("\n\n");
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
    for await (const message of run.messages) {
        for await (const textChunk of message.text) {
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
    for await (const toolCall of run.toolCalls) {
        await recordToolCallLifecycle(
            context,
            toolCall,
        );
    }

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

    const status = await toolCall.status;
    const output = status === "finished"
        ? await toolCall.output
        : null;
    const error = await toolCall.error;
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
        messages?: Array<{
            role?: string;
            content?: unknown;
        }>;
    },
    fallbackText: string,
): string {
    const assistantMessages = Array.isArray(output.messages)
        ? output.messages.filter((message) => {
            return message.role === "assistant" && typeof message.content === "string";
        })
        : [];
    const finalAssistantText = assistantMessages.length > 0
        ? String(assistantMessages[assistantMessages.length - 1]?.content ?? "")
        : fallbackText;
    return finalAssistantText.trim();
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
