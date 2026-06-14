import {
    mkdirSync,
    readdirSync,
} from "node:fs";
import {
    join,
} from "node:path";

import {Memory} from "mem0ai/oss";

import type {CenterEventStore} from "./events.js";
import {
    readProviderConfig,
    readSecretValue,
} from "./domain/provider-domain.js";

/**
 * Mem0MemorySource：同步到 Mem0 的来源追溯信息。
 *
 * 来源：Markdown 记忆追加和 SQLite memory_index 记录。
 * 含义：保证 Mem0 语义结果可回查到中心服务事实源。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：sourceSessionId、sourceTurnId 和 sourceMemoryPath 必须来自中心服务写入边界。
 */
export interface Mem0MemorySource {
    /**
     * agentId: 记忆所属智能体 ID。
     */
    agentId: string;

    /**
     * projectId: 项目 ID；普通对话或无项目上下文时为 null。
     */
    projectId: string | null;

    /**
     * sourceSessionId: 来源会话 ID。
     */
    sourceSessionId: string;

    /**
     * sourceTurnId: 来源轮次 ID。
     */
    sourceTurnId: string;

    /**
     * sourceMemoryPath: Markdown 记忆相对中心目录路径。
     */
    sourceMemoryPath: string;

    /**
     * sourceMemoryText: 已写入 Markdown 事实源的记忆正文摘要。
     */
    sourceMemoryText: string;
}

/**
 * Mem0MemoryEngine：中心服务 Mem0 适配层。
 *
 * 来源：中心目录和中心服务供应商策略。
 * 含义：把 Mem0 限制为本地语义索引和召回引擎。
 * 格式：运行期对象。
 * 默认值：未配置供应商网关时不启用外部 LLM/Embedding。
 * 约束：不能绕过中心服务供应商网关直接读取客户端密钥。
 */
export interface Mem0MemoryEngine {
    /**
     * enabled: Mem0 语义抽取是否启用。
     */
    enabled: boolean;

    /**
     * mem0Directory: Mem0 本地索引目录，固定在中心目录 memory/mem0 下。
     */
    mem0Directory: string;

    /**
     * historyDbPath: Mem0 history SQLite 路径。
     */
    historyDbPath: string;

    /**
     * vectorDbPath: Mem0 本地向量 SQLite 路径。
     */
    vectorDbPath: string;

    /**
     * memory: Mem0 OSS 实例；未启用时为 null。
     */
    memory: Memory | null;
}

/**
 * Mem0SearchMemoryRecord：中心服务消费的 Mem0 检索结果。
 */
export interface Mem0SearchMemoryRecord {
    /** memory: Mem0 召回出的记忆正文。 */
    memory: string;
    /** score: Mem0 召回分数，没有时为 null。 */
    score: number | null;
    /** metadata: Mem0 记忆元数据。 */
    metadata: Record<string, unknown>;
}

/**
 * createMem0MemoryEngine：创建 Mem0 OSS 本地语义记忆引擎。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param enabled 是否允许 Mem0 调用中心服务明确配置的 LLM/Embedding。
 * @returns Mem0 适配层。
 */
export function createMem0MemoryEngine(
    centerDirectory: string,
    enabled = false,
): Mem0MemoryEngine {
    // mem0Directory: 明确使用架构约束的 memory/mem0，避免第三方库默认目录破坏整体迁移。
    const mem0Directory = join(
        centerDirectory,
        "memory",
        "mem0",
    );
    const historyDbPath = join(
        mem0Directory,
        "history.sqlite",
    );
    const vectorDbPath = join(
        mem0Directory,
        "vector.sqlite",
    );
    mkdirSync(mem0Directory, {
        recursive: true,
    });

    if (!enabled) {
        return {
            enabled: false,
            mem0Directory,
            historyDbPath,
            vectorDbPath,
            memory: null,
        };
    }

    const providerConfig = resolveMem0ProviderConfig(centerDirectory);
    if (!providerConfig) {
        return {
            enabled: false,
            mem0Directory,
            historyDbPath,
            vectorDbPath,
            memory: null,
        };
    }
    const memory = new Memory({
        embedder: {
            provider: "openai",
            config: {
                apiKey: providerConfig.apiKey,
                baseURL: providerConfig.baseUrl,
                model: providerConfig.embeddingModel,
                embeddingDims: 1536,
            },
        },
        vectorStore: {
            provider: "memory",
            config: {
                dbPath: vectorDbPath,
                dimension: 1536,
            },
        },
        llm: {
            provider: "openai",
            config: {
                apiKey: providerConfig.apiKey,
                baseURL: providerConfig.baseUrl,
                model: providerConfig.chatModel,
            },
        },
        historyStore: {
            provider: "sqlite",
            config: {
                historyDbPath,
            },
        },
    });

    return {
        enabled: true,
        mem0Directory,
        historyDbPath,
        vectorDbPath,
        memory,
    };
}

/**
 * syncTurnMemoryToMem0：把已落地的 Markdown 记忆同步到 Mem0。
 *
 * @param events 中心服务事件事实源。
 * @param centerDirectory 中心目录绝对路径。
 * @param source 记忆来源追溯信息。
 * @returns 同步完成后没有返回值。
 */
