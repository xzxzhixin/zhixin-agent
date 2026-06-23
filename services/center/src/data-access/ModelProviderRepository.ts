import {randomUUID} from "node:crypto";

import type {CenterDatabase} from "../database.js";

/** ModelProviderSource：数据库保存的模型来源枚举，只表达业务来源，不保存 AI SDK 包名。 */
export type ModelProviderSource =
    | "openai"
    | "anthropic"
    | "google"
    | "deepseek"
    | "qwen"
    | "openrouter"
    | "codex"
    | "openai-compatible-custom";

/** ModelProviderProxyMode：供应商访问代理策略，来源于供应商配置表单。 */
export type ModelProviderProxyMode = "none" | "use-global-default" | "use-specified";

/** ModelProviderCapabilityRecord：供应商能力声明记录，来源于 model_provider_capabilities 表。 */
export interface ModelProviderCapabilityRecord {
    /** providerId: 所属供应商 ID。 */
    providerId: string;
    /** supportsVision: 是否支持视觉输入。 */
    supportsVision: boolean;
    /** supportsToolCalling: 是否支持结构化工具调用。 */
    supportsToolCalling: boolean;
    /** supportsJsonOutput: 是否支持 JSON 输出模式。 */
    supportsJsonOutput: boolean;
    /** supportsReasoningEffort: 是否支持推理深度。 */
    supportsReasoningEffort: boolean;
    /** supportsModelList: 是否支持模型列表接口。 */
    supportsModelList: boolean;
    /** supportsStreaming: 是否支持流式输出。 */
    supportsStreaming: boolean;
    /** providesCacheUsage: 是否提供缓存用量字段。 */
    providesCacheUsage: boolean;
    /** updatedAt: 能力声明更新时间，中心服务本机时间。 */
    updatedAt: string;
}

/** ModelProviderSettingsRecord：供应商默认调用设置，来源于 model_provider_settings 表。 */
export interface ModelProviderSettingsRecord {
    /** providerId: 所属供应商 ID。 */
    providerId: string;
    /** defaultModelName: 默认模型名；未配置时为 null。 */
    defaultModelName: string | null;
    /** reasoningEffort: 推理深度；未配置时为 null。 */
    reasoningEffort: string | null;
    /** temperature: 温度参数；未配置时为 null。 */
    temperature: number | null;
    /** maxOutputTokens: 最大输出 token；未配置时为 null。 */
    maxOutputTokens: number | null;
    /** extraJson: 保留扩展设置 JSON 字符串，只保存业务扩展字段。 */
    extraJson: string;
    /** updatedAt: 设置更新时间，中心服务本机时间。 */
    updatedAt: string;
}

/** ModelProviderModelRecord：供应商模型记录，来源于 model_provider_models 表。 */
export interface ModelProviderModelRecord {
    /** modelId: 模型记录 ID。 */
    modelId: string;
    /** providerId: 所属供应商 ID。 */
    providerId: string;
    /** modelName: 供应商模型真实名称。 */
    modelName: string;
    /** displayName: UI 展示名。 */
    displayName: string;
    /** contextWindowTokens: 上下文窗口 token 数；未知时为 null。 */
    contextWindowTokens: number | null;
    /** enabled: 是否启用该模型。 */
    enabled: boolean;
    /** sortOrder: 同一供应商模型排序值。 */
    sortOrder: number;
    /** createdAt: 创建时间，中心服务本机时间。 */
    createdAt: string;
    /** updatedAt: 更新时间，中心服务本机时间。 */
    updatedAt: string;
}

/** ModelProviderCheckRecord：供应商检测结果记录，来源于 model_provider_checks 表。 */
export interface ModelProviderCheckRecord {
    /** checkId: 检测记录 ID。 */
    checkId: string;
    /** providerId: 所属供应商 ID。 */
    providerId: string;
    /** checkType: 检测类型，例如 local-config。 */
    checkType: string;
    /** status: 检测状态。 */
    status: "passed" | "failed";
    /** errorMessage: 失败原因；成功时为 null。 */
    errorMessage: string | null;
    /** checkedAt: 检测时间，中心服务本机时间。 */
    checkedAt: string;
}

