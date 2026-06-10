import {randomUUID} from "node:crypto";
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";

import {ChatAnthropic} from "@langchain/anthropic";
import {
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    type BaseMessage,
} from "@langchain/core/messages";
import {ChatOpenAI} from "@langchain/openai";
import type {ConversationMessage} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import type {
    OpenAiChatMessage,
    OpenAiChatRequest,
    OpenAiToolCall,
    OpenAiToolSpec,
    OpenAiUsage,
} from "./openai-chat-protocol.js";
import {createDataAccess} from "./data-access/index.js";
import {SessionRepository} from "./data-access/session-repository.js";
import {createAgentForTask} from "./agents/index.js";
import {
    readProviderConfig,
    readSecretValue,
    resolveProviderModelSelection,
} from "./domain/provider-domain.js";
import {listAvailableModelToolSpecsForCenter} from "./tools/index.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
} from "./domain/turn-graph-domain.js";

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

interface ResolvedProviderModelRuntime {
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

interface ProviderModelGatewayHttpResult {
    /** assistantText: 供应商返回的助手正文。 */
    assistantText: string;
    /** usage: 供应商返回的真实用量；未提供时为 null。 */
    usage: ProviderModelGatewayResult["usage"];
    /** toolCall: 供应商标准首个工具调用；未请求工具时为 null。 */
    toolCall: OpenAiToolCall | null;
    /** toolCalls: 供应商标准工具调用数组；未请求工具时为空数组。 */
    toolCalls: OpenAiToolCall[];
}

interface ProviderStreamEventContext {
    /** events: 中心服务事件仓储，收到供应商 delta 时立即追加事件。 */
    events: CenterEventStore;
    /** sessionId: 当前会话 ID，用于 WebSocket 精确推送。 */
    sessionId: string;
    /** taskId: 当前任务 ID，用于过程卡片聚合。 */
    taskId: string;
    /** turnId: 当前轮次 ID，用于过程卡片排序。 */
    turnId: string;
    /** graphCheckpoint: 当前模型节点检查点，用于断线或失败后恢复。 */
    graphCheckpoint?: TurnGraphCheckpoint;
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
}

// MAIN_AGENT_MEMORY_PROMPT_LIMIT：模型请求只注入最近几条主智能体记忆，避免长期记忆无界占用上下文。
const MAIN_AGENT_MEMORY_PROMPT_LIMIT = 5;
// MAIN_AGENT_MEMORY_PROMPT_MAX_CHARS：记忆系统消息长度上限，防止历史摘要异常膨胀。
const MAIN_AGENT_MEMORY_PROMPT_MAX_CHARS = 1200;
// SESSION_HISTORY_PROMPT_LIMIT：当前会话历史消息上限，避免模型请求被历史窗口无界撑大。
const SESSION_HISTORY_PROMPT_LIMIT = 20;

/**
 * invokeProviderModelGateway：基于中心服务供应商配置执行最小模型调用。
 *
 * @param database 中心服务数据库。
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param userText 用户输入。
 * @returns 模型网关执行结果。
 */
export async function invokeProviderModelGateway(
    database: CenterDatabase,
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    userText: string,
    graphCheckpoint?: TurnGraphCheckpoint,
): Promise<ProviderModelGatewayResult> {
    const runtime = resolveProviderModelRuntime(database, taskId);
    const mainAgentMemories = listMainAgentMemoryPromptEntries(database);
    const sessionHistoryMessages = listSessionHistoryPromptMessages(
        database,
        sessionId,
        turnId,
    );
    const sessionContextPrompt = buildSessionContextPrompt(sessionHistoryMessages);
    const tools = await listAvailableModelToolSpecsForCenter(
        runtime.centerDirectory,
        createAgentForTask(new SessionRepository(database).findTask(taskId)),
    );
    const requestPayload = buildOpenAiChatPayload(
        userText,
        runtime.provider.providerId,
        runtime.modelSelection.model,
        runtime.modelSelection.reasoningEffort,
        tools,
        mainAgentMemories,
        sessionContextPrompt,
        sessionHistoryMessages,
    );
    const result = await sendProviderOpenAiChat(runtime, requestPayload, {
        events,
        sessionId,
        taskId,
        turnId,
        graphCheckpoint,
    });

    events.append({
        eventType: "model.orchestrated",
        scopeType: "model",
        scopeId: taskId,
        sessionId: null,
        turnId,
        taskId,
        status: "completed",
        title: "模型编排",
        summary: result.toolCalls.length > 0 ? "中心服务已收到模型工具调用请求。" : "中心服务已准备模型网关调用。",
        payload: withOptionalGraphCheckpoint({
            providerId: result.providerId,
            model: result.model,
            toolCallName: result.toolCall?.name ?? null,
            toolCallCount: result.toolCalls.length,
            assistantTextPreview: result.assistantText.slice(0, 120),
        }, graphCheckpoint),
    });

    return result;
}

/**
 * continueProviderModelGatewayWithToolResults：把多个工具结果一次性回填给模型。
 *
 * @param database 中心服务数据库。
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param userText 用户原始输入。
 * @param toolResults 模型工具调用和执行结果摘要。
 * @returns 模型网关最终回复。
 */
export async function continueProviderModelGatewayWithToolResults(
    database: CenterDatabase,
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    userText: string,
    toolResults: Array<{
        toolCall: OpenAiToolCall;
        resultText: string;
    }>,
    graphCheckpoint?: TurnGraphCheckpoint,
): Promise<ProviderModelGatewayResult> {
    const runtime = resolveProviderModelRuntime(database, taskId);
    const mainAgentMemories = listMainAgentMemoryPromptEntries(database);
    const sessionHistoryMessages = listSessionHistoryPromptMessages(
        database,
        sessionId,
        turnId,
    );
    const sessionContextPrompt = buildSessionContextPrompt(sessionHistoryMessages);
    const tools = await listAvailableModelToolSpecsForCenter(
        runtime.centerDirectory,
        createAgentForTask(new SessionRepository(database).findTask(taskId)),
    );
    const requestPayload = buildOpenAiChatPayload(
        userText,
        runtime.provider.providerId,
        runtime.modelSelection.model,
        runtime.modelSelection.reasoningEffort,
        tools,
        mainAgentMemories,
        sessionContextPrompt,
        sessionHistoryMessages,
    );
    requestPayload.messages.push({
        role: "assistant",
        content: null,
        tool_calls: toolResults.map((toolResult) => {
            return toChatCompletionToolCall(toolResult.toolCall);
        }),
    });
    for (const toolResult of toolResults) {
        requestPayload.messages.push({
            role: "tool",
            content: toolResult.resultText,
            tool_call_id: toolResult.toolCall.toolCallId,
        });
    }

    events.append({
        eventType: "model.tool.result.appended",
        scopeType: "model",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "completed",
        title: "工具结果回填模型",
        summary: `已回填 ${toolResults.length} 个工具结果。`,
        payload: withOptionalGraphCheckpoint({
            toolResults: toolResults.map((toolResult) => {
                return {
                    toolCallId: toolResult.toolCall.toolCallId,
                    toolName: toolResult.toolCall.name,
                    resultSummary: toolResult.resultText.slice(0, 240),
                };
            }),
        }, graphCheckpoint),
    });

    return sendProviderOpenAiChat(runtime, requestPayload, {
        events,
        sessionId,
        taskId,
        turnId,
        graphCheckpoint,
    });
}

/**
 * resolveProviderModelRuntime：解析一次模型调用所需供应商、中心目录和模型选择。
 *
 * @param database 中心服务数据库。
 * @param taskId 任务 ID。
 * @returns 模型调用运行时上下文。
 */
function resolveProviderModelRuntime(database: CenterDatabase, taskId: string): ResolvedProviderModelRuntime {
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
 * sendProviderOpenAiChat：按 OpenAI Chat Completions 规范调用供应商协议。
 *
 * @param runtime 模型调用运行时上下文。
 * @param requestPayload OpenAI Chat Completions 请求。
 * @param streamContext 当前会话事件上下文。
 * @returns 模型网关执行结果。
 */
function sendProviderOpenAiChat(
    runtime: ResolvedProviderModelRuntime,
    requestPayload: OpenAiChatRequest,
    streamContext: ProviderStreamEventContext,
): Promise<ProviderModelGatewayResult> {
    const provider = runtime.provider;
    const modelSelection = runtime.modelSelection;
    const chatModel = createLangChainChatModel(runtime);
    return invokeLangChainChatModel(
        chatModel,
        requestPayload,
        streamContext,
        provider.capabilities.supportsStreaming,
    ).then((langChainResult) => {
        const toolCalls = langChainResult.toolCalls;
        return {
            providerId: provider.providerId,
            model: modelSelection.model,
            reasoningEffort: modelSelection.reasoningEffort,
            assistantText: langChainResult.assistantText,
            usage: langChainResult.usage ?? buildUsageSummary(readUserTextFromRequest(requestPayload), langChainResult.assistantText, provider.providerId),
            toolCall: toolCalls[0] ?? null,
            toolCalls,
        };
    });
}

/**
 * invokeLangChainChatModel：用 LangChain ChatModel 真实承载 OpenAI 或 Anthropic 模型调用。
 *
 * @param chatModel 由供应商配置初始化的 LangChain 模型实例。
 * @param requestPayload 中心服务内部 OpenAI 格式请求。
 * @param streamContext 当前会话事件上下文。
 * @returns 归一化后的助手文本、工具调用和用量。
 */
async function invokeLangChainChatModel(
    chatModel: LangChainChatModelRuntime,
    requestPayload: OpenAiChatRequest,
    streamContext: ProviderStreamEventContext,
    useStreaming: boolean,
): Promise<ProviderModelGatewayHttpResult> {
    const messages = requestPayload.messages.map(toLangChainMessage);
    const tools = requestPayload.tools.map(toLangChainToolSpec);
    // modelWithTools: 工具声明必须通过 LangChain bindTools 注入，避免继续维护 OpenAI/Anthropic 自研协议分支。
    const modelWithTools = tools.length > 0
        ? chatModel.bindTools(tools)
        : chatModel;
    if (!useStreaming) {
        return invokeLangChainChatModelOnce(
            modelWithTools,
            messages,
            streamContext,
        );
    }
    const state: {
        assistantText: string;
        hasStreamedAssistantContent: boolean;
        usage: ProviderModelGatewayResult["usage"];
        toolCallParts: Map<number, {
            toolCallId: string;
            name: string;
            argumentsText: string;
        }>;
    } = {
        assistantText: "",
        hasStreamedAssistantContent: false,
        usage: null,
        toolCallParts: new Map(),
    };

    for await (const chunk of await modelWithTools.stream(messages)) {
        applyLangChainStreamChunk(
            chunk,
            streamContext,
            state,
        );
    }

    const toolCalls = readStreamingChatCompletionToolCalls(state.toolCallParts);
    if (!hasUsableAssistantOutput(
        state.assistantText,
        toolCalls,
        state.hasStreamedAssistantContent,
    )) {
        throw new Error("PROVIDER_RESPONSE_TEXT_EMPTY");
    }
    appendProviderStreamCompleted(
        streamContext,
        state.usage,
        "langchain",
    );

    return {
        assistantText: state.assistantText,
        usage: state.usage,
        toolCall: toolCalls[0] ?? null,
        toolCalls,
    };
}

/**
 * invokeLangChainChatModelOnce：对不支持流式的供应商使用 LangChain invoke 完成一次模型调用。
 *
 * @param modelWithTools 已注入工具声明的 LangChain runnable。
 * @param messages LangChain 消息列表。
 * @param streamContext 当前会话事件上下文。
 * @returns 归一化模型结果。
 */
async function invokeLangChainChatModelOnce(
    modelWithTools: {
        invoke: (messages: BaseMessage[]) => Promise<unknown>;
    },
    messages: BaseMessage[],
    streamContext: ProviderStreamEventContext,
): Promise<ProviderModelGatewayHttpResult> {
    const response = await modelWithTools.invoke(messages);
    const responseRecord = response as {
        content?: unknown;
        usage_metadata?: unknown;
        response_metadata?: unknown;
        tool_calls?: unknown;
    };
    const assistantText = readLangChainTextContent(responseRecord.content);
    if (assistantText.length > 0) {
        appendProviderStreamDelta(
            streamContext,
            assistantText,
            "langchain",
        );
    }
    const toolCalls = readLangChainToolCalls(responseRecord.tool_calls);
    // 合法空 content 工具调用：OpenAI/兼容供应商在只请求工具时允许 assistant.content 为空。
    if (!hasUsableAssistantOutput(
        assistantText,
        toolCalls,
        assistantText.length > 0,
    )) {
        throw new Error("PROVIDER_RESPONSE_TEXT_EMPTY");
    }
    const usage = normalizeLangChainUsage(responseRecord.usage_metadata)
        ?? normalizeProviderUsage((responseRecord.response_metadata as Record<string, unknown> | undefined)?.usage);
    appendProviderStreamCompleted(
        streamContext,
        usage,
        "langchain",
    );
    return {
        assistantText,
        usage,
        toolCall: toolCalls[0] ?? null,
        toolCalls,
    };
}

/**
 * createLangChainChatModel：按供应商配置创建 LangChain ChatModel。
 *
 * @param runtime 模型调用运行时上下文。
 * @returns LangChain OpenAI 或 Anthropic ChatModel。
 */
function createLangChainChatModel(runtime: ResolvedProviderModelRuntime): LangChainChatModelRuntime {
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
        });
    }
    return new ChatOpenAI({
        apiKey,
        model,
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
function normalizeOpenAiBaseUrl(baseUrl: string): string {
    // normalizedBaseUrl: 用户可能填写服务根地址，也可能已经填写 /v1；这里统一为 LangChain ChatOpenAI 的 baseURL。
    const normalizedBaseUrl = baseUrl.replace(/\/$/u, "");
    if (normalizedBaseUrl.endsWith("/v1")) {
        return normalizedBaseUrl;
    }
    return `${normalizedBaseUrl}/v1`;
}

function extractCenterDirectory(database: CenterDatabase): string {
    return createDataAccess(database).system.readMetaValue("centerDirectory") ?? "";
}

function readProviderConfigByPriority(database: CenterDatabase, taskId: string) {
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

function buildOpenAiChatPayload(
    userText: string,
    providerId: string,
    model: string,
    reasoningEffort: string | null,
    tools: OpenAiToolSpec[],
    mainAgentMemories: AgentMemoryPromptEntry[],
    sessionContextPrompt: string,
    sessionHistoryMessages: OpenAiChatMessage[],
): OpenAiChatRequest {
    const memoryPrompt = buildMainAgentMemoryPrompt(mainAgentMemories);
    // memoryMessages: 主智能体记忆作为 system 消息注入，不改写用户本轮原文。
    const memoryMessages: OpenAiChatMessage[] = memoryPrompt
        ? [
            {
                role: "system",
                content: memoryPrompt,
            },
        ]
        : [];
    // sessionContextMessages: 当前会话统计来自 messages 表历史，不混入长期记忆和其他会话。
    const sessionContextMessages: OpenAiChatMessage[] = [
        {
            role: "system",
            content: sessionContextPrompt,
        },
    ];
    return {
        requestId: randomUUID(),
        providerId,
        model,
        reasoningEffort,
        messages: [
            ...memoryMessages,
            ...sessionContextMessages,
            ...sessionHistoryMessages,
            {
                role: "user",
                content: userText,
            },
        ],
        tools,
        stream: true,
    };
}

/**
 * listSessionHistoryPromptMessages：读取当前会话历史消息并转换为模型上下文。
 *
 * @param database 中心服务数据库。
 * @param sessionId 当前会话 ID。
 * @param turnId 当前轮次 ID。
 * @returns 可直接注入模型请求的历史消息。
 */
function listSessionHistoryPromptMessages(
    database: CenterDatabase,
    sessionId: string,
    turnId: string,
): OpenAiChatMessage[] {
    // messages: 来源是中心服务 messages 表，排除本轮当前用户消息，避免和请求尾部 userText 重复。
    const messages = new SessionRepository(database).listMessages(sessionId).filter((message) => {
        return message.turnId !== turnId;
    });
    // recentMessages: 保留最近历史，确保当前窗口内对话记忆进入模型，但不让历史无限增长。
    const recentMessages = messages.slice(-SESSION_HISTORY_PROMPT_LIMIT);
    return recentMessages.map(toSessionHistoryOpenAiMessage);
}

/**
 * toSessionHistoryOpenAiMessage：把中心服务会话消息转换成 OpenAI 消息。
 *
 * @param message 中心服务会话消息。
 * @returns OpenAI Chat Completions 消息。
 */
function toSessionHistoryOpenAiMessage(message: ConversationMessage): OpenAiChatMessage {
    // role: messages.role 是中心服务统一会话角色；OpenAI 历史上下文这里只转换普通会话历史。
    const role: OpenAiChatMessage["role"] = message.role === "assistant"
        ? "assistant"
        : message.role === "system"
            ? "system"
            : "user";
    return {
        role,
        content: message.contentMarkdown,
    };
}

type LangChainChatModelRuntime = ChatOpenAI | ChatAnthropic;

/**
 * buildSessionContextPrompt：构造当前会话统计系统提示。
 *
 * @param sessionHistoryMessages 已排除本轮用户消息的当前会话历史。
 * @returns 当前会话统计提示。
 */
function buildSessionContextPrompt(sessionHistoryMessages: OpenAiChatMessage[]): string {
    // previousUserMessageCount: 当前轮次之前同一会话内的用户消息数，用于回答“本窗口且不包括本次”的计数问题。
    const previousUserMessageCount = sessionHistoryMessages.filter((message) => {
        return message.role === "user";
    }).length;
    // previousAssistantMessageCount: 当前轮次之前同一会话内的助手回复数，用于模型理解对话窗口历史。
    const previousAssistantMessageCount = sessionHistoryMessages.filter((message) => {
        return message.role === "assistant";
    }).length;
    return [
        "当前会话上下文统计：",
        `本轮前同一会话内用户消息 ${previousUserMessageCount} 条。`,
        `本轮前同一会话内助手回复 ${previousAssistantMessageCount} 条。`,
        "用户提到“本窗口”“本次窗口”“当前会话”时，只按当前会话消息表理解，不混入长期记忆或其他会话。",
        "用户明确要求“不包括本次”时，使用本轮前同一会话内用户消息数量。",
    ].join("\n");
}

/**
 * listMainAgentMemoryPromptEntries：读取主智能体最近长期记忆摘要。
 *
 * @param database 中心服务数据库。
 * @returns 可注入模型请求的主智能体记忆摘要。
 */
function listMainAgentMemoryPromptEntries(database: CenterDatabase): AgentMemoryPromptEntry[] {
    return createDataAccess(database).workflow.listRecentAgentMemorySummaries(
        "main",
        MAIN_AGENT_MEMORY_PROMPT_LIMIT,
    ).map((memory) => {
        return {
            keywords: memory.keywords,
            summary: memory.summary,
            sourceSessionId: memory.sourceSessionId,
            sourceTurnId: memory.sourceTurnId,
        };
    });
}

/**
 * buildMainAgentMemoryPrompt：把主智能体长期记忆压缩成模型系统消息。
 *
 * @param memories 主智能体最近记忆摘要。
 * @returns 系统消息正文；没有记忆时返回 null。
 */
function buildMainAgentMemoryPrompt(memories: AgentMemoryPromptEntry[]): string | null {
    if (memories.length === 0) {
        return null;
    }

    const prompt = [
        "主智能体长期记忆：",
        ...memories.map((memory, index) => {
            const source = memory.sourceSessionId && memory.sourceTurnId
                ? `来源会话 ${memory.sourceSessionId}，轮次 ${memory.sourceTurnId}`
                : "来源未绑定";
            return `${index + 1}. 关键词：${memory.keywords || "无"}；摘要：${memory.summary || "无"}；${source}`;
        }),
        "使用这些记忆理解用户偏好和历史上下文，但不要编造未写入记忆的事实。",
    ].join("\n");

    return prompt.length > MAIN_AGENT_MEMORY_PROMPT_MAX_CHARS
        ? `${prompt.slice(0, MAIN_AGENT_MEMORY_PROMPT_MAX_CHARS)}\n[长期记忆已截断]`
        : prompt;
}

/**
 * toLangChainMessage：把中心服务内部消息转换为 LangChain 标准消息。
 *
 * @param message 中心服务内部 OpenAI 形态消息。
 * @returns LangChain 消息对象。
 */
function toLangChainMessage(message: OpenAiChatMessage): BaseMessage {
    if (message.role === "system") {
        return new SystemMessage(message.content ?? "");
    }
    if (message.role === "user") {
        return new HumanMessage(message.content ?? "");
    }
    if (message.role === "tool") {
        return new ToolMessage({
            content: message.content ?? "",
            tool_call_id: message.tool_call_id ?? randomUUID(),
        });
    }
    return new AIMessage({
        content: message.content ?? "",
        tool_calls: message.tool_calls?.map((toolCall) => {
            return {
                id: toolCall.id,
                name: toolCall.function.name,
                args: readToolArgumentsJson(toolCall.function.arguments) ?? {},
                type: "tool_call",
            };
        }) ?? [],
    });
}

/**
 * toLangChainToolSpec：把内部 OpenAI 工具声明转换为 LangChain bindTools 可接受结构。
 *
 * @param tool 中心服务工具声明。
 * @returns LangChain 工具声明对象。
 */
function toLangChainToolSpec(tool: OpenAiToolSpec): Record<string, unknown> {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parametersJsonSchema,
        },
    };
}

/**
 * applyLangChainStreamChunk：把 LangChain 流式 chunk 转换为当前中心服务事件和工具片段状态。
 *
 * @param chunk LangChain 返回的消息 chunk。
 * @param streamContext 当前事件上下文。
 * @param state 当前流式累积状态。
 * @returns 没有返回值。
 */
function applyLangChainStreamChunk(
    chunk: unknown,
    streamContext: ProviderStreamEventContext,
    state: {
        assistantText: string;
        hasStreamedAssistantContent: boolean;
        usage: ProviderModelGatewayResult["usage"];
        toolCallParts: Map<number, {
            toolCallId: string;
            name: string;
            argumentsText: string;
        }>;
    },
): void {
    const chunkRecord = chunk as {
        content?: unknown;
        usage_metadata?: unknown;
        response_metadata?: unknown;
        tool_call_chunks?: unknown;
        tool_calls?: unknown;
    };
    const textDelta = readLangChainTextContent(chunkRecord.content);
    if (textDelta.length > 0) {
        state.assistantText += textDelta;
        state.hasStreamedAssistantContent = true;
        appendProviderStreamDelta(
            streamContext,
            textDelta,
            "langchain",
        );
    }
    const usage = normalizeLangChainUsage(chunkRecord.usage_metadata)
        ?? normalizeProviderUsage((chunkRecord.response_metadata as Record<string, unknown> | undefined)?.usage);
    if (usage) {
        state.usage = usage;
    }
    appendLangChainToolCallParts(
        state.toolCallParts,
        chunkRecord.tool_call_chunks,
    );
    appendLangChainFinalToolCalls(
        state.toolCallParts,
        chunkRecord.tool_calls,
    );
}

/**
 * readLangChainTextContent：读取 LangChain 文本或分块正文。
 *
 * @param content LangChain content 字段。
 * @returns 可展示文本。
 */
function readLangChainTextContent(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }
    return content.map((item) => {
        if (typeof item === "string") {
            return item;
        }
        if (typeof item !== "object" || item === null) {
            return "";
        }
        const text = (item as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
    }).join("");
}

/**
 * appendLangChainToolCallParts：累积 LangChain 流式工具调用片段。
 *
 * @param toolCallParts 当前工具片段表。
 * @param rawToolCallChunks LangChain tool_call_chunks 字段。
 * @returns 没有返回值。
 */
function appendLangChainToolCallParts(
    toolCallParts: Map<number, {
        toolCallId: string;
        name: string;
        argumentsText: string;
    }>,
    rawToolCallChunks: unknown,
): void {
    const toolCallChunks = Array.isArray(rawToolCallChunks) ? rawToolCallChunks : [];
    for (const toolCallChunk of toolCallChunks) {
        if (typeof toolCallChunk !== "object" || toolCallChunk === null) {
            continue;
        }
        const index = typeof (toolCallChunk as { index?: unknown }).index === "number"
            ? (toolCallChunk as { index: number }).index
            : toolCallParts.size;
        const existing = toolCallParts.get(index) ?? {
            toolCallId: randomUUID(),
            name: "",
            argumentsText: "",
        };
        const nextId = typeof (toolCallChunk as { id?: unknown }).id === "string"
            ? (toolCallChunk as { id: string }).id
            : existing.toolCallId;
        const nextName = typeof (toolCallChunk as { name?: unknown }).name === "string"
            ? `${existing.name}${(toolCallChunk as { name: string }).name}`
            : existing.name;
        const argsDelta = typeof (toolCallChunk as { args?: unknown }).args === "string"
            ? (toolCallChunk as { args: string }).args
            : "";
        toolCallParts.set(
            index,
            {
                toolCallId: nextId,
                name: nextName,
                argumentsText: `${existing.argumentsText}${argsDelta}`,
            },
        );
    }
}

/**
 * appendLangChainFinalToolCalls：在非流式或最终 chunk 中补齐完整工具调用。
 *
 * @param toolCallParts 当前工具片段表。
 * @param rawToolCalls LangChain tool_calls 字段。
 * @returns 没有返回值。
 */
function appendLangChainFinalToolCalls(
    toolCallParts: Map<number, {
        toolCallId: string;
        name: string;
        argumentsText: string;
    }>,
    rawToolCalls: unknown,
): void {
    const toolCalls = Array.isArray(rawToolCalls) ? rawToolCalls : [];
    toolCalls.forEach((toolCall, index) => {
        if (typeof toolCall !== "object" || toolCall === null) {
            return;
        }
        const name = typeof (toolCall as { name?: unknown }).name === "string"
            ? (toolCall as { name: string }).name
            : "";
        const id = typeof (toolCall as { id?: unknown }).id === "string"
            ? (toolCall as { id: string }).id
            : randomUUID();
        const args = typeof (toolCall as { args?: unknown }).args === "object"
            && (toolCall as { args?: unknown }).args !== null
            ? JSON.stringify((toolCall as { args: Record<string, unknown> }).args)
            : "{}";
        if (!name) {
            return;
        }
        toolCallParts.set(
            index,
            {
                toolCallId: id,
                name,
                argumentsText: args,
            },
        );
    });
}

/**
 * readLangChainToolCalls：读取 LangChain 完整工具调用数组。
 *
 * @param rawToolCalls LangChain AIMessage.tool_calls 字段。
 * @returns 中心服务内部工具调用数组。
 */
function readLangChainToolCalls(rawToolCalls: unknown): OpenAiToolCall[] {
    const toolCalls = Array.isArray(rawToolCalls) ? rawToolCalls : [];
    return toolCalls.map((toolCall) => {
        if (typeof toolCall !== "object" || toolCall === null) {
            return null;
        }
        const name = typeof (toolCall as { name?: unknown }).name === "string"
            ? (toolCall as { name: string }).name
            : "";
        const args = typeof (toolCall as { args?: unknown }).args === "object"
            && (toolCall as { args?: unknown }).args !== null
            ? (toolCall as { args: Record<string, unknown> }).args
            : null;
        if (!name || !args) {
            return null;
        }
        return {
            toolCallId: typeof (toolCall as { id?: unknown }).id === "string"
                ? (toolCall as { id: string }).id
                : randomUUID(),
            name,
            argumentsJson: args,
        };
    }).filter((toolCall): toolCall is OpenAiToolCall => {
        return toolCall !== null;
    });
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value) as unknown;
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

/**
 * hasUsableAssistantOutput：判断供应商响应是否包含可继续执行的助手输出。
 *
 * @param assistantText 已解析出的助手自然语言文本。
 * @param toolCalls 已解析出的 OpenAI 结构化工具调用。
 * @param hasStreamedAssistantContent 本轮是否已经写入过模型流式文本事件。
 * @returns 有自然语言、合法工具调用或已流式输出时返回 true。
 */
function hasUsableAssistantOutput(
    assistantText: string,
    toolCalls: OpenAiToolCall[],
    hasStreamedAssistantContent: boolean,
): boolean {
    if (assistantText.length > 0) {
        return true;
    }
    // 合法空 content 工具调用：OpenAI 工具调用响应可以只携带 tool_calls，不携带可展示文本。
    if (toolCalls.length > 0) {
        return true;
    }
    // 已有流式片段说明前端已经收到可展示内容，不能在结束阶段误报空响应。
    return hasStreamedAssistantContent;
}

/**
 * readStreamingChatCompletionToolCalls：把累积的工具片段转为内部工具调用。
 *
 * @param toolCallParts 工具片段表。
 * @returns 工具调用数组。
 */
function readStreamingChatCompletionToolCalls(toolCallParts: Map<number, {
    toolCallId: string;
    name: string;
    argumentsText: string;
}>): OpenAiToolCall[] {
    return Array.from(toolCallParts.values()).map((part) => {
        const argumentsJson = readToolArgumentsJson(part.argumentsText);
        if (!part.name || !argumentsJson) {
            return null;
        }
        return {
            toolCallId: part.toolCallId,
            name: part.name,
            argumentsJson,
        };
    }).filter((toolCall): toolCall is OpenAiToolCall => {
        return toolCall !== null;
    });
}

/**
 * appendProviderStreamDelta：追加真实供应商 token/SSE 片段。
 *
 * @param streamContext 当前会话事件上下文。
 * @param deltaText 本次增量文本。
 * @returns 没有返回值。
 */
function appendProviderStreamDelta(
    streamContext: ProviderStreamEventContext,
    deltaText: string,
    streamSource = "provider-sse",
): void {
    if (deltaText.length === 0) {
        return;
    }
    streamContext.events.append({
        eventType: "model.stream.delta",
        scopeType: "model",
        scopeId: streamContext.taskId,
        sessionId: streamContext.sessionId,
        turnId: streamContext.turnId,
        taskId: streamContext.taskId,
        status: "running",
        title: "模型流式片段",
        summary: deltaText.slice(0, 120),
        payload: withOptionalGraphCheckpoint({
            deltaText,
            streamSource,
        }, streamContext.graphCheckpoint),
    });
}

/**
 * appendProviderStreamCompleted：追加真实供应商流式结束事件。
 *
 * @param streamContext 当前会话事件上下文。
 * @param usage 供应商返回用量。
 * @returns 没有返回值。
 */
function appendProviderStreamCompleted(
    streamContext: ProviderStreamEventContext,
    usage: ProviderModelGatewayResult["usage"],
    streamSource = "provider-sse",
): void {
    streamContext.events.append({
        eventType: "model.stream.completed",
        scopeType: "model",
        scopeId: streamContext.taskId,
        sessionId: streamContext.sessionId,
        turnId: streamContext.turnId,
        taskId: streamContext.taskId,
        status: "completed",
        title: "模型流式结束",
        summary: "真实供应商 SSE 流式输出已结束。",
        payload: withOptionalGraphCheckpoint({
            usage,
            streamSource,
        }, streamContext.graphCheckpoint),
    });
}

/**
 * readToolArgumentsJson：把供应商工具参数转换为内部 JSON 对象。
 *
 * @param rawArguments OpenAI 兼容协议中通常为 JSON 字符串的 arguments 字段。
 * @returns 解析后的参数对象；不是对象时返回 null。
 */
function readToolArgumentsJson(rawArguments: unknown): Record<string, unknown> | null {
    const parsedArguments = typeof rawArguments === "string"
        ? tryParseJsonObject(rawArguments)
        : typeof rawArguments === "object" && rawArguments !== null && !Array.isArray(rawArguments)
            ? rawArguments as Record<string, unknown>
            : null;
    if (!parsedArguments) {
        return null;
    }
    return parsedArguments;
}

function readUserTextFromRequest(request: OpenAiChatRequest): string {
    // userMessages: 模型请求现在包含当前会话历史，最后一条 user 消息才是本轮真实输入。
    const userMessages = request.messages.filter((message) => {
        return message.role === "user";
    });
    // userMessage: 本轮用户消息始终由 buildOpenAiChatPayload 追加在历史上下文之后。
    const userMessage = userMessages[userMessages.length - 1];
    return userMessage?.content ?? "";
}

function normalizeProviderUsage(rawUsage: unknown): ProviderModelGatewayResult["usage"] {
    if (typeof rawUsage !== "object" || rawUsage === null) {
        return null;
    }
    const usage = rawUsage as Record<string, unknown>;
    const inputTokens = readNumberField(usage, ["input_tokens", "prompt_tokens"]);
    const outputTokens = readNumberField(usage, ["output_tokens", "completion_tokens"]);
    const totalTokens = readNumberField(usage, ["total_tokens"]);
    const cacheHitTokens = readNestedNumberField(usage, "prompt_tokens_details", "cached_tokens")
        ?? readNumberField(usage, ["cache_hit_tokens"]);

    return {
        inputTokens,
        outputTokens,
        totalTokens,
        cacheHitTokens,
        cacheMissTokens: null,
        rawUsage,
    };
}

/**
 * normalizeLangChainUsage：转换 LangChain usage_metadata 为中心服务用量结构。
 *
 * @param rawUsage LangChain usage_metadata。
 * @returns 中心服务用量结构；没有用量时返回 null。
 */
function normalizeLangChainUsage(rawUsage: unknown): ProviderModelGatewayResult["usage"] {
    if (typeof rawUsage !== "object" || rawUsage === null) {
        return null;
    }
    const usage = rawUsage as Record<string, unknown>;
    return {
        inputTokens: readNumberField(usage, ["input_tokens"]),
        outputTokens: readNumberField(usage, ["output_tokens"]),
        totalTokens: readNumberField(usage, ["total_tokens"]),
        cacheHitTokens: readNestedNumberField(usage, "input_token_details", "cache_read"),
        cacheMissTokens: null,
        rawUsage,
    };
}

function readNumberField(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "number") {
            return value;
        }
    }
    return null;
}

function readNestedNumberField(source: Record<string, unknown>, objectKey: string, valueKey: string): number | null {
    const objectValue = source[objectKey];
    if (typeof objectValue !== "object" || objectValue === null) {
        return null;
    }
    const value = (objectValue as Record<string, unknown>)[valueKey];
    return typeof value === "number" ? value : null;
}

/**
 * toChatCompletionToolCall：把内部工具调用记录转换为 OpenAI 兼容 assistant tool_calls。
 *
 * @param toolCall OpenAI 工具调用。
 * @returns OpenAI 兼容工具调用记录。
 */
function toChatCompletionToolCall(toolCall: OpenAiToolCall): OpenAiChatMessage["tool_calls"][number] {
    return {
        id: toolCall.toolCallId,
        type: "function",
        function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.argumentsJson),
        },
    };
}

function buildUsageSummary(userText: string, assistantText: string, providerId: string): OpenAiUsage {
    return {
        inputTokens: userText.length,
        outputTokens: assistantText.length,
        totalTokens: userText.length + assistantText.length,
        cacheHitTokens: null,
        cacheMissTokens: null,
        rawUsage: {
            providerId,
            inputTextLength: userText.length,
            outputTextLength: assistantText.length,
        },
    };
}
