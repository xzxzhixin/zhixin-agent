import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";

import type {
    ModelProviderCapabilityRecord,
    ModelProviderProxyMode,
    ModelProviderRecord,
    ModelProviderSettingsRecord,
    ModelProtocol,
    UpdateModelProviderInput,
} from "../data-access/ModelProviderRepository.js";
import {ModelProviderRepository} from "../data-access/ModelProviderRepository.js";
import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {ModelProtocolRegistry} from "../model-provider/ModelProtocolRegistry.js";
import {readSecretValue} from "../model-provider/ModelProviderRuntimeFactory.js";
import {formatCenterLocalDateTime} from "../time.js";
import type {CenterApiRouteContext} from "./route-context.js";

/** ModelProviderCapabilityPayload：API 入参中的供应商能力声明。 */
interface ModelProviderCapabilityPayload {
    /** supportsVision: 是否支持视觉输入。 */
    supportsVision?: boolean;
    /** supportsToolCalling: 是否支持工具调用。 */
    supportsToolCalling?: boolean;
    /** supportsJsonOutput: 是否支持 JSON 输出。 */
    supportsJsonOutput?: boolean;
    /** supportsReasoningEffort: 是否支持推理深度。 */
    supportsReasoningEffort?: boolean;
    /** supportsModelList: 是否支持模型列表接口。 */
    supportsModelList?: boolean;
    /** supportsStreaming: 是否支持流式输出。 */
    supportsStreaming?: boolean;
    /** providesCacheUsage: 是否提供缓存用量。 */
    providesCacheUsage?: boolean;
    /** responsesSupported: 是否支持 OpenAI Responses 接口。 */
    responsesSupported?: boolean;
    /** chatCompletionsSupported: 是否支持 OpenAI Chat Completions 接口。 */
    chatCompletionsSupported?: boolean;
    /** responsesStreamSupported: 是否支持 Responses 流式事件。 */
    responsesStreamSupported?: boolean;
    /** chatCompletionsStreamSupported: 是否支持 Chat Completions 流式事件。 */
    chatCompletionsStreamSupported?: boolean;
    /** streamToolCallsSupported: 是否支持流式工具调用。 */
    streamToolCallsSupported?: boolean;
    /** selectedRuntimeMode: 自动探测选择的运行时模式。 */
    selectedRuntimeMode?: ModelProviderCapabilityRecord["selectedRuntimeMode"];
    /** lastTestStatus: 最近探测状态。 */
    lastTestStatus?: "passed" | "failed" | null;
    /** lastTestMessage: 最近探测摘要。 */
    lastTestMessage?: string | null;
    /** lastTestedAt: 最近探测时间。 */
    lastTestedAt?: string | null;
}

/** ModelProviderSavePayload：创建或更新供应商的 API 入参。 */
interface ModelProviderSavePayload {
    /** providerId: 更新时传入的供应商 ID。 */
    providerId?: string;
    /** providerName: 供应商名称。 */
    providerName?: string;
    /** modelProtocol: 模型协议。 */
    modelProtocol?: string;
    /** apiBaseUrl: 接口基础地址。 */
    apiBaseUrl?: string | null;
    /** apiKey: 新 API Key 明文，仅用于本次保存。 */
    apiKey?: string;
    /** clearApiKey: 是否清空已保存 API Key。 */
    clearApiKey?: boolean;
    /** customHeadersJson: 自定义请求头 JSON 字符串。 */
    customHeadersJson?: string;
    /** proxyMode: 代理策略。 */
    proxyMode?: string;
    /** proxyId: 指定代理 ID。 */
    proxyId?: string | null;
    /** enabled: 是否启用。 */
    enabled?: boolean;
    /** defaultModelName: 默认模型名。 */
    defaultModelName?: string | null;
    /** reasoningEffort: 推理深度。 */
    reasoningEffort?: string | null;
    /** temperature: 温度参数。 */
    temperature?: number | null;
    /** maxOutputTokens: 最大输出 token。 */
    maxOutputTokens?: number | null;
    /** extraJson: 扩展业务设置 JSON。 */
    extraJson?: string;
    /** capabilities: 能力声明。 */
    capabilities?: ModelProviderCapabilityPayload;
}

/** ModelProviderView：API 返回的供应商展示结构，不包含 secretRef。 */
interface ModelProviderView {
    /** providerId: 供应商 ID。 */
    providerId: string;
    /** providerName: 供应商名称。 */
    providerName: string;
    /** modelProtocol: 模型协议。 */
    modelProtocol: ModelProtocol;
    /** modelProtocolLabel: 模型协议展示名，来源于代码侧协议注册表。 */
    modelProtocolLabel: string;
    /** apiBaseUrl: 接口基础地址。 */
    apiBaseUrl: string | null;
    /** hasApiKey: 是否已保存 API Key。 */
    hasApiKey: boolean;
    /** customHeadersJson: 自定义请求头 JSON。 */
    customHeadersJson: string;
    /** proxyMode: 代理策略。 */
    proxyMode: ModelProviderProxyMode;
    /** proxyId: 指定代理 ID。 */
    proxyId: string | null;
    /** enabled: 是否启用。 */
    enabled: boolean;
    /** createdAt: 创建时间。 */
    createdAt: string;
    /** updatedAt: 更新时间。 */
    updatedAt: string;
    /** settings: 默认调用设置。 */
    settings: ModelProviderSettingsRecord;
    /** defaultModel: 默认模型兼容展示字段，来源于 settings.defaultModelName。 */
    defaultModel: string;
    /** capabilities: 能力声明。 */
    capabilities: ModelProviderCapabilityRecord;
    /** models: 模型列表。 */
    models: ModelProviderRecord["models"];
    /** latestCheck: 最近检测。 */
    latestCheck: ModelProviderRecord["latestCheck"];
    /** proxyPolicy: 代理策略兼容对象，来源于 proxyMode 和 proxyId。 */
    proxyPolicy: {
        /** mode: 代理策略模式。 */
        mode: ModelProviderProxyMode;
        /** proxyId: 指定代理 ID。 */
        proxyId: string | null;
    };
}

