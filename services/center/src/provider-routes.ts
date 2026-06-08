import type {FastifyInstance} from "fastify";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import {
    createErrorResponse,
    createSuccessResponse,
} from "./helpers.js";
import {
    classifyModelGatewayError,
    createProvider,
    deleteProviderConfig,
    deleteProxyConfig,
    deleteRuntimeConfig,
    fetchProviderModelsFromUpstream,
    listProviderConfigs,
    listProxyConfigs,
    listRegisteredModelProtocolPlugins,
    listRuntimeConfigs,
    prepareModelGatewayRequest,
    readGlobalDefaultProxyId,
    readProviderModelList,
    refreshProviderModels,
    saveProxyConfig,
    saveRuntimeConfig,
    setGlobalDefaultProxy,
    updateProviderConfig,
} from "./provider-domain.js";
import type {
    CenterServiceConfig,
    ProviderCapabilityDeclaration,
    ProviderModelContextWindow,
    ProviderProxyPolicy,
} from "./types.js";

/**
 * registerProviderRoutes：注册供应商、代理、运行环境和模型网关管理接口。
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
    app.post("/api/provider/create", async (request) => {
        const body = request.body as {
            providerName?: string;
            protocolPluginId?: string;
            protocolMode?: string;
            baseUrl?: string;
            apiKey?: string;
            model?: string;
            enabled?: boolean;
            capabilities?: ProviderCapabilityDeclaration;
            proxyPolicy?: ProviderProxyPolicy;
        };

        if (!body.baseUrl) {
            return createErrorResponse(
                "PROVIDER_CREATE_INVALID",
                "供应商创建缺少 Base URL",
                "请至少填写 Base URL 后保存供应商。",
            );
        }

        try {
            return createSuccessResponse(createProvider(
                database,
                events,
                config.centerDirectory,
                body,
            ));
        } catch (error) {
            const message = error instanceof Error ? error.message : "供应商创建失败";
            if (message.includes("配置不完整，无法启用")) {
                return createErrorResponse(
                    "PROVIDER_ENABLE_CONFIG_INCOMPLETE",
                    message,
                    message,
                );
            }
            throw error;
        }
    });

    app.post("/api/provider/list", async () => createSuccessResponse({
        providers: listProviderConfigs(config.centerDirectory),
    }));

    app.post("/api/provider/protocol-plugin/list", async () => createSuccessResponse({
        // plugins: 供应商页协议适配器唯一来源；固定 OpenAI 内置项和中心目录 plugins/builtin-model-* 动态适配器都由中心服务返回。
        plugins: listRegisteredModelProtocolPlugins(config.centerDirectory),
    }));

    app.post("/api/provider/update", async (request) => {
        const body = request.body as {
            providerId?: string;
            providerName?: string;
            protocolPluginId?: string;
            protocolMode?: string;
            baseUrl?: string;
            apiKey?: string;
            enabled?: boolean;
            defaultModel?: string;
            capabilities?: ProviderCapabilityDeclaration;
            proxyPolicy?: ProviderProxyPolicy;
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "供应商更新缺少 providerId", "供应商 ID 不能为空。");
        }

        try {
            return createSuccessResponse(updateProviderConfig(config.centerDirectory, body));
        } catch (error) {
            const message = error instanceof Error ? error.message : "供应商更新失败";
            if (message.includes("配置不完整，无法启用")) {
                return createErrorResponse(
                    "PROVIDER_ENABLE_CONFIG_INCOMPLETE",
                    message,
                    message,
                );
            }
            throw error;
        }
    });

    app.post("/api/provider/delete", async (request) => {
        const body = request.body as {
            providerId?: string;
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "供应商删除缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(deleteProviderConfig(
            config.centerDirectory,
            body.providerId,
        ));
    });

    app.post("/api/provider/model-refresh", async (request) => {
        const body = request.body as {
            providerId?: string;
            models?: string[];
            reasoningEfforts?: string[];
            contextWindows?: ProviderModelContextWindow[];
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "刷新模型列表缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(refreshProviderModels(
            config.centerDirectory,
            body.providerId,
            body.models ?? [],
            body.reasoningEfforts ?? [],
            body.contextWindows ?? [],
        ));
    });

    app.post("/api/provider/model-fetch", async (request) => {
        const body = request.body as {
            providerId?: string;
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "获取模型列表缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(fetchProviderModelsFromUpstream(
            config.centerDirectory,
            body.providerId,
        ));
    });

    app.post("/api/provider/model-list", async (request) => {
        const body = request.body as {
            providerId?: string;
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "查询模型列表缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(readProviderModelList(config.centerDirectory, body.providerId));
    });

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

    app.post("/api/model-gateway/prepare", async (request) => {
        const body = request.body as {
            request?: unknown;
            protocolMode?: "chat-completions";
        };

        if (!body.request || body.protocolMode !== "chat-completions") {
            return createErrorResponse(
                "MODEL_GATEWAY_INVALID",
                "模型网关只接受 OpenAI Chat Completions 请求",
                "模型请求必须使用 chat-completions 协议。",
            );
        }

        return createSuccessResponse(prepareModelGatewayRequest(body.request, body.protocolMode));
    });

    app.post("/api/model-gateway/classify-error", async (request) => {
        const body = request.body as {
            failureStage?: string;
            statusCode?: number;
            message?: string;
        };

        if (!body.failureStage) {
            return createErrorResponse(
                "MODEL_GATEWAY_ERROR_STAGE_REQUIRED",
                "模型网关错误分类缺少 failureStage",
                "模型调用失败阶段不能为空。",
            );
        }

        return createSuccessResponse(classifyModelGatewayError(body.failureStage, body.statusCode ?? null, body.message ?? ""));
    });
}
