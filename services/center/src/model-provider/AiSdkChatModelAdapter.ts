import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage
} from "@langchain/core/messages";
import {BaseChatModel, type BaseChatModelCallOptions} from "@langchain/core/language_models/chat_models";
import {ChatGenerationChunk, type ChatResult} from "@langchain/core/outputs";
import type {StructuredToolInterface} from "@langchain/core/tools";
import {
    generateText,
    jsonSchema,
    streamText,
    type LanguageModel,
    type LanguageModelUsage,
    type ModelMessage,
    type TextStreamPart,
    type ToolSet,
    type TypedToolCall
} from "ai";
import {zodToJsonSchema} from "zod-to-json-schema";

import type {OpenAiToolCall} from "../openai-chat-protocol.js";
import {ModelProviderStructuredLogger} from "./ModelProviderStructuredLogger.js";
import type {
    ProviderModelGatewayUsage,
    ResolvedModelProviderRuntime,
} from "./ModelProviderRuntimeTypes.js";

/** AiSdkPromptInput：AI SDK 生成接口统一提示词入参。 */
interface AiSdkPromptInput {
    /** system: 顶层系统提示词，避免 system 消息进入 messages 触发 AI SDK 安全警告。 */
    system?: string;
    /** messages: 不含 system 的对话消息。 */
    messages: ModelMessage[];
}

/** AiSdkChatModelAdapterInput：AI SDK ChatModel 适配器入参。 */
interface AiSdkChatModelAdapterInput {
    /** runtime: 已解析的新供应商运行时。 */
    runtime: ResolvedModelProviderRuntime;
    /** languageModel: AI SDK 语言模型。 */
    languageModel: LanguageModel;
    /** boundTools: LangChain bindTools 绑定的工具。 */
    boundTools?: StructuredToolInterface[];
}

/** AiSdkChatModelCallOptions：LangChain 调用参数，携带 Deep Agents 绑定工具。 */
type AiSdkChatModelCallOptions = BaseChatModelCallOptions & {
    /** tools: Deep Agents/LangChain 绑定给模型的工具定义。 */
    tools?: StructuredToolInterface[];
};

/**
 * AiSdkChatModelAdapter：把 Vercel AI SDK 模型适配为 LangChain ChatModel。
 *
 * 用途：让 Deep Agents 继续使用 LangChain ChatModel 接口，同时模型实际调用统一走 AI SDK。
 */
export class AiSdkChatModelAdapter extends BaseChatModel<AiSdkChatModelCallOptions> {
    /** runtime: 当前供应商运行时配置。 */
    private readonly runtime: ResolvedModelProviderRuntime;
    /** languageModel: AI SDK 语言模型实例。 */
    private readonly languageModel: LanguageModel;
    /** boundTools: Deep Agents 通过 bindTools 绑定的工具定义。 */
    private readonly boundTools: StructuredToolInterface[];
    /** logger: 模型供应商结构化日志器。 */
    private readonly logger: ModelProviderStructuredLogger;

    /**
     * constructor：创建 AI SDK ChatModel 适配器。
     *
     * @param input 供应商运行时和 AI SDK 模型。
     */
    public constructor(input: AiSdkChatModelAdapterInput) {
        super({});
        this.runtime = input.runtime;
        this.languageModel = input.languageModel;
        this.boundTools = input.boundTools ?? [];
        this.logger = new ModelProviderStructuredLogger({
            centerDirectory: input.runtime.centerDirectory,
            sessionId: "",
            turnId: "",
            taskId: "",
            providerId: input.runtime.provider.providerId,
            providerSource: input.runtime.provider.providerSource,
            modelName: input.runtime.modelSelection.model,
            requestUrl: input.runtime.requestUrl,
        });
    }

    /**
     * _llmType：返回 LangChain 模型类型标识。
     *
     * @returns 模型类型。
     */
    public _llmType(): string {
        return "zhixin-ai-sdk-chat-model";
    }

