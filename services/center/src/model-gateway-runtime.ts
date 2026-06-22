import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";

import {ChatAnthropic} from "@langchain/anthropic";

import type {CenterDatabase} from "./database.js";
import type {
    OpenAiToolCall,
} from "./openai-chat-protocol.js";
import {createDataAccess} from "./data-access/index.js";
import {
    readProviderConfig,
    readSecretValue,
    resolveProviderModelSelection,
} from "./domain/provider-domain.js";
import {
    searchSemanticMemories,
} from "./memory-engine.js";
import {OpenAiCompatibleChatCompletionsModel} from "./model-compat/OpenAiCompatibleChatCompletionsModel";
import {ChatOpenAI} from "@langchain/openai";

/**
 * ProviderModelGatewayResult：中心服务模型网关统一返回。
 */
export interface ProviderModelGatewayResult {
    /** providerId: 供应商 ID。 */
    providerId: string;
    /** model: 实际请求模型。 */
    model: string;
    /** reasoningEffort: 推理深度。 */
    reasoningEffort: string | null;
    /** assistantText: 助手文本。 */
    assistantText: string;
    /** usage: 用量；供应商未提供时为 null。 */
    usage: {
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
        cacheHitTokens: number | null;
        cacheMissTokens: number | null;
        rawUsage: unknown;
    } | null;
    /** toolCall: 模型请求的首个工具调用；没有工具请求时为 null。 */
    toolCall: OpenAiToolCall | null;
    /** toolCalls: 模型请求的全部工具调用；没有工具请求时为空数组。 */
    toolCalls: OpenAiToolCall[];
}

export interface ResolvedProviderModelRuntime {
    /** provider: 已启用供应商配置。 */
    provider: NonNullable<ReturnType<typeof readProviderConfigByPriority>>;
    /** centerDirectory: 中心目录绝对路径。 */
    centerDirectory: string;
    /** modelSelection: 当前模型和推理深度选择。 */
    modelSelection: {
        model: string;
        reasoningEffort: string | null;
    };
}

interface AgentMemoryPromptEntry {
    /** keywords: 记忆关键词。 */
    keywords: string;
    /** summary: 记忆摘要。 */
    summary: string;
    /** sourceSessionId: 来源会话 ID。 */
    sourceSessionId: string | null;
    /** sourceTurnId: 来源轮次 ID。 */
    sourceTurnId: string | null;
    /** sourceMemoryPath: Markdown 记忆相对中心目录路径。 */
    sourceMemoryPath: string | null;
    /** attachments: 本条记忆关联的归档附件来源。 */
    attachments: AgentMemoryAttachmentPromptEntry[];
}

interface AgentMemoryAttachmentPromptEntry {
    /** attachmentId: 正式附件 ID。 */
    attachmentId: string;
    /** fileName: 附件文件名。 */
    fileName: string;
    /** archivePath: 归档附件相对中心目录路径。 */
    archivePath: string;
}

// MAIN_AGENT_MEMORY_PROMPT_LIMIT：模型请求只注入有限主智能体记忆候选，避免长期记忆无界占用上下文。
const MAIN_AGENT_MEMORY_PROMPT_LIMIT = 12;
// MAIN_AGENT_MEMORY_PROMPT_MAX_CHARS：记忆系统消息长度上限，防止历史摘要异常膨胀。
const MAIN_AGENT_MEMORY_PROMPT_MAX_CHARS = 1200;
/**
 * resolveProviderModelRuntime：解析一次模型调用所需供应商、中心目录和模型选择。
 *
 * @param database 中心服务数据库。
 * @param taskId 任务 ID。
 * @returns 模型调用运行时上下文。
 */
export function resolveProviderModelRuntime(database: CenterDatabase, taskId: string): ResolvedProviderModelRuntime {
    const provider = readProviderConfigByPriority(database, taskId);
    if (!provider) {
        throw new Error("PROVIDER_NOT_AVAILABLE");
    }

    const centerDirectory = extractCenterDirectory(database);
    const modelSelection = resolveProviderModelSelection(
        centerDirectory,
        provider.providerId,
        provider.defaultModel,
    );

    return {
        provider,
        centerDirectory,
        modelSelection,
    };
}

/**
 * createLangChainChatModel：按供应商配置创建 LangChain ChatModel。
 *
 * @param runtime 模型调用运行时上下文。
 * @returns LangChain OpenAI 或 Anthropic ChatModel。
 */
