import {randomUUID} from "node:crypto";

import {AIMessage} from "@langchain/core/messages";
import type {StructuredToolInterface} from "@langchain/core/tools";
import type {ToolCallStream} from "@langchain/langgraph";
import {createMiddleware} from "langchain";
import {createDeepAgent, registerHarnessProfile, type DeepAgentRunStream} from "deepagents";

import {SessionRepository} from "./data-access/session-repository.js";
import {
    recordModelUsageAfterTurn,
    updateSessionTitleAfterTurn,
    updateTurnStatus,
} from "./domain/session-domain.js";
import {
    isTurnRuntimeAbortError,
    registerRunningTurnRuntime,
    throwIfTurnRuntimeAborted,
    unregisterRunningTurnRuntime,
} from "./domain/turn-runtime-cancel-registry.js";
import {commitMainAgentMemoryAfterTurn} from "./domain/session-turn-effects.js";
import {handleWorkerMessage, startWorkerTask} from "./domain/workflow-domain.js";
import {
    createLangChainChatModel,
    listMainAgentMemoryPromptEntries,
    listSessionHistoryPromptMessages,
    type ProviderModelGatewayResult,
} from "./model-gateway-runtime.js";
import {formatCenterLocalDateTime} from "./time.js";
import {
    appendToolVisibilityEvents,
    createDeepAgentsStructuredToolMiddleware,
    createDeepAgentsToolExecutionContext,
    listAvailableModelToolSpecsForCenter,
    listUnifiedToolCapabilities,
    toModelSafeToolName,
} from "./tools/index.js";
import {
    COMMAND_TOOL_MODEL_NAME,
} from "./tools/tool-choice-policy.js";
import type {
    DeepAgentsAgentRunInput,
    DeepAgentsToolExecutionContext,
} from "./tools/index.js";

type CenterDeepAgentRunStream = DeepAgentRunStream<
    Record<string, unknown>,
    readonly StructuredToolInterface[]
>;

/** DEEPAGENTS_BUILTIN_TOOL_NAMES：Deep Agents 默认内置工具名；中心服务当前只允许模型看到中心统一注入的真实工具。 */
const DEEPAGENTS_BUILTIN_TOOL_NAMES = [
    "write_todos",
    "ls",
    "read_file",
    "write_file",
    "edit_file",
    "glob",
    "grep",
    "task",
];

/** centerDeepAgentsProfileRegistered：避免同进程重复注册中心服务专用 Deep Agents profile。 */
let centerDeepAgentsProfileRegistered = false;

/**
 * runDeepAgentsAgentTurn：直接用 Deep Agents 原生 agent 执行当前轮次。
 *
 * @param input 运行输入。
 * @returns 没有返回值。
 */
export async function runDeepAgentsAgentTurn(input: DeepAgentsAgentRunInput): Promise<void> {
    const runtimeController = registerRunningTurnRuntime(input.sent.turnId);
    const runtimeInput: DeepAgentsAgentRunInput = {
        ...input,
        runtimeSignal: runtimeController.signal,
    };
    try {
        startWorkerTask(
            runtimeInput.database,
            runtimeInput.events,
            runtimeInput.sent.taskId,
        );

        const context = await createDeepAgentsToolExecutionContext(runtimeInput);
        appendToolVisibilityEvents(
            runtimeInput.events,
            runtimeInput.sent.sessionId,
            runtimeInput.sent.taskId,
            runtimeInput.sent.turnId,
        );

        const deepAgent = await createCenterDeepAgent(context);
        const run = await deepAgent.streamEvents(
            {
                messages: [
                    {
                        role: "user",
                        content: input.userText,
                    },
                ],
            },
            {
                version: "v3",
                signal: runtimeController.signal,
            },
        ) as CenterDeepAgentRunStream;

        const messageCollector = collectDeepAgentMessages(runtimeInput, run);
        const toolCollector = collectDeepAgentToolCalls(context, run);

        const [
            streamedAssistantText,
            finalModelResult,
        ] = await Promise.all([
            messageCollector,
            toolCollector,
        ]);

        const output = await run.output as {
            messages?: Array<{
                role?: string;
                content?: unknown;
            }>;
        };
        const assistantText = resolveFinalAssistantText(
            output,
            streamedAssistantText,
        );
        throwIfTurnRuntimeAborted(runtimeController.signal);

        await finalizeDeepAgentTurn(
            runtimeInput,
            assistantText,
            finalModelResult,
        );
    } catch (error) {
        if (isTurnRuntimeAbortError(error)) {
            return;
        }
        await failDeepAgentTurn(
            runtimeInput,
            error,
        );
    } finally {
        unregisterRunningTurnRuntime(
            input.sent.turnId,
            runtimeController,
        );
    }
}

