import {AIMessage} from "@langchain/core/messages";

import {CenterLogger} from "../logger.js";
import type {DeepAgentsToolExecutionContext} from "../StructuredTool/index.js";
import {CenterAgentMiddleware} from "./CenterAgentMiddleware.js";

/**
 * CenterModelCallLogMiddleware：模型调用日志中间件。
 *
 * @remarks
 * 该中间件只在模型返回后记录模型协议、调用地址和 LangChain AIMessage 近原始响应。
 * 新供应商链路不保存插件 ID 或协议模式，日志只使用 modelProtocol 与 LangChain 原始响应摘要。
 */
export class CenterModelCallLogMiddleware extends CenterAgentMiddleware {
    /** name：Deep Agents 用于识别和过滤当前中间件的固定名称。 */
    public override name = "CenterModelCallLogMiddleware";

    /** context：当前轮次工具执行上下文，提供供应商、任务和会话事实源。 */
    private readonly context: DeepAgentsToolExecutionContext;

    /** logger：中心服务文件日志实例，写入中心目录 logs。 */
    private readonly logger: CenterLogger;

    /**
     * constructor：创建模型调用日志中间件。
     *
     * @param context 当前轮次工具执行上下文。
     */
    public constructor(context: DeepAgentsToolExecutionContext) {
        super();
        this.context = context;
        this.logger = new CenterLogger(context.centerDirectory);
    }

    /**
     * afterModel：模型返回后输出协议、URL 和原始响应诊断日志。
     *
     * @param state Deep Agents 当前状态，最后一条消息为模型返回。
     */
    public override afterModel: CenterAgentMiddleware["afterModel"] = async (state) => {
        const lastMessage = state.messages.at(-1);
        if (!AIMessage.isInstance(lastMessage)) {
            await this.logger.info(
                "模型调用原始响应跳过",
                this.buildBasePayload({
                    skipReason: "LAST_MESSAGE_NOT_AI_MESSAGE",
                    messageType: lastMessage?.constructor.name,
                }),
            );
            return;
        }
        await this.logger.info(
            "模型调用原始响应完成",
            this.buildBasePayload({
                response: buildRawModelResponseLog(lastMessage),
                diagnostics: {
                    // toolCallCount：LangChain 已解析出的结构化工具调用数量，用于和协议原始字段对照。
                    toolCallCount: lastMessage.tool_calls?.length ?? 0,
                    // invalidToolCallCount：LangChain 解析失败的工具调用数量。
                    invalidToolCallCount: lastMessage.invalid_tool_calls?.length ?? 0,
                    // hasAnthropicToolUseBlock：Anthropic Messages 的 tool_use 位于 content block 中。
                    hasAnthropicToolUseBlock: hasAnthropicToolUseBlock(lastMessage.content),
                    // hasOpenAiRawToolCalls：OpenAI Chat Completions 的原始工具调用位于 additional_kwargs.tool_calls。
                    hasOpenAiRawToolCalls: hasOpenAiRawToolCalls(lastMessage.additional_kwargs),
                },
            }),
        );
    };

    /**
     * buildBasePayload：生成模型调用日志基础载荷。
     *
     * @param extraPayload 本次日志额外载荷。
     * @returns 可写入 CenterLogger 的结构化日志对象。
     */
    private buildBasePayload(extraPayload: Record<string, unknown>): Record<string, unknown> {
        const provider = this.context.runtime.provider;
        return {
            eventType: "model.call.raw_response",
            status: "completed",
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            providerId: provider.providerId,
            providerName: provider.providerName,
            modelProtocol: provider.modelProtocol,
            runtimeMode: this.context.runtime.runtimeMode,
            model: this.context.runtime.modelSelection.model,
            reasoningEffort: this.context.runtime.modelSelection.reasoningEffort,
            requestUrl: this.context.runtime.requestUrl,
            ...extraPayload,
        };
    }
}

/**
 * buildRawModelResponseLog：生成模型返回原始响应日志。
 *
 * @param message LangChain AIMessage。
 * @returns 可 JSON 序列化的模型响应字段。
 */
function buildRawModelResponseLog(message: AIMessage): Record<string, unknown> {
    return {
        messageType: "ai",
        content: normalizeLogValue(message.content),
        toolCalls: normalizeLogValue(message.tool_calls),
        invalidToolCalls: normalizeLogValue(message.invalid_tool_calls),
        additionalKwargs: normalizeLogValue(message.additional_kwargs),
        responseMetadata: normalizeLogValue(message.response_metadata),
        usageMetadata: normalizeLogValue(message.usage_metadata),
    };
}

/**
 * hasAnthropicToolUseBlock：判断 content 中是否包含 Anthropic tool_use block。
 *
 * @param content AIMessage content 字段。
 * @returns 包含 tool_use block 时返回 true。
 */
function hasAnthropicToolUseBlock(content: AIMessage["content"]): boolean {
    if (!Array.isArray(content)) {
        return false;
    }
    return content.some((contentBlock) => {
        return typeof contentBlock === "object"
            && contentBlock !== null
            && "type" in contentBlock
            && contentBlock.type === "tool_use";
    });
}

/**
 * hasOpenAiRawToolCalls：判断 additional_kwargs 中是否包含 OpenAI 原始 tool_calls。
 *
 * @param additionalKwargs AIMessage 附加字段。
 * @returns 包含原始 tool_calls 时返回 true。
 */
function hasOpenAiRawToolCalls(additionalKwargs: AIMessage["additional_kwargs"]): boolean {
    const rawToolCalls = additionalKwargs["tool_calls"];
    return Array.isArray(rawToolCalls)
        && rawToolCalls.length > 0;
}

/**
 * normalizeLogValue：把模型原始响应字段转换为可落日志的安全值。
 *
 * @param value 模型响应字段。
 * @returns 可 JSON 序列化的原始字段或截断摘要。
 */
function normalizeLogValue(value: unknown): unknown {
    const serializedValue = tryStringifyLogValue(value);
    if (!serializedValue.ok) {
        return serializedValue.fallback;
    }
    if (serializedValue.value.length <= 12000) {
        return value;
    }
    return {
        // truncatedJson：原始响应字段过长时保留前段，避免单条日志撑爆轮转文件。
        truncatedJson: serializedValue.value.slice(
            0,
            12000,
        ),
        // originalLength：原始 JSON 长度用于后续判断是否需要临时扩大日志保留。
        originalLength: serializedValue.value.length,
    };
}

/**
 * tryStringifyLogValue：尝试序列化模型原始响应字段。
 *
 * @param value 模型响应字段。
 * @returns 序列化结果；失败时返回错误摘要。
 */
function tryStringifyLogValue(value: unknown): {
    /** ok：是否成功序列化。 */
    ok: true;
    /** value：序列化后的 JSON 字符串。 */
    value: string;
} | {
    /** ok：是否序列化失败。 */
    ok: false;
    /** fallback：可写入日志的失败摘要。 */
    fallback: {
        /** unserializableType：原始字段类型。 */
        unserializableType: string;
        /** errorMessage：序列化失败原因。 */
        errorMessage: string;
    };
} {
    try {
        const serializedValue = JSON.stringify(value);
        return {
            ok: true,
            value: typeof serializedValue === "string"
                ? serializedValue
                : String(serializedValue),
        };
    } catch (error) {
        return {
            ok: false,
            fallback: {
                unserializableType: typeof value,
                errorMessage: error instanceof Error
                    ? error.message
                    : String(error),
            },
        };
    }
}