/** SecretConfigFile：中心服务私有敏感信息文件结构。 */
interface SecretConfigFile {
    /** secrets: secretRef 到敏感值记录的映射，客户端接口绝不返回 value。 */
    secrets: Record<string, {
        /** secretKind: 敏感信息类型。 */
        secretKind: "provider-api-key" | "proxy-password";
        /** ownerId: 关联实体 ID。 */
        ownerId: string;
        /** value: 敏感明文，只供中心服务本机调用外部服务使用。 */
        value: string;
        /** updatedAt: 更新时间，中心服务本机时间。 */
        updatedAt: string;
    }>;
}

/** ProviderProtocolProbeResult：供应商协议探测结果。 */
interface ProviderProtocolProbeResult {
    /** capabilities: 探测后要写入数据库的能力矩阵。 */
    capabilities: Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt">;
    /** status: 探测状态。 */
    status: "passed" | "failed";
    /** message: 探测摘要。 */
    message: string;
}

/** ProviderProtocolProbeContext：供应商协议探测输入。 */
interface ProviderProtocolProbeContext {
    /** provider: 当前供应商记录。 */
    provider: ModelProviderRecord;
    /** centerDirectory: 中心服务目录，用于读取 API Key。 */
    centerDirectory: string;
    /** checkedAt: 本次探测时间。 */
    checkedAt: string;
}