    /**
     * bindTools：兼容 Deep Agents/LangChain 的工具绑定入口。
     *
     * @param tools LangChain 工具定义。
     * @returns 带工具副本的新模型实例。
     */
    public override bindTools(tools: StructuredToolInterface[]): AiSdkChatModelAdapter {
        return new AiSdkChatModelAdapter({
            runtime: this.runtime,
            languageModel: this.languageModel,
            boundTools: tools,
        });
    }

    /**
     * _generate：非流式生成，Deep Agents 工具调用主要依赖此返回结构。
     *
     * @param messages LangChain 消息列表。
     * @param options LangChain 调用参数。
     * @returns ChatResult。
     */
    public async _generate(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
    ): Promise<ChatResult> {
        try {
            const prompt = toAiSdkPrompt(messages);
            const result = await generateText({
                model: this.languageModel,
                system: prompt.system,
                messages: prompt.messages,
                tools: toAiSdkTools(resolveCallTools(
                    options.tools,
                    this.boundTools,
                )),
                toolChoice: normalizeToolChoice(options.tool_choice),
                abortSignal: options.signal,
                temperature: this.runtime.provider.settings.temperature ?? undefined,
                maxOutputTokens: this.runtime.provider.settings.maxOutputTokens ?? undefined,
            });
            const usage = normalizeAiSdkUsage(result.usage);
            const toolCalls = normalizeAiSdkToolCalls(result.toolCalls);
            const message = new AIMessage({
                content: result.text,
                tool_calls: toolCalls.map((toolCall) => {
                    return {
                        id: toolCall.toolCallId,
                        name: toolCall.name,
                        args: toolCall.argumentsJson,
                    };
                }),
                usage_metadata: {
                    input_tokens: usage?.inputTokens ?? undefined,
                    output_tokens: usage?.outputTokens ?? undefined,
                    total_tokens: usage?.totalTokens ?? undefined,
                },
                response_metadata: {
                    providerId: this.runtime.provider.providerId,
                    providerSource: this.runtime.provider.providerSource,
                    model: this.runtime.modelSelection.model,
                    requestUrl: this.runtime.requestUrl,
                    aiSdkResponse: {
                        id: result.response.id,
                        modelId: result.response.modelId,
                        timestamp: result.response.timestamp,
                    },
                },
                additional_kwargs: {
                    tool_calls: toolCalls.map((toolCall) => {
                        return {
                            id: toolCall.toolCallId,
                            type: "function",
                            function: {
                                name: toolCall.name,
                                arguments: JSON.stringify(toolCall.argumentsJson),
                            },
                        };
                    }),
                    usage,
                },
            });
            await this.logger.logCompleted({
                aiSdkResponseSummary: {
                    responseId: result.response.id,
                    modelId: result.response.modelId,
                    finishReason: result.finishReason,
                },
                rawToolCallSummary: toolCalls,
                usage,
            });
            return {
                generations: [
                    {
                        text: result.text,
                        message,
                    },
                ],
                llmOutput: {
                    providerId: this.runtime.provider.providerId,
                    providerSource: this.runtime.provider.providerSource,
                    model: this.runtime.modelSelection.model,
                    usage,
                    toolCalls,
                },
            };
        } catch (error) {
            await this.logger.logFailed(error);
            throw error;
        }
    }

