import {
    EVENT_SCOPE_TYPES,
    EVENT_TYPES,
    TASK_STATUSES,
} from "@zhixin/shared";

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
import {AttachmentMemoryService} from "./AttachmentMemoryService.js";

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
    const attachmentSources = new AttachmentMemoryService(database).listSourcesByTurn({
        sessionId: sent.sessionId,
        turnId: sent.turnId,
    });
    // 只有可长期复用的稳定事实才进入长期记忆，回归口水、明显错误回复和空泛失败回复都必须跳过。
    if (
        attachmentSources.length === 0
        && !shouldPersistMainAgentMemory(
        userText,
        assistantText,
        )
    ) {
        events.append({
            eventType: EVENT_TYPES.MEMORY_WRITE_SKIPPED,
            scopeType: EVENT_SCOPE_TYPES.AGENT,
            scopeId: "main",
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            agentId: "main",
            status: TASK_STATUSES.COMPLETED,
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
        attachmentSources,
    };
    const memoryResult = writeAgentMemory(
        database,
        events,
        centerDirectory,
        memoryQueues,
        memoryInput,
    );
    events.append({
        eventType: EVENT_TYPES.MEMORY_WRITE_GRAPH_CHECKPOINT,
        scopeType: EVENT_SCOPE_TYPES.AGENT,
        scopeId: memoryInput.agentId,
        sessionId: sent.sessionId,
        turnId: sent.turnId,
        taskId: sent.taskId,
        agentId: memoryInput.agentId,
        status: TASK_STATUSES.COMPLETED,
        title: "记忆图检查点",
        summary: "主智能体记忆写入已绑定当前 LangGraph 节点。",
        payload: withOptionalGraphCheckpoint({
            sourceSessionId: sent.sessionId,
            sourceTurnId: sent.turnId,
            relativePath: memoryResult.relativePath,
            attachmentSources,
        }, graphCheckpoint),
    });
    if (attachmentSources.length > 0) {
        events.append({
            eventType: EVENT_TYPES.MEMORY_ATTACHMENT_SUMMARY_SKIPPED,
            scopeType: EVENT_SCOPE_TYPES.MEMORY,
            scopeId: sent.turnId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            agentId: memoryInput.agentId,
            status: TASK_STATUSES.COMPLETED,
            title: "附件摘要跳过",
            summary: "本轮已保存附件来源，真实附件解析和摘要追加不在当前任务实现。",
            payload: withOptionalGraphCheckpoint({
                reason: "ATTACHMENT_SUMMARY_NOT_IMPLEMENTED",
                attachmentSources,
            }, graphCheckpoint),
        });
    }
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
            attachments: attachmentSources,
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
    if (looksLikeGenericFailureReply(normalizedAssistantText)) {
        return false;
    }
    return true;
}

/**
 * isLowSignalAssistantReply：判断回复是否缺少可复用长期记忆价值。
 *
 * @param assistantText 助手回复。
 * @returns 回复过短、重复或明显占位时返回 true。
 */
function isLowSignalAssistantReply(assistantText: string): boolean {
    if (assistantText.length < 4) {
        return true;
    }

    const compactText = assistantText.replace(/\s+/gu, "");
    const uniqueCharacters = new Set(Array.from(compactText));
    if (compactText.length >= 4 && uniqueCharacters.size <= 2) {
        return true;
    }

    if (/^[\p{P}\p{S}\s]+$/u.test(assistantText)) {
        return true;
    }

    // placeholderPatterns: 仅识别通用模板占位符，不匹配具体用户提示词或业务身份词。
    const placeholderPatterns = [
        /TODO/iu,
        /TBD/iu,
        /N\/A/iu,
        /FIXME/iu,
        /placeholder/iu,
        /<[^>\s]+>/u,
    ];
    if (placeholderPatterns.some((pattern) => {
        return pattern.test(assistantText);
    })) {
        return true;
    }
    return assistantText.includes("{{") && assistantText.includes("}}");
}

/**
 * looksLikeGenericFailureReply：识别不应写入长期记忆的泛化失败回复。
 *
 * @param assistantText 助手回复。
 * @returns 失败表达缺少具体可复用事实时返回 true。
 */
function looksLikeGenericFailureReply(assistantText: string): boolean {
    const normalized = assistantText.toLowerCase();
    const failureMarkers = [
        "error",
        "failed",
        "failure",
        "exception",
        "无法",
        "不能",
        "失败",
        "错误",
        "异常",
    ];
    const hasFailureMarker = failureMarkers.some((marker) => {
        return normalized.includes(marker);
    });
    if (!hasFailureMarker) {
        return false;
    }

    const alphaNumericCount = Array.from(assistantText.matchAll(/[\p{L}\p{N}]/gu)).length;
    return assistantText.length < 80 || alphaNumericCount < 12;
}

