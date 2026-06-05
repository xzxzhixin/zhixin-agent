import {randomUUID} from "node:crypto";
import {appendFileSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";

import type {ClientType} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import {createDataAccess} from "./data-access/index.js";
import {writeJsonFile} from "./helpers.js";

export interface UsageQueryFilters {
    /**
     * providerId: 供应商 ID。
     */
    providerId: string | null;

    /**
     * providerName: 供应商名称，来源于中心目录供应商配置 providerName。
     */
    providerName: string | null;

    /**
     * model: 模型名称。
     */
    model: string | null;

    /**
     * modelName: 模型名称筛选展示字段，和 model 使用同一 usage_records.model 来源。
     */
    modelName: string | null;

    /**
     * projectId: 项目 ID；null 表示不限制项目。
     */
    projectId: string | null;

    /**
     * projectName: 项目文件夹主名称，来源于 projects.display_name。
     */
    projectName: string | null;

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
    return createDataAccess(database).usage.queryUsageRecords(filters);
}

/**
 * aggregateUsageRecords：按筛选条件聚合 token 和调用次数。
 *
 * @param database 中心服务数据库。
 * @param filters 用量筛选条件。
 * @returns 聚合统计数组。
 */
export function aggregateUsageRecords(database: CenterDatabase, filters: UsageQueryFilters): unknown[] {
    return createDataAccess(database).usage.aggregateUsageRecords(filters);
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
    if (filters.modelName !== null) {
        whereParts.push("model = ?");
        params.push(filters.modelName);
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

/**
 * refreshUsageDailyStats：刷新日聚合并按当前查询条件返回可见日统计。
 *
 * @param database 中心服务数据库。
 * @param filters 用量筛选条件；为空时返回全部刷新结果。
 * @returns 刷新后的日统计行。
 */
export function refreshUsageDailyStats(
    database: CenterDatabase,
    filters?: UsageQueryFilters,
): unknown[] {
    return createDataAccess(database).usage.refreshUsageDailyStats(
        new Date().toISOString(),
        filters,
    );
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
    createDataAccess(database).usage.insertAttachment({
        attachmentId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        relativePath,
    });
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
