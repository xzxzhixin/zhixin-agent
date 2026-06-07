import {randomUUID} from "node:crypto";

import type {
    ClientType,
    ConversationMessage,
    ConversationSession,
    ConversationTurn,
    DeleteProjectResult,
    EventRecord,
    ProjectRecord,
    SessionType,
    TaskRecord,
} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import type {SendMessageResponse, TaskStepRecord} from "./types.js";
import {SessionRepository} from "./data-access/session-repository.js";
import {createDataAccess} from "./data-access/index.js";
import {
    writeAgentMemory,
    type MemoryWriteInput,
} from "./agent-domain.js";
import {runLangGraphTurn} from "./langgraph-runner.js";
import {syncTurnMemoryToMem0} from "./memory-engine.js";
import type {MemoryQueueState} from "./types.js";
import {
    appendThinkingEvents,
    handleWorkerMessage,
    recordUsage,
    startWorkerTask,
} from "./workflow-domain.js";
import {refreshUsageDailyStats} from "./usage-domain.js";
import {
    continueProviderModelGatewayWithToolResults,
    invokeProviderModelGateway,
    type ProviderModelGatewayResult,
} from "./model-gateway-runtime.js";
import {
    appendToolVisibilityEvents,
    buildUnifiedToolCallIntentFromModelCall,
    commandRequestFromUnifiedToolIntent,
    mcpRequestFromUnifiedToolIntent,
    runCommandTool,
    runMcpTool,
} from "./tool-runtime.js";
import {
    createTurnGraphCheckpoint,
    createTurnGraphContext,
    stepTaskFromGraphContext,
    type TurnGraphCheckpoint,
    type TurnGraphContext,
    withOptionalGraphCheckpoint,
    withTurnGraphCheckpoint,
} from "./turn-graph-domain.js";

export function upsertSyncClient(
    database: CenterDatabase,
    input: {
        clientType: ClientType;
        projectId: string | null;
    },
): string {
    // clientId: 当前阶段每次授权生成新客户端 ID，后续 WebSocket 可绑定该 ID。
    const clientId = randomUUID();
    // now: 同步客户端最后访问时间。
    const now = new Date().toISOString();
    new SessionRepository(database).upsertSyncClient({
        clientId,
        clientType: input.clientType,
        projectId: input.projectId,
        lastSeenAt: now,
    });

    return clientId;
}

/**
 * findProject：按项目 ID 查询项目记录。
 *
 * @param database 中心服务数据库。
 * @param projectId 项目 UUID。
 * @returns 找到时返回项目记录，否则返回 null。
 */
export function findProject(database: CenterDatabase, projectId: string): ProjectRecord | null {
    return new SessionRepository(database).findProject(projectId) as ProjectRecord | null;
}

/**
 * listProjects：读取已登记项目列表。
 *
 * @param database 中心服务数据库。
 * @returns 按最近更新时间倒序排列的项目记录数组。
 */
export function listProjects(database: CenterDatabase): ProjectRecord[] {
    return new SessionRepository(database).listProjects() as ProjectRecord[];
}

/**
 * findSession：按会话 ID 查询会话记录。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 找到时返回会话记录，否则返回 null。
 */
export function findSession(database: CenterDatabase, sessionId: string): ConversationSession | null {
    return new SessionRepository(database).findSession(sessionId);
}

/**
 * listSessions：按类型和项目筛选会话列表。
 *
 * @param database 中心服务数据库。
 * @param filter 会话筛选条件。
 * @returns 会话记录数组。
 */
export function listSessions(
    database: CenterDatabase,
    filter: {
        sessionType?: SessionType;
        projectId?: string | null;
    },
): ConversationSession[] {
    return new SessionRepository(database).listSessions(filter);
}

/**
 * deleteSession：删除指定会话及其下属消息、轮次、任务和附件索引。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param session 会话事实记录。
 * @returns 删除结果，包含被删除会话 ID。
 */
export function deleteSession(
    database: CenterDatabase,
    events: CenterEventStore,
    session: ConversationSession,
): {
    sessionId: string;
    deleted: boolean;
} {
    // 仅删除当前会话事实表中的索引数据；事件日志作为审计来源保留，附件物理文件由后续清理策略统一处理。
    new SessionRepository(database).deleteSessionFacts(session.sessionId);

    events.append({
        eventType: "session.deleted",
        scopeType: "session",
        scopeId: session.sessionId,
        sessionId: session.sessionId,
        turnId: null,
        taskId: null,
        projectId: session.projectId,
        status: "completed",
        title: "会话删除",
        summary: session.title,
        payload: {
            sessionId: session.sessionId,
            sessionType: session.sessionType,
            projectId: session.projectId,
        },
    });

    return {
        sessionId: session.sessionId,
        deleted: true,
    };
}

