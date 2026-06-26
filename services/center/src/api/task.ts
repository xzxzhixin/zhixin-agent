import type {
    ConversationTurnStatus,
    TaskRecord,
} from "@zhixin/shared";
import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {
    createTaskStep,
    findTask,
    updateTaskStep,
    updateTurnStatus,
} from "../domain/session-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerTaskRoutes：注册 task 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerTaskRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        database,
        events,
    } = context;

    app.post("/api/task/step/create", async (request) => {
            const body = request.body as {
                taskId?: string;
                title?: string;
            };
    
            if (!body.taskId || !body.title) {
                return createErrorResponse(
                    "TASK_STEP_CREATE_INVALID",
                    "任务步骤创建缺少 taskId 或 title",
                    "任务步骤创建信息不完整。",
                );
            }
    
            const task = findTask(database, body.taskId);
    
            if (!task) {
                return createErrorResponse(
                    "TASK_NOT_FOUND",
                    "任务步骤创建时任务不存在",
                    "没有找到要创建步骤的任务。",
                );
            }
    
            const step = createTaskStep(database, events, task, body.title);
            return createSuccessResponse(step);
        });

    app.post("/api/task/step/update", async (request) => {
            const body = request.body as {
                stepId?: string;
                status?: TaskRecord["status"];
                summary?: string | null;
            };
    
            if (!body.stepId || !body.status) {
                return createErrorResponse(
                    "TASK_STEP_UPDATE_INVALID",
                    "任务步骤更新缺少 stepId 或 status",
                    "任务步骤更新信息不完整。",
                );
            }
    
            const step = updateTaskStep(database, events, body.stepId, body.status, body.summary ?? null);
    
            if (!step) {
                return createErrorResponse(
                    "TASK_STEP_NOT_FOUND",
                    "任务步骤不存在",
                    "没有找到要更新的任务步骤。",
                );
            }
    
            return createSuccessResponse(step);
        });

    app.post("/api/turn/update-status", async (request) => {
            const body = request.body as {
                turnId?: string;
                status?: ConversationTurnStatus;
            };
    
            if (!body.turnId || !body.status) {
                return createErrorResponse(
                    "TURN_UPDATE_INVALID",
                    "轮次状态更新缺少 turnId 或 status",
                    "轮次状态更新信息不完整。",
                );
            }
    
            const turn = updateTurnStatus(database, events, body.turnId, body.status);
    
            if (!turn) {
                return createErrorResponse(
                    "TURN_NOT_FOUND",
                    "轮次不存在",
                    "没有找到要更新的轮次。",
                );
            }
    
            return createSuccessResponse(turn);
        });
}
