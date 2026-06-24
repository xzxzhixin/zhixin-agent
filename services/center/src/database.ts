import {mkdirSync} from "node:fs";
import {dirname, join} from "node:path";

import Database from "better-sqlite3";

import {
    createDrizzleDatabase,
    type CenterDrizzleDatabase,
} from "./data-access/database-adapter.js";
import type {AppliedMigration, CenterServiceConfig} from "./types.js";

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
     * drizzleDb: 基于同一个 better-sqlite3 连接创建的 Drizzle 适配器。
     */
    private drizzleDb: CenterDrizzleDatabase | null = null;

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
        this.drizzleDb = createDrizzleDatabase(this.db);
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
     * drizzleConnection：获取 Drizzle 数据访问适配器。
     *
     * @returns Drizzle 数据库实例。
     */
    drizzleConnection(): CenterDrizzleDatabase {
        if (!this.drizzleDb) {
            throw new Error("中心服务 Drizzle 数据库尚未初始化");
        }

        return this.drizzleDb;
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
        this.drizzleDb = null;
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

            CREATE TABLE IF NOT EXISTS meta
            (
                key
                TEXT
                PRIMARY
                KEY,
                value
                TEXT
                NOT
                NULL,
                updated_at
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
            CREATE TABLE IF NOT EXISTS meta
            (
                key
                TEXT
                PRIMARY
                KEY,
                value
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

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

            CREATE TABLE IF NOT EXISTS agent_sub_conversation_messages
            (
                id
                TEXT
                PRIMARY
                KEY,
                parent_session_id
                TEXT
                NOT
                NULL,
                agent_id
                TEXT
                NOT
                NULL,
                agent_name
                TEXT
                NOT
                NULL,
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

            CREATE TABLE IF NOT EXISTS pending_edit_records
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_id
                TEXT
                NOT
                NULL,
                agent_id
                TEXT,
                file_path
                TEXT
                NOT
                NULL,
                change_kind
                TEXT
                NOT
                NULL,
                before_content
                TEXT
                NOT
                NULL,
                after_content
                TEXT
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                added_lines
                INTEGER
                NOT
                NULL,
                removed_lines
                INTEGER
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
                agent_id
                TEXT
                NOT
                NULL
                DEFAULT
                'main',
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
                plan_version
                INTEGER
                NOT
                NULL
                DEFAULT 1,
                step_order
                INTEGER
                NOT
                NULL
                DEFAULT 1,
                source
                TEXT
                NOT
                NULL
                DEFAULT 'graph',
                status
                TEXT
                NOT
                NULL,
                title
                TEXT
                NOT
                NULL,
                depends_on
                TEXT
                NOT
                NULL
                DEFAULT '[]',
                acceptance
                TEXT,
                started_at
                TEXT,
                ended_at
                TEXT,
                summary
                TEXT,
                superseded_by
                TEXT,
                superseded_reason
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

            CREATE TABLE IF NOT EXISTS agent_teams
            (
                id
                TEXT
                PRIMARY
                KEY,
                session_id
                TEXT
                NOT
                NULL,
                name
                TEXT
                NOT
                NULL,
                description
                TEXT,
                created_by_agent_id
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

            CREATE TABLE IF NOT EXISTS agent_team_members
            (
                id
                TEXT
                PRIMARY
                KEY,
                team_id
                TEXT
                NOT
                NULL,
                agent_id
                TEXT
                NOT
                NULL,
                role
                TEXT
                NOT
                NULL,
                added_at
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

            CREATE TABLE IF NOT EXISTS conversation_token_usage
            (
                session_id
                TEXT
                NOT
                NULL,
                agent_id
                TEXT
                NOT
                NULL,
                turn_id
                TEXT,
                used_tokens
                INTEGER
                NOT
                NULL,
                window_limit_tokens
                INTEGER
                NOT
                NULL,
                usage_percent
                REAL
                NOT
                NULL,
                tokenizer_name
                TEXT
                NOT
                NULL,
                tokenizer_source
                TEXT
                NOT
                NULL,
                model_id
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL,
                PRIMARY KEY
                (
                    session_id,
                    agent_id
                )
            );

            CREATE TABLE IF NOT EXISTS model_providers
            (
                provider_id
                TEXT
                PRIMARY
                KEY,
                provider_name
                TEXT
                NOT
                NULL,
                model_protocol
                TEXT
                NOT
                NULL,
                api_base_url
                TEXT,
                api_key_secret_ref
                TEXT,
                custom_headers_json
                TEXT
                NOT
                NULL
                DEFAULT '{}',
                proxy_mode
                TEXT
                NOT
                NULL
                DEFAULT 'use-global-default',
                proxy_id
                TEXT,
                enabled
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                created_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS model_provider_models
            (
                model_id
                TEXT
                PRIMARY
                KEY,
                provider_id
                TEXT
                NOT
                NULL,
                model_name
                TEXT
                NOT
                NULL,
                display_name
                TEXT
                NOT
                NULL,
                context_window_tokens
                INTEGER,
                enabled
                INTEGER
                NOT
                NULL
                DEFAULT 1,
                sort_order
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                created_at
                TEXT
                NOT
                NULL,
                updated_at
                TEXT
                NOT
                NULL,
                UNIQUE
                (
                    provider_id,
                    model_name
                )
            );

            CREATE TABLE IF NOT EXISTS model_provider_settings
            (
                provider_id
                TEXT
                PRIMARY
                KEY,
                default_model_name
                TEXT,
                reasoning_effort
                TEXT,
                temperature
                REAL,
                max_output_tokens
                INTEGER,
                extra_json
                TEXT
                NOT
                NULL
                DEFAULT '{}',
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS model_provider_capabilities
            (
                provider_id
                TEXT
                PRIMARY
                KEY,
                supports_vision
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                supports_tool_calling
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                supports_json_output
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                supports_reasoning_effort
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                supports_model_list
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                supports_streaming
                INTEGER
                NOT
                NULL
                DEFAULT 1,
                provides_cache_usage
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                responses_supported
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                chat_completions_supported
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                responses_stream_supported
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                chat_completions_stream_supported
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                stream_tool_calls_supported
                INTEGER
                NOT
                NULL
                DEFAULT 0,
                selected_runtime_mode
                TEXT,
                last_test_status
                TEXT,
                last_test_message
                TEXT,
                last_tested_at
                TEXT,
                updated_at
                TEXT
                NOT
                NULL
            );

            CREATE TABLE IF NOT EXISTS model_provider_checks
            (
                check_id
                TEXT
                PRIMARY
                KEY,
                provider_id
                TEXT
                NOT
                NULL,
                check_type
                TEXT
                NOT
                NULL,
                status
                TEXT
                NOT
                NULL,
                error_message
                TEXT,
                checked_at
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

        // model_providers.model_protocol: 供应商重做后字段从来源改为内部模型协议；旧开发库重建表结构，避免旧 NOT NULL 列阻止新供应商保存。
        const modelProviderColumns = db.prepare("PRAGMA table_info(model_providers)").all() as Array<{
            name: string;
        }>;
        const modelProviderColumnNames = new Set(modelProviderColumns.map((column) => {
            return column.name;
        }));
        if (!modelProviderColumnNames.has("model_protocol") && modelProviderColumnNames.has("provider_source")) {
            db.exec(`
                ALTER TABLE model_providers RENAME TO model_providers_legacy_source;
                CREATE TABLE model_providers
                (
                    provider_id         TEXT PRIMARY KEY,
                    provider_name       TEXT NOT NULL,
                    model_protocol      TEXT NOT NULL,
                    api_base_url        TEXT,
                    api_key_secret_ref  TEXT,
                    custom_headers_json TEXT NOT NULL DEFAULT '{}',
                    proxy_mode          TEXT NOT NULL DEFAULT 'use-global-default',
                    proxy_id            TEXT,
                    enabled             INTEGER NOT NULL DEFAULT 0,
                    created_at          TEXT NOT NULL,
                    updated_at          TEXT NOT NULL
                );
                INSERT INTO model_providers (
                    provider_id,
                    provider_name,
                    model_protocol,
                    api_base_url,
                    api_key_secret_ref,
                    custom_headers_json,
                    proxy_mode,
                    proxy_id,
                    enabled,
                    created_at,
                    updated_at
                )
                SELECT provider_id,
                       provider_name,
                       CASE
                           WHEN provider_source = 'anthropic' THEN 'anthropic'
                           ELSE 'openai'
                       END,
                       api_base_url,
                       api_key_secret_ref,
                       custom_headers_json,
                       proxy_mode,
                       proxy_id,
                       enabled,
                       created_at,
                       updated_at
                FROM model_providers_legacy_source;
                DROP TABLE model_providers_legacy_source;
            `);
        } else if (!modelProviderColumnNames.has("model_protocol")) {
            db.exec("ALTER TABLE model_providers ADD COLUMN model_protocol TEXT NOT NULL DEFAULT 'openai'");
        }

        // model_provider_capabilities 协议探测字段：旧库只有人工能力声明；这里补齐自动探测矩阵，运行时据此选择 Responses 或 Chat Completions 转 Responses。
        const modelProviderCapabilityColumns = db.prepare("PRAGMA table_info(model_provider_capabilities)").all() as Array<{
            name: string;
        }>;
        const modelProviderCapabilityColumnNames = new Set(modelProviderCapabilityColumns.map((column) => {
            return column.name;
        }));
        const modelProviderCapabilityColumnMigrations = [
            {
                // responses_supported: 供应商是否原生支持 OpenAI Responses。
                name: "responses_supported",
                sql: "ALTER TABLE model_provider_capabilities ADD COLUMN responses_supported INTEGER NOT NULL DEFAULT 0",
            },
            {
                // chat_completions_supported: 供应商是否支持 Chat Completions 兼容接口。
                name: "chat_completions_supported",
                sql: "ALTER TABLE model_provider_capabilities ADD COLUMN chat_completions_supported INTEGER NOT NULL DEFAULT 0",
            },
            {
                // responses_stream_supported: Responses 是否支持流式事件。
                name: "responses_stream_supported",
                sql: "ALTER TABLE model_provider_capabilities ADD COLUMN responses_stream_supported INTEGER NOT NULL DEFAULT 0",
            },
            {
                // chat_completions_stream_supported: Chat Completions 是否支持流式响应。
                name: "chat_completions_stream_supported",
                sql: "ALTER TABLE model_provider_capabilities ADD COLUMN chat_completions_stream_supported INTEGER NOT NULL DEFAULT 0",
            },
            {
                // stream_tool_calls_supported: 流式工具调用是否可用且字段完整。
                name: "stream_tool_calls_supported",
                sql: "ALTER TABLE model_provider_capabilities ADD COLUMN stream_tool_calls_supported INTEGER NOT NULL DEFAULT 0",
            },
            {
                // selected_runtime_mode: 自动探测后选择的运行时模式。
                name: "selected_runtime_mode",
                sql: "ALTER TABLE model_provider_capabilities ADD COLUMN selected_runtime_mode TEXT",
            },
            {
                // last_test_status: 最近一次协议探测状态。
                name: "last_test_status",
                sql: "ALTER TABLE model_provider_capabilities ADD COLUMN last_test_status TEXT",
            },
            {
                // last_test_message: 最近一次协议探测摘要。
                name: "last_test_message",
                sql: "ALTER TABLE model_provider_capabilities ADD COLUMN last_test_message TEXT",
            },
            {
                // last_tested_at: 最近一次协议探测时间。
                name: "last_tested_at",
                sql: "ALTER TABLE model_provider_capabilities ADD COLUMN last_tested_at TEXT",
            },
        ];
        for (const migration of modelProviderCapabilityColumnMigrations) {
            if (!modelProviderCapabilityColumnNames.has(migration.name)) {
                db.exec(migration.sql);
            }
        }

        // tasks.agent_id: 智能体 todoList 需要按会话和智能体恢复；旧开发库没有该列时补为主智能体 main，避免历史主对话任务丢失。
        const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{
            name: string;
        }>;
        const hasTaskAgentId = taskColumns.some((column) => {
            return column.name === "agent_id";
        });
        if (!hasTaskAgentId) {
            db.exec("ALTER TABLE tasks ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main'");
        }

        // task_steps 长任务拆解字段：旧库可能只有图节点步骤字段；这里逐列补齐并使用业务明确默认值保持历史步骤可展示。
        const taskStepColumns = db.prepare("PRAGMA table_info(task_steps)").all() as Array<{
            name: string;
        }>;
        const taskStepColumnNames = new Set(taskStepColumns.map((column) => {
            return column.name;
        }));
        const taskStepColumnMigrations = [
            {
                // plan_version: 旧步骤属于首版计划。
                name: "plan_version",
                sql: "ALTER TABLE task_steps ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 1",
            },
            {
                // step_order: 旧步骤缺少显式顺序时先按 1 补齐，仓储查询仍按开始时间和步骤顺序稳定排序。
                name: "step_order",
                sql: "ALTER TABLE task_steps ADD COLUMN step_order INTEGER NOT NULL DEFAULT 1",
            },
            {
                // source: 历史步骤都来自 LangGraph 图节点。
                name: "source",
                sql: "ALTER TABLE task_steps ADD COLUMN source TEXT NOT NULL DEFAULT 'graph'",
            },
            {
                // depends_on: 默认空依赖列表，使用 JSON 数组字符串保存。
                name: "depends_on",
                sql: "ALTER TABLE task_steps ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]'",
            },
            {
                // acceptance: 历史步骤没有单独验收口径。
                name: "acceptance",
                sql: "ALTER TABLE task_steps ADD COLUMN acceptance TEXT",
            },
            {
                // superseded_by: 历史步骤没有替换关系。
                name: "superseded_by",
                sql: "ALTER TABLE task_steps ADD COLUMN superseded_by TEXT",
            },
            {
                // superseded_reason: 历史步骤没有替换原因。
                name: "superseded_reason",
                sql: "ALTER TABLE task_steps ADD COLUMN superseded_reason TEXT",
            },
        ];
        for (const migration of taskStepColumnMigrations) {
            if (!taskStepColumnNames.has(migration.name)) {
                db.exec(migration.sql);
            }
        }

        // meta.centerDirectory: 模型网关需要从 SQLite 侧读取中心目录以访问 providers 和 secrets；每次初始化都按启动配置刷新，支持用户切换中心目录后继续使用同一数据库文件。
        db.prepare(`
            INSERT INTO meta (key,
                              value,
                              updated_at)
            VALUES (?, ?, ?) ON CONFLICT(key) DO
            UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `)
            .run(
                "centerDirectory",
                this.config.centerDirectory,
                new Date().toISOString(),
            );
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