/**
 * deleteProject：删除项目索引及该项目下属会话事实。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param project 项目事实记录。
 * @returns 删除结果，包含项目 ID 和清理的项目会话数量。
 */
export function deleteProject(
    database: CenterDatabase,
    events: CenterEventStore,
    project: ProjectRecord,
): DeleteProjectResult {
    // 只清理中心服务事实源；项目根目录和 致心项目ID.md 属于用户工程文件，不在项目删除接口中触碰。
    const deletedSessionCount = new SessionRepository(database).deleteProjectFacts(project.projectId);

    events.append({
        eventType: "project.deleted",
        scopeType: "project",
        scopeId: project.projectId,
        sessionId: null,
        turnId: null,
        taskId: null,
        projectId: project.projectId,
        status: "completed",
        title: "项目删除",
        summary: project.displayName,
        payload: {
            projectId: project.projectId,
            displayName: project.displayName,
            deletedSessionCount,
            // keepProjectIdentityFile: 明确 UI 提示的边界，删除中心服务记录不删除磁盘身份文件。
            keepProjectIdentityFile: true,
        },
    });

    return {
        projectId: project.projectId,
        deletedSessionCount,
        deleted: true,
    };
}

/**
 * listMessages：查询会话消息列表。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 消息记录数组。
 */
export function listMessages(database: CenterDatabase, sessionId: string): ConversationMessage[] {
    return new SessionRepository(database).listMessages(sessionId);
}

/**
 * listTurns：查询会话轮次列表。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 轮次记录数组。
 */
export function listTurns(database: CenterDatabase, sessionId: string): ConversationTurn[] {
    return new SessionRepository(database).listTurns(sessionId);
}

/**
 * listTasks：查询会话任务列表。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 任务记录数组。
 */
export function listTasks(database: CenterDatabase, sessionId: string): TaskRecord[] {
    return new SessionRepository(database).listTasks(sessionId);
}

/**
 * listTaskSteps：查询会话下所有任务步骤。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 任务步骤数组。
 */
export function listTaskSteps(database: CenterDatabase, sessionId: string): TaskStepRecord[] {
    return new SessionRepository(database).listTaskSteps(sessionId);
}

/**
 * findTask：按任务 ID 查询任务。
 *
 * @param database 中心服务数据库。
 * @param taskId 任务 ID。
 * @returns 找到时返回任务记录，否则返回 null。
 */
export function findTask(database: CenterDatabase, taskId: string): TaskRecord | null {
    return new SessionRepository(database).findTask(taskId);
}

/**
 * createTaskStep：创建任务步骤并写入事件。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param task 任务记录。
 * @param title 步骤标题。
 * @returns 创建后的任务步骤记录。
 */
export function createTaskStep(
    database: CenterDatabase,
    events: CenterEventStore,
    task: TaskRecord,
    title: string,
    graphCheckpoint?: TurnGraphCheckpoint,
): TaskStepRecord {
    // stepId: 任务步骤身份。
    const stepId = randomUUID();
    // now: 步骤开始时间。
    const now = new Date().toISOString();

    new SessionRepository(database).createTaskStep({
        stepId,
        taskId: task.taskId,
        title,
        startedAt: now,
    });

    events.append({
        eventType: "task.step.started",
        scopeType: "task_step",
        scopeId: stepId,
        sessionId: task.sessionId,
        turnId: task.turnId,
        taskId: task.taskId,
        stepId,
        status: "running",
        title: "任务步骤开始",
        summary: title,
        payload: withOptionalGraphCheckpoint({
            stepId,
            title,
        }, graphCheckpoint),
    });

    return {
        stepId,
        taskId: task.taskId,
        status: "running",
        title,
        startedAt: now,
        endedAt: null,
        summary: null,
    };
}

/**
 * updateTaskStep：更新任务步骤状态和摘要。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param stepId 步骤 ID。
 * @param status 新状态。
 * @param summary 步骤摘要。
 * @returns 更新后的步骤记录；不存在时返回 null。
 */
