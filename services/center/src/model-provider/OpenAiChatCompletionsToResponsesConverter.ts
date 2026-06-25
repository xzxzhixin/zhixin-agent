import {
    AIMessage,
    AIMessageChunk,
} from "@langchain/core/messages";
import type {
    BaseMessage,
    BaseMessageChunk,
} from "@langchain/core/messages";
import type {
    ChatGeneration,
    ChatGenerationChunk,
} from "@langchain/core/outputs";

/**
 * OpenAiChatCompletionsToResponsesConverter：把 Chat Completions 转为内部 Responses 语义。
 *
 * 用途：Deep Agents 消费的是 LangChain 的消息、工具调用和工具调用分片。本转换器不从文本中
 * 猜测工具调用，只给 Chat Completions 转换后的消息补充 Responses-like 元数据，便于后续日志、
 * 调试和统一链路判断。
 */
export class OpenAiChatCompletionsToResponsesConverter {
    /**
     * normalizeGeneration：归一化非流式生成结果。
     *
     * @param generation Chat Completions 转出的 LangChain 生成结果。
     * @param requestedRuntimeMode 本次外部请求使用的运行模式。
     * @param detectedProtocolShape 实际返回形态。
     * @returns 带内部 Responses 语义标记的生成结果。
     */
    public normalizeGeneration(
        generation: ChatGeneration,
        requestedRuntimeMode: string | null,
        detectedProtocolShape: string,
    ): ChatGeneration {
        return {
            ...generation,
            message: this.normalizeMessage(
                generation.message,
                requestedRuntimeMode,
                detectedProtocolShape,
            ),
        };
    }

    /**
     * normalizeChunk：归一化流式生成分片。
     *
     * @param chunk Chat Completions 转出的 LangChain 生成分片。
     * @param requestedRuntimeMode 本次外部请求使用的运行模式。
     * @param detectedProtocolShape 实际返回形态。
     * @returns 带内部 Responses 语义标记的生成分片。
     */
    public normalizeChunk(
        chunk: ChatGenerationChunk,
        requestedRuntimeMode: string | null,
        detectedProtocolShape: string,
    ): ChatGenerationChunk {
        chunk.message.response_metadata = {
            ...chunk.message.response_metadata,
            ...this.createMetadata(
                requestedRuntimeMode,
                detectedProtocolShape,
            ),
        };
        chunk.generationInfo = {
            ...chunk.generationInfo,
            openai_internal_protocol: "responses",
            openai_detected_protocol_shape: detectedProtocolShape,
        };
        return chunk;
    }

    /**
     * normalizeMessage：归一化完整消息。
     *
     * @param message Chat Completions 转出的 LangChain 消息。
     * @param requestedRuntimeMode 本次外部请求使用的运行模式。
     * @param detectedProtocolShape 实际返回形态。
     * @returns 带内部 Responses 语义标记的消息。
     */
    private normalizeMessage(
        message: BaseMessage,
        requestedRuntimeMode: string | null,
        detectedProtocolShape: string,
    ): BaseMessage {
        if (AIMessage.isInstance(message)) {
            return new AIMessage({
                content: message.content,
                tool_calls: message.tool_calls,
                invalid_tool_calls: message.invalid_tool_calls,
                additional_kwargs: message.additional_kwargs,
                response_metadata: {
                    ...message.response_metadata,
                    ...this.createMetadata(
                        requestedRuntimeMode,
                        detectedProtocolShape,
                    ),
                },
                usage_metadata: message.usage_metadata,
                id: message.id,
                name: message.name,
            });
        }
        message.response_metadata = {
            ...message.response_metadata,
            ...this.createMetadata(
                requestedRuntimeMode,
                detectedProtocolShape,
            ),
        };
        return message;
    }

    /**
     * normalizeMessageChunk：归一化消息分片。
     *
     * @param message Chat Completions 转出的 LangChain 消息分片。
     * @param requestedRuntimeMode 本次外部请求使用的运行模式。
     * @param detectedProtocolShape 实际返回形态。
     * @returns 带内部 Responses 语义标记的消息分片。
     */
    public normalizeMessageChunk(
        message: BaseMessageChunk,
        requestedRuntimeMode: string | null,
        detectedProtocolShape: string,
    ): BaseMessageChunk {
        if (AIMessageChunk.isInstance(message)) {
            return new AIMessageChunk({
                content: message.content,
                tool_calls: message.tool_calls,
                invalid_tool_calls: message.invalid_tool_calls,
                tool_call_chunks: message.tool_call_chunks,
                additional_kwargs: message.additional_kwargs,
                response_metadata: {
                    ...message.response_metadata,
                    ...this.createMetadata(
                        requestedRuntimeMode,
                        detectedProtocolShape,
                    ),
                },
                usage_metadata: message.usage_metadata,
                id: message.id,
                name: message.name,
            });
        }
        message.response_metadata = {
            ...message.response_metadata,
            ...this.createMetadata(
                requestedRuntimeMode,
                detectedProtocolShape,
            ),
        };
        return message;
    }

    /**
     * createMetadata：生成统一内部协议元数据。
     *
     * @param requestedRuntimeMode 本次外部请求使用的运行模式。
     * @param detectedProtocolShape 实际返回形态。
     * @returns 元数据字段。
     */
    private createMetadata(
        requestedRuntimeMode: string | null,
        detectedProtocolShape: string,
    ): Record<string, unknown> {
        return {
            openai_internal_protocol: "responses",
            openai_requested_runtime_mode: requestedRuntimeMode,
            openai_detected_protocol_shape: detectedProtocolShape,
        };
    }
}
