import {readFileSync} from "node:fs";
import {join} from "node:path";

import {ChatAnthropic} from "@langchain/anthropic";
import {
    ChatOpenAI,
    ChatOpenAIResponses,
} from "@langchain/openai";
import type {BaseChatModel} from "@langchain/core/language_models/chat_models";

import type {CenterDatabase} from "../database.js";
import {createDataAccess} from "../data-access/index.js";
import {ModelProviderRepository} from "../data-access/ModelProviderRepository.js";
import type {ModelProviderRuntimeRecord} from "../data-access/ModelProviderRepository.js";
import {OpenAiToolCallNamePreservingCompletions} from "./OpenAiToolCallNamePreservingCompletions.js";
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
 * 用途：读取 SQLite 供应商配置，按内部模型协议创建 Deep Agents 可用的 LangChain ChatModel。
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
            runtimeMode: resolveModelProviderRuntimeMode(provider),
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
     * @returns LangChain ChatModel。
     */
    public createChatModel(runtime: ResolvedModelProviderRuntime): BaseChatModel {
        if (runtime.provider.modelProtocol === "anthropic") {
            return createAnthropicChatModel(runtime);
        }
        return createOpenAiChatModel(runtime);
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
 * createOpenAiChatModel：按 OpenAI 协议创建 LangChain 模型。
 *
 * @param runtime 已解析的供应商运行时。
 * @returns OpenAI ChatModel。
 */
function createOpenAiChatModel(runtime: ResolvedModelProviderRuntime): ChatOpenAI {
    const openAiFields = {
        apiKey: runtime.apiKey,
        model: runtime.modelSelection.model,
        streaming: true,
        configuration: {
            baseURL: runtime.provider.apiBaseUrl ?? undefined,
            defaultHeaders: parseCustomHeaders(runtime.provider.customHeadersJson),
        },
        modelKwargs: buildOpenAiModelKwargs(runtime),
    };
    return new ChatOpenAI({
        ...openAiFields,
        // useResponsesApi：保存前协议探测通过 Responses 时强制走 Responses；未探测或兼容模式继续交给 Chat Completions。
        useResponsesApi: runtime.runtimeMode === "responses",
        // responses：显式注入 Responses 底层实现，避免 ChatOpenAI 因模型名启发式和探测能力不一致。
        responses: new ChatOpenAIResponses(openAiFields),
        // completions：OpenAI Chat Completions 兼容供应商统一入口，补齐流式分片中同一工具调用的非空名称保持。
        completions: new OpenAiToolCallNamePreservingCompletions({
            apiKey: runtime.apiKey,
            model: runtime.modelSelection.model,
            streaming: true,
            configuration: {
                baseURL: runtime.provider.apiBaseUrl ?? undefined,
                defaultHeaders: parseCustomHeaders(runtime.provider.customHeadersJson),
            },
            modelKwargs: buildOpenAiModelKwargs(runtime),
        }),
    });
}

/**
 * createAnthropicChatModel：按 Anthropic 协议创建 LangChain 模型。
 *
 * @param runtime 已解析的供应商运行时。
 * @returns Anthropic ChatModel。
 */
function createAnthropicChatModel(runtime: ResolvedModelProviderRuntime): ChatAnthropic {
    return new ChatAnthropic({
        apiKey: runtime.apiKey,
        model: runtime.modelSelection.model,
        streaming: true,
        anthropicApiUrl: runtime.provider.apiBaseUrl ?? undefined,
        clientOptions: {
            defaultHeaders: parseCustomHeaders(runtime.provider.customHeadersJson),
        },
    });
}

/**
 * buildOpenAiModelKwargs：构造 OpenAI 模型额外参数。
 *
 * @param runtime 已解析的供应商运行时。
 * @returns 额外模型参数。
 */
function buildOpenAiModelKwargs(runtime: ResolvedModelProviderRuntime): Record<string, unknown> {
    if (!runtime.modelSelection.reasoningEffort) {
        return {};
    }
    return {
        // reasoning_effort：OpenAI 推理模型公开参数，由供应商配置显式启用后传递。
        reasoning_effort: runtime.modelSelection.reasoningEffort,
    };
}

/**
 * resolveModelProviderRequestUrl：生成日志用请求地址摘要。
 *
 * @param provider 供应商配置。
 * @returns 请求地址摘要。
 */
function resolveModelProviderRequestUrl(provider: ModelProviderRuntimeRecord): string {
    if (provider.modelProtocol === "anthropic") {
        return provider.apiBaseUrl ?? "https://api.anthropic.com/v1/messages";
    }
    const baseUrl = provider.apiBaseUrl ?? "https://api.openai.com/v1";
    const runtimeMode = resolveModelProviderRuntimeMode(provider);
    if (runtimeMode === "responses") {
        return `${baseUrl.replace(/\/$/u, "")}/responses`;
    }
    return `${baseUrl.replace(/\/$/u, "")}/chat/completions`;
}

/**
 * resolveModelProviderRuntimeMode：按探测矩阵选择 OpenAI 运行模式。
 *
 * @param provider 供应商配置。
 * @returns 运行模式；Anthropic 或未探测时返回 null。
 */
function resolveModelProviderRuntimeMode(provider: ModelProviderRuntimeRecord): ResolvedModelProviderRuntime["runtimeMode"] {
    if (provider.modelProtocol === "anthropic") {
        return null;
    }
    if (provider.capabilities.selectedRuntimeMode) {
        return provider.capabilities.selectedRuntimeMode;
    }
    if (provider.capabilities.responsesSupported) {
        return "responses";
    }
    if (provider.capabilities.chatCompletionsSupported) {
        return "chat_completions_to_responses";
    }
    return null;
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
