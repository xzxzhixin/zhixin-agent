import {AIMessage} from "@langchain/core/messages";
import type {StructuredToolInterface} from "@langchain/core/tools";

import type {DeepAgentsToolExecutionContext} from "../StructuredTool/index.js";
import {
    COMMAND_TOOL_MODEL_NAME,
} from "../StructuredTool/tool-choice-policy.js";
import {
    CenterAgentMiddleware,
    type CenterAgentMiddlewareDefinition,
} from "./CenterAgentMiddleware.js";

/** ToolSchemaRecord：兼容 Zod schema 与 JSON Schema 的工具参数结构。 */
type ToolSchemaRecord = {
    /** shape：旧版 Zod 或外部 schema 直接暴露的字段结构。 */
    shape?: Record<string, unknown>;
    /** _def：Zod 内部定义，包含字段 shape。 */
    _def?: {
        /** shape：Zod 字段结构或延迟读取函数。 */
        shape?: (() => Record<string, unknown>) | Record<string, unknown>;
    };
    /** properties：JSON Schema 声明的字段集合。 */
    properties?: Record<string, unknown>;
    /** required：JSON Schema 声明的必填字段。 */
    required?: unknown;
    /** additionalProperties：JSON Schema 是否允许额外字段。 */
    additionalProperties?: unknown;
};

/**
 * CenterToolChoiceMiddleware：中心服务工具选择策略中间件。
 *
 * @remarks
 * 中间件只记录模型工具选择诊断，并在供应商返回空工具名时按结构化参数唯一匹配恢复工具名。
 * 这里不解析用户提示词，也不强制指定 tool_choice。
 */
export class CenterToolChoiceMiddleware extends CenterAgentMiddleware {
    /** context：当前轮次工具执行上下文，提供事件、任务和会话事实源。 */
    private readonly context: DeepAgentsToolExecutionContext;

