import {existsSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";

import Database from "better-sqlite3";

import {CORE_SQLITE_TABLES, type AppliedMigration, type CenterServiceConfig} from "./types.js";

export class CenterDatabase {
    /**
     * config: 中心服务启动配置。
     */
    private readonly config: CenterServiceConfig;

    /**
     * databasePath: SQLite 数据库绝对路径。
     */
    private readonly databasePath: string;

    /**
     * db: better-sqlite3 同步连接，只在中心服务主进程内使用。
     */
    private db: Database.Database | null = null;

    /**
     * constructor：保存配置并生成数据库路径。
     *
     * @param config 中心服务启动配置。
     */
    constructor(config: CenterServiceConfig) {
        this.config = config;
        this.databasePath = join(config.centerDirectory, "db", "zhixin.sqlite");
    }

    /**
     * initialize：打开数据库并执行迁移。
     *
     * @returns 初始化完成后没有返回值。
     */
    initialize(): void {
        // mkdirSync: SQLite 文件所在目录必须先存在。
        mkdirSync(dirname(this.databasePath), {
            recursive: true,
        });
        // db: better-sqlite3 连接只保存在当前类，避免 Worker 直接访问。
        this.db = new Database(this.databasePath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
        this.runMigrations();
    }

    /**
     * hasTable：检查指定表是否存在。
     *
     * @param tableName SQLite 表名。
     * @returns 存在时返回 true。
     */
    hasTable(tableName: string): boolean {
        const db = this.requireDatabase();
        const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
        return Boolean(row);
    }

    /**
     * listAppliedMigrations：读取已执行迁移。
     *
     * @returns 迁移记录数组。
     */
    listAppliedMigrations(): AppliedMigration[] {
        const db = this.requireDatabase();
        return db.prepare("SELECT version, applied_at AS appliedAt FROM schema_migrations ORDER BY version").all() as AppliedMigration[];
    }

    /**
     * connection：获取中心服务主进程持有的 SQLite 连接。
     *
     * @returns better-sqlite3 数据库连接。
     */
    connection(): Database.Database {
        return this.requireDatabase();
    }

    /**
     * close：关闭 SQLite 连接。
     *
     * @returns 关闭后没有返回值。
     */
    close(): void {
        if (!this.db) {
            return;
        }

        this.db.close();
        this.db = null;
    }

    /**
     * runMigrations：执行阶段 2 初始迁移。
     *
     * @returns 迁移完成后没有返回值。
     */
    private runMigrations(): void {
        const db = this.requireDatabase();
        db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations
            (
                version
                TEXT
                PRIMARY
                KEY,
                applied_at
                TEXT
                NOT
                NULL
            );
        `);

        const migrationVersion = "0001_center_bootstrap";
        const exists = db
            .prepare("SELECT version FROM schema_migrations WHERE version = ?")
            .get(migrationVersion);

        if (exists) {
            this.createCoreTables(db);
            return;
        }

        const transaction = db.transaction(() => {
            this.createCoreTables(db);
            db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
                migrationVersion,
                new Date().toISOString(),
            );
        });

        transaction();
    }

    /**
     * createCoreTables：创建阶段 2 核心状态表和事件表。
     *
     * @param db better-sqlite3 数据库连接。
     * @returns 建表完成后没有返回值。
     */
    private createCoreTables(db: Database.Database): void {
        db.exec(`
            CREATE TABLE IF NOT EXISTS projects
            (
                id
                TEXT
                PRIMARY
                KEY,
                display_name
                TEXT
                NOT
                NULL,
                alias
                TEXT,
                latest_path
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS sessions
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_type
                TEXT
                NOT
                NULL,
                project_id
                TEXT,
                title
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS messages
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_id
                TEXT
                NOT
                NULL,
                turn_id
                TEXT,
                role
                TEXT
                NOT
                NULL,
                content_markdown
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS conversation_turns
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_id
                TEXT
                NOT
                NULL,
                turn_number
                INTEGER
                NOT
                NULL,
                user_message_id
                TEXT
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                started_at
                TEXT
                NOT
                NULL,
                ended_at
                TEXT,
                duration_ms
                INTEGER
            );

            CREATE TABLE IF NOT EXISTS tasks
            (
                id
                TEXT
                PRIMARY
                KEY,
                turn_id
                TEXT
                NOT
                NULL,
                session_id
                TEXT
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                title
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS task_steps
            (
                id
                TEXT
                PRIMARY
                KEY,
                task_id
                TEXT
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                title
                TEXT
                NOT
                NULL,
                started_at
                TEXT,
                ended_at
                TEXT,
                summary
                TEXT
            );

            CREATE TABLE IF NOT EXISTS agents_index
            (
                id
                TEXT
                PRIMARY
                KEY,
                name
                TEXT
                NOT
                NULL,
                enabled
                INTEGER
                NOT
                NULL,
                role_description
                TEXT,
                capability_boundary
                TEXT,
                default_provider_id
                TEXT,
                default_model
                TEXT,
                reasoning_effort
                TEXT,
                memory_index_path
                TEXT,
                created_by
                TEXT,
                definition_path
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS memory_index
            (
                id
                TEXT
                PRIMARY
                KEY,
                agent_id
                TEXT
                NOT
                NULL,
                keywords
                TEXT
                NOT
                NULL,
                summary
                TEXT
                NOT
                NULL,
                source_session_id
                TEXT,
                source_turn_id
                TEXT,
                attachment_refs_json
                TEXT
                NOT
                NULL,
                memory_path
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS agent_runtime_states
            (
                agent_id
                TEXT
                PRIMARY
                KEY,
                status
                TEXT
                NOT
                NULL,
                current_task_id
                TEXT,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS attachments
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_id
                TEXT
                NOT
                NULL,
                message_id
                TEXT
                NOT
                NULL,
                file_name
                TEXT
                NOT
                NULL,
                mime_type
                TEXT
                NOT
                NULL,
                size_bytes
                INTEGER
                NOT
                NULL,
                relative_path
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS notifications
            (
                id
                TEXT
                PRIMARY
                KEY,
                target_client_type
                TEXT
                NOT
                NULL,
                session_id
                TEXT,
                project_id
                TEXT,
                title
                TEXT
                NOT
                NULL,
                summary
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL,
                requires_user_action
                INTEGER
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS usage_records
            (
                id
                TEXT
                PRIMARY
                KEY,
                provider_id
                TEXT
                NOT
                NULL,
                model
                TEXT
                NOT
                NULL,
                project_id
                TEXT,
                session_id
                TEXT,
                input_tokens
                INTEGER,
                output_tokens
                INTEGER,
                cache_hit_tokens
                INTEGER,
                cache_miss_tokens
                INTEGER,
                status
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS usage_daily_stats
            (
                id
                TEXT
                PRIMARY
                KEY,
                stat_date
                TEXT
                NOT
                NULL,
                provider_id
                TEXT
                NOT
                NULL,
                model
                TEXT
                NOT
                NULL,
                project_id
                TEXT,
                payload_json
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS todos
            (
                id
                TEXT
                PRIMARY
                KEY,
                title
                TEXT
                NOT
                NULL,
                completed
                INTEGER
                NOT
                NULL,
                due_at
                TEXT,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS calendar_events
            (
                id
                TEXT
                PRIMARY
                KEY,
                title
                TEXT
                NOT
                NULL,
                starts_at
                TEXT
                NOT
                NULL,
                ends_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS knowledge_items
            (
                id
                TEXT
                PRIMARY
                KEY,
                title
                TEXT
                NOT
                NULL,
                summary
                TEXT
                NOT
                NULL,
                source_ref
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS plugin_installs
            (
                id
                TEXT
                PRIMARY
                KEY,
                source
                TEXT
                NOT
                NULL,
                scope
                TEXT
                NOT
                NULL,
                enabled
                INTEGER
                NOT
                NULL,
                manifest_json
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS extension_call_records
            (
                id
                TEXT
                PRIMARY
                KEY,
                extension_id
                TEXT
                NOT
                NULL,
                session_id
                TEXT,
                task_id
                TEXT,
                status
                TEXT
                NOT
                NULL,
                input_summary
                TEXT
                NOT
                NULL,
                output_summary
                TEXT,
                created_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS sync_clients
            (
                id
                TEXT
                PRIMARY
                KEY,
                client_type
                TEXT
                NOT
                NULL,
                project_id
                TEXT,
                last_seen_at
                TEXT
                NOT
                NULL,
                last_event_sequence
                INTEGER
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS pending_messages
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_id
                TEXT
                NOT
                NULL,
                client_id
                TEXT,
                content_markdown
                TEXT
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                created_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS events
            (
                id
                TEXT
                PRIMARY
                KEY,
                event_type
                TEXT
                NOT
                NULL,
                scope_type
                TEXT
                NOT
                NULL,
                scope_id
                TEXT,
                session_id
                TEXT,
                turn_id
                TEXT,
                task_id
                TEXT,
                step_id
                TEXT,
                agent_id
                TEXT,
                project_id
                TEXT,
                client_id
                TEXT,
                sequence
                INTEGER
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                occurred_at
                TEXT
                NOT
                NULL,
                title
                TEXT
                NOT
                NULL,
                summary
                TEXT
                NOT
                NULL,
                payload_json
                TEXT
                NOT
                NULL,
                error_code
                TEXT,
                trace_id
                TEXT
                NOT
                NULL
            );

            CREATE INDEX IF NOT EXISTS idx_events_turn_sequence ON events (turn_id, sequence);
        `);

        // usage_records.session_id: 旧开发库可能已存在 0001 表结构；这里按字段探测补列，避免迁移记录已存在时遗漏会话筛选字段。
        const usageColumns = db.prepare("PRAGMA table_info(usage_records)").all() as Array<{
            name: string;
        }>;
        const hasUsageSessionId = usageColumns.some((column) => {
            return column.name === "session_id";
        });
        if (!hasUsageSessionId) {
            db.exec("ALTER TABLE usage_records ADD COLUMN session_id TEXT");
        }
    }

    /**
     * requireDatabase：获取已经初始化的数据库连接。
     *
     * @returns better-sqlite3 数据库连接。
     */
    private requireDatabase(): Database.Database {
        if (!this.db) {
            throw new Error("中心服务数据库尚未初始化");
        }

        return this.db;
    }
}
