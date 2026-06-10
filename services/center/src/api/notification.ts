import {type ClientType} from "@zhixin/shared";
import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {createNotification} from "../domain/workflow-domain.js";
import {saveNotificationConfig} from "../domain/usage-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerNotificationRoutes：注册 notification 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerNotificationRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
        database,
        events,
        realtimeClients,
    } = context;

    app.post("/api/notification/create", async (request) => {
            const body = request.body as {
                targetClientType?: ClientType;
                title?: string;
                summary?: string;
                requiresUserAction?: boolean;
            };
    
            if (!body.targetClientType || !body.title || !body.summary) {
                return createErrorResponse("NOTIFICATION_CREATE_INVALID", "通知缺少必要字段", "通知信息不完整。");
            }
    
            return createSuccessResponse(createNotification(database, events, realtimeClients, body.targetClientType, body.title, body.summary, Boolean(body.requiresUserAction)));
        });

    app.post("/api/notification/config/set", async (request) => {
            const body = request.body as {
                clientType?: ClientType;
                enabled?: boolean;
                notifyOnFailure?: boolean;
                notifyOnWaitingUser?: boolean;
                systemPermission?: string;
            };
    
            if (!body.clientType) {
                return createErrorResponse("NOTIFICATION_CONFIG_INVALID", "通知配置缺少 clientType", "通知配置不完整。");
            }
    
            return createSuccessResponse(saveNotificationConfig(config.centerDirectory, body));
        });

    app.post("/api/notification/should-send", async (request) => {
            const body = request.body as {
                enabled?: boolean;
                status?: string;
            };
            return createSuccessResponse({
                shouldSend: Boolean(body.enabled) && (body.status === "completed" || body.status === "failed" || body.status === "waiting_user"),
            });
        });
}
