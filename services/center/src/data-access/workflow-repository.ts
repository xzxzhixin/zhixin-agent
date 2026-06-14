import type {AgentRuntimeStatus} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";

/**
 * WorkflowRepository：执行链路和个人事务数据访问层。
 *
 * 用途：收敛 Worker 编排、个人事务、通知、智能体运行状态和上下文构造的 SQLite 访问。
 * 关键逻辑：业务层生成 ID、状态和时间，repository 只负责明确字段的持久化。
 */
export class WorkflowRepository {
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
     * createTodo：写入待办事项。
     *
     * @param input 待办字段。
     * @returns 没有返回值。
     */
    createTodo(input: {
        todoId: string;
        title: string;
        dueAt: string | null;
        updatedAt: string;
    }): void {
        this.database.connection()
            .prepare("INSERT INTO todos (id, title, completed, due_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .run(
                input.todoId,
                input.title,
                0,
                input.dueAt,
                input.updatedAt,
            );
    }

    /**
     * createCalendarEvent：写入日程。
     *
     * @param input 日程字段。
     * @returns 没有返回值。
     */
    createCalendarEvent(input: {
        eventId: string;
        title: string;
        startsAt: string;
        endsAt: string;
        updatedAt: string;
    }): void {
        this.database.connection()
            .prepare("INSERT INTO calendar_events (id, title, starts_at, ends_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .run(
                input.eventId,
                input.title,
                input.startsAt,
                input.endsAt,
                input.updatedAt,
            );
    }

    /**
     * createKnowledgeItem：写入知识库条目索引。
     *
     * @param input 知识条目字段。
     * @returns 没有返回值。
     */
    createKnowledgeItem(input: {
        itemId: string;
        title: string;
        summary: string;
        sourceRef: string;
        updatedAt: string;
    }): void {
        this.database.connection()
            .prepare("INSERT INTO knowledge_items (id, title, summary, source_ref, updated_at) VALUES (?, ?, ?, ?, ?)")
            .run(
                input.itemId,
                input.title,
                input.summary,
                input.sourceRef,
                input.updatedAt,
            );
    }

    /**
     * upsertAgentRuntimeState：写入智能体运行状态。
     *
     * @param input 智能体状态字段。
     * @returns 没有返回值。
     */
    upsertAgentRuntimeState(input: {
        agentId: string;
        status: AgentRuntimeStatus;
        currentTaskId: string | null;
        updatedAt: string;
    }): void {
        this.database.connection()
            .prepare(`
                INSERT INTO agent_runtime_states (agent_id,
                                                  status,
                                                  current_task_id,
                                                  updated_at)
                VALUES (?, ?, ?, ?) ON CONFLICT(agent_id) DO
                UPDATE SET
                    status = excluded.status,
                    current_task_id = excluded.current_task_id,
                    updated_at = excluded.updated_at
            `)
            .run(
                input.agentId,
                input.status,
                input.currentTaskId,
                input.updatedAt,
            );
    }

    /**
     * findTaskContext：读取 Worker 上下文所需任务行。
     *
     * @param taskId 任务 ID。
     * @returns 任务上下文或 null。
     */
    findTaskContext(taskId: string): {
        taskId: string;
        sessionId: string;
        status: string;
        title: string;
    } | null {
        const row = this.database.connection()
            .prepare("SELECT id AS taskId, session_id AS sessionId, status, title FROM tasks WHERE id = ?")
            .get(taskId) as {
            taskId: string;
            sessionId: string;
            status: string;
            title: string;
        } | undefined;

        return row ?? null;
    }

    /**
     * listMemoryIndex：读取记忆索引。
     *
     * @returns 记忆索引数组。
     */
    listMemoryIndex(): unknown[] {
        return this.database.connection()
            .prepare("SELECT agent_id AS agentId, keywords, summary, memory_path AS memoryPath FROM memory_index ORDER BY created_at DESC")
            .all();
    }

    /**
     * listRecentAgentMemorySummaries：读取指定智能体最近长期记忆摘要。
     *
     * @param agentId 智能体 ID。
     * @param limit 最大返回数量。
     * @returns 最近记忆摘要数组。
     */
    listRecentAgentMemorySummaries(agentId: string, limit: number): Array<{
        agentId: string;
        keywords: string;
        summary: string;
        sourceSessionId: string | null;
        sourceTurnId: string | null;
        memoryPath: string;
        createdAt: string;
    }> {
        return this.database.connection()
            .prepare(`
                SELECT agent_id AS agentId,
                       keywords,
                       summary,
                       source_session_id AS sourceSessionId,
                       source_turn_id AS sourceTurnId,
                       memory_path AS memoryPath,
                       created_at AS createdAt
                FROM memory_index
                WHERE agent_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            `)
            .all(
                agentId,
                limit,
            ) as Array<{
            agentId: string;
            keywords: string;
            summary: string;
            sourceSessionId: string | null;
            sourceTurnId: string | null;
            memoryPath: string;
            createdAt: string;
        }>;
    }

    /**
     * searchAgentMemorySummaries：按关键词和摘要模糊检索指定智能体长期记忆。
     *
     * @param agentId 智能体 ID。
     * @param searchText 当前问题或检索文本。
     * @param limit 最大返回数量。
     * @returns 命中的长期记忆摘要数组。
     */
    searchAgentMemorySummaries(agentId: string, searchText: string, limit: number): Array<{
        agentId: string;
        keywords: string;
        summary: string;
        sourceSessionId: string | null;
        sourceTurnId: string | null;
        memoryPath: string;
        createdAt: string;
    }> {
        const normalizedSearchText = searchText.trim();
        if (normalizedSearchText.length === 0) {
            return [];
        }
        const likePattern = `%${normalizedSearchText}%`;
        return this.database.connection()
            .prepare(`
                SELECT agent_id AS agentId,
                       keywords,
                       summary,
                       source_session_id AS sourceSessionId,
                       source_turn_id AS sourceTurnId,
                       memory_path AS memoryPath,
                       created_at AS createdAt
                FROM memory_index
                WHERE agent_id = ?
                  AND (
                    keywords LIKE ?
                    OR summary LIKE ?
                  )
                ORDER BY created_at DESC
                LIMIT ?
            `)
            .all(
                agentId,
                likePattern,
                likePattern,
                limit,
            ) as Array<{
            agentId: string;
            keywords: string;
            summary: string;
            sourceSessionId: string | null;
            sourceTurnId: string | null;
            memoryPath: string;
            createdAt: string;
        }>;
    }
}