/**
 * registerModelProviderRoutes：注册数据库化模型供应商 API。
 *
 * @param context 中心服务路由上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerModelProviderRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        database,
        config,
    } = context;
    const repository = new ModelProviderRepository(database);
    const protocolRegistry = new ModelProtocolRegistry();

    app.post("/api/model-provider/list", async () => {
        return createSuccessResponse({
            providers: repository.listProviders().map((provider) => {
                return toProviderView(
                    provider,
                    protocolRegistry,
                );
            }),
        });
    });

    app.post("/api/model-provider/protocol-options", async () => {
        return createSuccessResponse({
            modelProtocolOptions: protocolRegistry.listProtocolOptions(),
        });
    });

    app.post("/api/model-provider/create", async (request) => {
        const body = request.body as ModelProviderSavePayload;
        const validation = validateSavePayload(
            body,
            protocolRegistry,
            false,
        );
        if (!validation.ok) {
            return validation.error;
        }

        const now = formatCenterLocalDateTime();
        if (validation.enabled && (!validation.defaultModelName || !body.apiKey)) {
            return createErrorResponse(
                "MODEL_PROVIDER_ENABLE_CONFIG_INCOMPLETE",
                "供应商启用缺少默认模型或 API Key",
                "启用供应商前必须保存默认模型和 API Key。",
            );
        }
        const providerIdForSecret = `pending-${Date.now()}`;
        const apiKeySecretRef = saveApiKeySecret(
            config.centerDirectory,
            providerIdForSecret,
            body.apiKey,
            null,
            now,
        );

        const provider = repository.createProvider({
            providerName: validation.providerName,
            modelProtocol: validation.modelProtocol,
            apiBaseUrl: validation.apiBaseUrl,
            apiKeySecretRef,
            customHeadersJson: validation.customHeadersJson,
            proxyMode: validation.proxyMode,
            proxyId: validation.proxyId,
            enabled: validation.enabled,
            defaultModelName: validation.defaultModelName,
            reasoningEffort: validation.reasoningEffort,
            temperature: validation.temperature,
            maxOutputTokens: validation.maxOutputTokens,
            extraJson: validation.extraJson,
            capabilities: validation.capabilities,
            now,
        });

        // 创建供应商前还没有 providerId，这里把临时 secretRef 迁移为稳定 ownerId 引用。
        const stableSecretRef = apiKeySecretRef
            ? moveApiKeySecretOwner(
                config.centerDirectory,
                apiKeySecretRef,
                provider.providerId,
                now,
            )
            : null;
        const savedProvider = stableSecretRef
            ? repository.updateProvider({
                providerId: provider.providerId,
                apiKeySecretRef: stableSecretRef,
                now,
            })
            : provider;

        return createSuccessResponse({
            provider: toProviderView(
                savedProvider,
                protocolRegistry,
            ),
        });
    });

    app.post("/api/model-provider/update", async (request) => {
        const body = request.body as ModelProviderSavePayload;
        if (!body.providerId) {
            return createErrorResponse(
                "MODEL_PROVIDER_ID_REQUIRED",
                "模型供应商更新缺少 providerId",
                "供应商 ID 不能为空。",
            );
        }

        const existing = repository.findProvider(body.providerId);
        if (!existing) {
            return createErrorResponse(
                "MODEL_PROVIDER_NOT_FOUND",
                "模型供应商不存在",
                "没有找到要更新的供应商。",
            );
        }

        const validation = validateSavePayload(
            body,
            protocolRegistry,
            true,
        );
        if (!validation.ok) {
            return validation.error;
        }

        const now = formatCenterLocalDateTime();
        const apiKeySecretRef = resolveUpdatedApiKeySecretRef(
            config.centerDirectory,
            body,
            existing,
            now,
        );
        const targetDefaultModelName = body.defaultModelName === undefined
            ? existing.settings.defaultModelName
            : validation.defaultModelName;
        const targetEnabled = body.enabled === undefined
            ? existing.enabled
            : validation.enabled;
        if (targetEnabled && (!targetDefaultModelName || !apiKeySecretRef.value)) {
            return createErrorResponse(
                "MODEL_PROVIDER_ENABLE_CONFIG_INCOMPLETE",
                "供应商启用缺少默认模型或 API Key",
                "启用供应商前必须保存默认模型和 API Key。",
            );
        }
        const updateInput: UpdateModelProviderInput = {
            providerId: body.providerId,
            now,
        };
        if (body.providerName !== undefined) {
            updateInput.providerName = validation.providerName;
        }
        if (body.modelProtocol !== undefined) {
            updateInput.modelProtocol = validation.modelProtocol;
        }
        if (body.apiBaseUrl !== undefined) {
            updateInput.apiBaseUrl = validation.apiBaseUrl;
        }
        if (apiKeySecretRef.changed) {
            updateInput.apiKeySecretRef = apiKeySecretRef.value;
        }
        if (body.customHeadersJson !== undefined) {
            updateInput.customHeadersJson = validation.customHeadersJson;
        }
        if (body.proxyMode !== undefined) {
            updateInput.proxyMode = validation.proxyMode;
            updateInput.proxyId = validation.proxyId;
        }
        if (body.enabled !== undefined) {
            updateInput.enabled = validation.enabled;
        }
        if (body.defaultModelName !== undefined) {
            updateInput.defaultModelName = validation.defaultModelName;
        }
        if (body.reasoningEffort !== undefined) {
            updateInput.reasoningEffort = validation.reasoningEffort;
        }
        if (body.temperature !== undefined) {
            updateInput.temperature = validation.temperature;
        }
        if (body.maxOutputTokens !== undefined) {
            updateInput.maxOutputTokens = validation.maxOutputTokens;
        }
        if (body.extraJson !== undefined) {
            updateInput.extraJson = validation.extraJson;
        }
        if (body.capabilities !== undefined) {
            updateInput.capabilities = validation.capabilities;
        }

        const provider = repository.updateProvider(updateInput);
        return createSuccessResponse({
            provider: toProviderView(
                provider,
                protocolRegistry,
            ),
        });
    });

    app.post("/api/model-provider/delete", async (request) => {
        const body = request.body as {
            providerId?: string;
        };
        if (!body.providerId) {
            return createErrorResponse(
                "MODEL_PROVIDER_ID_REQUIRED",
                "模型供应商删除缺少 providerId",
                "供应商 ID 不能为空。",
            );
        }

        const existing = repository.findProvider(body.providerId);
        if (existing?.apiKeySecretRef) {
            removeSecretValue(
                config.centerDirectory,
                existing.apiKeySecretRef,
            );
        }
        repository.deleteProvider(body.providerId);
        return createSuccessResponse({
            providerId: body.providerId,
            deleted: true,
        });
    });

    app.post("/api/model-provider/model/save", async (request) => {
        const body = request.body as {
            providerId?: string;
            defaultModelName?: string | null;
            reasoningEfforts?: string[];
            models?: Array<{
                modelName?: string;
                displayName?: string;
                contextWindowTokens?: number | null;
                enabled?: boolean;
                sortOrder?: number;
            }>;
        };
        if (!body.providerId) {
            return createErrorResponse(
                "MODEL_PROVIDER_ID_REQUIRED",
                "模型保存缺少 providerId",
                "供应商 ID 不能为空。",
            );
        }
        if (!Array.isArray(body.models)) {
            return createErrorResponse(
                "MODEL_PROVIDER_MODELS_INVALID",
                "模型保存缺少 models 数组",
                "模型列表不能为空。",
            );
        }
        if (!repository.findProvider(body.providerId)) {
            return createErrorResponse(
                "MODEL_PROVIDER_NOT_FOUND",
                "模型保存时供应商不存在",
                "没有找到要保存模型的供应商。",
            );
        }

        const models = [];
        for (const model of body.models) {
            const modelName = normalizeOptionalString(model.modelName);
            if (!modelName) {
                return createErrorResponse(
                    "MODEL_PROVIDER_MODEL_NAME_REQUIRED",
                    "模型保存缺少模型名称",
                    "模型名称不能为空。",
                );
            }
            models.push({
                modelName,
                displayName: normalizeOptionalString(model.displayName) ?? modelName,
                contextWindowTokens: normalizePositiveIntegerOrNull(model.contextWindowTokens),
                enabled: model.enabled !== false,
                sortOrder: typeof model.sortOrder === "number" ? model.sortOrder : models.length,
            });
        }

        const now = formatCenterLocalDateTime();
        repository.saveModels({
            providerId: body.providerId,
            models,
            defaultModelName: body.defaultModelName === undefined
                ? undefined
                : normalizeOptionalString(body.defaultModelName),
            reasoningEfforts: Array.isArray(body.reasoningEfforts)
                ? normalizeStringList(body.reasoningEfforts)
                : undefined,
            now,
        });

        return createSuccessResponse({
            provider: toProviderView(
                repository.requireProvider(body.providerId),
                protocolRegistry,
            ),
        });
    });

    app.post("/api/model-provider/check/run", async (request) => {
        const body = request.body as {
            providerId?: string;
            checkType?: string;
        };
        if (!body.providerId) {
            return createErrorResponse(
                "MODEL_PROVIDER_ID_REQUIRED",
                "模型供应商检测缺少 providerId",
                "供应商 ID 不能为空。",
            );
        }

        const provider = repository.findProvider(body.providerId);
        if (!provider) {
            return createErrorResponse(
                "MODEL_PROVIDER_NOT_FOUND",
                "模型供应商不存在",
                "没有找到要检测的供应商。",
            );
        }

        const checkedAt = formatCenterLocalDateTime();
        const checkResult = await runProtocolCapabilityProbe({
            provider,
            centerDirectory: config.centerDirectory,
            checkedAt,
        });
        repository.updateProvider({
            providerId: provider.providerId,
            capabilities: checkResult.capabilities,
            now: checkedAt,
        });
        const check = repository.appendCheck({
            providerId: provider.providerId,
            checkType: normalizeOptionalString(body.checkType) ?? "protocol-capability",
            status: checkResult.status,
            errorMessage: checkResult.status === "passed" ? null : checkResult.message,
            checkedAt,
        });

        return createSuccessResponse({
            check,
            provider: toProviderView(
                repository.requireProvider(provider.providerId),
                protocolRegistry,
            ),
        });
    });
}

/**
 * validateSavePayload：校验创建或更新供应商入参。
 *
 * @param body 请求体。
 * @param protocolRegistry 协议注册表。
 * @param partial 是否允许部分更新。
 * @returns 校验成功时返回规范化字段，失败时返回统一错误响应。
 */
