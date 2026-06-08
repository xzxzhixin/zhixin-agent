import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import type {ProviderModelGatewayResult} from "./model-gateway-runtime.js";
import type {SendMessageResponse} from "./types.js";
import type {MemoryQueueState} from "./types.js";
import {
    writeAgentMemory,
    type MemoryWriteInput,
} from "./agent-domain.js";
import {createDataAccess} from "./data-access/index.js";
import {syncTurnMemoryToMem0} from "./memory-engine.js";
import {
    createTaskStep,
    updateTaskStep,
} from "./session-domain.js";
import {
    buildUnifiedToolCallIntentFromModelCall,
    commandRequestFromUnifiedToolIntent,
    mcpRequestFromUnifiedToolIntent,
    runCommandTool,
    runMcpTool,
} from "./tool-runtime.js";
import {
    stepTaskFromGraphContext,
    type TurnGraphCheckpoint,
    type TurnGraphContext,
    withOptionalGraphCheckpoint,
    withTurnGraphCheckpoint,
} from "./turn-graph-domain.js";

/**
 * commitMainAgentMemoryAfterTurn：正常会话完成后追加主智能体长期记忆。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param memoryQueues 智能体记忆单写队列。
 * @param sent 当前轮次身份。
 * @param userText 用户本轮输入。
 * @param assistantText 助手本轮回复。
 * @param graphCheckpoint 记忆节点图检查点。
 * @returns 没有返回值。
 */
export async function commitMainAgentMemoryAfterTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    memoryQueues: Map<string, MemoryQueueState>,
    sent: SendMessageResponse,
    userText: string,
    assistantText: string,
    graphCheckpoint?: TurnGraphCheckpoint,
): Promise<void> {
    // memoryInput: 记忆写入边界是一轮完整对话，索引必须绑定当前会话和轮次便于迁移后追溯。
    const memoryInput: MemoryWriteInput = {
        agentId: "main",
        keywords: summarizeMemoryKeywords(userText),
        summary: summarizeMemoryText(userText, assistantText),
        userText,
        assistantText,
        sourceSessionId: sent.sessionId,
        sourceTurnId: sent.turnId,
        attachmentRefsJson: "[]",
    };
    const memoryResult = writeAgentMemory(
        database,
        events,
        centerDirectory,
        memoryQueues,
        memoryInput,
    );
    events.append({
        eventType: "memory.write.graph_checkpoint",
        scopeType: "agent",
        scopeId: memoryInput.agentId,
        sessionId: sent.sessionId,
        turnId: sent.turnId,
        taskId: sent.taskId,
        agentId: memoryInput.agentId,
        status: "completed",
        title: "记忆图检查点",
        summary: "主智能体记忆写入已绑定当前 LangGraph 节点。",
        payload: withOptionalGraphCheckpoint({
            sourceSessionId: sent.sessionId,
            sourceTurnId: sent.turnId,
            relativePath: memoryResult.relativePath,
        }, graphCheckpoint),
    });
    await syncTurnMemoryToMem0(
        events,
        centerDirectory,
        {
            agentId: memoryInput.agentId,
            projectId: null,
            sourceSessionId: sent.sessionId,
            sourceTurnId: sent.turnId,
            sourceMemoryPath: memoryResult.relativePath,
            sourceMemoryText: memoryInput.summary,
        },
    );
}

/**
 * executeModelRequestedTools：执行当前模型回复中携带的一组工具调用。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 当前轮次身份。
 * @param modelResult 当前模型返回。
 * @param graphContext 当前对话图上下文。
 * @param toolExecuteCheckpoint 工具执行节点检查点。
 * @returns 可回填模型的工具结果。
 */
