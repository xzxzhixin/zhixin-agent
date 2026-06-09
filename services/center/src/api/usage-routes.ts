import type {FastifyInstance} from "fastify";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {createDataAccess} from "../data-access/index.js";
import {
    createErrorResponse,
    createSuccessResponse,
} from "../helpers.js";
import {
    aggregateUsageRecords,
    queryUsageRecords,
    refreshUsageDailyStats,
    type UsageQueryFilters,
} from "../domain/usage-domain.js";
import {listProviderConfigs} from "../domain/provider-domain.js";
import {recordUsage} from "../domain/workflow-domain.js";

/**
 * UsageQueryBody：用量查询筛选请求体。
 */
interface UsageQueryBody {
    /** providerId: 供应商 ID；为空时不按供应商筛选。 */
    providerId?: string | null;
    /** providerName: 供应商名称；来源于中心目录供应商配置 providerName。 */
    providerName?: string | null;
    /** model: 模型名称；为空时不按模型筛选。 */
    model?: string | null;
    /** modelName: 模型名称筛选展示字段；和 model 使用同一 usage_records.model 来源。 */
    modelName?: string | null;
    /** projectId: 项目 ID；为空时不按项目筛选。 */
    projectId?: string | null;
    /** projectName: 项目文件夹主名称；来源于 projects.display_name。 */
    projectName?: string | null;
    /** sessionId: 会话 ID；为空时不按会话筛选。 */
    sessionId?: string | null;
    /** startedAt: 起始 ISO 时间；为空时不限制开始时间。 */
    startedAt?: string | null;
    /** endedAt: 结束 ISO 时间；为空时不限制结束时间。 */
    endedAt?: string | null;
}

/**
 * normalizeUsageQueryBody：把用量筛选请求体转为中心服务内部筛选结构。
 *
 * @param centerDirectory 中心目录，用于按 providerName 读取供应商配置事实源。
 * @param body 前端筛选请求体。
 * @returns 用量查询筛选条件。
 */
function normalizeUsageQueryBody(
    centerDirectory: string,
    body: UsageQueryBody,
): UsageQueryFilters {
    // providerId: providerName 输入时先按供应商配置 providerName 单一来源解析，避免前端根据展示文案猜 providerId。
    const providerId = body.providerName
        ? resolveProviderIdByProviderName(centerDirectory, body.providerName)
        : body.providerId ?? null;

    return {
        providerId,
        providerName: body.providerName ?? null,
        model: body.model ?? null,
        modelName: body.modelName ?? null,
        projectId: body.projectId ?? null,
        projectName: body.projectName ?? null,
        sessionId: body.sessionId ?? null,
        startedAt: body.startedAt ?? null,
        endedAt: body.endedAt ?? null,
    };
}

/**
 * resolveProviderIdByProviderName：按供应商名称解析供应商 ID。
 *
 * @param centerDirectory 中心目录。
 * @param providerName 供应商名称，来源于用量统计筛选输入。
 * @returns 匹配供应商 ID；不存在时返回不会命中真实记录的固定值。
 */
function resolveProviderIdByProviderName(
    centerDirectory: string,
    providerName: string,
): string {
    const provider = listProviderConfigs(centerDirectory).find((item) => {
        return item.providerName === providerName;
    });
    // __provider_name_not_found__: 固定不可命中 ID，用于表达明确名称无匹配，不把缺失名称静默退回全量统计。
    return provider?.providerId ?? "__provider_name_not_found__";
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
    centerDirectory?: string,
    events?: CenterEventStore,
): void {
    app.post("/api/usage/query", async (request) => {
        const body = request.body as UsageQueryBody;

        return createSuccessResponse({
            records: queryUsageRecords(database, normalizeUsageQueryBody(centerDirectory ?? "", body)),
        });
    });

    app.post("/api/usage/aggregate", async (request) => {
        const body = request.body as UsageQueryBody;
        const filters = normalizeUsageQueryBody(centerDirectory ?? "", body);

        return createSuccessResponse({
            stats: aggregateUsageRecords(database, filters),
            refreshedDailyStats: refreshUsageDailyStats(database, filters),
        });
    });

    app.post("/api/audit/task-steps", async () => createSuccessResponse({
        taskSteps: createDataAccess(database).usage.listTaskStepsForAudit(),
    }));

    app.post("/api/usage/record", async (request) => {
        const body = request.body as {
            providerId?: string;
            sessionId?: string | null;
            model?: string;
            projectId?: string | null;
            inputTokens?: number | null;
            outputTokens?: number | null;
            cacheHitTokens?: number | null;
            cacheMissTokens?: number | null;
            status?: string;
        };

        if (!body.providerId || !body.model || !body.status) {
            return createErrorResponse("USAGE_RECORD_INVALID", "用量记录缺少必要字段", "用量记录信息不完整。");
        }

        if (!events) {
            return createErrorResponse("USAGE_EVENTS_REQUIRED", "用量记录缺少事件事实源", "中心服务事件事实源不能为空。");
        }

        return createSuccessResponse(recordUsage(database, events, body));
    });
}
