import {
    APP_NAME,
} from "@zhixin/shared";

import {
    createErrorResponse,
    createSuccessResponse,
    isRequestFromLocalHost,
} from "../helpers.js";
import {registerDesktopManagedLifecycleManager} from "../manager-lifecycle-watch.js";
import {
    CORE_SQLITE_TABLES,
    type BootstrapStateResponse,
    type HealthResponse,
} from "../types.js";
import {formatCenterLocalDateTime} from "../time.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerCoreRoutes：注册中心服务核心状态路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerCoreRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
        database,
        getProcessStartedAt,
        isInitialized,
    } = context;

    app.get("/api/health", async () => createSuccessResponse<HealthResponse>({
        appName: APP_NAME,
        version: "0.1.0",
        port: config.port,
        centerDirectory: config.centerDirectory,
        processStartedAt: getProcessStartedAt(),
        now: formatCenterLocalDateTime(),
    }));

    app.get("/api/bootstrap/state", async () => createSuccessResponse<BootstrapStateResponse>({
        ready: isInitialized(),
        centerDirectory: config.centerDirectory,
        coreTables: [...CORE_SQLITE_TABLES],
        appliedMigrations: database.listAppliedMigrations(),
    }));

    app.post("/api/center/lifecycle/desktop-manager", async (request) => {
        if (!isRequestFromLocalHost(request.ip)) {
            return createErrorResponse(
                "CENTER_LIFECYCLE_LOCAL_ONLY",
                "桌面端生命周期登记只允许本机请求",
                "中心服务生命周期只能由本机桌面端管理。",
            );
        }

        const body = (request.body ?? {}) as {
            /** lifecycleMode: 桌面壳声明的生命周期模式。 */
            lifecycleMode?: string;
            /** managerPid: 桌面壳主进程 PID。 */
            managerPid?: number;
            /** checkIntervalMs: 可选管理者判活检查间隔，单位毫秒。 */
            checkIntervalMs?: number;
        };
        const registered = registerDesktopManagedLifecycleManager({
            lifecycleMode: body.lifecycleMode ?? "",
            managerPid: body.managerPid ?? 0,
            checkIntervalMs: body.checkIntervalMs,
        });
        if (!registered) {
            return createErrorResponse(
                "CENTER_LIFECYCLE_MANAGER_INVALID",
                "桌面端生命周期登记参数无效",
                "桌面端生命周期登记参数无效。",
            );
        }

        await context.logger.info("桌面端管理者进程已登记", {
            managerPid: body.managerPid,
            checkIntervalMs: body.checkIntervalMs ?? null,
        });
        return createSuccessResponse({
            registered: true,
        });
    });
}
