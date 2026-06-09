import type {CenterDatabase} from "../database.js";
import type {ConversationTokenUsageSnapshot} from "../types.js";

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
 * SaveConversationTokenUsageInput：保存当前窗口 token 快照的输入。
 *
 * 来源：`tokenizer.count` WebSocket 请求和统计结果。
 * 含义：把当前会话当前智能体最新 token 总览写入 SQLite。
 * 格式：字段名与中心服务领域对象保持一致。
 * 默认值：无。
 * 约束：按 `sessionId + agentId` 覆盖旧快照，只保存最新窗口总览。
 */
export interface SaveConversationTokenUsageInput {
    /** sessionId: 所属会话 ID。 */
    sessionId: string;
    /** turnId: 最近统计关联轮次；无轮次时为 null。 */
    turnId: string | null;
    /** agentId: 所属智能体 ID，主智能体固定为 main。 */
    agentId: string;
    /** usedTokens: 当前窗口已用 token 数。 */
    usedTokens: number;
    /** windowLimitTokens: 当前模型窗口上限 token 数。 */
    windowLimitTokens: number;
    /** usagePercent: 已用比例，允许超过 100。 */
    usagePercent: number;
    /** tokenizerName: tokenizer 展示名称。 */
    tokenizerName: string;
    /** tokenizerSource: tokenizer 来源。 */
    tokenizerSource: ConversationTokenUsageSnapshot["tokenizerSource"];
    /** modelId: 本次统计使用的模型 ID 或名称。 */
    modelId: string;
    /** updatedAt: 更新时间，ISO 8601 字符串。 */
    updatedAt: string;
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
     * listMessagesForContext：读取主会话历史消息用于上下文统计。
     *
     * @param sessionId 会话 ID。
     * @returns 历史消息数组。
     */
    listMessagesForContext(sessionId: string): TokenizerHistoryMessageRow[] {
        return this.database.connection()
            .prepare("SELECT id AS messageId, role, content_markdown AS contentMarkdown FROM messages WHERE session_id = ? ORDER BY created_at ASC")
            .all(sessionId) as TokenizerHistoryMessageRow[];
    }

    /**
     * listAgentMessagesForContext：读取智能体子对话历史消息用于上下文统计。
     *
     * @param parentSessionId 父级主会话 ID。
     * @param agentId 智能体 ID。
     * @returns 子对话历史消息数组。
     */
    listAgentMessagesForContext(
        parentSessionId: string,
        agentId: string,
    ): TokenizerHistoryMessageRow[] {
        return this.database.connection()
            .prepare("SELECT id AS messageId, role, content_markdown AS contentMarkdown FROM agent_sub_conversation_messages WHERE parent_session_id = ? AND agent_id = ? ORDER BY created_at ASC")
            .all(
                parentSessionId,
                agentId,
            ) as TokenizerHistoryMessageRow[];
    }

    /**
     * saveConversationTokenUsage：保存当前窗口 token 用量快照。
     *
     * @param input token 用量快照输入。
     * @returns 保存后的快照。
     */
    saveConversationTokenUsage(input: SaveConversationTokenUsageInput): ConversationTokenUsageSnapshot {
        this.database.connection()
            .prepare(`
                INSERT INTO conversation_token_usage (
                    session_id,
                    agent_id,
                    turn_id,
                    used_tokens,
                    window_limit_tokens,
                    usage_percent,
                    tokenizer_name,
                    tokenizer_source,
                    model_id,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, agent_id)
                DO UPDATE SET
                    turn_id = excluded.turn_id,
                    used_tokens = excluded.used_tokens,
                    window_limit_tokens = excluded.window_limit_tokens,
                    usage_percent = excluded.usage_percent,
                    tokenizer_name = excluded.tokenizer_name,
                    tokenizer_source = excluded.tokenizer_source,
                    model_id = excluded.model_id,
                    updated_at = excluded.updated_at
            `)
            .run(
                input.sessionId,
                input.agentId,
                input.turnId,
                input.usedTokens,
                input.windowLimitTokens,
                input.usagePercent,
                input.tokenizerName,
                input.tokenizerSource,
                input.modelId,
                input.updatedAt,
            );
        return this.findConversationTokenUsage(
            input.sessionId,
            input.agentId,
        ) as ConversationTokenUsageSnapshot;
    }

    /**
     * findConversationTokenUsage：读取当前会话当前智能体 token 用量快照。
     *
     * @param sessionId 会话 ID。
     * @param agentId 智能体 ID。
     * @returns 快照；不存在时返回 null。
     */
    findConversationTokenUsage(
        sessionId: string,
        agentId: string,
    ): ConversationTokenUsageSnapshot | null {
        const row = this.database.connection()
            .prepare(`
                SELECT
                    session_id AS sessionId,
                    turn_id AS turnId,
                    agent_id AS agentId,
                    used_tokens AS usedTokens,
                    window_limit_tokens AS windowLimitTokens,
                    usage_percent AS usagePercent,
                    tokenizer_name AS tokenizerName,
                    tokenizer_source AS tokenizerSource,
                    model_id AS modelId,
                    updated_at AS updatedAt
                FROM conversation_token_usage
                WHERE session_id = ?
                  AND agent_id = ?
            `)
            .get(
                sessionId,
                agentId,
            ) as ConversationTokenUsageSnapshot | undefined;
        return row ?? null;
    }
}
