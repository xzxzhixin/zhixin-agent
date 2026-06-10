import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {runTurnEngine} from "../domain/workflow-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerEngineRoutes：注册 engine 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerEngineRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
        database,
        events,
        memoryQueues,
    } = context;

    app.post("/api/engine/turn-runner/run", async (request) => {
            const body = request.body as {
                sessionId?: string;
                userText?: string;
            };
    
            if (!body.sessionId || !body.userText) {
                return createErrorResponse(
                    "TURN_RUNNER_INVALID",
                    "轮次执行编排缺少 sessionId 或 userText",
                    "轮次执行信息不完整。",
                );
            }
    
            return createSuccessResponse(runTurnEngine(database, events, config.centerDirectory, memoryQueues, body.sessionId, body.userText));
        });
}