/**
 * createCenterDeepAgent：创建当前中心服务轮次的 Deep Agents 原生 agent。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 已组装好的 Deep Agents agent。
 */
async function createCenterDeepAgent(context: DeepAgentsToolExecutionContext) {
    const tools = await createDeepAgentsStructuredToolMiddleware(context).buildTools();
    context.input.events.append({
        eventType: "tool.available.snapshot",
        scopeType: "tool",
        scopeId: context.input.sent.taskId,
        sessionId: context.input.sent.sessionId,
        turnId: context.input.sent.turnId,
        taskId: context.input.sent.taskId,
        status: "completed",
        title: "可用工具快照",
        summary: tools.length > 0
            ? `当前轮次已注入 ${tools.length} 个工具。`
            : "当前轮次没有可用工具。",
        payload: {
            toolNames: tools.map((tool) => tool.name),
            toolCount: tools.length,
        },
    });
    const systemPrompt = await buildCenterDeepAgentSystemPrompt(context);
    registerCenterDeepAgentsHarnessProfile();
    return createDeepAgent({
        model: createLangChainChatModel(context.runtime),
        tools,
        systemPrompt,
        middleware: [
            createCenterToolChoiceMiddleware(context),
        ],
    });
}

/**
 * registerCenterDeepAgentsHarnessProfile：注册中心服务专用 Deep Agents profile。
 *
 * @remarks
 * Deep Agents 默认会给模型追加 todo、文件和 task 内置工具；本项目的工具调用必须全部通过中心服务
 * StructuredTool 和 MCP 工具闭环完成，所以这里只按 Deep Agents 官方 profile 能力排除内置工具名，
 * 不解析用户提示词，也不指定 tool_choice。
 */
function registerCenterDeepAgentsHarnessProfile(): void {
    if (centerDeepAgentsProfileRegistered) {
        return;
    }

    for (const providerName of ["openai", "anthropic"]) {
        registerHarnessProfile(
            providerName,
            {
                excludedTools: DEEPAGENTS_BUILTIN_TOOL_NAMES,
                generalPurposeSubagent: {
                    enabled: false,
                },
            },
        );
    }
    centerDeepAgentsProfileRegistered = true;
}

/**
 * createCenterToolChoiceMiddleware：为 Deep Agents 原生入口补齐中心服务工具选择策略。
 *
 * 关键逻辑：中心服务只把真实工具定义注入模型，不再按用户文本固定解析并强制选择工具；
 * 工具是否调用必须由模型返回的结构化工具调用决定。
 *
 * @param context 当前轮次工具执行上下文。
 * @param userText 用户本轮原文。
 * @returns LangChain Agent 中间件。
 */
