import type {
    ConversationMessage,
    ConversationSession,
    ConversationTurn,
    EventRecord,
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
