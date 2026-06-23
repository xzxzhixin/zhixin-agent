import type {FastifyInstance} from "fastify";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {
    createErrorResponse,
    createSuccessResponse,
} from "../helpers.js";
import {
    deleteProxyConfig,
    deleteRuntimeConfig,
    listProxyConfigs,
    listRuntimeConfigs,
    readGlobalDefaultProxyId,
    saveProxyConfig,
    saveRuntimeConfig,
    setGlobalDefaultProxy,
} from "../domain/proxy-runtime-domain.js";
import type {
    CenterServiceConfig,
} from "../types.js";

/**
 * registerProviderRoutes：注册代理和运行环境管理接口。
 *
 * @param app Fastify 实例。
 * @param database 中心服务数据库。
 * @param events 事件仓储。
 * @param config 中心服务配置，提供中心目录位置。
 * @returns 没有返回值。
 */
export function registerProviderRoutes(
    app: FastifyInstance,
    database: CenterDatabase,
    events: CenterEventStore,
    config: CenterServiceConfig,
): void {
    void database;
    void events;

    app.post("/api/proxy/save", async (request) => {
        const body = request.body as {
            proxyId?: string;
            proxyName?: string;
            protocol?: string;
            host?: string;
            port?: number;
            username?: string;
            password?: string;
            clearAuth?: boolean;
            enabled?: boolean;
            note?: string;
        };

        if (!body.proxyName || !body.protocol || !body.host || typeof body.port !== "number") {
            return createErrorResponse("PROXY_SAVE_INVALID", "代理配置缺少必要字段", "代理配置不完整。");
        }

        return createSuccessResponse(saveProxyConfig(config.centerDirectory, body));
    });

    app.post("/api/proxy/list", async () => createSuccessResponse({
        proxies: listProxyConfigs(config.centerDirectory),
        defaultProxyId: readGlobalDefaultProxyId(config.centerDirectory),
    }));

    app.post("/api/proxy/default/set", async (request) => {
        const body = request.body as {
            proxyId?: string | null;
        };

        return createSuccessResponse(setGlobalDefaultProxy(config.centerDirectory, body.proxyId ?? null));
    });

    app.post("/api/proxy/delete", async (request) => {
        const body = request.body as {
            proxyId?: string;
        };

        if (!body.proxyId) {
            return createErrorResponse("PROXY_ID_REQUIRED", "代理删除缺少 proxyId", "代理 ID 不能为空。");
        }

        return createSuccessResponse(deleteProxyConfig(config.centerDirectory, body.proxyId));
    });

    app.post("/api/runtime/save", async (request) => {
        const body = request.body as {
            runtimeId?: string;
            runtimeName?: string;
            runtimeType?: string;
            executablePath?: string;
            rootPath?: string;
            version?: string;
            environmentVariables?: Record<string, string>;
            pathEntries?: string[];
            isDefault?: boolean;
            enabled?: boolean;
            note?: string;
        };

        if (!body.runtimeName || !body.runtimeType || !body.executablePath || !body.rootPath) {
            return createErrorResponse("RUNTIME_SAVE_INVALID", "运行环境缺少必要字段", "运行环境信息不完整。");
        }

        return createSuccessResponse(saveRuntimeConfig(config.centerDirectory, body));
    });

    app.post("/api/runtime/list", async () => createSuccessResponse({
        runtimes: listRuntimeConfigs(config.centerDirectory),
    }));

    app.post("/api/runtime/delete", async (request) => {
        const body = request.body as {
            runtimeId?: string;
        };

        if (!body.runtimeId) {
            return createErrorResponse("RUNTIME_ID_REQUIRED", "运行环境删除缺少 runtimeId", "运行环境 ID 不能为空。");
        }

        return createSuccessResponse(deleteRuntimeConfig(config.centerDirectory, body.runtimeId));
    });

}
