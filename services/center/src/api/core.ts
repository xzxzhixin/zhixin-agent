import {
    APP_NAME,
} from "@zhixin/shared";

import {
    createSuccessResponse,
} from "../helpers.js";
import {
    CORE_SQLITE_TABLES,
    type BootstrapStateResponse,
    type HealthResponse,
} from "../types.js";
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
        isInitialized,
    } = context;

    app.get("/api/health", async () => createSuccessResponse<HealthResponse>({
        appName: APP_NAME,
        version: "0.1.0",
        port: config.port,
        centerDirectory: config.centerDirectory,
        now: new Date().toISOString(),
    }));

    app.get("/api/bootstrap/state", async () => createSuccessResponse<BootstrapStateResponse>({
        ready: isInitialized(),
        centerDirectory: config.centerDirectory,
        coreTables: [...CORE_SQLITE_TABLES],
        appliedMigrations: database.listAppliedMigrations(),
    }));
}
