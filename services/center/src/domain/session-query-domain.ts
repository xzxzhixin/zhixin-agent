import {randomUUID} from "node:crypto";

import type {
    ConversationSession,
    DeleteProjectResult,
    EventRecord,
    ProjectRecord,
} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {SessionRepository} from "../data-access/session-repository.js";

/**
 * deleteSession：删除指定会话及其下属消息、轮次、任务和附件索引。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param session 会话事实记录。
 * @returns 删除结果，包含被删除会话 ID。
 */
export function deleteSession(
    database: CenterDatabase,
    events: CenterEventStore,
    session: ConversationSession,
): {
    sessionId: string;
    deleted: boolean;
} {
    // 仅删除当前会话事实表中的索引数据；事件日志作为审计来源保留，附件物理文件由后续清理策略统一处理。
    new SessionRepository(database).deleteSessionFacts(session.sessionId);

    events.append({
        eventType: "session.deleted",
        scopeType: "session",
        scopeId: session.sessionId,
        sessionId: session.sessionId,
        turnId: null,
        taskId: null,
        projectId: session.projectId,
        status: "completed",
        title: "会话删除",
        summary: session.title,
        payload: {
            sessionId: session.sessionId,
            sessionType: session.sessionType,
            projectId: session.projectId,
        },
    });

    return {
        sessionId: session.sessionId,
        deleted: true,
    };
}

/**
 * deleteProject：删除项目索引及该项目下属会话事实。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param project 项目事实记录。
 * @returns 删除结果，包含项目 ID 和清理的项目会话数量。
 */
export function deleteProject(
    database: CenterDatabase,
    events: CenterEventStore,
    project: ProjectRecord,
): DeleteProjectResult {
    // 只清理中心服务事实源；项目根目录和 致心项目ID.md 属于用户工程文件，不在项目删除接口中触碰。
    const deletedSessionCount = new SessionRepository(database).deleteProjectFacts(project.projectId);

    events.append({
        eventType: "project.deleted",
        scopeType: "project",
        scopeId: project.projectId,
        sessionId: null,
        turnId: null,
        taskId: null,
        projectId: project.projectId,
        status: "completed",
        title: "项目删除",
        summary: project.displayName,
        payload: {
            projectId: project.projectId,
            displayName: project.displayName,
            deletedSessionCount,
            // keepProjectIdentityFile: 明确 UI 提示的边界，删除中心服务记录不删除磁盘身份文件。
            keepProjectIdentityFile: true,
        },
    });

    return {
        projectId: project.projectId,
        deletedSessionCount,
        deleted: true,
    };
}

/**
 * savePendingMessage：保存运行中用户补充引导消息。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @param clientId 客户端 ID，允许为空。
 * @param contentMarkdown 用户补充内容。
 * @returns 待处理消息 ID 和等待状态。
 */
export function savePendingMessage(
    database: CenterDatabase,
    sessionId: string,
    clientId: string | null,
    contentMarkdown: string,
): {
    pendingMessageId: string;
    status: string;
} {
    const pendingMessageId = randomUUID();
    const now = new Date().toISOString();
    new SessionRepository(database).savePendingMessage({
        pendingMessageId,
        sessionId,
        clientId,
        contentMarkdown,
        now,
    });
    return {
        pendingMessageId,
        status: "waiting_user",
    };
}

/**
 * listPendingMessages：读取会话内仍待合并的用户补充消息。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 待处理消息列表。
 */
export function listPendingMessages(
    database: CenterDatabase,
    sessionId: string,
): unknown[] {
    return new SessionRepository(database).listPendingMessages(sessionId);
}

/**
 * listEvents：查询断线补齐事件。
 *
 * @param database 中心服务数据库。
 * @param filter 事件筛选条件。
 * @returns 事件记录数组。
 */
export function listEvents(
    database: CenterDatabase,
    filter: {
        sessionId: string | null;
        turnId: string | null;
        agentId?: string | null;
        afterSequence: number;
    },
): EventRecord[] {
    return new SessionRepository(database).listEvents(filter);
}
