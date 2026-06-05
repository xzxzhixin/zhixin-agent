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

import type {CenterDatabase} from "../database.js";
import type {TaskStepRecord} from "../types.js";

/**
 * SessionRepository：会话、任务和事件 SQLite 访问层。
 *
 * 用途：把高频会话 SQL 从领域服务中收敛到数据访问边界。
 * 关键逻辑：只复用 CenterDatabase 连接，不创建新的 SQLite 实例，保持中心服务主进程唯一连接。
 */
export class SessionRepository {
    /** database: 中心服务主进程持有的数据库连接包装。 */
    private readonly database: CenterDatabase;

    /**
     * constructor：保存中心服务数据库包装。
     *
     * @param database 中心服务数据库。
     */
    constructor(database: CenterDatabase) {
        this.database = database;
    }

    /**
     * upsertSyncClient：写入实时同步客户端授权记录。
     *
     * @param input 客户端类型、项目范围、客户端 ID 和更新时间。
     * @returns 没有返回值。
     */
    upsertSyncClient(input: {
        clientId: string;
        clientType: ClientType;
        projectId: string | null;
        lastSeenAt: string;
    }): void {
        this.database.connection()
            .prepare(`
                INSERT INTO sync_clients (id,
                                          client_type,
                                          project_id,
                                          last_seen_at,
                                          last_event_sequence)
                VALUES (?, ?, ?, ?, ?)
            `)
            .run(
                input.clientId,
                input.clientType,
                input.projectId,
                input.lastSeenAt,
                0,
            );
    }

    /**
     * isSyncClientAllowed：校验同步客户端订阅范围。
     *
     * @param input 客户端 ID、客户端类型和项目范围。
     * @returns 允许订阅时返回 true。
     */
    isSyncClientAllowed(input: {
        clientId: string;
        clientType: ClientType;
        projectId: string | null;
    }): boolean {
        const row = this.database.connection()
            .prepare("SELECT id, client_type AS clientType, project_id AS projectId FROM sync_clients WHERE id = ?")
            .get(input.clientId) as {
            id: string;
            clientType: ClientType;
            projectId: string | null;
        } | undefined;

        if (!row || row.clientType !== input.clientType) {
            return false;
        }

        if (input.clientType === "ide-plugin") {
            return row.projectId === input.projectId;
        }

        return true;
    }

    /**
     * upsertProject：登记或更新项目索引。
     *
     * @param input 项目 ID、主名称、路径和时间。
     * @returns 已登记项目记录。
     */
    upsertProject(input: {
        projectId: string;
        displayName: string;
        latestPath: string;
        now: string;
    }): ProjectRecord {
        this.database.connection()
            .prepare(`
                INSERT INTO projects (id,
                                      display_name,
                                      alias,
                                      latest_path,
                                      created_at,
                                      updated_at)
                VALUES (?, ?, NULL, ?, ?, ?) ON CONFLICT(id) DO
                UPDATE SET
                    display_name = excluded.display_name,
                    latest_path = excluded.latest_path,
                    updated_at = excluded.updated_at
            `)
            .run(
                input.projectId,
                input.displayName,
                input.latestPath,
                input.now,
                input.now,
            );

        return {
            projectId: input.projectId,
            displayName: input.displayName,
            alias: null,
            latestPath: input.latestPath,
            createdAt: input.now,
            updatedAt: input.now,
        };
    }

    /**
     * createSession：创建会话记录。
     *
     * @param input 会话字段。
     * @returns 新会话共享协议记录。
     */
    createSession(input: {
        sessionId: string;
        sessionType: SessionType;
        projectId: string | null;
        title: string;
        now: string;
    }): ConversationSession {
        this.database.connection()
            .prepare(`
                INSERT INTO sessions (id,
                                      session_type,
                                      project_id,
                                      title,
                                      created_at,
                                      updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `)
            .run(
                input.sessionId,
                input.sessionType,
                input.projectId,
                input.title,
                input.now,
                input.now,
            );

        return {
            sessionId: input.sessionId,
            sessionType: input.sessionType,
            projectId: input.projectId,
            title: input.title,
            createdAt: input.now,
            updatedAt: input.now,
            lastUserMessagePreview: null,
        };
    }

