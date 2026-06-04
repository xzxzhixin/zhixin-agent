import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";

import type {ModelRequest, ModelUsage} from "@zhixin/model-protocol";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import {
    readProviderConfig,
    readSecretValue,
    resolveProviderModelSelection,
} from "./provider-domain.js";

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
}

interface ProviderModelGatewayHttpResult {
    /** assistantText: 供应商返回的助手正文。 */
    assistantText: string;
    /** usage: 供应商返回的真实用量；未提供时为 null。 */
    usage: ProviderModelGatewayResult["usage"];
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
    const requestPayload = buildModelRequestPayload(userText, modelSelection.model, modelSelection.reasoningEffort);
    const gatewayRequest = provider.protocolPluginId === "builtin-model-anthropic-messages"
        ? buildAnthropicGatewayRequest(requestPayload)
        : buildOpenAiGatewayRequest(requestPayload, provider.protocolMode);
    const apiKey = readSecretValue(
        centerDirectory,
        provider.apiKeySecretRef,
    );
    const httpResult = sendModelRequest(
        provider.baseUrl,
        gatewayRequest.endpoint,
        gatewayRequest.body,
        apiKey,
        provider.protocolMode,
    );
    const result: ProviderModelGatewayResult = {
        providerId: provider.providerId,
        model: modelSelection.model,
        reasoningEffort: modelSelection.reasoningEffort,
        assistantText: httpResult.assistantText,
        usage: httpResult.usage ?? buildUsageSummary(userText, httpResult.assistantText, provider.protocolPluginId),
    };

    events.append({
        eventType: "model.orchestrated",
        scopeType: "model",
        scopeId: taskId,
        sessionId: null,
        turnId,
        taskId,
        status: "completed",
        title: "模型编排",
        summary: "中心服务已准备模型网关调用。",
        payload: {
            providerId: result.providerId,
            model: result.model,
            assistantTextPreview: result.assistantText.slice(0, 120),
        },
    });

    return result;
}

function extractCenterDirectory(database: CenterDatabase): string {
    const row = database.connection()
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("centerDirectory") as { value?: string } | undefined;
    return row?.value ?? "";
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

function buildModelRequestPayload(userText: string, model: string, reasoningEffort: string | null): ModelRequest {
    return {
        requestId: randomUUID(),
        providerId: "",
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
        tools: [],
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
                stream: false,
            },
        }
        : {
            endpoint: "/v1/chat/completions" as const,
            body: {
                model: request.model,
                messages: request.messages.map(toChatCompletionMessage),
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
    if (!assistantText) {
        throw new Error("PROVIDER_RESPONSE_TEXT_EMPTY");
    }

    return {
        assistantText,
        usage: normalizeProviderUsage(parsed.usage),
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
    const textContent = message.content.map((part) => {
        if (part.type === "text") {
            return part.text;
        }
        if (part.type === "image") {
            return `[图片附件:${part.attachmentId}]`;
        }
        return part.resultText;
    }).join("\n");
    return {
        role: message.role,
        content: textContent,
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
