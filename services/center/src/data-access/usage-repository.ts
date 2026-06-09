import type {CenterDatabase} from "../database.js";
import type {UsageQueryFilters} from "../domain/usage-domain.js";

/**
 * UsageRecordInput：模型用量原始记录写入参数。
 *
 * 来源：模型网关真实返回或执行引擎内部用量采集。
 * 含义：写入 usage_records 追加表。
 * 格式：token 字段允许 null，表示供应商未提供该统计项。
 * 默认值：无；调用方按业务规则传入。
 * 约束：用量记录只追加，不回改历史调用。
 */
export interface UsageRecordInput {
    /** usageId: 用量记录主键。 */
    usageId: string;
    /** providerId: 供应商 ID。 */
    providerId?: string;
    /** model: 模型名称。 */
    model?: string;
    /** projectId: 项目 ID；普通会话为 null。 */
    projectId?: string | null;
    /** sessionId: 会话 ID；非会话调用为 null。 */
    sessionId?: string | null;
    /** inputTokens: 输入 token 数；供应商未提供时为 null。 */
    inputTokens?: number | null;
    /** outputTokens: 输出 token 数；供应商未提供时为 null。 */
    outputTokens?: number | null;
    /** cacheHitTokens: 缓存命中 token 数；供应商未提供时为 null。 */
    cacheHitTokens?: number | null;
    /** cacheMissTokens: 缓存未命中 token 数；供应商未提供时为 null。 */
    cacheMissTokens?: number | null;
    /** status: 调用状态。 */
    status?: string;
    /** createdAt: 创建时间 ISO 字符串。 */
    createdAt: string;
}

/**
 * UsageRepository：用量、附件和审计查询数据访问层。
 *
 * 用途：收敛 usage_records、usage_daily_stats、attachments 和 task_steps 查询。
 * 关键逻辑：筛选字段由调用方明确传入，不通过候选字段猜测统计口径。
 */
export class UsageRepository {
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
     * queryUsageRecords：按明确筛选条件查询用量原始记录。
     *
     * @param filters 用量筛选条件。
     * @returns 用量原始记录数组。
     */
    queryUsageRecords(filters: UsageQueryFilters): unknown[] {
        const {
            whereSql,
            params,
        } = this.buildUsageWhereClause(filters);
        return this.database.connection()
            .prepare(`SELECT *
                      FROM usage_records${whereSql}
                      ORDER BY created_at ASC`)
            .all(...params);
    }

