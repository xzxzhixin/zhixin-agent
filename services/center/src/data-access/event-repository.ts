import type {EventRecord, EventScopeType} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";

/**
 * EventInsertInput：事件日志写入参数。
 *
 * 来源：CenterEventStore 事件追加流程。
 * 含义：把领域事件转换为 SQLite events 表记录。
 * 格式：字段已按事件协议展开，payload 仍保持未知对象并在持久层序列化。
 * 默认值：可选字段写入 null。
 * 约束：事件序号由调用方先按轮次计算，repository 不再自行推断业务顺序。
 */
export interface EventInsertInput {
    /** eventId: 事件主键 UUID。 */
    eventId: string;
    /** eventType: 固定事件类型。 */
    eventType: string;
    /** scopeType: 事件作用域类型。 */
    scopeType: EventScopeType;
    /** scopeId: 事件作用域 ID；无作用域时为 null。 */
    scopeId: string | null;
    /** sessionId: 所属会话 ID；全局事件为 null。 */
    sessionId: string | null;
    /** turnId: 所属轮次 ID；无轮次事件为 null。 */
    turnId: string | null;
    /** taskId: 所属任务 ID；无任务事件为 null。 */
    taskId: string | null;
    /** stepId: 所属任务步骤 ID；无步骤事件为 null。 */
    stepId: string | null;
    /** agentId: 相关智能体 ID；无智能体事件为 null。 */
    agentId: string | null;
    /** projectId: 相关项目 ID；普通或全局事件为 null。 */
    projectId: string | null;
    /** clientId: 相关客户端 ID；非客户端事件为 null。 */
    clientId: string | null;
    /** sequence: 同一轮次内事件序号；全局事件使用 0。 */
    sequence: number;
    /** status: 事件状态。 */
    status: string;
    /** occurredAt: 事件发生时间 ISO 字符串。 */
    occurredAt: string;
    /** title: 事件展示标题。 */
    title: string;
    /** summary: 事件摘要。 */
    summary: string;
    /** payload: 事件结构化载荷。 */
    payload: unknown;
    /** errorCode: 错误码；非错误事件为 null。 */
    errorCode: string | null;
    /** traceId: 排查 ID。 */
    traceId: string;
}

/**
 * EventRepository：事件日志数据访问层。
 *
 * 用途：集中处理 events 表的序号读取和事件追加。
 * 关键逻辑：只复用 CenterDatabase 连接，不在事件存储类中直接书写 SQL。
 */
export class EventRepository {
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
     * getMaxSequenceByTurn：读取某轮次已落库最大事件序号。
     *
     * @param turnId 轮次 ID。
     * @returns 最大序号；没有事件时返回 0。
     */
    getMaxSequenceByTurn(turnId: string): number {
        const row = this.database.connection()
            .prepare("SELECT MAX(sequence) AS maxSequence FROM events WHERE turn_id = ?")
            .get(turnId) as {
            maxSequence: number | null;
        } | undefined;

        return row?.maxSequence ?? 0;
    }

    /**
     * insertEvent：追加事件日志。
     *
     * @param input 事件写入参数。
     * @returns 已写入事件的共享协议记录。
     */
    insertEvent(input: EventInsertInput): EventRecord {
        this.database.connection()
            .prepare(`
                INSERT INTO events (id,
                                    event_type,
                                    scope_type,
                                    scope_id,
                                    session_id,
                                    turn_id,
                                    task_id,
                                    step_id,
                                    agent_id,
                                    project_id,
                                    client_id,
                                    sequence,
                                    status,
                                    occurred_at,
                                    title,
                                    summary,
                                    payload_json,
                                    error_code,
                                    trace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
                input.eventId,
                input.eventType,
                input.scopeType,
                input.scopeId,
                input.sessionId,
                input.turnId,
                input.taskId,
                input.stepId,
                input.agentId,
                input.projectId,
                input.clientId,
                input.sequence,
                input.status,
                input.occurredAt,
                input.title,
                input.summary,
                JSON.stringify(input.payload),
                input.errorCode,
                input.traceId,
            );

        return {
            eventId: input.eventId,
            eventType: input.eventType,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            sessionId: input.sessionId,
            turnId: input.turnId,
            taskId: input.taskId,
            stepId: input.stepId,
            agentId: input.agentId,
            projectId: input.projectId,
            clientId: input.clientId,
            sequence: input.sequence,
            occurredAt: input.occurredAt,
            summary: input.summary,
            status: input.status,
            title: input.title,
            payload: input.payload,
            traceId: input.traceId,
            errorCode: input.errorCode,
        };
    }
}