export async function executeModelRequestedTools(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    modelResult: ProviderModelGatewayResult,
    graphContext: TurnGraphContext,
    toolExecuteCheckpoint: TurnGraphCheckpoint,
): Promise<Array<{
    toolCall: NonNullable<ProviderModelGatewayResult["toolCall"]>;
    resultText: string;
    unifiedToolIntent: NonNullable<ReturnType<typeof buildUnifiedToolCallIntentFromModelCall>>;
}>> {
    const toolResults: Array<{
        toolCall: NonNullable<ProviderModelGatewayResult["toolCall"]>;
        resultText: string;
        unifiedToolIntent: NonNullable<ReturnType<typeof buildUnifiedToolCallIntentFromModelCall>>;
    }> = [];

    for (const toolCall of modelResult.toolCalls) {
        events.append({
            eventType: "model.tool.requested",
            scopeType: "tool",
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "running",
            title: "模型请求工具",
            summary: `模型请求调用 ${toolCall.name}`,
            payload: withTurnGraphCheckpoint({
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.name,
                argumentsJson: toolCall.argumentsJson,
            }, toolExecuteCheckpoint),
        });

        const unifiedToolIntent = buildUnifiedToolCallIntentFromModelCall(toolCall);
        if (!unifiedToolIntent || ![
            "command",
            "mcp",
        ].includes(unifiedToolIntent.toolKind)) {
            events.append({
                eventType: "model.tool.rejected",
                scopeType: "tool",
                scopeId: sent.taskId,
                sessionId: sent.sessionId,
                turnId: sent.turnId,
                taskId: sent.taskId,
                status: "failed",
                title: "模型工具请求未执行",
                summary: "模型请求的工具不存在、不可用或当前最小闭环暂不支持。",
                payload: withTurnGraphCheckpoint({
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.name,
                }, toolExecuteCheckpoint),
            });
            continue;
        }

        const toolStep = createTaskStep(
            database,
            events,
            stepTaskFromGraphContext(graphContext),
            unifiedToolIntent.toolKind === "command" ? "命令工具执行" : "MCP 工具执行",
            toolExecuteCheckpoint,
        );
        const toolResult = unifiedToolIntent.toolKind === "command"
            ? await runCommandTool(
                events,
                sent.sessionId,
                sent.taskId,
                sent.turnId,
                {
                    ...commandRequestFromUnifiedToolIntent(unifiedToolIntent),
                    toolCallId: toolCall.toolCallId,
                },
                toolExecuteCheckpoint,
            )
            : await runMcpTool(
                events,
                extractCenterDirectoryForToolLoop(database),
                sent.sessionId,
                sent.taskId,
                sent.turnId,
                {
                    ...mcpRequestFromUnifiedToolIntent(unifiedToolIntent),
                    toolCallId: toolCall.toolCallId,
                },
                toolExecuteCheckpoint,
            );
        updateTaskStep(
            database,
            events,
            toolStep.stepId,
            toolResult.status,
            toolResult.status === "completed"
                ? `${unifiedToolIntent.toolKind === "command" ? "命令" : "MCP"}工具执行完成：${toolResult.outputSummary || "工具没有输出。"}`
                : `${unifiedToolIntent.toolKind === "command" ? "命令" : "MCP"}工具执行失败：${toolResult.failureReason ?? "未返回失败原因。"}`,
            toolExecuteCheckpoint,
        );
        toolResults.push({
            toolCall,
            resultText: toolResult.status === "completed"
                ? toolResult.outputSummary || "工具没有输出。"
                : toolResult.failureReason ?? "工具执行失败。",
            unifiedToolIntent,
        });
    }

    return toolResults;
}

/**
 * summarizeMemoryKeywords：从本轮用户输入生成简短关键词。
 *
 * @param userText 用户本轮输入。
 * @returns 关键词文本。
 */
function summarizeMemoryKeywords(userText: string): string {
    const normalized = userText.replace(/\s+/gu, " ").trim();
    return normalized.length > 0
        ? normalized.slice(0, 24)
        : "对话";
}

/**
 * summarizeMemoryText：生成长期记忆摘要。
 *
 * @param userText 用户本轮输入。
 * @param assistantText 助手本轮回复。
 * @returns 记忆摘要。
 */
function summarizeMemoryText(
    userText: string,
    assistantText: string,
): string {
    const normalized = `${userText}\n${assistantText}`.replace(/\s+/gu, " ").trim();
    return normalized.length > 0
        ? normalized.slice(0, 120)
        : "本轮对话已完成。";
}

/**
 * extractCenterDirectoryForToolLoop：读取工具执行所需中心目录。
 *
 * @param database 中心服务数据库。
 * @returns 中心目录绝对路径。
 */
function extractCenterDirectoryForToolLoop(database: CenterDatabase): string {
    const centerDirectory = createDataAccess(database).system.readMetaValue("centerDirectory") ?? "";
    if (!centerDirectory) {
        throw new Error("CENTER_DIRECTORY_NOT_AVAILABLE");
    }
    return centerDirectory;
}