    /**
     * aggregateUsageRecords：按筛选条件聚合 token 和调用次数。
     *
     * @param filters 用量筛选条件。
     * @returns 聚合统计数组。
     */
    aggregateUsageRecords(filters: UsageQueryFilters): unknown[] {
        const {
            whereSql,
            params,
        } = this.buildUsageWhereClause(filters);
        const detailedStats = this.database.connection()
            .prepare(`
                SELECT 'model-project-detail'                                      AS summaryType,
                       provider_id                                                 AS providerId,
                       model,
                       project_id                                                  AS projectId,
                       SUM(COALESCE(input_tokens, 0))                              AS inputTokens,
                       SUM(COALESCE(output_tokens, 0))                             AS outputTokens,
                       SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS totalTokens,
                       SUM(COALESCE(cache_hit_tokens, 0))                          AS cacheHitTokens,
                       SUM(COALESCE(cache_miss_tokens, 0))                         AS cacheMissTokens,
                       COUNT(*)                                                    AS callCount,
                       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)       AS successCount,
                       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)          AS failureCount,
                       MIN(created_at)                                             AS startedAt,
                       MAX(created_at)                                             AS endedAt
                FROM usage_records${whereSql}
                GROUP BY provider_id, model, project_id
                ORDER BY provider_id ASC, model ASC
            `)
            .all(...params);
        const totalStats = this.database.connection()
            .prepare(`
                SELECT 'total-summary'                                             AS summaryType,
                       NULL                                                        AS providerId,
                       NULL                                                        AS model,
                       NULL                                                        AS projectId,
                       SUM(COALESCE(input_tokens, 0))                              AS inputTokens,
                       SUM(COALESCE(output_tokens, 0))                             AS outputTokens,
                       SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS totalTokens,
                       SUM(COALESCE(cache_hit_tokens, 0))                          AS cacheHitTokens,
                       SUM(COALESCE(cache_miss_tokens, 0))                         AS cacheMissTokens,
                       COUNT(*)                                                    AS callCount,
                       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)       AS successCount,
                       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)          AS failureCount,
                       MIN(created_at)                                             AS startedAt,
                       MAX(created_at)                                             AS endedAt
                FROM usage_records${whereSql}
            `)
            .all(...params);
        const providerStats = this.database.connection()
            .prepare(`
                SELECT 'provider-summary'                                          AS summaryType,
                       provider_id                                                 AS providerId,
                       NULL                                                        AS model,
                       NULL                                                        AS projectId,
                       SUM(COALESCE(input_tokens, 0))                              AS inputTokens,
                       SUM(COALESCE(output_tokens, 0))                             AS outputTokens,
                       SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS totalTokens,
                       SUM(COALESCE(cache_hit_tokens, 0))                          AS cacheHitTokens,
                       SUM(COALESCE(cache_miss_tokens, 0))                         AS cacheMissTokens,
                       COUNT(*)                                                    AS callCount,
                       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)       AS successCount,
                       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)          AS failureCount,
                       MIN(created_at)                                             AS startedAt,
                       MAX(created_at)                                             AS endedAt
                FROM usage_records${whereSql}
                GROUP BY provider_id
                ORDER BY provider_id ASC
            `)
            .all(...params);
        const projectStats = this.database.connection()
            .prepare(`
                SELECT 'project-summary'                                           AS summaryType,
                       NULL                                                        AS providerId,
                       NULL                                                        AS model,
                       project_id                                                  AS projectId,
                       SUM(COALESCE(input_tokens, 0))                              AS inputTokens,
                       SUM(COALESCE(output_tokens, 0))                             AS outputTokens,
                       SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS totalTokens,
                       SUM(COALESCE(cache_hit_tokens, 0))                          AS cacheHitTokens,
                       SUM(COALESCE(cache_miss_tokens, 0))                         AS cacheMissTokens,
                       COUNT(*)                                                    AS callCount,
                       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)       AS successCount,
                       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)          AS failureCount,
                       MIN(created_at)                                             AS startedAt,
                       MAX(created_at)                                             AS endedAt
                FROM usage_records${whereSql}
                GROUP BY project_id
                ORDER BY project_id ASC
            `)
            .all(...params);

        return [
            ...totalStats,
            ...providerStats,
            ...projectStats,
            ...detailedStats,
        ];
    }

