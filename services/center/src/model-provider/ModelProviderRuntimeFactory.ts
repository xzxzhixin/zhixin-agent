import {readFileSync} from "node:fs";
import {join} from "node:path";

import {createAnthropic} from "@ai-sdk/anthropic";
import {createGoogleGenerativeAI} from "@ai-sdk/google";
import {createOpenAI} from "@ai-sdk/openai";
import {createOpenAICompatible} from "@ai-sdk/openai-compatible";
import {createOpenRouter} from "@openrouter/ai-sdk-provider";
import type {LanguageModel} from "ai";

import type {CenterDatabase} from "../database.js";
import {createDataAccess} from "../data-access/index.js";
import {ModelProviderRepository} from "../data-access/ModelProviderRepository.js";
import type {
    ModelProviderRuntimeRecord,
    ModelProviderSource,
} from "../data-access/ModelProviderRepository.js";
import {AiSdkChatModelAdapter} from "./AiSdkChatModelAdapter.js";
import type {ResolvedModelProviderRuntime} from "./ModelProviderRuntimeTypes.js";

/** SecretConfigFile：中心服务私有敏感信息文件结构。 */
interface SecretConfigFile {
    /** secrets: secretRef 到敏感值记录的映射。 */
    secrets: Record<string, {
        /** value: 敏感明文，只供中心服务本机调用外部服务使用。 */
        value: string;
    }>;
}

/**
 * ModelProviderRuntimeFactory：数据库供应商模型运行时工厂。
 *
 * 用途：读取 SQLite 供应商配置，创建 Deep Agents 可用的 AI SDK ChatModel 适配器。
 */
export class ModelProviderRuntimeFactory {
    /** database: 中心服务数据库。 */
    private readonly database: CenterDatabase;

    /**
     * constructor：保存数据库依赖。
     *
     * @param database 中心服务数据库。
     */
    public constructor(database: CenterDatabase) {
        this.database = database;
    }

    /**
     * resolveRuntime：解析当前任务可用的模型运行时。
     *
     * @param taskId 任务 ID；后续用于智能体/任务默认供应商选择。
     * @returns 新供应商运行时。
     */
    public resolveRuntime(taskId: string): ResolvedModelProviderRuntime {
        void taskId;
        const centerDirectory = extractCenterDirectory(this.database);
        if (!centerDirectory) {
            throw new Error("CENTER_DIRECTORY_NOT_AVAILABLE");
        }
        const provider = this.findFirstEnabledProvider();
        if (!provider) {
            throw new Error("PROVIDER_NOT_AVAILABLE");
        }
        if (!provider.settings.defaultModelName) {
            throw new Error("PROVIDER_DEFAULT_MODEL_NOT_AVAILABLE");
        }
        const apiKey = readSecretValue(
            centerDirectory,
            provider.apiKeySecretRef,
        );
        if (!apiKey) {
            throw new Error("PROVIDER_API_KEY_NOT_AVAILABLE");
        }

        return {
            provider,
            centerDirectory,
            apiKey,
            requestUrl: resolveModelProviderRequestUrl(provider),
            modelSelection: {
                model: provider.settings.defaultModelName,
                reasoningEffort: provider.settings.reasoningEffort,
            },
        };
    }

    /**
     * createChatModel：创建 Deep Agents 可消费的 LangChain ChatModel。
     *
     * @param runtime 已解析的新供应商运行时。
     * @returns AI SDK ChatModel 适配器。
     */
    public createChatModel(runtime: ResolvedModelProviderRuntime): AiSdkChatModelAdapter {
        return new AiSdkChatModelAdapter({
            runtime,
            languageModel: createAiSdkLanguageModel(runtime),
        });
    }

    /**
     * findFirstEnabledProvider：读取第一个启用供应商。
     *
     * @returns 供应商运行时记录；不存在时返回 null。
     */
    private findFirstEnabledProvider(): ModelProviderRuntimeRecord | null {
        const repository = new ModelProviderRepository(this.database);
        const provider = repository.listProviders().find((item) => {
            return item.enabled;
        });
        if (!provider) {
            return null;
        }
        return repository.readProviderForRuntime(provider.providerId);
    }
}

/**
 * createAiSdkLanguageModel：按模型来源创建 AI SDK LanguageModel。
 *
 * @param runtime 已解析的新供应商运行时。
 * @returns AI SDK 语言模型。
 */