    /**
     * findProject：按项目 ID 查询项目记录。
     *
     * @param projectId 项目 UUID。
     * @returns 找到时返回项目记录，否则返回 null。
     */
    findProject(projectId: string) {
        const row = this.database.connection()
            .prepare(`
                SELECT id           AS projectId,
                       display_name AS displayName,
                       alias,
                       latest_path  AS latestPath,
                       created_at   AS createdAt,
                       updated_at   AS updatedAt
                FROM projects
                WHERE id = ?
            `)
            .get(projectId);

        return row ?? null;
    }

    /**
     * listProjects：读取项目列表。
     *
     * @returns 项目数组。
     */
    listProjects() {
        return this.database.connection()
            .prepare(`
                SELECT id           AS projectId,
                       display_name AS displayName,
                       alias,
                       latest_path  AS latestPath,
                       created_at   AS createdAt,
                       updated_at   AS updatedAt
                FROM projects
                ORDER BY updated_at DESC
            `)
            .all();
    }

    /**
     * findSession：按 ID 查询会话。
     *
     * @param sessionId 会话 ID。
     * @returns 会话记录或 null。
     */
    findSession(sessionId: string): ConversationSession | null {
        const row = this.database.connection()
            .prepare(this.sessionSelectSql("WHERE id = ?"))
            .get(sessionId) as ConversationSession | undefined;

        return row ?? null;
    }

    /**
     * listSessions：按筛选条件查询会话。
     *
     * @param filter 会话类型和项目筛选。
     * @returns 会话列表。
     */
    listSessions(filter: {
        sessionType?: SessionType;
        projectId?: string | null;
    }): ConversationSession[] {
        if (filter.sessionType === "project" && filter.projectId) {
            return this.database.connection()
                .prepare(this.sessionSelectSql("WHERE session_type = ? AND project_id = ?"))
                .all(
                    filter.sessionType,
                    filter.projectId,
                ) as ConversationSession[];
        }

        if (filter.sessionType) {
            return this.database.connection()
                .prepare(this.sessionSelectSql("WHERE session_type = ?"))
                .all(filter.sessionType) as ConversationSession[];
        }

        return this.database.connection()
            .prepare(this.sessionSelectSql(""))
            .all() as ConversationSession[];
    }

    /**
     * listMessages：查询会话消息。
     *
     * @param sessionId 会话 ID。
     * @returns 消息列表。
     */
    listMessages(sessionId: string): ConversationMessage[] {
        return this.database.connection()
            .prepare(`
                SELECT id               AS messageId,
                       session_id       AS sessionId,
                       turn_id          AS turnId,
                       role,
                       content_markdown AS contentMarkdown,
                       created_at       AS createdAt
                FROM messages
                WHERE session_id = ?
                ORDER BY created_at ASC
            `)
            .all(sessionId) as ConversationMessage[];
    }

