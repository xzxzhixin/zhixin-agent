import type {FastifyInstance} from "fastify";

import {
    type CenterEventStore,
    createBroadcastingEventStore,
} from "./events.js";
import {
    createErrorResponse,
    createSuccessResponse,
} from "./helpers.js";
import {broadcastEvents} from "./realtime.js";
import {
    completeCreatedTurn,
    createMessageTurnAndTask,
    findSession,
    listEvents,
} from "./session-domain.js";
import type {
    CenterDatabase,
} from "./database.js";
import type {
    RealtimeClientConnection,
    SendMessageResponse,
} from "./types.js";

/**
 * SessionMessageRouteContext：会话消息发送路由注册上下文。
 *
 * 来源：中心服务 API 路由模块。
 * 含义：只包含发送消息需要的数据库、事件仓储和实时连接。
 * 约束：不持有全局可变状态，避免跨路由共享隐式副作用。
 */
export interface SessionMessageRouteContext {
    /** app: Fastify 实例，用于注册发送消息路由。 */
    app: FastifyInstance;
    /** database: 中心服务 SQLite 事实源。 */
    database: CenterDatabase;
    /** events: 中心服务事件事实源。 */
    events: CenterEventStore;
    /** realtimeClients: WebSocket 在线客户端集合。 */
    realtimeClients: Map<string, RealtimeClientConnection>;
}

/**
 * registerSessionMessageRoute：注册会话消息发送接口。
 *
 * @param context 路由注册上下文。
 * @returns 没有返回值。
 */
export function registerSessionMessageRoute(context: SessionMessageRouteContext): void {
    const {
        app,
        database,
        events,
        realtimeClients,
    } = context;

    app.post("/api/session/message/send", async (request) => {
        const body = request.body as {
            sessionId?: string;
            contentMarkdown?: string;
        };
        const session = findSession(database, body.sessionId ?? "");

        if (!session) {
            return createErrorResponse(
                "SESSION_NOT_FOUND",
                "发送消息时会话不存在",
                "没有找到要发送消息的会话。",
            );
        }

        if (!body.contentMarkdown) {
            return createErrorResponse(
                "MESSAGE_CONTENT_REQUIRED",
                "发送消息缺少 contentMarkdown",
                "消息内容不能为空。",
            );
        }

        const sent = createMessageTurnAndTask(
            database,
            events,
            session,
            body.contentMarkdown,
        );
        const initialEventRows = listEvents(database, {
            sessionId: session.sessionId,
            turnId: sent.turnId,
            afterSequence: 0,
        });
        broadcastEvents(
            realtimeClients,
            session,
            initialEventRows,
        );
        let pushedSequence = initialEventRows.reduce(
            (current, event) => Math.max(
                current,
                event.sequence,
            ),
            0,
        );
        const realtimeEvents = createBroadcastingEventStore(
            events,
            (event) => {
                // event.sessionId: 只推送当前会话当前轮次事件，避免把全局审计事件发到对话过程区。
                if (event.sessionId !== session.sessionId || event.turnId !== sent.turnId) {
                    return;
                }
                pushedSequence = Math.max(
                    pushedSequence,
                    event.sequence,
                );
                broadcastEvents(
                    realtimeClients,
                    session,
                    [
                        event,
                    ],
                );
            },
        );

        // setTimeout: REST 先返回轮次身份，异步执行过程事件通过 realtimeEvents 逐条推送。
        setTimeout(() => {
            void runCreatedTurnInBackground(
                database,
                realtimeEvents,
                realtimeClients,
                session,
                sent,
                body.contentMarkdown ?? "",
                () => pushedSequence,
            );
        }, 0);

        return createSuccessResponse<SendMessageResponse>(sent);
    });
}

/**
 * runCreatedTurnInBackground：后台执行已创建轮次并补发遗漏事件。
 *
 * @param database 中心服务 SQLite 事实源。
 * @param realtimeEvents 带实时推送回调的事件仓储。
 * @param realtimeClients WebSocket 在线客户端集合。
 * @param session 当前会话记录。
 * @param sent 当前发送轮次身份。
 * @param contentMarkdown 用户消息正文。
 * @param readPushedSequence 读取已实时推送的最大序号。
 * @returns 没有返回值。
 */
async function runCreatedTurnInBackground(
    database: CenterDatabase,
    realtimeEvents: CenterEventStore,
    realtimeClients: Map<string, RealtimeClientConnection>,
    session: {
        sessionId: string;
        projectId: string | null;
    },
    sent: SendMessageResponse,
    contentMarkdown: string,
    readPushedSequence: () => number,
): Promise<void> {
    try {
        await completeCreatedTurn(
            database,
            realtimeEvents,
            sent,
            contentMarkdown,
        );
        broadcastRemainingTurnEvents(
            database,
            realtimeClients,
            session,
            sent,
            readPushedSequence(),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "MESSAGE_TURN_ASYNC_FAILED";
        try {
            realtimeEvents.append({
                eventType: "message.turn.failed",
                scopeType: "turn",
                scopeId: sent.turnId,
                sessionId: session.sessionId,
                turnId: sent.turnId,
                taskId: sent.taskId,
                projectId: session.projectId,
                status: "failed",
                title: "对话异步执行失败",
                summary: message,
                payload: {
                    errorMessage: message,
                },
            });
            broadcastRemainingTurnEvents(
                database,
                realtimeClients,
                session,
                sent,
                readPushedSequence(),
            );
        } catch {
            // catch: 服务关闭或数据库释放期间不再补记后台失败，避免关闭流程被后台任务反向打断。
        }
    }
}

/**
 * broadcastRemainingTurnEvents：补发未通过实时回调推送的同轮事件。
 *
 * @param database 中心服务 SQLite 事实源。
 * @param realtimeClients WebSocket 在线客户端集合。
 * @param session 当前会话记录。
 * @param sent 当前发送轮次身份。
 * @param pushedSequence 已实时推送的最大事件序号。
 * @returns 没有返回值。
 */
function broadcastRemainingTurnEvents(
    database: CenterDatabase,
    realtimeClients: Map<string, RealtimeClientConnection>,
    session: {
        sessionId: string;
        projectId: string | null;
    },
    sent: SendMessageResponse,
    pushedSequence: number,
): void {
    const remainingEventRows = listEvents(database, {
        sessionId: session.sessionId,
        turnId: sent.turnId,
        afterSequence: pushedSequence,
    });
    broadcastEvents(
        realtimeClients,
        session,
        remainingEventRows,
    );
}