export function createLangChainChatModel(runtime: ResolvedProviderModelRuntime): LangChainChatModelRuntime {
    const provider = runtime.provider;
    const apiKey = readSecretValue(
        runtime.centerDirectory,
        provider.apiKeySecretRef,
    ) ?? "zhixin-local-provider-placeholder-key";
    const model = runtime.modelSelection.model;
    if (provider.providerName.toLowerCase().includes("anthropic")) {
        return new ChatAnthropic({
            apiKey,
            model,
            streaming: true,
        });
    }
    return new OpenAiCompatibleChatCompletionsModel({
        apiKey,
        model,
        streaming: true,
        centerDirectory: runtime.centerDirectory,
        // OpenAI 兼容供应商必须走 Chat Completions；普通 ChatOpenAI 会因 gpt-5 系列模型名自动切到 Responses API，
        // 兼容网关的 Responses 流式工具块可能被解析成空工具名，导致工具闭环失败。
        configuration: {
            baseURL: normalizeOpenAiBaseUrl(provider.baseUrl),
        },
    });
}

/**
 * normalizeOpenAiBaseUrl：把供应商基础地址规范为 OpenAI Chat Completions 需要的 /v1 根路径。
 *
 * @param baseUrl 用户在供应商配置中保存的基础地址。
 * @returns 以 /v1 结尾的 OpenAI 兼容接口地址。
 */
export function normalizeOpenAiBaseUrl(baseUrl: string): string {
    // normalizedBaseUrl: 用户可能填写服务根地址，也可能已经填写 /v1；这里统一为 LangChain ChatOpenAI 的 baseURL。
    const normalizedBaseUrl = baseUrl.replace(/\/$/u, "");
    if (normalizedBaseUrl.endsWith("/v1")) {
        return normalizedBaseUrl;
    }
    return `${normalizedBaseUrl}/v1`;
}

export function extractCenterDirectory(database: CenterDatabase): string {
    return createDataAccess(database).system.readMetaValue("centerDirectory") ?? "";
}

export function readProviderConfigByPriority(database: CenterDatabase, taskId: string) {
    const centerDirectory = extractCenterDirectory(database);
    if (!centerDirectory) {
        return null;
    }
    void taskId;
    const providersDirectory = join(centerDirectory, "providers");
    if (!existsSync(providersDirectory)) {
        return null;
    }
    const providerFiles = readdirSync(providersDirectory)
        .filter((fileName) => {
            return fileName.endsWith(".json")
                && !fileName.endsWith(".models.json")
                && !fileName.endsWith(".patch.json");
        })
        .sort();
    for (const fileName of providerFiles) {
        const providerId = fileName.replace(/\.json$/u, "");
        const provider = readProviderConfig(centerDirectory, providerId);
        if (provider?.enabled) {
            return provider;
        }
    }

    return null;
}

type LangChainChatModelRuntime = ChatOpenAI | ChatAnthropic;

/**
 * listMainAgentMemoryPromptEntries：读取主智能体最近长期记忆摘要。
 *
 * @param database 中心服务数据库。
 * @returns 可注入模型请求的主智能体记忆摘要。
 */
export async function listMainAgentMemoryPromptEntries(
    database: CenterDatabase,
    userText = "",
): Promise<AgentMemoryPromptEntry[]> {
    const centerDirectory = extractCenterDirectory(database);
    const workflowRepository = createDataAccess(database).workflow;
    const indexedMemories = workflowRepository.listRecentAgentMemorySummaries(
        "main",
        MAIN_AGENT_MEMORY_PROMPT_LIMIT,
    ).map((memory) => {
        return {
            keywords: memory.keywords,
            summary: memory.summary,
            sourceSessionId: memory.sourceSessionId,
            sourceTurnId: memory.sourceTurnId,
            sourceMemoryPath: memory.memoryPath,
            attachments: parseAgentMemoryAttachments(memory.attachmentRefsJson),
            sourceKind: "index" as const,
            score: 0,
        };
    });
    const searchedIndexedMemories = searchMainAgentIndexedMemories(
        workflowRepository,
        userText,
    );
    const semanticMemories = centerDirectory
        ? await searchSemanticMemories(
            centerDirectory,
            buildMainAgentMemorySearchQuery(userText),
        )
        : [];
    const semanticEntries = semanticMemories.map((memory) => {
        return {
            keywords: "mem0",
            summary: memory.memory,
            sourceSessionId: typeof memory.metadata.sourceSessionId === "string"
                ? memory.metadata.sourceSessionId
                : null,
            sourceTurnId: typeof memory.metadata.sourceTurnId === "string"
                ? memory.metadata.sourceTurnId
                : null,
            sourceMemoryPath: typeof memory.metadata.sourceMemoryPath === "string"
                ? memory.metadata.sourceMemoryPath
                : null,
            attachments: parseAgentMemoryAttachments(memory.metadata.attachments),
            sourceKind: "mem0" as const,
            score: memory.score ?? 0,
        };
    });
    return dedupeMainAgentMemoryPromptEntries([
        ...searchedIndexedMemories,
        ...semanticEntries,
        ...indexedMemories,
    ]).filter((memory) => {
        return shouldIncludeMainAgentMemoryPromptEntry(memory.summary);
    }).sort((left, right) => {
        return scoreMainAgentMemoryPromptEntry(right) - scoreMainAgentMemoryPromptEntry(left);
    }).slice(0, MAIN_AGENT_MEMORY_PROMPT_LIMIT).map((memory) => {
        return {
            keywords: memory.keywords,
            summary: memory.summary,
            sourceSessionId: memory.sourceSessionId,
            sourceTurnId: memory.sourceTurnId,
            sourceMemoryPath: memory.sourceMemoryPath,
            attachments: memory.attachments,
        };
    });
}