    /**
     * listTurns：查询会话轮次。
     *
     * @param sessionId 会话 ID。
     * @returns 轮次列表。
     */
    listTurns(sessionId: string): ConversationTurn[] {
        return this.database.connection()
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
                WHERE session_id = ?
                ORDER BY turn_number ASC
            `)
            .all(sessionId) as ConversationTurn[];
    }

    /**
     * listTasks：查询会话任务。
     *
     * @param sessionId 会话 ID。
     * @returns 任务列表。
     */
    listTasks(sessionId: string): TaskRecord[] {
        return this.database.connection()
            .prepare(`
                SELECT id         AS taskId,
                       turn_id    AS turnId,
                       session_id AS sessionId,
                       status,
                       title,
                       created_at AS createdAt,
                       updated_at AS updatedAt
                FROM tasks
                WHERE session_id = ?
                ORDER BY created_at ASC
            `)
            .all(sessionId) as TaskRecord[];
    }

    /**
     * listTaskSteps：查询会话任务步骤。
     *
     * @param sessionId 会话 ID。
     * @returns 任务步骤列表。
     */
    listTaskSteps(sessionId: string): TaskStepRecord[] {
        return this.database.connection()
            .prepare(`
                SELECT task_steps.id         AS stepId,
                       task_steps.task_id    AS taskId,
                       task_steps.status,
                       task_steps.title,
                       task_steps.started_at AS startedAt,
                       task_steps.ended_at   AS endedAt,
                       task_steps.summary
                FROM task_steps
                         INNER JOIN tasks ON tasks.id = task_steps.task_id
                WHERE tasks.session_id = ?
                ORDER BY task_steps.started_at ASC
            `)
            .all(sessionId) as TaskStepRecord[];
    }

    /**
     * findTask：按任务 ID 查询任务。
     *
     * @param taskId 任务 ID。
     * @returns 任务记录或 null。
     */
    findTask(taskId: string): TaskRecord | null {
        const row = this.database.connection()
            .prepare(`
                SELECT id         AS taskId,
                       turn_id    AS turnId,
                       session_id AS sessionId,
                       status,
                       title,
                       created_at AS createdAt,
                       updated_at AS updatedAt
                FROM tasks
                WHERE id = ?
            `)
            .get(taskId) as TaskRecord | undefined;

        return row ?? null;
    }

    /**
     * deleteSessionFacts：删除会话事实表索引。
     *
     * @param sessionId 会话 ID。
     * @returns 没有返回值。
     */
    deleteSessionFacts(sessionId: string): void {
        const transaction = this.database.connection().transaction(() => {
            this.database.connection()
                .prepare(`
                    DELETE FROM task_steps
                    WHERE task_id IN (
                        SELECT id
                        FROM tasks
                        WHERE session_id = ?
                    )
                `)
                .run(sessionId);

            this.database.connection()
                .prepare("DELETE FROM tasks WHERE session_id = ?")
                .run(sessionId);

            this.database.connection()
                .prepare("DELETE FROM conversation_turns WHERE session_id = ?")
                .run(sessionId);

            this.database.connection()
                .prepare("DELETE FROM pending_messages WHERE session_id = ?")
                .run(sessionId);

            this.database.connection()
                .prepare("DELETE FROM attachments WHERE session_id = ?")
                .run(sessionId);

            this.database.connection()
                .prepare("DELETE FROM messages WHERE session_id = ?")
                .run(sessionId);

            this.database.connection()
                .prepare("DELETE FROM sessions WHERE id = ?")
                .run(sessionId);
        });

        transaction();
    }

    /**
     * deleteProjectFacts：删除项目索引和项目下会话事实。
     *
     * @param projectId 项目 UUID。
     * @returns 被清理的项目会话数量。
     */
    deleteProjectFacts(projectId: string): number {
        const projectSessionRows = this.database.connection()
            .prepare("SELECT id FROM sessions WHERE project_id = ?")
            .all(projectId) as Array<{
                /** id: 项目会话 ID，来源于 sessions 表。 */
                id: string;
            }>;
        const projectSessionIds = projectSessionRows.map((row) => {
            return row.id;
        });

        const transaction = this.database.connection().transaction(() => {
            for (const sessionId of projectSessionIds) {
                // 复用会话删除顺序，避免任务步骤、轮次、附件索引残留。
                this.database.connection()
                    .prepare(`
                        DELETE FROM task_steps
                        WHERE task_id IN (
                            SELECT id
                            FROM tasks
                            WHERE session_id = ?
                        )
                    `)
                    .run(sessionId);

                this.database.connection()
                    .prepare("DELETE FROM tasks WHERE session_id = ?")
                    .run(sessionId);

                this.database.connection()
                    .prepare("DELETE FROM conversation_turns WHERE session_id = ?")
                    .run(sessionId);

                this.database.connection()
                    .prepare("DELETE FROM pending_messages WHERE session_id = ?")
                    .run(sessionId);

                this.database.connection()
                    .prepare("DELETE FROM attachments WHERE session_id = ?")
                    .run(sessionId);

                this.database.connection()
                    .prepare("DELETE FROM messages WHERE session_id = ?")
                    .run(sessionId);
            }

            this.database.connection()
                .prepare("DELETE FROM sessions WHERE project_id = ?")
                .run(projectId);

            this.database.connection()
                .prepare("DELETE FROM projects WHERE id = ?")
                .run(projectId);
        });

        transaction();

        return projectSessionIds.length;
    }

    /**
     * createTaskStep：创建任务步骤并把任务置为运行中。
     *
     * @param input 步骤和任务字段。
     * @returns 没有返回值。
     */
    createTaskStep(input: {
        stepId: string;
        taskId: string;
        title: string;
        startedAt: string;
    }): void {
        this.database.connection()
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
                input.stepId,
                input.taskId,
                "running",
                input.title,
                input.startedAt,
            );

        this.updateTaskStatus(
            input.taskId,
            "running",
            input.startedAt,
        );
    }

    /**
     * findTaskStepWithTask：按步骤 ID 查询步骤和所属任务上下文。
     *
     * @param stepId 步骤 ID。
     * @returns 步骤记录和会话轮次信息；不存在时返回 null。
     */
    findTaskStepWithTask(stepId: string): (TaskStepRecord & {
        sessionId: string;
        turnId: string;
    }) | null {
        const row = this.database.connection()
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

        return row ?? null;
    }

    /**
     * updateTaskStep：更新任务步骤状态。
     *
     * @param input 步骤状态、结束时间和摘要。
     * @returns 没有返回值。
     */
    updateTaskStep(input: {
        stepId: string;
        status: string;
        endedAt: string | null;
        summary: string | null;
    }): void {
        this.database.connection()
            .prepare("UPDATE task_steps SET status = ?, ended_at = ?, summary = ? WHERE id = ?")
            .run(
                input.status,
                input.endedAt,
                input.summary,
                input.stepId,
            );
    }

    /**
     * updateTaskStatus：更新任务状态。
     *
     * @param taskId 任务 ID。
     * @param status 新任务状态。
     * @param updatedAt 更新时间。
     * @returns 没有返回值。
     */
    updateTaskStatus(
        taskId: string,
        status: string,
        updatedAt: string,
    ): void {
        this.database.connection()
            .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
            .run(
                status,
                updatedAt,
                taskId,
            );
    }

    /**
     * updateTaskStatusByTurn：按轮次更新任务状态。
     *
     * @param turnId 轮次 ID。
     * @param status 新任务状态。
     * @param updatedAt 更新时间。
     * @returns 没有返回值。
     */
    updateTaskStatusByTurn(
        turnId: string,
        status: string,
        updatedAt: string,
    ): void {
        this.database.connection()
            .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE turn_id = ?")
            .run(
                status,
                updatedAt,
                turnId,
            );
    }

    /**
     * findTurn：按轮次 ID 查询轮次。
     *
     * @param turnId 轮次 ID。
     * @returns 轮次记录或 null。
     */
    findTurn(turnId: string): ConversationTurn | null {
        const row = this.database.connection()
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

        return row ?? null;
    }

    /**
     * updateTurnStatus：更新轮次状态。
     *
     * @param input 轮次状态、结束时间和耗时。
     * @returns 没有返回值。
     */
    updateTurnStatus(input: {
        turnId: string;
        status: string;
        endedAt: string | null;
        durationMs: number | null;
    }): void {
        this.database.connection()
            .prepare("UPDATE conversation_turns SET status = ?, ended_at = ?, duration_ms = ? WHERE id = ?")
            .run(
                input.status,
                input.endedAt,
                input.durationMs,
                input.turnId,
            );
    }

    /**
     * createMessageTurnAndTask：事务创建用户消息、轮次和默认任务。
     *
     * @param input 消息、轮次和任务字段。
     * @returns 没有返回值。
     */
    createMessageTurnAndTask(input: {
        sessionId: string;
        messageId: string;
        turnId: string;
        taskId: string;
        turnNumber: number;
        contentMarkdown: string;
        now: string;
    }): void {
        const transaction = this.database.connection().transaction(() => {
            this.database.connection()
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
                    input.messageId,
                    input.sessionId,
                    input.turnId,
                    "user",
                    input.contentMarkdown,
                    input.now,
                );

            this.database.connection()
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
                    input.turnId,
                    input.sessionId,
                    input.turnNumber,
                    input.messageId,
                    "running",
                    input.now,
                );

            this.database.connection()
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
                    input.taskId,
                    input.turnId,
                    input.sessionId,
                    "queued",
                    "等待 Agent 执行",
                    input.now,
                    input.now,
                );

            this.touchSession(
                input.sessionId,
                input.now,
            );
        });

        transaction();
    }

    /**
     * nextTurnNumber：计算会话内下一轮次号。
     *
     * @param sessionId 会话 ID。
     * @returns 下一轮次号。
     */
    nextTurnNumber(sessionId: string): number {
        const row = this.database.connection()
            .prepare("SELECT MAX(turn_number) AS maxTurnNumber FROM conversation_turns WHERE session_id = ?")
            .get(sessionId) as {
            maxTurnNumber: number | null;
        } | undefined;

        return (row?.maxTurnNumber ?? 0) + 1;
    }

    /**
     * findSessionIdByTurn：按轮次查询会话 ID。
     *
     * @param turnId 轮次 ID。
     * @returns 会话 ID；不存在时返回 null。
     */
    findSessionIdByTurn(turnId: string): string | null {
        const row = this.database.connection()
            .prepare("SELECT session_id AS sessionId FROM conversation_turns WHERE id = ?")
            .get(turnId) as {
            sessionId: string;
        } | undefined;

        return row?.sessionId ?? null;
    }

    /**
     * insertAssistantMessageForTurn：按轮次写入助手消息。
     *
     * @param input 助手消息字段。
     * @returns 没有返回值。
     */
    insertAssistantMessageForTurn(input: {
        messageId: string;
        turnId: string;
        contentMarkdown: string;
        createdAt: string;
    }): void {
        this.database.connection()
            .prepare("INSERT INTO messages (id, session_id, turn_id, role, content_markdown, created_at) SELECT ?, session_id, id, ?, ?, ? FROM conversation_turns WHERE id = ?")
            .run(
                input.messageId,
                "assistant",
                input.contentMarkdown,
                input.createdAt,
                input.turnId,
            );
    }

    /**
     * updateSessionTitle：更新会话标题和更新时间。
     *
     * @param input 会话标题字段。
     * @returns 没有返回值。
     */
    updateSessionTitle(input: {
        sessionId: string;
        title: string;
        updatedAt: string;
    }): void {
        this.database.connection()
            .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
            .run(
                input.title,
                input.updatedAt,
                input.sessionId,
            );
    }

    /**
     * touchSession：刷新会话更新时间。
     *
     * @param sessionId 会话 ID。
     * @param updatedAt 更新时间。
     * @returns 没有返回值。
     */
    touchSession(
        sessionId: string,
        updatedAt: string,
    ): void {
        this.database.connection()
            .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
            .run(
                updatedAt,
                sessionId,
            );
    }

    /**
     * savePendingMessage：保存待引导消息。
     *
     * @param input 待处理消息字段。
     * @returns 没有返回值。
     */
    savePendingMessage(input: {
        pendingMessageId: string;
        sessionId: string;
        clientId: string | null;
        contentMarkdown: string;
        now: string;
    }): void {
        this.database.connection()
            .prepare("INSERT INTO pending_messages (id, session_id, client_id, content_markdown, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(
                input.pendingMessageId,
                input.sessionId,
                input.clientId,
                input.contentMarkdown,
                "waiting_user",
                input.now,
                input.now,
            );
    }

    /**
     * listPendingMessages：读取会话待引导消息。
     *
     * @param sessionId 会话 ID。
     * @returns 待处理消息数组。
     */
    listPendingMessages(sessionId: string): unknown[] {
        return this.database.connection()
            .prepare("SELECT id AS pendingMessageId, session_id AS sessionId, client_id AS clientId, content_markdown AS contentMarkdown, status, created_at AS createdAt, updated_at AS updatedAt FROM pending_messages WHERE session_id = ? ORDER BY created_at ASC")
            .all(sessionId);
    }

    /**
     * listEvents：按会话、轮次和序号查询事件。
     *
     * @param filter 查询条件。
     * @returns 事件列表。
     */
    listEvents(filter: {
        sessionId: string | null;
        turnId: string | null;
        afterSequence: number;
    }): EventRecord[] {
        const rows = this.database.connection()
            .prepare(`
                SELECT id           AS eventId,
                       event_type   AS eventType,
                       turn_id      AS turnId,
                       task_id      AS taskId,
                       sequence,
                       occurred_at  AS occurredAt,
                       summary,
                       payload_json AS payloadJson,
                       trace_id     AS traceId
                FROM events
                WHERE (? IS NULL OR session_id = ?)
                  AND (? IS NULL OR turn_id = ?)
                  AND sequence > ?
                ORDER BY occurred_at ASC, sequence ASC
            `)
            .all(
                filter.sessionId,
                filter.sessionId,
                filter.turnId,
                filter.turnId,
                filter.afterSequence,
            ) as Array<{
            eventId: string;
            eventType: string;
            turnId: string | null;
            taskId: string | null;
            sequence: number;
            occurredAt: string;
            summary: string;
            payloadJson: string;
            traceId: string;
        }>;

        return rows.map((row) => ({
            eventId: row.eventId,
            eventType: row.eventType,
            turnId: row.turnId,
            taskId: row.taskId,
            sequence: row.sequence,
            occurredAt: row.occurredAt,
            summary: row.summary,
            payload: JSON.parse(row.payloadJson),
            traceId: row.traceId,
        }));
    }

    /**
     * listAuditEvents：读取事件日志审计列表。
     *
     * @param eventType 事件类型；null 表示读取全部。
     * @returns 数据库事件行数组。
     */
    listAuditEvents(eventType: string | null): Array<{
        eventId: string;
        eventType: string;
        turnId: string | null;
        taskId: string | null;
        sequence: number;
        occurredAt: string;
        summary: string;
        payloadJson: string;
        traceId: string;
    }> {
        if (eventType) {
            return this.database.connection()
                .prepare("SELECT id AS eventId, event_type AS eventType, turn_id AS turnId, task_id AS taskId, sequence, occurred_at AS occurredAt, summary, payload_json AS payloadJson, trace_id AS traceId FROM events WHERE event_type = ? ORDER BY occurred_at ASC")
                .all(eventType) as Array<{
                eventId: string;
                eventType: string;
                turnId: string | null;
                taskId: string | null;
                sequence: number;
                occurredAt: string;
                summary: string;
                payloadJson: string;
                traceId: string;
            }>;
        }

        return this.database.connection()
            .prepare("SELECT id AS eventId, event_type AS eventType, turn_id AS turnId, task_id AS taskId, sequence, occurred_at AS occurredAt, summary, payload_json AS payloadJson, trace_id AS traceId FROM events ORDER BY occurred_at ASC")
            .all() as Array<{
            eventId: string;
            eventType: string;
            turnId: string | null;
            taskId: string | null;
            sequence: number;
            occurredAt: string;
            summary: string;
            payloadJson: string;
            traceId: string;
        }>;
    }

    /**
     * sessionSelectSql：生成会话列表固定查询。
     *
     * @param whereClause WHERE 子句。
     * @returns SQL 文本。
     */
    private sessionSelectSql(whereClause: string): string {
        return `
            SELECT id           AS sessionId,
                   session_type AS sessionType,
                   project_id   AS projectId,
                   title,
                   created_at   AS createdAt,
                   updated_at   AS updatedAt,
                   (
                       SELECT substr(content_markdown, 1, 120)
                       FROM messages
                       WHERE messages.session_id = sessions.id
                         AND messages.role = 'user'
                       ORDER BY messages.created_at DESC
                       LIMIT 1
                   )            AS lastUserMessagePreview
            FROM sessions
            ${whereClause}
            ORDER BY updated_at DESC
        `;
    }
}
