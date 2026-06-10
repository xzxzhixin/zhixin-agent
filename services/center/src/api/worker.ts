import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {
    buildWorkerContext,
    cancelWorkerTask,
    handleWorkerMessage,
    markWorkerTaskFailed,
    startWorkerTask,
} from "../domain/workflow-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerWorkerRoutes：注册 worker 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerWorkerRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        database,
        events,
    } = context;

    app.post("/api/worker/task-failed", async (request) => {
            const body = request.body as {
                taskId?: string;
                reason?: string;
            };
    
            return createSuccessResponse(markWorkerTaskFailed(database, events, body.taskId ?? "", body.reason ?? "Worker 任务失败"));
        });

    app.post("/api/worker/handle", async (request) => {
            const body = request.body as {
                type?: string;
                taskId?: string;
                payload?: unknown;
            };
    
            if (!body.type) {
                return createErrorResponse("WORKER_MESSAGE_INVALID", "Worker 消息缺少 type", "Worker 消息不完整。");
            }
    
            return createSuccessResponse(handleWorkerMessage(database, events, body.type, body.taskId ?? null, body.payload ?? null));
        });

    app.post("/api/worker/start", async (request) => {
            const body = request.body as {
                taskId?: string;
            };
    
            if (!body.taskId) {
                return createErrorResponse("WORKER_TASK_ID_REQUIRED", "启动 Worker 缺少 taskId", "任务 ID 不能为空。");
            }
    
            return createSuccessResponse(startWorkerTask(database, events, body.taskId));
        });

    app.post("/api/worker/cancel", async (request) => {
            const body = request.body as {
                taskId?: string;
                reason?: string;
            };
    
            if (!body.taskId) {
                return createErrorResponse("WORKER_TASK_ID_REQUIRED", "取消 Worker 缺少 taskId", "任务 ID 不能为空。");
            }
    
            return createSuccessResponse(cancelWorkerTask(database, events, body.taskId, body.reason ?? "用户取消 Worker 任务"));
        });

    app.post("/api/worker/context-request", async (request) => {
            const body = request.body as {
                taskId?: string;
            };
    
            if (!body.taskId) {
                return createErrorResponse("WORKER_TASK_ID_REQUIRED", "上下文请求缺少 taskId", "任务 ID 不能为空。");
            }
    
            return createSuccessResponse(buildWorkerContext(database, body.taskId));
        });
}
