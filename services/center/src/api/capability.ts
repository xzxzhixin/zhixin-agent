import {createSuccessResponse} from "../helpers.js";
import {listUnifiedToolCapabilities} from "../StructuredTool/index.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerCapabilityRoutes：注册 capability 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerCapabilityRoutes(context: CenterApiRouteContext): void {
    const {
        app,
    } = context;

    app.post("/api/capability/resolve", async () => createSuccessResponse({
            capabilities: listUnifiedToolCapabilities(),
            priority: [
                "project-local",
                "user-installed",
                "system-builtin",
            ],
        }));

    app.post("/api/model/capability/check-image", async (request) => {
            const body = request.body as {
                supportsImage?: boolean;
            };
    
            return createSuccessResponse({
                canSendImage: Boolean(body.supportsImage),
            });
        });
}
