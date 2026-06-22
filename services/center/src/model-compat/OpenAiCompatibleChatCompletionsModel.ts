import type {BaseMessageChunk} from "@langchain/core/messages";
import {ChatOpenAICompletions} from "@langchain/openai";
import type {OpenAI} from "openai";

/**
 * OpenAiCompatibleChatCompletionsModel：中心服务 OpenAI 兼容供应商 Chat Completions 模型。
 *
 * @remarks
 * 部分兼容网关在流式工具调用中只在首个 delta 返回 function.name，
 * 后续参数 delta 返回空字符串。这里按 OpenAI 流式协议合并同一工具调用的非空名称，
 * 不按参数、用户提示词或工具列表推断任何工具名。
 */
export class OpenAiCompatibleChatCompletionsModel extends ChatOpenAICompletions {
    /** lastToolCallNames：按工具调用 index 或 id 记录流式首段返回的非空工具名。 */
    private readonly lastToolCallNames = new Map<string, string>();

    /**
     * _convertCompletionsDeltaToBaseMessageChunk：转换流式 Chat Completions delta。
     *
     * @param delta 供应商返回的当前流式 delta。
     * @param rawResponse 当前原始流式响应块。
     * @param defaultRole LangChain 传入的默认消息角色。
     * @returns LangChain 消息块。
     */
    protected override _convertCompletionsDeltaToBaseMessageChunk(
        delta: Record<string, unknown>,
        rawResponse: OpenAI.Chat.Completions.ChatCompletionChunk,
        defaultRole?: OpenAI.Chat.ChatCompletionRole,
    ): BaseMessageChunk {
        return super._convertCompletionsDeltaToBaseMessageChunk(
            this.patchEmptyToolCallNameDelta(
                delta,
                rawResponse.id,
            ),
            rawResponse,
            defaultRole,
        );
    }

    /**
     * patchEmptyToolCallNameDelta：修正流式工具调用空名称片段。
     *
     * @param delta 供应商返回的当前流式 delta。
     * @param responseId 当前流式响应 ID，用于阻断跨轮次同 index 工具名串用。
     * @returns 已按同一工具调用缓存补齐名称的 delta。
     */
    private patchEmptyToolCallNameDelta(
        delta: Record<string, unknown>,
        responseId: string,
    ): Record<string, unknown> {
        const toolCalls = delta.tool_calls;
        if (!Array.isArray(toolCalls)) {
            return delta;
        }
        const patchedToolCalls = toolCalls.map((toolCall) => {
            return this.patchToolCallDelta(
                toolCall,
                responseId,
            );
        });
        return {
            ...delta,
            tool_calls: patchedToolCalls,
        };
    }

    /**
     * patchToolCallDelta：修正单个流式工具调用片段。
     *
     * @param toolCall 供应商返回的单个工具调用 delta。
     * @param responseId 当前流式响应 ID。
     * @returns 已修正名称的工具调用 delta。
     */
    private patchToolCallDelta(
        toolCall: unknown,
        responseId: string,
    ): unknown {
        if (!isToolCallDeltaRecord(toolCall)) {
            return toolCall;
        }
        const toolCallKey = resolveToolCallDeltaKey(
            toolCall,
            responseId,
        );
        if (!toolCallKey) {
            return toolCall;
        }
        const functionDelta = toolCall.function;
        if (!isToolCallFunctionDeltaRecord(functionDelta)) {
            return toolCall;
        }
        if (typeof functionDelta.name === "string" && functionDelta.name.length > 0) {
            this.lastToolCallNames.set(
                toolCallKey,
                functionDelta.name,
            );
            return toolCall;
        }
        if (typeof functionDelta.name === "string" && functionDelta.name.length === 0) {
            const previousToolCallName = this.lastToolCallNames.get(toolCallKey);
            if (previousToolCallName) {
                return {
                    ...toolCall,
                    function: {
                        ...functionDelta,
                        // name：OpenAI 流式协议允许后续参数片段省略名称，这里仅保留首段同调用非空名称。
                        name: previousToolCallName,
                    },
                };
            }
        }
        return toolCall;
    }
}

/**
 * isToolCallDeltaRecord：判断值是否为工具调用 delta 对象。
 *
 * @param value 待判断值。
 * @returns 是对象时返回 true。
 */
function isToolCallDeltaRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * isToolCallFunctionDeltaRecord：判断值是否为 function delta 对象。
 *
 * @param value 待判断值。
 * @returns 是对象时返回 true。
 */
function isToolCallFunctionDeltaRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * resolveToolCallDeltaKey：解析流式工具调用稳定键。
 *
 * @param toolCall 工具调用 delta。
 * @param responseId 当前流式响应 ID。
 * @returns 优先使用 index，缺失时使用 id，无法定位同一工具调用时返回 null。
 */
function resolveToolCallDeltaKey(
    toolCall: Record<string, unknown>,
    responseId: string,
): string | null {
    if (typeof toolCall.index === "number") {
        return `${responseId}:index:${toolCall.index}`;
    }
    if (typeof toolCall.id === "string" && toolCall.id.length > 0) {
        return `${responseId}:id:${toolCall.id}`;
    }
    return null;
}