    /**
     * _streamResponseChunks：流式生成文本片段。
     *
     * @param messages LangChain 消息列表。
     * @param options LangChain 调用参数。
     * @returns ChatGenerationChunk 异步流。
     */
    public override async* _streamResponseChunks(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
    ): AsyncGenerator<ChatGenerationChunk> {
        try {
            const prompt = toAiSdkPrompt(messages);
            const result = streamText({
                model: this.languageModel,
                system: prompt.system,
                messages: prompt.messages,
                tools: toAiSdkTools(resolveCallTools(
                    options.tools,
                    this.boundTools,
                )),
                toolChoice: normalizeToolChoice(options.tool_choice),
                abortSignal: options.signal,
                temperature: this.runtime.provider.settings.temperature ?? undefined,
                maxOutputTokens: this.runtime.provider.settings.maxOutputTokens ?? undefined,
            });
            let toolCallIndex = 0;
            for await (const part of result.fullStream) {
                const chunk = toLangChainStreamChunk(
                    part,
                    toolCallIndex,
                );
                if (part.type === "tool-call") {
                    toolCallIndex += 1;
                }
                if (chunk) {
                    yield chunk;
                }
            }
            const usage = normalizeAiSdkUsage(await result.usage);
            const toolCalls = normalizeAiSdkToolCalls(await result.toolCalls);
            await this.logger.logCompleted({
                aiSdkResponseSummary: {
                    finishReason: await result.finishReason,
                },
                rawToolCallSummary: toolCalls,
                usage,
            });
        } catch (error) {
            await this.logger.logFailed(error);
            throw error;
        }
    }
}

/**
 * toLangChainStreamChunk：把 AI SDK 流式事件转换为 LangChain 可合并消息片段。
 *
 * @param part AI SDK fullStream 事件。
 * @param toolCallIndex 同一条 AI 消息内的工具调用顺序，用于 LangChain chunk 合并。
 * @returns LangChain 生成片段；非模型正文或结构化工具调用事件返回 null。
 */
function toLangChainStreamChunk(
    part: TextStreamPart<ToolSet>,
    toolCallIndex: number,
): ChatGenerationChunk | null {
    if (part.type === "text-delta") {
        return new ChatGenerationChunk({
            text: part.text,
            message: new AIMessageChunk({
                content: part.text,
            }),
        });
    }
    if (part.type === "tool-call") {
        const toolCall = normalizeAiSdkToolCall(part);
        return new ChatGenerationChunk({
            text: "",
            message: new AIMessageChunk({
                content: "",
                tool_call_chunks: [
                    {
                        type: "tool_call_chunk",
                        id: toolCall.toolCallId,
                        name: toolCall.name,
                        args: JSON.stringify(toolCall.argumentsJson),
                        index: toolCallIndex,
                    },
                ],
            }),
        });
    }
    if (part.type === "error") {
        throw part.error;
    }
    return null;
}

/**
 * convertAiSdkStreamPartForLangChainTest：暴露给回归脚本的流式转换入口。
 *
 * 约束：只复用生产转换逻辑，不允许在测试脚本中复制工具调用转换细节。
 *
 * @param part AI SDK fullStream 事件。
 * @param toolCallIndex 工具调用顺序。
 * @returns LangChain 生成片段；不参与模型输出的事件返回 null。
 */
export function convertAiSdkStreamPartForLangChainTest(
    part: TextStreamPart<ToolSet>,
    toolCallIndex: number,
): ChatGenerationChunk | null {
    return toLangChainStreamChunk(
        part,
        toolCallIndex,
    );
}

/**
 * resolveCallTools：合并调用时工具和已绑定工具。
 *
 * @param callTools 本次调用传入工具。
 * @param boundTools bindTools 保存的工具。
 * @returns 实际发送给 AI SDK 的工具。
 */
function resolveCallTools(
    callTools: StructuredToolInterface[] | undefined,
    boundTools: StructuredToolInterface[],
): StructuredToolInterface[] | undefined {
    if (callTools && callTools.length > 0) {
        return callTools;
    }
    return boundTools.length > 0 ? boundTools : undefined;
}

/**
 * toAiSdkPrompt：转换 LangChain 消息为 AI SDK 生成入参。
 *
 * 约束：AI SDK 6 建议 system prompt 使用顶层 system 字段，避免放入 messages 后触发安全警告。
 *
 * @param messages LangChain 消息列表。
 * @returns AI SDK 顶层 system 和普通消息列表。
 */
