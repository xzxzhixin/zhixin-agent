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
import {
    searchSemanticMemories,
} from "./memory-engine.js";
import {listAvailableModelToolSpecsForCenter} from "./tools/index.js";
import {
    buildLangChainToolChoiceCallOptions,
    COMMAND_TOOL_INTERNAL_ID,
    COMMAND_TOOL_MODEL_NAME,
    hasCommandToolAvailable,
    type LangChainToolChoiceCallOptions,
} from "./tools/tool-choice-policy.js";
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

interface LangChainContentParts {
    /** assistantText: 供应商明确返回的助手回复正文。 */
    assistantText: string;
    /** publicThinkingText: 供应商明确标记可公开的 reasoning/thinking 摘要。 */
    publicThinkingText: string;
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

interface LangChainToolCallPart {
    /** order: 工具调用在供应商响应中的顺序，用于最终按原顺序执行。 */
    order: number;
    /** toolCallId: 工具调用 ID；供应商未返回时使用本地 UUID 保证后续工具结果可关联。 */
    toolCallId: string;
    /** name: 工具名称；流式片段可能分段返回，需要持续累积。 */
    name: string;
    /** argumentsText: 工具参数 JSON 文本；流式片段按原始顺序拼接后再解析。 */
    argumentsText: string;
}

interface LangChainMessageLikeRecord {
    /** content: LangChain 消息文本或多段内容。 */
    content?: unknown;
    /** usage_metadata: LangChain 标准用量字段。 */
    usage_metadata?: unknown;
    /** response_metadata: LangChain 供应商响应元数据。 */
    response_metadata?: unknown;
    /** tool_call_chunks: LangChain snake_case 流式工具调用片段。 */
    tool_call_chunks?: unknown;
    /** toolCallChunks: LangChain camelCase 流式工具调用片段。 */
    toolCallChunks?: unknown;
    /** tool_calls: LangChain snake_case 完整工具调用。 */
    tool_calls?: unknown;
    /** toolCalls: LangChain camelCase 完整工具调用。 */
    toolCalls?: unknown;
    /** additional_kwargs: LangChain 透传供应商原始附加字段。 */
    additional_kwargs?: unknown;
    /** additionalKwargs: 少数运行时序列化后可能出现的 camelCase 附加字段。 */
    additionalKwargs?: unknown;
}

interface LangChainRunnableWithTools {
    /** invoke: 非流式模型调用入口。 */
    invoke: (messages: BaseMessage[], options?: LangChainToolChoiceCallOptions) => Promise<unknown>;
    /** stream: 流式模型调用入口。 */
    stream: (messages: BaseMessage[], options?: LangChainToolChoiceCallOptions) => Promise<AsyncIterable<unknown>>;
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

// MAIN_AGENT_MEMORY_PROMPT_LIMIT：模型请求只注入有限主智能体记忆候选，避免长期记忆无界占用上下文。
const MAIN_AGENT_MEMORY_PROMPT_LIMIT = 12;
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
    const mainAgentMemories = await listMainAgentMemoryPromptEntries(
        database,
        userText,
    );
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
    const mainAgentMemories = await listMainAgentMemoryPromptEntries(
        database,
        userText,
    );
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
        // toolCallId: 每个工具结果单独写事件，前端才能把回填过程放回对应工具调用卡片内部。
        events.append({
            eventType: "model.tool.result.appended",
            scopeType: "model",
            scopeId: taskId,
            sessionId,
            turnId,
            taskId,
            status: "completed",
            title: "工具结果回填模型",
            summary: `已回填工具结果：${toolResult.toolCall.name}`,
            payload: withOptionalGraphCheckpoint({
                toolCallId: toolResult.toolCall.toolCallId,
                toolName: toolResult.toolCall.name,
                resultSummary: toolResult.resultText.slice(0, 240),
            }, graphCheckpoint),
        });
        requestPayload.messages.push({
            role: "tool",
            content: toolResult.resultText,
            tool_call_id: toolResult.toolCall.toolCallId,
        });
    }

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
        ? chatModel.bindTools(tools) as LangChainRunnableWithTools
        : chatModel as LangChainRunnableWithTools;
    const callOptions = buildLangChainToolChoiceCallOptions(
        requestPayload.tools,
        requestPayload.messages,
        readUserTextFromRequest(requestPayload),
    );
    if (!useStreaming) {
        return invokeLangChainChatModelOnce(
            modelWithTools,
            messages,
            streamContext,
            callOptions,
        );
    }
    const state: {
        assistantText: string;
        publicThinkingText: string;
        hasStreamedAssistantContent: boolean;
        hasStreamedPublicThinking: boolean;
        usage: ProviderModelGatewayResult["usage"];
        toolCallParts: Map<string, LangChainToolCallPart>;
    } = {
        assistantText: "",
        publicThinkingText: "",
        hasStreamedAssistantContent: false,
        hasStreamedPublicThinking: false,
        usage: null,
        toolCallParts: new Map(),
    };

