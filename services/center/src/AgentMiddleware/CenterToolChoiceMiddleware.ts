import {AIMessage} from "@langchain/core/messages";

import {
    EVENT_SCOPE_TYPES,
    EVENT_TYPES,
    TASK_STATUSES,
} from "@zhixin/shared";

import type {DeepAgentsToolExecutionContext} from "../StructuredTool/index.js";
import {CenterAgentMiddleware} from "./CenterAgentMiddleware.js";

/** ModelMessageDiagnostics：模型最后一条 AIMessage 的诊断快照。 */
export interface ModelMessageDiagnostics {
    /** contentText：模型自然语言正文或非文本内容摘要。 */
    contentText: string;
    /** rawModelMessage：LangChain AIMessage 原始诊断摘要，用于定位供应商响应到工具调用之间的转换丢失。 */
    rawModelMessage: {
        /** content：AIMessage 原始 content，可能包含供应商透传的工具调用块。 */
        content: unknown;
        /** toolCalls：AIMessage 原始 tool_calls 字段，保留 name、args 等解析结果。 */
        toolCalls: unknown;
        /** invalidToolCalls：AIMessage 原始 invalid_tool_calls 字段。 */
        invalidToolCalls: unknown;
        /** additionalKwargs：AIMessage 原始 additional_kwargs，通常包含供应商原始工具调用。 */
        additionalKwargs: unknown;
        /** responseMetadata：AIMessage 原始 response_metadata，通常包含供应商响应元数据。 */
        responseMetadata: unknown;
    };
    /** toolCalls：LangChain 解析出的结构化工具调用摘要。 */
    toolCalls: Array<{
        /** id：工具调用 ID。 */
        id: string | undefined;
        /** name：模型返回的工具名。 */
        name: string | undefined;
        /** argumentKeys：工具参数字段名。 */
        argumentKeys: string[];
    }>;
    /** invalidToolCalls：LangChain 解析失败的工具调用摘要。 */
    invalidToolCalls: Array<{
        /** id：工具调用 ID。 */
        id: string | undefined;
        /** name：模型返回的工具名。 */
        name: string | undefined;
        /** hasArgs：是否包含原始参数。 */
        hasArgs: boolean;
        /** error：LangChain 解析错误。 */
        error: string | undefined;
    }>;
    /** rawToolCalls：供应商原始工具调用摘要。 */
    rawToolCalls: Array<{
        /** id：供应商原始工具调用 ID。 */
        id: unknown;
        /** name：供应商原始函数名。 */
        name: unknown;
        /** hasArguments：原始工具调用是否带有参数字符串。 */
        hasArguments: boolean;
    }>;
    /** hasMalformedTextToolCallBlock：text 内容块夹带工具字段但没有结构化 tool_calls，属于供应商工具协议形态错误。 */
    hasMalformedTextToolCallBlock: boolean;
}

/**
 * CenterToolChoiceMiddleware：中心服务工具选择策略中间件。
 *
 * @remarks
 * 中间件只记录模型工具选择诊断；供应商返回空工具名属于协议错误，
 * 这里不按参数、提示词或具体工具名做任何恢复，也不强制指定 tool_choice。
 */
export class CenterToolChoiceMiddleware extends CenterAgentMiddleware {
    /** name：Deep Agents 用于识别和过滤当前中间件的固定名称。 */
    public override name = "CenterToolChoiceMiddleware";

    /** context：当前轮次工具执行上下文，提供事件、任务和会话事实源。 */
    private readonly context: DeepAgentsToolExecutionContext;

    /** lastModelMessageDiagnostics：最近一次模型返回的 AIMessage 诊断快照，用于空工具名失败定位。 */
    private lastModelMessageDiagnostics: ModelMessageDiagnostics | null = null;

    /**
     * constructor：创建中心工具选择中间件。
     *
     * @param context 当前轮次工具执行上下文。
     */
    public constructor(context: DeepAgentsToolExecutionContext) {
        super();
        this.context = context;
    }

