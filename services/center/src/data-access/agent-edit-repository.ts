import type {
    AgentSubConversationMessage,
    PendingEditRecord,
} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";

/**
 * AgentEditRepository：智能体子对话和待确认编辑 SQLite 访问层。
 *
 * 用途：收敛 agent edit 相关 SQL，避免路由和领域服务直接操作 SQLite。
 * 关键逻辑：只复用中心服务主进程数据库连接。
 */
export class AgentEditRepository {
    /** database: 中心服务数据库包装。 */
    private readonly database: CenterDatabase;

    /**
     * constructor：绑定中心服务数据库。
     *
     * @param database 中心服务数据库。
     */
    constructor(database: CenterDatabase) {
        this.database = database;
    }

    /**
     * insertPendingEdit：写入待确认编辑记录。
     *
     * @param input 待确认编辑字段。
     * @returns 没有返回值。
     */
    insertPendingEdit(input: PendingEditRecord): void {
        this.database.connection().prepare(`
            INSERT INTO pending_edit_records (id,
                                              session_id,
                                              agent_id,
                                              file_path,
                                              change_kind,
                                              before_content,
                                              after_content,
                                              status,
                                              added_lines,
                                              removed_lines,
                                              created_at,
                                              updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            input.editId,
            input.sessionId,
            input.agentId,
            input.filePath,
            input.changeKind,
            input.beforeContent,
            input.afterContent,
            input.status,
            input.addedLines,
            input.removedLines,
            input.createdAt,
            input.updatedAt,
        );
    }

    /**
     * listPendingEditRecords：读取会话待确认编辑。
     *
     * @param sessionId 会话 ID。
     * @returns 编辑记录数组。
     */
    listPendingEditRecords(sessionId: string): PendingEditRecord[] {
        return this.database.connection().prepare(this.pendingEditSelectSql("WHERE session_id = ? ORDER BY created_at DESC"))
            .all(sessionId) as PendingEditRecord[];
    }

    /**
     * findPendingEditRecord：按 ID 查询编辑记录。
     *
     * @param editId 编辑记录 ID。
     * @returns 编辑记录或 null。
     */
    findPendingEditRecord(editId: string): PendingEditRecord | null {
        const row = this.database.connection().prepare(this.pendingEditSelectSql("WHERE id = ?"))
            .get(editId) as PendingEditRecord | undefined;
        return row ?? null;
    }

    /**
     * updatePendingEditStatus：更新编辑确认状态。
     *
     * @param editId 编辑记录 ID。
     * @param status 新状态。
     * @param updatedAt 更新时间。
     * @returns 没有返回值。
     */
    updatePendingEditStatus(
        editId: string,
        status: PendingEditRecord["status"],
        updatedAt: string,
    ): void {
        this.database.connection().prepare("UPDATE pending_edit_records SET status = ?, updated_at = ? WHERE id = ?")
            .run(
                status,
                updatedAt,
                editId,
            );
    }

    /**
     * listAgentSubConversationMessages：读取指定智能体子对话消息。
     *
     * @param parentSessionId 主会话 ID。
     * @param agentId 智能体 ID。
     * @returns 子对话消息数组。
     */
    listAgentSubConversationMessages(
        parentSessionId: string,
        agentId: string,
    ): AgentSubConversationMessage[] {
        return this.database.connection().prepare(`
            SELECT id                AS messageId,
                   parent_session_id AS parentSessionId,
                   agent_id          AS agentId,
                   role,
                   content_markdown  AS contentMarkdown,
                   created_at        AS createdAt
            FROM agent_sub_conversation_messages
            WHERE parent_session_id = ?
              AND agent_id = ?
            ORDER BY created_at ASC
        `).all(
            parentSessionId,
            agentId,
        ) as AgentSubConversationMessage[];
    }

    /**
     * insertAgentSubConversationMessage：写入智能体子对话消息。
     *
     * @param input 子对话消息字段。
     * @returns 没有返回值。
     */
    insertAgentSubConversationMessage(input: {
        messageId: string;
        parentSessionId: string;
        agentId: string;
        agentName: string;
        contentMarkdown: string;
        createdAt: string;
    }): void {
        this.database.connection().prepare(`
            INSERT INTO agent_sub_conversation_messages (id,
                                                         parent_session_id,
                                                         agent_id,
                                                         agent_name,
                                                         role,
                                                         content_markdown,
                                                         created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            input.messageId,
            input.parentSessionId,
            input.agentId,
            input.agentName,
            "user",
            input.contentMarkdown,
            input.createdAt,
        );
    }

    /**
     * pendingEditSelectSql：生成编辑记录查询 SQL。
     *
     * @param whereSql WHERE 与排序子句。
     * @returns SQL 文本。
     */
    private pendingEditSelectSql(whereSql: string): string {
        return `
            SELECT id             AS editId,
                   session_id     AS sessionId,
                   agent_id       AS agentId,
                   file_path      AS filePath,
                   change_kind    AS changeKind,
                   before_content AS beforeContent,
                   after_content  AS afterContent,
                   status,
                   added_lines    AS addedLines,
                   removed_lines  AS removedLines,
                   created_at     AS createdAt,
                   updated_at     AS updatedAt
            FROM pending_edit_records
            ${whereSql}
        `;
    }
}