function validateSavePayload(
    body: ModelProviderSavePayload,
    protocolRegistry: ModelProtocolRegistry,
    partial: boolean,
): {
    ok: true;
    providerName: string;
    modelProtocol: ModelProtocol;
    apiBaseUrl: string | null;
    customHeadersJson: string;
    proxyMode: ModelProviderProxyMode;
    proxyId: string | null;
    enabled: boolean;
    defaultModelName: string | null;
    reasoningEffort: string | null;
    temperature: number | null;
    maxOutputTokens: number | null;
    extraJson: string;
    capabilities: Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt">;
} | {
    ok: false;
    error: ReturnType<typeof createErrorResponse>;
} {
    const providerName = normalizeOptionalString(body.providerName);
    if (!partial && !providerName) {
        return invalidPayload("MODEL_PROVIDER_NAME_REQUIRED", "供应商名称不能为空。");
    }

    if (!partial && !body.modelProtocol) {
        return invalidPayload("MODEL_PROVIDER_PROTOCOL_REQUIRED", "模型协议不能为空。");
    }
    const modelProtocol = body.modelProtocol && protocolRegistry.isSupportedProtocol(body.modelProtocol)
        ? body.modelProtocol
        : null;
    if (body.modelProtocol !== undefined && !modelProtocol) {
        return invalidPayload("MODEL_PROVIDER_PROTOCOL_INVALID", "模型协议不支持。");
    }

    const definition = modelProtocol ? protocolRegistry.getProtocolDefinition(modelProtocol) : null;
    const apiBaseUrl = normalizeOptionalString(body.apiBaseUrl);
    if (definition?.requiresBaseUrl && !apiBaseUrl) {
        return invalidPayload("MODEL_PROVIDER_BASE_URL_REQUIRED", "该模型协议必须填写 Base URL。");
    }

    const customHeadersJson = body.customHeadersJson === undefined
        ? "{}"
        : normalizeJsonObjectString(body.customHeadersJson);
    if (customHeadersJson === null) {
        return invalidPayload("MODEL_PROVIDER_HEADERS_INVALID", "自定义请求头必须是 JSON 对象字符串。");
    }

    const proxyMode = normalizeProxyMode(body.proxyMode);
    if (body.proxyMode !== undefined && !proxyMode) {
        return invalidPayload("MODEL_PROVIDER_PROXY_MODE_INVALID", "代理策略不支持。");
    }

    const extraJson = body.extraJson === undefined
        ? "{}"
        : normalizeJsonObjectString(body.extraJson);
    if (extraJson === null) {
        return invalidPayload("MODEL_PROVIDER_EXTRA_INVALID", "扩展设置必须是 JSON 对象字符串。");
    }

    return {
        ok: true,
        providerName: providerName ?? "",
        modelProtocol: modelProtocol ?? "openai",
        apiBaseUrl,
        customHeadersJson,
        proxyMode: proxyMode ?? "use-global-default",
        proxyId: proxyMode === "use-specified"
            ? normalizeOptionalString(body.proxyId)
            : null,
        enabled: body.enabled === true,
        defaultModelName: normalizeOptionalString(body.defaultModelName),
        reasoningEffort: normalizeOptionalString(body.reasoningEffort),
        temperature: typeof body.temperature === "number" ? body.temperature : null,
        maxOutputTokens: normalizePositiveIntegerOrNull(body.maxOutputTokens),
        extraJson,
        capabilities: normalizeCapabilities(body.capabilities),
    };
}