    for await (const chunk of await modelWithTools.stream(messages, callOptions)) {
        applyLangChainStreamChunk(
            chunk,
            streamContext,
            state,
        );
    }
    if (state.hasStreamedPublicThinking) {
        appendProviderPublicThinkingCompleted(
            streamContext,
            state.publicThinkingText,
            "langchain",
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
    modelWithTools: LangChainRunnableWithTools,
    messages: BaseMessage[],
    streamContext: ProviderStreamEventContext,
    callOptions: LangChainToolChoiceCallOptions,
): Promise<ProviderModelGatewayHttpResult> {
    const response = await modelWithTools.invoke(messages, callOptions);
    const responseRecord = response as LangChainMessageLikeRecord;
    const contentParts = readLangChainContentParts(responseRecord.content);
    if (contentParts.publicThinkingText.length > 0) {
        appendProviderPublicThinkingDelta(
            streamContext,
            contentParts.publicThinkingText,
            "langchain",
        );
        appendProviderPublicThinkingCompleted(
            streamContext,
            contentParts.publicThinkingText,
            "langchain",
        );
    }
    if (contentParts.assistantText.length > 0) {
        appendProviderStreamDelta(
            streamContext,
            contentParts.assistantText,
            "langchain",
        );
    }
    const toolCalls = readLangChainToolCalls(readLangChainFinalToolCalls(responseRecord));
    // 合法空 content 工具调用：OpenAI/兼容供应商在只请求工具时允许 assistant.content 为空。
    if (!hasUsableAssistantOutput(
        contentParts.assistantText,
        toolCalls,
        contentParts.assistantText.length > 0,
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
        assistantText: contentParts.assistantText,
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
        {
            role: "system",
            content: buildToolCallingPolicyPrompt(tools),
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
 * buildToolCallingPolicyPrompt：构造模型工具调用约束提示。
 *
 * @param tools 当前模型可见工具定义。
 * @returns 工具调用约束提示。
 */
function buildToolCallingPolicyPrompt(tools: OpenAiToolSpec[]): string {
    const commandToolAvailable = hasCommandToolAvailable(tools);
    const commandPolicy = commandToolAvailable
        ? `用户明确要求使用命令工具、执行命令、查看本机环境、读取 Node/pnpm/npm/git 等本机版本或让你实际检查系统状态时，必须调用 \`${COMMAND_TOOL_MODEL_NAME}\` 结构化工具；不要只回复代码块、命令文本或说自己可以执行。`
        : "当前模型没有可用命令工具；不得声称已经执行本机命令。";
    return [
        "工具调用规则：",
        commandPolicy,
        "如果需要调用工具，必须通过供应商结构化 tool_calls 返回工具名和 JSON 参数；不要用自然语言、Markdown 代码块或伪 JSON 代替工具调用。",
        "工具调用参数必须满足工具 schema；命令工具必须提供 shellCommand 或 executablePath，缺失时中心服务会返回可展示的工具失败。",
    ].join("\n");
}

/**
 * listSessionHistoryPromptMessages：读取当前会话历史消息并转换为模型上下文。
 *
 * @param database 中心服务数据库。
 * @param sessionId 当前会话 ID。
 * @param turnId 当前轮次 ID。
 * @returns 可直接注入模型请求的历史消息。
 */
export function listSessionHistoryPromptMessages(
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
    return !looksLikeIncorrectIdentityAnswer(normalizedSummary);
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
    if (normalizedSummary.includes("作者") || normalizedSummary.includes("喜欢") || normalizedSummary.includes("称呼")) {
        score += 10;
    }
    if (looksLikePreferenceMemory(normalizedSummary)) {
        score += 25;
    }
    if (looksLikeIdentityMemory(normalizedSummary)) {
        score += 25;
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
    if (normalizedUserText.length === 0) {
        return "用户长期偏好 稳定事实 历史设定 常用称呼";
    }
    if (looksLikeIdentityQuestion(normalizedUserText)) {
        return `${normalizedUserText} 用户长期偏好 稳定事实 常用称呼 自称方式 身份记录`;
    }
    return `${normalizedUserText} 用户长期偏好 稳定事实 历史上下文`;
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
    const terms = new Set<string>();
    if (normalizedUserText.length > 0) {
        terms.add(normalizedUserText);
    }
    if (looksLikeIdentityQuestion(normalizedUserText)) {
        [
            "你叫什么",
            "我叫什么",
            "我是谁",
            "徐志翔",
            "致心",
            "更喜欢你叫",
        ].forEach((term) => {
            terms.add(term);
        });
    }
    return Array.from(terms);
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
    if (looksLikePreferenceMemory(summary)) {
        score += 25;
    }
    if (looksLikeIdentityMemory(summary)) {
        score += 25;
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
    const lowSignalPatterns = [
        "请只回复",
        "收到。",
        "收到",
        "实时刷新验证",
        "回归验证",
        "数据库恢复",
        "完成事件复测",
        "桌面壳实时刷新验证",
    ];
    return lowSignalPatterns.some((pattern) => {
        return summary.includes(pattern);
    });
}

/**
 * looksLikeIncorrectIdentityAnswer：识别不应固化或继续召回的错误身份答复。
 *
 * @param summary 长期记忆摘要。
 * @returns 明显属于错误或空洞身份答复时返回 true。
 */
function looksLikeIncorrectIdentityAnswer(summary: string): boolean {
    const incorrectIdentityPatterns = [
        "不知道你的真实身份",
        "不知道你的姓名",
        "无法确认你的真实身份",
        "无法确认你的姓名",
        "我叫 ChatGPT",
        "我是 ChatGPT",
    ];
    return incorrectIdentityPatterns.some((pattern) => {
        return summary.includes(pattern);
    });
}

/**
 * looksLikePreferenceMemory：识别用户对名称、称呼或偏好的长期记忆。
 *
 * @param summary 长期记忆摘要。
 * @returns 与偏好或称呼直接相关时返回 true。
 */
function looksLikePreferenceMemory(summary: string): boolean {
    const preferencePatterns = [
        "我更喜欢",
        "喜欢你叫",
        "称呼",
        "自称",
        "名字",
        "叫我",
        "叫你",
    ];
    return preferencePatterns.some((pattern) => {
        return summary.includes(pattern);
    });
}

/**
 * looksLikeIdentityMemory：识别用户或助手身份相关的长期记忆。
 *
 * @param summary 长期记忆摘要。
 * @returns 与身份、姓名、自我介绍相关时返回 true。
 */
function looksLikeIdentityMemory(summary: string): boolean {
    const identityPatterns = [
        "我是谁",
        "你是谁",
        "你叫什么",
        "我叫什么",
        "名字",
        "姓名",
        "身份",
    ];
    return identityPatterns.some((pattern) => {
        return summary.includes(pattern);
    });
}

/**
 * looksLikeIdentityQuestion：识别当前问题是否在询问身份、姓名或称呼。
 *
 * @param userText 用户本轮输入。
 * @returns 属于身份类问题时返回 true。
 */
function looksLikeIdentityQuestion(userText: string): boolean {
    const identityQuestionPatterns = [
        "我是谁",
        "你是谁",
        "你叫什么",
        "我叫什么",
        "怎么称呼你",
        "怎么叫你",
        "叫什么名字",
        "名字",
        "称呼",
    ];
    return identityQuestionPatterns.some((pattern) => {
        return userText.includes(pattern);
    });
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
        publicThinkingText: string;
        hasStreamedAssistantContent: boolean;
        hasStreamedPublicThinking: boolean;
        usage: ProviderModelGatewayResult["usage"];
        toolCallParts: Map<string, LangChainToolCallPart>;
    },
): void {
    const chunkRecord = chunk as LangChainMessageLikeRecord;
    const contentParts = readLangChainContentParts(chunkRecord.content);
    if (contentParts.publicThinkingText.length > 0) {
        state.publicThinkingText += contentParts.publicThinkingText;
        state.hasStreamedPublicThinking = true;
        appendProviderPublicThinkingDelta(
            streamContext,
            contentParts.publicThinkingText,
            "langchain",
        );
    }
    if (contentParts.assistantText.length > 0) {
        state.assistantText += contentParts.assistantText;
        state.hasStreamedAssistantContent = true;
        appendProviderStreamDelta(
            streamContext,
            contentParts.assistantText,
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
        readLangChainToolCallChunks(chunkRecord),
    );
    appendLangChainFinalToolCalls(
        state.toolCallParts,
        readLangChainFinalToolCalls(
            chunkRecord,
            false,
        ),
    );
}

/**
 * readLangChainContentParts：拆分 LangChain 助手正文和供应商公开思考。
 *
 * @param content LangChain content 字段。
 * @returns 普通助手正文和公开思考正文。
 */
function readLangChainContentParts(content: unknown): LangChainContentParts {
    if (typeof content === "string") {
        return {
            assistantText: content,
            publicThinkingText: "",
        };
    }
    if (!Array.isArray(content)) {
        return {
            assistantText: "",
            publicThinkingText: "",
        };
    }
    const parts = content.map((item): LangChainContentParts => {
        if (typeof item === "string") {
            return {
                assistantText: item,
                publicThinkingText: "",
            };
        }
        if (typeof item !== "object" || item === null) {
            return {
                assistantText: "",
                publicThinkingText: "",
            };
        }
        const itemRecord = item as Record<string, unknown>;
        const contentType = typeof itemRecord.type === "string"
            ? itemRecord.type
            : "";
        if (isPublicThinkingContentType(contentType)) {
            return {
                assistantText: "",
                publicThinkingText: readPublicThinkingContentBlockText(itemRecord),
            };
        }
        const text = itemRecord.text;
        return {
            assistantText: typeof text === "string" ? text : "",
            publicThinkingText: "",
        };
    });
    return {
        assistantText: parts.map((part) => {
            return part.assistantText;
        }).join(""),
        publicThinkingText: parts.map((part) => {
            return part.publicThinkingText;
        }).join(""),
    };
}

/**
 * isPublicThinkingContentType：判断内容块是否是供应商明确公开的思考摘要。
 *
 * @param contentType LangChain 或供应商透传内容块类型。
 * @returns 明确为 thinking/reasoning 类型时返回 true。
 */
function isPublicThinkingContentType(contentType: string): boolean {
    return [
        "thinking",
        "reasoning",
        "reasoning_text",
        "reasoning_content",
    ].includes(contentType);
}

/**
 * readPublicThinkingContentBlockText：读取公开思考内容块文本。
 *
 * @param itemRecord LangChain 内容块。
 * @returns 供应商明确返回的公开思考文本。
 */
function readPublicThinkingContentBlockText(itemRecord: Record<string, unknown>): string {
    // thinking/text/summary: 这些字段分别对应 Anthropic thinking 块、通用 reasoning 文本块和公开摘要块。
    for (const key of [
        "thinking",
        "text",
        "summary",
    ]) {
        const value = itemRecord[key];
        if (typeof value === "string") {
            return value;
        }
    }
    return "";
}

/**
 * readLangChainToolCallChunks：兼容读取 LangChain 流式工具调用片段。
 *
 * @param chunkRecord LangChain 流式消息 chunk。
 * @returns 工具调用片段数组；没有工具调用时返回空数组。
 */
function readLangChainToolCallChunks(chunkRecord: LangChainMessageLikeRecord): unknown[] {
    const additionalKwargs = readLangChainAdditionalKwargs(chunkRecord);
    const langChainChunks = mergeUnknownArrays(
        chunkRecord.tool_call_chunks,
        chunkRecord.toolCallChunks,
    );
    if (langChainChunks.length > 0) {
        return langChainChunks;
    }
    return mergeUnknownArrays(
        // 流式场景里 additional_kwargs.tool_calls 常是 OpenAI 原始 delta 片段，必须按片段累积。
        additionalKwargs?.tool_calls,
        additionalKwargs?.toolCalls,
        additionalKwargs?.tool_call_chunks,
        additionalKwargs?.toolCallChunks,
    );
}

/**
 * readLangChainFinalToolCalls：兼容读取 LangChain 完整工具调用。
 *
 * @param messageRecord LangChain 消息或消息 chunk。
 * @param includeAdditionalKwargs 是否读取供应商原始附加字段；流式片段必须关闭，避免把半截 delta 当完整调用。
 * @returns 完整工具调用数组；没有工具调用时返回空数组。
 */
function readLangChainFinalToolCalls(
    messageRecord: LangChainMessageLikeRecord,
    includeAdditionalKwargs = true,
): unknown[] {
    const additionalKwargs = includeAdditionalKwargs
        ? readLangChainAdditionalKwargs(messageRecord)
        : null;
    return firstNonEmptyUnknownArray(
        messageRecord.tool_calls,
        messageRecord.toolCalls,
        additionalKwargs?.tool_calls,
        additionalKwargs?.toolCalls,
    );
}

/**
 * readLangChainAdditionalKwargs：读取 LangChain 透传供应商原始字段。
 *
 * @param messageRecord LangChain 消息或消息 chunk。
 * @returns 附加字段对象；不存在或格式错误时返回 null。
 */
function readLangChainAdditionalKwargs(messageRecord: LangChainMessageLikeRecord): Record<string, unknown> | null {
    const additionalKwargs = typeof messageRecord.additional_kwargs === "object"
        && messageRecord.additional_kwargs !== null
        ? messageRecord.additional_kwargs as Record<string, unknown>
        : typeof messageRecord.additionalKwargs === "object" && messageRecord.additionalKwargs !== null
            ? messageRecord.additionalKwargs as Record<string, unknown>
            : null;
    return additionalKwargs;
}

/**
 * firstNonEmptyUnknownArray：返回候选字段中的首个非空数组。
 *
 * @param candidates 可能携带数组的字段列表。
 * @returns 首个非空数组；全部不匹配或为空时返回空数组。
 */
function firstNonEmptyUnknownArray(...candidates: unknown[]): unknown[] {
    for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.length > 0) {
            return candidate;
        }
    }
    return [];
}

/**
 * mergeUnknownArrays：合并候选字段中的数组。
 *
 * @param candidates 可能携带数组的字段列表。
 * @returns 合并后的数组；不存在数组时返回空数组。
 */
function mergeUnknownArrays(...candidates: unknown[]): unknown[] {
    return candidates.flatMap((candidate) => {
        return Array.isArray(candidate) ? candidate : [];
    });
}

/**
 * appendLangChainToolCallParts：累积 LangChain 流式工具调用片段。
 *
 * @param toolCallParts 当前工具片段表。
 * @param toolCallChunks LangChain 工具调用片段数组。
 * @returns 没有返回值。
 */
function appendLangChainToolCallParts(
    toolCallParts: Map<string, LangChainToolCallPart>,
    toolCallChunks: unknown[],
): void {
    toolCallChunks.forEach((toolCallChunk, fallbackIndex) => {
        if (typeof toolCallChunk !== "object" || toolCallChunk === null) {
            return;
        }
        const toolCallId = typeof (toolCallChunk as { id?: unknown }).id === "string"
            ? (toolCallChunk as { id: string }).id
            : "";
        const chunkIndex = typeof (toolCallChunk as { index?: unknown }).index === "number"
            ? (toolCallChunk as { index: number }).index
            : null;
        // key: 优先用 index 保持供应商顺序；无 index 时用 id 合并同一调用片段，最后才按当前片段序号兜底。
        const key = chunkIndex !== null
            ? `index:${chunkIndex}`
            : toolCallId
                ? `id:${toolCallId}`
                : `fallback:${fallbackIndex}`;
        const existing = toolCallParts.get(key) ?? {
            order: chunkIndex ?? fallbackIndex,
            toolCallId: randomUUID(),
            name: "",
            argumentsText: "",
        };
        const nextId = toolCallId || existing.toolCallId;
        const nameDelta = readLangChainToolName(toolCallChunk);
        const nextName = nameDelta
            ? `${existing.name}${nameDelta}`
            : existing.name;
        const argsDelta = readLangChainToolArgumentsTextDelta(toolCallChunk);
        toolCallParts.set(
            key,
            {
                order: existing.order,
                toolCallId: nextId,
                name: nextName,
                argumentsText: `${existing.argumentsText}${argsDelta}`,
            },
        );
    });
}

/**
 * appendLangChainFinalToolCalls：在非流式或最终 chunk 中补齐完整工具调用。
 *
 * @param toolCallParts 当前工具片段表。
 * @param rawToolCalls LangChain tool_calls 字段。
 * @returns 没有返回值。
 */
function appendLangChainFinalToolCalls(
    toolCallParts: Map<string, LangChainToolCallPart>,
    toolCalls: unknown[],
): void {
    toolCalls.forEach((toolCall, index) => {
        if (typeof toolCall !== "object" || toolCall === null) {
            return;
        }
        const name = readLangChainToolName(toolCall);
        const id = typeof (toolCall as { id?: unknown }).id === "string"
            ? (toolCall as { id: string }).id
            : randomUUID();
        const args = readLangChainToolArgumentsText(toolCall);
        if (!name || args === null) {
            return;
        }
        toolCallParts.set(
            `final:${index}`,
            {
                order: index,
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
        const name = readLangChainToolName(toolCall);
        const args = readLangChainToolArgumentsObject(toolCall);
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

/**
 * readLangChainToolName：读取 LangChain 或 OpenAI 原始工具调用名称。
 *
 * @param toolCall 工具调用对象。
 * @returns 工具名称；不存在时返回空字符串。
 */
function readLangChainToolName(toolCall: object): string {
    if (typeof (toolCall as { name?: unknown }).name === "string") {
        return (toolCall as { name: string }).name;
    }
    const functionRecord = readLangChainToolFunctionRecord(toolCall);
    return typeof functionRecord?.name === "string" ? functionRecord.name : "";
}

/**
 * readLangChainToolArgumentsTextDelta：读取流式工具参数增量。
 *
 * @param toolCallChunk 工具调用片段对象。
 * @returns 本片段参数文本；没有参数片段时返回空字符串。
 */
function readLangChainToolArgumentsTextDelta(toolCallChunk: object): string {
    const args = (toolCallChunk as { args?: unknown }).args;
    if (typeof args === "string") {
        return args;
    }
    const functionRecord = readLangChainToolFunctionRecord(toolCallChunk);
    return typeof functionRecord?.arguments === "string" ? functionRecord.arguments : "";
}

/**
 * readLangChainToolArgumentsText：读取完整工具参数 JSON 文本。
 *
 * @param toolCall 工具调用对象。
 * @returns 工具参数 JSON 文本；没有参数时返回 null。
 */
function readLangChainToolArgumentsText(toolCall: object): string | null {
    const args = (toolCall as { args?: unknown }).args;
    if (typeof args === "string") {
        return args;
    }
    if (typeof args === "object" && args !== null && !Array.isArray(args)) {
        return JSON.stringify(args);
    }
    const functionRecord = readLangChainToolFunctionRecord(toolCall);
    if (typeof functionRecord?.arguments === "string") {
        return functionRecord.arguments;
    }
    return null;
}

/**
 * readLangChainToolArgumentsObject：读取并解析完整工具参数对象。
 *
 * @param toolCall 工具调用对象。
 * @returns 工具参数对象；不存在或不是对象时返回 null。
 */
function readLangChainToolArgumentsObject(toolCall: object): Record<string, unknown> | null {
    const args = (toolCall as { args?: unknown }).args;
    if (typeof args === "object" && args !== null && !Array.isArray(args)) {
        return args as Record<string, unknown>;
    }
    if (typeof args === "string") {
        return tryParseJsonObject(args);
    }
    const functionRecord = readLangChainToolFunctionRecord(toolCall);
    return typeof functionRecord?.arguments === "string"
        ? tryParseJsonObject(functionRecord.arguments)
        : null;
}

/**
 * readLangChainToolFunctionRecord：读取 OpenAI 原始 function 工具字段。
 *
 * @param toolCall 工具调用对象。
 * @returns function 字段对象；不存在或格式错误时返回 null。
 */
function readLangChainToolFunctionRecord(toolCall: object): Record<string, unknown> | null {
    const functionRecord = (toolCall as { function?: unknown }).function;
    return typeof functionRecord === "object" && functionRecord !== null
        ? functionRecord as Record<string, unknown>
        : null;
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
function readStreamingChatCompletionToolCalls(toolCallParts: Map<string, LangChainToolCallPart>): OpenAiToolCall[] {
    const dedupedToolCalls = new Map<string, OpenAiToolCall>();
    Array.from(toolCallParts.values()).sort((left, right) => {
        return left.order - right.order;
    }).forEach((part) => {
        const argumentsJson = readToolArgumentsJson(part.argumentsText);
        if (!part.name || !argumentsJson) {
            return;
        }
        const nextToolCall = {
            toolCallId: part.toolCallId,
            name: part.name,
            argumentsJson,
        };
        const existingToolCall = dedupedToolCalls.get(part.toolCallId);
        if (!existingToolCall || countObjectKeys(nextToolCall.argumentsJson) > countObjectKeys(existingToolCall.argumentsJson)) {
            // 同一 tool_call_id 可能同时出现在 LangChain 标准片段和供应商原始片段中，保留参数更完整的一条。
            dedupedToolCalls.set(
                part.toolCallId,
                nextToolCall,
            );
        }
    });
    return Array.from(dedupedToolCalls.values());
}

/**
 * countObjectKeys：统计对象顶层字段数量，用于选择更完整的工具参数。
 *
 * @param value 工具参数对象。
 * @returns 顶层字段数量。
 */
function countObjectKeys(value: Record<string, unknown>): number {
    return Object.keys(value).length;
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
 * appendProviderPublicThinkingDelta：追加供应商真实公开思考片段。
 *
 * @param streamContext 当前会话事件上下文。
 * @param thinkingText 本次公开思考增量。
 * @returns 没有返回值。
 */
function appendProviderPublicThinkingDelta(
    streamContext: ProviderStreamEventContext,
    thinkingText: string,
    streamSource = "provider-public-reasoning",
): void {
    if (thinkingText.length === 0) {
        return;
    }
    const thinkingId = `${streamContext.turnId}:provider-public-thinking`;
    streamContext.events.append({
        eventType: "thinking.delta",
        scopeType: "thinking",
        scopeId: thinkingId,
        sessionId: streamContext.sessionId,
        turnId: streamContext.turnId,
        taskId: streamContext.taskId,
        status: "running",
        title: "模型公开思考",
        summary: "供应商返回公开思考片段。",
        payload: withOptionalGraphCheckpoint({
            thinkingId,
            phase: "模型公开思考",
            thinkingSource: streamSource,
            thinkingText,
        }, streamContext.graphCheckpoint),
    });
}

/**
 * appendProviderPublicThinkingCompleted：追加供应商公开思考完成事件。
 *
 * @param streamContext 当前会话事件上下文。
 * @param thinkingText 本次公开思考完整文本。
 * @returns 没有返回值。
 */
function appendProviderPublicThinkingCompleted(
    streamContext: ProviderStreamEventContext,
    thinkingText: string,
    streamSource = "provider-public-reasoning",
): void {
    if (thinkingText.length === 0) {
        return;
    }
    const thinkingId = `${streamContext.turnId}:provider-public-thinking`;
    streamContext.events.append({
        eventType: "thinking.completed",
        scopeType: "thinking",
        scopeId: thinkingId,
        sessionId: streamContext.sessionId,
        turnId: streamContext.turnId,
        taskId: streamContext.taskId,
        status: "completed",
        title: "模型公开思考完成",
        summary: "供应商公开思考片段已接收完成。",
        payload: withOptionalGraphCheckpoint({
            thinkingId,
            phase: "模型公开思考",
            thinkingSource: streamSource,
            thinkingText,
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
