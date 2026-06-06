import {randomUUID} from "node:crypto";

import type {EventRecord} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import {createDataAccess} from "./data-access/index.js";

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
        const occurredAt = new Date().toISOString();
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
