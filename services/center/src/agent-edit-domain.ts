import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";

import type {
    PendingEditRecord,
} from "@zhixin/shared";
import {
    EVENT_SCOPE_TYPES,
    EVENT_TYPES,
    TASK_STATUSES,
} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import {AgentEditRepository} from "./data-access/agent-edit-repository.js";

/**
 * PendingFileEditInput：真实文件编辑后的待确认记录输入。
 *
 * 来源：Agent 文件写入工具或中心服务受控文件编辑流程。
 * 含义：描述某次已经写入磁盘的文件变更，以及保存/撤回需要用到的前后内容。
 * 约束：`afterContent` 必须等于当前写入结果；撤回时会以它做冲突检测。
 */
export interface PendingFileEditInput {
    /** sessionId: 发生编辑的会话 ID，来源于当前对话事实源。 */
    sessionId: string;
    /** agentId: 发起编辑的智能体 ID；没有明确智能体时为 null。 */
    agentId: string | null;
    /** filePath: 被真实写入的绝对文件路径。 */
    filePath: string;
    /** changeKind: 编辑类型，取值由文件是否存在和工具操作决定。 */
    changeKind: string;
    /** beforeContent: 编辑前 UTF-8 文本内容；新建文件使用空字符串。 */
    beforeContent: string;
    /** afterContent: 编辑后 UTF-8 文本内容，也就是当前磁盘期望内容。 */
    afterContent: string;
}

/**
 * WritePendingFileEditInput：执行真实写入并记录待确认编辑的输入。
 *
 * 来源：后续文件写入工具的中心服务入口。
 * 含义：让中心服务先读取编辑前内容，再写入新内容并登记待保存/撤回记录。
 * 约束：只处理 UTF-8 文本文件，二进制文件工具需要另行定义协议。
 */
export interface WritePendingFileEditInput {
    /** sessionId: 当前对话会话 ID。 */
    sessionId: string;
    /** agentId: 发起编辑的智能体 ID；没有明确智能体时为 null。 */
    agentId: string | null;
    /** filePath: 要写入的绝对文件路径。 */
    filePath: string;
    /** afterContent: 要写入磁盘的 UTF-8 文本内容。 */
    afterContent: string;
}

/**
 * recordPendingFileEdit：把已经真实写入的文件编辑登记为待确认记录。
 *
 * @param database 中心服务 SQLite 数据库。
 * @param events 中心服务事件日志；允许传 null 用于纯数据迁移或测试。
 * @param input 文件编辑前后内容。
 * @returns 已创建的待确认编辑记录。
 */
export function recordPendingFileEdit(
    database: CenterDatabase,
    events: CenterEventStore | null,
    input: PendingFileEditInput,
): PendingEditRecord {
    const editId = randomUUID();
    const now = new Date().toISOString();
    const lineStats = countChangedLines(
        input.beforeContent,
        input.afterContent,
    );

    const record: PendingEditRecord = {
        editId,
        sessionId: input.sessionId,
        agentId: input.agentId,
        filePath: input.filePath,
        changeKind: input.changeKind,
        beforeContent: input.beforeContent,
        afterContent: input.afterContent,
        status: "pending",
        addedLines: lineStats.addedLines,
        removedLines: lineStats.removedLines,
        createdAt: now,
        updatedAt: now,
    };
    new AgentEditRepository(database).insertPendingEdit(record);

    if (events) {
        events.append({
            eventType: EVENT_TYPES.EDIT_PENDING_CREATED,
            scopeType: EVENT_SCOPE_TYPES.FILE,
            scopeId: record.filePath,
            sessionId: record.sessionId,
            turnId: null,
            taskId: null,
            agentId: record.agentId,
            projectId: null,
            status: TASK_STATUSES.COMPLETED,
            title: "待确认编辑已创建",
            summary: record.filePath,
            payload: {
                editId: record.editId,
                filePath: record.filePath,
                changeKind: record.changeKind,
                addedLines: record.addedLines,
                removedLines: record.removedLines,
            },
        });
    }

    return record;
}

/**
 * writeFileAndRecordPendingEdit：执行真实文件写入并登记保存/撤回所需记录。
 *
 * @param database 中心服务 SQLite 数据库。
 * @param events 中心服务事件日志。
 * @param input 写入输入。
 * @returns 已创建的待确认编辑记录。
 */
export function writeFileAndRecordPendingEdit(
    database: CenterDatabase,
    events: CenterEventStore,
    input: WritePendingFileEditInput,
): PendingEditRecord {
    const existedBefore = existsSync(input.filePath);
    const beforeContent = existedBefore
        ? readFileSync(
            input.filePath,
            "utf8",
        )
        : "";
    writeFileSync(
        input.filePath,
        input.afterContent,
        "utf8",
    );
    return recordPendingFileEdit(
        database,
        events,
        {
            sessionId: input.sessionId,
            agentId: input.agentId,
            filePath: input.filePath,
            changeKind: existedBefore
                ? "modify"
                : "create",
            beforeContent,
            afterContent: input.afterContent,
        },
    );
}

/**
 * countChangedLines：计算轻量增删行统计。
 *
 * @param beforeContent 编辑前文本。
 * @param afterContent 编辑后文本。
 * @returns 增加和删除行数。
 */
function countChangedLines(
    beforeContent: string,
    afterContent: string,
): {
    addedLines: number;
    removedLines: number;
} {
    const beforeLines = splitComparableLines(beforeContent);
    const afterLines = splitComparableLines(afterContent);
    const sharedPrefix = countSharedPrefix(
        beforeLines,
        afterLines,
    );
    const sharedSuffix = countSharedSuffix(
        beforeLines,
        afterLines,
        sharedPrefix,
    );
    return {
        addedLines: Math.max(
            afterLines.length - sharedPrefix - sharedSuffix,
            0,
        ),
        removedLines: Math.max(
            beforeLines.length - sharedPrefix - sharedSuffix,
            0,
        ),
    };
}

/**
 * splitComparableLines：拆分用于 diff 统计的文本行。
 *
 * @param content UTF-8 文本内容。
 * @returns 文本行数组。
 */
function splitComparableLines(content: string): string[] {
    if (content.length === 0) {
        return [];
    }
    return content.split(/\r?\n/u);
}

/**
 * countSharedPrefix：计算编辑前后相同前缀行数。
 *
 * @param beforeLines 编辑前行。
 * @param afterLines 编辑后行。
 * @returns 相同前缀行数。
 */
function countSharedPrefix(
    beforeLines: string[],
    afterLines: string[],
): number {
    let index = 0;
    while (
        index < beforeLines.length
        && index < afterLines.length
        && beforeLines[index] === afterLines[index]
    ) {
        index += 1;
    }
    return index;
}

/**
 * countSharedSuffix：计算编辑前后相同后缀行数。
 *
 * @param beforeLines 编辑前行。
 * @param afterLines 编辑后行。
 * @param sharedPrefix 已确认相同的前缀行数，避免前后缀重叠。
 * @returns 相同后缀行数。
 */
function countSharedSuffix(
    beforeLines: string[],
    afterLines: string[],
    sharedPrefix: number,
): number {
    let count = 0;
    while (
        count + sharedPrefix < beforeLines.length
        && count + sharedPrefix < afterLines.length
        && beforeLines[beforeLines.length - 1 - count] === afterLines[afterLines.length - 1 - count]
    ) {
        count += 1;
    }
    return count;
}
