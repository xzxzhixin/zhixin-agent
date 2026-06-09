import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {SessionRepository} from "../data-access/session-repository.js";
import {
    isFinalTaskStatus,
    updateTurnStatus,
} from "./session-domain.js";

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
    const runningTurn = turns.slice().reverse().find((turn) => {
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
    const now = new Date().toISOString();
    const cancelledStepCount = repository.updateRunningTaskStepsByTurn({
        turnId: runningTurn.turnId,
        endedAt: now,
        summary: input.reason,
    });

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
            endedAt: updatedTurn?.endedAt ?? now,
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
        },
    });

    return {
        sessionId: input.sessionId,
        turnId: runningTurn.turnId,
        taskId: task?.taskId ?? null,
        status: "cancelled",
        cancelledStepCount,
    };
}
