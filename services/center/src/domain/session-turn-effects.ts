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
    if (isLowSignalAssistantReply(normalizedAssistantText)) {
        return false;
    }
    if (looksLikeIncorrectIdentityAnswer(normalizedAssistantText)) {
        return false;
    }
    return true;
}

/**
 * isLowSignalAssistantReply：判断回复是否只是验收口水、确认词或无长期价值内容。
 *
 * @param assistantText 助手回复。
 * @returns 缺少长期记忆价值时返回 true。
 */
function isLowSignalAssistantReply(assistantText: string): boolean {
    if (assistantText.length <= 2) {
        return true;
    }
    const lowSignalPatterns = [
        "请只回复",
        "收到。",
        "收到",
        "实时刷新验证",
        "回归验证",
        "数据库恢复",
        "完成事件复测",
        "桌面壳实时刷新验证",
        "运行在",
        "环境中的 AI 助手",
        "当前模型是",
    ];
    return lowSignalPatterns.some((pattern) => {
        return assistantText.includes(pattern);
    });
}

/**
 * looksLikeIncorrectIdentityAnswer：识别不应写入长期记忆的错误身份答复。
 *
 * @param assistantText 助手回复。
 * @returns 属于错误身份答复时返回 true。
 */
function looksLikeIncorrectIdentityAnswer(assistantText: string): boolean {
    const incorrectIdentityPatterns = [
        "不知道你的真实身份",
        "不知道你的姓名",
        "无法确认你的真实身份",
        "无法确认你的姓名",
        "我叫 ChatGPT",
        "我是 ChatGPT",
    ];
    return incorrectIdentityPatterns.some((pattern) => {
        return assistantText.includes(pattern);
    });
}