/** ModelProviderRecord：供应商完整展示记录，聚合供应商、设置、能力、模型和最近检测。 */
export interface ModelProviderRecord {
    /** providerId: 供应商 ID。 */
    providerId: string;
    /** providerName: 供应商名称。 */
    providerName: string;
    /** providerSource: 模型来源枚举。 */
    providerSource: ModelProviderSource;
    /** apiBaseUrl: 接口基础地址；未配置时为 null。 */
    apiBaseUrl: string | null;
    /** apiKeySecretRef: API Key 私有引用；API 响应不得返回该字段。 */
    apiKeySecretRef: string | null;
    /** customHeadersJson: 自定义请求头 JSON 字符串。 */
    customHeadersJson: string;
    /** proxyMode: 代理策略。 */
    proxyMode: ModelProviderProxyMode;
    /** proxyId: 指定代理 ID；未指定时为 null。 */
    proxyId: string | null;
    /** enabled: 是否启用供应商。 */
    enabled: boolean;
    /** createdAt: 创建时间，中心服务本机时间。 */
    createdAt: string;
    /** updatedAt: 更新时间，中心服务本机时间。 */
    updatedAt: string;
    /** settings: 默认调用设置。 */
    settings: ModelProviderSettingsRecord;
    /** capabilities: 能力声明。 */
    capabilities: ModelProviderCapabilityRecord;
    /** models: 模型列表。 */
    models: ModelProviderModelRecord[];
    /** latestCheck: 最近一次检测结果。 */
    latestCheck: ModelProviderCheckRecord | null;
}

/** CreateModelProviderInput：创建供应商入参，来源于 /api/model-provider/create。 */
export interface CreateModelProviderInput {
    /** providerName: 供应商名称。 */
    providerName: string;
    /** providerSource: 模型来源。 */
    providerSource: ModelProviderSource;
    /** apiBaseUrl: 接口基础地址。 */
    apiBaseUrl: string | null;
    /** apiKeySecretRef: API Key 私有引用。 */
    apiKeySecretRef: string | null;
    /** customHeadersJson: 自定义请求头 JSON 字符串。 */
    customHeadersJson: string;
    /** proxyMode: 代理策略。 */
    proxyMode: ModelProviderProxyMode;
    /** proxyId: 指定代理 ID。 */
    proxyId: string | null;
    /** enabled: 是否启用。 */
    enabled: boolean;
    /** defaultModelName: 默认模型。 */
    defaultModelName: string | null;
    /** reasoningEffort: 推理深度。 */
    reasoningEffort: string | null;
    /** temperature: 温度参数。 */
    temperature: number | null;
    /** maxOutputTokens: 最大输出 token。 */
    maxOutputTokens: number | null;
    /** extraJson: 扩展设置 JSON。 */
    extraJson: string;
    /** capabilities: 能力声明。 */
    capabilities: Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt">;
    /** now: 中心服务本机时间字符串。 */
    now: string;
}

/** UpdateModelProviderInput：更新供应商入参，未传字段表示不修改。 */
export interface UpdateModelProviderInput extends Partial<Omit<CreateModelProviderInput, "now" | "capabilities">> {
    /** providerId: 要更新的供应商 ID。 */
    providerId: string;
    /** apiKeySecretRef: API Key 私有引用，undefined 表示不修改，null 表示清空。 */
    apiKeySecretRef?: string | null;
    /** capabilities: 能力声明，未传时不修改。 */
    capabilities?: Partial<Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt">>;
    /** now: 中心服务本机时间字符串。 */
    now: string;
}

/** SaveModelProviderModelsInput：保存模型列表入参。 */
export interface SaveModelProviderModelsInput {
    /** providerId: 所属供应商 ID。 */
    providerId: string;
    /** models: 要保存的模型列表。 */
    models: Array<{
        /** modelName: 模型真实名称。 */
        modelName: string;
        /** displayName: UI 展示名。 */
        displayName: string;
        /** contextWindowTokens: 上下文窗口 token 数。 */
        contextWindowTokens: number | null;
        /** enabled: 是否启用。 */
        enabled: boolean;
        /** sortOrder: 排序值。 */
        sortOrder: number;
    }>;
    /** defaultModelName: 同步更新的默认模型；未传时不修改设置。 */
    defaultModelName?: string | null;
    /** now: 中心服务本机时间字符串。 */
    now: string;
}

/** AppendModelProviderCheckInput：追加检测结果入参。 */
export interface AppendModelProviderCheckInput {
    /** providerId: 所属供应商 ID。 */
    providerId: string;
    /** checkType: 检测类型。 */
    checkType: string;
    /** status: 检测状态。 */
    status: "passed" | "failed";
    /** errorMessage: 失败原因。 */
    errorMessage: string | null;
    /** checkedAt: 检测时间，中心服务本机时间。 */
    checkedAt: string;
}