/**
 * runProtocolCapabilityProbe：按 Responses 优先、Chat Completions 兜底探测供应商协议能力。
 *
 * @param context 探测上下文。
 * @returns 探测结果和可保存能力矩阵。
 */
async function runProtocolCapabilityProbe(context: ProviderProtocolProbeContext): Promise<ProviderProtocolProbeResult> {
    const baseCapabilities = {
        ...context.provider.capabilities,
        responsesSupported: false,
        chatCompletionsSupported: false,
        responsesStreamSupported: false,
        chatCompletionsStreamSupported: false,
        streamToolCallsSupported: false,
        selectedRuntimeMode: null,
        lastTestStatus: "failed" as const,
        lastTestMessage: "供应商协议探测尚未通过。",
        lastTestedAt: context.checkedAt,
    };
    if (!context.provider.settings.defaultModelName) {
        return {
            capabilities: {
                ...baseCapabilities,
                lastTestMessage: "供应商未配置默认模型。",
            },
            status: "failed",
            message: "供应商未配置默认模型。",
        };
    }
    const apiKey = readSecretValue(
        context.centerDirectory,
        context.provider.apiKeySecretRef,
    );
    if (!apiKey) {
        return {
            capabilities: {
                ...baseCapabilities,
                lastTestMessage: "供应商未保存 API Key。",
            },
            status: "failed",
            message: "供应商未保存 API Key。",
        };
    }

    const responsesResult = await probeResponsesEndpoint(
        context.provider,
        apiKey,
    );
    if (responsesResult.passed) {
        const message = "Responses 协议探测通过，运行时将直接使用 Responses。";
        return {
            capabilities: {
                ...baseCapabilities,
                supportsToolCalling: true,
                supportsStreaming: responsesResult.streamSupported,
                supportsReasoningEffort: responsesResult.reasoningSupported,
                responsesSupported: true,
                responsesStreamSupported: responsesResult.streamSupported,
                streamToolCallsSupported: responsesResult.toolCallsSupported,
                selectedRuntimeMode: "responses",
                lastTestStatus: "passed",
                lastTestMessage: message,
            },
            status: "passed",
            message,
        };
    }

    const chatCompletionsResult = await probeChatCompletionsEndpoint(
        context.provider,
        apiKey,
    );
    if (chatCompletionsResult.passed) {
        const message = `Responses 不支持，Chat Completions 兼容探测通过：${responsesResult.message}`;
        return {
            capabilities: {
                ...baseCapabilities,
                supportsToolCalling: chatCompletionsResult.toolCallsSupported,
                supportsStreaming: chatCompletionsResult.streamSupported,
                supportsReasoningEffort: chatCompletionsResult.reasoningSupported,
                chatCompletionsSupported: true,
                chatCompletionsStreamSupported: chatCompletionsResult.streamSupported,
                streamToolCallsSupported: chatCompletionsResult.toolCallsSupported,
                selectedRuntimeMode: "chat_completions_to_responses",
                lastTestStatus: "passed",
                lastTestMessage: message,
            },
            status: "passed",
            message,
        };
    }

    const message = `Responses 探测失败：${responsesResult.message}；Chat Completions 探测失败：${chatCompletionsResult.message}`;
    return {
        capabilities: {
            ...baseCapabilities,
            lastTestMessage: message,
        },
        status: "failed",
        message,
    };
}

/**
 * probeResponsesEndpoint：探测 OpenAI Responses 原生接口。
 *
 * @param provider 供应商记录。
 * @param apiKey API Key 明文。
 * @returns 探测结果。
 */
async function probeResponsesEndpoint(
    provider: ModelProviderRecord,
    apiKey: string,
): Promise<{
    /** passed: 是否通过 Responses 探测。 */
    passed: boolean;
    /** message: 探测摘要。 */
    message: string;
    /** toolCallsSupported: 是否支持工具调用。 */
    toolCallsSupported: boolean;
    /** streamSupported: 是否支持流式。 */
    streamSupported: boolean;
    /** reasoningSupported: 是否接受推理参数。 */
    reasoningSupported: boolean;
}> {
    const model = provider.settings.defaultModelName;
    if (!model) {
        return {
            passed: false,
            message: "默认模型为空。",
            toolCallsSupported: false,
            streamSupported: false,
            reasoningSupported: false,
        };
    }
    const url = `${resolveApiBaseUrl(provider)}/responses`;
    const headers = buildProbeHeaders(
        provider,
        apiKey,
    );
    const body = {
        // model: 供应商默认模型，来源于 model_provider_settings.default_model_name。
        model,
        // input: Responses 最小输入，避免把用户提示词写入探测逻辑。
        input: "Return the word ok.",
        // tools: 使用无副作用函数工具验证 Responses 工具调用结构是否被接受。
        tools: [
            {
                type: "function",
                name: "zhixin_protocol_probe",
                description: "Protocol probe tool.",
                parameters: {
                    type: "object",
                    properties: {
                        value: {
                            type: "string",
                        },
                    },
                    required: [
                        "value",
                    ],
                    additionalProperties: false,
                },
            },
        ],
        // reasoning: OpenAI Responses 推理参数探测；不支持时会在失败信息中体现。
        reasoning: provider.settings.reasoningEffort
            ? {
                effort: provider.settings.reasoningEffort,
            }
            : undefined,
    };
    const response = await postJsonProbe(
        url,
        headers,
        body,
    );
    if (!response.ok) {
        return {
            passed: false,
            message: response.message,
            toolCallsSupported: false,
            streamSupported: false,
            reasoningSupported: false,
        };
    }
    return {
        passed: true,
        message: "Responses 非流式请求通过。",
        toolCallsSupported: JSON.stringify(response.data).includes("function_call"),
        streamSupported: false,
        reasoningSupported: true,
    };
}