export function updateTaskStep(
    database: CenterDatabase,
    events: CenterEventStore,
    stepId: string,
    status: TaskRecord["status"],
    summary: string | null,
    graphCheckpoint?: TurnGraphCheckpoint,
): TaskStepRecord | null {
    const existing = new SessionRepository(database).findTaskStepWithTask(stepId);

    if (!existing) {
        return null;
    }

    // now: 终态步骤保存结束时间，运行态保留空结束时间。
    const now = new Date().toISOString();
    const endedAt = isFinalTaskStatus(status) ? now : null;

    new SessionRepository(database).updateTaskStep({
        stepId,
        status,
        endedAt,
        summary,
    });

    events.append({
        eventType: "task.step.updated",
        scopeType: "task_step",
        scopeId: stepId,
        sessionId: existing.sessionId,
        turnId: existing.turnId,
        taskId: existing.taskId,
        stepId,
        status,
        title: "任务步骤更新",
        summary: summary ?? existing.title,
        payload: withOptionalGraphCheckpoint({
            stepId,
            status,
        }, graphCheckpoint),
    });

    return {
        stepId,
        taskId: existing.taskId,
        status,
        title: existing.title,
        startedAt: existing.startedAt,
        endedAt,
        summary,
    };
}

/**
 * updateTurnStatus：更新轮次状态，并同步默认任务终态。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param turnId 轮次 ID。
 * @param status 新轮次状态。
 * @returns 更新后的轮次记录；不存在时返回 null。
 */
export function updateTurnStatus(
    database: CenterDatabase,
    events: CenterEventStore,
    turnId: string,
    status: "waiting_user" | "completed" | "failed" | "cancelled",
): ConversationTurn | null {
    const turn = new SessionRepository(database).findTurn(turnId);

    if (!turn) {
        return null;
    }

    // now: 终态轮次固定结束时间，等待用户状态仍不写结束时间。
    const now = new Date().toISOString();
    const endedAt = status === "waiting_user" ? null : now;
    const durationMs = endedAt ? Math.max(0, new Date(endedAt).getTime() - new Date(turn.startedAt).getTime()) : null;

    new SessionRepository(database).updateTurnStatus({
        turnId,
        status,
        endedAt,
        durationMs,
    });

    const taskStatus = mapTurnStatusToTaskStatus(status);
    new SessionRepository(database).updateTaskStatusByTurn(
        turnId,
        taskStatus,
        now,
    );

    events.append({
        eventType: "turn.updated",
        scopeType: "turn",
        scopeId: turnId,
        sessionId: turn.sessionId,
        turnId,
        taskId: null,
        status,
        title: "轮次状态更新",
        summary: `轮次状态更新为 ${status}`,
        payload: {
            turnId,
            status,
            endedAt,
            durationMs,
        },
    });

    return {
        ...turn,
        status,
        endedAt,
        durationMs,
    };
}

/**
 * isFinalTaskStatus：判断任务步骤是否进入终态。
 *
 * @param status 任务状态。
 * @returns 终态返回 true。
 */
export function isFinalTaskStatus(status: TaskRecord["status"]): boolean {
    return status === "completed"
        || status === "failed"
        || status === "cancelled";
}

/**
 * mapTurnStatusToTaskStatus：把轮次状态映射到任务状态。
 *
 * @param status 轮次状态。
 * @returns 任务状态。
 */
export function mapTurnStatusToTaskStatus(status: "waiting_user" | "completed" | "failed" | "cancelled"): TaskRecord["status"] {
    if (status === "waiting_user") {
        return "waiting_user";
    }

    return status;
}

/**
 * createMessageTurnAndTask：创建用户消息、轮次、默认任务并追加事件。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param session 会话记录。
 * @param contentMarkdown 用户发送的 Markdown 内容。
 * @returns 消息、轮次和任务 ID。
 */
export function createMessageTurnAndTask(
    database: CenterDatabase,
    events: CenterEventStore,
    session: ConversationSession,
    contentMarkdown: string,
): SendMessageResponse {
    // now: 消息、轮次和任务共享同一服务端创建时间，便于审计。
    const now = new Date().toISOString();
    // messageId: 用户消息身份。
    const messageId = randomUUID();
    // turnId: 本轮对话身份。
    const turnId = randomUUID();
    // taskId: 默认任务身份，后续 Worker 接管后继续更新该任务。
    const taskId = randomUUID();
    // turnNumber: 同一会话内用户发起轮次递增。
    const turnNumber = new SessionRepository(database).nextTurnNumber(session.sessionId);
    new SessionRepository(database).createMessageTurnAndTask({
        sessionId: session.sessionId,
        messageId,
        turnId,
        taskId,
        turnNumber,
        contentMarkdown,
        now,
    });

    events.append({
        eventType: "turn.started",
        scopeType: "turn",
        scopeId: turnId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: "running",
        title: "轮次开始",
        summary: "用户发送消息后创建新轮次。",
        payload: {
            turnId,
            turnNumber,
            userMessageId: messageId,
        },
    });

    events.append({
        eventType: "message.created",
        scopeType: "message",
        scopeId: messageId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: "completed",
        title: "消息创建",
        summary: "用户消息已写入中心服务。",
        payload: {
            messageId,
            role: "user",
        },
    });

    events.append({
        eventType: "task.updated",
        scopeType: "task",
        scopeId: taskId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: "queued",
        title: "任务排队",
        summary: "消息发送后默认任务进入排队状态。",
        payload: {
            taskId,
        },
    });

    return {
        sessionId: session.sessionId,
        messageId,
        turnId,
        taskId,
    };
}