/** ModelProviderRuntimeRecord：运行时读取供应商配置的聚合记录。 */
export interface ModelProviderRuntimeRecord extends ModelProviderRecord {
    /** defaultModel: 已解析出的默认模型记录。 */
    defaultModel: ModelProviderModelRecord | null;
}

interface ModelProviderTableRow {
    providerId: string;
    providerName: string;
    providerSource: ModelProviderSource;
    apiBaseUrl: string | null;
    apiKeySecretRef: string | null;
    customHeadersJson: string;
    proxyMode: ModelProviderProxyMode;
    proxyId: string | null;
    enabled: number;
    createdAt: string;
    updatedAt: string;
}

interface ModelProviderSettingsTableRow {
    providerId: string;
    defaultModelName: string | null;
    reasoningEffort: string | null;
    temperature: number | null;
    maxOutputTokens: number | null;
    extraJson: string;
    updatedAt: string;
}

interface ModelProviderCapabilityTableRow {
    providerId: string;
    supportsVision: number;
    supportsToolCalling: number;
    supportsJsonOutput: number;
    supportsReasoningEffort: number;
    supportsModelList: number;
    supportsStreaming: number;
    providesCacheUsage: number;
    updatedAt: string;
}

interface ModelProviderModelTableRow {
    modelId: string;
    providerId: string;
    modelName: string;
    displayName: string;
    contextWindowTokens: number | null;
    enabled: number;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

interface ModelProviderCheckTableRow {
    checkId: string;
    providerId: string;
    checkType: string;
    status: "passed" | "failed";
    errorMessage: string | null;
    checkedAt: string;
}

/**
 * ModelProviderRepository：模型供应商 SQLite 仓储。
 *
 * 用途：集中维护 model_provider 相关表的 SQL，避免 API 和运行时直接写 SQL。
 * 关键逻辑：数据库只保存业务事实，不保存 AI SDK 包名、运行时实现名或历史协议字段。
 */
export class ModelProviderRepository {
    /** database: 中心服务主进程持有的数据库连接包装。 */
    private readonly database: CenterDatabase;

    /**
     * constructor：保存中心服务数据库包装。
     *
     * @param database 中心服务数据库。
     */
    constructor(database: CenterDatabase) {
        this.database = database;
    }

    /**
     * listProviders：读取全部供应商展示记录。
     *
     * @returns 供应商展示记录数组。
     */
    listProviders(): ModelProviderRecord[] {
        const rows = this.database.connection()
            .prepare(`
                SELECT provider_id          AS providerId,
                       provider_name        AS providerName,
                       provider_source      AS providerSource,
                       api_base_url         AS apiBaseUrl,
                       api_key_secret_ref   AS apiKeySecretRef,
                       custom_headers_json  AS customHeadersJson,
                       proxy_mode           AS proxyMode,
                       proxy_id             AS proxyId,
                       enabled,
                       created_at           AS createdAt,
                       updated_at           AS updatedAt
                FROM model_providers
                ORDER BY updated_at DESC,
                         provider_name ASC
            `)
            .all() as ModelProviderTableRow[];

        return rows.map((row) => {
            return this.mapProviderRow(row);
        });
    }

    /**
     * createProvider：创建供应商和默认设置、能力声明。
     *
     * @param input 创建供应商字段。
     * @returns 创建后的供应商记录。
     */
    createProvider(input: CreateModelProviderInput): ModelProviderRecord {
        const providerId = randomUUID();
        const transaction = this.database.connection().transaction(() => {
            this.database.connection()
                .prepare(`
                    INSERT INTO model_providers (
                        provider_id,
                        provider_name,
                        provider_source,
                        api_base_url,
                        api_key_secret_ref,
                        custom_headers_json,
                        proxy_mode,
                        proxy_id,
                        enabled,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `)
                .run(
                    providerId,
                    input.providerName,
                    input.providerSource,
                    input.apiBaseUrl,
                    input.apiKeySecretRef,
                    input.customHeadersJson,
                    input.proxyMode,
                    input.proxyId,
                    input.enabled ? 1 : 0,
                    input.now,
                    input.now,
                );
            this.upsertSettings(
                providerId,
                {
                    defaultModelName: input.defaultModelName,
                    reasoningEffort: input.reasoningEffort,
                    temperature: input.temperature,
                    maxOutputTokens: input.maxOutputTokens,
                    extraJson: input.extraJson,
                    updatedAt: input.now,
                },
            );
            this.upsertCapabilities(
                providerId,
                input.capabilities,
                input.now,
            );
        });
        transaction();

        return this.requireProvider(providerId);
    }