export async function syncTurnMemoryToMem0(
    events: CenterEventStore,
    centerDirectory: string,
    source: Mem0MemorySource,
): Promise<void> {
    const engine = createMem0MemoryEngine(
        centerDirectory,
        true,
    );
    if (engine.memory) {
        try {
            await engine.memory.add(
                source.sourceMemoryText,
                {
                    agentId: source.agentId,
                    runId: source.sourceTurnId,
                    metadata: {
                        projectId: source.projectId,
                        sourceSessionId: source.sourceSessionId,
                        sourceTurnId: source.sourceTurnId,
                        sourceMemoryPath: source.sourceMemoryPath,
                    },
                    infer: false,
                },
            );
            events.append({
                eventType: "memory.mem0.synced",
                scopeType: "memory",
                scopeId: source.sourceTurnId,
                sessionId: source.sourceSessionId,
                turnId: source.sourceTurnId,
                taskId: null,
                agentId: source.agentId,
                projectId: source.projectId,
                status: "completed",
                title: "Mem0 语义记忆同步完成",
                summary: "Markdown 长期记忆已同步到 Mem0 本地索引。",
                payload: {
                    mem0Directory: engine.mem0Directory,
                    historyDbPath: engine.historyDbPath,
                    vectorDbPath: engine.vectorDbPath,
                    sourceSessionId: source.sourceSessionId,
                    sourceTurnId: source.sourceTurnId,
                    sourceMemoryPath: source.sourceMemoryPath,
                },
            });
            return;
        } catch (error) {
            const errorMessage = error instanceof Error
                ? error.message
                : "MEM0_SYNC_FAILED";
            events.append({
                eventType: "memory.mem0.failed",
                scopeType: "memory",
                scopeId: source.sourceTurnId,
                sessionId: source.sourceSessionId,
                turnId: source.sourceTurnId,
                taskId: null,
                agentId: source.agentId,
                projectId: source.projectId,
                status: "failed",
                title: "Mem0 语义记忆同步失败",
                summary: errorMessage,
                payload: {
                    mem0Directory: engine.mem0Directory,
                    historyDbPath: engine.historyDbPath,
                    vectorDbPath: engine.vectorDbPath,
                    sourceSessionId: source.sourceSessionId,
                    sourceTurnId: source.sourceTurnId,
                    sourceMemoryPath: source.sourceMemoryPath,
                },
            });
        }
    }
    events.append({
        eventType: "memory.mem0.skipped",
        scopeType: "memory",
        scopeId: source.sourceTurnId,
        sessionId: source.sourceSessionId,
        turnId: source.sourceTurnId,
        taskId: null,
        agentId: source.agentId,
        projectId: source.projectId,
        status: "completed",
        title: "Mem0 语义记忆同步跳过",
        summary: "Mem0 OSS 适配层已初始化本地目录，当前未配置中心服务供应商网关，避免绕过中心服务直接调用外部 LLM/Embedding。",
        payload: {
            mem0Directory: engine.mem0Directory,
            historyDbPath: engine.historyDbPath,
            vectorStore: {
                provider: "memory",
                config: {
                    dbPath: engine.vectorDbPath,
                },
            },
            sourceSessionId: source.sourceSessionId,
            sourceTurnId: source.sourceTurnId,
            sourceMemoryPath: source.sourceMemoryPath,
        },
    });
}

/**
 * searchSemanticMemories：按语义检索 Mem0 记忆。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param query 检索文本。
 * @returns 当前未启用时返回空数组。
 */
export async function searchSemanticMemories(
    centerDirectory: string,
    query: string,
): Promise<Mem0SearchMemoryRecord[]> {
    const engine = createMem0MemoryEngine(
        centerDirectory,
        true,
    );
    if (!engine.memory) {
        return [];
    }

    try {
        const result = await engine.memory.search(
            query,
            {
                filters: {
                    agent_id: "main",
                },
                topK: 8,
            },
        );
        return Array.isArray(result.results)
            ? result.results.map((item) => {
                const typedItem = item as {
                    memory?: string;
                    score?: number;
                    metadata?: Record<string, unknown>;
                };
                return {
                    memory: typedItem.memory ?? "",
                    score: typeof typedItem.score === "number"
                        ? typedItem.score
                        : null,
                    metadata: typedItem.metadata ?? {},
                };
            }).filter((item) => {
                return item.memory.trim().length > 0;
            })
            : [];
    } catch {
        return [];
    }
}

/**
 * resolveMem0ProviderConfig：从中心服务当前启用供应商构造 Mem0 所需的显式模型配置。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 可用时返回模型配置；不可用时返回 null。
 */
function resolveMem0ProviderConfig(centerDirectory: string): {
    apiKey: string;
    baseUrl: string;
    chatModel: string;
    embeddingModel: string;
} | null {
    const providersDirectory = join(
        centerDirectory,
        "providers",
    );
    try {
        const providerFiles = readdirSync(providersDirectory)
            .filter((fileName: string) => {
                return fileName.endsWith(".json")
                    && !fileName.endsWith(".models.json")
                    && !fileName.endsWith(".patch.json");
            })
            .sort();
        for (const fileName of providerFiles) {
            const providerId = fileName.replace(/\.json$/u, "");
            const provider = readProviderConfig(
                centerDirectory,
                providerId,
            );
            if (!provider?.enabled) {
                continue;
            }
            const apiKey = readSecretValue(
                centerDirectory,
                provider.apiKeySecretRef,
            );
            if (!apiKey) {
                continue;
            }
            return {
                apiKey,
                baseUrl: normalizeMem0ProviderBaseUrl(provider.baseUrl),
                chatModel: provider.defaultModel || "gpt-5-mini",
                embeddingModel: "text-embedding-3-small",
            };
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * normalizeMem0ProviderBaseUrl：把中心服务供应商地址规整为 Mem0 OpenAI 兼容配置。
 *
 * @param baseUrl 供应商基础地址。
 * @returns 以 /v1 结尾的基础地址。
 */
function normalizeMem0ProviderBaseUrl(baseUrl: string): string {
    const normalizedBaseUrl = baseUrl.replace(/\/$/u, "");
    return normalizedBaseUrl.endsWith("/v1")
        ? normalizedBaseUrl
        : `${normalizedBaseUrl}/v1`;
}
