import {randomUUID} from "node:crypto";

import type {
    ClientType,
    ConversationMessage,
    ConversationSession,
    ConversationTurn,
    EventRecord,
    ProjectRecord,
    SessionType,
    TaskRecord,
} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import type {SendMessageResponse, TaskStepRecord} from "./types.js";
import {SessionRepository} from "./data-access/session-repository.js";
import {
    appendModelStreamEvent,
    appendThinkingEvents,
    handleWorkerMessage,
    recordUsage,
    startWorkerTask,
} from "./workflow-domain.js";
import {refreshUsageDailyStats} from "./usage-domain.js";
import {
    invokeProviderModelGateway,
    type ProviderModelGatewayResult,
} from "./model-gateway-runtime.js";
import {
    appendToolVisibilityEvents,
    runNodeVersionCommandTool,
} from "./tool-runtime.js";

export function upsertSyncClient(
    database: CenterDatabase,
    input: {
        clientType: ClientType;
        projectId: string | null;
    },
): string {
    // clientId: 当前阶段每次授权生成新客户端 ID，后续 WebSocket 可绑定该 ID。
    const clientId = randomUUID();
    // now: 同步客户端最后访问时间。
    const now = new Date().toISOString();
    database.connection()
        .prepare(`
            INSERT INTO sync_clients (id,
                                      client_type,
                                      project_id,
                                      last_seen_at,
                                      last_event_sequence)
            VALUES (?, ?, ?, ?, ?)
        `)
        .run(
            clientId,
            input.clientType,
            input.projectId,
            now,
            0,
        );

    return clientId;
}

/**
 * findProject：按项目 ID 查询项目记录。
 *
 * @param database 中心服务数据库。
 * @param projectId 项目 UUID。
 * @returns 找到时返回项目记录，否则返回 null。
 */
export function findProject(database: CenterDatabase, projectId: string): ProjectRecord | null {
    return new SessionRepository(database).findProject(projectId) as ProjectRecord | null;
}

/**
 * listProjects：读取已登记项目列表。
 *
 * @param database 中心服务数据库。
 * @returns 按最近更新时间倒序排列的项目记录数组。
 */
export function listProjects(database: CenterDatabase): ProjectRecord[] {
    return new SessionRepository(database).listProjects() as ProjectRecord[];
}

/**
 * findSession：按会话 ID 查询会话记录。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 找到时返回会话记录，否则返回 null。
 */
export function findSession(database: CenterDatabase, sessionId: string): ConversationSession | null {
    return new SessionRepository(database).findSession(sessionId);
}

/**
 * listSessions：按类型和项目筛选会话列表。
 *
 * @param database 中心服务数据库。
 * @param filter 会话筛选条件。
 * @returns 会话记录数组。
 */
export function listSessions(
    database: CenterDatabase,
    filter: {
        sessionType?: SessionType;
        projectId?: string | null;
    },
): ConversationSession[] {
    return new SessionRepository(database).listSessions(filter);
}

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
    const transaction = database.connection().transaction(() => {
        database.connection()
            .prepare(`
                DELETE FROM task_steps
                WHERE task_id IN (
                    SELECT id
                    FROM tasks
                    WHERE session_id = ?
                )
            `)
            .run(session.sessionId);

        database.connection()
            .prepare("DELETE FROM tasks WHERE session_id = ?")
            .run(session.sessionId);

        database.connection()
            .prepare("DELETE FROM conversation_turns WHERE session_id = ?")
            .run(session.sessionId);

        database.connection()
            .prepare("DELETE FROM pending_messages WHERE session_id = ?")
            .run(session.sessionId);

        database.connection()
            .prepare("DELETE FROM attachments WHERE session_id = ?")
            .run(session.sessionId);

        database.connection()
            .prepare("DELETE FROM messages WHERE session_id = ?")
            .run(session.sessionId);

        database.connection()
            .prepare("DELETE FROM sessions WHERE id = ?")
            .run(session.sessionId);
    });

    transaction();

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
 * listMessages：查询会话消息列表。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 消息记录数组。
 */
export function listMessages(database: CenterDatabase, sessionId: string): ConversationMessage[] {
    return new SessionRepository(database).listMessages(sessionId);
}

/**
 * listTurns：查询会话轮次列表。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 轮次记录数组。
 */
export function listTurns(database: CenterDatabase, sessionId: string): ConversationTurn[] {
    return new SessionRepository(database).listTurns(sessionId);
}

