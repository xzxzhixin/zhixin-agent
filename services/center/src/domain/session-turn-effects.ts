import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import type {ProviderModelGatewayResult} from "../model-gateway-runtime.js";
import type {SendMessageResponse} from "../types.js";
import type {MemoryQueueState} from "../types.js";
import {
    writeAgentMemory,
    type MemoryWriteInput,
} from "./agent-domain.js";
import {createDataAccess} from "../data-access/index.js";
import {syncTurnMemoryToMem0} from "../memory-engine.js";
import {
    createTaskStep,
    findTask,
    updateTaskStep,
} from "./session-domain.js";
import {
    createAgentForTask,
} from "../agents/index.js";
import {
    buildUnifiedToolCallIntentFromModelCall,
    commandRequestFromUnifiedToolIntent,
    mcpRequestFromUnifiedToolIntent,
    runCommandTool,
    runMcpTool,
} from "../tools/index.js";
import {
    executeCreateLongTermAgentTool,
} from "../tools/create-long-term-agent-tool.js";
import {
    executeCreateSubAgentTool,
} from "../tools/create-sub-agent-tool.js";
import {
    executeAddAgentTeamMemberTool,
} from "../tools/add-agent-team-member-tool.js";
import {
    executeCreateAgentTeamTool,
} from "../tools/create-agent-team-tool.js";
import {
    executeDisbandAgentTeamTool,
} from "../tools/disband-agent-team-tool.js";
import {
    executeRemoveAgentTeamMemberTool,
} from "../tools/remove-agent-team-member-tool.js";
import {
    executeTodoListTool,
    type TodoListToolItem,
} from "../tools/todo-list-tool.js";
import type {SubAgentRuntimeRecord} from "../types.js";
import {
    stepTaskFromGraphContext,
    type TurnGraphCheckpoint,
    type TurnGraphContext,
    withOptionalGraphCheckpoint,
    withTurnGraphCheckpoint,
} from "./turn-graph-domain.js";

/**
 * commitMainAgentMemoryAfterTurn：正常会话完成后追加主智能体长期记忆。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param memoryQueues 智能体记忆单写队列。
 * @param sent 当前轮次身份。
 * @param userText 用户本轮输入。
 * @param assistantText 助手本轮回复。
 * @param graphCheckpoint 记忆节点图检查点。
 * @returns 没有返回值。
 */
export async function commitMainAgentMemoryAfterTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    memoryQueues: Map<string, MemoryQueueState>,
    sent: SendMessageResponse,
    userText: string,
    assistantText: string,
    graphCheckpoint?: TurnGraphCheckpoint,
): Promise<void> {
    // memoryInput: 记忆写入边界是一轮完整对话，索引必须绑定当前会话和轮次便于迁移后追溯。
    const memoryInput: MemoryWriteInput = {
        agentId: "main",
        keywords: summarizeMemoryKeywords(userText),
        summary: summarizeMemoryText(userText, assistantText),
        userText,
        assistantText,
        sourceSessionId: sent.sessionId,
        sourceTurnId: sent.turnId,
        attachmentRefsJson: "[]",
    };
    const memoryResult = writeAgentMemory(
        database,
        events,
        centerDirectory,
        memoryQueues,
        memoryInput,
    );
    events.append({
        eventType: "memory.write.graph_checkpoint",
        scopeType: "agent",
        scopeId: memoryInput.agentId,
        sessionId: sent.sessionId,
        turnId: sent.turnId,
        taskId: sent.taskId,
        agentId: memoryInput.agentId,
        status: "completed",
        title: "记忆图检查点",
        summary: "主智能体记忆写入已绑定当前 LangGraph 节点。",
        payload: withOptionalGraphCheckpoint({
            sourceSessionId: sent.sessionId,
            sourceTurnId: sent.turnId,
            relativePath: memoryResult.relativePath,
        }, graphCheckpoint),
    });
    await syncTurnMemoryToMem0(
        events,
        centerDirectory,
        {
            agentId: memoryInput.agentId,
            projectId: null,
            sourceSessionId: sent.sessionId,
            sourceTurnId: sent.turnId,
            sourceMemoryPath: memoryResult.relativePath,
            sourceMemoryText: memoryInput.summary,
        },
    );
}

/**
 * executeModelRequestedTools：执行当前模型回复中携带的一组工具调用。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 当前轮次身份。
 * @param modelResult 当前模型返回。
 * @param graphContext 当前对话图上下文。
 * @param toolExecuteCheckpoint 工具执行节点检查点。
 * @returns 可回填模型的工具结果。
 */