/**
 * shouldIncludeMainAgentMemoryPromptEntry：过滤明显错误的主智能体长期记忆摘要，避免历史污染继续压过正确信息。
 *
 * @param summary 长期记忆摘要。
 * @returns 可注入模型提示时返回 true。
 */
function shouldIncludeMainAgentMemoryPromptEntry(summary: string): boolean {
    const normalizedSummary = summary.replace(/\s+/gu, " ").trim();
    if (normalizedSummary.length === 0) {
        return false;
    }
    if (normalizedSummary.length <= 2) {
        return false;
    }
    if (isLowSignalMemorySummary(normalizedSummary)) {
        return false;
    }
    return !looksLikeGenericFailedMemorySummary(normalizedSummary);
}

/**
 * scoreMainAgentMemoryPromptEntry：给主智能体长期记忆候选打分，让 mem0 稳定事实优先、回归口水降权。
 *
 * @param memory 长期记忆候选。
 * @returns 数值越高越应优先展示。
 */
function scoreMainAgentMemoryPromptEntry(memory: {
    summary: string;
    sourceKind: "mem0" | "index";
    score: number;
}): number {
    const normalizedSummary = memory.summary.replace(/\s+/gu, " ").trim();
    let score = 0;
    if (memory.sourceKind === "mem0") {
        score += 100;
    }
    if (normalizedSummary.includes("偏好") || normalizedSummary.includes("长期记忆")) {
        score += 20;
    }
    if (normalizedSummary.includes("附件来源") || normalizedSummary.includes("附件摘要")) {
        score += 15;
    }
    if (normalizedSummary.includes("用户")) {
        score += 10;
    }
    return score + memory.score;
}

/**
 * buildMainAgentMemorySearchQuery：为本轮问题构造长期记忆语义检索词。
 *
 * @param userText 用户本轮输入。
 * @returns 兼顾当前问题和稳定长期事实的检索文本。
 */
function buildMainAgentMemorySearchQuery(userText: string): string {
    const normalizedUserText = userText.replace(/\s+/gu, " ").trim();
    const searchTerms = buildGenericMemorySearchTerms(normalizedUserText);
    return searchTerms.join(" ");
}

/**
 * searchMainAgentIndexedMemories：按当前问题检索 SQLite 记忆索引，避免只看最近几条把旧正确信息压下去。
 *
 * @param workflowRepository 执行链路仓储。
 * @param userText 用户本轮输入。
 * @returns 命中的主智能体长期记忆候选。
 */
function searchMainAgentIndexedMemories(
    workflowRepository: ReturnType<typeof createDataAccess>["workflow"],
    userText: string,
): Array<{
    keywords: string;
    summary: string;
    sourceSessionId: string | null;
    sourceTurnId: string | null;
    sourceMemoryPath: string | null;
    attachments: AgentMemoryAttachmentPromptEntry[];
    sourceKind: "index";
    score: number;
}> {
    const searchTerms = buildMainAgentIndexedMemorySearchTerms(userText);
    const result = searchTerms.flatMap((term) => {
        return workflowRepository.searchAgentMemorySummaries(
            "main",
            term,
            MAIN_AGENT_MEMORY_PROMPT_LIMIT,
        ).map((memory) => {
            return {
                keywords: memory.keywords,
                summary: memory.summary,
                sourceSessionId: memory.sourceSessionId,
                sourceTurnId: memory.sourceTurnId,
                sourceMemoryPath: memory.memoryPath,
                attachments: parseAgentMemoryAttachments(memory.attachmentRefsJson),
                sourceKind: "index" as const,
                score: scoreIndexedMemorySearchHit(
                    term,
                    memory.summary,
                    memory.keywords,
                ),
            };
        });
    });
    return dedupeMainAgentMemoryPromptEntries(result);
}

