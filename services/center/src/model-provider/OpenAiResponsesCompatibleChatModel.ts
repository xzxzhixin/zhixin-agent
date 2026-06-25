import {
    type BaseChatOpenAIFields,
    ChatOpenAIResponses,
    convertMessagesToCompletionsMessageParams,
    convertMessagesToResponsesInput,
    convertResponsesDeltaToChatGenerationChunk,
    convertResponsesMessageToAIMessage,
} from "@langchain/openai";
import type {BaseMessage} from "@langchain/core/messages";
import type {CallbackManagerForLLMRun} from "@langchain/core/callbacks/manager";
import {ChatGenerationChunk} from "@langchain/core/outputs";
import type {
    ChatGeneration,
    ChatResult,
} from "@langchain/core/outputs";
import {OpenAI} from "openai";

import {AIMessageToolCallReader} from "./AIMessageToolCallReader.js";
import {OpenAiChatCompletionsToResponsesConverter} from "./OpenAiChatCompletionsToResponsesConverter.js";
import {OpenAiProtocolShapeDetector} from "./OpenAiProtocolShapeDetector.js";
import {OpenAiToolCallNamePreservingCompletions} from "./OpenAiToolCallNamePreservingCompletions.js";
import type {ResolvedModelProviderRuntime} from "./ModelProviderRuntimeTypes.js";

/**
 * OpenAiResponsesCompatibleChatModelFields：OpenAI 内部 Responses 兼容模型参数。
 */
export interface OpenAiResponsesCompatibleChatModelFields {
    /** responsesFields：Responses 请求路径的 LangChain 初始化参数。 */
    responsesFields: BaseChatOpenAIFields;
    /** completions：Chat Completions 请求路径的 LangChain 底层实现。 */
    completions: OpenAiToolCallNamePreservingCompletions;
    /** runtimeMode：供应商能力矩阵选择的外部请求路径。 */
    runtimeMode: ResolvedModelProviderRuntime["runtimeMode"];
}

/**
 * OpenAiResponsesCompatibleChatModel：OpenAI 对内统一 Responses 语义的兼容模型。
 *
 * 用途：外部仍按供应商能力矩阵请求 `/responses` 或 `/chat/completions`，但返回后按
 * 原始结构识别真实形态，并归一化为 Deep Agents 可消费的 LangChain 消息和工具调用分片。
 */
export class OpenAiResponsesCompatibleChatModel extends ChatOpenAIResponses {
    /** completions：Chat Completions 外部请求与转换实现。 */
    private readonly completions: OpenAiToolCallNamePreservingCompletions;

    /** runtimeMode：供应商检测后选择的外部请求模式。 */
    private readonly runtimeMode: ResolvedModelProviderRuntime["runtimeMode"];

    /** detector：按原始结构识别真实返回协议。 */
    private readonly detector = new OpenAiProtocolShapeDetector();

    /** converter：给 Chat Completions 结果补齐内部 Responses 语义。 */
    private readonly converter = new OpenAiChatCompletionsToResponsesConverter();

    /** toolCallReader：读取 LangChain AIMessage 工具调用。 */
    private readonly toolCallReader = new AIMessageToolCallReader();

    /**
     * constructor：保存 Responses 与 Chat Completions 双路径实现。
     *
     * @param fields 兼容模型初始化参数。
     */
    public constructor(fields: OpenAiResponsesCompatibleChatModelFields) {
        super(fields.responsesFields);
        this.completions = fields.completions;
        this.runtimeMode = fields.runtimeMode;
    }

    /**
     * _generate：非流式和聚合流式统一入口。
     *
     * @param messages LangChain 对话消息。
     * @param options LangChain 调用参数。
     * @param runManager LangChain 回调管理器。
     * @returns ChatResult。
     */
    public override async _generate(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): Promise<ChatResult> {
        if (this.shouldUseChatCompletions()) {
            return this.generateWithChatCompletions(
                messages,
                options,
                runManager,
            );
        }
        return this.generateWithResponses(
            messages,
            options,
            runManager,
        );
    }