/**
 * listTasks：查询会话任务列表。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 任务记录数组。
 */
export function listTasks(database: CenterDatabase, sessionId: string): TaskRecord[] {
    return new SessionRepository(database).listTasks(sessionId);
}

/**
 * listTaskSteps：查询会话下所有任务步骤。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 任务步骤数组。
 */
export function listTaskSteps(database: CenterDatabase, sessionId: string): TaskStepRecord[] {
    return new SessionRepository(database).listTaskSteps(sessionId);
}

/**
 * findTask：按任务 ID 查询任务。
 *
 * @param database 中心服务数据库。
 * @param taskId 任务 ID。
 * @returns 找到时返回任务记录，否则返回 null。
 */
export function findTask(database: CenterDatabase, taskId: string): TaskRecord | null {
    return new SessionRepository(database).findTask(taskId);
}

/**
 * createTaskStep：创建任务步骤并写入事件。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param task 任务记录。
 * @param title 步骤标题。
 * @returns 创建后的任务步骤记录。
 */
export function createTaskStep(
    database: CenterDatabase,
    events: CenterEventStore,
    task: TaskRecord,
    title: string,
): TaskStepRecord {
    // stepId: 任务步骤身份。
    const stepId = randomUUID();
    // now: 步骤开始时间。
    const now = new Date().toISOString();

    database.connection()
        .prepare(`
            INSERT INTO task_steps (id,
                                    task_id,
                                    status,
                                    title,
                                    started_at,
                                    ended_at,
                                    summary)
            VALUES (?, ?, ?, ?, ?, NULL, NULL)
        `)
        .run(
            stepId,
            task.taskId,
            "running",
            title,
            now,
        );

    database.connection()
        .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
        .run(
            "running",
            now,
            task.taskId,
        );

    events.append({
        eventType: "task.step.started",
        scopeType: "task_step",
        scopeId: stepId,
        sessionId: task.sessionId,
        turnId: task.turnId,
        taskId: task.taskId,
        stepId,
        status: "running",
        title: "任务步骤开始",
        summary: title,
        payload: {
            stepId,
            title,
        },
    });

    return {
        stepId,
        taskId: task.taskId,
        status: "running",
        title,
        startedAt: now,
        endedAt: null,
        summary: null,
    };
}

/**
 * updateTaskStep：更新任务步骤状态和摘要。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param stepId 步骤 ID。
 * @param status 新状态。
 * @param summary 步骤摘要。
 * @returns 更新后的步骤记录；不存在时返回 null。
 */
export function updateTaskStep(
    database: CenterDatabase,
    events: CenterEventStore,
    stepId: string,
    status: TaskRecord["status"],
    summary: string | null,
): TaskStepRecord | null {
    const existing = database.connection()
        .prepare(`
            SELECT task_steps.id         AS stepId,
                   task_steps.task_id    AS taskId,
                   task_steps.status,
                   task_steps.title,
                   task_steps.started_at AS startedAt,
                   task_steps.ended_at   AS endedAt,
                   task_steps.summary,
                   tasks.session_id      AS sessionId,
                   tasks.turn_id         AS turnId
            FROM task_steps
                     INNER JOIN tasks ON tasks.id = task_steps.task_id
            WHERE task_steps.id = ?
        `)
        .get(stepId) as (TaskStepRecord & {
        sessionId: string;
        turnId: string;
    }) | undefined;

    if (!existing) {
        return null;
    }

    // now: 终态步骤保存结束时间，运行态保留空结束时间。
    const now = new Date().toISOString();
    const endedAt = isFinalTaskStatus(status) ? now : null;

    database.connection()
        .prepare("UPDATE task_steps SET status = ?, ended_at = ?, summary = ? WHERE id = ?")
        .run(
            status,
            endedAt,
            summary,
            stepId,
        );

    events.append({
        eventType: "task.step.updated",
        scopeType: "task_step",
        scopeId: stepId,
        sessionId: existing.sessionId,
        turnId: existing.turnId,
        taskId: existing.taskId,
        stepId,
        status,
        title: "任务步骤更新",
        summary: summary ?? existing.title,
        payload: {
            stepId,
            status,
        },
    });

    return {
        stepId,
        taskId: existing.taskId,
        status,
        title: existing.title,
        startedAt: existing.startedAt,
        endedAt,
        summary,
    };
}