export async function executeModelRequestedTools(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    modelResult: ProviderModelGatewayResult,
    graphContext: TurnGraphContext,
    toolExecuteCheckpoint: TurnGraphCheckpoint,
): Promise<Array<{
    toolCall: NonNullable<ProviderModelGatewayResult["toolCall"]>;
    resultText: string;
    unifiedToolIntent: NonNullable<ReturnType<typeof buildUnifiedToolCallIntentFromModelCall>>;
}>> {
    const toolResults: Array<{
        toolCall: NonNullable<ProviderModelGatewayResult["toolCall"]>;
        resultText: string;
        unifiedToolIntent: NonNullable<ReturnType<typeof buildUnifiedToolCallIntentFromModelCall>>;
    }> = [];
    const executionAgent = createAgentForTask(findTask(database, sent.taskId));

    for (const toolCall of modelResult.toolCalls) {
        events.append({
            eventType: "model.tool.requested",
            scopeType: "tool",
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "running",
            title: "模型请求工具",
            summary: `模型请求调用 ${toolCall.name}`,
            payload: withTurnGraphCheckpoint({
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.name,
                argumentsJson: toolCall.argumentsJson,
            }, toolExecuteCheckpoint),
        });

        const unifiedToolIntent = buildUnifiedToolCallIntentFromModelCall(
            toolCall,
            executionAgent,
        );
        if (!unifiedToolIntent || ![
            "agent",
            "command",
            "mcp",
        ].includes(unifiedToolIntent.toolKind)) {
            events.append({
                eventType: "model.tool.rejected",
                scopeType: "tool",
                scopeId: sent.taskId,
                sessionId: sent.sessionId,
                turnId: sent.turnId,
                taskId: sent.taskId,
                status: "failed",
                title: "模型工具请求未执行",
                summary: "模型请求的工具不存在、不可用或当前最小闭环暂不支持。",
                payload: withTurnGraphCheckpoint({
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.name,
                }, toolExecuteCheckpoint),
            });
            continue;
        }

        const toolStep = createTaskStep(
            database,
            events,
            stepTaskFromGraphContext(graphContext),
            resolveToolStepTitle(unifiedToolIntent.toolKind),
            {},
            toolExecuteCheckpoint,
        );
        const toolResult = unifiedToolIntent.toolKind === "agent"
            ? runAgentTool(
                database,
                events,
                sent,
                modelResult,
                unifiedToolIntent,
                toolCall.toolCallId,
                toolExecuteCheckpoint,
            )
            : unifiedToolIntent.toolKind === "command"
            ? await runCommandTool(
                events,
                sent.sessionId,
                sent.taskId,
                sent.turnId,
                {
                    ...commandRequestFromUnifiedToolIntent(unifiedToolIntent),
                    toolCallId: toolCall.toolCallId,
                },
                toolExecuteCheckpoint,
            )
            : await runMcpTool(
                events,
                extractCenterDirectoryForToolLoop(database),
                sent.sessionId,
                sent.taskId,
                sent.turnId,
                {
                    ...mcpRequestFromUnifiedToolIntent(unifiedToolIntent),
                    toolCallId: toolCall.toolCallId,
                },
                toolExecuteCheckpoint,
            );
        updateTaskStep(
            database,
            events,
            toolStep.stepId,
            toolResult.status,
            toolResult.status === "completed"
                ? `${resolveToolKindLabel(unifiedToolIntent.toolKind)}工具执行完成：${toolResult.outputSummary || "工具没有输出。"}`
                : `${resolveToolKindLabel(unifiedToolIntent.toolKind)}工具执行失败：${toolResult.failureReason ?? "未返回失败原因。"}`,
            toolExecuteCheckpoint,
        );
        toolResults.push({
            toolCall,
            resultText: toolResult.status === "completed"
                ? toolResult.outputSummary || "工具没有输出。"
                : toolResult.failureReason ?? "工具执行失败。",
            unifiedToolIntent,
        });
    }

    return toolResults;
}

/**
 * runAgentTool：执行智能体与 team 类模型工具。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 当前轮次身份。
 * @param modelResult 当前模型结果，用于继承父级供应商、模型和推理深度。
 * @param intent 统一工具意图。
 * @param toolCallId 模型工具调用 ID。
 * @param graphCheckpoint 当前图检查点。
 * @returns 可回填模型的工具结果。
 */