/**
 * probeChatCompletionsEndpoint：探测 Chat Completions 兼容接口。
 *
 * @param provider 供应商记录。
 * @param apiKey API Key 明文。
 * @returns 探测结果。
 */
async function probeChatCompletionsEndpoint(
    provider: ModelProviderRecord,
    apiKey: string,
): Promise<{
    /** passed: 是否通过 Chat Completions 探测。 */
    passed: boolean;
    /** message: 探测摘要。 */
    message: string;
    /** toolCallsSupported: 是否支持工具调用。 */
    toolCallsSupported: boolean;
    /** streamSupported: 是否支持流式。 */
    streamSupported: boolean;
    /** reasoningSupported: 是否接受推理参数。 */
    reasoningSupported: boolean;
}> {
    const model = provider.settings.defaultModelName;
    if (!model) {
        return {
            passed: false,
            message: "默认模型为空。",
            toolCallsSupported: false,
            streamSupported: false,
            reasoningSupported: false,
        };
    }
    const body = {
        // model: 供应商默认模型，来源于 model_provider_settings.default_model_name。
        model,
        // messages: Chat Completions 最小消息。
        messages: [
            {
                role: "user",
                content: "Return the word ok.",
            },
        ],
        // tools: 使用无副作用函数工具验证工具调用字段是否被接受。
        tools: [
            {
                type: "function",
                function: {
                    name: "zhixin_protocol_probe",
                    description: "Protocol probe tool.",
                    parameters: {
                        type: "object",
                        properties: {
                            value: {
                                type: "string",
                            },
                        },
                        required: [
                            "value",
                        ],
                        additionalProperties: false,
                    },
                },
            },
        ],
        reasoning_effort: provider.settings.reasoningEffort ?? undefined,
    };
    const response = await postJsonProbe(
        `${resolveApiBaseUrl(provider)}/chat/completions`,
        buildProbeHeaders(
            provider,
            apiKey,
        ),
        body,
    );
    if (!response.ok) {
        return {
            passed: false,
            message: response.message,
            toolCallsSupported: false,
            streamSupported: false,
            reasoningSupported: false,
        };
    }
    const text = JSON.stringify(response.data);
    const hasMalformedTextToolCallBlock = text.includes("\"type\":\"text\"")
        && text.includes("\"name\":\"")
        && text.includes("\"args\"");
    if (hasMalformedTextToolCallBlock) {
        return {
            passed: false,
            message: "Chat Completions 返回 text content block 夹带工具字段。",
            toolCallsSupported: false,
            streamSupported: false,
            reasoningSupported: false,
        };
    }
    return {
        passed: true,
        message: "Chat Completions 非流式请求通过。",
        toolCallsSupported: text.includes("tool_calls"),
        streamSupported: false,
        reasoningSupported: true,
    };
}

/**
 * toProviderView：把仓储记录转换为 API 返回结构。
 *
 * @param provider 仓储供应商记录。
 * @param protocolRegistry 模型协议注册表。
 * @returns API 安全展示结构。
 */
function toProviderView(
    provider: ModelProviderRecord,
    protocolRegistry: ModelProtocolRegistry,
): ModelProviderView {
    const protocolDefinition = protocolRegistry.getProtocolDefinition(provider.modelProtocol);
    return {
        providerId: provider.providerId,
        providerName: provider.providerName,
        modelProtocol: provider.modelProtocol,
        modelProtocolLabel: protocolDefinition.label,
        apiBaseUrl: provider.apiBaseUrl,
        hasApiKey: typeof provider.apiKeySecretRef === "string",
        customHeadersJson: provider.customHeadersJson,
        proxyMode: provider.proxyMode,
        proxyId: provider.proxyId,
        enabled: provider.enabled,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
        settings: provider.settings,
        defaultModel: provider.settings.defaultModelName ?? "",
        capabilities: provider.capabilities,
        models: provider.models,
        latestCheck: provider.latestCheck,
        proxyPolicy: {
            mode: provider.proxyMode,
            proxyId: provider.proxyId,
        },
    };
}

/**
 * normalizeCapabilities：规范化能力声明，未传字段使用保守默认值。
 *
 * @param capabilities 外部能力声明。
 * @returns 完整能力声明。
 */