    /**
     * refreshUsageDailyStats：刷新日聚合统计。
     *
     * @param updatedAt 更新时间 ISO 字符串。
     * @param filters 当前查询筛选条件；为空时返回全部刷新行。
     * @returns 刷新的日统计源行。
     */
    refreshUsageDailyStats(
        updatedAt: string,
        filters?: UsageQueryFilters,
    ): unknown[] {
        const rows = this.database.connection()
            .prepare(`
                SELECT provider_id                     AS providerId,
                       model,
                       project_id                      AS projectId,
                       substr(created_at, 1, 10)       AS statDate,
                       SUM(COALESCE(input_tokens, 0))  AS inputTokens,
                       SUM(COALESCE(output_tokens, 0)) AS outputTokens,
                       COUNT(*)                        AS callCount
                FROM usage_records
                GROUP BY provider_id, model, project_id, substr(created_at, 1, 10)
            `)
            .all() as Array<{
            providerId: string;
            model: string;
            projectId: string | null;
            statDate: string;
            inputTokens: number;
            outputTokens: number;
            callCount: number;
        }>;

        for (const row of rows) {
            const id = `${row.statDate}:${row.providerId}:${row.model}:${row.projectId ?? "global"}`;
            this.database.connection()
                .prepare("INSERT OR REPLACE INTO usage_daily_stats (id, stat_date, provider_id, model, project_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
                .run(
                    id,
                    row.statDate,
                    row.providerId,
                    row.model,
                    row.projectId,
                    JSON.stringify(row),
                    updatedAt,
                );
        }

        if (!filters) {
            return rows;
        }

        const projectNamesById = filters.projectName === null
            ? new Map<string, string>()
            : new Map(
                this.database.connection()
                    .prepare("SELECT id, display_name AS displayName FROM projects")
                    .all()
                    .map((project) => {
                        const row = project as {
                            id: string;
                            displayName: string;
                        };
                        return [
                            row.id,
                            row.displayName,
                        ] as const;
                    }),
            );
        // refreshedDailyStats: 返回值也按本次查询条件过滤，避免筛选接口在副产物字段里暴露全量统计。
        return rows.filter((row) => {
            if (filters.providerId !== null && row.providerId !== filters.providerId) {
                return false;
            }
            if (filters.model !== null && row.model !== filters.model) {
                return false;
            }
            if (filters.modelName !== null && row.model !== filters.modelName) {
                return false;
            }
            if (filters.projectId !== null && row.projectId !== filters.projectId) {
                return false;
            }
            if (filters.projectName !== null && (row.projectId === null || projectNamesById.get(row.projectId) !== filters.projectName)) {
                return false;
            }
            if (filters.startedAt !== null && row.statDate < filters.startedAt.slice(0, 10)) {
                return false;
            }
            if (filters.endedAt !== null && row.statDate > filters.endedAt.slice(0, 10)) {
                return false;
            }
            return true;
        });
    }

    /**
     * insertUsageRecord：追加模型用量原始记录。
     *
     * @param input 用量记录字段。
     * @returns 没有返回值。
     */
    insertUsageRecord(input: UsageRecordInput): void {
        this.database.connection()
            .prepare("INSERT INTO usage_records (id, provider_id, model, project_id, session_id, input_tokens, output_tokens, cache_hit_tokens, cache_miss_tokens, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(
                input.usageId,
                input.providerId,
                input.model,
                input.projectId ?? null,
                input.sessionId ?? null,
                input.inputTokens ?? null,
                input.outputTokens ?? null,
                input.cacheHitTokens ?? null,
                input.cacheMissTokens ?? null,
                input.status,
                input.createdAt,
            );
    }

    /**
     * insertAttachment：写入正式附件索引。
     *
     * @param input 附件字段。
     * @returns 没有返回值。
     */
    insertAttachment(input: {
        attachmentId: string;
        sessionId?: string;
        messageId?: string;
        fileName?: string;
        mimeType?: string;
        sizeBytes?: number;
        relativePath: string;
    }): void {
        this.database.connection()
            .prepare("INSERT INTO attachments (id, session_id, message_id, file_name, mime_type, size_bytes, relative_path) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(
                input.attachmentId,
                input.sessionId,
                input.messageId,
                input.fileName,
                input.mimeType,
                input.sizeBytes,
                input.relativePath,
            );
    }

    /**
     * listTaskStepsForAudit：读取任务步骤审计列表。
     *
     * @returns 任务步骤原始行数组。
     */
    listTaskStepsForAudit(): unknown[] {
        return this.database.connection()
            .prepare("SELECT * FROM task_steps ORDER BY started_at ASC")
            .all();
    }

    /**
     * buildUsageWhereClause：根据筛选条件构造查询条件。
     *
     * @param filters 用量筛选条件。
     * @returns SQL WHERE 子句和参数。
     */
    private buildUsageWhereClause(filters: UsageQueryFilters): {
        whereSql: string;
        params: string[];
    } {
        const whereParts: string[] = [];
        const params: string[] = [];
        if (filters.providerId !== null) {
            whereParts.push("provider_id = ?");
            params.push(filters.providerId);
        }
        if (filters.model !== null) {
            whereParts.push("model = ?");
            params.push(filters.model);
        }
        if (filters.modelName !== null) {
            whereParts.push("model = ?");
            params.push(filters.modelName);
        }
        if (filters.projectId !== null) {
            whereParts.push("project_id = ?");
            params.push(filters.projectId);
        }
        if (filters.projectName !== null) {
            whereParts.push("EXISTS (SELECT 1 FROM projects WHERE projects.id = usage_records.project_id AND projects.display_name = ?)");
            params.push(filters.projectName);
        }
        if (filters.sessionId !== null) {
            whereParts.push("session_id = ?");
            params.push(filters.sessionId);
        }
        if (filters.startedAt !== null) {
            whereParts.push("created_at >= ?");
            params.push(filters.startedAt);
        }
        if (filters.endedAt !== null) {
            whereParts.push("created_at <= ?");
            params.push(filters.endedAt);
        }

        return {
            whereSql: whereParts.length > 0
                ? ` WHERE ${whereParts.join(" AND ")}`
                : "",
            params,
        };
    }
}