/**
 * buildMainAgentIndexedMemorySearchTerms：为 SQLite 记忆索引生成检索词集合。
 *
 * @param userText 用户本轮输入。
 * @returns 检索词数组。
 */
function buildMainAgentIndexedMemorySearchTerms(userText: string): string[] {
    const normalizedUserText = userText.replace(/\s+/gu, " ").trim();
    return buildGenericMemorySearchTerms(normalizedUserText);
}

/**
 * buildGenericMemorySearchTerms：构造不依赖具体问题类型的长期记忆检索词。
 *
 * @param normalizedUserText 已规整的用户本轮输入。
 * @returns 可同时用于 Mem0 和 SQLite 的通用检索词。
 */
function buildGenericMemorySearchTerms(normalizedUserText: string): string[] {
    const terms = new Set<string>();
    if (normalizedUserText.length > 0) {
        terms.add(normalizedUserText);
        extractMeaningfulMemoryTerms(normalizedUserText).forEach((term) => {
            terms.add(term);
        });
    }
    [
        "用户长期事实",
        "用户偏好",
        "当天事实",
        "附件来源",
        "附件摘要",
        "历史上下文",
    ].forEach((term) => {
        terms.add(term);
    });
    return Array.from(terms).filter((term) => {
        return term.trim().length > 0;
    });
}

/**
 * extractMeaningfulMemoryTerms：从用户输入中提取通用检索片段。
 *
 * @param text 用户本轮输入。
 * @returns 去掉标点和过短片段后的检索词。
 */
function extractMeaningfulMemoryTerms(text: string): string[] {
    return text.split(/[^\p{L}\p{N}]+/gu).filter((term) => {
        return term.length >= 2;
    }).slice(0, 8);
}

/**
 * scoreIndexedMemorySearchHit：给 SQLite 记忆命中结果打分，优先保留和当前问题强相关的稳定事实。
 *
 * @param searchTerm 当前使用的检索词。
 * @param summary 长期记忆摘要。
 * @param keywords 长期记忆关键词。
 * @returns 命中得分。
 */
function scoreIndexedMemorySearchHit(
    searchTerm: string,
    summary: string,
    keywords: string,
): number {
    let score = 0;
    if (summary.includes(searchTerm)) {
        score += 30;
    }
    if (keywords.includes(searchTerm)) {
        score += 20;
    }
    if (summary.includes("附件来源") || summary.includes("附件摘要")) {
        score += 15;
    }
    if (summary.includes("用户") || summary.includes("偏好")) {
        score += 10;
    }
    return score;
}

/**
 * isLowSignalMemorySummary：识别无长期价值的低信号摘要。
 *
 * @param summary 长期记忆摘要。
 * @returns 低信号时返回 true。
 */
function isLowSignalMemorySummary(summary: string): boolean {
    const compactSummary = summary.replace(/\s+/gu, "");
    if (compactSummary.length < 4) {
        return true;
    }
    const uniqueCharacters = new Set(Array.from(compactSummary));
    if (compactSummary.length >= 4 && uniqueCharacters.size <= 2) {
        return true;
    }
    return /^[\p{P}\p{S}\s]+$/u.test(summary);
}

/**
 * looksLikeGenericFailedMemorySummary：识别不应继续召回的泛化失败摘要。
 *
 * @param summary 长期记忆摘要。
 * @returns 失败表达缺少具体可复用事实时返回 true。
 */
function looksLikeGenericFailedMemorySummary(summary: string): boolean {
    const normalized = summary.toLowerCase();
    const failureMarkers = [
        "error",
        "failed",
        "failure",
        "exception",
        "无法",
        "不能",
        "失败",
        "错误",
        "异常",
    ];
    const hasFailureMarker = failureMarkers.some((marker) => {
        return normalized.includes(marker);
    });
    if (!hasFailureMarker) {
        return false;
    }
    const alphaNumericCount = Array.from(summary.matchAll(/[\p{L}\p{N}]/gu)).length;
    return summary.length < 80 || alphaNumericCount < 12;
}

/**
 * dedupeMainAgentMemoryPromptEntries：按摘要去重主智能体长期记忆候选，避免 mem0 与索引重复占位。
 *
 * @param entries 主智能体长期记忆候选。
 * @returns 去重后的候选数组。
 */
