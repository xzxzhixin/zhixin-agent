import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";

import type {ModelRequest, ModelToolCall, ModelToolSpec, ModelUsage} from "@zhixin/model-protocol";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import {createDataAccess} from "./data-access/index.js";
import {
    readProviderConfig,
    readSecretValue,
    resolveProviderModelSelection,
} from "./provider-domain.js";
import {listAvailableModelToolSpecs} from "./tool-runtime.js";

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
    toolCall: ModelToolCall | null;
    /** toolCalls: 模型请求的全部工具调用；没有工具请求时为空数组。 */
    toolCalls: ModelToolCall[];
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
    toolCall: ModelToolCall | null;
    /** toolCalls: 供应商标准工具调用数组；未请求工具时为空数组。 */
    toolCalls: ModelToolCall[];
}

/**
 * invokeProviderModelGateway：基于中心服务供应商配置执行最小模型调用。
 *
 * @param database 中心服务数据库。
 * @param events 事件日志仓储。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param userText 用户输入。
 * @returns 模型网关执行结果。
 */
export function invokeProviderModelGateway(
    database: CenterDatabase,
    events: CenterEventStore,
    taskId: string,
    turnId: string,
    userText: string,
): ProviderModelGatewayResult {
    const runtime = resolveProviderModelRuntime(database, taskId);
    const requestPayload = buildModelRequestPayload(
        userText,
        runtime.provider.providerId,
        runtime.modelSelection.model,
        runtime.modelSelection.reasoningEffort,
        listAvailableModelToolSpecs(),
    );
    const result = sendProviderModelRequest(runtime, requestPayload);

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
        payload: {
            providerId: result.providerId,
            model: result.model,
            toolCallName: result.toolCall?.name ?? null,
            toolCallCount: result.toolCalls.length,
            assistantTextPreview: result.assistantText.slice(0, 120),
        },
    });

    return result;
}

/**
 * continueProviderModelGatewayWithToolResult：把工具结果回填给模型并获取最终回复。
 *
 * @param database 中心服务数据库。
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param userText 用户原始输入。
 * @param toolCall 模型请求的工具调用。
 * @param toolResultText 工具结果摘要。
 * @returns 模型网关最终回复。
 */
export function continueProviderModelGatewayWithToolResult(
    database: CenterDatabase,
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    userText: string,
    toolCall: ModelToolCall,
    toolResultText: string,
): ProviderModelGatewayResult {
    const runtime = resolveProviderModelRuntime(database, taskId);
    const requestPayload = buildModelRequestPayload(
        userText,
        runtime.provider.providerId,
        runtime.modelSelection.model,
        runtime.modelSelection.reasoningEffort,
        listAvailableModelToolSpecs(),
    );
    requestPayload.messages.push(
        {
            role: "assistant",
            toolCalls: [
                toolCall,
            ],
            content: [
                {
                    type: "text",
                    text: `已请求工具：${toolCall.name}`,
                },
            ],
        },
        {
            role: "tool",
            content: [
                {
                    type: "tool_result",
                    toolCallId: toolCall.toolCallId,
                    resultText: toolResultText,
                },
            ],
        },
    );

    events.append({
        eventType: "model.tool.result.appended",
        scopeType: "model",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "completed",
        title: "工具结果回填模型",
        summary: toolResultText.slice(0, 160),
        payload: {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.name,
            resultSummary: toolResultText.slice(0, 240),
        },
    });

    return sendProviderModelRequest(runtime, requestPayload);
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
export function continueProviderModelGatewayWithToolResults(
    database: CenterDatabase,
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    userText: string,
    toolResults: Array<{
        toolCall: ModelToolCall;
        resultText: string;
    }>,
): ProviderModelGatewayResult {
    const runtime = resolveProviderModelRuntime(database, taskId);
    const requestPayload = buildModelRequestPayload(
        userText,
        runtime.provider.providerId,
        runtime.modelSelection.model,
        runtime.modelSelection.reasoningEffort,
        listAvailableModelToolSpecs(),
    );
    requestPayload.messages.push({
        role: "assistant",
        toolCalls: toolResults.map((toolResult) => {
            return toolResult.toolCall;
        }),
        content: [
            {
                type: "text",
                text: `已请求 ${toolResults.length} 个工具。`,
            },
        ],
    });
    for (const toolResult of toolResults) {
        requestPayload.messages.push({
            role: "tool",
            content: [
                {
                    type: "tool_result",
                    toolCallId: toolResult.toolCall.toolCallId,
                    resultText: toolResult.resultText,
                },
            ],
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
        payload: {
            toolResults: toolResults.map((toolResult) => {
                return {
                    toolCallId: toolResult.toolCall.toolCallId,
                    toolName: toolResult.toolCall.name,
                    resultSummary: toolResult.resultText.slice(0, 240),
                };
            }),
        },
    });

    return sendProviderModelRequest(runtime, requestPayload);
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
 * sendProviderModelRequest：按统一内部模型请求调用供应商协议。
 *
 * @param runtime 模型调用运行时上下文。
 * @param requestPayload 内部模型请求。
 * @returns 模型网关执行结果。
 */
function sendProviderModelRequest(
    runtime: ResolvedProviderModelRuntime,
    requestPayload: ModelRequest,
): ProviderModelGatewayResult {
    const provider = runtime.provider;
    const modelSelection = runtime.modelSelection;
    const gatewayRequest = provider.protocolPluginId === "builtin-model-anthropic-messages"
        ? buildAnthropicGatewayRequest(requestPayload)
        : buildOpenAiGatewayRequest(requestPayload, provider.protocolMode);
    const apiKey = readSecretValue(
        runtime.centerDirectory,
        provider.apiKeySecretRef,
    );
    const httpResult = sendModelRequest(
        provider.baseUrl,
        gatewayRequest.endpoint,
        gatewayRequest.body,
        apiKey,
        provider.protocolMode,
    );

    const textToolCalls = parseModelToolCallsFromText(httpResult.assistantText);
    const toolCalls = [
        ...httpResult.toolCalls,
        ...textToolCalls,
    ];
    return {
        providerId: provider.providerId,
        model: modelSelection.model,
        reasoningEffort: modelSelection.reasoningEffort,
        assistantText: httpResult.assistantText,
        usage: httpResult.usage ?? buildUsageSummary(readUserTextFromRequest(requestPayload), httpResult.assistantText, provider.protocolPluginId),
        toolCall: toolCalls[0] ?? null,
        toolCalls,
    };
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

function buildModelRequestPayload(
    userText: string,
    providerId: string,
    model: string,
    reasoningEffort: string | null,
    tools: ModelToolSpec[],
): ModelRequest {
    return {
        requestId: randomUUID(),
        providerId,
        model,
        reasoningEffort,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: userText,
                    },
                ],
            },
        ],
        tools,
        stream: true,
    };
}

