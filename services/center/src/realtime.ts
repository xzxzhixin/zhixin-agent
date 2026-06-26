import {
    EVENT_TYPES,
    type ClientType,
    type ConversationSession,
    type EventRecord,
    type WebSocketEnvelope,
} from "@zhixin/shared";

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
    for (const client of Array.from(clients.values())) {
        if (client.clientType === "ide-plugin" && client.projectId !== session.projectId) {
            continue;
        }

        for (const event of events) {
            const sent = safeSendRealtimeEnvelope(
                clients,
                client,
                {
                    type: "event.appended",
                    payload: event,
                },
            );
            if (!sent) {
                break;
            }
            broadcastDomainEnvelopeForEvent(
                clients,
                client,
                event,
            );
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
    clients: Map<string, RealtimeClientConnection>,
    client: RealtimeClientConnection,
    event: EventRecord,
): void {
    // task.updated: 任务状态需要独立协议包，前端可以不解析通用事件就刷新任务卡片。
    if (event.eventType === EVENT_TYPES.TASK_UPDATED) {
        safeSendRealtimeEnvelope(
            clients,
            client,
            {
                type: EVENT_TYPES.TASK_UPDATED,
                payload: event.payload,
                traceId: event.traceId,
            },
        );
        return;
    }

    // agent.state.changed: 智能体状态栏使用专项协议，避免 UI 从事件类型猜测运行状态。
    if (event.eventType === EVENT_TYPES.AGENT_STATE_CHANGED) {
        safeSendRealtimeEnvelope(
            clients,
            client,
            {
                type: EVENT_TYPES.AGENT_STATE_CHANGED,
                payload: event.payload,
                traceId: event.traceId,
            },
        );
        return;
    }

    // notification.created: 通知需要直接触发浏览器或页面内提醒，不能只依赖审计事件列表。
    if (event.eventType === EVENT_TYPES.NOTIFICATION_CREATED) {
        safeSendRealtimeEnvelope(
            clients,
            client,
            {
                type: EVENT_TYPES.NOTIFICATION_CREATED,
                payload: event.payload,
                traceId: event.traceId,
            },
        );
        return;
    }

    // session.updated: 会话标题等列表字段需要专项推送，浏览器端收到后刷新列表和当前详情。
    if (event.eventType === EVENT_TYPES.SESSION_UPDATED) {
        safeSendRealtimeEnvelope(
            clients,
            client,
            {
                type: EVENT_TYPES.SESSION_UPDATED,
                payload: event.payload,
                traceId: event.traceId,
            },
        );
        return;
    }

    // session.deleted: 会话删除会影响导航和当前详情，必须用专项包让前端立即迁移到草稿或其他会话。
    if (event.eventType === EVENT_TYPES.SESSION_DELETED) {
        safeSendRealtimeEnvelope(
            clients,
            client,
            {
                type: EVENT_TYPES.SESSION_DELETED,
                payload: event.payload,
                traceId: event.traceId,
            },
        );
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
    for (const client of Array.from(clients.values())) {
        // ide-plugin: 插件端只关注当前项目会话，全局通知和全局智能体状态先不越权推送给插件。
        if (client.clientType === "ide-plugin") {
            continue;
        }

        const sent = safeSendRealtimeEnvelope(
            clients,
            client,
            {
                type: "event.appended",
                payload: event,
            },
        );
        if (!sent) {
            continue;
        }
        broadcastDomainEnvelopeForEvent(
            clients,
            client,
            event,
        );
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

/**
 * safeSendRealtimeEnvelope：向实时客户端发送协议包并隔离断连异常。
 *
 * @param clients 当前在线同步客户端表。
 * @param client 目标客户端连接。
 * @param envelope 待发送协议包。
 * @returns 发送成功返回 true；连接已不可用并清理后返回 false。
 */
function safeSendRealtimeEnvelope(
    clients: Map<string, RealtimeClientConnection>,
    client: RealtimeClientConnection,
    envelope: WebSocketEnvelope,
): boolean {
    try {
        client.send(envelope);
        return true;
    } catch {
        // catch: WebSocket 断连是客户端状态变化，不能让广播异常影响中心服务事实源写入和后台执行。
        clients.delete(client.clientId);
        return false;
    }
}