function toAiSdkPrompt(messages: BaseMessage[]): AiSdkPromptInput {
    const systemMessages: string[] = [];
    const modelMessages: ModelMessage[] = [];
    for (const message of messages) {
        if (message instanceof SystemMessage) {
            systemMessages.push(message.text);
            continue;
        }
        modelMessages.push(toAiSdkMessage(message));
    }
    const system = systemMessages.length > 0
        ? systemMessages.join("\n\n")
        : undefined;
    return {
        system,
        messages: modelMessages,
    };
}

/**
 * toAiSdkMessage：转换单条非 system LangChain 消息为 AI SDK 消息。
 *
 * @param message LangChain 非 system 消息。
 * @returns AI SDK 消息。
 */
function toAiSdkMessage(message: BaseMessage): ModelMessage {
    if (message instanceof HumanMessage) {
        return {
            role: "user",
            content: message.text,
        };
    }
    if (message instanceof ToolMessage) {
        return {
            role: "tool",
            content: [
                {
                    type: "tool-result",
                    toolCallId: String(message.tool_call_id),
                    toolName: readToolMessageName(message),
                    output: {
                        type: "text",
                        value: message.text,
                    },
                },
            ],
        };
    }
    if (AIMessage.isInstance(message)) {
        return {
            role: "assistant",
            content: message.tool_calls && message.tool_calls.length > 0
                ? [
                    ...message.text.length > 0
                        ? [
                            {
                                type: "text" as const,
                                text: message.text,
                            },
                        ]
                        : [],
                    ...message.tool_calls.map((toolCall) => {
                        return {
                            type: "tool-call" as const,
                            toolCallId: toolCall.id ?? "",
                            toolName: toolCall.name,
                            input: toolCall.args,
                        };
                    }),
                ]
                : message.text,
        };
    }
    return {
        role: "user",
        content: message.text,
    };
}

/**
 * toAiSdkTools：把 LangChain 工具定义转换为 AI SDK 工具定义。
 *
 * @param tools LangChain 工具列表。
 * @returns AI SDK 工具集合。
 */
function toAiSdkTools(tools: StructuredToolInterface[] | undefined): ToolSet | undefined {
    if (!tools || tools.length === 0) {
        return undefined;
    }
    const result: ToolSet = {};
    for (const tool of tools) {
        result[tool.name] = {
            description: tool.description,
            inputSchema: jsonSchema(toAiSdkToolJsonSchema(tool)),
        };
    }
    return result;
}

/**
 * toAiSdkToolJsonSchema：把 LangChain 工具 schema 归一为 AI SDK 可消费的 JSON Schema。
 *
 * @param tool LangChain 工具。
 * @returns JSON Schema 对象。
 */
function toAiSdkToolJsonSchema(tool: StructuredToolInterface): Record<string, unknown> {
    const schema = tool.schema as unknown;
    if (isZodSchema(schema)) {
        return zodToJsonSchema(schema) as Record<string, unknown>;
    }
    if (isJsonSchemaObject(schema)) {
        return schema;
    }
    throw new Error(`AI_SDK_TOOL_SCHEMA_UNSUPPORTED:${tool.name}`);
}

/**
 * isZodSchema：判断 schema 是否为 Zod schema。
 *
 * @param schema 待判断 schema。
 * @returns 是 Zod schema 时返回 true。
 */
function isZodSchema(schema: unknown): schema is Parameters<typeof zodToJsonSchema>[0] {
    return typeof schema === "object"
        && schema !== null
        && "_def" in schema;
}

/**
 * isJsonSchemaObject：判断 schema 是否为 MCP adapter 等工具提供的 JSON Schema 对象。
 *
 * @param schema 待判断 schema。
 * @returns 是 JSON Schema 对象时返回 true。
 */
function isJsonSchemaObject(schema: unknown): schema is Record<string, unknown> {
    return typeof schema === "object"
        && schema !== null
        && (
            "type" in schema
            || "properties" in schema
            || "required" in schema
            || "additionalProperties" in schema
        );
}