    /**
     * afterModel：模型返回后记录结构化工具调用诊断。
     *
     * @param state Deep Agents 当前状态，包含消息列表。
     */
    public override afterModel: CenterAgentMiddleware["afterModel"] = async (state) => {
        const lastMessage = state.messages.at(-1);
        if (!AIMessage.isInstance(lastMessage)) {
            return;
        }
        this.lastModelMessageDiagnostics = buildModelMessageDiagnostics(lastMessage);
        this.context.lastModelMessageDiagnostics = this.lastModelMessageDiagnostics;
        this.context.input.events.append({
            eventType: EVENT_TYPES.MODEL_TOOL_CALLS_RECEIVED,
            scopeType: EVENT_SCOPE_TYPES.MODEL,
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: TASK_STATUSES.COMPLETED,
            title: "模型工具调用结果",
            summary: lastMessage.tool_calls && lastMessage.tool_calls.length > 0
                ? "模型返回了结构化工具调用。"
                : "模型未返回结构化工具调用。",
            payload: {
                // lastModelMessage: 只记录模型输出诊断摘要，不读取用户原文，不把完整工具参数写入事件。
                lastModelMessage: this.lastModelMessageDiagnostics,
            },
        });
    };

    /**
     * wrapToolCall：执行工具前拦截空工具名协议错误。
     *
     * @param request Deep Agents 工具调用请求。
     * @param handler Deep Agents 原始工具调用处理器。
     * @returns 原工具结果；空工具名时抛出协议错误。
     */
    public override wrapToolCall: CenterAgentMiddleware["wrapToolCall"] = async (request, handler) => {
        if (isEmptyToolCallName(request.toolCall.name)) {
            const argumentKeys = Object.keys(request.toolCall.args ?? {});
            const failureReason = `MODEL_TOOL_NAME_MISSING:${argumentKeys.join(",")}`;
            this.context.input.events.append({
                eventType: EVENT_TYPES.MODEL_TOOL_CALL_NAME_MISSING,
                scopeType: EVENT_SCOPE_TYPES.TOOL,
                scopeId: this.context.input.sent.taskId,
                sessionId: this.context.input.sent.sessionId,
                turnId: this.context.input.sent.turnId,
                taskId: this.context.input.sent.taskId,
                status: TASK_STATUSES.FAILED,
                title: "工具名缺失",
                summary: "模型返回了空工具名，中心服务按协议错误处理，不恢复工具名。",
                payload: {
                    // toolCallId: 供应商返回的工具调用 ID，用于关联原始模型输出。
                    toolCallId: request.toolCall.id,
                    // argumentKeys: 仅记录参数字段名，避免把参数值或用户原文写入诊断事件。
                    argumentKeys,
                    // failureReason: 统一错误码，供轮次失败收尾和日志检索使用。
                    failureReason,
                    // lastModelMessage: 记录导致空工具名的最后一条模型输出摘要，便于排查供应商回调。
                    lastModelMessage: this.lastModelMessageDiagnostics,
                },
            });
            throw new Error(failureReason);
        }
        return handler(request);
    };

    /**
     * wrapModelCall：模型调用前记录工具选择策略诊断。
     *
     * @param request Deep Agents 模型调用请求。
     * @param handler Deep Agents 原始模型调用处理器。
     * @returns 模型调用结果。
     */
    public override wrapModelCall: CenterAgentMiddleware["wrapModelCall"] = async (request, handler) => {
        const hasToolResultMessage = request.messages.some((message) => {
            return message.getType() === "tool";
        });
        this.context.input.events.append({
            eventType: EVENT_TYPES.MODEL_TOOL_CHOICE_EVALUATED,
            scopeType: EVENT_SCOPE_TYPES.MODEL,
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: TASK_STATUSES.COMPLETED,
            title: "工具选择策略",
            summary: "Deep Agents 使用模型自主结构化工具选择。",
            payload: {
                // toolNames: 当前请求注入给模型的真实工具名，用于排查模型是否看到了工具。
                toolNames: request.tools.map((tool) => tool.name),
                hasToolResultMessage,
            },
        });
        return handler(request);
    };
}

