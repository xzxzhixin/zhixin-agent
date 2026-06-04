import type {ClientType, ConversationSession, EventRecord, WebSocketEnvelope} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import {createDataAccess} from "./data-access/index.js";
import type {RealtimeClientConnection} from "./types.js";

export function isSyncClientAllowed(
    database: CenterDatabase,
    clientId: string,
    clientType: ClientType,
    projectId: string | null,
): boolean {
    // sync_clients 是授权后的客户端事实来源，订阅校验统一交给会话数据访问层。
    return createDataAccess(database).sessions.isSyncClientAllowed({
        clientId,
        clientType,
        projectId,
    });
}

/**
 * broadcastEvents：按客户端订阅范围推送事件。
 *
 * @param clients WebSocket 客户端集合。
 * @param session 事件所属会话。
 * @param events 待推送事件。
 * @returns 没有返回值。
 */
export function broadcastEvents(
    clients: Map<string, RealtimeClientConnection>,
    session: ConversationSession,
    events: EventRecord[],
): void {
    for (const client of clients.values()) {
        if (client.clientType === "ide-plugin" && client.projectId !== session.projectId) {
            continue;
        }

        for (const event of events) {
            client.send({
                type: "event.appended",
                payload: event,
            });
            broadcastDomainEnvelopeForEvent(client, event);
        }
    }
}

/**
 * broadcastDomainEnvelopeForEvent：把通用事件同步转换为领域专项 WebSocket 包。
 *
 * @param client 已通过握手的实时客户端。
 * @param event 中心服务已经落库的事件记录。
 * @returns 没有返回值。
 */
export function broadcastDomainEnvelopeForEvent(
    client: RealtimeClientConnection,
    event: EventRecord,
): void {
    // task.updated: 任务状态需要独立协议包，前端可以不解析通用事件就刷新任务卡片。
    if (event.eventType === "task.updated") {
        client.send({
            type: "task.updated",
            payload: event.payload,
            traceId: event.traceId,
        });
        return;
    }

    // agent.state.changed: 智能体状态栏使用专项协议，避免 UI 从事件类型猜测运行状态。
    if (event.eventType === "agent.state.changed") {
        client.send({
            type: "agent.state.changed",
            payload: event.payload,
            traceId: event.traceId,
        });
        return;
    }

    // notification.created: 通知需要直接触发浏览器或页面内提醒，不能只依赖审计事件列表。
    if (event.eventType === "notification.created") {
        client.send({
            type: "notification.created",
            payload: event.payload,
            traceId: event.traceId,
        });
        return;
    }

    // session.updated: 会话标题等列表字段需要专项推送，浏览器端收到后刷新列表和当前详情。
    if (event.eventType === "session.updated") {
        client.send({
            type: "session.updated",
            payload: event.payload,
            traceId: event.traceId,
        });
    }
}

/**
 * broadcastGlobalEvent：推送不绑定具体会话的全局事件。
 *
 * @param clients WebSocket 客户端集合。
 * @param event 已写入 SQLite 的全局事件。
 * @returns 没有返回值。
 */
export function broadcastGlobalEvent(
    clients: Map<string, RealtimeClientConnection>,
    event: EventRecord,
): void {
    for (const client of clients.values()) {
        // ide-plugin: 插件端只关注当前项目会话，全局通知和全局智能体状态先不越权推送给插件。
        if (client.clientType === "ide-plugin") {
            continue;
        }

        client.send({
            type: "event.appended",
            payload: event,
        });
        broadcastDomainEnvelopeForEvent(client, event);
    }
}

/**
 * sendSocketEnvelope：发送 WebSocket 协议包。
 *
 * @param socket Fastify WebSocket 连接。
 * @param envelope 协议包。
 * @returns 没有返回值。
 */
export function sendSocketEnvelope(
    socket: {
        send: (data: string) => void;
    },
    envelope: WebSocketEnvelope,
): void {
    socket.send(JSON.stringify(envelope));
}
