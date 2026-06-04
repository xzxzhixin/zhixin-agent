import type {CenterDatabase} from "../database.js";

/**
 * SystemRepository：中心服务系统级 SQLite 访问层。
 *
 * 用途：集中读取 meta 等系统表，避免模型网关或启动模块直接书写 SQL。
 * 关键逻辑：只暴露明确键值读取，不提供任意 SQL 执行入口。
 */
export class SystemRepository {
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
     * readMetaValue：读取 meta 表值。
     *
     * @param key meta 键。
     * @returns 对应值；不存在时返回 null。
     */
    readMetaValue(key: string): string | null {
        const row = this.database.connection()
            .prepare("SELECT value FROM meta WHERE key = ?")
            .get(key) as {
            value?: string;
        } | undefined;

        return row?.value ?? null;
    }
}