    /**
     * updateProvider：按明确字段更新供应商、设置和能力。
     *
     * @param input 更新字段。
     * @returns 更新后的供应商记录。
     */
    updateProvider(input: UpdateModelProviderInput): ModelProviderRecord {
        const existing = this.requireProvider(input.providerId);
        const providerName = input.providerName ?? existing.providerName;
        const providerSource = input.providerSource ?? existing.providerSource;
        const apiBaseUrl = input.apiBaseUrl === undefined ? existing.apiBaseUrl : input.apiBaseUrl;
        const apiKeySecretRef = input.apiKeySecretRef === undefined ? existing.apiKeySecretRef : input.apiKeySecretRef;
        const customHeadersJson = input.customHeadersJson ?? existing.customHeadersJson;
        const proxyMode = input.proxyMode ?? existing.proxyMode;
        const proxyId = input.proxyId === undefined ? existing.proxyId : input.proxyId;
        const enabled = input.enabled ?? existing.enabled;

        const settings = {
            defaultModelName: input.defaultModelName === undefined
                ? existing.settings.defaultModelName
                : input.defaultModelName,
            reasoningEffort: input.reasoningEffort === undefined
                ? existing.settings.reasoningEffort
                : input.reasoningEffort,
            temperature: input.temperature === undefined
                ? existing.settings.temperature
                : input.temperature,
            maxOutputTokens: input.maxOutputTokens === undefined
                ? existing.settings.maxOutputTokens
                : input.maxOutputTokens,
            extraJson: input.extraJson ?? existing.settings.extraJson,
            updatedAt: input.now,
        };
        const capabilities = input.capabilities
            ? {
                supportsVision: input.capabilities.supportsVision ?? existing.capabilities.supportsVision,
                supportsToolCalling: input.capabilities.supportsToolCalling ?? existing.capabilities.supportsToolCalling,
                supportsJsonOutput: input.capabilities.supportsJsonOutput ?? existing.capabilities.supportsJsonOutput,
                supportsReasoningEffort: input.capabilities.supportsReasoningEffort ?? existing.capabilities.supportsReasoningEffort,
                supportsModelList: input.capabilities.supportsModelList ?? existing.capabilities.supportsModelList,
                supportsStreaming: input.capabilities.supportsStreaming ?? existing.capabilities.supportsStreaming,
                providesCacheUsage: input.capabilities.providesCacheUsage ?? existing.capabilities.providesCacheUsage,
            }
            : {
                supportsVision: existing.capabilities.supportsVision,
                supportsToolCalling: existing.capabilities.supportsToolCalling,
                supportsJsonOutput: existing.capabilities.supportsJsonOutput,
                supportsReasoningEffort: existing.capabilities.supportsReasoningEffort,
                supportsModelList: existing.capabilities.supportsModelList,
                supportsStreaming: existing.capabilities.supportsStreaming,
                providesCacheUsage: existing.capabilities.providesCacheUsage,
            };

        const transaction = this.database.connection().transaction(() => {
            this.database.connection()
                .prepare(`
                    UPDATE model_providers
                    SET provider_name = ?,
                        provider_source = ?,
                        api_base_url = ?,
                        api_key_secret_ref = ?,
                        custom_headers_json = ?,
                        proxy_mode = ?,
                        proxy_id = ?,
                        enabled = ?,
                        updated_at = ?
                    WHERE provider_id = ?
                `)
                .run(
                    providerName,
                    providerSource,
                    apiBaseUrl,
                    apiKeySecretRef,
                    customHeadersJson,
                    proxyMode,
                    proxyId,
                    enabled ? 1 : 0,
                    input.now,
                    input.providerId,
                );
            this.upsertSettings(
                input.providerId,
                settings,
            );
            this.upsertCapabilities(
                input.providerId,
                capabilities,
                input.now,
            );
        });
        transaction();

        return this.requireProvider(input.providerId);
    }