function createAiSdkLanguageModel(runtime: ResolvedModelProviderRuntime): LanguageModel {
    const provider = runtime.provider;
    const model = runtime.modelSelection.model;
    if (provider.providerSource === "openai" || provider.providerSource === "codex") {
        return createOpenAI({
            apiKey: runtime.apiKey,
            baseURL: provider.apiBaseUrl ?? undefined,
            headers: parseCustomHeaders(provider.customHeadersJson),
        })(model);
    }
    if (provider.providerSource === "anthropic") {
        return createAnthropic({
            apiKey: runtime.apiKey,
            baseURL: provider.apiBaseUrl ?? undefined,
            headers: parseCustomHeaders(provider.customHeadersJson),
        })(model);
    }
    if (provider.providerSource === "google") {
        return createGoogleGenerativeAI({
            apiKey: runtime.apiKey,
            baseURL: provider.apiBaseUrl ?? undefined,
            headers: parseCustomHeaders(provider.customHeadersJson),
        })(model);
    }
    if (provider.providerSource === "openrouter") {
        return createOpenRouter({
            apiKey: runtime.apiKey,
            baseURL: provider.apiBaseUrl ?? undefined,
            headers: parseCustomHeaders(provider.customHeadersJson),
        })(model);
    }
    return createOpenAICompatible({
        name: provider.providerSource,
        apiKey: runtime.apiKey,
        baseURL: resolveOpenAiCompatibleBaseUrl(provider.providerSource, provider.apiBaseUrl),
        headers: parseCustomHeaders(provider.customHeadersJson),
    })(model);
}

/**
 * resolveOpenAiCompatibleBaseUrl：解析 OpenAI 兼容来源 Base URL。
 *
 * @param providerSource 模型来源。
 * @param configuredBaseUrl 用户配置地址。
 * @returns AI SDK OpenAI 兼容 provider Base URL。
 */
function resolveOpenAiCompatibleBaseUrl(
    providerSource: ModelProviderSource,
    configuredBaseUrl: string | null,
): string {
    if (configuredBaseUrl) {
        return configuredBaseUrl;
    }
    if (providerSource === "deepseek") {
        return "https://api.deepseek.com";
    }
    if (providerSource === "qwen") {
        return "https://dashscope.aliyuncs.com/compatible-mode/v1";
    }
    throw new Error("MODEL_PROVIDER_BASE_URL_NOT_AVAILABLE");
}

/**
 * resolveModelProviderRequestUrl：生成日志用请求地址摘要。
 *
 * @param provider 供应商配置。
 * @returns 请求地址摘要。
 */
function resolveModelProviderRequestUrl(provider: ModelProviderRuntimeRecord): string {
    if (provider.providerSource === "anthropic") {
        return provider.apiBaseUrl ?? "https://api.anthropic.com/v1/messages";
    }
    if (provider.providerSource === "google") {
        return provider.apiBaseUrl ?? "https://generativelanguage.googleapis.com";
    }
    if (provider.providerSource === "openrouter") {
        return provider.apiBaseUrl ?? "https://openrouter.ai/api/v1/chat/completions";
    }
    const baseUrl = provider.apiBaseUrl ?? (provider.providerSource === "deepseek"
        ? "https://api.deepseek.com"
        : provider.providerSource === "qwen"
            ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
            : "https://api.openai.com/v1");
    return `${baseUrl.replace(/\/$/u, "")}/chat/completions`;
}

/**
 * parseCustomHeaders：解析供应商自定义请求头。
 *
 * @param rawJson 数据库保存的 JSON 对象字符串。
 * @returns 请求头对象。
 */
function parseCustomHeaders(rawJson: string): Record<string, string> | undefined {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
        parsed = {};
    }
    const headers: Record<string, string> = {};
    for (const [
        key,
        value,
    ] of Object.entries(parsed)) {
        if (typeof value === "string") {
            headers[key] = value;
        }
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * extractCenterDirectory：读取中心目录。
 *
 * @param database 中心服务数据库。
 * @returns 中心目录。
 */
export function extractCenterDirectory(database: CenterDatabase): string {
    return createDataAccess(database).system.readMetaValue("centerDirectory") ?? "";
}

/**
 * readSecretValue：按引用读取中心服务本机敏感信息。
 *
 * @param centerDirectory 中心目录。
 * @param secretRef 敏感信息引用。
 * @returns 敏感值；不存在时返回 null。
 */
export function readSecretValue(
    centerDirectory: string,
    secretRef: string | null,
): string | null {
    if (!secretRef) {
        return null;
    }
    const secretsPath = join(centerDirectory, "config", "secrets.json");
    try {
        const config = JSON.parse(readFileSync(secretsPath, "utf-8")) as SecretConfigFile;
        return config.secrets[secretRef]?.value ?? null;
    } catch {
        return null;
    }
}