function createCenterToolChoiceMiddleware(
    context: DeepAgentsToolExecutionContext,
) {
    let latestModelTools: readonly StructuredToolInterface[] = [];
    return createMiddleware({
        name: "CenterToolChoiceMiddleware",
        afterModel: async (state) => {
            const lastMessage = state.messages.at(-1);
            if (!AIMessage.isInstance(lastMessage)) {
                return;
            }
            context.input.events.append({
                eventType: "model.tool_calls.received",
                scopeType: "model",
                scopeId: context.input.sent.taskId,
                sessionId: context.input.sent.sessionId,
                turnId: context.input.sent.turnId,
                taskId: context.input.sent.taskId,
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
                latestModelTools,
            );
            if (
                request.tool
                || restoredToolName === null
            ) {
                return handler(request);
            }
            context.input.events.append({
                eventType: "model.tool_call.name_restored",
                scopeType: "tool",
                scopeId: context.input.sent.taskId,
                sessionId: context.input.sent.sessionId,
                turnId: context.input.sent.turnId,
                taskId: context.input.sent.taskId,
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
            latestModelTools = request.tools;
            context.input.events.append({
                eventType: "model.tool_choice.evaluated",
                scopeType: "model",
                scopeId: context.input.sent.taskId,
                sessionId: context.input.sent.sessionId,
                turnId: context.input.sent.turnId,
                taskId: context.input.sent.taskId,
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
    });
}

/**
 * resolveEmptyToolNameByArguments：按结构化参数唯一匹配恢复空工具名。
 *
 * @param toolCallName 模型返回的工具名。
 * @param args 模型返回的结构化工具参数。
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
    const schemaRecord = schema as {
        shape?: Record<string, unknown>;
        _def?: {
            shape?: (() => Record<string, unknown>) | Record<string, unknown>;
        };
        properties?: Record<string, unknown>;
        required?: unknown;
        additionalProperties?: unknown;
    };
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
function readToolSchemaPropertyNames(schemaRecord: {
    shape?: Record<string, unknown>;
    _def?: {
        shape?: (() => Record<string, unknown>) | Record<string, unknown>;
    };
    properties?: Record<string, unknown>;
}): string[] {
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
function readToolSchemaRequiredNames(schemaRecord: {
    _def?: {
        shape?: (() => Record<string, unknown>) | Record<string, unknown>;
    };
    required?: unknown;
}): string[] {
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
    id: unknown;
    name: unknown;
    hasArguments: boolean;
}> {
    const rawToolCalls = additionalKwargs.tool_calls;
    if (!Array.isArray(rawToolCalls)) {
        return [];
    }
    return rawToolCalls.map((toolCall) => {
        const toolCallRecord = toolCall as {
            id?: unknown;
            function?: {
                name?: unknown;
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

/**
 * buildCenterDeepAgentSystemPrompt：构造中心服务当前轮次的系统提示。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 系统提示。
 */
async function buildCenterDeepAgentSystemPrompt(context: DeepAgentsToolExecutionContext): Promise<string> {
    const staticCapabilities = listUnifiedToolCapabilities()
        .filter((capability) => {
            return capability.availability === "available"
                && context.executionAgent.canUseToolCapability(capability.toolId);
        })
        .map((capability) => toModelSafeToolName(capability.toolId));
    const mcpSpecs = await listAvailableModelToolSpecsForCenter(
        context.centerDirectory,
        context.executionAgent,
    );
    const dynamicMcpNames = mcpSpecs
        .filter((item) => item.sourceToolId === "builtin.mcp.call")
        .map((item) => item.name);
    const memoryEntries = await listMainAgentMemoryPromptEntries(
        context.input.database,
        context.input.userText,
    );
    const memoryPrompt = memoryEntries.map((memory, index) => {
        const source = memory.sourceSessionId && memory.sourceTurnId
            ? `来源会话 ${memory.sourceSessionId}，轮次 ${memory.sourceTurnId}`
            : "来源未绑定";
        return `${index + 1}. 关键词：${memory.keywords || "无"}；摘要：${memory.summary || "无"}；${source}`;
    }).join("\n");
    const sessionHistoryPrompt = listSessionHistoryPromptMessages(
        context.input.database,
        context.input.sent.sessionId,
        context.input.sent.turnId,
    ).map((message) => {
        return `${message.role}: ${message.content ?? ""}`;
    }).join("\n");

    return [
        "中心服务负责事实源、权限、安全、审计、消息持久化、记忆写入、用量记录和多端同步。",
        "你必须通过结构化工具执行命令、MCP 和智能体领域动作，不得在自然语言里伪造工具已执行。",
        "用户明确要求使用命令工具、执行命令、查看本机环境、读取 Node/pnpm/npm/git 等本机版本或让你实际检查系统状态时，必须调用 `builtin_command_run`；不要只回复代码块、命令文本或说自己可以执行。",
        "如果需要调用工具，必须返回结构化工具调用和合法 JSON 参数；不要用自然语言、Markdown 代码块或伪 JSON 代替工具调用。",
        "当长期记忆或当前会话历史明确记录了用户对助手称呼、自称方式、身份偏好或稳定事实时，相关回答必须优先遵循这些记录。",
        "如果用户询问你的名称、称呼、身份或用户自己的稳定身份，而记忆与会话历史里没有明确记录，只能如实说明当前没有可确认记录，不能自行编造通用自我介绍或名称。",
        "Deep Agents 自带 todoList、文件系统和 task 工具只作为执行内核能力，不得绕过中心服务事实源去宣称写入核心数据。",
        `当前模型：${context.runtime.modelSelection.model}`,
        context.runtime.modelSelection.reasoningEffort
            ? `当前推理深度：${context.runtime.modelSelection.reasoningEffort}`
            : "当前推理深度：未设置",
        staticCapabilities.length > 0
            ? `当前中心服务静态工具能力：${staticCapabilities.join(", ")}`
            : "当前没有可用静态工具能力。",
        dynamicMcpNames.length > 0
            ? `当前可用 MCP 动态工具：${dynamicMcpNames.join(", ")}`
            : "当前没有可用 MCP 动态工具。",
        memoryPrompt
            ? `主智能体长期记忆：\n${memoryPrompt}`
            : "主智能体长期记忆：无。",
        sessionHistoryPrompt
            ? `当前会话历史：\n${sessionHistoryPrompt}`
            : "当前会话历史：无。",
    ].join("\n\n");
}

/**
 * collectDeepAgentMessages：收集 Deep Agents 文本流。
 *
 * @param input 当前轮次输入。
 * @param run Deep Agents 运行流。
 * @returns 最终累积的助手文本。
 */
async function collectDeepAgentMessages(
    input: DeepAgentsAgentRunInput,
    run: CenterDeepAgentRunStream,
): Promise<string> {
    let finalAssistantText = "";
    for await (const message of run.messages) {
        throwIfTurnRuntimeAborted(input.runtimeSignal);
        for await (const textChunk of message.text) {
            throwIfTurnRuntimeAborted(input.runtimeSignal);
            finalAssistantText += textChunk;
            input.events.append({
                eventType: "model.stream.delta",
                scopeType: "model",
                scopeId: input.sent.taskId,
                sessionId: input.sent.sessionId,
                turnId: input.sent.turnId,
                taskId: input.sent.taskId,
                status: "running",
                title: "模型流式片段",
                summary: textChunk.slice(0, 120),
                payload: {
                    deltaText: textChunk,
                    streamSource: "deepagents-v3",
                },
            });
        }
    }
    input.events.append({
        eventType: "model.stream.completed",
        scopeType: "model",
        scopeId: input.sent.taskId,
        sessionId: input.sent.sessionId,
        turnId: input.sent.turnId,
        taskId: input.sent.taskId,
        status: "completed",
        title: "模型流式结束",
        summary: "Deep Agents 模型流式输出已结束。",
        payload: {
            streamSource: "deepagents-v3",
        },
    });
    return finalAssistantText;
}

/**
 * collectDeepAgentToolCalls：消费 Deep Agents 工具调用流并提取最终模型信息。
 *
 * @param context 当前工具执行上下文。
 * @param run Deep Agents 运行流。
 * @returns 模型元数据。
 */
async function collectDeepAgentToolCalls(
    context: DeepAgentsToolExecutionContext,
    run: CenterDeepAgentRunStream,
): Promise<ProviderModelGatewayResult> {
    for await (const toolCall of run.toolCalls) {
        throwIfTurnRuntimeAborted(context.runtimeSignal);
        await recordToolCallLifecycle(
            context,
            toolCall,
        );
    }
    throwIfTurnRuntimeAborted(context.runtimeSignal);

    return {
        providerId: context.runtime.provider.providerId,
        model: context.runtime.modelSelection.model,
        reasoningEffort: context.runtime.modelSelection.reasoningEffort,
        assistantText: "",
        usage: null,
        toolCall: null,
        toolCalls: [],
    };
}

/**
 * recordToolCallLifecycle：为 Deep Agents 工具调用流写入计划事件。
 *
 * @param context 当前工具执行上下文。
 * @param toolCall 工具调用流。
 * @returns 没有返回值。
 */
async function recordToolCallLifecycle(
    context: DeepAgentsToolExecutionContext,
    toolCall: ToolCallStream<string, unknown, unknown>,
): Promise<void> {
    context.input.events.append({
        eventType: "tool.plan.created",
        scopeType: "tool-plan",
        scopeId: toolCall.callId,
        sessionId: context.input.sent.sessionId,
        turnId: context.input.sent.turnId,
        taskId: context.input.sent.taskId,
        status: "running",
        title: "工具计划",
        summary: `Deep Agents 已计划调用 ${toolCall.name}`,
        payload: {
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            input: toolCall.input,
        },
    });

    const status = await toolCall.status;
    const output = status === "finished"
        ? await toolCall.output
        : null;
    const error = await toolCall.error;
    context.input.events.append({
        eventType: status === "finished" ? "tool.plan.completed" : "tool.plan.failed",
        scopeType: "tool-plan",
        scopeId: toolCall.callId,
        sessionId: context.input.sent.sessionId,
        turnId: context.input.sent.turnId,
        taskId: context.input.sent.taskId,
        status: status === "finished" ? "completed" : "failed",
        title: status === "finished" ? "工具计划完成" : "工具计划失败",
        summary: status === "finished"
            ? `Deep Agents 工具 ${toolCall.name} 已完成。`
            : error ?? `Deep Agents 工具 ${toolCall.name} 执行失败。`,
        payload: {
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            input: toolCall.input,
            output,
            error,
        },
    });
    if (status !== "finished") {
        throw new Error(error ?? `DEEPAGENTS_TOOL_PLAN_FAILED:${toolCall.name}`);
    }
}

/**
 * resolveFinalAssistantText：从 Deep Agents 输出状态中提取最终助手正文。
 *
 * @param output Deep Agents 最终输出。
 * @param fallbackText 流式累积正文。
 * @returns 最终助手文本。
 */
function resolveFinalAssistantText(
    output: {
        messages?: Array<{
            role?: string;
            content?: unknown;
        }>;
    },
    fallbackText: string,
): string {
    const assistantMessages = Array.isArray(output.messages)
        ? output.messages.filter((message) => {
            return message.role === "assistant" && typeof message.content === "string";
        })
        : [];
    const finalAssistantText = assistantMessages.length > 0
        ? String(assistantMessages[assistantMessages.length - 1]?.content ?? "")
        : fallbackText;
    return finalAssistantText.trim();
}

/**
 * finalizeDeepAgentTurn：把 Deep Agents 最终结果固化回中心服务事实源。
 *
 * @param input 当前轮次运行输入。
 * @param assistantText 最终助手文本。
 * @param modelResult 当前模型元数据。
 * @returns 没有返回值。
 */
async function finalizeDeepAgentTurn(
    input: DeepAgentsAgentRunInput,
    assistantText: string,
    modelResult: ProviderModelGatewayResult | null,
): Promise<void> {
    throwIfTurnRuntimeAborted(input.runtimeSignal);
    const currentTurn = new SessionRepository(input.database).findTurn(input.sent.turnId);
    if (!currentTurn || currentTurn.endedAt !== null || currentTurn.status === "cancelled") {
        return;
    }
    const assistantMessageId = randomUUID();
    new SessionRepository(input.database).insertAssistantMessageForTurn({
        messageId: assistantMessageId,
        turnId: input.sent.turnId,
        contentMarkdown: assistantText,
        createdAt: formatCenterLocalDateTime(),
    });
    input.events.append({
        eventType: "message.created",
        scopeType: "message",
        scopeId: assistantMessageId,
        sessionId: input.sent.sessionId,
        turnId: input.sent.turnId,
        taskId: input.sent.taskId,
        status: "completed",
        title: "消息创建",
        summary: "助手回复已写入中心服务。",
        payload: {
            messageId: assistantMessageId,
            role: "assistant",
        },
    });
    handleWorkerMessage(
        input.database,
        input.events,
        "task.complete",
        input.sent.taskId,
        {
            assistantMessageId,
            providerId: modelResult?.providerId ?? null,
            model: modelResult?.model ?? null,
            usage: modelResult?.usage ?? null,
        },
    );
    if (input.centerDirectory && input.memoryQueues) {
        await commitMainAgentMemoryAfterTurn(
            input.database,
            input.events,
            input.centerDirectory,
            input.memoryQueues,
            input.sent,
            input.userText,
            assistantText,
        );
    }
    if (modelResult) {
        recordModelUsageAfterTurn(
            input.database,
            input.events,
            input.sent,
            modelResult,
        );
    }
    updateSessionTitleAfterTurn(
        input.database,
        input.events,
        input.sent,
        input.userText,
        assistantText,
    );
    updateTurnStatus(
        input.database,
        input.events,
        input.sent.turnId,
        "completed",
        input.sent.taskId,
    );
}

/**
 * failDeepAgentTurn：统一收尾 Deep Agents 运行异常，避免轮次长期停留在运行中。
 *
 * @param input 当前轮次运行输入。
 * @param error 运行过程中抛出的异常。
 * @returns 没有返回值。
 */
async function failDeepAgentTurn(
    input: DeepAgentsAgentRunInput,
    error: unknown,
): Promise<void> {
    // errorMessage: 失败收尾只写入稳定短文本，避免把堆栈或长输出直接推给前端。
    const errorMessage = error instanceof Error
        ? error.message
        : "DEEPAGENT_TURN_FAILED";
    input.events.append({
        eventType: "message.turn.failed",
        scopeType: "turn",
        scopeId: input.sent.turnId,
        sessionId: input.sent.sessionId,
        turnId: input.sent.turnId,
        taskId: input.sent.taskId,
        status: "failed",
        title: "对话执行失败",
        summary: errorMessage,
        payload: {
            errorMessage,
            errorDetail: error instanceof Error
                ? {
                    name: error.name,
                    message: error.message,
                }
                : {
                    value: String(error),
                },
        },
    });
    updateTurnStatus(
        input.database,
        input.events,
        input.sent.turnId,
        "failed",
        input.sent.taskId,
    );
}
