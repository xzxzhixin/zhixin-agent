import type {FastifyInstance} from "fastify";

import type {
    ClientType,
    WebSocketEnvelope,
} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import {
    isSyncClientAllowed,
    sendSocketEnvelope,
} from "./realtime.js";
import type {RealtimeClientConnection} from "./types.js";

export interface CenterSyncRouteContext {
    /** app: Fastify 实例，负责挂载 WebSocket 路由。 */
    app: FastifyInstance;
    /** database: 中心服务数据库事实源，用于校验同步客户端范围。 */
    database: CenterDatabase;
    /** realtimeClients: 当前在线同步客户端表，连接关闭时必须清理。 */
    realtimeClients: Map<string, RealtimeClientConnection>;
}

/**
 * registerCenterSyncRoute：注册中心服务实时同步 WebSocket 路由。
 *
 * @param context WebSocket 路由依赖上下文。
 * @returns 注册完成后没有返回值。
 */
export function registerCenterSyncRoute(context: CenterSyncRouteContext): void {
    const {
        app,
        database,
        realtimeClients,
    } = context;

    app.get("/api/sync", {
        websocket: true,
    }, (socket) => {
        // activeClientId: 当前 WebSocket 连接握手成功后的客户端 ID，用于关闭时清理。
        let activeClientId: string | null = null;

        socket.on("message", (rawMessage: Buffer | ArrayBuffer | Buffer[]) => {
            // envelope: WebSocket 消息必须使用共享协议包。
            const envelope = JSON.parse(rawMessage.toString()) as WebSocketEnvelope<{
                clientId?: string;
                clientType?: ClientType;
                projectId?: string | null;
            }>;

            if (envelope.type !== "client.hello") {
                sendSocketEnvelope(socket, {
                    type: "connection.state",
                    payload: {
                        status: "ignored",
                    },
                });
                return;
            }

            const clientId = envelope.payload.clientId;
            const clientType = envelope.payload.clientType;

            if (!clientId || !clientType || !isSyncClientAllowed(database, clientId, clientType, envelope.payload.projectId ?? null)) {
                sendSocketEnvelope(socket, {
                    type: "connection.state",
                    payload: {
                        status: "rejected",
                    },
                });
                socket.close();
                return;
            }

            realtimeClients.set(clientId, {
                clientId,
                clientType,
                projectId: envelope.payload.projectId ?? null,
                send: (message) => {
                    sendSocketEnvelope(socket, message);
                },
            });
            activeClientId = clientId;

            sendSocketEnvelope(socket, {
                type: "server.ready",
                payload: {
                    clientId,
                    clientType,
                },
            });
        });

        socket.on("close", () => {
            if (activeClientId) {
                realtimeClients.delete(activeClientId);
            }
        });
    });
}