function runAgentTool(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    modelResult: ProviderModelGatewayResult,
    intent: NonNullable<ReturnType<typeof buildUnifiedToolCallIntentFromModelCall>>,
    toolCallId: string,
    graphCheckpoint: TurnGraphCheckpoint,
): {
    toolKind: "agent";
    status: "completed" | "failed";
    outputSummary: string;
    failureReason: string | null;
    traceId: string;
} {
    try {
        const creatorAgentId = typeof intent.arguments.creatorAgentId === "string"
            ? intent.arguments.creatorAgentId
            : "main";
        if (intent.toolId === "builtin.todo.list") {
            const currentTask = findTask(
                database,
                sent.taskId,
            );
            if (!currentTask) {
                return {
                    toolKind: "agent",
                    status: "failed",
                    outputSummary: "",
                    failureReason: "TODO_LIST_TASK_NOT_FOUND",
                    traceId: "",
                };
            }
            const result = executeTodoListTool(
                database,
                events,
                {
                    sessionId: sent.sessionId,
                    turnId: sent.turnId,
                    taskId: sent.taskId,
                    agentId: currentTask.agentId,
                    toolCallId,
                    items: readTodoListItems(intent.arguments.items),
                },
            );
            return {
                toolKind: "agent",
                status: result.status,
                outputSummary: result.outputSummary,
                failureReason: result.failureReason,
                traceId: "",
            };
        }

        const result = intent.toolId === "builtin.agent.createLongTerm"
            ? executeCreateLongTermAgentTool(
                database,
                events,
                extractCenterDirectoryForToolLoop(database),
                {
                    name: String(intent.arguments.name ?? "新长期智能体"),
                    roleDescription: String(intent.arguments.roleDescription ?? "由主智能体按当前任务创建。"),
                    capabilityBoundary: typeof intent.arguments.capabilityBoundary === "string"
                        ? intent.arguments.capabilityBoundary
                        : undefined,
                },
            )
            : intent.toolId === "create-agent-team"
            ? executeCreateAgentTeamTool(
                {
                    database,
                    events,
                    sessionId: sent.sessionId,
                    turnId: sent.turnId,
                    taskId: sent.taskId,
                    creatorAgentId,
                    toolCallId,
                },
                {
                    name: String(intent.arguments.name ?? "协作 team"),
                    description: typeof intent.arguments.description === "string"
                        ? intent.arguments.description
                        : null,
                    memberAgentIds: Array.isArray(intent.arguments.memberAgentIds)
                        ? intent.arguments.memberAgentIds.map((agentId) => String(agentId))
                        : [],
                },
            )
            : intent.toolId === "disband-agent-team"
            ? executeDisbandAgentTeamTool(
                {
                    database,
                    events,
                    sessionId: sent.sessionId,
                    turnId: sent.turnId,
                    taskId: sent.taskId,
                    creatorAgentId,
                    toolCallId,
                },
                {
                    teamId: String(intent.arguments.teamId ?? ""),
                },
            )
            : intent.toolId === "add-agent-team-member"
            ? executeAddAgentTeamMemberTool(
                {
                    database,
                    events,
                    sessionId: sent.sessionId,
                    turnId: sent.turnId,
                    taskId: sent.taskId,
                    creatorAgentId,
                    toolCallId,
                },
                {
                    teamId: String(intent.arguments.teamId ?? ""),
                    agentId: String(intent.arguments.agentId ?? ""),
                    role: typeof intent.arguments.role === "string"
                        ? intent.arguments.role
                        : undefined,
                },
            )
            : intent.toolId === "remove-agent-team-member"
            ? executeRemoveAgentTeamMemberTool(
                {
                    database,
                    events,
                    sessionId: sent.sessionId,
                    turnId: sent.turnId,
                    taskId: sent.taskId,
                    creatorAgentId,
                    toolCallId,
                },
                {
                    teamId: String(intent.arguments.teamId ?? ""),
                    agentId: String(intent.arguments.agentId ?? ""),
                },
            )
            : executeCreateSubAgentTool(
                events,
                new Map<string, SubAgentRuntimeRecord>(),
                {
                    parentAgentId: typeof intent.arguments.parentAgentId === "string"
                        ? intent.arguments.parentAgentId
                        : "main",
                    parentAgentKind: intent.arguments.parentAgentKind === "long-term" || intent.arguments.parentAgentKind === "sub"
                        ? intent.arguments.parentAgentKind
                        : "main",
                    taskId: sent.taskId,
                    parentProviderId: typeof intent.arguments.parentProviderId === "string"
                        ? intent.arguments.parentProviderId
                        : modelResult.providerId,
                    parentModelId: typeof intent.arguments.parentModelId === "string"
                        ? intent.arguments.parentModelId
                        : modelResult.model,
                    parentReasoningEffort: typeof intent.arguments.parentReasoningEffort === "string"
                        ? intent.arguments.parentReasoningEffort
                        : modelResult.reasoningEffort,
                    name: String(intent.arguments.name ?? "子智能体"),
                },
            );
        const outputSummary = JSON.stringify(result);
        events.append({
            eventType: "tool.agent.completed",
            scopeType: "tool",
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "completed",
            title: "智能体工具完成",
            summary: outputSummary,
            payload: withTurnGraphCheckpoint({
                toolId: intent.toolId,
                toolKind: "agent",
                toolCallId,
                result,
            }, graphCheckpoint),
        });
        return {
            toolKind: "agent",
            status: "completed",
            outputSummary,
            failureReason: null,
            traceId: "",
        };
    } catch (error) {
        const failureReason = error instanceof Error ? error.message : "AGENT_TOOL_FAILED";
        events.append({
            eventType: "tool.agent.failed",
            scopeType: "tool",
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "failed",
            title: "智能体工具失败",
            summary: failureReason,
            payload: withTurnGraphCheckpoint({
                toolId: intent.toolId,
                toolKind: "agent",
                toolCallId,
                failureReason,
            }, graphCheckpoint),
            errorCode: "AGENT_TOOL_FAILED",
        });
        return {
            toolKind: "agent",
            status: "failed",
            outputSummary: "",
            failureReason,
            traceId: "",
        };
    }
}

