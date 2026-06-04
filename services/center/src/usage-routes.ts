import type {FastifyInstance} from "fastify";

import type {CenterDatabase} from "./database.js";
import {createSuccessResponse} from "./helpers.js";
import {
    aggregateUsageRecords,
    queryUsageRecords,
    refreshUsageDailyStats,
} from "./usage-domain.js";

/**
 * UsageQueryBody：用量查询筛选请求体。
 */
interface UsageQueryBody {
    /** providerId: 供应商 ID；为空时不按供应商筛选。 */
    providerId?: string | null;
    /** model: 模型名称；为空时不按模型筛选。 */
    model?: string | null;
    /** projectId: 项目 ID；为空时不按项目筛选。 */
    projectId?: string | null;
    /** sessionId: 会话 ID；为空时不按会话筛选。 */
    sessionId?: string | null;
    /** startedAt: 起始 ISO 时间；为空时不限制开始时间。 */
    startedAt?: string | null;
    /** endedAt: 结束 ISO 时间；为空时不限制结束时间。 */
    endedAt?: string | null;
}

/**
 * registerUsageRoutes：注册用量与任务步骤审计路由。
 *
 * @param app Fastify 应用实例。
 * @param database 中心服务数据库事实源。
 * @returns 没有返回值。
 */
export function registerUsageRoutes(
    app: FastifyInstance,
    database: CenterDatabase,
): void {
    app.post("/api/usage/query", async (request) => {
        const body = request.body as UsageQueryBody;

        return createSuccessResponse({
            records: queryUsageRecords(database, {
                providerId: body.providerId ?? null,
                model: body.model ?? null,
                projectId: body.projectId ?? null,
                sessionId: body.sessionId ?? null,
                startedAt: body.startedAt ?? null,
                endedAt: body.endedAt ?? null,
            }),
        });
    });

    app.post("/api/usage/aggregate", async (request) => {
        const body = request.body as UsageQueryBody;

        return createSuccessResponse({
            stats: aggregateUsageRecords(database, {
                providerId: body.providerId ?? null,
                model: body.model ?? null,
                projectId: body.projectId ?? null,
                sessionId: body.sessionId ?? null,
                startedAt: body.startedAt ?? null,
                endedAt: body.endedAt ?? null,
            }),
            refreshedDailyStats: refreshUsageDailyStats(database),
        });
    });

    app.post("/api/audit/task-steps", async () => createSuccessResponse({
        taskSteps: database.connection().prepare("SELECT * FROM task_steps ORDER BY started_at ASC").all(),
    }));
}