    /** latestModelTools：最近一次模型请求中真实注入的工具列表，用于空工具名恢复。 */
    private latestModelTools: readonly StructuredToolInterface[] = [];

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
     * createDefinition：创建 LangChain 中间件定义。
     *
     * @returns 项目 CenterAgentMiddleware 基类可创建的中间件定义。
     */
    protected createDefinition(): CenterAgentMiddlewareDefinition {
        return {
            name: "CenterToolChoiceMiddleware",
            afterModel: async (state) => {
                const lastMessage = state.messages.at(-1);
                if (!AIMessage.isInstance(lastMessage)) {
                    return;
                }
                this.context.input.events.append({
                    eventType: "model.tool_calls.received",
                    scopeType: "model",
                    scopeId: this.context.input.sent.taskId,
                    sessionId: this.context.input.sent.sessionId,
                    turnId: this.context.input.sent.turnId,
                    taskId: this.context.input.sent.taskId,
                    status: "completed",
                    title: "模型工具调用结果",
                    summary: lastMessage.tool_calls && lastMessage.tool_calls.length > 0
                        ? "模型返回了结构化工具调用。"
                        : "模型未返回结构化工具调用。",
                    payload: {
                        // toolCalls: 只记录工具名和参数字段，避免把长参数或敏感输出写入诊断事件。
                        toolCalls: lastMessage.tool_calls?.map((toolCall) => {
                            return {
                                id: toolCall.id,
                                name: toolCall.name,
                                argumentKeys: Object.keys(toolCall.args ?? {}),
                            };
                        }) ?? [],
                        invalidToolCalls: lastMessage.invalid_tool_calls?.map((toolCall) => {
                            return {
                                id: toolCall.id,
                                name: toolCall.name,
                                hasArgs: Boolean(toolCall.args),
                                error: toolCall.error,
                            };
                        }) ?? [],
                        rawToolCalls: readRawToolCallDiagnostics(lastMessage.additional_kwargs),
                    },
                });
            },
            wrapToolCall: async (request, handler) => {
                const restoredToolName = resolveEmptyToolNameByArguments(
                    request.toolCall.name,
                    request.toolCall.args,
                    this.latestModelTools,
                );
                if (
                    !request.tool
                    && isEmptyToolCallName(request.toolCall.name)
                    && restoredToolName === null
                ) {
                    const argumentKeys = Object.keys(request.toolCall.args ?? {});
                    const failureReason = `MODEL_TOOL_NAME_EMPTY_UNRESOLVED:${argumentKeys.join(",")}`;
                    this.context.input.events.append({
                        eventType: "model.tool_call.name_restore_failed",
                        scopeType: "tool",
                        scopeId: this.context.input.sent.taskId,
                        sessionId: this.context.input.sent.sessionId,
                        turnId: this.context.input.sent.turnId,
                        taskId: this.context.input.sent.taskId,
                        status: "failed",
                        title: "工具名恢复失败",
                        summary: "模型返回了空工具名，结构化参数无法唯一匹配当前工具 schema。",
                        payload: {
                            toolCallId: request.toolCall.id,
                            argumentKeys,
                            failureReason,
                        },
                    });
                    throw new Error(failureReason);
                }
                if (
                    request.tool
                    || restoredToolName === null
                ) {
                    return handler(request);
                }
                this.context.input.events.append({
                    eventType: "model.tool_call.name_restored",
                    scopeType: "tool",
                    scopeId: this.context.input.sent.taskId,
                    sessionId: this.context.input.sent.sessionId,
                    turnId: this.context.input.sent.turnId,
                    taskId: this.context.input.sent.taskId,
                    status: "completed",
                    title: "工具名恢复",
                    summary: "模型返回了空工具名，已按结构化参数唯一匹配恢复工具名。",
                    payload: {
                        toolCallId: request.toolCall.id,
                        restoredToolName,
                        argumentKeys: Object.keys(request.toolCall.args ?? {}),
                    },
                });
                // toolCall: 这里不解析用户文本，只在模型已经返回结构化参数且唯一匹配当前可见工具 schema 时恢复名称。
                return handler({
                    ...request,
                    toolCall: {
                        ...request.toolCall,
                        name: restoredToolName,
                    },
                });
            },
            wrapModelCall: async (request, handler) => {
                const hasToolResultMessage = request.messages.some((message) => {
                    return message.getType() === "tool";
                });
                this.latestModelTools = request.tools;
                this.context.input.events.append({
                    eventType: "model.tool_choice.evaluated",
                    scopeType: "model",
                    scopeId: this.context.input.sent.taskId,
                    sessionId: this.context.input.sent.sessionId,
                    turnId: this.context.input.sent.turnId,
                    taskId: this.context.input.sent.taskId,
                    status: "completed",
                    title: "工具选择策略",
                    summary: "Deep Agents 使用模型自主结构化工具选择。",
                    payload: {
                        // toolNames: 当前请求注入给模型的真实工具名，用于排查模型是否看到了工具。
                        toolNames: request.tools.map((tool) => tool.name),
                        hasToolResultMessage,
                    },
                });
                return handler(request);
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
 * resolveEmptyToolNameByArguments：按结构化参数唯一匹配恢复空工具名。
 *
 * @param toolCallName 模型返回的工具名。
 * @param args 模型返回的结构化工具参数。
 * @param modelTools 当前模型请求可见工具列表。
 * @returns 可唯一确认的工具名；无法确认时返回 null。
 */
function resolveEmptyToolNameByArguments(
    toolCallName: string | undefined,
    args: Record<string, unknown> | undefined,
    modelTools: readonly StructuredToolInterface[],
): string | null {
    if (
        typeof toolCallName === "string"
        && toolCallName.length > 0
    ) {
        return null;
    }
    if (!args) {
        return null;
    }
    const argumentKeys = Object.keys(args);
    const hasCommandArgument = [
        "shellCommand",
        "executablePath",
        "args",
    ].some((key) => {
        return argumentKeys.includes(key);
    });
    const hasInputSummary = argumentKeys.includes("inputSummary");
    if (hasInputSummary) {
        return hasCommandArgument
            ? COMMAND_TOOL_MODEL_NAME
            : null;
    }

    const exactMatchedTools = modelTools.filter((tool) => {
        return toolSchemaExactlyMatchesArgumentKeys(
            tool.schema,
            argumentKeys,
        );
    });
    if (exactMatchedTools.length === 1) {
        return exactMatchedTools[0]?.name ?? null;
    }

    const matchedTools = modelTools.filter((tool) => {
        return toolSchemaMatchesArgumentKeys(
            tool.schema,
            argumentKeys,
        );
    });
    return matchedTools.length === 1
        ? matchedTools[0]?.name ?? null
        : null;
}

/**
 * toolSchemaExactlyMatchesArgumentKeys：判断模型参数字段是否与工具 schema 字段集合完全一致。
 *
 * @param schema 模型可见工具参数 schema。
 * @param argumentKeys 模型实际返回的参数字段集合。
 * @returns 参数字段与 schema 声明字段完全相同则返回 true。
 */
function toolSchemaExactlyMatchesArgumentKeys(
    schema: StructuredToolInterface["schema"],
    argumentKeys: string[],
): boolean {
    const schemaRecord = schema as ToolSchemaRecord;
    const propertyNames = readToolSchemaPropertyNames(schemaRecord);
    if (propertyNames.length === 0 || propertyNames.length !== argumentKeys.length) {
        return false;
    }
    return propertyNames.every((name) => {
        return argumentKeys.includes(name);
    });
}

/**
 * toolSchemaMatchesArgumentKeys：判断模型参数字段是否能归入某个工具 schema。
 *
 * @param schema 模型可见工具参数 schema。
 * @param argumentKeys 模型实际返回的参数字段集合。
 * @returns 参数字段满足 schema 必填字段且没有 schema 未声明字段时返回 true。
 */
function toolSchemaMatchesArgumentKeys(
    schema: StructuredToolInterface["schema"],
    argumentKeys: string[],
): boolean {
    const schemaRecord = schema as ToolSchemaRecord;
    const propertyNames = readToolSchemaPropertyNames(schemaRecord);
    if (propertyNames.length === 0) {
        return false;
    }
    const requiredNames = readToolSchemaRequiredNames(schemaRecord);
    const hasAllRequiredArguments = requiredNames.every((name) => {
        return argumentKeys.includes(name);
    });
    const allowsAdditionalProperties = schemaRecord.additionalProperties === true;
    const hasOnlyDeclaredArguments = allowsAdditionalProperties || argumentKeys.every((name) => {
        return propertyNames.includes(name);
    });
    return hasAllRequiredArguments
        && hasOnlyDeclaredArguments;
}

/**
 * readToolSchemaPropertyNames：读取 Zod 或 JSON Schema 的属性名。
 *
 * @param schemaRecord 工具 schema 对象。
 * @returns schema 声明的属性名。
 */
function readToolSchemaPropertyNames(schemaRecord: ToolSchemaRecord): string[] {
    if (schemaRecord.properties) {
        return Object.keys(schemaRecord.properties);
    }
    const zodShape = typeof schemaRecord._def?.shape === "function"
        ? schemaRecord._def.shape()
        : schemaRecord._def?.shape ?? schemaRecord.shape;
    return zodShape
        ? Object.keys(zodShape)
        : [];
}

/**
 * readToolSchemaRequiredNames：读取 JSON Schema required 字段或 Zod 必填字段。
 *
 * @param schemaRecord 工具 schema 对象。
 * @returns 必填字段名。
 */
function readToolSchemaRequiredNames(schemaRecord: ToolSchemaRecord): string[] {
    if (Array.isArray(schemaRecord.required)) {
        return schemaRecord.required.filter((item): item is string => {
            return typeof item === "string";
        });
    }
    const zodShape = typeof schemaRecord._def?.shape === "function"
        ? schemaRecord._def.shape()
        : schemaRecord._def?.shape ?? {};
    return Object.entries(zodShape)
        .filter(([, propertySchema]) => {
            return !isZodOptionalSchema(propertySchema);
        })
        .map(([name]) => name);
}

/**
 * isZodOptionalSchema：判断 Zod 字段是否为可选字段。
 *
 * @param propertySchema Zod 字段 schema。
 * @returns 可选字段返回 true。
 */
function isZodOptionalSchema(propertySchema: unknown): boolean {
    const zodProperty = propertySchema as {
        /** isOptional：Zod 字段是否可选的判断函数。 */
        isOptional?: () => boolean;
    };
    return typeof zodProperty.isOptional === "function"
        && zodProperty.isOptional();
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