/**
 * updateTurnStatus：更新轮次状态，并同步默认任务终态。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param turnId 轮次 ID。
 * @param status 新轮次状态。
 * @returns 更新后的轮次记录；不存在时返回 null。
 */
export function updateTurnStatus(
    database: CenterDatabase,
    events: CenterEventStore,
    turnId: string,
    status: "waiting_user" | "completed" | "failed" | "cancelled",
): ConversationTurn | null {
    const turn = database.connection()
        .prepare(`
            SELECT id              AS turnId,
                   session_id      AS sessionId,
                   turn_number     AS turnNumber,
                   user_message_id AS userMessageId,
                   status,
                   started_at      AS startedAt,
                   ended_at        AS endedAt,
                   duration_ms     AS durationMs
            FROM conversation_turns
            WHERE id = ?
        `)
        .get(turnId) as ConversationTurn | undefined;

    if (!turn) {
        return null;
    }

    // now: 终态轮次固定结束时间，等待用户状态仍不写结束时间。
    const now = new Date().toISOString();
    const endedAt = status === "waiting_user" ? null : now;
    const durationMs = endedAt ? Math.max(0, new Date(endedAt).getTime() - new Date(turn.startedAt).getTime()) : null;

    database.connection()
        .prepare("UPDATE conversation_turns SET status = ?, ended_at = ?, duration_ms = ? WHERE id = ?")
        .run(
            status,
            endedAt,
            durationMs,
            turnId,
        );

    const taskStatus = mapTurnStatusToTaskStatus(status);
    database.connection()
        .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE turn_id = ?")
        .run(
            taskStatus,
            now,
            turnId,
        );

    events.append({
        eventType: "turn.updated",
        scopeType: "turn",
        scopeId: turnId,
        sessionId: turn.sessionId,
        turnId,
        taskId: null,
        status,
        title: "轮次状态更新",
        summary: `轮次状态更新为 ${status}`,
        payload: {
            turnId,
            status,
            endedAt,
            durationMs,
        },
    });

    return {
        ...turn,
        status,
        endedAt,
        durationMs,
    };
}

/**
 * isFinalTaskStatus：判断任务步骤是否进入终态。
 *
 * @param status 任务状态。
 * @returns 终态返回 true。
 */
export function isFinalTaskStatus(status: TaskRecord["status"]): boolean {
    return status === "completed"
        || status === "failed"
        || status === "cancelled";
}

/**
 * mapTurnStatusToTaskStatus：把轮次状态映射到任务状态。
 *
 * @param status 轮次状态。
 * @returns 任务状态。
 */
export function mapTurnStatusToTaskStatus(status: "waiting_user" | "completed" | "failed" | "cancelled"): TaskRecord["status"] {
    if (status === "waiting_user") {
        return "waiting_user";
    }

    return status;
}

/**
 * createMessageTurnAndTask：创建用户消息、轮次、默认任务并追加事件。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param session 会话记录。
 * @param contentMarkdown 用户发送的 Markdown 内容。
 * @returns 消息、轮次和任务 ID。
 */