/**
 * completeCreatedTurn：把已创建的消息轮次接入最小执行闭环。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 发送接口创建的消息、轮次和任务身份。
 * @param userText 用户原始输入。
 * @returns 没有返回值。
 */
export async function completeCreatedTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    userText: string,
    centerDirectory?: string,
    memoryQueues?: Map<string, MemoryQueueState>,
): Promise<void> {
    await runLangGraphTurn({
        database,
        events,
        sent,
        userText,
        centerDirectory,
        memoryQueues,
        completeCreatedTurn: async (createdTurn, createdUserText) => {
            await completeCreatedTurnInGraph(
                database,
                events,
                createdTurn,
                createdUserText,
                centerDirectory,
                memoryQueues,
            );
        },
    });
}

/**
 * completeCreatedTurnInGraph：LangGraphJS 节点内执行现有轮次闭环。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 发送接口创建的消息、轮次和任务身份。
 * @param userText 用户原始输入。
 * @returns 没有返回值。
 */
async function completeCreatedTurnInGraph(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    userText: string,
    centerDirectory?: string,
    memoryQueues?: Map<string, MemoryQueueState>,
): Promise<void> {
    const assistantMessageId = randomUUID();
    const now = new Date().toISOString();
    const turnSessionId = new SessionRepository(database).findSessionIdByTurn(sent.turnId);
    const graphContext = createTurnGraphContext({
        sessionId: sent.sessionId,
        turnId: sent.turnId,
        taskId: sent.taskId,
    });
    const thinkingCheckpoint = createTurnGraphCheckpoint(
        graphContext,
        {
            nodeId: "thinking.context",
            nodeKind: "thinking",
            superstep: 1,
            parentNodeId: null,
            nextNodeIds: [
                "model.stream",
            ],
            stateSummary: "整理会话、项目、记忆和可用能力上下文。",
        },
    );
    const modelCheckpoint = createTurnGraphCheckpoint(
        graphContext,
        {
            nodeId: "model.stream",
            nodeKind: "model",
            superstep: 2,
            parentNodeId: "thinking.context",
            nextNodeIds: [
                "tool.command",
                "tool.plan",
            ],
            stateSummary: "调用供应商模型并接收流式回复。",
        },
    );
    const toolPlanCheckpoint = createTurnGraphCheckpoint(
        graphContext,
        {
            nodeId: "tool.plan",
            nodeKind: "tool",
            superstep: 4,
            parentNodeId: "model.stream",
            nextNodeIds: [
                "extension.visibility",
            ],
            stateSummary: "记录模型工具计划和后续可用能力状态。",
        },
    );
    const extensionCheckpoint = createTurnGraphCheckpoint(
        graphContext,
        {
            nodeId: "extension.visibility",
            nodeKind: "extension",
            superstep: 5,
            parentNodeId: "tool.plan",
            nextNodeIds: [
                "message.persist",
            ],
            stateSummary: "记录插件、MCP 和 skill 当前可执行性。",
        },
    );
    const messageCheckpoint = createTurnGraphCheckpoint(
        graphContext,
        {
            nodeId: "message.persist",
            nodeKind: "message",
            superstep: 6,
            parentNodeId: "extension.visibility",
            nextNodeIds: [
                "memory.commit",
            ],
            stateSummary: "固化助手消息并完成当前轮次。",
        },
    );

    startWorkerTask(database, events, sent.taskId);
    const thinkingStep = createTaskStep(
        database,
        events,
        stepTaskFromGraphContext(graphContext),
        "思考与上下文整理",
        thinkingCheckpoint,
    );
    try {
        appendThinkingEvents(
            events,
            database,
            sent.sessionId,
            sent.taskId,
            sent.turnId,
            userText,
            thinkingCheckpoint,
        );
        updateTaskStep(
            database,
            events,
            thinkingStep.stepId,
            "completed",
            "思考过程和上下文整理完成。",
            thinkingCheckpoint,
        );
        const modelStep = createTaskStep(
            database,
            events,
            stepTaskFromGraphContext(graphContext),
            "模型流式输出",
            modelCheckpoint,
        );
        const modelResult = await invokeProviderModelGateway(
            database,
            events,
            sent.sessionId,
            sent.taskId,
            sent.turnId,
            userText,
            modelCheckpoint,
        );
        updateTaskStep(
            database,
            events,
            modelStep.stepId,
            "completed",
            "模型流式输出完成并准备固化助手消息。",
            modelCheckpoint,
        );
        const toolLoopResult = await runModelRequestedToolLoop(
            database,
            events,
            sent,
            userText,
            modelResult,
            now,
            graphContext,
        );
        const finalModelResult = toolLoopResult.finalModelResult;
        const toolPlanStep = createTaskStep(
            database,
            events,
            stepTaskFromGraphContext(graphContext),
            "工具计划生成",
            toolPlanCheckpoint,
        );
        events.append({
            eventType: "tool.plan.created",
            scopeType: "tool-plan",
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "completed",
            title: "工具计划",
            summary: toolLoopResult.executedTool
                ? "模型已基于结构化工具定义请求工具调用。"
                : "当前模型回复未请求工具调用，已记录插件、MCP 和 skill 可用性。",
            payload: withTurnGraphCheckpoint({
                plannedToolId: toolLoopResult.executedTool?.toolId ?? null,
                plannedToolKind: toolLoopResult.executedTool?.toolKind ?? null,
                inputSummary: toolLoopResult.executedTool?.inputSummary ?? null,
                fallbackToolKinds: [
                    "plugin",
                    "mcp",
                    "skill",
                ],
            }, toolPlanCheckpoint),
        });
        updateTaskStep(
            database,
            events,
            toolPlanStep.stepId,
            "completed",
            toolLoopResult.executedTool
                ? "工具计划已由模型工具调用请求生成并执行。"
                : "工具计划已生成，本轮模型未请求可执行工具。",
            toolPlanCheckpoint,
        );
        const extensionStep = createTaskStep(
            database,
            events,
            stepTaskFromGraphContext(graphContext),
            "插件、MCP 和 skill 状态记录",
            extensionCheckpoint,
        );
        appendToolVisibilityEvents(
            events,
            sent.sessionId,
            sent.taskId,
            sent.turnId,
            extensionCheckpoint,
        );
        updateTaskStep(
            database,
            events,
            extensionStep.stepId,
            "completed",
            "插件、MCP 和 skill 未解析到可执行实例，已按统一工具注册表写入不可用事件。",
            extensionCheckpoint,
        );
        const assistantText = finalModelResult.assistantText;
        if (isIncompleteToolIntentReply(assistantText)) {
            markTurnIncompleteToolIntent(
                database,
                events,
                sent,
                turnSessionId,
                assistantText,
            );
            return;
        }
        new SessionRepository(database).insertAssistantMessageForTurn({
            messageId: assistantMessageId,
            turnId: sent.turnId,
            contentMarkdown: assistantText,
            createdAt: now,
        });
        events.append({
            eventType: "message.created",
            scopeType: "message",
            scopeId: assistantMessageId,
            sessionId: turnSessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "completed",
            title: "消息创建",
            summary: "助手回复已写入中心服务。",
            payload: withTurnGraphCheckpoint({
                messageId: assistantMessageId,
                role: "assistant",
            }, messageCheckpoint),
        });
        handleWorkerMessage(database, events, "task.complete", sent.taskId, {
            assistantMessageId,
            providerId: finalModelResult.providerId,
            model: finalModelResult.model,
            usage: finalModelResult.usage,
        });
        if (centerDirectory && memoryQueues) {
            await commitMainAgentMemoryAfterTurn(
                database,
                events,
                centerDirectory,
                memoryQueues,
                sent,
                userText,
                assistantText,
            );
        }
        recordModelUsageAfterTurn(database, events, sent, finalModelResult);
        updateSessionTitleAfterTurn(database, events, sent, userText, assistantText);
        updateTurnStatus(database, events, sent.turnId, "completed");
    } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_MODEL_ERROR";
        new SessionRepository(database).updateTaskStatus(
            sent.taskId,
            "failed",
            new Date().toISOString(),
        );
        new SessionRepository(database).updateTurnStatus({
            turnId: sent.turnId,
            status: "failed",
            endedAt: new Date().toISOString(),
            durationMs: 0,
        });
        events.append({
            eventType: "model.failed",
            scopeType: "model",
            scopeId: sent.taskId,
            sessionId: turnSessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "failed",
            title: "模型调用失败",
            summary: message,
            payload: {
                taskId: sent.taskId,
                turnId: sent.turnId,
                errorMessage: message,
            },
        });
        handleWorkerMessage(database, events, "task.failed", sent.taskId, {
            errorMessage: message,
        });
    }
}

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
 * @returns 没有返回值。
 */
async function commitMainAgentMemoryAfterTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    memoryQueues: Map<string, MemoryQueueState>,
    sent: SendMessageResponse,
    userText: string,
    assistantText: string,
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

/**
 * isIncompleteToolIntentReply：识别模型把“准备继续执行工具”当正文输出的半截回复。
 *
 * @param assistantText 模型返回正文。
 * @returns 命中继续执行但缺少工具调用时返回 true。
 */
function isIncompleteToolIntentReply(assistantText: string): boolean {
    const normalized = assistantText.replace(/\s+/gu, "");
    if (normalized.length === 0) {
        return false;
    }

    const continuationHints = [
        "我改用",
        "我将使用",
        "我会使用",
        "接下来使用",
        "重新查询",
        "继续查询",
        "执行命令",
        "运行命令",
        "调用工具",
    ];
    const hasContinuationHint = continuationHints.some((hint) => {
        return normalized.includes(hint);
    });
    const mentionsToolOrCommand = /PowerShell|命令|工具|查询/u.test(assistantText);

    return hasContinuationHint && mentionsToolOrCommand;
}

/**
 * markTurnIncompleteToolIntent：标记模型半截工具意图，阻止固化最终助手消息。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 当前轮次身份。
 * @param sessionId 当前轮次所属会话 ID。
 * @param assistantText 被拦截的模型正文。
 * @returns 没有返回值。
 */
