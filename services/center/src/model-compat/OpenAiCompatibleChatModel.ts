import {ChatOpenAI} from "@langchain/openai";
import type {CallbackManagerForLLMRun} from "@langchain/core/callbacks/manager";
import type {BaseMessage} from "@langchain/core/messages";
import type {ChatGenerationChunk} from "@langchain/core/outputs";
import type {OpenAI} from "openai";

import {CenterLogger} from "../logger.js";

/** OpenAiCompatibleChatModelOptions：OpenAI 兼容模型额外诊断参数。 */
type OpenAiCompatibleChatModelOptions = ConstructorParameters<typeof ChatOpenAI>[0] & {
    /** centerDirectory：中心目录绝对路径，用于写入协议原始片段诊断日志。 */
    centerDirectory: string;
};

/** ToolCallDeltaPatchResult：单个流式工具调用名称补丁结果。 */
interface ToolCallDeltaPatchResult {
    /** toolCall：补丁后的工具调用片段。 */
    toolCall: unknown;
    /** patchedNameFromCache：是否从同一响应缓存恢复了非空工具名。 */
    patchedNameFromCache: boolean;
}

/**
 * 兼容 OpenAI 兼容网关（同时支持 Chat Completions 和 Responses API）的模型类。
 * 核心修正：在流式工具调用中，当后续 delta 返回空字符串 "" 时，
 * 保留第一次出现的非空工具名，避免被空值覆盖。
 */
export class OpenAiCompatibleChatModel extends ChatOpenAI {
    /** lastToolCallNames：按工具调用 index 或 id 缓存第一次出现的非空工具名。 */
    private readonly lastToolCallNames = new Map<string, string>();

    /** logger：中心服务文件日志，记录供应商原始流式工具调用片段。 */
    private readonly logger: CenterLogger;

    /**
     * constructor：创建 OpenAI 兼容 ChatModel。
     *
     * @param options LangChain ChatOpenAI 参数与中心目录诊断参数。
     */
    public constructor(options: OpenAiCompatibleChatModelOptions) {
        const {
            centerDirectory,
            ...chatOpenAiOptions
        } = options;
        super(chatOpenAiOptions);
        this.logger = new CenterLogger(centerDirectory);
    }

