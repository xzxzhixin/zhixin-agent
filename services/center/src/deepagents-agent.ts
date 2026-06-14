import {randomUUID} from "node:crypto";

import type {StructuredToolInterface} from "@langchain/core/tools";
import {tool} from "@langchain/core/tools";
import type {ToolCallStream} from "@langchain/langgraph";
import {createDeepAgent, type DeepAgentRunStream} from "deepagents";
import {z} from "zod/v3";

import {createAgentForTask} from "./agents/index.js";
import type {CenterDatabase} from "./database.js";
import {SessionRepository} from "./data-access/session-repository.js";
import {
    createTaskStep,
    recordModelUsageAfterTurn,
    updateSessionTitleAfterTurn,
    updateTaskStep,
    updateTurnStatus,
} from "./domain/session-domain.js";
import {commitMainAgentMemoryAfterTurn} from "./domain/session-turn-effects.js";
import {handleWorkerMessage, startWorkerTask} from "./domain/workflow-domain.js";
import type {CenterEventStore} from "./events.js";
import {
    createLangChainChatModel,
    extractCenterDirectory,
    listMainAgentMemoryPromptEntries,
    listSessionHistoryPromptMessages,
    resolveProviderModelRuntime,
    type ProviderModelGatewayResult,
} from "./model-gateway-runtime.js";
import {formatCenterLocalDateTime} from "./time.js";
import type {
    MemoryQueueState,
    SendMessageResponse,
    SubAgentRuntimeRecord,
} from "./types.js";
import {runCommandTool, type CommandToolRequest} from "./tools/command-tool.js";
import {
    listConfiguredMcpModelToolSpecs,
    readMcpDynamicToolName,
    runMcpTool,
    type McpToolRequest,
} from "./tools/mcp-tool.js";
import {appendToolVisibilityEvents, listUnifiedToolCapabilities, toModelSafeToolName} from "./tools/index.js";
import {executeAddAgentTeamMemberTool} from "./tools/add-agent-team-member-tool.js";
import {executeCreateAgentTeamTool} from "./tools/create-agent-team-tool.js";
import {executeCreateLongTermAgentTool} from "./tools/create-long-term-agent-tool.js";
import {executeCreateSubAgentTool} from "./tools/create-sub-agent-tool.js";
import {executeDisbandAgentTeamTool} from "./tools/disband-agent-team-tool.js";
import {executeRemoveAgentTeamMemberTool} from "./tools/remove-agent-team-member-tool.js";

/**
 * DeepAgentsAgentRunInput：直接驱动 Deep Agents 原生 agent 的输入。
 */
export interface DeepAgentsAgentRunInput {
    /** database: 中心服务数据库。 */
    database: CenterDatabase;
    /** events: 中心服务事件仓储。 */
    events: CenterEventStore;
    /** sent: 当前轮次身份。 */
    sent: SendMessageResponse;
    /** userText: 用户原始输入。 */
    userText: string;
    /** centerDirectory: 中心目录。 */
    centerDirectory?: string;
    /** memoryQueues: 记忆单写队列。 */
    memoryQueues?: Map<string, MemoryQueueState>;
}

interface ToolExecutionContext {
    /** input: 当前轮次输入。 */
    input: DeepAgentsAgentRunInput;
    /** centerDirectory: 当前中心目录。 */
    centerDirectory: string;
    /** executionAgent: 当前执行智能体。 */
    executionAgent: ReturnType<typeof createAgentForTask>;
    /** runtime: 当前模型运行时。 */
    runtime: ReturnType<typeof resolveProviderModelRuntime>;
}

interface ToolExecutionResult {
    /** outputText: 回填给模型的文本。 */
    outputText: string;
    /** status: 工具执行状态。 */
    status: "completed" | "failed";
}

type CenterDeepAgentRunStream = DeepAgentRunStream<
    Record<string, unknown>,
    readonly StructuredToolInterface[]
>;

/**
 * runDeepAgentsAgentTurn：直接用 Deep Agents 原生 agent 执行当前轮次。
 *
 * @param input 运行输入。
 * @returns 没有返回值。
 */