function normalizeCapabilities(
    capabilities: ModelProviderCapabilityPayload | undefined,
): Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt"> {
    return {
        supportsVision: capabilities?.supportsVision === true,
        supportsToolCalling: capabilities?.supportsToolCalling === true,
        supportsJsonOutput: capabilities?.supportsJsonOutput === true,
        supportsReasoningEffort: capabilities?.supportsReasoningEffort === true,
        supportsModelList: capabilities?.supportsModelList === true,
        supportsStreaming: capabilities?.supportsStreaming !== false,
        providesCacheUsage: capabilities?.providesCacheUsage === true,
        responsesSupported: capabilities?.responsesSupported === true,
        chatCompletionsSupported: capabilities?.chatCompletionsSupported === true,
        responsesStreamSupported: capabilities?.responsesStreamSupported === true,
        chatCompletionsStreamSupported: capabilities?.chatCompletionsStreamSupported === true,
        streamToolCallsSupported: capabilities?.streamToolCallsSupported === true,
        selectedRuntimeMode: capabilities?.selectedRuntimeMode === "responses"
            || capabilities?.selectedRuntimeMode === "chat_completions_to_responses"
            ? capabilities.selectedRuntimeMode
            : null,
        lastTestStatus: capabilities?.lastTestStatus === "passed" || capabilities?.lastTestStatus === "failed"
            ? capabilities.lastTestStatus
            : null,
        lastTestMessage: normalizeOptionalString(capabilities?.lastTestMessage),
        lastTestedAt: normalizeOptionalString(capabilities?.lastTestedAt),
    };
}

/**
 * resolveApiBaseUrl：解析供应商 OpenAI 兼容基础地址。
 *
 * @param provider 供应商记录。
 * @returns 不带结尾斜杠的基础地址。
 */
function resolveApiBaseUrl(provider: ModelProviderRecord): string {
    const baseUrl = provider.apiBaseUrl ?? "https://api.openai.com/v1";
    return baseUrl.replace(/\/$/u, "");
}

/**
 * buildProbeHeaders：构造协议探测请求头。
 *
 * @param provider 供应商记录。
 * @param apiKey API Key 明文。
 * @returns 请求头。
 */
function buildProbeHeaders(
    provider: ModelProviderRecord,
    apiKey: string,
): Record<string, string> {
    const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    };
    let customHeaders: Record<string, unknown>;
    try {
        customHeaders = JSON.parse(provider.customHeadersJson) as Record<string, unknown>;
    } catch {
        customHeaders = {};
    }
    for (const [
        key,
        value,
    ] of Object.entries(customHeaders)) {
        if (typeof value === "string") {
            headers[key] = value;
        }
    }
    return headers;
}

/**
 * postJsonProbe：发送协议探测 JSON 请求。
 *
 * @param url 请求地址。
 * @param headers 请求头。
 * @param body JSON 请求体。
 * @returns 探测响应摘要。
 */
async function postJsonProbe(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
): Promise<{
    /** ok: HTTP 是否成功。 */
    ok: boolean;
    /** data: 成功时的 JSON 响应。 */
    data: unknown;
    /** message: 失败或成功摘要。 */
    message: string;
}> {
    try {
        const response = await fetch(
            url,
            {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            },
        );
        const text = await response.text();
        let data: unknown = null;
        if (text.length > 0) {
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }
        }
        if (!response.ok) {
            return {
                ok: false,
                data,
                message: `HTTP ${response.status}: ${text.slice(
                    0,
                    300,
                )}`,
            };
        }
        return {
            ok: true,
            data,
            message: "请求成功。",
        };
    } catch (error) {
        return {
            ok: false,
            data: null,
            message: error instanceof Error ? error.message : "PROTOCOL_PROBE_REQUEST_FAILED",
        };
    }
}

/**
 * normalizeOptionalString：把可选字符串规范化为非空字符串或 null。
 *
 * @param value 外部传入值。
 * @returns 去空白后的字符串；空值返回 null。
 */
function normalizeOptionalString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

/**
 * normalizeStringList：规范化字符串数组。
 *
 * @param value 外部请求传入的字符串数组。
 * @returns 去空并去重后的字符串数组。
 */
function normalizeStringList(value: string[]): string[] {
    return Array.from(new Set(value.map((item) => {
        return item.trim();
    }).filter((item) => {
        return item.length > 0;
    })));
}

/**
 * normalizeJsonObjectString：校验 JSON 对象字符串。
 *
 * @param value 外部传入 JSON 字符串。
 * @returns 规范化 JSON 字符串；非法时返回 null。
 */
function normalizeJsonObjectString(value: string): string | null {
    try {
        const parsed = JSON.parse(value);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
            return null;
        }
        return JSON.stringify(parsed);
    } catch {
        return null;
    }
}

/**
 * normalizeProxyMode：校验代理策略。
 *
 * @param value 外部传入代理策略。
 * @returns 支持的代理策略；非法时返回 null。
 */
function normalizeProxyMode(value: unknown): ModelProviderProxyMode | null {
    if (value === "none" || value === "use-global-default" || value === "use-specified") {
        return value;
    }

    if (value === undefined) {
        return "use-global-default";
    }

    return null;
}

/**
 * normalizePositiveIntegerOrNull：校验正整数可选字段。
 *
 * @param value 外部传入数值。
 * @returns 正整数或 null。
 */
function normalizePositiveIntegerOrNull(value: unknown): number | null {
    if (typeof value !== "number") {
        return null;
    }

    if (!Number.isInteger(value) || value <= 0) {
        return null;
    }

    return value;
}

