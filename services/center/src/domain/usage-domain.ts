import {randomUUID} from "node:crypto";
import {appendFileSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";

import type {ClientType} from "@zhixin/shared";
import {
    EVENT_SCOPE_TYPES,
    EVENT_TYPES,
    TASK_STATUSES,
} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {createDataAccess} from "../data-access/index.js";
import {writeJsonFile} from "../helpers.js";
import {AttachmentArchiveService} from "./AttachmentArchiveService.js";

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
 * createTemporaryAttachment：创建临时附件事实占位文件。
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
    relativePath: string;
} {
    const temporaryAttachmentId = randomUUID();
    const placeholderFileName = "attachment-placeholder.json";
    const relativePath = `temp/${temporaryAttachmentId}/${placeholderFileName}`;
    const filePath = join(centerDirectory, relativePath);
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    // 当前还没有浏览器二进制上传通道，这里只保存临时附件事实占位，
    // 用于草稿附件转正链路测试；不得把它解释为已经保存了用户原始二进制内容。
    appendFileSync(filePath, JSON.stringify({
        temporaryAttachmentId,
        fileName,
        mimeType,
        sizeBytes,
        contentKind: "temporary-attachment-fact-placeholder",
    }), "utf-8");
    return {
        temporaryAttachmentId,
        relativePath,
    };
}

/**
 * commitAttachment：把临时附件移动为正式归档附件并写入会话引用记录。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param input 正式附件参数。
 * @returns 正式附件 ID 和归档路径。
 */
export function commitAttachment(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    input: {
        sessionId?: string;
        messageId?: string;
        temporaryAttachmentId?: string;
        temporaryRelativePath?: string;
        fileName?: string;
        mimeType?: string;
        sizeBytes?: number;
    },
): {
    attachmentId: string;
    relativePath: string;
    archivePath: string;
} {
    const attachmentId = randomUUID();
    const archiveService = new AttachmentArchiveService(centerDirectory);
    const temporaryAttachmentId = requireTemporaryAttachmentId(input.temporaryAttachmentId);
    const temporaryRelativePath = requireTemporaryRelativePath(input.temporaryRelativePath);
    const fileName = requireAttachmentFileName(input.fileName);
    const archived = archiveService.moveTemporaryToArchive(
        temporaryAttachmentId,
        temporaryRelativePath,
        attachmentId,
        fileName,
    );
    createDataAccess(database).usage.insertAttachment({
        attachmentId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        relativePath: archived.archivePath,
    });
    events.append({
        eventType: EVENT_TYPES.ATTACHMENT_COMMITTED,
        scopeType: EVENT_SCOPE_TYPES.ATTACHMENT,
        scopeId: attachmentId,
        sessionId: input.sessionId ?? null,
        turnId: null,
        taskId: null,
        status: TASK_STATUSES.COMPLETED,
        title: "附件转正",
        summary: fileName,
        payload: {
            attachmentId,
            temporaryAttachmentId,
            archivePath: archived.archivePath,
        },
    });

    return {
        attachmentId,
        relativePath: archived.archivePath,
        archivePath: archived.archivePath,
    };
}

/**
 * requireTemporaryAttachmentId：校验临时附件 ID 必须由调用方明确提交。
 *
 * @param temporaryAttachmentId 临时附件 ID。
 * @returns 已校验的临时附件 ID。
 */
function requireTemporaryAttachmentId(temporaryAttachmentId: string | undefined): string {
    if (!temporaryAttachmentId || temporaryAttachmentId.trim().length === 0) {
        throw new Error("TEMP_ATTACHMENT_ID_REQUIRED");
    }
    return temporaryAttachmentId;
}

/**
 * requireTemporaryRelativePath：校验提交协议必须提供单一临时相对路径字段。
 *
 * @param temporaryRelativePath 临时附件相对中心目录路径。
 * @returns 已校验的临时附件相对路径。
 */
function requireTemporaryRelativePath(temporaryRelativePath: string | undefined): string {
    if (!temporaryRelativePath || temporaryRelativePath.trim().length === 0) {
        throw new Error("TEMP_ATTACHMENT_PATH_REQUIRED");
    }
    return temporaryRelativePath;
}

/**
 * requireAttachmentFileName：校验正式附件必须保留原始文件名。
 *
 * @param fileName 客户端提交的原始文件名。
 * @returns 已校验的原始文件名。
 */
function requireAttachmentFileName(fileName: string | undefined): string {
    if (!fileName || fileName.trim().length === 0) {
        throw new Error("ATTACHMENT_FILE_NAME_REQUIRED");
    }
    return fileName;
}
