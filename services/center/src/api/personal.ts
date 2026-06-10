import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {
    createCalendarEvent,
    createKnowledgeItem,
    createTodo,
} from "../domain/workflow-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerPersonalRoutes：注册 personal 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerPersonalRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        database,
        events,
    } = context;

    app.post("/api/personal/todo/create", async (request) => {
            const body = request.body as {
                title?: string;
                dueAt?: string | null;
            };
    
            if (!body.title) {
                return createErrorResponse("TODO_TITLE_REQUIRED", "待办缺少标题", "待办标题不能为空。");
            }
    
            return createSuccessResponse(createTodo(database, events, body.title, body.dueAt ?? null));
        });

    app.post("/api/personal/calendar/create", async (request) => {
            const body = request.body as {
                title?: string;
                startsAt?: string;
                endsAt?: string;
            };
    
            if (!body.title || !body.startsAt || !body.endsAt) {
                return createErrorResponse("CALENDAR_CREATE_INVALID", "日程缺少必要字段", "日程信息不完整。");
            }
    
            return createSuccessResponse(createCalendarEvent(database, events, body.title, body.startsAt, body.endsAt));
        });

    app.post("/api/personal/knowledge/create", async (request) => {
            const body = request.body as {
                title?: string;
                summary?: string;
                sourceRef?: string;
            };
    
            if (!body.title || !body.summary || !body.sourceRef) {
                return createErrorResponse("KNOWLEDGE_CREATE_INVALID", "知识条目缺少必要字段", "知识条目信息不完整。");
            }
    
            return createSuccessResponse(createKnowledgeItem(database, events, body.title, body.summary, body.sourceRef));
        });
}
