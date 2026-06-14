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
    // 只有可长期复用的稳定事实才进入长期记忆，回归口水、明显错误回复和空泛失败回复都必须跳过。
    if (!shouldPersistMainAgentMemory(
        userText,
        assistantText,
    )) {
        events.append({
            eventType: "memory.write.skipped",
            scopeType: "agent",
            scopeId: "main",
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            agentId: "main",
            status: "completed",
            title: "记忆写入跳过",
            summary: "本轮回复不满足主智能体长期记忆固化条件，已跳过写入。",
            payload: withOptionalGraphCheckpoint({
                reason: "MEMORY_PERSIST_FILTERED",
                userTextPreview: userText.slice(0, 80),
                assistantTextPreview: assistantText.slice(0, 120),
            }, graphCheckpoint),
        });
        return;
    }
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

/**
 * shouldPersistMainAgentMemory：判断当前轮次是否允许固化到主智能体长期记忆。
 *
 * @param userText 用户本轮输入。
 * @param assistantText 助手本轮回复。
 * @returns 满足长期记忆条件时返回 true。
 */
function shouldPersistMainAgentMemory(
    userText: string,
    assistantText: string,
): boolean {
    const normalizedUserText = userText.replace(/\s+/gu, " ").trim();
    const normalizedAssistantText = assistantText.replace(/\s+/gu, " ").trim();
    if (normalizedUserText.length === 0 || normalizedAssistantText.length === 0) {
        return false;
    }
    const blockedPatterns = [
        "我目前不知道你的真实身份或姓名",
        "我不知道你的真实身份或姓名",
        "我叫 ChatGPT",
        "我是 ChatGPT",
        "请只回复收到",
        "收到。",
        "实时刷新验证",
        "桌面壳实时刷新验证",
        "本轮回归验证",
        "最终验收数据库恢复",
        "完成事件复测",
        "本轮数据库恢复复测",
    ];
    return !blockedPatterns.some((pattern) => {
        return normalizedAssistantText.includes(pattern);
    });
}

