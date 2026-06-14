import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {SessionRepository} from "../data-access/session-repository.js";
import {cancelConversationTurnById} from "./session-cancel-domain.js";

/**
 * finalizeDanglingConversationTurns：收尾上一进程遗留的未结束轮次。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param input 补偿收尾原因和来源。
 * @returns 本次补偿收尾的轮次与步骤数量。
 */
export function finalizeDanglingConversationTurns(
    database: CenterDatabase,
    events: CenterEventStore,
    input: {
        reason: string;
        source: "shutdown_recovery" | "startup_recovery";
    },
): {
    cancelledTurnCount: number;
    cancelledStepCount: number;
} {
    const repository = new SessionRepository(database);
    const danglingTurns = repository.listSessions({}).flatMap((session) => {
        return repository.listTurns(session.sessionId).filter((turn) => {
            return turn.endedAt === null
                && (
                    turn.status === "queued"
                    || turn.status === "running"
                    || turn.status === "waiting_user"
                );
        });
    });
    let cancelledTurnCount = 0;
    let cancelledStepCount = 0;

    danglingTurns.forEach((turn) => {
        const cancelled = cancelConversationTurnById(
            database,
            events,
            {
                sessionId: turn.sessionId,
                turnId: turn.turnId,
                reason: input.reason,
                source: input.source,
            },
        );
        if (!cancelled) {
            return;
        }
        cancelledTurnCount += 1;
        cancelledStepCount += cancelled.cancelledStepCount;
    });

    return {
        cancelledTurnCount,
        cancelledStepCount,
    };
}