    /**
     * 重写父类流式入口，在 Chat Completions 子模型转换 delta 前应用工具名补丁。
     * ChatOpenAI 本身不声明 _convertCompletionsDeltaToBaseMessageChunk，
     * 该钩子挂在 this.completions 子模型上，所以这里包装子模型方法而不是改父类。
     */
    override async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): AsyncGenerator<ChatGenerationChunk> {
        const completionsWithProtectedHook = this.completions as unknown as {
            _convertCompletionsDeltaToBaseMessageChunk: (
                delta: Record<string, unknown>,
                rawResponse: OpenAI.Chat.Completions.ChatCompletionChunk,
                defaultRole?: OpenAI.Chat.ChatCompletionRole,
            ) => unknown;
        };
        const originalConvertDelta = completionsWithProtectedHook._convertCompletionsDeltaToBaseMessageChunk.bind(this.completions);
        completionsWithProtectedHook._convertCompletionsDeltaToBaseMessageChunk = (
            delta,
            rawResponse,
            defaultRole,
        ) => {
            // patchedDelta：仅补同一工具调用已出现过的非空名称，不按参数或提示词推断工具名。
            const patchResult = this.patchDelta(
                delta,
                rawResponse,
            );
            void this.logToolCallDeltaDiagnostic(
                delta,
                patchResult.patchedDelta,
                rawResponse,
                patchResult.patchedNameFromCache,
            );
            return originalConvertDelta(
                patchResult.patchedDelta,
                rawResponse,
                defaultRole,
            );
        };
        try {
            yield* super._streamResponseChunks(messages, options, runManager);
        } finally {
            completionsWithProtectedHook._convertCompletionsDeltaToBaseMessageChunk = originalConvertDelta;
        }
    }

    /**
     * patchDelta：修正 Chat Completions 流式工具名空片段。
     *
     * @param delta 供应商当前流式 delta。
     * @param rawResponse OpenAI SDK 当前原始 chunk。
     * @returns 补丁后的 delta 以及是否发生缓存恢复。
     */
    private patchDelta(delta: Record<string, unknown>, rawResponse: unknown): {
        /** patchedDelta：补丁后的 delta。 */
        patchedDelta: Record<string, unknown>;
        /** patchedNameFromCache：本片段是否从缓存恢复了工具名。 */
        patchedNameFromCache: boolean;
    } {
        const toolCalls = delta.tool_calls;
        if (!Array.isArray(toolCalls)) {
            return {
                patchedDelta: delta,
                patchedNameFromCache: false,
            };
        }

        const responseId = typeof (rawResponse as { id?: unknown } | null)?.id === "string"
            ? (rawResponse as { id: string }).id
            : "unknown";
        let patchedNameFromCache = false;

        const patchedToolCalls = toolCalls.map((toolCall) => {
            const patchResult = this.patchToolCallDelta(
                toolCall,
                responseId,
            );
            patchedNameFromCache = patchedNameFromCache || patchResult.patchedNameFromCache;
            return patchResult.toolCall;
        });

        return {
            patchedDelta: {
                ...delta,
                tool_calls: patchedToolCalls,
            },
            patchedNameFromCache,
        };
    }

    /**
     * patchToolCallDelta：修正单个工具调用片段的空名称。
     *
     * @param toolCall 供应商返回的工具调用片段。
     * @param responseId 当前流式响应 ID。
     * @returns 补丁后的工具调用片段和恢复标记。
     */
    private patchToolCallDelta(toolCall: unknown, responseId: string): ToolCallDeltaPatchResult {
        if (typeof toolCall !== "object" || toolCall === null) {
            return {
                toolCall,
                patchedNameFromCache: false,
            };
        }

        const toolCallRecord = toolCall as Record<string, unknown>;
        const functionDelta = toolCallRecord.function;
        if (typeof functionDelta !== "object" || functionDelta === null) {
            return {
                toolCall,
                patchedNameFromCache: false,
            };
        }

        const functionRecord = functionDelta as Record<string, unknown>;
        const name = typeof functionRecord.name === "string" ? functionRecord.name : "";

        const key = this.resolveToolCallKey(toolCallRecord, responseId);
        if (!key) {
            return {
                toolCall,
                patchedNameFromCache: false,
            };
        }

        // 非空名称：只缓存供应商真实返回的名称，后续空片段才允许用它恢复。
        if (name.length > 0) {
            this.lastToolCallNames.set(key, name);
            return {
                toolCall,
                patchedNameFromCache: false,
            };
        }

        // 空字符串：仅恢复同一响应、同一 index/id 之前已经出现过的非空名称。
        if (name.length === 0) {
            const cachedName = this.lastToolCallNames.get(key);
            if (cachedName) {
                return {
                    toolCall: {
                        ...toolCall,
                        function: {
                            ...functionRecord,
                            name: cachedName,
                        },
                    },
                    patchedNameFromCache: true,
                };
            }
        }

        return {
            toolCall,
            patchedNameFromCache: false,
        };
    }

    /**
     * logToolCallDeltaDiagnostic：记录 OpenAI 兼容供应商原始流式工具调用片段。
     *
     * @param originalDelta LangChain 转换前的供应商 delta。
     * @param patchedDelta 应用空工具名补丁后的 delta。
     * @param rawResponse OpenAI SDK 当前原始 chunk。
     * @param patchedNameFromCache 当前片段是否发生缓存补名。
     * @returns 日志写入 Promise。
     */
    private async logToolCallDeltaDiagnostic(
        originalDelta: Record<string, unknown>,
        patchedDelta: Record<string, unknown>,
        rawResponse: OpenAI.Chat.Completions.ChatCompletionChunk,
        patchedNameFromCache: boolean,
    ): Promise<void> {
        if (!Array.isArray(originalDelta.tool_calls)) {
            return;
        }
        await this.logger.debug(
            "OpenAI兼容流式工具调用原始片段",
            {
                eventType: "model.openai_compatible.tool_call_delta.raw",
                status: "completed",
                responseId: rawResponse.id,
                model: rawResponse.model,
                created: rawResponse.created,
                systemFingerprint: (rawResponse as unknown as Record<string, unknown>)["system_fingerprint"],
                rawDelta: sanitizeOpenAiCompatibleRawLogValue(originalDelta),
                patchedDelta: sanitizeOpenAiCompatibleRawLogValue(patchedDelta),
                rawResponse: sanitizeOpenAiCompatibleRawLogValue(rawResponse),
                beforePatchToolCalls: summarizeToolCallDeltas(originalDelta.tool_calls),
                afterPatchToolCalls: summarizeToolCallDeltas(patchedDelta.tool_calls),
                patchedNameFromCache,
                rawChoices: summarizeRawChoices(rawResponse.choices),
            },
        );
    }

    private resolveToolCallKey(toolCall: Record<string, unknown>, responseId: string): string | null {
        // 流式场景优先使用 index，避免供应商首段暂未返回 id 时无法合并。
        if (typeof toolCall.index === "number") {
            return `${responseId}:index:${toolCall.index}`;
        }
        // 非流式或部分场景使用 id，保证同一工具调用片段不串到其他响应。
        if (typeof toolCall.id === "string" && toolCall.id.length > 0) {
            return `${responseId}:id:${toolCall.id}`;
        }
        return null;
    }
}

