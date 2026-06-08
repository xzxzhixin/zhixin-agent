import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {existsSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {join} from "node:path";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import type {
    NetworkProxyConfigFile,
    ProviderCapabilityDeclaration,
    ProviderModelContextWindow,
    ProviderProxyPolicy,
    RuntimeConfigRecord,
} from "./types.js";
import {writeJsonFile} from "./helpers.js";

// DEFAULT_FETCHED_MODEL_CONTEXT_WINDOW_TOKENS: OpenAI 兼容 `/v1/models` 通常只返回模型 ID，不返回上下文窗口；需求中手填示例使用 200K，这里仅给新增模型写入可继续编辑的默认窗口。
const DEFAULT_FETCHED_MODEL_CONTEXT_WINDOW_TOKENS = 200000;

export type ModelProtocolPluginDescriptor = {
    /**
     * pluginId: 模型协议插件 ID，来源于内置插件清单。
     */
    pluginId: string;

    /**
     * pluginName: 模型协议插件显示名，供应商页用于下拉展示。
     */
    pluginName: string;

    /**
     * protocolModes: 当前协议插件支持的模式列表。
     */
    protocolModes: Array<{
        /**
         * mode: 保存到供应商配置 protocolMode 的稳定协议值。
         */
        mode: string;

        /**
         * label: 协议模式展示名。
         */
        label: string;

        /**
         * description: 协议模式说明，帮助用户选择正确接口。
         */
        description: string;
    }>;

    /**
     * defaultProtocolMode: 新建供应商时该插件的默认协议模式。
     */
    defaultProtocolMode: string;

    /**
     * defaultCapabilities: 该协议插件的默认能力声明。
     */
    defaultCapabilities: ProviderCapabilityDeclaration;
};

const OPENAI_COMPATIBLE_PROTOCOL_PLUGIN: ModelProtocolPluginDescriptor = {
    pluginId: "builtin-model-openai-compatible",
    pluginName: "OpenAI 兼容",
    protocolModes: [
        {
            mode: "chat-completions",
            label: "Chat Completions",
            description: "适用于 OpenAI 兼容 /v1/chat/completions 协议。",
        },
    ],
    defaultProtocolMode: "chat-completions",
    defaultCapabilities: {
        supportsVision: true,
        supportsToolCalling: true,
        supportsJsonOutput: true,
        supportsReasoningEffort: true,
        providesCacheUsage: true,
        supportsModelList: true,
        supportsStreaming: true,
    },
};

const REGISTERED_MODEL_PROTOCOL_PLUGINS: ModelProtocolPluginDescriptor[] = [
    OPENAI_COMPATIBLE_PROTOCOL_PLUGIN,
];

type ProviderConfigRecord = {
    providerId: string;
    providerName: string;
    protocolPluginId: string;
    protocolMode: string;
    baseUrl: string;
    apiKeySecretRef: string | null;
    defaultModel: string;
    enabled: boolean;
    capabilities: ProviderCapabilityDeclaration;
    proxyPolicy: ProviderProxyPolicy;
    updatedAt: string;
};

/**
 * listRegisteredModelProtocolPlugins：读取中心服务已注册模型协议插件。
 *
 * @returns 已注册的内置模型协议插件清单。
 */
export function listRegisteredModelProtocolPlugins(): ModelProtocolPluginDescriptor[] {
    return REGISTERED_MODEL_PROTOCOL_PLUGINS.map((plugin) => ({
        ...plugin,
        protocolModes: plugin.protocolModes.map((mode) => ({
            ...mode,
        })),
        defaultCapabilities: {
            ...plugin.defaultCapabilities,
        },
    }));
}

/**
 * resolveRegisteredModelProtocolPlugin：按插件 ID 和协议模式解析注册项。
 *
 * @param protocolPluginId 模型协议插件 ID。
 * @param protocolMode 协议模式。
 * @returns 已注册插件和模式。
 */
function resolveRegisteredModelProtocolPlugin(
    protocolPluginId: string | undefined,
    protocolMode: string | undefined,
): {
    plugin: ModelProtocolPluginDescriptor;
    protocolMode: string;
} {
    // normalizedPluginId: 保存草稿允许暂缺协议插件；中心服务保存时默认落到 OpenAI Chat Completions，启用时再要求用户显式确认完整字段。
    const normalizedPluginId = protocolPluginId && protocolPluginId.trim().length > 0
        ? protocolPluginId.trim()
        : OPENAI_COMPATIBLE_PROTOCOL_PLUGIN.pluginId;
    const plugin = REGISTERED_MODEL_PROTOCOL_PLUGINS.find((item) => item.pluginId === normalizedPluginId);
    if (!plugin) {
        throw new Error("MODEL_PROTOCOL_PLUGIN_NOT_REGISTERED");
    }

    const resolvedMode = protocolMode && protocolMode.trim().length > 0
        ? protocolMode.trim()
        : plugin.defaultProtocolMode;
    if (!plugin.protocolModes.some((item) => item.mode === resolvedMode)) {
        throw new Error("MODEL_PROTOCOL_MODE_NOT_SUPPORTED");
    }

    return {
        plugin,
        protocolMode: resolvedMode,
    };
}

/**
 * listProviderEnableMissingFields：检查供应商启用所需配置字段。
 *
 * @param input 供应商待保存或已保存配置。
 * @returns 缺失字段的中文名称列表，空数组表示可启用。
 */
export function listProviderEnableMissingFields(input: {
    providerName?: unknown;
    protocolPluginId?: unknown;
    protocolMode?: unknown;
    baseUrl?: unknown;
    defaultModel?: unknown;
    model?: unknown;
}): string[] {
    const missingFields: string[] = [];
    const requiredFields = [
        {
            label: "供应商名称",
            value: input.providerName,
        },
        {
            label: "协议插件",
            value: input.protocolPluginId,
        },
        {
            label: "协议模式",
            value: input.protocolMode,
        },
        {
            label: "Base URL",
            value: input.baseUrl,
        },
        {
            label: "默认模型",
            value: input.defaultModel ?? input.model,
        },
    ];

    for (const field of requiredFields) {
        if (typeof field.value !== "string" || field.value.trim().length === 0) {
            missingFields.push(field.label);
        }
    }

    return missingFields;
}

/**
 * assertProviderCanEnable：在领域层阻止不完整供应商启用。
 *
 * @param input 供应商待保存或已保存配置。
 * @returns 没有返回值，缺失字段时抛出业务错误。
 */
function assertProviderCanEnable(input: {
    providerName?: unknown;
    protocolPluginId?: unknown;
    protocolMode?: unknown;
    baseUrl?: unknown;
    defaultModel?: unknown;
    model?: unknown;
}): true {
    const missingFields = listProviderEnableMissingFields(input);
    if (missingFields.length > 0) {
        throw new Error(`配置不完整，无法启用：${missingFields.join("、")}`);
    }
    return true;
}

export function createProvider(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    input: {
        providerName?: string;
        protocolPluginId?: string;
        protocolMode?: string;
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        enabled?: boolean;
        capabilities?: ProviderCapabilityDeclaration;
        proxyPolicy?: ProviderProxyPolicy;
    },
): {
    providerId: string;
    hasApiKey: boolean;
} {
    const providerId = randomUUID();
    const relativePath = `providers/${providerId}.json`;
    const modelProtocol = resolveRegisteredModelProtocolPlugin(
        input.protocolPluginId,
        input.protocolMode,
    );
    // apiKeySecretRef: 中心服务私有 secret 引用；客户端只拿 hasApiKey，后续模型网关可用该引用读取明文调用供应商。
    const apiKeySecretRef = saveSecretValue(
        centerDirectory,
        "provider-api-key",
        providerId,
        input.apiKey ?? "",
        null,
    );
    const capabilities = normalizeProviderCapabilities(input.capabilities ?? modelProtocol.plugin.defaultCapabilities);
    const proxyPolicy = normalizeProviderProxyPolicy(input.proxyPolicy);
    writeJsonFile(join(centerDirectory, relativePath), {
        providerId,
        providerName: input.providerName?.trim() ?? "",
        protocolPluginId: modelProtocol.plugin.pluginId,
        protocolMode: modelProtocol.protocolMode,
        baseUrl: input.baseUrl?.trim() ?? "",
        apiKeySecretRef,
        defaultModel: input.model?.trim() ?? "",
        // enabled: 新增供应商默认先保存为停用，避免只填写 Base URL 和 API Key 的草稿因默认启用而保存失败。
        enabled: input.enabled === true ? assertProviderCanEnable(input) : false,
        capabilities,
        proxyPolicy,
        updatedAt: new Date().toISOString(),
    });
    events.append({
        eventType: "provider.created",
        scopeType: "provider",
        scopeId: providerId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "供应商创建",
        summary: input.providerName ?? providerId,
        payload: {
            providerId,
            hasApiKey: apiKeySecretRef !== null,
        },
    });
    void database;

    return {
        providerId,
        hasApiKey: apiKeySecretRef !== null,
    };
}

export function listProviderConfigs(centerDirectory: string): Array<{
    providerId: string;
    providerName: string;
    protocolPluginId: string;
    protocolMode: string;
    baseUrl: string;
    defaultModel: string;
    enabled: boolean;
    capabilities: ProviderCapabilityDeclaration;
    proxyPolicy: ProviderProxyPolicy;
    updatedAt: string;
    hasApiKey: boolean;
}> {
    const providersDirectory = join(centerDirectory, "providers");
    if (!existsSync(providersDirectory)) {
        return [];
    }

    return readdirSync(providersDirectory)
        .filter((fileName) => fileName.endsWith(".json") && !fileName.endsWith(".models.json") && !fileName.endsWith(".patch.json"))
        .map((fileName) => JSON.parse(readFileSync(join(providersDirectory, fileName), "utf-8")) as ProviderConfigRecord)
        .map((provider) => ({
            providerId: provider.providerId,
            providerName: provider.providerName,
            protocolPluginId: provider.protocolPluginId,
            protocolMode: provider.protocolMode,
            baseUrl: provider.baseUrl,
            defaultModel: provider.defaultModel,
            enabled: provider.enabled,
            capabilities: provider.capabilities,
            proxyPolicy: provider.proxyPolicy,
            updatedAt: provider.updatedAt,
            hasApiKey: typeof provider.apiKeySecretRef === "string",
        }));
}

export function updateProviderConfig(
    centerDirectory: string,
    input: {
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
    },
): {
    providerId: string | undefined;
    enabled: boolean | undefined;
    defaultModel: string | undefined;
} {
    const providerPath = join(centerDirectory, "providers", `${input.providerId}.json`);
    if (!existsSync(providerPath)) {
        throw new Error("PROVIDER_NOT_FOUND");
    }

    const existing = JSON.parse(readFileSync(providerPath, "utf-8")) as Record<string, unknown>;
    const modelProtocol = resolveRegisteredModelProtocolPlugin(
        input.protocolPluginId ?? String(existing.protocolPluginId),
        input.protocolMode ?? String(existing.protocolMode),
    );
    // apiKeySecretRef: API Key 为空表示保留既有 secret，新输入才覆盖中心服务私有值。
    const apiKeySecretRef = typeof input.apiKey === "string" && input.apiKey.length > 0
        ? saveSecretValue(
            centerDirectory,
            "provider-api-key",
            String(input.providerId),
            input.apiKey,
            typeof existing.apiKeySecretRef === "string"
                ? existing.apiKeySecretRef
                : null,
        )
        : typeof existing.apiKeySecretRef === "string"
            ? existing.apiKeySecretRef
            : null;
    const nextProvider = {
        ...existing,
        providerName: input.providerName?.trim() ?? existing.providerName,
        protocolPluginId: modelProtocol.plugin.pluginId,
        protocolMode: modelProtocol.protocolMode,
        baseUrl: input.baseUrl?.trim() ?? existing.baseUrl,
        apiKeySecretRef,
        enabled: input.enabled === true ? assertProviderCanEnable({
            ...existing,
            ...input,
            protocolPluginId: modelProtocol.plugin.pluginId,
            protocolMode: modelProtocol.protocolMode,
            defaultModel: input.defaultModel?.trim() ?? existing.defaultModel,
        }) : input.enabled ?? existing.enabled,
        defaultModel: input.defaultModel?.trim() ?? existing.defaultModel,
        capabilities: input.capabilities
            ? normalizeProviderCapabilities(input.capabilities)
            : existing.capabilities,
        proxyPolicy: input.proxyPolicy
            ? normalizeProviderProxyPolicy(input.proxyPolicy)
            : existing.proxyPolicy,
        updatedAt: new Date().toISOString(),
    };
    writeJsonFile(providerPath, {
        ...nextProvider,
    });
    return {
        providerId: input.providerId,
        enabled: input.enabled,
        defaultModel: input.defaultModel,
    };
}

export function refreshProviderModels(
    centerDirectory: string,
    providerId: string,
    models: string[],
    reasoningEfforts: string[],
    contextWindows: ProviderModelContextWindow[] = [],
): {
    providerId: string;
    models: string[];
    reasoningEfforts: string[];
    contextWindows: ProviderModelContextWindow[];
} {
    const normalizedContextWindows = normalizeProviderModelContextWindows(
        models,
        contextWindows,
    );
    writeJsonFile(join(centerDirectory, "providers", `${providerId}.models.json`), {
        providerId,
        models,
        reasoningEfforts,
        contextWindows: normalizedContextWindows,
        updatedAt: new Date().toISOString(),
    });
    return {
        providerId,
        models,
        reasoningEfforts,
        contextWindows: normalizedContextWindows,
    };
}

/**
 * readProviderModelList：读取供应商已经保存的模型列表。
 *
 * @param centerDirectory 中心目录。
 * @param providerId 供应商 ID。
 * @returns 模型列表、推理深度列表和更新时间。
 */
export function readProviderModelList(
    centerDirectory: string,
    providerId: string,
): {
    providerId: string;
    models: string[];
    reasoningEfforts: string[];
    contextWindows: ProviderModelContextWindow[];
    updatedAt: string | null;
} {
    const modelListPath = join(centerDirectory, "providers", `${providerId}.models.json`);
    if (!existsSync(modelListPath)) {
        return {
            providerId,
            models: [],
            reasoningEfforts: [],
            contextWindows: [],
            updatedAt: null,
        };
    }

    const value = JSON.parse(readFileSync(modelListPath, "utf-8")) as {
        providerId?: string;
        models?: unknown;
        reasoningEfforts?: unknown;
        contextWindows?: unknown;
        updatedAt?: unknown;
    };
    const models = Array.isArray(value.models)
        ? value.models.filter((model): model is string => typeof model === "string")
        : [];

    return {
        providerId,
        models,
        reasoningEfforts: Array.isArray(value.reasoningEfforts)
            ? value.reasoningEfforts.filter((effort): effort is string => typeof effort === "string")
            : [],
        contextWindows: normalizeProviderModelContextWindows(
            models,
            Array.isArray(value.contextWindows)
                ? value.contextWindows
                : [],
        ),
        updatedAt: typeof value.updatedAt === "string"
            ? value.updatedAt
            : null,
    };
}

/**
 * normalizeProviderModelContextWindows：规范化模型上下文窗口配置。
 *
 * @param models 当前已保存模型名称列表。
 * @param input 用户提交或文件读取到的窗口配置。
 * @returns 去重后的模型上下文窗口配置。
 */
export function normalizeProviderModelContextWindows(
    models: string[],
    input: unknown[],
): ProviderModelContextWindow[] {
    // allowedModels: 只允许为已保存模型名称记录窗口，避免孤立窗口配置污染默认模型下拉。
    const allowedModels = new Set(models);
    const normalized = new Map<string, ProviderModelContextWindow>();
    for (const item of input) {
        if (typeof item !== "object" || item === null) {
            continue;
        }
        const record = item as {
            model?: unknown;
            contextWindowTokens?: unknown;
        };
        if (typeof record.model !== "string" || !allowedModels.has(record.model)) {
            continue;
        }
        if (typeof record.contextWindowTokens !== "number" || !Number.isFinite(record.contextWindowTokens) || record.contextWindowTokens <= 0) {
            continue;
        }
        normalized.set(record.model, {
            model: record.model,
            contextWindowTokens: Math.round(record.contextWindowTokens),
        });
    }

    return [...normalized.values()];
}

/**
 * parseProviderModelsResponse：解析供应商模型列表响应。
 *
 * @param body 供应商 `/models` 原始响应文本。
 * @returns 模型名称数组。
 */
function parseProviderModelsResponse(body: string): string[] {
    const parsed = JSON.parse(body) as {
        data?: unknown;
        models?: unknown;
    };
    if (Array.isArray(parsed.data)) {
        return parsed.data.map((item) => {
            return typeof item === "object" && item !== null
                ? (item as { id?: unknown }).id
                : null;
        }).filter((model): model is string => {
            return typeof model === "string" && model.trim().length > 0;
        });
    }
    if (Array.isArray(parsed.models)) {
        return parsed.models.filter((model): model is string => {
            return typeof model === "string" && model.trim().length > 0;
        });
    }
    return [];
}

/**
 * sortProviderModelsByNumericVersion：按模型名中的数字段降序排序。
 *
 * @param models 模型名称数组。
 * @returns 去重且排序后的模型名称数组。
 */
export function sortProviderModelsByNumericVersion(models: string[]): string[] {
    const uniqueModels = Array.from(new Set(models.map((model) => {
        return model.trim();
    }).filter((model) => {
        return model.length > 0;
    })));
    return uniqueModels.sort((leftModel, rightModel) => {
        const leftParts = extractModelNumericParts(leftModel);
        const rightParts = extractModelNumericParts(rightModel);
        const maxLength = Math.max(
            leftParts.length,
            rightParts.length,
        );
        for (let index = 0; index < maxLength; index += 1) {
            const leftValue = leftParts[index] ?? 0;
            const rightValue = rightParts[index] ?? 0;
            if (leftValue !== rightValue) {
                return rightValue - leftValue;
            }
        }
        return leftModel.localeCompare(rightModel);
    });
}

/**
 * extractModelNumericParts：提取模型名全部数字段。
 *
 * @param model 模型名称。
 * @returns 数字段数组。
 */
function extractModelNumericParts(model: string): number[] {
    const matches = model.match(/\d+(?:\.\d+)?/gu) ?? [];
    return matches.flatMap((part) => {
        return part.split(".").map((value) => Number(value));
    }).filter((value) => {
        return Number.isFinite(value);
    });
}

/**
 * normalizeProviderCapabilities：规范化供应商能力声明。
 *
 * @param input 外部传入的能力声明。
 * @returns 完整能力声明。
 */
export function normalizeProviderCapabilities(input?: Partial<ProviderCapabilityDeclaration>): ProviderCapabilityDeclaration {
    return {
        supportsVision: input?.supportsVision ?? false,
        supportsToolCalling: input?.supportsToolCalling ?? false,
        supportsJsonOutput: input?.supportsJsonOutput ?? false,
        supportsReasoningEffort: input?.supportsReasoningEffort ?? false,
        providesCacheUsage: input?.providesCacheUsage ?? false,
        supportsModelList: input?.supportsModelList ?? false,
        supportsStreaming: input?.supportsStreaming ?? false,
    };
}

/**
 * normalizeProviderProxyPolicy：规范化供应商代理策略。
 *
 * @param input 外部传入的代理策略。
 * @returns 完整代理策略。
 */
export function normalizeProviderProxyPolicy(input?: Partial<ProviderProxyPolicy>): ProviderProxyPolicy {
    if (input?.mode === "none") {
        return {
            mode: "none",
            proxyId: null,
        };
    }

    if (input?.mode === "use-specified") {
        return {
            mode: "use-specified",
            proxyId: input.proxyId ?? null,
        };
    }

    return {
        mode: "use-global-default",
        proxyId: null,
    };
}

/**
 * SecretConfigFile：中心服务私有敏感信息文件结构。
 *
 * 来源：中心目录 `config/secrets.json`。
 * 含义：保存中心服务后续调用供应商或代理所需明文，客户端列表只拿引用状态。
 * 格式：按 secretRef 索引的 JSON 对象。
 * 默认值：文件不存在时 secrets 为空对象。
 * 约束：该文件只能由中心服务本机使用，任何 list 接口都不能返回 value。
 */
interface SecretConfigFile {
    /**
     * secrets: secretRef 到敏感值记录的映射。
     */
    secrets: Record<string, {
        /**
         * secretKind: 敏感信息类型，用于区分供应商 API Key 和代理密码。
         */
        secretKind: "provider-api-key" | "proxy-password";

        /**
         * ownerId: 关联实体 ID，例如 providerId 或 proxyId。
         */
        ownerId: string;

        /**
         * value: 中心服务调用外部供应商或代理时使用的明文值。
         */
        value: string;

        /**
         * updatedAt: 更新时间，ISO 字符串。
         */
        updatedAt: string;
    }>;
}

/**
 * saveSecretValue：保存中心服务私有敏感信息并返回引用。
 *
 * @param centerDirectory 中心目录。
 * @param secretKind 敏感信息类型。
 * @param ownerId 关联实体 ID。
 * @param value 本次提交的敏感明文。
 * @param existingSecretRef 既有 secret 引用，存在时覆盖原记录。
 * @returns secret 引用；空值表示未配置敏感信息。
 */
export function saveSecretValue(
    centerDirectory: string,
    secretKind: "provider-api-key" | "proxy-password",
    ownerId: string,
    value: string,
    existingSecretRef: string | null,
): string | null {
    if (value.length === 0) {
        return existingSecretRef;
    }

    // secretsPath: 所有低频敏感配置统一放在 config 下，符合中心服务本地 JSON 边界。
    const secretsPath = join(centerDirectory, "config", "secrets.json");
    const config = readJsonFileIfExists<SecretConfigFile>(secretsPath) ?? {
        secrets: {},
    };
    const secretRef = existingSecretRef ?? `${secretKind}:${ownerId}`;
    config.secrets[secretRef] = {
        secretKind,
        ownerId,
        value,
        updatedAt: new Date().toISOString(),
    };
    writeJsonFile(secretsPath, config);
    return secretRef;
}

export function saveProxyConfig(
    centerDirectory: string,
    input: {
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
    },
): {
    proxyId: string;
    hasAuth: boolean;
} {
    // proxyId: 修改时沿用既有 ID，新增时由中心服务生成，避免前端猜测实体身份。
    const proxyId = input.proxyId ?? randomUUID();
    // existing: 修改代理且密码为空时保留既有 secret 引用，因为空值在 UI 中表示“不修改已保存密码”。
    const existing = readJsonFileIfExists<NetworkProxyConfigFile>(join(centerDirectory, "config", `proxy-${proxyId}.json`));
    if (input.clearAuth && existing?.passwordSecretRef) {
        removeSecretValue(
            centerDirectory,
            existing.passwordSecretRef,
        );
    }
    // normalizedUsername: 空字符串是无认证代理的明确协议值，不通过候选字段猜测认证状态。
    const normalizedUsername = input.username?.trim() ?? "";
    // existingSecretRef: 只有用户明确清除认证时才移除既有 secret，避免脱敏编辑误删密码。
    const existingSecretRef = input.clearAuth
        ? null
        : existing?.passwordSecretRef ?? null;
    // passwordSecretRef: 只有用户提交非空密码时才更新中心服务私有明文；客户端永不回显引用或明文。
    const passwordSecretRef = saveSecretValue(
        centerDirectory,
        "proxy-password",
        proxyId,
        input.password ?? "",
        existingSecretRef,
    );
    writeJsonFile(join(centerDirectory, "config", `proxy-${proxyId}.json`), {
        proxyId,
        proxyName: input.proxyName,
        protocol: input.protocol,
        host: input.host,
        port: input.port,
        username: normalizedUsername,
        passwordSecretRef,
        enabled: input.enabled ?? true,
        note: input.note ?? "",
        updatedAt: new Date().toISOString(),
    });
    return {
        proxyId,
        hasAuth: Boolean(normalizedUsername || passwordSecretRef),
    };
}

/**
 * fetchProviderModelsFromUpstream：从供应商上游模型列表接口获取并保存模型。
 *
 * @param centerDirectory 中心目录。
 * @param providerId 供应商 ID。
 * @returns 已排序并保存的模型列表。
 */
export function fetchProviderModelsFromUpstream(
    centerDirectory: string,
    providerId: string,
): {
    providerId: string;
    models: string[];
    reasoningEfforts: string[];
    contextWindows: ProviderModelContextWindow[];
} {
    const provider = readProviderConfig(centerDirectory, providerId);
    if (!provider) {
        throw new Error("PROVIDER_NOT_FOUND");
    }
    if (provider.protocolPluginId !== "builtin-model-openai-compatible") {
        throw new Error("PROVIDER_MODEL_FETCH_UNSUPPORTED");
    }

    const apiKey = readSecretValue(
        centerDirectory,
        provider.apiKeySecretRef,
    );
    const response = executeProviderGetSync(
        joinProviderEndpoint(provider.baseUrl, "/v1/models"),
        apiKey,
    );
    if (!response.ok) {
        throw new Error(`PROVIDER_MODEL_FETCH_FAILED:${response.status}:${response.body.slice(0, 240)}`);
    }

    const existingModelList = readProviderModelList(centerDirectory, providerId);
    // existingContextWindowByModel: 获取上游模型只刷新模型 ID 顺序；已有手填窗口是用户维护事实，不能被默认值覆盖。
    const existingContextWindowByModel = new Map(existingModelList.contextWindows.map((item) => {
        return [
            item.model,
            item.contextWindowTokens,
        ];
    }));
    const models = sortProviderModelsByNumericVersion(parseProviderModelsResponse(response.body));
    return refreshProviderModels(
        centerDirectory,
        providerId,
        models,
        existingModelList.reasoningEfforts,
        models.map((model) => {
            return {
                model,
                // contextWindowTokens: 既有模型沿用用户已保存窗口；上游新增模型因 `/models` 无窗口字段，按需求示例默认 200K 后允许用户在弹框继续修改。
                contextWindowTokens: existingContextWindowByModel.get(model) ?? DEFAULT_FETCHED_MODEL_CONTEXT_WINDOW_TOKENS,
            };
        }),
    );
}

/**
 * listProxyConfigs：读取代理配置列表并隐藏密码摘要。
 *
 * @param centerDirectory 中心目录。
 * @returns 可展示代理配置数组。
 */
export function listProxyConfigs(centerDirectory: string): Array<Omit<NetworkProxyConfigFile, "passwordSecretRef"> & {
    hasAuth: boolean;
}> {
    const configDirectory = join(centerDirectory, "config");
    if (!existsSync(configDirectory)) {
        return [];
    }

    return readdirSync(configDirectory)
        .filter((fileName) => {
            return fileName.startsWith("proxy-") && fileName.endsWith(".json");
        })
        .map((fileName) => readJsonFileIfExists<NetworkProxyConfigFile>(join(configDirectory, fileName)))
        .filter((proxy): proxy is NetworkProxyConfigFile => {
            return proxy !== null;
        })
        .map((proxy) => ({
            proxyId: proxy.proxyId,
            proxyName: proxy.proxyName,
            protocol: proxy.protocol,
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            enabled: proxy.enabled,
            note: proxy.note ?? "",
            updatedAt: proxy.updatedAt,
            hasAuth: Boolean(proxy.username || proxy.passwordSecretRef),
        }));
}

/**
 * removeSecretValue：删除中心服务私有敏感信息引用。
 *
 * @param centerDirectory 中心目录。
 * @param secretRef 需要删除的敏感信息引用。
 * @returns 没有返回值。
 */
function removeSecretValue(
    centerDirectory: string,
    secretRef: string,
): void {
    // secretsPath: 只处理中心服务私有 secrets.json，不触碰代理配置文件本身。
    const secretsPath = join(centerDirectory, "config", "secrets.json");
    const config = readJsonFileIfExists<SecretConfigFile>(secretsPath);
    if (!config) {
        return;
    }
    delete config.secrets[secretRef];
    writeJsonFile(secretsPath, config);
}

/**
 * readGlobalDefaultProxyId：读取全局默认代理 ID。
 *
 * @param centerDirectory 中心目录。
 * @returns 默认代理 ID；未设置时返回 null。
 */
export function readGlobalDefaultProxyId(centerDirectory: string): string | null {
    const config = readJsonFileIfExists<{
        defaultProxyId: string | null
    }>(join(centerDirectory, "config", "proxy-default.json"));
    return config?.defaultProxyId ?? null;
}

/**
 * setGlobalDefaultProxy：保存全局默认代理 ID。
 *
 * @param centerDirectory 中心目录。
 * @param proxyId 代理 ID，null 表示不使用全局默认代理。
 * @returns 保存后的默认代理 ID。
 */
export function setGlobalDefaultProxy(centerDirectory: string, proxyId: string | null): {
    defaultProxyId: string | null;
} {
    writeJsonFile(join(centerDirectory, "config", "proxy-default.json"), {
        defaultProxyId: proxyId,
        updatedAt: new Date().toISOString(),
    });
    return {
        defaultProxyId: proxyId,
    };
}

/**
 * deleteProxyConfig：删除代理配置文件并清理默认代理指向。
 *
 * @param centerDirectory 中心目录。
 * @param proxyId 代理 ID。
 * @returns 删除结果。
 */
export function deleteProxyConfig(centerDirectory: string, proxyId: string): {
    proxyId: string;
    deleted: boolean;
} {
    const proxyPath = join(centerDirectory, "config", `proxy-${proxyId}.json`);
    if (existsSync(proxyPath)) {
        rmSync(proxyPath, {
            force: true,
        });
    }
    if (readGlobalDefaultProxyId(centerDirectory) === proxyId) {
        setGlobalDefaultProxy(centerDirectory, null);
    }
    return {
        proxyId,
        deleted: true,
    };
}

/**
 * saveRuntimeConfig：保存运行环境配置，同类型默认环境保持唯一。
 *
 * @param centerDirectory 中心目录。
 * @param input 运行环境表单。
 * @returns 运行环境 ID 和默认状态。
 */
export function saveRuntimeConfig(
    centerDirectory: string,
    input: {
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
    },
): {
    runtimeId: string;
    isDefault: boolean;
} {
    const runtimeId = input.runtimeId ?? randomUUID();
    const runtimeDirectory = join(centerDirectory, "runtimes");
    if (input.isDefault && input.runtimeType) {
        clearDefaultRuntimeByType(runtimeDirectory, input.runtimeType, runtimeId);
    }
    writeJsonFile(join(runtimeDirectory, `${runtimeId}.json`), {
        runtimeId,
        runtimeName: input.runtimeName,
        runtimeType: input.runtimeType,
        executablePath: input.executablePath,
        rootPath: input.rootPath,
        version: input.version ?? "",
        environmentVariables: input.environmentVariables ?? {},
        pathEntries: input.pathEntries ?? [],
        isDefault: input.isDefault ?? false,
        enabled: input.enabled ?? true,
        note: input.note ?? "",
        updatedAt: new Date().toISOString(),
    });
    return {
        runtimeId,
        isDefault: input.isDefault ?? false,
    };
}

/**
 * listRuntimeConfigs：读取运行环境配置列表。
 *
 * @param centerDirectory 中心目录。
 * @returns 运行环境配置数组。
 */
export function listRuntimeConfigs(centerDirectory: string): RuntimeConfigRecord[] {
    const runtimeDirectory = join(centerDirectory, "runtimes");
    if (!existsSync(runtimeDirectory)) {
        return [];
    }

    return readdirSync(runtimeDirectory)
        .filter((fileName) => {
            return fileName.endsWith(".json");
        })
        .map((fileName) => readJsonFileIfExists<RuntimeConfigRecord>(join(runtimeDirectory, fileName)))
        .filter((runtime): runtime is RuntimeConfigRecord => {
            return runtime !== null;
        });
}

/**
 * deleteRuntimeConfig：删除运行环境配置。
 *
 * @param centerDirectory 中心目录。
 * @param runtimeId 运行环境 ID。
 * @returns 删除结果。
 */
export function deleteRuntimeConfig(centerDirectory: string, runtimeId: string): {
    runtimeId: string;
    deleted: boolean;
} {
    rmSync(join(centerDirectory, "runtimes", `${runtimeId}.json`), {
        force: true,
    });
    return {
        runtimeId,
        deleted: true,
    };
}

/**
 * readJsonFileIfExists：读取可选 JSON 文件。
 *
 * @param filePath JSON 文件绝对路径。
 * @returns 文件存在且可解析时返回对象；不存在时返回 null。
 */
export function readJsonFileIfExists<TValue>(filePath: string): TValue | null {
    if (!existsSync(filePath)) {
        return null;
    }

    return JSON.parse(readFileSync(filePath, "utf-8")) as TValue;
}

/**
 * clearDefaultRuntimeByType：设置默认环境前清理同类型其他默认项。
 *
 * @param runtimeDirectory 运行环境目录。
 * @param runtimeType 运行环境类型。
 * @param keepRuntimeId 当前保存的运行环境 ID。
 * @returns 没有返回值。
 */
export function clearDefaultRuntimeByType(
    runtimeDirectory: string,
    runtimeType: string,
    keepRuntimeId: string,
): void {
    if (!existsSync(runtimeDirectory)) {
        return;
    }

    for (const fileName of readdirSync(runtimeDirectory)) {
        const runtimePath = join(runtimeDirectory, fileName);
        const runtime = readJsonFileIfExists<RuntimeConfigRecord>(runtimePath);
        if (runtime?.runtimeType === runtimeType && runtime.runtimeId !== keepRuntimeId && runtime.isDefault) {
            writeJsonFile(runtimePath, {
                ...runtime,
                isDefault: false,
                updatedAt: new Date().toISOString(),
            });
        }
    }
}

export function prepareModelGatewayRequest(
    request: unknown,
    protocolMode: "chat-completions",
): {
    protocolMode: string;
    request: unknown;
} {
    return {
        protocolMode,
        request,
    };
}

/**
 * readSecretValue：读取中心服务敏感信息明文。
 *
 * @param centerDirectory 中心目录。
 * @param secretRef 敏感信息引用。
 * @returns 找到时返回明文，找不到时返回 null。
 */
export function readSecretValue(centerDirectory: string, secretRef: string | null): string | null {
    if (!secretRef) {
        return null;
    }

    const secretsPath = join(centerDirectory, "config", "secrets.json");
    const config = readJsonFileIfExists<SecretConfigFile>(secretsPath);
    const secret = config?.secrets[secretRef];
    return secret?.value ?? null;
}

/**
 * joinProviderEndpoint：拼接供应商 baseUrl 和接口路径。
 *
 * @param baseUrl 用户配置的基础地址。
 * @param endpoint 协议接口路径。
 * @returns 完整请求地址。
 */
function joinProviderEndpoint(
    baseUrl: string,
    endpoint: string,
): string {
    const normalizedBaseUrl = baseUrl.replace(/\/$/u, "");
    if (normalizedBaseUrl.endsWith("/v1") && endpoint.startsWith("/v1/")) {
        return `${normalizedBaseUrl}${endpoint.slice(3)}`;
    }
    return `${normalizedBaseUrl}${endpoint}`;
}

/**
 * executeProviderGetSync：同步请求供应商 GET 接口。
 *
 * @param url 请求地址。
 * @param apiKey 供应商 API Key 明文，未配置时为 null。
 * @returns HTTP 状态和响应文本。
 */
function executeProviderGetSync(
    url: string,
    apiKey: string | null,
): {
    ok: boolean;
    status: number;
    body: string;
} {
    // script: 中心服务现有模型调用使用同步子进程 fetch；模型获取沿用该方式，避免改造路由异步边界。
    const script = [
        "const input = JSON.parse(process.argv[1]);",
        "(async () => {",
        "const response = await fetch(input.url, {method: 'GET', headers: input.headers});",
        "const body = await response.text();",
        "process.stdout.write(JSON.stringify({status: response.status, ok: response.ok, body}));",
        "})().catch((error) => {",
        "process.stdout.write(JSON.stringify({status: 0, ok: false, body: error && error.message ? error.message : 'FETCH_FAILED'}));",
        "process.exitCode = 1;",
        "});",
    ].join("");
    const output = spawnSync(
        process.execPath,
        [
            "-e",
            script,
            JSON.stringify({
                url,
                headers: {
                    ...(apiKey
                        ? {
                            authorization: `Bearer ${apiKey}`,
                        }
                        : {}),
                },
            }),
        ],
        {
            encoding: "utf-8",
            windowsHide: true,
        },
    );
    const parsed = JSON.parse(output.stdout || "{\"status\":0,\"ok\":false,\"body\":\"FETCH_OUTPUT_EMPTY\"}") as {
        ok: boolean;
        status: number;
        body: string;
    };
    if (output.status !== 0 && parsed.status === 0) {
        throw new Error(`PROVIDER_MODEL_FETCH_CONNECT_FAILED:${parsed.body}`);
    }
    return parsed;
}

/**
 * readProviderConfig：读取供应商配置。
 *
 * @param centerDirectory 中心目录。
 * @param providerId 供应商 ID。
 * @returns 供应商配置，未找到时返回 null。
 */
export function readProviderConfig(centerDirectory: string, providerId: string): ProviderConfigRecord | null {
    const providerPath = join(centerDirectory, "providers", `${providerId}.json`);
    if (!existsSync(providerPath)) {
        return null;
    }

    return JSON.parse(readFileSync(providerPath, "utf-8")) as ProviderConfigRecord;
}

/**
 * classifyModelGatewayError：把模型调用失败阶段归类为统一错误类型。
 *
 * @param failureStage 失败阶段，来源于代理连接、供应商调用或协议解析链路。
 * @param statusCode HTTP 状态码；没有 HTTP 响应时为 null。
 * @param message 原始错误消息，不能包含敏感信息。
 * @returns 统一模型网关错误分类。
 */
export function classifyModelGatewayError(
    failureStage: string,
    statusCode: number | null,
    message: string,
): {
    errorKind: string;
    displayMessage: string;
    statusCode: number | null;
    originalMessage: string;
} {
    // normalizedStage: 调用方使用固定阶段名，避免前端自己猜测错误类型。
    const normalizedStage = failureStage.trim().toLowerCase();

    if (normalizedStage === "proxy-connect") {
        return {
            errorKind: "proxy-connect-failed",
            displayMessage: "网络代理连接失败。",
            statusCode,
            originalMessage: message,
        };
    }

    if (normalizedStage === "proxy-auth" || statusCode === 407) {
        return {
            errorKind: "proxy-auth-failed",
            displayMessage: "网络代理认证失败。",
            statusCode,
            originalMessage: message,
        };
    }

    if (normalizedStage === "provider-connect") {
        return {
            errorKind: "provider-connect-failed",
            displayMessage: "供应商连接失败。",
            statusCode,
            originalMessage: message,
        };
    }

    if (normalizedStage === "provider-response") {
        return {
            errorKind: "provider-api-failed",
            displayMessage: "供应商接口返回失败。",
            statusCode,
            originalMessage: message,
        };
    }

    return {
        errorKind: "protocol-parse-failed",
        displayMessage: "模型协议解析失败。",
        statusCode,
        originalMessage: message,
    };
}

/**
 * resolveProviderModelSelection：从供应商列表与会话草稿中确定发送模型。
 *
 * @param centerDirectory 中心目录。
 * @param providerId 供应商 ID。
 * @param preferredModel 优先模型名称，允许为空。
 * @returns 解析后的供应商、模型和推理深度。
 */
export function resolveProviderModelSelection(
    centerDirectory: string,
    providerId: string,
    preferredModel: string | null,
): {
    provider: ProviderConfigRecord;
    model: string;
    reasoningEffort: string | null;
} {
    const provider = readProviderConfig(centerDirectory, providerId);
    if (!provider || !provider.enabled) {
        throw new Error("PROVIDER_NOT_AVAILABLE");
    }

    const modelList = readProviderModelList(centerDirectory, providerId);
    const trimmedPreferredModel = preferredModel?.trim() ?? "";
    // model: 已刷新模型列表是供应商当前可用模型事实源；默认模型过期时必须回退到列表首项，避免继续请求不可用模型。
    const model = modelList.models.length > 0
        ? modelList.models.includes(trimmedPreferredModel)
            ? trimmedPreferredModel
            : modelList.models[0]
        : trimmedPreferredModel || provider.defaultModel;
    if (!model) {
        throw new Error("PROVIDER_MODEL_REQUIRED");
    }

    const reasoningEffort = modelList.reasoningEfforts[0] ?? null;
    return {
        provider,
        model,
        reasoningEffort,
    };
}