export async function runDeepAgentsAgentTurn(input: DeepAgentsAgentRunInput): Promise<void> {
    startWorkerTask(
        input.database,
        input.events,
        input.sent.taskId,
    );

    const context = await createToolExecutionContext(input);
    appendToolVisibilityEvents(
        input.events,
        input.sent.sessionId,
        input.sent.taskId,
        input.sent.turnId,
    );

    const assistantStep = createTaskStep(
        input.database,
        input.events,
        {
            taskId: input.sent.taskId,
            sessionId: input.sent.sessionId,
            turnId: input.sent.turnId,
        },
        "Deep Agents 原生执行",
        {
            source: "system",
            initialStatus: "running",
            summary: "当前轮次已切入 Deep Agents 原生 agent。",
        },
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
        },
    ) as CenterDeepAgentRunStream;

    const messageCollector = collectDeepAgentMessages(input, run);
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

    await finalizeDeepAgentTurn(
        input,
        assistantText,
        finalModelResult,
    );

    updateTaskStep(
        input.database,
        input.events,
        assistantStep.stepId,
        "completed",
        "Deep Agents 原生 agent 已完成当前轮次执行。",
    );
}

/**
 * createToolExecutionContext：构造 Deep Agents 执行上下文。
 *
 * @param input 当前轮次输入。
 * @returns 已解析的工具执行上下文。
 */
async function createToolExecutionContext(input: DeepAgentsAgentRunInput): Promise<ToolExecutionContext> {
    const centerDirectory = input.centerDirectory ?? extractCenterDirectory(input.database);
    if (!centerDirectory) {
        throw new Error("CENTER_DIRECTORY_NOT_AVAILABLE");
    }
    const task = new SessionRepository(input.database).findTask(input.sent.taskId);
    return {
        input,
        centerDirectory,
        executionAgent: createAgentForTask(task),
        runtime: resolveProviderModelRuntime(
            input.database,
            input.sent.taskId,
        ),
    };
}

/**
 * createCenterDeepAgent：创建当前中心服务轮次的 Deep Agents 原生 agent。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 已组装好的 Deep Agents agent。
 */
async function createCenterDeepAgent(context: ToolExecutionContext) {
    const tools = await createCenterStructuredTools(context);
    const systemPrompt = await buildCenterDeepAgentSystemPrompt(context);
    return createDeepAgent({
        model: createLangChainChatModel(context.runtime),
        tools,
        systemPrompt,
    });
}

/**
 * buildCenterDeepAgentSystemPrompt：构造中心服务当前轮次的系统提示。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 系统提示。
 */