/**
 * convertStructuredToolsForAiSdkTest：暴露给回归脚本的纯转换入口。
 *
 * @param tools LangChain 工具列表。
 * @returns AI SDK 工具集合。
 */
export function convertStructuredToolsForAiSdkTest(tools: StructuredToolInterface[]): ToolSet | undefined {
    return toAiSdkTools(tools);
}

/**
 * convertLangChainMessagesForAiSdkTest：暴露给回归脚本的消息转换入口。
 *
 * @param messages LangChain 消息列表。
 * @returns AI SDK 顶层 system 和普通消息列表。
 */
export function convertLangChainMessagesForAiSdkTest(messages: BaseMessage[]): AiSdkPromptInput {
    return toAiSdkPrompt(messages);
}

/**
 * normalizeToolChoice：转换 LangChain tool_choice 为 AI SDK toolChoice。
 *
 * @param toolChoice LangChain 工具选择参数。
 * @returns AI SDK 工具选择参数。
 */
function normalizeToolChoice(toolChoice: unknown): "auto" | "none" | "required" | undefined | {
    /** type: 指定工具。 */
    type: "tool";
    /** toolName: 指定工具名。 */
    toolName: string;
} {
    if (toolChoice === "auto" || toolChoice === undefined) {
        return "auto";
    }
    if (toolChoice === "none") {
        return "none";
    }
    if (toolChoice === "any") {
        return "required";
    }
    if (typeof toolChoice === "string") {
        return {
            type: "tool",
            toolName: toolChoice,
        };
    }
    return undefined;
}

/**
 * normalizeAiSdkToolCalls：转换 AI SDK 工具调用为中心服务结构。
 *
 * @param toolCalls AI SDK 工具调用。
 * @returns 中心服务工具调用。
 */
function normalizeAiSdkToolCalls(toolCalls: Array<TypedToolCall<ToolSet>>): OpenAiToolCall[] {
    return toolCalls.map((toolCall) => {
        return normalizeAiSdkToolCall(toolCall);
    });
}

/**
 * normalizeAiSdkToolCall：转换单个 AI SDK 工具调用。
 *
 * @param toolCall AI SDK 已解析的结构化工具调用。
 * @returns 中心服务工具调用。
 */
function normalizeAiSdkToolCall(toolCall: TypedToolCall<ToolSet>): OpenAiToolCall {
    return {
        toolCallId: toolCall.toolCallId,
        name: toolCall.toolName,
        argumentsJson: normalizeToolInput(toolCall.input),
    };
}

/**
 * normalizeToolInput：确保工具参数是对象。
 *
 * @param input AI SDK 工具参数。
 * @returns 工具参数对象。
 */
function normalizeToolInput(input: unknown): Record<string, unknown> {
    if (typeof input === "object" && input !== null && !Array.isArray(input)) {
        return input as Record<string, unknown>;
    }
    return {
        value: input,
    };
}

/**
 * readToolMessageName：读取工具结果消息中的工具名。
 *
 * 约束：该名称只用于 AI SDK 消息结构，不能作为空工具名恢复来源。
 *
 * @param message LangChain 工具结果消息。
 * @returns 工具名；缺失时使用 LangChain 工具结果消息占位名。
 */
function readToolMessageName(message: ToolMessage): string {
    const candidate = message.name;
    if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
    }
    return "tool";
}

/**
 * normalizeAiSdkUsage：转换 AI SDK 用量。
 *
 * @param usage AI SDK 用量。
 * @returns 中心服务用量。
 */
function normalizeAiSdkUsage(usage: LanguageModelUsage | undefined): ProviderModelGatewayUsage | null {
    if (!usage) {
        return null;
    }
    return {
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        totalTokens: usage.totalTokens ?? null,
        cacheHitTokens: usage.cachedInputTokens ?? null,
        cacheMissTokens: null,
        rawUsage: usage,
    };
}
