import type {FastifyInstance} from "fastify";

import {
    type CenterEventStore,
    createBroadcastingEventStore,
} from "../events.js";
import {
    createErrorResponse,
    createSuccessResponse,
} from "../helpers.js";
import {broadcastEvents} from "../realtime.js";
import {
    appendSessionTouchedEvent,
    completeCreatedTurn,
    createMessageTurnAndTask,
    findSession,
    listEvents,
    updateTurnStatus,
} from "../domain/session-domain.js";
import type {
    CenterDatabase,
} from "../database.js";
import type {
    RealtimeClientConnection,
    MemoryQueueState,
    SendMessageResponse,
} from "../types.js";

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
    /** centerDirectory: 中心目录，用于轮次完成后追加长期记忆。 */
    centerDirectory: string;
    /** memoryQueues: 智能体记忆单写队列。 */
    memoryQueues: Map<string, MemoryQueueState>;

    /** logger: 中心服务文件日志，用于补充发送入口审计。 */
    logger: import("../logger.js").CenterLogger;
}

/**
 * SendSessionMessageInput：WebSocket 和 REST 共用的发送消息输入。
 */
export interface SendSessionMessageInput {
    /** sessionId: 目标会话 ID。 */
    sessionId?: string;
    /** contentMarkdown: 用户消息 Markdown 正文。 */
    contentMarkdown?: string;
}

/**
 * sendSessionMessageThroughCenter：创建用户消息、轮次和任务，并后台执行 Agent。
 *
 * @param context 会话消息路由上下文。
 * @param body 发送消息输入。
 * @returns 发送成功后的消息、轮次和任务身份。
 */
export function sendSessionMessageThroughCenter(
    context: SessionMessageRouteContext,
    body: SendSessionMessageInput,
): SendMessageResponse {
    const {
        database,
        events,
        realtimeClients,
        centerDirectory,
        memoryQueues,
        logger,
    } = context;
    const session = findSession(database, body.sessionId ?? "");

    if (!session) {
        throw new Error("SESSION_NOT_FOUND");
    }

    if (!body.contentMarkdown) {
        throw new Error("MESSAGE_CONTENT_REQUIRED");
    }

    const sent = createMessageTurnAndTask(
        database,
        events,
        session,
        body.contentMarkdown,
    );
    void logger.info("用户消息输入", {
        sessionId: session.sessionId,
        projectId: session.projectId,
        turnId: sent.turnId,
        taskId: sent.taskId,
        contentMarkdown: body.contentMarkdown,
        contentPreview: truncateConsoleText(body.contentMarkdown),
    });
    appendSessionTouchedEvent(
        database,
        events,
        session,
        sent.turnId,
        sent.taskId,
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

    // setTimeout: 先返回轮次身份，异步执行过程事件通过 realtimeEvents 逐条推送。
    setTimeout(() => {
        void runCreatedTurnInBackground(
            database,
            realtimeEvents,
            realtimeClients,
            session,
            sent,
            body.contentMarkdown ?? "",
            centerDirectory,
            memoryQueues,
            () => pushedSequence,
            logger,
        );
    }, 0);

    return sent;
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
    } = context;

    app.post("/api/session/message/send", async (request) => {
        const body = request.body as {
            sessionId?: string;
            contentMarkdown?: string;
        };
        try {
            return createSuccessResponse<SendMessageResponse>(sendSessionMessageThroughCenter(
                context,
                body,
            ));
        } catch (error) {
            if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
                return createErrorResponse(
                    "SESSION_NOT_FOUND",
                    "发送消息时会话不存在",
                    "没有找到要发送消息的会话。",
                );
            }
            if (error instanceof Error && error.message === "MESSAGE_CONTENT_REQUIRED") {
                return createErrorResponse(
                    "MESSAGE_CONTENT_REQUIRED",
                    "发送消息缺少 contentMarkdown",
                    "消息内容不能为空。",
                );
            }
            return createErrorResponse(
                "MESSAGE_SEND_FAILED",
                error instanceof Error ? error.message : "消息发送失败",
                "消息发送失败，请稍后重试。",
            );
        }
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
 * @param centerDirectory 中心目录绝对路径。
 * @param memoryQueues 智能体记忆单写队列。
 * @param readPushedSequence 读取已实时推送的最大序号。
 * @param logger 中心服务统一日志实例。
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
    centerDirectory: string,
    memoryQueues: Map<string, MemoryQueueState>,
    readPushedSequence: () => number,
    logger: import("../logger.js").CenterLogger,
): Promise<void> {
    try {
        await completeCreatedTurn(
            database,
            realtimeEvents,
            sent,
            contentMarkdown,
            centerDirectory,
            memoryQueues,
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
        void logger.error(
            "后台轮次执行失败",
            {
                sessionId: session.sessionId,
                turnId: sent.turnId,
                taskId: sent.taskId,
                errorMessage: truncateConsoleText(message),
            },
        );
        try {
            // updateTurnStatus: 后台执行抛错时必须同时更新 turn/task 终态，不能只留失败事件导致前端一直判定为 running。
            updateTurnStatus(
                database,
                realtimeEvents,
                sent.turnId,
                "failed",
                sent.taskId,
            );
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

/**
 * truncateConsoleText：截断开发控制台中的用户输入和错误摘要。
 *
 * @param text 原始文本。
 * @returns 控制台安全摘要。
 */
function truncateConsoleText(text: string): string {
    const normalizedText = text.replace(/\s+/gu, " ").trim();
    return normalizedText.length > 240
        ? `${normalizedText.slice(0, 240)}...`
        : normalizedText;
}