    /**
     * _streamResponseChunks：流式响应统一入口。
     *
     * @param messages LangChain 对话消息。
     * @param options LangChain 调用参数。
     * @param runManager LangChain 回调管理器。
     * @returns 生成分片。
     */
    public override async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): AsyncGenerator<ChatGenerationChunk> {
        if (this.shouldUseChatCompletions()) {
            for await (const chunk of this.streamWithChatCompletions(
                messages,
                options,
                runManager,
            )) {
                yield chunk;
            }
            return;
        }
        const stream = await this.completionWithRetry({
            ...this.invocationParams(options),
            input: convertMessagesToResponsesInput({
                messages,
                zdrEnabled: this.zdrEnabled ?? false,
                model: this.model,
            }),
            stream: true,
        }, options);
        this.completions.resetToolCallNameCache();
        let defaultRole: OpenAI.Chat.ChatCompletionRole | undefined;
        for await (const event of stream as AsyncIterable<unknown>) {
            if (options.signal?.aborted) {
                return;
            }
            const detectedShape = this.detector.detectStreamEvent(event);
            if (detectedShape === "chat_completions") {
                const chunk = this.convertChatCompletionChunkToGenerationChunk(
                    event,
                    defaultRole,
                );
                defaultRole = chunk.defaultRole;
                if (chunk.generationChunk) {
                    const normalizedChunk = this.converter.normalizeChunk(
                        chunk.generationChunk,
                        this.runtimeMode,
                        "chat_completions",
                    );
                    yield normalizedChunk;
                    await runManager?.handleLLMNewToken(
                        normalizedChunk.text ?? "",
                        {
                            prompt: options.promptIndex ?? 0,
                            completion: chunk.completionIndex,
                        },
                        undefined,
                        undefined,
                        undefined,
                        {
                            chunk: normalizedChunk,
                        },
                    );
                }
                continue;
            }
            const generationChunk = convertResponsesDeltaToChatGenerationChunk(
                event as OpenAI.Responses.ResponseStreamEvent,
            );
            if (!generationChunk) {
                continue;
            }
            const normalizedChunk = this.converter.normalizeChunk(
                generationChunk,
                this.runtimeMode,
                "responses",
            );
            yield normalizedChunk;
            await runManager?.handleLLMNewToken(
                normalizedChunk.text ?? "",
                {
                    prompt: options.promptIndex ?? 0,
                    completion: 0,
                },
                undefined,
                undefined,
                undefined,
                {
                    chunk: normalizedChunk,
                },
            );
        }
    }

    /**
     * generateWithResponses：按 Responses 外部路径生成结果。
     *
     * @param messages LangChain 对话消息。
     * @param options LangChain 调用参数。
     * @param runManager LangChain 回调管理器。
     * @returns ChatResult。
     */
    private async generateWithResponses(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): Promise<ChatResult> {
        const invocationParams = this.invocationParams(options);
        if (invocationParams.stream) {
            return super._generate(
                messages,
                options,
                runManager,
            );
        }
        const response = await this.completionWithRetry({
            input: convertMessagesToResponsesInput({
                messages,
                zdrEnabled: this.zdrEnabled ?? false,
                model: this.model,
            }),
            ...invocationParams,
            stream: false,
        }, {
            signal: options?.signal,
            ...options?.options,
        });
        const detectedShape = this.detector.detectPayload(response);
        if (detectedShape === "chat_completions") {
            return this.convertChatCompletionsPayloadToChatResult(response);
        }
        const message = convertResponsesMessageToAIMessage(response);
        message.response_metadata = {
            ...message.response_metadata,
            openai_internal_protocol: "responses",
            openai_requested_runtime_mode: this.runtimeMode,
            openai_detected_protocol_shape: "responses",
        };
        return {
            generations: [
                {
                    text: this.readResponsesOutputText(
                        response,
                        message.text,
                    ),
                    message,
                },
            ],
            llmOutput: {
                id: response.id,
                estimatedTokenUsage: response.usage ? {
                    promptTokens: response.usage.input_tokens,
                    completionTokens: response.usage.output_tokens,
                    totalTokens: response.usage.total_tokens,
                } : undefined,
            },
        };
    }

    /**
     * generateWithChatCompletions：按 Chat Completions 外部路径生成结果。
     *
     * @param messages LangChain 对话消息。
     * @param options LangChain 调用参数。
     * @param runManager LangChain 回调管理器。
     * @returns ChatResult。
     */
    private async generateWithChatCompletions(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): Promise<ChatResult> {
        void runManager;
        const response = await this.completions.completionWithRetry({
            ...this.completions.invocationParams(options),
            messages: convertMessagesToCompletionsMessageParams({
                messages,
                model: this.model,
            }),
            stream: false,
        }, {
            signal: options?.signal,
            ...options?.options,
        });
        const detectedShape = this.detector.detectPayload(response);
        if (detectedShape === "responses") {
            return this.convertResponsesPayloadToChatResult(response);
        }
        return this.convertChatCompletionsPayloadToChatResult(response);
    }

    /**
     * streamWithChatCompletions：按 Chat Completions 外部路径输出流式分片。
     *
     * @param messages LangChain 对话消息。
     * @param options LangChain 调用参数。
     * @param runManager LangChain 回调管理器。
     * @returns 生成分片。
     */
    private async *streamWithChatCompletions(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): AsyncGenerator<ChatGenerationChunk> {
        const stream = await this.completions.completionWithRetry({
            ...this.completions.invocationParams(
                options,
                {
                    streaming: true,
                },
            ),
            messages: convertMessagesToCompletionsMessageParams({
                messages,
                model: this.model,
            }),
            stream: true,
        }, options);
        this.completions.resetToolCallNameCache();
        let defaultRole: OpenAI.Chat.ChatCompletionRole | undefined;
        for await (const event of stream as AsyncIterable<unknown>) {
            if (options.signal?.aborted) {
                return;
            }
            const detectedShape = this.detector.detectStreamEvent(event);
            if (detectedShape === "responses") {
                const generationChunk = convertResponsesDeltaToChatGenerationChunk(
                    event as OpenAI.Responses.ResponseStreamEvent,
                );
                if (!generationChunk) {
                    continue;
                }
                const normalizedChunk = this.converter.normalizeChunk(
                    generationChunk,
                    this.runtimeMode,
                    "responses",
                );
                yield normalizedChunk;
                await runManager?.handleLLMNewToken(
                    normalizedChunk.text ?? "",
                    {
                        prompt: options.promptIndex ?? 0,
                        completion: 0,
                    },
                    undefined,
                    undefined,
                    undefined,
                    {
                        chunk: normalizedChunk,
                    },
                );
                continue;
            }
            const chunk = this.convertChatCompletionChunkToGenerationChunk(
                event,
                defaultRole,
            );
            defaultRole = chunk.defaultRole;
            if (!chunk.generationChunk) {
                continue;
            }
            const normalizedChunk = this.converter.normalizeChunk(
                chunk.generationChunk,
                this.runtimeMode,
                "chat_completions",
            );
            yield normalizedChunk;
            await runManager?.handleLLMNewToken(
                normalizedChunk.text ?? "",
                {
                    prompt: options.promptIndex ?? 0,
                    completion: chunk.completionIndex,
                },
                undefined,
                undefined,
                undefined,
                {
                    chunk: normalizedChunk,
                },
            );
        }
    }

    /**
     * completionWithRetry：兼容 Responses 路径上实际返回 Chat Completions 的供应商。
     *
     * @param request Responses 请求体。
     * @param requestOptions OpenAI SDK 请求选项。
     * @returns Responses 结果或流式事件。
     */
    public override async completionWithRetry(
        request: OpenAI.Responses.ResponseCreateParamsStreaming,
        requestOptions?: OpenAI.RequestOptions,
    ): Promise<AsyncIterable<OpenAI.Responses.ResponseStreamEvent>>;

    public override async completionWithRetry(
        request: OpenAI.Responses.ResponseCreateParamsNonStreaming,
        requestOptions?: OpenAI.RequestOptions,
    ): Promise<OpenAI.Responses.Response>;

    public override async completionWithRetry(
        request: OpenAI.Responses.ResponseCreateParams,
        requestOptions?: OpenAI.RequestOptions,
    ): Promise<OpenAI.Responses.Response | AsyncIterable<OpenAI.Responses.ResponseStreamEvent>> {
        return super.completionWithRetry(
            request as OpenAI.Responses.ResponseCreateParamsNonStreaming,
            requestOptions,
        );
    }

    /**
     * normalizeChatResult：给生成结果补齐内部 Responses 语义标记。
     *
     * @param result LangChain 生成结果。
     * @param detectedProtocolShape 实际返回形态。
     * @returns 归一化生成结果。
     */
    private normalizeChatResult(
        result: ChatResult,
        detectedProtocolShape: string,
    ): ChatResult {
        return {
            ...result,
            generations: result.generations.map((generation) => {
                return this.converter.normalizeGeneration(
                    generation,
                    this.runtimeMode,
                    detectedProtocolShape,
                );
            }),
        };
    }

    /**
     * shouldUseChatCompletions：判断本次外部请求是否走 Chat Completions。
     *
     * @returns 需要走 Chat Completions 时返回 true。
     */
    private shouldUseChatCompletions(): boolean {
        return this.runtimeMode === "chat_completions_to_responses";
    }

    /**
     * convertChatCompletionsPayloadToChatResult：把 Chat Completions 原始响应转为 ChatResult。
     *
     * @param payload Chat Completions 原始响应。
     * @returns 内部 Responses 语义的 ChatResult。
     */
    private convertChatCompletionsPayloadToChatResult(payload: unknown): ChatResult {
        const result = this.completionsResultToChatResult(payload);
        return this.normalizeChatResult(
            result,
            "chat_completions",
        );
    }

    /**
     * convertResponsesPayloadToChatResult：把 Responses 原始响应转为 ChatResult。
     *
     * @param payload Responses 原始响应。
     * @returns 内部 Responses 语义的 ChatResult。
     */
    private convertResponsesPayloadToChatResult(payload: unknown): ChatResult {
        const response = payload as OpenAI.Responses.Response;
        const message = convertResponsesMessageToAIMessage(response);
        message.response_metadata = {
            ...message.response_metadata,
            openai_internal_protocol: "responses",
            openai_requested_runtime_mode: this.runtimeMode,
            openai_detected_protocol_shape: "responses",
        };
        return {
            generations: [
                {
                    text: this.readResponsesOutputText(
                        response,
                        message.text,
                    ),
                    message,
                },
            ],
            llmOutput: {
                id: response.id,
                estimatedTokenUsage: response.usage ? {
                    promptTokens: response.usage.input_tokens,
                    completionTokens: response.usage.output_tokens,
                    totalTokens: response.usage.total_tokens,
                } : undefined,
            },
        };
    }

    /**
     * convertChatCompletionsPayloadToResponses：把非流式 Chat Completions 包装为 Responses 形态。
     *
     * @param payload Chat Completions 原始响应。
     * @returns Responses-like 响应。
     */
    private convertChatCompletionsPayloadToResponses(payload: unknown): OpenAI.Responses.Response {
        const result = this.completionsResultToChatResult(payload);
        const generation = result.generations[0];
        return {
            id: this.readStringField(
                payload,
                "id",
                "response_compat_chat_completions",
            ),
            object: "response",
            created_at: this.readNumberField(
                payload,
                "created",
                Math.floor(Date.now() / 1000),
            ),
            status: "completed",
            model: this.readStringField(
                payload,
                "model",
                this.model,
            ),
            output: this.createResponsesOutputFromGeneration(generation),
            output_text: generation?.text ?? "",
            usage: undefined,
        } as OpenAI.Responses.Response;
    }

    /**
     * completionsResultToChatResult：复用 Chat Completions 转换器生成 LangChain 结果。
     *
     * @param payload Chat Completions 原始响应。
     * @returns ChatResult。
     */
    private completionsResultToChatResult(payload: unknown): ChatResult {
        const rawPayload = payload as OpenAI.Chat.Completions.ChatCompletion;
        const generations: ChatGeneration[] = [];
        for (const part of rawPayload.choices) {
            const message = this.completions.convertMessageToBaseMessage(
                part.message,
                rawPayload,
            );
            generations.push({
                text: part.message.content ?? "",
                message,
                generationInfo: {
                    finish_reason: part.finish_reason,
                },
            });
        }
        return {
            generations,
        };
    }

    /**
     * createResponsesOutputFromGeneration：把 LangChain 生成结果映射为 Responses output。
     *
     * @param generation 生成结果。
     * @returns Responses output 数组。
     */
    private createResponsesOutputFromGeneration(generation: ChatGeneration | undefined): unknown[] {
        if (!generation) {
            return [];
        }
        const output: unknown[] = [];
        if (generation.text.length > 0) {
            output.push({
                id: "msg_compat_chat_completions",
                type: "message",
                status: "completed",
                role: "assistant",
                content: [
                    {
                        type: "output_text",
                        text: generation.text,
                        annotations: [],
                    },
                ],
            });
        }
        for (const toolCall of this.toolCallReader.readToolCalls(generation.message)) {
            output.push({
                type: "function_call",
                call_id: toolCall.id,
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.args),
            });
        }
        return output;
    }

    /**
     * convertChatCompletionChunkToGenerationChunk：把 Chat Completions 流式分片转为 LangChain 分片。
     *
     * @param event Chat Completions 原始流式分片。
     * @param defaultRole 上一个分片继承下来的角色。
     * @returns 转换结果、下一次默认角色和分片序号。
     */
    private convertChatCompletionChunkToGenerationChunk(
        event: unknown,
        defaultRole: OpenAI.Chat.ChatCompletionRole | undefined,
    ): {
        /** generationChunk：可输出的 LangChain 生成分片。 */
        generationChunk: ChatGenerationChunk | null;
        /** defaultRole：下一次分片应继承的角色。 */
        defaultRole: OpenAI.Chat.ChatCompletionRole | undefined;
        /** completionIndex：OpenAI choices[].index。 */
        completionIndex: number;
    } {
        const rawChunk = event as OpenAI.Chat.Completions.ChatCompletionChunk;
        const choice = rawChunk.choices[0];
        if (!choice) {
            return {
                generationChunk: null,
                defaultRole,
                completionIndex: 0,
            };
        }
        const messageChunk = this.completions.convertDeltaToBaseMessageChunk(
            choice.delta,
            rawChunk,
            defaultRole,
        );
        const nextDefaultRole = choice.delta.role ?? defaultRole;
        const normalizedMessageChunk = this.converter.normalizeMessageChunk(
            messageChunk,
            this.runtimeMode,
            "chat_completions",
        );
        const generationInfo: Record<string, unknown> = {
            prompt: 0,
            completion: choice.index,
            openai_internal_protocol: "responses",
            openai_detected_protocol_shape: "chat_completions",
        };
        if (choice.finish_reason !== null) {
            generationInfo.finish_reason = choice.finish_reason;
            generationInfo.system_fingerprint = rawChunk.system_fingerprint;
            generationInfo.model_name = rawChunk.model;
            generationInfo.service_tier = rawChunk.service_tier;
        }
        return {
            generationChunk: new ChatGenerationChunk({
                message: normalizedMessageChunk,
                text: typeof normalizedMessageChunk.content === "string"
                    ? normalizedMessageChunk.content
                    : "",
                generationInfo,
            }),
            defaultRole: nextDefaultRole,
            completionIndex: choice.index,
        };
    }

    /**
     * readStringField：从原始响应读取字符串字段。
     *
     * @param payload 原始响应。
     * @param key 字段名。
     * @param defaultValue 兼容包装需要的协议默认值。
     * @returns 字符串字段。
     */
    private readStringField(
        payload: unknown,
        key: string,
        defaultValue: string,
    ): string {
        if (typeof payload === "object" && payload !== null) {
            const value = (payload as Record<string, unknown>)[key];
            if (typeof value === "string") {
                return value;
            }
        }
        return defaultValue;
    }

    /**
     * readNumberField：从原始响应读取数字字段。
     *
     * @param payload 原始响应。
     * @param key 字段名。
     * @param defaultValue 兼容包装需要的协议默认值。
     * @returns 数字字段。
     */
    private readNumberField(
        payload: unknown,
        key: string,
        defaultValue: number,
    ): number {
        if (typeof payload === "object" && payload !== null) {
            const value = (payload as Record<string, unknown>)[key];
            if (typeof value === "number") {
                return value;
            }
        }
        return defaultValue;
    }

    /**
     * readResponsesOutputText：读取 Responses 结果文本。
     *
     * @param response Responses 原始响应。
     * @param messageText LangChain 转换后的消息文本。
     * @returns 可用于 ChatGeneration.text 的字符串。
     */
    private readResponsesOutputText(
        response: OpenAI.Responses.Response,
        messageText: string,
    ): string {
        if (typeof response.output_text === "string") {
            return response.output_text;
        }
        return messageText;
    }
}