/**
 * readTodoListItems：从模型参数中读取 todoList 条目数组。
 *
 * @param value 模型传入的 items 字段。
 * @returns 结构化 todoList 条目；格式不正确时返回空数组。
 */
function readTodoListItems(value: unknown): TodoListToolItem[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((item) => {
        if (!item || typeof item !== "object") {
            return {
                title: "",
            };
        }
        const record = item as Record<string, unknown>;
        return {
            id: typeof record.id === "string"
                ? record.id
                : undefined,
            title: typeof record.title === "string"
                ? record.title
                : "",
            status: typeof record.status === "string"
                ? record.status as TodoListToolItem["status"]
                : undefined,
            dependsOn: Array.isArray(record.dependsOn)
                ? record.dependsOn.filter((stepId) => {
                    return typeof stepId === "string";
                }) as string[]
                : undefined,
            acceptance: typeof record.acceptance === "string"
                ? record.acceptance
                : null,
        };
    });
}

/**
 * resolveToolStepTitle：根据工具类型返回任务步骤标题。
 *
 * @param toolKind 统一工具类型。
 * @returns 任务步骤标题。
 */
function resolveToolStepTitle(toolKind: string): string {
    if (toolKind === "command") {
        return "命令工具执行";
    }
    if (toolKind === "mcp") {
        return "MCP 工具执行";
    }
    return "智能体工具执行";
}

/**
 * resolveToolKindLabel：根据工具类型返回中文前缀。
 *
 * @param toolKind 统一工具类型。
 * @returns 中文工具类型。
 */
function resolveToolKindLabel(toolKind: string): string {
    if (toolKind === "command") {
        return "命令";
    }
    if (toolKind === "mcp") {
        return "MCP";
    }
    return "智能体";
}

/**
 * summarizeMemoryKeywords：从本轮用户输入生成简短关键词。
 *
 * @param userText 用户本轮输入。
 * @returns 关键词文本。
 */
function summarizeMemoryKeywords(userText: string): string {
    const normalized = userText.replace(/\s+/gu, " ").trim();
    return normalized.length > 0
        ? normalized.slice(0, 24)
        : "对话";
}

/**
 * summarizeMemoryText：生成长期记忆摘要。
 *
 * @param userText 用户本轮输入。
 * @param assistantText 助手本轮回复。
 * @returns 记忆摘要。
 */
function summarizeMemoryText(
    userText: string,
    assistantText: string,
): string {
    const normalized = `${userText}\n${assistantText}`.replace(/\s+/gu, " ").trim();
    return normalized.length > 0
        ? normalized.slice(0, 120)
        : "本轮对话已完成。";
}

/**
 * extractCenterDirectoryForToolLoop：读取工具执行所需中心目录。
 *
 * @param database 中心服务数据库。
 * @returns 中心目录绝对路径。
 */
function extractCenterDirectoryForToolLoop(database: CenterDatabase): string {
    const centerDirectory = createDataAccess(database).system.readMetaValue("centerDirectory") ?? "";
    if (!centerDirectory) {
        throw new Error("CENTER_DIRECTORY_NOT_AVAILABLE");
    }
    return centerDirectory;
}
