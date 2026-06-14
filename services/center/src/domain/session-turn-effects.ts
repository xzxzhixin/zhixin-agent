import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import type {SendMessageResponse} from "../types.js";
import type {MemoryQueueState} from "../types.js";
import {
    writeAgentMemory,
    type MemoryWriteInput,
} from "./agent-domain.js";
import {syncTurnMemoryToMem0} from "../memory-engine.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
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

