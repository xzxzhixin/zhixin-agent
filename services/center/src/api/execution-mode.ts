import {
    type ClientType,
    type ExecutionMode,
} from "@zhixin/shared";
import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {saveExecutionMode} from "../domain/workflow-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerExecutionModeRoutes：注册 execution-mode 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerExecutionModeRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
    } = context;

    app.post("/api/execution-mode/set", async (request) => {
            const body = request.body as {
                clientType?: ClientType;
                executionMode?: ExecutionMode;
            };
    
            if (!body.clientType || !body.executionMode) {
                return createErrorResponse("EXECUTION_MODE_INVALID", "执行模式缺少必要字段", "执行模式信息不完整。");
            }
    
            return createSuccessResponse(saveExecutionMode(config.centerDirectory, body.clientType, body.executionMode));
        });
}