/**
 * invalidPayload：创建统一参数错误响应。
 *
 * @param code 错误码。
 * @param displayMessage 用户可展示消息。
 * @returns 校验失败结果。
 */
function invalidPayload(
    code: string,
    displayMessage: string,
): {
    ok: false;
    error: ReturnType<typeof createErrorResponse>;
} {
    return {
        ok: false,
        error: createErrorResponse(
            code,
            displayMessage,
            displayMessage,
        ),
    };
}

/**
 * saveApiKeySecret：保存供应商 API Key 到中心服务私有 secrets.json。
 *
 * @param centerDirectory 中心目录。
 * @param providerId 供应商 ID 或创建前临时 owner。
 * @param apiKey 本次提交的 API Key。
 * @param existingSecretRef 既有引用。
 * @param updatedAt 更新时间。
 * @returns secret 引用；没有新密钥时返回既有引用。
 */
function saveApiKeySecret(
    centerDirectory: string,
    providerId: string,
    apiKey: string | undefined,
    existingSecretRef: string | null,
    updatedAt: string,
): string | null {
    if (typeof apiKey !== "string" || apiKey.length === 0) {
        return existingSecretRef;
    }

    const secretRef = existingSecretRef ?? `provider-api-key:${providerId}`;
    const config = readSecretConfig(centerDirectory);
    config.secrets[secretRef] = {
        secretKind: "provider-api-key",
        ownerId: providerId,
        value: apiKey,
        updatedAt,
    };
    writeSecretConfig(
        centerDirectory,
        config,
    );
    return secretRef;
}

/**
 * moveApiKeySecretOwner：把创建前临时 secret owner 改成真实 providerId。
 *
 * @param centerDirectory 中心目录。
 * @param temporarySecretRef 临时 secret 引用。
 * @param providerId 真实供应商 ID。
 * @param updatedAt 更新时间。
 * @returns 稳定 secret 引用。
 */
function moveApiKeySecretOwner(
    centerDirectory: string,
    temporarySecretRef: string,
    providerId: string,
    updatedAt: string,
): string {
    const config = readSecretConfig(centerDirectory);
    const temporary = config.secrets[temporarySecretRef];
    if (!temporary) {
        return temporarySecretRef;
    }

    const stableSecretRef = `provider-api-key:${providerId}`;
    delete config.secrets[temporarySecretRef];
    config.secrets[stableSecretRef] = {
        secretKind: "provider-api-key",
        ownerId: providerId,
        value: temporary.value,
        updatedAt,
    };
    writeSecretConfig(
        centerDirectory,
        config,
    );
    return stableSecretRef;
}

/**
 * resolveUpdatedApiKeySecretRef：计算更新供应商后的 API Key 引用。
 *
 * @param centerDirectory 中心目录。
 * @param body 请求体。
 * @param existing 既有供应商。
 * @param updatedAt 更新时间。
 * @returns 是否变化和新引用。
 */
function resolveUpdatedApiKeySecretRef(
    centerDirectory: string,
    body: ModelProviderSavePayload,
    existing: ModelProviderRecord,
    updatedAt: string,
): {
    changed: boolean;
    value: string | null;
} {
    if (body.clearApiKey === true) {
        if (existing.apiKeySecretRef) {
            removeSecretValue(
                centerDirectory,
                existing.apiKeySecretRef,
            );
        }
        return {
            changed: true,
            value: null,
        };
    }

    if (typeof body.apiKey === "string" && body.apiKey.length > 0) {
        return {
            changed: true,
            value: saveApiKeySecret(
                centerDirectory,
                existing.providerId,
                body.apiKey,
                existing.apiKeySecretRef,
                updatedAt,
            ),
        };
    }

    return {
        changed: false,
        value: existing.apiKeySecretRef,
    };
}

/**
 * removeSecretValue：删除中心服务私有敏感信息。
 *
 * @param centerDirectory 中心目录。
 * @param secretRef 敏感信息引用。
 * @returns 没有返回值。
 */
function removeSecretValue(
    centerDirectory: string,
    secretRef: string,
): void {
    const config = readSecretConfig(centerDirectory);
    delete config.secrets[secretRef];
    writeSecretConfig(
        centerDirectory,
        config,
    );
}

/**
 * readSecretConfig：读取中心服务私有 secrets.json。
 *
 * @param centerDirectory 中心目录。
 * @returns secrets 配置。
 */
function readSecretConfig(centerDirectory: string): SecretConfigFile {
    const secretsPath = join(centerDirectory, "config", "secrets.json");
    if (!existsSync(secretsPath)) {
        return {
            secrets: {},
        };
    }

    return JSON.parse(readFileSync(secretsPath, "utf-8")) as SecretConfigFile;
}

/**
 * writeSecretConfig：写入中心服务私有 secrets.json。
 *
 * @param centerDirectory 中心目录。
 * @param config secrets 配置。
 * @returns 没有返回值。
 */
function writeSecretConfig(
    centerDirectory: string,
    config: SecretConfigFile,
): void {
    const secretsPath = join(centerDirectory, "config", "secrets.json");
    mkdirSync(dirname(secretsPath), {
        recursive: true,
    });
    writeFileSync(
        secretsPath,
        `${JSON.stringify(config, null, 2)}\n`,
        "utf-8",
    );
}