function buildOpenAiGatewayRequest(request: ModelRequest, protocolMode: string) {
    return protocolMode === "responses"
        ? {
            endpoint: "/v1/responses" as const,
            body: {
                model: request.model,
                input: request.messages.map(toProviderMessage),
                tools: request.tools.map(toResponsesToolSpec),
                stream: false,
            },
        }
        : {
            endpoint: "/v1/chat/completions" as const,
            body: {
                model: request.model,
                messages: request.messages.map(toChatCompletionMessage),
                tools: request.tools.map(toChatCompletionToolSpec),
                stream: false,
            },
        };
}

function buildAnthropicGatewayRequest(request: ModelRequest) {
    return {
        endpoint: "/v1/messages" as const,
        body: {
            model: request.model,
            messages: request.messages.map(toProviderMessage),
            tools: request.tools.map(toAnthropicToolSpec),
            stream: false,
        },
    };
}

function sendModelRequest(
    baseUrl: string,
    endpoint: string,
    body: Record<string, unknown>,
    apiKey: string | null,
    protocolMode: string,
): ProviderModelGatewayHttpResult {
    const response = executeFetchSync(joinProviderEndpoint(baseUrl, endpoint), {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(apiKey ? {authorization: `Bearer ${apiKey}`} : {}),
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(buildProviderHttpErrorMessage(response.status, response.body));
    }

    return parseProviderModelResponse(response.body, protocolMode);
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

function executeFetchSync(
    url: string,
    requestInit: {
        method: string;
        headers: Record<string, string>;
        body: string;
    },
) {
    const script = [
        "const input = JSON.parse(process.argv[1]);",
        "(async () => {",
        "const response = await fetch(input.url, input.init);",
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
                init: requestInit,
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
        throw new Error(`PROVIDER_CONNECT_FAILED:${parsed.body}`);
    }
    return parsed;
}

function parseProviderModelResponse(body: string, protocolMode: string): ProviderModelGatewayHttpResult {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const assistantText = protocolMode === "responses"
        ? readResponsesText(parsed)
        : readChatCompletionText(parsed);
    const toolCalls = protocolMode === "responses"
        ? []
        : readChatCompletionToolCalls(parsed);
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

function readResponsesText(parsed: Record<string, unknown>): string {
    if (typeof parsed.output_text === "string") {
        return parsed.output_text;
    }
    const output = Array.isArray(parsed.output) ? parsed.output : [];
    const textParts: string[] = [];
    for (const item of output) {
        if (typeof item !== "object" || item === null) {
            continue;
        }
        const content = Array.isArray((item as { content?: unknown }).content)
            ? (item as { content: unknown[] }).content
            : [];
        for (const contentItem of content) {
            if (typeof contentItem !== "object" || contentItem === null) {
                continue;
            }
            const text = (contentItem as { text?: unknown }).text;
            if (typeof text === "string") {
                textParts.push(text);
            }
        }
    }
    return textParts.join("");
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
function readChatCompletionToolCalls(parsed: Record<string, unknown>): ModelToolCall[] {
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
    }).filter((toolCall): toolCall is ModelToolCall => {
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

function parseModelToolCallFromText(text: string): ModelToolCall | null {
    const parsed = tryParseJsonObject(text);
    const toolCall = typeof parsed?.toolCall === "object" && parsed.toolCall !== null
        ? parsed.toolCall as Record<string, unknown>
        : null;
    if (!toolCall) {
        return null;
    }
    const toolCallId = typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : randomUUID();
    const name = typeof toolCall.name === "string" ? toolCall.name : "";
    const argumentsJson = typeof toolCall.argumentsJson === "object"
        && toolCall.argumentsJson !== null
        && !Array.isArray(toolCall.argumentsJson)
        ? toolCall.argumentsJson as Record<string, unknown>
        : null;
    if (!name || !argumentsJson) {
        return null;
    }

    return {
        toolCallId,
        name,
        argumentsJson,
    };
}

/**
 * parseModelToolCallsFromText：兼容历史文本 JSON 工具调用格式。
 *
 * @param text 模型返回文本。
 * @returns 工具调用数组；没有历史格式时为空数组。
 */
function parseModelToolCallsFromText(text: string): ModelToolCall[] {
    const toolCall = parseModelToolCallFromText(text);
    return toolCall ? [toolCall] : [];
}

function readUserTextFromRequest(request: ModelRequest): string {
    const userMessage = request.messages.find((message) => {
        return message.role === "user";
    });
    return userMessage?.content.map((part) => {
        if (part.type === "text") {
            return part.text;
        }
        if (part.type === "tool_result") {
            return part.resultText;
        }
        return part.attachmentId;
    }).join("\n") ?? "";
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

function toProviderMessage(message: ModelRequest["messages"][number]): Record<string, unknown> {
    const toolResult = message.content.find((part) => {
        return part.type === "tool_result";
    });
    if (message.role === "tool" && toolResult?.type === "tool_result") {
        return {
            type: "function_call_output",
            call_id: toolResult.toolCallId,
            output: toolResult.resultText,
        };
    }

    return {
        role: message.role,
        content: message.content.map((part) => {
            if (part.type === "text") {
                return {
                    type: "text",
                    text: part.text,
                };
            }
            if (part.type === "image") {
                return {
                    type: "image_url",
                    image_url: {
                        url: part.attachmentId,
                    },
                };
            }
            return {
                type: "text",
                text: part.resultText,
            };
        }),
    };
}

function toChatCompletionMessage(message: ModelRequest["messages"][number]): Record<string, unknown> {
    const toolResult = message.content.find((part) => {
        return part.type === "tool_result";
    });
    if (message.role === "tool" && toolResult?.type === "tool_result") {
        return {
            role: "tool",
            tool_call_id: toolResult.toolCallId,
            content: toolResult.resultText,
        };
    }

    const textContent = message.content.map((part) => {
        if (part.type === "text") {
            return part.text;
        }
        if (part.type === "image") {
            return `[图片附件:${part.attachmentId}]`;
        }
        return part.resultText;
    }).join("\n");
    const providerMessage: Record<string, unknown> = {
        role: message.role,
        content: textContent,
    };
    if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
        providerMessage.tool_calls = message.toolCalls.map(toChatCompletionToolCall);
    }
    return providerMessage;
}

/**
 * toChatCompletionToolCall：把内部工具调用记录转换为 OpenAI 兼容 assistant tool_calls。
 *
 * @param toolCall 内部模型工具调用。
 * @returns OpenAI 兼容工具调用记录。
 */
function toChatCompletionToolCall(toolCall: ModelToolCall): Record<string, unknown> {
    return {
        id: toolCall.toolCallId,
        type: "function",
        function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.argumentsJson),
        },
    };
}

function toChatCompletionToolSpec(tool: ModelToolSpec): Record<string, unknown> {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parametersJsonSchema,
        },
    };
}

function toResponsesToolSpec(tool: ModelToolSpec): Record<string, unknown> {
    return {
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parametersJsonSchema,
    };
}

function toAnthropicToolSpec(tool: ModelToolSpec): Record<string, unknown> {
    return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.parametersJsonSchema,
    };
}

function buildUsageSummary(userText: string, assistantText: string, providerId: string): ModelUsage {
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
