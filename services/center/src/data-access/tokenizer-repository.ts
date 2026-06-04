import type {CenterDatabase} from "../database.js";

/**
 * TokenizerHistoryMessageRow：tokenizer 统计所需历史消息行。
 *
 * 来源：messages 表。
 * 含义：用于构造实际送入模型的上下文 token 统计片段。
 * 格式：数据库字段已映射为驼峰属性。
 * 默认值：无。
 * 约束：只读取当前会话的历史消息，排序由 created_at 决定。
 */
export interface TokenizerHistoryMessageRow {
    /** messageId: 消息 ID。 */
    messageId: string;
    /** role: 消息角色。 */
    role: string;
    /** contentMarkdown: 消息 Markdown 内容。 */
    contentMarkdown: string;
}

/**
 * TokenizerRepository：tokenizer 统计数据访问层。
 *
 * 用途：收敛 messages 历史消息查询。
 * 关键逻辑：只提供统计所需最小字段，不把消息完整持久化能力暴露给 tokenizer 领域。
 */
export class TokenizerRepository {
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
     * listMessagesForContext：读取会话历史消息用于上下文统计。
     *
     * @param sessionId 会话 ID。
     * @returns 历史消息数组。
     */
    listMessagesForContext(sessionId: string): TokenizerHistoryMessageRow[] {
        return this.database.connection()
            .prepare("SELECT id AS messageId, role, content_markdown AS contentMarkdown FROM messages WHERE session_id = ? ORDER BY created_at ASC")
            .all(sessionId) as TokenizerHistoryMessageRow[];
    }
}
