import {type ClientType} from "@zhixin/shared";
import {createErrorResponse, createSuccessResponse} from "../helpers.js";
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
    } = context;

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
}