/**
 * buildModelMessageDiagnostics：生成模型最后一条消息的诊断快照。
 *
 * @param message LangChain AIMessage。
 * @returns 可写入事件 payload 的模型输出摘要。
 */
function buildModelMessageDiagnostics(message: AIMessage): ModelMessageDiagnostics {
    return {
        contentText: normalizeModelMessageContent(message.content),
        rawModelMessage: {
            // content: 原始内容可证明供应商是否把工具调用放进 content 块，而不是标准 tool_calls。
            content: normalizeDiagnosticValue(message.content),
            // toolCalls: 原始 LangChain 结构化工具调用，用于和简化摘要互相校验。
            toolCalls: normalizeDiagnosticValue(message.tool_calls),
            // invalidToolCalls: 解析失败列表用于区分“空工具名”和“参数解析失败”。
            invalidToolCalls: normalizeDiagnosticValue(message.invalid_tool_calls),
            // additionalKwargs: 供应商原始透传字段，排查是否在 LangChain 转换前已经丢失 name。
            additionalKwargs: normalizeDiagnosticValue(message.additional_kwargs),
            // responseMetadata: 供应商响应元数据，排查接口模式、模型名和响应 ID。
            responseMetadata: normalizeDiagnosticValue(message.response_metadata),
        },
        toolCalls: message.tool_calls?.map((toolCall) => {
            return {
                id: toolCall.id,
                name: toolCall.name,
                argumentKeys: Object.keys(toolCall.args ?? {}),
            };
        }) ?? [],
        invalidToolCalls: message.invalid_tool_calls?.map((toolCall) => {
            return {
                id: toolCall.id,
                name: toolCall.name,
                hasArgs: Boolean(toolCall.args),
                error: toolCall.error,
            };
        }) ?? [],
        rawToolCalls: readRawToolCallDiagnostics(message.additional_kwargs),
        hasMalformedTextToolCallBlock: hasMalformedTextToolCallBlock(message),
    };
}

/**
 * hasMalformedTextToolCallBlock：识别 text 内容块夹带工具字段的协议错误。
 *
 * @param message LangChain AIMessage。
 * @returns 没有结构化 tool_calls 且 text block 含 id/name/args 工具字段时返回 true。
 */
function hasMalformedTextToolCallBlock(message: AIMessage): boolean {
    if (message.tool_calls && message.tool_calls.length > 0) {
        return false;
    }
    if (!Array.isArray(message.content)) {
        return false;
    }
    return message.content.some((contentBlock) => {
        if (typeof contentBlock !== "object" || contentBlock === null) {
            return false;
        }
        const block = contentBlock as {
            /** type：供应商 content block 类型。 */
            type?: unknown;
            /** id：错误夹带的工具调用 ID。 */
            id?: unknown;
            /** name：错误夹带的工具名。 */
            name?: unknown;
            /** args：错误夹带的工具参数。 */
            args?: unknown;
            /** arguments：错误夹带的工具参数。 */
            arguments?: unknown;
        };
        if (block.type !== "text") {
            return false;
        }
        const hasToolName = typeof block.name === "string" && block.name.length > 0;
        const hasToolArguments = block.args !== undefined || block.arguments !== undefined;
        const hasToolCallId = typeof block.id === "string" && block.id.length > 0;
        return hasToolName && hasToolArguments && hasToolCallId;
    });
}

/**
 * normalizeModelMessageContent：把模型正文压缩成诊断文本。
 *
 * @param content AIMessage content 字段。
 * @returns 文本正文或内容结构摘要。
 */
function normalizeModelMessageContent(content: AIMessage["content"]): string {
    if (typeof content === "string") {
        return content.slice(
            0,
            4000,
        );
    }
    return stringifyDiagnosticValue(content).slice(
        0,
        4000,
    );
}

/**
 * normalizeDiagnosticValue：把模型原始返回压缩成可写入日志的 JSON 诊断值。
 *
 * @param value 模型消息中的原始字段。
 * @returns 可 JSON 序列化的字段摘要；过长内容会被截断。
 */
