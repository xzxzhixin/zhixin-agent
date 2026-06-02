import {randomUUID} from "node:crypto";
import {appendFileSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";

import type {ClientType} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import {writeJsonFile} from "./helpers.js";

export interface UsageQueryFilters {
    /**
     * providerId: 供应商 ID。
     */
    providerId: string | null;

    /**
     * model: 模型名称。
     */
    model: string | null;

    /**
     * projectId: 项目 ID；null 表示不限制项目。
     */
    projectId: string | null;

    /**
     * sessionId: 会话 ID；对应 SQLite usage_records.session_id。
     */
    sessionId: string | null;

    /**
     * startedAt: 开始时间 ISO 字符串。
     */
    startedAt: string | null;

    /**
     * endedAt: 结束时间 ISO 字符串。
     */
    endedAt: string | null;
}

/**
 * queryUsageRecords：按明确筛选条件查询用量原始记录。
 *
 * @param database 中心服务数据库。
 * @param filters 用量筛选条件。
 * @returns 用量原始记录数组。
 */
export function queryUsageRecords(database: CenterDatabase, filters: UsageQueryFilters): unknown[] {
    const whereParts: string[] = [];
    const params: Array<string> = [];
    appendUsageWhereClause(whereParts, params, filters);
    const whereSql = whereParts.length > 0
        ? ` WHERE ${whereParts.join(" AND ")}`
        : "";
    return database.connection()
        .prepare(`SELECT *
                  FROM usage_records${whereSql}
                  ORDER BY created_at ASC`)
        .all(...params);
}

/**
 * aggregateUsageRecords：按筛选条件聚合 token 和调用次数。
 *
 * @param database 中心服务数据库。
 * @param filters 用量筛选条件。
 * @returns 聚合统计数组。
 */
export function aggregateUsageRecords(database: CenterDatabase, filters: UsageQueryFilters): unknown[] {
    const whereParts: string[] = [];
    const params: Array<string> = [];
    appendUsageWhereClause(whereParts, params, filters);
    const whereSql = whereParts.length > 0
        ? ` WHERE ${whereParts.join(" AND ")}`
        : "";
    const detailedStats = database.connection()
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
    const totalStats = database.connection()
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
    const providerStats = database.connection()
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
    const projectStats = database.connection()
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
 * appendUsageWhereClause：根据筛选条件追加 SQL 条件。
 *
 * @param whereParts SQL WHERE 片段数组。
 * @param params SQL 参数数组。
 * @param filters 用量筛选条件。
 * @returns 没有返回值。
 */
export function appendUsageWhereClause(
    whereParts: string[],
    params: Array<string>,
    filters: UsageQueryFilters,
): void {
    if (filters.providerId !== null) {
        whereParts.push("provider_id = ?");
        params.push(filters.providerId);
    }
    if (filters.model !== null) {
        whereParts.push("model = ?");
        params.push(filters.model);
    }
    if (filters.projectId !== null) {
        whereParts.push("project_id = ?");
        params.push(filters.projectId);
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
}

export function refreshUsageDailyStats(database: CenterDatabase): unknown[] {
    const rows = database.connection()
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
        database.connection()
            .prepare("INSERT OR REPLACE INTO usage_daily_stats (id, stat_date, provider_id, model, project_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(
                id,
                row.statDate,
                row.providerId,
                row.model,
                row.projectId,
                JSON.stringify(row),
                new Date().toISOString(),
            );
    }

    return rows;
}

export function saveNotificationConfig(
    centerDirectory: string,
    input: {
        clientType?: ClientType;
        enabled?: boolean;
        notifyOnFailure?: boolean;
        notifyOnWaitingUser?: boolean;
        systemPermission?: string;
    },
): {
    clientType: ClientType | undefined;
    enabled: boolean;
} {
    writeJsonFile(join(centerDirectory, "config", `notification-${input.clientType}.json`), {
        clientType: input.clientType,
        enabled: input.enabled ?? true,
        notifyOnFailure: input.notifyOnFailure ?? true,
        notifyOnWaitingUser: input.notifyOnWaitingUser ?? true,
        systemPermission: input.systemPermission ?? "unknown",
        updatedAt: new Date().toISOString(),
    });
    return {
        clientType: input.clientType,
        enabled: input.enabled ?? true,
    };
}

/**
 * createTemporaryAttachment：创建临时附件占位文件。
 *
 * @param centerDirectory 中心目录。
 * @param fileName 原始文件名。
 * @param mimeType MIME 类型。
 * @param sizeBytes 文件大小。
 * @returns 临时附件元数据。
 */
export function createTemporaryAttachment(
    centerDirectory: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
): {
    temporaryAttachmentId: string;
    storageFileName: string;
    relativePath: string;
} {
    const temporaryAttachmentId = randomUUID();
    const storageFileName = `${temporaryAttachmentId}.tmp`;
    const relativePath = `temp/${storageFileName}`;
    const filePath = join(centerDirectory, relativePath);
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    appendFileSync(filePath, JSON.stringify({
        fileName,
        mimeType,
        sizeBytes,
    }), "utf-8");
    return {
        temporaryAttachmentId,
        storageFileName,
        relativePath,
    };
}

/**
 * commitAttachment：把临时附件转为正式会话附件记录。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param input 正式附件参数。
 * @returns 正式附件 ID。
 */
export function commitAttachment(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    input: {
        sessionId?: string;
        messageId?: string;
        temporaryAttachmentId?: string;
        fileName?: string;
        mimeType?: string;
        sizeBytes?: number;
    },
): {
    attachmentId: string;
    relativePath: string;
} {
    const attachmentId = randomUUID();
    const storageFileName = `${attachmentId}.attachment`;
    const relativePath = `sessions/attachments/${storageFileName}`;
    const filePath = join(centerDirectory, relativePath);
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    appendFileSync(filePath, JSON.stringify({
        temporaryAttachmentId: input.temporaryAttachmentId,
        fileName: input.fileName,
    }), "utf-8");
    database.connection()
        .prepare("INSERT INTO attachments (id, session_id, message_id, file_name, mime_type, size_bytes, relative_path) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
            attachmentId,
            input.sessionId,
            input.messageId,
            input.fileName,
            input.mimeType,
            input.sizeBytes,
            relativePath,
        );
    events.append({
        eventType: "attachment.committed",
        scopeType: "attachment",
        scopeId: attachmentId,
        sessionId: input.sessionId ?? null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "附件转正",
        summary: input.fileName ?? attachmentId,
        payload: {
            attachmentId,
            temporaryAttachmentId: input.temporaryAttachmentId,
        },
    });

    return {
        attachmentId,
        relativePath,
    };
}
