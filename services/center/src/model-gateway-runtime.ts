import {randomUUID} from "node:crypto";
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";

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
import {
    readProviderConfig,
    readSecretValue,
    resolveProviderModelSelection,
} from "./provider-domain.js";
import {listAvailableModelToolSpecsForCenter} from "./tool-runtime.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
} from "./turn-graph-domain.js";

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
    const tools = await listAvailableModelToolSpecsForCenter(runtime.centerDirectory);
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
    const tools = await listAvailableModelToolSpecsForCenter(runtime.centerDirectory);
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
    const gatewayRequest = buildOpenAiGatewayRequest(requestPayload);
    const apiKey = readSecretValue(
        runtime.centerDirectory,
        provider.apiKeySecretRef,
    );
    return sendOpenAiChatHttpRequest(
        provider.baseUrl,
        gatewayRequest.endpoint,
        gatewayRequest.body,
        apiKey,
        streamContext,
    ).then((httpResult) => {
        const toolCalls = httpResult.toolCalls;
        return {
            providerId: provider.providerId,
            model: modelSelection.model,
            reasoningEffort: modelSelection.reasoningEffort,
            assistantText: httpResult.assistantText,
            usage: httpResult.usage ?? buildUsageSummary(readUserTextFromRequest(requestPayload), httpResult.assistantText, provider.providerId),
            toolCall: toolCalls[0] ?? null,
            toolCalls,
        };
    });
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

function buildOpenAiGatewayRequest(request: OpenAiChatRequest) {
    return {
        endpoint: "/v1/chat/completions" as const,
        body: {
            model: request.model,
            messages: request.messages.map(toChatCompletionMessage),
            tools: request.tools.map(toChatCompletionToolSpec),
            stream: true,
            stream_options: {
                include_usage: true,
            },
        },
    };
}