function markTurnIncompleteToolIntent(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    sessionId: string | null,
    assistantText: string,
): void {
    const reason = "模型输出了继续执行工具的半截话术，但没有携带结构化工具调用。";
    events.append({
        eventType: "message.turn.incomplete",
        scopeType: "turn",
        scopeId: sent.turnId,
        sessionId,
        turnId: sent.turnId,
        taskId: sent.taskId,
        status: "failed",
        title: "模型回复不完整",
        summary: reason,
        payload: {
            taskId: sent.taskId,
            turnId: sent.turnId,
            interceptedAssistantText: assistantText,
            reason: "INCOMPLETE_TOOL_INTENT_REPLY",
        },
        errorCode: "INCOMPLETE_TOOL_INTENT_REPLY",
    });
    updateTurnStatus(
        database,
        events,
        sent.turnId,
        "failed",
    );
    handleWorkerMessage(database, events, "task.failed", sent.taskId, {
        errorMessage: reason,
    });
}

/**
 * runModelRequestedToolLoop：执行模型请求的工具调用并把结果回填模型。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 当前轮次身份。
 * @param userText 用户原始输入。
 * @param modelResult 首次模型调用结果。
 * @param now 当前轮次统一时间。
 * @returns 最终模型回复和已执行工具摘要。
 */