async function buildCenterDeepAgentSystemPrompt(context: ToolExecutionContext): Promise<string> {
    const staticCapabilities = listUnifiedToolCapabilities()
        .filter((capability) => {
            return capability.availability === "available"
                && context.executionAgent.canUseToolCapability(capability.toolId);
        })
        .map((capability) => capability.toolId);
    const mcpSpecs = context.executionAgent.canUseToolCapability("builtin.mcp.call")
        ? await listConfiguredMcpModelToolSpecs(context.centerDirectory)
        : [];
    const memoryPrompt = listMainAgentMemoryPromptEntries(context.input.database).map((memory, index) => {
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
        "你运行在致心智能体中心服务的受控 Deep Agents 环境中。",
        "中心服务负责事实源、权限、安全、审计、消息持久化、记忆写入、用量记录和多端同步。",
        "你必须通过结构化工具执行命令、MCP 和智能体领域动作，不得在自然语言里伪造工具已执行。",
        "Deep Agents 自带 todoList、文件系统和 task 工具只作为执行内核能力，不得绕过中心服务事实源去宣称写入核心数据。",
        `当前模型：${context.runtime.modelSelection.model}`,
        context.runtime.modelSelection.reasoningEffort
            ? `当前推理深度：${context.runtime.modelSelection.reasoningEffort}`
            : "当前推理深度：未设置",
        staticCapabilities.length > 0
            ? `当前中心服务静态工具能力：${staticCapabilities.join(", ")}`
            : "当前没有可用静态工具能力。",
        mcpSpecs.length > 0
            ? `当前可用 MCP 动态工具：${mcpSpecs.map((item) => item.name).join(", ")}`
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
 * createCenterStructuredTools：把中心服务工具桥接为 Deep Agents 可调用工具。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 工具数组。
 */
async function createCenterStructuredTools(
    context: ToolExecutionContext,
): Promise<StructuredToolInterface[]> {
    const tools: StructuredToolInterface[] = [];

    if (context.executionAgent.canUseToolCapability("builtin.command.run")) {
        tools.push(createCommandStructuredTool(context));
    }

    if (context.executionAgent.canUseToolCapability("builtin.mcp.call")) {
        const mcpSpecs = await listConfiguredMcpModelToolSpecs(context.centerDirectory);
        tools.push(...mcpSpecs.map((toolSpec) => {
            const decoded = readMcpDynamicToolName(toolSpec.name);
            if (!decoded) {
                throw new Error(`MCP_DYNAMIC_TOOL_NAME_INVALID:${toolSpec.name}`);
            }
            return createDynamicMcpStructuredTool(
                context,
                toolSpec.name,
                toolSpec.description,
                decoded.serverId,
                decoded.toolName,
                toolSpec.parametersJsonSchema,
            );
        }));
    }

    if (context.executionAgent.canUseToolCapability("builtin.agent.createLongTerm")) {
        tools.push(createLongTermAgentStructuredTool(context));
    }
    if (context.executionAgent.canUseToolCapability("builtin.agent.createSubAgent")) {
        tools.push(createSubAgentStructuredTool(context));
    }
    if (context.executionAgent.canUseToolCapability("create-agent-team")) {
        tools.push(createAgentTeamStructuredTool(context));
    }
    if (context.executionAgent.canUseToolCapability("disband-agent-team")) {
        tools.push(createDisbandAgentTeamStructuredTool(context));
    }
    if (context.executionAgent.canUseToolCapability("add-agent-team-member")) {
        tools.push(createAddAgentTeamMemberStructuredTool(context));
    }
    if (context.executionAgent.canUseToolCapability("remove-agent-team-member")) {
        tools.push(createRemoveAgentTeamMemberStructuredTool(context));
    }

    return tools;
}

/**
 * createCommandStructuredTool：创建命令工具。
 *
 * @param context 当前工具执行上下文。
 * @returns 结构化命令工具。
 */
function createCommandStructuredTool(context: ToolExecutionContext): StructuredToolInterface {
    return tool(
        async (toolInput) => runStructuredTool(
            context,
            "builtin.command.run",
            toModelSafeToolName("builtin.command.run"),
            toolInput,
            async () => {
                const request: CommandToolRequest = {
                    toolCallId: null,
                    shellCommand: toolInput.shellCommand,
                    executablePath: toolInput.executablePath ?? "",
                    args: toolInput.args ?? [],
                    inputSummary: toolInput.inputSummary,
                };
                const result = await runCommandTool(
                    context.input.events,
                    context.input.sent.sessionId,
                    context.input.sent.taskId,
                    context.input.sent.turnId,
                    request,
                );
                return {
                    outputText: result.status === "completed"
                        ? result.outputSummary || "工具没有输出。"
                        : result.failureReason ?? "工具执行失败。",
                    status: result.status,
                };
            },
        ),
        {
            name: toModelSafeToolName("builtin.command.run"),
            description: "在中心服务受控环境中执行明确的本机命令。",
            schema: z.object({
                shellCommand: z.string().optional(),
                executablePath: z.string().optional(),
                args: z.array(z.string()).optional(),
                inputSummary: z.string(),
            }),
        },
    );
}

/**
 * createDynamicMcpStructuredTool：创建单个 MCP 动态工具。
 *
 * @param context 当前工具执行上下文。
 * @param toolName 模型可见工具名。
 * @param description 工具说明。
 * @param serverId MCP Server ID。
 * @param innerToolName MCP 内部工具名。
 * @returns 结构化 MCP 工具。
 */
function createDynamicMcpStructuredTool(
    context: ToolExecutionContext,
    toolName: string,
    description: string,
    serverId: string,
    innerToolName: string,
    parametersJsonSchema: Record<string, unknown>,
): StructuredToolInterface {
    void parametersJsonSchema;
    return tool(
        async (toolInput) => runStructuredTool(
            context,
            "builtin.mcp.call",
            toolName,
            toolInput,
            async () => {
                const request: McpToolRequest = {
                    toolCallId: null,
                    serverId,
                    toolName: innerToolName,
                    arguments: toolInput,
                    inputSummary: `调用 MCP ${serverId}.${innerToolName}`,
                };
                const result = await runMcpTool(
                    context.input.events,
                    context.centerDirectory,
                    context.input.sent.sessionId,
                    context.input.sent.taskId,
                    context.input.sent.turnId,
                    request,
                );
                return {
                    outputText: result.status === "completed"
                        ? result.outputSummary || "工具没有输出。"
                        : result.failureReason ?? "工具执行失败。",
                    status: result.status,
                };
            },
        ),
        {
            name: toolName,
            description,
            schema: z.record(z.unknown()),
        },
    );
}

/**
 * createLongTermAgentStructuredTool：创建长期智能体工具。
 *
 * @param context 当前工具执行上下文。
 * @returns 长期智能体工具。
 */
function createLongTermAgentStructuredTool(context: ToolExecutionContext): StructuredToolInterface {
    return tool(
        async (toolInput) => runStructuredTool(
            context,
            "builtin.agent.createLongTerm",
            toModelSafeToolName("builtin.agent.createLongTerm"),
            toolInput,
            async () => {
                const result = executeCreateLongTermAgentTool(
                    context.input.database,
                    context.input.events,
                    context.centerDirectory,
                    {
                        name: toolInput.name,
                        roleDescription: toolInput.roleDescription,
                        capabilityBoundary: toolInput.capabilityBoundary,
                    },
                );
                return {
                    outputText: JSON.stringify(result),
                    status: "completed",
                };
            },
        ),
        {
            name: toModelSafeToolName("builtin.agent.createLongTerm"),
            description: "创建长期智能体。",
            schema: z.object({
                name: z.string(),
                roleDescription: z.string(),
                capabilityBoundary: z.string().optional(),
            }),
        },
    );
}

/**
 * createSubAgentStructuredTool：创建子智能体工具。
 *
 * @param context 当前工具执行上下文。
 * @returns 子智能体工具。
 */
function createSubAgentStructuredTool(context: ToolExecutionContext): StructuredToolInterface {
    return tool(
        async (toolInput) => runStructuredTool(
            context,
            "builtin.agent.createSubAgent",
            toModelSafeToolName("builtin.agent.createSubAgent"),
            toolInput,
            async () => {
                const result = executeCreateSubAgentTool(
                    context.input.events,
                    new Map<string, SubAgentRuntimeRecord>(),
                    {
                        parentAgentId: toolInput.parentAgentId ?? "main",
                        parentAgentKind: toolInput.parentAgentKind ?? "main",
                        taskId: context.input.sent.taskId,
                        parentProviderId: context.runtime.provider.providerId,
                        parentModelId: context.runtime.modelSelection.model,
                        parentReasoningEffort: context.runtime.modelSelection.reasoningEffort,
                        name: toolInput.name,
                    },
                );
                return {
                    outputText: JSON.stringify(result),
                    status: "completed",
                };
            },
        ),
        {
            name: toModelSafeToolName("builtin.agent.createSubAgent"),
            description: "创建子智能体。",
            schema: z.object({
                name: z.string(),
                parentAgentId: z.string().optional(),
                parentAgentKind: z.enum([
                    "main",
                    "long-term",
                    "sub",
                ]).optional(),
            }),
        },
    );
}

function createAgentTeamStructuredTool(context: ToolExecutionContext): StructuredToolInterface {
    return tool(
        async (toolInput) => runStructuredTool(
            context,
            "create-agent-team",
            toModelSafeToolName("create-agent-team"),
            toolInput,
            async () => {
                const result = executeCreateAgentTeamTool(
                    {
                        database: context.input.database,
                        events: context.input.events,
                        sessionId: context.input.sent.sessionId,
                        turnId: context.input.sent.turnId,
                        taskId: context.input.sent.taskId,
                        creatorAgentId: "main",
                        toolCallId: null,
                    },
                    {
                        name: toolInput.name,
                        description: toolInput.description ?? null,
                        memberAgentIds: toolInput.memberAgentIds,
                    },
                );
                return {
                    outputText: JSON.stringify(result),
                    status: "completed",
                };
            },
        ),
        {
            name: toModelSafeToolName("create-agent-team"),
            description: "创建会话 team。",
            schema: z.object({
                name: z.string(),
                description: z.string().optional(),
                memberAgentIds: z.array(z.string()),
            }),
        },
    );
}

function createDisbandAgentTeamStructuredTool(context: ToolExecutionContext): StructuredToolInterface {
    return tool(
        async (toolInput) => runStructuredTool(
            context,
            "disband-agent-team",
            toModelSafeToolName("disband-agent-team"),
            toolInput,
            async () => {
                const result = executeDisbandAgentTeamTool(
                    {
                        database: context.input.database,
                        events: context.input.events,
                        sessionId: context.input.sent.sessionId,
                        turnId: context.input.sent.turnId,
                        taskId: context.input.sent.taskId,
                        creatorAgentId: "main",
                        toolCallId: null,
                    },
                    {
                        teamId: toolInput.teamId,
                    },
                );
                return {
                    outputText: JSON.stringify(result),
                    status: "completed",
                };
            },
        ),
        {
            name: toModelSafeToolName("disband-agent-team"),
            description: "解散会话 team。",
            schema: z.object({
                teamId: z.string(),
            }),
        },
    );
}

function createAddAgentTeamMemberStructuredTool(context: ToolExecutionContext): StructuredToolInterface {
    return tool(
        async (toolInput) => runStructuredTool(
            context,
            "add-agent-team-member",
            toModelSafeToolName("add-agent-team-member"),
            toolInput,
            async () => {
                const result = executeAddAgentTeamMemberTool(
                    {
                        database: context.input.database,
                        events: context.input.events,
                        sessionId: context.input.sent.sessionId,
                        turnId: context.input.sent.turnId,
                        taskId: context.input.sent.taskId,
                        creatorAgentId: "main",
                        toolCallId: null,
                    },
                    {
                        teamId: toolInput.teamId,
                        agentId: toolInput.agentId,
                        role: toolInput.role,
                    },
                );
                return {
                    outputText: JSON.stringify(result),
                    status: "completed",
                };
            },
        ),
        {
            name: toModelSafeToolName("add-agent-team-member"),
            description: "添加会话 team 成员。",
            schema: z.object({
                teamId: z.string(),
                agentId: z.string(),
                role: z.string().optional(),
            }),
        },
    );
}

function createRemoveAgentTeamMemberStructuredTool(context: ToolExecutionContext): StructuredToolInterface {
    return tool(
        async (toolInput) => runStructuredTool(
            context,
            "remove-agent-team-member",
            toModelSafeToolName("remove-agent-team-member"),
            toolInput,
            async () => {
                const result = executeRemoveAgentTeamMemberTool(
                    {
                        database: context.input.database,
                        events: context.input.events,
                        sessionId: context.input.sent.sessionId,
                        turnId: context.input.sent.turnId,
                        taskId: context.input.sent.taskId,
                        creatorAgentId: "main",
                        toolCallId: null,
                    },
                    {
                        teamId: toolInput.teamId,
                        agentId: toolInput.agentId,
                    },
                );
                return {
                    outputText: JSON.stringify(result),
                    status: "completed",
                };
            },
        ),
        {
            name: toModelSafeToolName("remove-agent-team-member"),
            description: "移除会话 team 成员。",
            schema: z.object({
                teamId: z.string(),
                agentId: z.string(),
            }),
        },
    );
}

/**
 * runStructuredTool：统一包装模型请求与结果回填事件。
 *
 * @param context 当前工具执行上下文。
 * @param internalToolId 中心服务内部工具 ID。
 * @param modelToolName 模型可见工具名。
 * @param toolInput 工具参数。
 * @param executor 真实工具执行逻辑。
 * @returns 返回给模型的结果文本。
 */
async function runStructuredTool(
    context: ToolExecutionContext,
    internalToolId: string,
    modelToolName: string,
    toolInput: Record<string, unknown>,
    executor: () => Promise<ToolExecutionResult>,
): Promise<string> {
    const toolCallId = randomUUID();
    context.input.events.append({
        eventType: "model.tool.requested",
        scopeType: "tool",
        scopeId: context.input.sent.taskId,
        sessionId: context.input.sent.sessionId,
        turnId: context.input.sent.turnId,
        taskId: context.input.sent.taskId,
        status: "running",
        title: "模型请求工具",
        summary: `模型请求调用 ${modelToolName}`,
        payload: {
            toolId: internalToolId,
            toolCallId,
            toolName: modelToolName,
            argumentsJson: toolInput,
        },
    });

    const result = await executor();

    context.input.events.append({
        eventType: "model.tool.result.appended",
        scopeType: "model",
        scopeId: context.input.sent.taskId,
        sessionId: context.input.sent.sessionId,
        turnId: context.input.sent.turnId,
        taskId: context.input.sent.taskId,
        status: "completed",
        title: "工具结果回填模型",
        summary: `已回填工具结果：${modelToolName}`,
        payload: {
            toolId: internalToolId,
            toolCallId,
            toolName: modelToolName,
            status: result.status,
            resultSummary: result.outputText.slice(0, 240),
        },
    });

    return result.outputText;
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
        for await (const textChunk of message.text) {
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
    context: ToolExecutionContext,
    run: CenterDeepAgentRunStream,
): Promise<ProviderModelGatewayResult> {
    for await (const toolCall of run.toolCalls) {
        await recordToolCallLifecycle(
            context,
            toolCall,
        );
    }

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
    context: ToolExecutionContext,
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