async function sendOpenAiChatHttpRequest(
    baseUrl: string,
    endpoint: string,
    body: Record<string, unknown>,
    apiKey: string | null,
    streamContext: ProviderStreamEventContext,
): Promise<ProviderModelGatewayHttpResult> {
    const response = await fetch(joinProviderEndpoint(baseUrl, endpoint), {
        method: "POST",
        headers: buildProviderRequestHeaders(apiKey),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(buildProviderHttpErrorMessage(response.status, await response.text()));
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
        return readProviderSseStream(
            response,
            streamContext,
        );
    }

    return parseProviderModelResponse(await response.text());
}

/**
 * buildProviderRequestHeaders：按供应商协议构造认证请求头。
 *
 * @param apiKey 中心服务读取到的供应商密钥。
 * @returns fetch 请求头。
 */
function buildProviderRequestHeaders(apiKey: string | null): Record<string, string> {
    const headers: Record<string, string> = {
        "content-type": "application/json",
    };
    if (!apiKey) {
        return headers;
    }
    headers.authorization = `Bearer ${apiKey}`;
    return headers;
}

function buildProviderHttpErrorMessage(status: number, body: string): string {
    const parsed = tryParseJsonObject(body);
    const errorValue = typeof parsed?.error === "object" && parsed.error !== null
        ? parsed.error as Record<string, unknown>
        : null;
    const errorCode = typeof errorValue?.code === "string" ? errorValue.code : null;
    const errorMessage = typeof errorValue?.message === "string"
        ? errorValue.message
        : typeof parsed?.message === "string"
            ? parsed.message
            : body.slice(0, 240);
    return [`PROVIDER_RESPONSE_${status}`, errorCode, errorMessage]
        .filter((item) => typeof item === "string" && item.length > 0)
        .join(":");
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

function joinProviderEndpoint(baseUrl: string, endpoint: string): string {
    const normalizedBaseUrl = baseUrl.replace(/\/$/u, "");
    if (normalizedBaseUrl.endsWith("/v1") && endpoint.startsWith("/v1/")) {
        return `${normalizedBaseUrl}${endpoint.slice(3)}`;
    }
    return `${normalizedBaseUrl}${endpoint}`;
}

function parseProviderModelResponse(body: string): ProviderModelGatewayHttpResult {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const assistantText = readChatCompletionText(parsed);
    const toolCalls = readChatCompletionToolCalls(parsed);
    if (!assistantText && toolCalls.length === 0) {
        throw new Error("PROVIDER_RESPONSE_TEXT_EMPTY");
    }

    return {
        assistantText,
        usage: normalizeProviderUsage(parsed.usage),
        toolCall: toolCalls[0] ?? null,
        toolCalls,
    };
}

/**
 * applyChatCompletionsSseEvent：解析 OpenAI 兼容 chat-completions 流式事件。
 *
 * @param parsed 单个 SSE JSON 对象。
 * @param streamContext 当前事件上下文。
 * @param state 流式累积状态。
 * @returns 没有返回值。
 */
function applyChatCompletionsSseEvent(
    parsed: Record<string, unknown>,
    streamContext: ProviderStreamEventContext,
    state: {
        assistantText: string;
        usage: ProviderModelGatewayResult["usage"];
        toolCallParts: Map<number, {
            toolCallId: string;
            name: string;
            argumentsText: string;
        }>;
    },
): void {
    if (typeof parsed.usage === "object" && parsed.usage !== null) {
        state.usage = normalizeProviderUsage(parsed.usage);
    }
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    for (const choice of choices) {
        if (typeof choice !== "object" || choice === null) {
            continue;
        }
        const delta = (choice as { delta?: unknown }).delta;
        if (typeof delta !== "object" || delta === null) {
            continue;
        }
        const textDelta = (delta as { content?: unknown }).content;
        if (typeof textDelta === "string") {
            state.assistantText += textDelta;
            appendProviderStreamDelta(
                streamContext,
                textDelta,
            );
        }
        appendStreamingToolCallParts(
            state.toolCallParts,
            (delta as { tool_calls?: unknown }).tool_calls,
        );
    }
}

/**
 * appendStreamingToolCallParts：累积 chat-completions 流式工具调用片段。
 *
 * @param toolCallParts 当前工具调用片段表。
 * @param rawToolCalls delta.tool_calls 原始字段。
 * @returns 没有返回值。
 */
function appendStreamingToolCallParts(
    toolCallParts: Map<number, {
        toolCallId: string;
        name: string;
        argumentsText: string;
    }>,
    rawToolCalls: unknown,
): void {
    const toolCalls = Array.isArray(rawToolCalls) ? rawToolCalls : [];
    for (const toolCall of toolCalls) {
        if (typeof toolCall !== "object" || toolCall === null) {
            continue;
        }
        const index = typeof (toolCall as { index?: unknown }).index === "number"
            ? (toolCall as { index: number }).index
            : toolCallParts.size;
        const existing = toolCallParts.get(index) ?? {
            toolCallId: randomUUID(),
            name: "",
            argumentsText: "",
        };
        const functionValue = typeof (toolCall as { function?: unknown }).function === "object"
            && (toolCall as { function?: unknown }).function !== null
            ? (toolCall as { function: Record<string, unknown> }).function
            : {};
        const nextId = typeof (toolCall as { id?: unknown }).id === "string"
            ? (toolCall as { id: string }).id
            : existing.toolCallId;
        const nextName = typeof functionValue.name === "string"
            ? `${existing.name}${functionValue.name}`
            : existing.name;
        const nextArgumentsText = typeof functionValue.arguments === "string"
            ? `${existing.argumentsText}${functionValue.arguments}`
            : existing.argumentsText;
        toolCallParts.set(
            index,
            {
                toolCallId: nextId,
                name: nextName,
                argumentsText: nextArgumentsText,
            },
        );
    }
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
 * readProviderSseStream：读取供应商 SSE 流并汇总最终模型结果。
 *
 * @param response 供应商 fetch 响应。
 * @param streamContext 当前会话事件上下文。
 * @returns 完整助手文本、工具调用和用量。
 */
async function readProviderSseStream(
    response: Response,
    streamContext: ProviderStreamEventContext,
): Promise<ProviderModelGatewayHttpResult> {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("PROVIDER_STREAM_BODY_EMPTY");
    }

    const decoder = new TextDecoder();
    const state: {
        assistantText: string;
        usage: ProviderModelGatewayResult["usage"];
        toolCallParts: Map<number, {
            toolCallId: string;
            name: string;
            argumentsText: string;
        }>;
    } = {
        assistantText: "",
        usage: null,
        toolCallParts: new Map(),
    };
    let buffer = "";

    while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
            break;
        }
        buffer += decoder.decode(
            chunk.value,
            {
                stream: true,
            },
        );
        const splitResult = splitSseFrames(buffer);
        buffer = splitResult.remainder;
        for (const frame of splitResult.frames) {
            applyProviderSseFrame(
                frame,
                streamContext,
                state,
            );
        }
    }

    buffer += decoder.decode();
    const finalSplitResult = splitSseFrames(`${buffer}\n\n`);
    for (const frame of finalSplitResult.frames) {
        applyProviderSseFrame(
            frame,
            streamContext,
            state,
        );
    }

    const toolCalls = readStreamingChatCompletionToolCalls(state.toolCallParts);
    if (!state.assistantText && toolCalls.length === 0) {
        throw new Error("PROVIDER_RESPONSE_TEXT_EMPTY");
    }

    appendProviderStreamCompleted(
        streamContext,
        state.usage,
    );

    return {
        assistantText: state.assistantText,
        usage: state.usage,
        toolCall: toolCalls[0] ?? null,
        toolCalls,
    };
}

