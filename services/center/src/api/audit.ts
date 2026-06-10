import {createSuccessResponse} from "../helpers.js";
import {queryAuditEvents} from "../domain/workflow-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerAuditRoutes：注册 audit 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerAuditRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        database,
    } = context;

    app.post("/api/audit/events", async (request) => {
            const body = request.body as {
                eventType?: string | null;
            };
    
            return createSuccessResponse({
                events: queryAuditEvents(database, body.eventType ?? null),
            });
        });
}
