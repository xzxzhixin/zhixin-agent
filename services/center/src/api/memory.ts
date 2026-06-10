import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {
    readMemoryQueueState,
    writeAgentMemory,
} from "../domain/agent-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerMemoryRoutes：注册 memory 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerMemoryRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
        database,
        events,
        memoryQueues,
    } = context;

    app.post("/api/memory/write", async (request) => {
            const body = request.body as {
                agentId?: string;
                keywords?: string;
                summary?: string;
                userText?: string;
                assistantText?: string;
            };
    
            if (!body.agentId || !body.keywords || !body.summary || !body.userText || !body.assistantText) {
                return createErrorResponse(
                    "MEMORY_WRITE_INVALID",
                    "记忆写入缺少必要字段",
                    "记忆写入信息不完整。",
                );
            }
    
            return createSuccessResponse(writeAgentMemory(database, events, config.centerDirectory, memoryQueues, body));
        });

    app.post("/api/memory/queue-state", async (request) => {
            const body = request.body as {
                agentId?: string;
            };
    
            if (!body.agentId) {
                return createErrorResponse(
                    "MEMORY_QUEUE_AGENT_REQUIRED",
                    "查询记忆队列缺少 agentId",
                    "智能体 ID 不能为空。",
                );
            }
    
            return createSuccessResponse(readMemoryQueueState(memoryQueues, body.agentId));
        });
}
