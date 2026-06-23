import {
    createErrorResponse,
    createSuccessResponse,
} from "../helpers.js";
import {
    isCenterLogLevel,
    readCenterLogConfig,
    saveCenterLogConfig,
    type CenterLogLevel,
} from "../system-config.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerCenterConfigRoutes：注册中心服务自身配置接口。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerCenterConfigRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
    } = context;

    app.get("/api/center/log-config", async () => {
        return createSuccessResponse(readCenterLogConfig(config.centerDirectory));
    });

    app.post("/api/center/log-config", async (request) => {
        const body = (request.body ?? {}) as {
            /** configuredLevel: 用户显式日志等级；null 表示恢复默认。 */
            configuredLevel?: unknown;
        };

        if (body.configuredLevel !== null
            && body.configuredLevel !== undefined
            && !isCenterLogLevel(body.configuredLevel)) {
            return createErrorResponse(
                "CENTER_LOG_LEVEL_INVALID",
                "日志等级配置无效",
                "请选择有效的日志等级。",
            );
        }

        const configuredLevel = body.configuredLevel === undefined
            ? null
            : body.configuredLevel as CenterLogLevel | null;
        const savedConfig = saveCenterLogConfig(
            config.centerDirectory,
            configuredLevel,
        );
        await context.logger.info("中心服务日志配置已保存", {
            configuredLevel: savedConfig.configuredLevel,
            effectiveLevel: savedConfig.effectiveLevel,
            runtimeEnvironment: savedConfig.runtimeEnvironment,
        });
        return createSuccessResponse(savedConfig);
    });
}