export function createMessageTurnAndTask(
    database: CenterDatabase,
    events: CenterEventStore,
    session: ConversationSession,
    contentMarkdown: string,
): SendMessageResponse {
    // now: 消息、轮次和任务共享同一服务端创建时间，便于审计。
    const now = new Date().toISOString();
    // messageId: 用户消息身份。
    const messageId = randomUUID();
    // turnId: 本轮对话身份。
    const turnId = randomUUID();
    // taskId: 默认任务身份，后续 Worker 接管后继续更新该任务。
    const taskId = randomUUID();
    // turnNumber: 同一会话内用户发起轮次递增。
    const turnNumberRow = database.connection()
        .prepare("SELECT MAX(turn_number) AS maxTurnNumber FROM conversation_turns WHERE session_id = ?")
        .get(session.sessionId) as {
        maxTurnNumber: number | null;
    } | undefined;
    const turnNumber = (turnNumberRow?.maxTurnNumber ?? 0) + 1;

    const transaction = database.connection().transaction(() => {
        database.connection()
            .prepare(`
                INSERT INTO messages (id,
                                      session_id,
                                      turn_id,
                                      role,
                                      content_markdown,
                                      created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `)
            .run(
                messageId,
                session.sessionId,
                turnId,
                "user",
                contentMarkdown,
                now,
            );

        database.connection()
            .prepare(`
                INSERT INTO conversation_turns (id,
                                                session_id,
                                                turn_number,
                                                user_message_id,
                                                status,
                                                started_at,
                                                ended_at,
                                                duration_ms)
                VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
            `)
            .run(
                turnId,
                session.sessionId,
                turnNumber,
                messageId,
                "running",
                now,
            );

        database.connection()
            .prepare(`
                INSERT INTO tasks (id,
                                   turn_id,
                                   session_id,
                                   status,
                                   title,
                                   created_at,
                                   updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
                taskId,
                turnId,
                session.sessionId,
                "queued",
                "等待 Agent 执行",
                now,
                now,
            );

        database.connection()
            .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
            .run(
                now,
                session.sessionId,
            );
    });

    transaction();

    events.append({
        eventType: "turn.started",
        scopeType: "turn",
        scopeId: turnId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: "running",
        title: "轮次开始",
        summary: "用户发送消息后创建新轮次。",
        payload: {
            turnId,
            turnNumber,
            userMessageId: messageId,
        },
    });

    events.append({
        eventType: "message.created",
        scopeType: "message",
        scopeId: messageId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: "completed",
        title: "消息创建",
        summary: "用户消息已写入中心服务。",
        payload: {
            messageId,
            role: "user",
        },
    });

    events.append({
        eventType: "task.updated",
        scopeType: "task",
        scopeId: taskId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: "queued",
        title: "任务排队",
        summary: "消息发送后默认任务进入排队状态。",
        payload: {
            taskId,
        },
    });

    return {
        sessionId: session.sessionId,
        messageId,
        turnId,
        taskId,
    };
}

/**
 * completeCreatedTurn：把已创建的消息轮次接入最小执行闭环。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 发送接口创建的消息、轮次和任务身份。
 * @param userText 用户原始输入。
 * @returns 没有返回值。
 */
export function completeCreatedTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    userText: string,
): void {
    const assistantMessageId = randomUUID();
    const now = new Date().toISOString();
    const turn = database.connection()
        .prepare("SELECT session_id AS sessionId FROM conversation_turns WHERE id = ?")
        .get(sent.turnId) as {
        sessionId: string;
    } | undefined;

    startWorkerTask(database, events, sent.taskId);
    const thinkingStep = createTaskStep(
        database,
        events,
        {
            taskId: sent.taskId,
            turnId: sent.turnId,
            sessionId: sent.sessionId,
            status: "running",
            title: "对话执行编排",
            createdAt: now,
            updatedAt: now,
        },
        "思考与上下文整理",
    );
    try {
        appendThinkingEvents(
            events,
            sent.sessionId,
            sent.taskId,
            sent.turnId,
            userText,
        );
        updateTaskStep(
            database,
            events,
            thinkingStep.stepId,
            "completed",
            "思考过程和上下文整理完成。",
        );
        const modelStep = createTaskStep(
            database,
            events,
            {
                taskId: sent.taskId,
                turnId: sent.turnId,
                sessionId: sent.sessionId,
                status: "running",
                title: "模型调用",
                createdAt: now,
                updatedAt: now,
            },
            "模型流式输出",
        );
        const modelResult = invokeProviderModelGateway(database, events, sent.taskId, sent.turnId, userText);
        appendModelStreamEvent(events, sent.sessionId, sent.taskId, sent.turnId, modelResult);
        updateTaskStep(
            database,
            events,
            modelStep.stepId,
            "completed",
            "模型流式输出完成并准备固化助手消息。",
        );
        const toolStep = createTaskStep(
            database,
            events,
            {
                taskId: sent.taskId,
                turnId: sent.turnId,
                sessionId: sent.sessionId,
                status: "running",
                title: "自动工具过程",
                createdAt: now,
                updatedAt: now,
            },
            "命令、插件、MCP 和 skill 状态记录",
        );
        appendToolVisibilityEvents(
            events,
            sent.sessionId,
            sent.taskId,
            sent.turnId,
        );
        if (userText.includes("Node.js 版本") || userText.includes("node -v")) {
            // 命令工具只能由对话语义触发，避免浏览器按钮绕过任务编排和审计事件链路。
            runNodeVersionCommandTool(
                events,
                sent.sessionId,
                sent.taskId,
                sent.turnId,
            );
        }
        updateTaskStep(
            database,
            events,
            toolStep.stepId,
            "completed",
            "命令工具、插件、MCP 和 skill 过程已写入可见事件。",
        );
        database.connection()
            .prepare("INSERT INTO messages (id, session_id, turn_id, role, content_markdown, created_at) SELECT ?, session_id, id, ?, ?, ? FROM conversation_turns WHERE id = ?")
            .run(
                assistantMessageId,
                "assistant",
                modelResult.assistantText,
                now,
                sent.turnId,
            );
        events.append({
            eventType: "message.created",
            scopeType: "message",
            scopeId: assistantMessageId,
            sessionId: turn?.sessionId ?? null,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "completed",
            title: "消息创建",
            summary: "助手回复已写入中心服务。",
            payload: {
                messageId: assistantMessageId,
                role: "assistant",
            },
        });
        handleWorkerMessage(database, events, "task.complete", sent.taskId, {
            assistantMessageId,
            providerId: modelResult.providerId,
            model: modelResult.model,
            usage: modelResult.usage,
        });
        recordModelUsageAfterTurn(database, events, sent, modelResult);
        updateSessionTitleAfterTurn(database, events, sent, userText, modelResult.assistantText);
        updateTurnStatus(database, events, sent.turnId, "completed");
    } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_MODEL_ERROR";
        database.connection()
            .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
            .run(
                "failed",
                new Date().toISOString(),
                sent.taskId,
            );
        database.connection()
            .prepare("UPDATE conversation_turns SET status = ?, ended_at = ?, duration_ms = ? WHERE id = ?")
            .run(
                "failed",
                new Date().toISOString(),
                0,
                sent.turnId,
            );
        events.append({
            eventType: "model.failed",
            scopeType: "model",
            scopeId: sent.taskId,
            sessionId: turn?.sessionId ?? null,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "failed",
            title: "模型调用失败",
            summary: message,
            payload: {
                taskId: sent.taskId,
                turnId: sent.turnId,
                errorMessage: message,
            },
        });
        handleWorkerMessage(database, events, "task.failed", sent.taskId, {
            errorMessage: message,
        });
    }
}

/**
 * recordModelUsageAfterTurn：真实模型调用完成后写入用量原始记录并刷新日聚合。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 当前发送接口返回的会话、轮次和任务身份。
 * @param modelResult 模型网关返回的真实供应商、模型和用量。
 * @returns 写入成功时返回用量记录 ID；模型未返回用量时返回 null。
 */
export function recordModelUsageAfterTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    modelResult: ProviderModelGatewayResult,
): string | null {
    if (!modelResult.usage) {
        events.append({
            eventType: "usage.record.skipped",
            scopeType: "usage",
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "completed",
            title: "用量记录跳过",
            summary: "模型供应商未返回用量字段，原始用量不写入。",
            payload: {
                providerId: modelResult.providerId,
                model: modelResult.model,
                reason: "MODEL_USAGE_NOT_PROVIDED",
            },
        });
        return null;
    }

    const session = findSession(database, sent.sessionId);
    if (!session) {
        events.append({
            eventType: "usage.record.failed",
            scopeType: "usage",
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "failed",
            title: "用量记录失败",
            summary: "用量写入时未找到当前会话，已保留模型回复。",
            payload: {
                sessionId: sent.sessionId,
                providerId: modelResult.providerId,
                model: modelResult.model,
                reason: "SESSION_NOT_FOUND",
            },
            errorCode: "USAGE_SESSION_NOT_FOUND",
        });
        return null;
    }

    const usage = recordUsage(database, events, {
        providerId: modelResult.providerId,
        model: modelResult.model,
        projectId: session.projectId,
        sessionId: sent.sessionId,
        inputTokens: modelResult.usage.inputTokens,
        outputTokens: modelResult.usage.outputTokens,
        cacheHitTokens: modelResult.usage.cacheHitTokens,
        cacheMissTokens: modelResult.usage.cacheMissTokens,
        status: "completed",
    });
    refreshUsageDailyStats(database);
    return usage.usageId;
}

/**
 * summarizeSessionTitle：根据本轮真实对话内容生成会话标题摘要。
 *
 * @param userText 用户本轮输入，来源于已落库用户消息。
 * @param assistantText 助手本轮回复，来源于真实模型网关返回。
 * @returns 适合列表展示的短标题。
 */
export function summarizeSessionTitle(
    userText: string,
    assistantText: string,
): string {
    // sourceText: 标题以用户目标为主，助手回复只在用户输入极短时补充语义；两者都来自当前轮次事实，不猜测其他字段。
    const sourceText = `${userText}\n${assistantText}`.replace(/\s+/gu, " ").trim();
    // normalized: 移除 Markdown 语法符号，避免列表标题出现链接、标题井号或代码围栏残片。
    const normalized = sourceText
        .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
        .replace(/[`*_>#-]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();

    if (normalized.length === 0) {
        throw new Error("SESSION_TITLE_SUMMARY_EMPTY");
    }

    // title: 会话列表需要短标题，超过 28 个字符时截断，避免侧栏被长文本撑开。
    const title = normalized.slice(0, 28);
    return normalized.length > 28 ? `${title}...` : title;
}

/**
 * updateSessionTitleAfterTurn：真实对话完成后固化会话标题并写入同步事件。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 本轮发送后生成的消息、轮次和任务身份。
 * @param userText 用户本轮输入。
 * @param assistantText 助手本轮回复。
 * @returns 更新后的会话记录；失败时返回 null 并保留原标题。
 */
export function updateSessionTitleAfterTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    userText: string,
    assistantText: string,
): ConversationSession | null {
    const turnSession = database.connection()
        .prepare("SELECT session_id AS sessionId FROM conversation_turns WHERE id = ?")
        .get(sent.turnId) as {
        sessionId: string;
    } | undefined;
    const session = turnSession ? findSession(database, turnSession.sessionId) : null;
    if (!session) {
        events.append({
            eventType: "session.title_summary.failed",
            scopeType: "session",
            scopeId: turnSession?.sessionId ?? null,
            sessionId: turnSession?.sessionId ?? null,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "failed",
            title: "会话标题总结失败",
            summary: "标题总结时未找到会话，已保留原标题。",
            payload: {
                sessionId: turnSession?.sessionId ?? null,
                reason: "SESSION_NOT_FOUND",
            },
            errorCode: "SESSION_NOT_FOUND",
        });
        return null;
    }

    try {
        // nextTitle: 标题摘要只使用当前轮真实用户输入和助手回复，避免从旧标题或多候选字段猜测。
        const nextTitle = summarizeSessionTitle(
            userText,
            assistantText,
        );
        // now: 会话标题变化属于会话元信息更新，需要刷新列表排序和详情更新时间。
        const now = new Date().toISOString();
        database.connection()
            .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
            .run(
                nextTitle,
                now,
                session.sessionId,
            );
        const updatedSession = findSession(database, session.sessionId);
        if (!updatedSession) {
            throw new Error("SESSION_UPDATED_ROW_NOT_FOUND");
        }

        events.append({
            eventType: "session.updated",
            scopeType: "session",
            scopeId: session.sessionId,
            sessionId: session.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            projectId: session.projectId,
            status: "completed",
            title: "会话标题更新",
            summary: nextTitle,
            payload: {
                session: updatedSession,
                previousTitle: session.title,
                titleSummarySource: "turn-completion",
            },
        });

        return updatedSession;
    } catch (error) {
        const message = error instanceof Error ? error.message : "SESSION_TITLE_SUMMARY_UNKNOWN";
        events.append({
            eventType: "session.title_summary.failed",
            scopeType: "session",
            scopeId: session.sessionId,
            sessionId: session.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            projectId: session.projectId,
            status: "failed",
            title: "会话标题总结失败",
            summary: "标题总结失败，已保留原标题。",
            payload: {
                sessionId: session.sessionId,
                preservedTitle: session.title,
                reason: message,
            },
            errorCode: "SESSION_TITLE_SUMMARY_FAILED",
        });
        return null;
    }
}

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
    database.connection()
        .prepare("INSERT INTO pending_messages (id, session_id, client_id, content_markdown, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
            pendingMessageId,
            sessionId,
            clientId,
            contentMarkdown,
            "waiting_user",
            now,
            now,
        );
    return {
        pendingMessageId,
        status: "waiting_user",
    };
}

export function listPendingMessages(
    database: CenterDatabase,
    sessionId: string,
): unknown[] {
    return database.connection()
        .prepare("SELECT id AS pendingMessageId, session_id AS sessionId, client_id AS clientId, content_markdown AS contentMarkdown, status, created_at AS createdAt, updated_at AS updatedAt FROM pending_messages WHERE session_id = ? ORDER BY created_at ASC")
        .all(sessionId);
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
        afterSequence: number;
    },
): EventRecord[] {
    return new SessionRepository(database).listEvents(filter);
}

