import type {CenterDatabase} from "../database.js";

/**
 * AttachmentMemorySource：长期记忆中可追溯的正式附件来源。
 *
 * 来源：attachments 表与 messages 表按正式用户消息关联查询。
 * 含义：描述某轮用户消息已经归档的附件事实源。
 * 格式：JSON 对象，可写入 Markdown、SQLite memory_index 和 Mem0 metadata。
 * 默认值：无；没有附件时返回空数组。
 * 约束：archivePath 直接来自 attachments.relative_path，不在业务层猜测其他路径字段。
 */
export interface AttachmentMemorySource {
    /** attachmentId: 正式附件 ID，来自 attachments.id。 */
    attachmentId: string;
    /** fileName: 用户提交并归一化后的文件名，来自 attachments.file_name。 */
    fileName: string;
    /** mimeType: 附件 MIME 类型，来自 attachments.mime_type。 */
    mimeType: string;
    /** sizeBytes: 附件字节数，来自 attachments.size_bytes。 */
    sizeBytes: number;
    /** archivePath: 归档附件相对中心目录路径，来自 attachments.relative_path。 */
    archivePath: string;
    /** sessionId: 来源会话 ID，来自 attachments.session_id。 */
    sessionId: string;
    /** turnId: 来源轮次 ID，来自 messages.turn_id。 */
    turnId: string;
    /** messageId: 来源用户消息 ID，来自 messages.id。 */
    messageId: string;
}

/**
 * AttachmentMemoryService：读取轮次用户消息的正式附件来源。
 */
export class AttachmentMemoryService {
    /** database: 中心服务主进程持有的数据库连接包装。 */
    private readonly database: CenterDatabase;

    /**
     * constructor：保存中心服务数据库。
     *
     * @param database 中心服务数据库。
     */
    constructor(database: CenterDatabase) {
        this.database = database;
    }

    /**
     * listSourcesByTurn：查询某会话某轮次用户消息关联的正式附件。
     *
     * @param input 来源会话和轮次 ID。
     * @returns 已归档正式附件来源列表。
     */
    listSourcesByTurn(input: {
        sessionId: string;
        turnId: string;
    }): AttachmentMemorySource[] {
        return this.database.connection()
            .prepare(`
                SELECT attachments.id            AS attachmentId,
                       attachments.file_name     AS fileName,
                       attachments.mime_type     AS mimeType,
                       attachments.size_bytes    AS sizeBytes,
                       attachments.relative_path AS archivePath,
                       attachments.session_id    AS sessionId,
                       messages.turn_id          AS turnId,
                       messages.id               AS messageId
                FROM attachments
                         INNER JOIN messages
                                    ON attachments.message_id = messages.id
                WHERE attachments.session_id = ?
                  AND messages.turn_id = ?
                  AND messages.role = 'user'
                ORDER BY attachments.id ASC
            `)
            .all(
                input.sessionId,
                input.turnId,
            ) as AttachmentMemorySource[];
    }
}
