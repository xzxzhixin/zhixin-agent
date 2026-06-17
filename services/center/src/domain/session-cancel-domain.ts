import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {SessionRepository} from "../data-access/session-repository.js";
import {
    isFinalTaskStatus,
    updateTurnStatus,
} from "./session-domain.js";
import {formatCenterLocalDateTime} from "../time.js";

type RecoverableTurnRecord = {
    /** turnId：轮次 ID。 */
    turnId: string;
    /** sessionId：所属会话 ID。 */
    sessionId: string;
    /** endedAt：结束时间；null 表示仍未结束。 */
    endedAt: string | null;
    /** status：轮次状态。 */
    status: string;
};

/**
 * cancelConversationTurnById：按固定轮次 ID 收尾当前运行轮次。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param input 当前会话、轮次和取消原因。
 * @returns 取消后的轮次、任务和步骤收尾摘要；轮次不存在时返回 null。
 */
export function cancelConversationTurnById(
    database: CenterDatabase,
    events: CenterEventStore,
    input: {
        sessionId: string;
        turnId: string;
        reason: string;
        source: "user_cancel" | "shutdown_recovery" | "startup_recovery";
    },
): {
    sessionId: string;
    turnId: string;
    taskId: string | null;
    status: "cancelled";
    cancelledStepCount: number;
} | null {
    const repository = new SessionRepository(database);
    const runningTurn = repository.findTurn(input.turnId);
    if (!runningTurn || runningTurn.sessionId !== input.sessionId) {
        return null;
    }

    // task: 当前轮次可能存在多个任务，优先把最后更新的非终态任务作为响应主任务。
    const task = repository.listTasks(input.sessionId).slice().reverse().find((candidate) => {
        return candidate.turnId === runningTurn.turnId
            && !isFinalTaskStatus(candidate.status);
    }) ?? null;
    const updatedTurn = updateTurnStatus(
        database,
        events,
        runningTurn.turnId,
        "cancelled",
    );
    const now = updatedTurn?.endedAt ?? formatCenterLocalDateTime();
    // cancelledStepCount: 先用 0 固化取消主事件，步骤收尾随后执行，避免步骤更新异常留下半截取消事实源。
    let cancelledStepCount = 0;

    events.append({
        eventType: "turn.cancelled",
        scopeType: "turn",
        scopeId: runningTurn.turnId,
        sessionId: input.sessionId,
        turnId: runningTurn.turnId,
        taskId: task?.taskId ?? null,
        status: "cancelled",
        title: "轮次已取消",
        summary: input.reason,
        payload: {
            sessionId: input.sessionId,
            turnId: runningTurn.turnId,
            taskId: task?.taskId ?? null,
            cancelledStepCount,
            endedAt: now,
            source: input.source,
        },
    });
    events.append({
        eventType: "agent.state.changed",
        scopeType: "agent",
        scopeId: "main",
        sessionId: input.sessionId,
        turnId: runningTurn.turnId,
        taskId: task?.taskId ?? null,
        agentId: "main",
        status: "idle",
        title: "智能体状态变更",
        summary: "当前会话轮次已取消，主智能体回到空闲状态。",
        payload: {
            agentId: "main",
            status: "idle",
            currentTaskId: null,
            sessionId: input.sessionId,
            turnId: runningTurn.turnId,
            source: input.source,
        },
    });
    cancelledStepCount = repository.updateRunningTaskStepsByTurn({
        turnId: runningTurn.turnId,
        endedAt: now,
        summary: input.reason,
    });

    return {
        sessionId: input.sessionId,
        turnId: runningTurn.turnId,
        taskId: task?.taskId ?? null,
        status: "cancelled",
        cancelledStepCount,
    };
}

/**
 * cancelActiveConversationTurn：取消当前会话当前运行轮次。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param input 当前会话 ID 和取消原因。
 * @returns 取消后的轮次、任务和步骤收尾摘要；没有运行轮次时返回 null。
 */
export function cancelActiveConversationTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    input: {
        sessionId: string;
        reason: string;
    },
): {
    sessionId: string;
    turnId: string;
    taskId: string | null;
    status: "cancelled";
    cancelledStepCount: number;
} | null {
    const repository = new SessionRepository(database);
    const turns = repository.listTurns(input.sessionId);
    // runningTurn: 停止只作用于当前会话最后一个未结束运行轮次，不能影响本地排队消息或其他会话。
    const runningTurn = turns.slice().reverse().find((turn: RecoverableTurnRecord) => {
        return turn.endedAt === null
            && (
                turn.status === "running"
                || turn.status === "queued"
                || turn.status === "waiting_user"
            );
    });

    if (!runningTurn) {
        return null;
    }

    return cancelConversationTurnById(
        database,
        events,
        {
            sessionId: input.sessionId,
            turnId: runningTurn.turnId,
            reason: input.reason,
            source: "user_cancel",
        },
    );
}