    /**
     * deleteProvider：删除供应商数据库事实。
     *
     * @param providerId 供应商 ID。
     * @returns 没有返回值。
     */
    deleteProvider(providerId: string): void {
        const transaction = this.database.connection().transaction(() => {
            this.database.connection()
                .prepare("DELETE FROM model_provider_checks WHERE provider_id = ?")
                .run(providerId);
            this.database.connection()
                .prepare("DELETE FROM model_provider_models WHERE provider_id = ?")
                .run(providerId);
            this.database.connection()
                .prepare("DELETE FROM model_provider_settings WHERE provider_id = ?")
                .run(providerId);
            this.database.connection()
                .prepare("DELETE FROM model_provider_capabilities WHERE provider_id = ?")
                .run(providerId);
            this.database.connection()
                .prepare("DELETE FROM model_providers WHERE provider_id = ?")
                .run(providerId);
        });
        transaction();
    }

    /**
     * saveModels：替换保存供应商模型列表并可同步默认模型。
     *
     * @param input 模型保存入参。
     * @returns 没有返回值。
     */
    saveModels(input: SaveModelProviderModelsInput): void {
        const transaction = this.database.connection().transaction(() => {
            this.database.connection()
                .prepare("DELETE FROM model_provider_models WHERE provider_id = ?")
                .run(input.providerId);

            const insertModel = this.database.connection()
                .prepare(`
                    INSERT INTO model_provider_models (
                        model_id,
                        provider_id,
                        model_name,
                        display_name,
                        context_window_tokens,
                        enabled,
                        sort_order,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

            for (const model of input.models) {
                insertModel.run(
                    randomUUID(),
                    input.providerId,
                    model.modelName,
                    model.displayName,
                    model.contextWindowTokens,
                    model.enabled ? 1 : 0,
                    model.sortOrder,
                    input.now,
                    input.now,
                );
            }

            if (input.defaultModelName !== undefined) {
                const current = this.readSettings(input.providerId);
                this.upsertSettings(
                    input.providerId,
                    {
                        defaultModelName: input.defaultModelName,
                        reasoningEffort: current.reasoningEffort,
                        temperature: current.temperature,
                        maxOutputTokens: current.maxOutputTokens,
                        extraJson: current.extraJson,
                        updatedAt: input.now,
                    },
                );
            }
        });
        transaction();
    }

    /**
     * readProviderForRuntime：读取运行时创建模型所需的供应商记录。
     *
     * @param providerId 供应商 ID。
     * @returns 运行时记录；不存在时返回 null。
     */
    readProviderForRuntime(providerId: string): ModelProviderRuntimeRecord | null {
        const provider = this.findProvider(providerId);
        if (!provider) {
            return null;
        }

        const defaultModel = provider.settings.defaultModelName
            ? provider.models.find((model) => {
                return model.modelName === provider.settings.defaultModelName;
            }) ?? null
            : null;

        return {
            ...provider,
            defaultModel,
        };
    }

    /**
     * appendCheck：追加供应商检测结果。
     *
     * @param input 检测结果。
     * @returns 追加后的检测记录。
     */
    appendCheck(input: AppendModelProviderCheckInput): ModelProviderCheckRecord {
        const checkId = randomUUID();
        this.database.connection()
            .prepare(`
                INSERT INTO model_provider_checks (
                    check_id,
                    provider_id,
                    check_type,
                    status,
                    error_message,
                    checked_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
            `)
            .run(
                checkId,
                input.providerId,
                input.checkType,
                input.status,
                input.errorMessage,
                input.checkedAt,
            );

        return {
            checkId,
            providerId: input.providerId,
            checkType: input.checkType,
            status: input.status,
            errorMessage: input.errorMessage,
            checkedAt: input.checkedAt,
        };
    }

    /**
     * findProvider：读取单个供应商完整记录。
     *
     * @param providerId 供应商 ID。
     * @returns 存在时返回供应商记录，否则返回 null。
     */
    findProvider(providerId: string): ModelProviderRecord | null {
        const row = this.database.connection()
            .prepare(`
                SELECT provider_id          AS providerId,
                       provider_name        AS providerName,
                       provider_source      AS providerSource,
                       api_base_url         AS apiBaseUrl,
                       api_key_secret_ref   AS apiKeySecretRef,
                       custom_headers_json  AS customHeadersJson,
                       proxy_mode           AS proxyMode,
                       proxy_id             AS proxyId,
                       enabled,
                       created_at           AS createdAt,
                       updated_at           AS updatedAt
                FROM model_providers
                WHERE provider_id = ?
            `)
            .get(providerId) as ModelProviderTableRow | undefined;

        return row ? this.mapProviderRow(row) : null;
    }

    /**
     * requireProvider：读取供应商，不存在时抛出业务错误。
     *
     * @param providerId 供应商 ID。
     * @returns 供应商记录。
     */
    requireProvider(providerId: string): ModelProviderRecord {
        const provider = this.findProvider(providerId);
        if (!provider) {
            throw new Error("供应商不存在");
        }

        return provider;
    }

    /**
     * mapProviderRow：把数据库行映射为完整供应商记录。
     *
     * @param row model_providers 表行。
     * @returns 完整供应商记录。
     */
    private mapProviderRow(row: ModelProviderTableRow): ModelProviderRecord {
        return {
            providerId: row.providerId,
            providerName: row.providerName,
            providerSource: row.providerSource,
            apiBaseUrl: row.apiBaseUrl,
            apiKeySecretRef: row.apiKeySecretRef,
            customHeadersJson: row.customHeadersJson,
            proxyMode: row.proxyMode,
            proxyId: row.proxyId,
            enabled: row.enabled === 1,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            settings: this.readSettings(row.providerId),
            capabilities: this.readCapabilities(row.providerId),
            models: this.listModels(row.providerId),
            latestCheck: this.readLatestCheck(row.providerId),
        };
    }

    /**
     * readSettings：读取供应商设置，缺失时返回业务默认空设置。
     *
     * @param providerId 供应商 ID。
     * @returns 供应商设置。
     */
    private readSettings(providerId: string): ModelProviderSettingsRecord {
        const row = this.database.connection()
            .prepare(`
                SELECT provider_id         AS providerId,
                       default_model_name  AS defaultModelName,
                       reasoning_effort    AS reasoningEffort,
                       temperature,
                       max_output_tokens   AS maxOutputTokens,
                       extra_json          AS extraJson,
                       updated_at          AS updatedAt
                FROM model_provider_settings
                WHERE provider_id = ?
            `)
            .get(providerId) as ModelProviderSettingsTableRow | undefined;

        if (row) {
            return row;
        }

        return {
            providerId,
            defaultModelName: null,
            reasoningEffort: null,
            temperature: null,
            maxOutputTokens: null,
            extraJson: "{}",
            updatedAt: "",
        };
    }

    /**
     * readCapabilities：读取供应商能力声明，缺失时返回保守默认值。
     *
     * @param providerId 供应商 ID。
     * @returns 能力声明。
     */
    private readCapabilities(providerId: string): ModelProviderCapabilityRecord {
        const row = this.database.connection()
            .prepare(`
                SELECT provider_id                  AS providerId,
                       supports_vision             AS supportsVision,
                       supports_tool_calling       AS supportsToolCalling,
                       supports_json_output        AS supportsJsonOutput,
                       supports_reasoning_effort   AS supportsReasoningEffort,
                       supports_model_list         AS supportsModelList,
                       supports_streaming          AS supportsStreaming,
                       provides_cache_usage        AS providesCacheUsage,
                       updated_at                  AS updatedAt
                FROM model_provider_capabilities
                WHERE provider_id = ?
            `)
            .get(providerId) as ModelProviderCapabilityTableRow | undefined;

        if (!row) {
            return {
                providerId,
                supportsVision: false,
                supportsToolCalling: false,
                supportsJsonOutput: false,
                supportsReasoningEffort: false,
                supportsModelList: false,
                supportsStreaming: true,
                providesCacheUsage: false,
                updatedAt: "",
            };
        }

        return {
            providerId: row.providerId,
            supportsVision: row.supportsVision === 1,
            supportsToolCalling: row.supportsToolCalling === 1,
            supportsJsonOutput: row.supportsJsonOutput === 1,
            supportsReasoningEffort: row.supportsReasoningEffort === 1,
            supportsModelList: row.supportsModelList === 1,
            supportsStreaming: row.supportsStreaming === 1,
            providesCacheUsage: row.providesCacheUsage === 1,
            updatedAt: row.updatedAt,
        };
    }

    /**
     * listModels：读取供应商模型列表。
     *
     * @param providerId 供应商 ID。
     * @returns 模型记录数组。
     */
    private listModels(providerId: string): ModelProviderModelRecord[] {
        const rows = this.database.connection()
            .prepare(`
                SELECT model_id              AS modelId,
                       provider_id           AS providerId,
                       model_name            AS modelName,
                       display_name          AS displayName,
                       context_window_tokens AS contextWindowTokens,
                       enabled,
                       sort_order            AS sortOrder,
                       created_at            AS createdAt,
                       updated_at            AS updatedAt
                FROM model_provider_models
                WHERE provider_id = ?
                ORDER BY sort_order ASC,
                         model_name ASC
            `)
            .all(providerId) as ModelProviderModelTableRow[];

        return rows.map((row) => {
            return {
                modelId: row.modelId,
                providerId: row.providerId,
                modelName: row.modelName,
                displayName: row.displayName,
                contextWindowTokens: row.contextWindowTokens,
                enabled: row.enabled === 1,
                sortOrder: row.sortOrder,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            };
        });
    }

    /**
     * readLatestCheck：读取供应商最近检测结果。
     *
     * @param providerId 供应商 ID。
     * @returns 最近检测记录；无记录时返回 null。
     */
    private readLatestCheck(providerId: string): ModelProviderCheckRecord | null {
        const row = this.database.connection()
            .prepare(`
                SELECT check_id      AS checkId,
                       provider_id   AS providerId,
                       check_type    AS checkType,
                       status,
                       error_message AS errorMessage,
                       checked_at    AS checkedAt
                FROM model_provider_checks
                WHERE provider_id = ?
                ORDER BY checked_at DESC
                LIMIT 1
            `)
            .get(providerId) as ModelProviderCheckTableRow | undefined;

        return row ?? null;
    }

    /**
     * upsertSettings：写入供应商默认设置。
     *
     * @param providerId 供应商 ID。
     * @param settings 设置字段。
     * @returns 没有返回值。
     */
    private upsertSettings(
        providerId: string,
        settings: Omit<ModelProviderSettingsRecord, "providerId">,
    ): void {
        this.database.connection()
            .prepare(`
                INSERT INTO model_provider_settings (
                    provider_id,
                    default_model_name,
                    reasoning_effort,
                    temperature,
                    max_output_tokens,
                    extra_json,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider_id) DO UPDATE SET
                    default_model_name = excluded.default_model_name,
                    reasoning_effort = excluded.reasoning_effort,
                    temperature = excluded.temperature,
                    max_output_tokens = excluded.max_output_tokens,
                    extra_json = excluded.extra_json,
                    updated_at = excluded.updated_at
            `)
            .run(
                providerId,
                settings.defaultModelName,
                settings.reasoningEffort,
                settings.temperature,
                settings.maxOutputTokens,
                settings.extraJson,
                settings.updatedAt,
            );
    }

    /**
     * upsertCapabilities：写入供应商能力声明。
     *
     * @param providerId 供应商 ID。
     * @param capabilities 能力声明。
     * @param updatedAt 更新时间。
     * @returns 没有返回值。
     */
    private upsertCapabilities(
        providerId: string,
        capabilities: Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt">,
        updatedAt: string,
    ): void {
        this.database.connection()
            .prepare(`
                INSERT INTO model_provider_capabilities (
                    provider_id,
                    supports_vision,
                    supports_tool_calling,
                    supports_json_output,
                    supports_reasoning_effort,
                    supports_model_list,
                    supports_streaming,
                    provides_cache_usage,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider_id) DO UPDATE SET
                    supports_vision = excluded.supports_vision,
                    supports_tool_calling = excluded.supports_tool_calling,
                    supports_json_output = excluded.supports_json_output,
                    supports_reasoning_effort = excluded.supports_reasoning_effort,
                    supports_model_list = excluded.supports_model_list,
                    supports_streaming = excluded.supports_streaming,
                    provides_cache_usage = excluded.provides_cache_usage,
                    updated_at = excluded.updated_at
            `)
            .run(
                providerId,
                capabilities.supportsVision ? 1 : 0,
                capabilities.supportsToolCalling ? 1 : 0,
                capabilities.supportsJsonOutput ? 1 : 0,
                capabilities.supportsReasoningEffort ? 1 : 0,
                capabilities.supportsModelList ? 1 : 0,
                capabilities.supportsStreaming ? 1 : 0,
                capabilities.providesCacheUsage ? 1 : 0,
                updatedAt,
            );
    }
}