async function runModelRequestedToolLoop(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    userText: string,
    modelResult: ProviderModelGatewayResult,
    now: string,
    graphContext: TurnGraphContext,
): Promise<{
    finalModelResult: ProviderModelGatewayResult;
    executedTool: {
        toolId: string;
        toolKind: string;
        inputSummary: string;
    } | null;
}> {
    if (modelResult.toolCalls.length === 0) {
        return {
            finalModelResult: modelResult,
            executedTool: null,
        };
    }

    const allToolResults: Array<{
        toolCall: NonNullable<ProviderModelGatewayResult["toolCall"]>;
        resultText: string;
        unifiedToolIntent: NonNullable<ReturnType<typeof buildUnifiedToolCallIntentFromModelCall>>;
    }> = [];
    const toolExecuteCheckpoint = createTurnGraphCheckpoint(
        graphContext,
        {
            nodeId: "tool.execute",
            nodeKind: "tool",
            superstep: 3,
            parentNodeId: "model.stream",
            nextNodeIds: [
                "tool.plan",
            ],
            stateSummary: "执行模型请求的命令或 MCP 工具并记录副作用结果。",
        },
    );
    const toolResultCheckpoint = createTurnGraphCheckpoint(
        graphContext,
        {
            nodeId: "tool.result",
            nodeKind: "model",
            superstep: 4,
            parentNodeId: "tool.execute",
            nextNodeIds: [
                "tool.plan",
            ],
            stateSummary: "把工具结果回填给模型生成最终回复。",
        },
    );

    let currentModelResult = modelResult;
    for (let round = 0; round < 4 && currentModelResult.toolCalls.length > 0; round += 1) {
        const toolResults = await executeModelRequestedTools(
            database,
            events,
            sent,
            currentModelResult,
            graphContext,
            toolExecuteCheckpoint,
        );
        if (toolResults.length === 0) {
            break;
        }
        allToolResults.push(...toolResults);
        currentModelResult = await continueProviderModelGatewayWithToolResults(
            database,
            events,
            sent.sessionId,
            sent.taskId,
            sent.turnId,
            userText,
            toolResults.map((toolResult) => {
                return {
                    toolCall: toolResult.toolCall,
                    resultText: toolResult.resultText,
                };
            }),
            toolResultCheckpoint,
        );
    }

    if (allToolResults.length === 0) {
        return {
            finalModelResult: currentModelResult,
            executedTool: null,
        };
    }

    const firstToolResult = allToolResults[0];

    return {
        finalModelResult: currentModelResult,
        executedTool: {
            toolId: firstToolResult.unifiedToolIntent.toolId,
            toolKind: firstToolResult.unifiedToolIntent.toolKind,
            inputSummary: firstToolResult.unifiedToolIntent.inputSummary,
        },
    };
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
async function executeModelRequestedTools(
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

        const unifiedToolIntent = buildUnifiedToolCallIntentFromModelCall(toolCall);
        if (!unifiedToolIntent || ![
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
            unifiedToolIntent.toolKind === "command" ? "命令工具执行" : "MCP 工具执行",
            toolExecuteCheckpoint,
        );
        const toolResult = unifiedToolIntent.toolKind === "command"
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
                ? `${unifiedToolIntent.toolKind === "command" ? "命令" : "MCP"}工具执行完成：${toolResult.outputSummary || "工具没有输出。"}`
                : `${unifiedToolIntent.toolKind === "command" ? "命令" : "MCP"}工具执行失败：${toolResult.failureReason ?? "未返回失败原因。"}`,
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
 * recordModelUsageAfterTurn：真实模型调用完成后写入用量原始记录并刷新日聚合。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 当前发送接口返回的会话、轮次和任务身份。
 * @param modelResult 模型网关返回的真实供应商、模型和用量。
 * @returns 写入成功时返回用量记录 ID；模型未返回用量时返回 null。
 */
export function recordModelUsageAfterTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    modelResult: ProviderModelGatewayResult,
): string | null {
    if (!modelResult.usage) {
        events.append({
            eventType: "usage.record.skipped",
            scopeType: "usage",
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "completed",
            title: "用量记录跳过",
            summary: "模型供应商未返回用量字段，原始用量不写入。",
            payload: {
                providerId: modelResult.providerId,
                model: modelResult.model,
                reason: "MODEL_USAGE_NOT_PROVIDED",
            },
        });
        return null;
    }

    const session = findSession(database, sent.sessionId);
    if (!session) {
        events.append({
            eventType: "usage.record.failed",
            scopeType: "usage",
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "failed",
            title: "用量记录失败",
            summary: "用量写入时未找到当前会话，已保留模型回复。",
            payload: {
                sessionId: sent.sessionId,
                providerId: modelResult.providerId,
                model: modelResult.model,
                reason: "SESSION_NOT_FOUND",
            },
            errorCode: "USAGE_SESSION_NOT_FOUND",
        });
        return null;
    }

    const usage = recordUsage(database, events, {
        providerId: modelResult.providerId,
        model: modelResult.model,
        projectId: session.projectId,
        sessionId: sent.sessionId,
        inputTokens: modelResult.usage.inputTokens,
        outputTokens: modelResult.usage.outputTokens,
        cacheHitTokens: modelResult.usage.cacheHitTokens,
        cacheMissTokens: modelResult.usage.cacheMissTokens,
        status: "completed",
    });
    refreshUsageDailyStats(database);
    return usage.usageId;
}

/**
 * summarizeSessionTitle：根据本轮真实对话内容生成会话标题摘要。
 *
 * @param userText 用户本轮输入，来源于已落库用户消息。
 * @param assistantText 助手本轮回复，来源于真实模型网关返回。
 * @returns 适合列表展示的短标题。
 */
export function summarizeSessionTitle(
    userText: string,
    assistantText: string,
): string {
    // sourceText: 标题以用户目标为主，助手回复只在用户输入极短时补充语义；两者都来自当前轮次事实，不猜测其他字段。
    const sourceText = `${userText}\n${assistantText}`.replace(/\s+/gu, " ").trim();
    // normalized: 移除 Markdown 语法符号，避免列表标题出现链接、标题井号或代码围栏残片。
    const normalized = sourceText
        .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
        .replace(/[`*_>#-]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();

    if (normalized.length === 0) {
        throw new Error("SESSION_TITLE_SUMMARY_EMPTY");
    }

    // title: 会话列表需要短标题，超过 28 个字符时截断，避免侧栏被长文本撑开。
    const title = normalized.slice(0, 28);
    return normalized.length > 28 ? `${title}...` : title;
}

/**
 * updateSessionTitleAfterTurn：真实对话完成后固化会话标题并写入同步事件。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 本轮发送后生成的消息、轮次和任务身份。
 * @param userText 用户本轮输入。
 * @param assistantText 助手本轮回复。
 * @returns 更新后的会话记录；失败时返回 null 并保留原标题。
 */
export function updateSessionTitleAfterTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    userText: string,
    assistantText: string,
): ConversationSession | null {
    const turnSessionId = new SessionRepository(database).findSessionIdByTurn(sent.turnId);
    const session = turnSessionId ? findSession(database, turnSessionId) : null;
    if (!session) {
        events.append({
            eventType: "session.title_summary.failed",
            scopeType: "session",
            scopeId: turnSessionId,
            sessionId: turnSessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: "failed",
            title: "会话标题总结失败",
            summary: "标题总结时未找到会话，已保留原标题。",
            payload: {
                sessionId: turnSessionId,
                reason: "SESSION_NOT_FOUND",
            },
            errorCode: "SESSION_NOT_FOUND",
        });
        return null;
    }

    try {
        // nextTitle: 标题摘要只使用当前轮真实用户输入和助手回复，避免从旧标题或多候选字段猜测。
        const nextTitle = summarizeSessionTitle(
            userText,
            assistantText,
        );
        // now: 会话标题变化属于会话元信息更新，需要刷新列表排序和详情更新时间。
        const now = new Date().toISOString();
        new SessionRepository(database).updateSessionTitle({
            sessionId: session.sessionId,
            title: nextTitle,
            updatedAt: now,
        });
        const updatedSession = findSession(database, session.sessionId);
        if (!updatedSession) {
            throw new Error("SESSION_UPDATED_ROW_NOT_FOUND");
        }

        events.append({
            eventType: "session.updated",
            scopeType: "session",
            scopeId: session.sessionId,
            sessionId: session.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            projectId: session.projectId,
            status: "completed",
            title: "会话标题更新",
            summary: nextTitle,
            payload: {
                session: updatedSession,
                previousTitle: session.title,
                titleSummarySource: "turn-completion",
            },
        });

        return updatedSession;
    } catch (error) {
        const message = error instanceof Error ? error.message : "SESSION_TITLE_SUMMARY_UNKNOWN";
        events.append({
            eventType: "session.title_summary.failed",
            scopeType: "session",
            scopeId: session.sessionId,
            sessionId: session.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            projectId: session.projectId,
            status: "failed",
            title: "会话标题总结失败",
            summary: "标题总结失败，已保留原标题。",
            payload: {
                sessionId: session.sessionId,
                preservedTitle: session.title,
                reason: message,
            },
            errorCode: "SESSION_TITLE_SUMMARY_FAILED",
        });
        return null;
    }
}

export function savePendingMessage(
    database: CenterDatabase,
    sessionId: string,
    clientId: string | null,
    contentMarkdown: string,
): {
    pendingMessageId: string;
    status: string;
} {
    const pendingMessageId = randomUUID();
    const now = new Date().toISOString();
    new SessionRepository(database).savePendingMessage({
        pendingMessageId,
        sessionId,
        clientId,
        contentMarkdown,
        now,
    });
    return {
        pendingMessageId,
        status: "waiting_user",
    };
}

export function listPendingMessages(
    database: CenterDatabase,
    sessionId: string,
): unknown[] {
    return new SessionRepository(database).listPendingMessages(sessionId);
}

/**
 * listEvents：查询断线补齐事件。
 *
 * @param database 中心服务数据库。
 * @param filter 事件筛选条件。
 * @returns 事件记录数组。
 */
export function listEvents(
    database: CenterDatabase,
    filter: {
        sessionId: string | null;
        turnId: string | null;
        afterSequence: number;
    },
): EventRecord[] {
    return new SessionRepository(database).listEvents(filter);
}

