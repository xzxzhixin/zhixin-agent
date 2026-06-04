import type {FastifyInstance} from "fastify";

import {createErrorResponse, createSuccessResponse} from "./helpers.js";
import type {CenterEventStore} from "./events.js";
import {runNodeVersionCommandTool} from "./tool-runtime.js";

/**
 * registerToolRoutes：注册浏览器可触发的工具过程接口。
 *
 * @param context 路由上下文。
 * @returns 没有返回值。
 */
export function registerToolRoutes(context: {
    /** app: Fastify 实例。 */
    app: FastifyInstance;
    /** events: 中心服务事件事实源。 */
    events: CenterEventStore;
}): void {
    const {
        app,
        events,
    } = context;

    app.post("/api/tool/command/node-version", async (request) => {
        const body = request.body as {
            sessionId?: string;
            taskId?: string;
            turnId?: string;
        };

        if (!body.sessionId || !body.taskId || !body.turnId) {
            return createErrorResponse(
                "COMMAND_TOOL_INVALID",
                "命令工具调用缺少 sessionId、taskId 或 turnId",
                "命令工具调用信息不完整。",
            );
        }

        return createSuccessResponse(runNodeVersionCommandTool(
            events,
            body.sessionId,
            body.taskId,
            body.turnId,
        ));
    });
}
