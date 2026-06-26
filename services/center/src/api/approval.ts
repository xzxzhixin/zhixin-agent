import {
    EVENT_SCOPE_TYPES,
    EVENT_TYPES,
    TASK_STATUSES,
    type ClientType,
} from "@zhixin/shared";
import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {evaluateApprovalPolicy} from "../domain/workflow-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerApprovalRoutes：注册 approval 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerApprovalRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
        events,
    } = context;

    app.post("/api/approval/evaluate", async (request) => {
            const body = request.body as {
                clientType?: ClientType;
                operationKind?: "read" | "write" | "delete" | "command" | "plugin" | "mcp" | "skill";
            };
    
            if (!body.clientType || !body.operationKind) {
                return createErrorResponse("APPROVAL_EVALUATE_INVALID", "审批判断缺少 clientType 或 operationKind", "审批判断信息不完整。");
            }
    
            return createSuccessResponse(evaluateApprovalPolicy(config.centerDirectory, body.clientType, body.operationKind));
        });

    app.post("/api/approval/record", async (request) => {
            const body = request.body as {
                taskId?: string;
                approved?: boolean;
                reason?: string;
            };
            return createSuccessResponse(events.append({
                eventType: EVENT_TYPES.APPROVAL_RECORDED,
                scopeType: EVENT_SCOPE_TYPES.APPROVAL,
                scopeId: body.taskId ?? null,
                sessionId: null,
                turnId: null,
                taskId: body.taskId ?? null,
                status: body.approved ? TASK_STATUSES.COMPLETED : TASK_STATUSES.CANCELLED,
                title: "审批结果",
                summary: body.reason ?? "",
                payload: {
                    approved: Boolean(body.approved),
                },
            }));
        });
}