/**
 * splitSseFrames：把 SSE 文本缓冲拆成完整帧和剩余半帧。
 *
 * @param buffer 当前累积缓冲。
 * @returns 完整帧和剩余缓冲。
 */
function splitSseFrames(buffer: string): {
    frames: string[];
    remainder: string;
} {
    const normalized = buffer.replace(/\r\n/gu, "\n");
    const parts = normalized.split("\n\n");
    const remainder = parts.pop() ?? "";
    return {
        frames: parts.filter((frame) => {
            return frame.trim().length > 0;
        }),
        remainder,
    };
}

/**
 * applyProviderSseFrame：解析并应用单个供应商 SSE 帧。
 *
 * @param frame SSE 原始帧。
 * @param streamContext 当前事件上下文。
 * @param state 流式累积状态。
 * @returns 没有返回值。
 */
function applyProviderSseFrame(
    frame: string,
    streamContext: ProviderStreamEventContext,
    state: {
        assistantText: string;
        usage: ProviderModelGatewayResult["usage"];
        toolCallParts: Map<number, {
            toolCallId: string;
            name: string;
            argumentsText: string;
        }>;
    },
): void {
    const dataLines = frame.split("\n")
        .filter((line) => {
            return line.startsWith("data:");
        })
        .map((line) => {
            return line.slice(5).trim();
        });
    for (const dataLine of dataLines) {
        if (dataLine === "[DONE]") {
            continue;
        }
        const parsed = tryParseJsonObject(dataLine);
        if (!parsed) {
            continue;
        }
        applyChatCompletionsSseEvent(
            parsed,
            streamContext,
            state,
        );
    }
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
            streamSource: "provider-sse",
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
            streamSource: "provider-sse",
        }, streamContext.graphCheckpoint),
    });
}

function readChatCompletionText(parsed: Record<string, unknown>): string {
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const firstChoice = choices[0];
    if (typeof firstChoice === "object" && firstChoice !== null) {
        const message = (firstChoice as { message?: unknown }).message;
        if (typeof message === "object" && message !== null) {
            const content = (message as { content?: unknown }).content;
            if (typeof content === "string") {
                return content;
            }
        }
    }
    const content = Array.isArray(parsed.content) ? parsed.content : [];
    return content.map((item) => {
        if (typeof item !== "object" || item === null) {
            return "";
        }
        const text = (item as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
    }).join("");
}

/**
 * readChatCompletionToolCall：解析 OpenAI 兼容 chat-completions 标准工具调用。
 *
 * @param parsed 供应商原始响应 JSON。
 * @returns 内部模型工具调用；没有标准工具调用或参数非法时返回 null。
 */
function readChatCompletionToolCalls(parsed: Record<string, unknown>): OpenAiToolCall[] {
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const firstChoice = choices[0];
    if (typeof firstChoice !== "object" || firstChoice === null) {
        return [];
    }
    const message = (firstChoice as { message?: unknown }).message;
    if (typeof message !== "object" || message === null) {
        return [];
    }
    const toolCalls = Array.isArray((message as { tool_calls?: unknown }).tool_calls)
        ? (message as { tool_calls: unknown[] }).tool_calls
        : [];
    return toolCalls.map((toolCall) => {
        if (typeof toolCall !== "object" || toolCall === null) {
            return null;
        }
        const functionValue = (toolCall as { function?: unknown }).function;
        if (typeof functionValue !== "object" || functionValue === null) {
            return null;
        }
        const name = typeof (functionValue as { name?: unknown }).name === "string"
            ? (functionValue as { name: string }).name
            : "";
        const argumentsJson = readToolArgumentsJson((functionValue as { arguments?: unknown }).arguments);
        if (!name || !argumentsJson) {
            return null;
        }

        return {
            toolCallId: typeof (toolCall as { id?: unknown }).id === "string"
                ? (toolCall as { id: string }).id
                : randomUUID(),
            name,
            argumentsJson,
        };
    }).filter((toolCall): toolCall is OpenAiToolCall => {
        return toolCall !== null;
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

function toChatCompletionMessage(message: OpenAiChatMessage): Record<string, unknown> {
    const providerMessage: Record<string, unknown> = {
        role: message.role,
        content: message.content,
    };
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        providerMessage.tool_calls = message.tool_calls;
    }
    if (message.role === "tool" && typeof message.tool_call_id === "string") {
        providerMessage.tool_call_id = message.tool_call_id;
    }
    return providerMessage;
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

function toChatCompletionToolSpec(tool: OpenAiToolSpec): Record<string, unknown> {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parametersJsonSchema,
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
