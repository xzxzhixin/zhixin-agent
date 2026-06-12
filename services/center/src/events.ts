import {randomUUID} from "node:crypto";

import type {EventRecord} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import {createDataAccess} from "./data-access/index.js";
import {centerConsoleLogger} from "./logger.js";
import {formatCenterLocalDateTime} from "./time.js";

export class CenterEventStore {
    /**
     * database: 中心服务数据库封装，用于把事件追加到 SQLite。
     */
    private readonly database: CenterDatabase;

    /**
     * sequenceByTurn: 内存中的轮次序号缓存，来源于当前进程运行期。
     */
    private readonly sequenceByTurn = new Map<string, number>();

    /**
     * onAppended: 单条事件落库后的可选回调，用于对话实时同步。
     */
    private readonly onAppended: ((event: EventRecord) => void) | null;

    /**
     * constructor：绑定中心服务数据库。
     *
     * @param database 中心服务 SQLite 封装。
     * @param onAppended 单条事件落库后的可选回调。
     */
    constructor(
        database: CenterDatabase,
        onAppended: ((event: EventRecord) => void) | null = null,
    ) {
        this.database = database;
        this.onAppended = onAppended;
    }

    /**
     * nextSequenceForTurn：获取同一轮次内下一个事件序号。
     *
     * @param turnId 轮次 ID。
     * @returns 从 1 开始递增的序号。
     */
    nextSequenceForTurn(turnId: string): number {
        // persisted: 先读取数据库最大序号，避免服务重启后从 1 重复。
        const persisted = createDataAccess(this.database).events.getMaxSequenceByTurn(turnId);
        // current: 同时考虑内存缓存和 SQLite 已落库事件。
        const current = Math.max(
            this.sequenceByTurn.get(turnId) ?? 0,
            persisted,
        );
        // next: 同一轮次内严格递增。
        const next = current + 1;
        this.sequenceByTurn.set(turnId, next);
        return next;
    }

    /**
     * append：追加中心服务事件日志。
     *
     * @param input 事件写入参数。
     * @returns 已写入的事件记录。
     */
    append(input: {
        eventType: string;
        scopeType: string;
        scopeId: string | null;
        sessionId: string | null;
        turnId: string | null;
        taskId: string | null;
        stepId?: string | null;
        agentId?: string | null;
        projectId?: string | null;
        clientId?: string | null;
        status: string;
        title: string;
        summary: string;
        payload: unknown;
        errorCode?: string | null;
        traceId?: string;
    }): EventRecord {
        // traceId: 每条事件都生成排查 ID，方便 UI 和日志关联。
        const traceId = input.traceId ?? randomUUID();
        // sequence: 无轮次事件使用 0，轮次内事件严格递增。
        const sequence = input.turnId ? this.nextSequenceForTurn(input.turnId) : 0;
        // occurredAt: 服务端事件发生时间，作为断线补齐排序依据。
        const occurredAt = formatCenterLocalDateTime();
        // eventId: 事件持久化身份。
        const eventId = randomUUID();

        const event = createDataAccess(this.database).events.insertEvent({
            eventId,
            eventType: input.eventType,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            sessionId: input.sessionId,
            turnId: input.turnId,
            taskId: input.taskId,
            stepId: input.stepId ?? null,
            agentId: input.agentId ?? null,
            projectId: input.projectId ?? null,
            clientId: input.clientId ?? null,
            sequence,
            status: input.status,
            occurredAt,
            title: input.title,
            summary: input.summary,
            payload: input.payload,
            errorCode: input.errorCode ?? null,
            traceId,
        });
        writeCenterEventToConsole(event);
        this.onAppended?.(event);
        return event;
    }

    /**
     * withAppendListener：派生带追加监听的事件仓储。
     *
     * @param onAppended 单条事件落库后的回调。
     * @returns 共享数据库的新事件仓储。
     */
    withAppendListener(
        onAppended: (event: EventRecord) => void,
    ): CenterEventStore {
        return new CenterEventStore(
            this.database,
            onAppended,
        );
    }
}

/**
 * createBroadcastingEventStore：创建对话执行期实时事件仓储。
 *
 * @param base 原始中心事件仓储。
 * @param onAppended 单条事件追加后的回调。
 * @returns 带实时回调的事件仓储。
 */
export function createBroadcastingEventStore(
    base: CenterEventStore,
    onAppended: (event: EventRecord) => void,
): CenterEventStore {
    return base.withAppendListener(onAppended);
}

/**
 * writeCenterEventToConsole：把中心服务事实事件同步输出到开发控制台。
 *
 * @param event 已落库的中心服务事件。
 * @returns 没有返回值。
 */
function writeCenterEventToConsole(event: EventRecord): void {
    if (!shouldWriteCenterEventToConsole(event)) {
        return;
    }
    // consolePayload: 控制台只保留排查关键字段和截断摘要，完整事实源仍以 SQLite events 表为准。
    const consolePayload = {
        eventType: event.eventType,
        status: event.status,
        sessionId: event.sessionId,
        turnId: event.turnId,
        taskId: event.taskId,
        stepId: event.stepId,
        sequence: event.sequence,
        traceId: event.traceId,
        summary: truncateConsoleText(event.summary),
        occurredAt: event.occurredAt,
    };
    if (event.status === "failed" || event.errorCode) {
        centerConsoleLogger.error(
            {
                payload: consolePayload,
            },
            "center.event",
        );
        return;
    }
    centerConsoleLogger.info(
        {
            payload: consolePayload,
        },
        "center.event",
    );
}

/**
 * shouldWriteCenterEventToConsole：判断事件是否需要输出到开发控制台。
 *
 * @param event 已落库中心服务事件。
 * @returns 失败、命令启动、终态和关键审计节点返回 true；运行中和输出块等中间态返回 false。
 */
function shouldWriteCenterEventToConsole(event: EventRecord): boolean {
    if (event.status === "failed" || event.errorCode) {
        return true;
    }
    if (event.eventType === "tool.command.output") {
        return false;
    }
    if (event.eventType === "tool.command.started") {
        return true;
    }
    return event.status !== "running" && !event.eventType.endsWith(".started");
}

/**
 * truncateConsoleText：截断控制台摘要，避免长命令、长文档或模型正文刷屏。
 *
 * @param text 原始摘要。
 * @returns 控制台可读的短文本。
 */
function truncateConsoleText(text: string): string {
    const normalizedText = text.replace(/\s+/gu, " ").trim();
    return normalizedText.length > 240
        ? `${normalizedText.slice(0, 240)}...`
        : normalizedText;
}