/**
 * summarizeToolCallDeltas：生成工具调用 delta 摘要。
 *
 * @param toolCalls 原始或补丁后的工具调用片段数组。
 * @returns 不包含完整参数正文的诊断摘要。
 */
function summarizeToolCallDeltas(toolCalls: unknown): unknown {
    if (!Array.isArray(toolCalls)) {
        return toolCalls;
    }
    return toolCalls.map((toolCall) => {
        if (typeof toolCall !== "object" || toolCall === null) {
            return {
                valueType: typeof toolCall,
            };
        }
        const toolCallRecord = toolCall as Record<string, unknown>;
        const functionRecord = typeof toolCallRecord.function === "object" && toolCallRecord.function !== null
            ? toolCallRecord.function as Record<string, unknown>
            : null;
        const argumentsText = typeof functionRecord?.arguments === "string"
            ? functionRecord.arguments
            : "";
        return {
            index: toolCallRecord.index,
            id: toolCallRecord.id,
            type: toolCallRecord.type,
            functionName: functionRecord?.name,
            hasArguments: argumentsText.length > 0,
            argumentsLength: argumentsText.length,
            argumentsPreview: argumentsText.slice(
                0,
                500,
            ),
        };
    });
}

/**
 * summarizeRawChoices：生成原始 chunk choices 摘要。
 *
 * @param choices OpenAI SDK 原始 choices。
 * @returns choices 中工具调用相关字段摘要。
 */
function summarizeRawChoices(choices: OpenAI.Chat.Completions.ChatCompletionChunk.Choice[]): unknown[] {
    return choices.map((choice) => {
        return {
            index: choice.index,
            finishReason: choice.finish_reason,
            deltaRole: choice.delta.role,
            deltaContentType: typeof choice.delta.content,
            deltaContentPreview: typeof choice.delta.content === "string"
                ? choice.delta.content.slice(
                    0,
                    500,
                )
                : choice.delta.content,
            deltaToolCalls: summarizeToolCallDeltas(choice.delta.tool_calls),
        };
    });
}

/**
 * sanitizeOpenAiCompatibleRawLogValue：保留原始协议字段并剔除敏感键。
 *
 * @param value OpenAI 兼容供应商原始响应对象。
 * @returns 可写入文件日志的原始对象副本。
 */
function sanitizeOpenAiCompatibleRawLogValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => {
            return sanitizeOpenAiCompatibleRawLogValue(item);
        });
    }
    if (typeof value !== "object" || value === null) {
        return value;
    }
    const sanitizedRecord: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, fieldValue]) => {
        if (isSensitiveLogKey(key)) {
            sanitizedRecord[key] = "[REDACTED]";
            return;
        }
        sanitizedRecord[key] = sanitizeOpenAiCompatibleRawLogValue(fieldValue);
    });
    return sanitizedRecord;
}

/**
 * isSensitiveLogKey：判断日志字段名是否可能包含密钥或鉴权信息。
 *
 * @param key 原始字段名。
 * @returns 敏感字段返回 true。
 */
function isSensitiveLogKey(key: string): boolean {
    const normalizedKey = key.toLowerCase();
    return normalizedKey.includes("apikey")
        || normalizedKey.includes("api_key")
        || normalizedKey.includes("authorization")
        || normalizedKey.includes("bearer")
        || normalizedKey.includes("token")
        || normalizedKey.includes("secret")
        || normalizedKey.includes("password");
}