function dedupeMainAgentMemoryPromptEntries<T extends {
    summary: string;
}>(entries: T[]): T[] {
    const seenSummaries = new Set<string>();
    const dedupedEntries: T[] = [];
    for (const entry of entries) {
        const summaryKey = entry.summary.replace(/\s+/gu, " ").trim();
        if (summaryKey.length === 0 || seenSummaries.has(summaryKey)) {
            continue;
        }
        seenSummaries.add(summaryKey);
        dedupedEntries.push(entry);
    }
    return dedupedEntries;
}

/**
 * parseAgentMemoryAttachments：解析长期记忆附件来源。
 *
 * @param rawAttachments SQLite JSON 字符串或 Mem0 metadata 字段。
 * @returns 可注入模型上下文的附件来源列表。
 */
function parseAgentMemoryAttachments(rawAttachments: unknown): AgentMemoryAttachmentPromptEntry[] {
    const parsedAttachments = typeof rawAttachments === "string"
        ? tryParseJsonArray(rawAttachments)
        : Array.isArray(rawAttachments)
            ? rawAttachments
            : [];
    return parsedAttachments.filter((item) => {
        return typeof item === "object" && item !== null;
    }).map((item) => {
        const record = item as Record<string, unknown>;
        return {
            attachmentId: typeof record.attachmentId === "string"
                ? record.attachmentId
                : "",
            fileName: typeof record.fileName === "string"
                ? record.fileName
                : "",
            archivePath: typeof record.archivePath === "string"
                ? record.archivePath
                : "",
        };
    }).filter((item) => {
        return item.attachmentId.length > 0
            && item.fileName.length > 0
            && item.archivePath.length > 0;
    });
}

/**
 * formatMemoryAttachmentForPrompt：格式化单个附件来源并限制字段长度。
 *
 * @param attachment 附件来源。
 * @returns 可注入长期记忆提示的短文本。
 */
function formatMemoryAttachmentForPrompt(attachment: AgentMemoryAttachmentPromptEntry): string {
    return [
        limitMemoryPromptField(attachment.fileName, 80),
        "(",
        limitMemoryPromptField(attachment.attachmentId, 48),
        "，",
        limitMemoryPromptField(attachment.archivePath, 160),
        ")",
    ].join("");
}

/**
 * limitMemoryPromptField：限制长期记忆提示中的来源字段长度。
 *
 * @param value 来源字段原文。
 * @param maxLength 最大保留字符数。
 * @returns 限长后的字段文本。
 */
function limitMemoryPromptField(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength)}...`;
}

/**
 * tryParseJsonArray：解析 JSON 数组字段。
 *
 * @param value JSON 字符串。
 * @returns 数组；解析失败或类型不符时返回空数组。
 */
function tryParseJsonArray(value: string): unknown[] {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed
            : [];
    } catch {
        return [];
    }
}

/**
 * buildMainAgentMemoryPrompt：把主智能体长期记忆压缩成模型系统消息。
 *
 * @param memories 主智能体最近记忆摘要。
 * @returns 系统消息正文；没有记忆时返回 null。
 */
export function buildMainAgentMemoryPrompt(memories: AgentMemoryPromptEntry[]): string | null {
    if (memories.length === 0) {
        return null;
    }

    const prompt = [
        "主智能体长期记忆：",
        ...memories.map((memory, index) => {
            const source = memory.sourceSessionId && memory.sourceTurnId
                ? `来源会话 ${memory.sourceSessionId}，轮次 ${memory.sourceTurnId}`
                : "来源未绑定";
            const memoryPathText = memory.sourceMemoryPath
                ? `；Markdown：${memory.sourceMemoryPath}`
                : "";
            const attachmentText = memory.attachments.length > 0
                ? `；附件来源：${memory.attachments.map((attachment) => {
                    return formatMemoryAttachmentForPrompt(attachment);
                }).join("、")}`
                : "";
            return `${index + 1}. 关键词：${memory.keywords}；摘要：${memory.summary}；${source}${memoryPathText}${attachmentText}`;
        }),
        "使用这些记忆理解用户偏好和历史上下文，但不要编造未写入记忆的事实。",
    ].join("\n");

    return prompt.length > MAIN_AGENT_MEMORY_PROMPT_MAX_CHARS
        ? `${prompt.slice(0, MAIN_AGENT_MEMORY_PROMPT_MAX_CHARS)}\n[长期记忆已截断]`
        : prompt;
}

