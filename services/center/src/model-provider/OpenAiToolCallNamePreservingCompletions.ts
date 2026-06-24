import {
    ChatOpenAICompletions,
} from "@langchain/openai";
import type {
    BaseMessage,
    BaseMessageChunk,
} from "@langchain/core/messages";
import type {CallbackManagerForLLMRun} from "@langchain/core/callbacks/manager";
import type {ChatGenerationChunk} from "@langchain/core/outputs";
import type {OpenAI} from "openai";

/**
 * OpenAiToolCallNamePreservingCompletions：OpenAI Chat Completions 流式工具调用名称保持器。
 *
 * 用途：兼容部分 OpenAI 兼容服务在同一工具调用的流式分片中只在某个分片返回
 * `function.name`，后续参数分片返回空名称的情况。这里仅按供应商协议的
 * `tool_calls[].index/id` 保留已经出现过的非空名称，不按参数结构、提示词或工具名猜测。
 */
export class OpenAiToolCallNamePreservingCompletions extends ChatOpenAICompletions {
    /** toolNamesByIndex：同一轮流式响应内，按 OpenAI tool_calls[].index 记录已出现的非空工具名。 */
    private readonly toolNamesByIndex = new Map<number, string>();

    /** toolNamesById：同一轮流式响应内，按 OpenAI tool_calls[].id 记录已出现的非空工具名。 */
    private readonly toolNamesById = new Map<string, string>();

    /**
     * _streamResponseChunks：每次模型流式请求开始时重置分片名称缓存。
     *
     * @param messages LangChain 已整理的对话消息。
     * @param options LangChain OpenAI 调用参数。
     * @param runManager LangChain 回调管理器。
     * @returns OpenAI 流式响应分片。
     */
    public override async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): AsyncGenerator<ChatGenerationChunk> {
        this.toolNamesByIndex.clear();
        this.toolNamesById.clear();
        yield* super._streamResponseChunks(
            messages,
            options,
            runManager,
        );
    }

    /**
     * _convertCompletionsDeltaToBaseMessageChunk：转换流式 delta 前保持工具名。
     *
     * @param delta OpenAI Chat Completions 流式 delta。
     * @param rawResponse OpenAI 原始流式响应分片。
     * @param defaultRole LangChain 上游维护的默认角色。
     * @returns LangChain 消息分片。
     */
    protected override _convertCompletionsDeltaToBaseMessageChunk(
        delta: Record<string, unknown>,
        rawResponse: OpenAI.Chat.Completions.ChatCompletionChunk,
        defaultRole?: OpenAI.Chat.ChatCompletionRole,
    ): BaseMessageChunk {
        const normalizedDelta = this.normalizeDeltaToolCallNames(delta);
        return super._convertCompletionsDeltaToBaseMessageChunk(
            normalizedDelta,
            rawResponse,
            defaultRole,
        );
    }

    /**
     * normalizeDeltaToolCallNames：按 OpenAI 流式工具调用分片协议补齐同一调用已出现的名称。
     *
     * @param delta OpenAI Chat Completions 流式 delta。
     * @returns 工具名已按协议保持的 delta。
     */
    private normalizeDeltaToolCallNames(delta: Record<string, unknown>): Record<string, unknown> {
        const rawToolCalls = delta.tool_calls;
        if (!Array.isArray(rawToolCalls)) {
            return delta;
        }
        const normalizedToolCalls = rawToolCalls.map((rawToolCall) => {
            return this.normalizeSingleToolCall(rawToolCall);
        });
        return {
            ...delta,
            tool_calls: normalizedToolCalls,
        };
    }

    /**
     * normalizeSingleToolCall：处理单个 OpenAI tool_call 分片。
     *
     * @param rawToolCall OpenAI Chat Completions tool_call 分片。
     * @returns 已保持非空 function.name 的 tool_call 分片。
     */
    private normalizeSingleToolCall(rawToolCall: unknown): unknown {
        if (typeof rawToolCall !== "object" || rawToolCall === null) {
            return rawToolCall;
        }
        const toolCall = rawToolCall as {
            /** index：OpenAI 流式工具调用序号。 */
            index?: unknown;
            /** id：OpenAI 工具调用 ID。 */
            id?: unknown;
            /** function：OpenAI 函数调用分片。 */
            function?: {
                /** name：工具函数名，部分兼容服务会在参数分片返回空字符串。 */
                name?: unknown;
                /** arguments：工具参数 JSON 字符串分片。 */
                arguments?: unknown;
            };
        };
        const existingName = this.readExistingToolName(toolCall);
        const currentName = typeof toolCall.function?.name === "string"
            ? toolCall.function.name
            : "";
        if (currentName.length > 0) {
            this.writeExistingToolName(
                toolCall,
                currentName,
            );
            return rawToolCall;
        }
        if (!existingName) {
            return rawToolCall;
        }
        return {
            ...toolCall,
            function: {
                ...toolCall.function,
                name: existingName,
            },
        };
    }

    /**
     * readExistingToolName：读取同一工具调用之前已出现的非空名称。
     *
     * @param toolCall OpenAI 工具调用分片。
     * @returns 已记录的工具名；没有记录时返回 null。
     */
    private readExistingToolName(toolCall: {
        /** index：OpenAI 流式工具调用序号。 */
        index?: unknown;
        /** id：OpenAI 工具调用 ID。 */
        id?: unknown;
    }): string | null {
        if (typeof toolCall.index === "number") {
            const nameByIndex = this.toolNamesByIndex.get(toolCall.index);
            if (nameByIndex) {
                return nameByIndex;
            }
        }
        if (typeof toolCall.id === "string") {
            const nameById = this.toolNamesById.get(toolCall.id);
            if (nameById) {
                return nameById;
            }
        }
        return null;
    }

    /**
     * writeExistingToolName：记录同一工具调用已经出现的非空名称。
     *
     * @param toolCall OpenAI 工具调用分片。
     * @param toolName 供应商返回的非空工具名。
     */
    private writeExistingToolName(
        toolCall: {
            /** index：OpenAI 流式工具调用序号。 */
            index?: unknown;
            /** id：OpenAI 工具调用 ID。 */
            id?: unknown;
        },
        toolName: string,
    ): void {
        if (typeof toolCall.index === "number") {
            this.toolNamesByIndex.set(
                toolCall.index,
                toolName,
            );
        }
        if (typeof toolCall.id === "string") {
            this.toolNamesById.set(
                toolCall.id,
                toolName,
            );
        }
    }
}