function normalizeDiagnosticValue(value: unknown): unknown {
    const serializedValue = tryStringifyDiagnosticValue(value);
    if (!serializedValue.ok) {
        return serializedValue.fallback;
    }
    if (serializedValue.value.length <= 4000) {
        return value;
    }
    return {
        // truncatedJson: 原始字段过长时只保留前 4000 字符，避免诊断日志超过单文件预算。
        truncatedJson: serializedValue.value.slice(
            0,
            4000,
        ),
        // originalLength: 原始 JSON 长度用于判断是否需要进一步临时扩展诊断。
        originalLength: serializedValue.value.length,
    };
}

/**
 * stringifyDiagnosticValue：安全序列化模型诊断字段。
 *
 * @param value 模型消息中的原始字段。
 * @returns JSON 字符串；不可序列化时返回错误摘要字符串。
 */
function stringifyDiagnosticValue(value: unknown): string {
    const serializedValue = tryStringifyDiagnosticValue(value);
    if (serializedValue.ok) {
        return serializedValue.value;
    }
    return JSON.stringify(serializedValue.fallback);
}

/**
 * tryStringifyDiagnosticValue：尝试序列化模型诊断字段。
 *
 * @param value 模型消息中的原始字段。
 * @returns 序列化结果；失败时返回可落盘的错误摘要对象。
 */
function tryStringifyDiagnosticValue(value: unknown): {
    /** ok：是否成功序列化原始字段。 */
    ok: true;
    /** value：成功序列化后的 JSON 字符串。 */
    value: string;
} | {
    /** ok：是否无法直接序列化原始字段。 */
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
        if (typeof serializedValue === "string") {
            return {
                ok: true,
                value: serializedValue,
            };
        }
        return {
            ok: true,
            value: String(serializedValue),
        };
    } catch (error) {
        return {
            ok: false,
            fallback: {
                // unserializableType: 原始字段类型，用于定位循环引用、BigInt 等无法直接落盘的值。
                unserializableType: typeof value,
                // errorMessage: 序列化失败原因，只记录错误文本，不回填原始对象。
                errorMessage: error instanceof Error
                    ? error.message
                    : String(error),
            },
        };
    }
}

/**
 * isEmptyToolCallName：判断模型是否返回空工具名。
 *
 * @param toolCallName 模型返回的工具名。
 * @returns 工具名缺失或空字符串时返回 true。
 */
function isEmptyToolCallName(toolCallName: string | undefined): boolean {
    return typeof toolCallName !== "string" || toolCallName.length === 0;
}

/**
 * readRawToolCallDiagnostics：读取供应商原始工具调用诊断信息。
 *
 * @param additionalKwargs LangChain AIMessage 附加字段。
 * @returns 原始工具调用摘要；没有时返回空数组。
 */
function readRawToolCallDiagnostics(additionalKwargs: AIMessage["additional_kwargs"]): Array<{
    /** id：供应商原始工具调用 ID。 */
    id: unknown;
    /** name：供应商原始函数名。 */
    name: unknown;
    /** hasArguments：原始工具调用是否带有参数字符串。 */
    hasArguments: boolean;
}> {
    const rawToolCalls = additionalKwargs.tool_calls;
    if (!Array.isArray(rawToolCalls)) {
        return [];
    }
    return rawToolCalls.map((toolCall) => {
        const toolCallRecord = toolCall as {
            /** id：供应商原始工具调用 ID。 */
            id?: unknown;
            /** function：OpenAI 兼容协议中的函数调用信息。 */
            function?: {
                /** name：供应商返回的函数名。 */
                name?: unknown;
                /** arguments：供应商返回的原始参数字符串。 */
                arguments?: unknown;
            };
        };
        return {
            id: toolCallRecord.id,
            name: toolCallRecord.function?.name,
            hasArguments: typeof toolCallRecord.function?.arguments === "string"
                && toolCallRecord.function.arguments.length > 0,
        };
    });
}
