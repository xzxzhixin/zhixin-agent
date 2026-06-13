import {randomUUID} from "node:crypto";

import type {
    ClientType,
    ConversationMessage,
    ConversationSession,
    ConversationTurn,
    ProjectRecord,
    SessionType,
    TaskRecord,
} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import type {SendMessageResponse, TaskStepRecord} from "../types.js";
import {SessionRepository} from "../data-access/session-repository.js";
import {
    runDeepAgentsTurn,
    type DeepAgentsTurnState,
    type DeepAgentsNodeExecutors,
    type DeepAgentsToolResult,
} from "../deepagents-runner.js";
import type {MemoryQueueState} from "../types.js";
import {
    handleWorkerMessage,
    recordUsage,
    startWorkerTask,
} from "./workflow-domain.js";
import {refreshUsageDailyStats} from "./usage-domain.js";
import {
    continueProviderModelGatewayWithToolResults,
    invokeProviderModelGateway,
    type ProviderModelGatewayResult,
} from "../model-gateway-runtime.js";
import {
    appendToolVisibilityEvents,
} from "../tools/index.js";
import {
    commitMainAgentMemoryAfterTurn,
    executeModelRequestedTools,
} from "./session-turn-effects.js";
import {
    createTurnGraphCheckpoint,
    createTurnGraphContext,
    stepTaskFromGraphContext,
    type TurnGraphCheckpoint,
    type TurnGraphContext,
    withOptionalGraphCheckpoint,
    withTurnGraphCheckpoint,
} from "./turn-graph-domain.js";
import {formatCenterLocalDateTime} from "../time.js";

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
    const now = formatCenterLocalDateTime();
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
 * listTasksByAgent：按智能体查询当前会话 todoList。
 *
 * @param database 中心服务数据库。
 * @param sessionId 主会话 ID。
 * @param agentId 智能体 ID。
 * @returns 当前智能体任务记录数组。
 */
export function listTasksByAgent(
    database: CenterDatabase,
    sessionId: string,
    agentId: string,
): TaskRecord[] {
    return new SessionRepository(database).listTasksByAgent(
        sessionId,
        agentId,
    );
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
 * listTaskStepsByAgent：按智能体查询当前会话 todoList 步骤。
 *
 * @param database 中心服务数据库。
 * @param sessionId 主会话 ID。
 * @param agentId 智能体 ID。
 * @returns 当前智能体任务步骤数组。
 */
export function listTaskStepsByAgent(
    database: CenterDatabase,
    sessionId: string,
    agentId: string,
): TaskStepRecord[] {
    return new SessionRepository(database).listTaskStepsByAgent(
        sessionId,
        agentId,
    );
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
 * @param graphCheckpoint 可选图检查点。
 * @returns 创建后的任务步骤记录。
 */
export function createTaskStep(
    database: CenterDatabase,
    events: CenterEventStore,
    task: Pick<TaskRecord, "taskId" | "sessionId" | "turnId">,
    title: string,
    options: {
        /** planVersion: 步骤所属计划版本，默认使用当前任务最后一个步骤版本或 1。 */
        planVersion?: number;
        /** stepOrder: 同一任务下步骤顺序，默认追加到当前任务末尾。 */
        stepOrder?: number;
        /** source: 步骤来源，默认 graph 表示 LangGraph 图节点。 */
        source?: TaskStepRecord["source"];
        /** dependsOn: 依赖步骤 ID 列表，默认空数组。 */
        dependsOn?: string[];
        /** acceptance: 步骤验收口径，默认没有单独验收说明。 */
        acceptance?: string | null;
    } = {},
    graphCheckpoint?: TurnGraphCheckpoint,
): TaskStepRecord {
    const repository = new SessionRepository(database);
    const storedTask = repository.findTask(task.taskId);
    if (!storedTask) {
        throw new Error("TASK_NOT_FOUND_FOR_STEP_CREATE");
    }
    // stepId: 任务步骤身份。
    const stepId = randomUUID();
    // now: 步骤开始时间。
    const now = formatCenterLocalDateTime();
    const existingSteps = repository.listTaskStepsByTaskForAgent({
        sessionId: task.sessionId,
        taskId: task.taskId,
        agentId: storedTask.agentId,
    });
    const planVersion = options.planVersion ?? (existingSteps.at(-1)?.planVersion ?? 1);
    const stepOrder = options.stepOrder ?? repository.nextTaskStepOrder(task.taskId);
    const source = options.source ?? "graph";
    const dependsOn = options.dependsOn ?? [];
    const acceptance = options.acceptance ?? null;

    repository.createTaskStep({
        stepId,
        taskId: task.taskId,
        planVersion,
        stepOrder,
        source,
        title,
        dependsOn,
        acceptance,
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
            planVersion,
            stepOrder,
            source,
            title,
            dependsOn,
            acceptance,
        }, graphCheckpoint),
    });

    return {
        stepId,
        taskId: task.taskId,
        planVersion,
        stepOrder,
        source,
        status: "running",
        title,
        dependsOn,
        acceptance,
        startedAt: now,
        endedAt: null,
        summary: null,
        supersededBy: null,
        supersededReason: null,
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
 * @param graphCheckpoint 可选图检查点。
 * @returns 更新后的步骤记录；不存在时返回 null。
 */
export function updateTaskStep(
    database: CenterDatabase,
    events: CenterEventStore,
    stepId: string,
    status: TaskRecord["status"],
    summary: string | null,
    graphCheckpoint?: TurnGraphCheckpoint,
    options: {
        /** title: 更新后的步骤标题；不传时保留原标题。 */
        title?: string;
        /** planVersion: 更新后的计划版本；不传时保留原版本。 */
        planVersion?: number;
        /** stepOrder: 更新后的步骤顺序；不传时保留原顺序。 */
        stepOrder?: number;
        /** source: 更新后的步骤来源；不传时保留原来源。 */
        source?: TaskStepRecord["source"];
        /** dependsOn: 更新后的依赖步骤 ID；不传时保留原依赖。 */
        dependsOn?: string[];
        /** acceptance: 更新后的验收口径；不传时保留原验收口径。 */
        acceptance?: string | null;
        /** supersededBy: 替换当前步骤的新步骤 ID。 */
        supersededBy?: string | null;
        /** supersededReason: 当前步骤被替换的原因。 */
        supersededReason?: string | null;
    } = {},
): TaskStepRecord | null {
    const existing = new SessionRepository(database).findTaskStepWithTask(stepId);

    if (!existing) {
        return null;
    }

    // now: 终态步骤保存结束时间，运行态保留空结束时间。
    const now = formatCenterLocalDateTime();
    const endedAt = isFinalTaskStatus(status) ? now : null;

    new SessionRepository(database).updateTaskStep({
        stepId,
        status,
        endedAt,
        summary,
        ...options,
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
            planVersion: options.planVersion ?? existing.planVersion,
            stepOrder: options.stepOrder ?? existing.stepOrder,
            source: options.source ?? existing.source,
            dependsOn: options.dependsOn ?? existing.dependsOn,
            acceptance: options.acceptance ?? existing.acceptance,
            supersededBy: options.supersededBy ?? existing.supersededBy,
            supersededReason: options.supersededReason ?? existing.supersededReason,
        }, graphCheckpoint),
    });

    return {
        stepId,
        taskId: existing.taskId,
        planVersion: options.planVersion ?? existing.planVersion,
        stepOrder: options.stepOrder ?? existing.stepOrder,
        source: options.source ?? existing.source,
        status,
        title: options.title ?? existing.title,
        dependsOn: options.dependsOn ?? existing.dependsOn,
        acceptance: options.acceptance ?? existing.acceptance,
        startedAt: existing.startedAt,
        endedAt,
        summary,
        supersededBy: options.supersededBy ?? existing.supersededBy,
        supersededReason: options.supersededReason ?? existing.supersededReason,
    };
}

/**
 * recordTaskPlanRevised：记录用户中途修改需求后的任务重规划事件。
 *
 * @param events 事件追加器。
 * @param input 重规划上下文。
 * @returns 没有返回值。
 */
export function recordTaskPlanRevised(
    events: CenterEventStore,
    input: {
        /** sessionId: 当前会话 ID。 */
        sessionId: string;
        /** turnId: 当前轮次 ID。 */
        turnId: string;
        /** taskId: 当前任务 ID。 */
        taskId: string;
        /** planVersion: 新计划版本号。 */
        planVersion: number;
        /** reason: 重规划原因。 */
        reason: string;
        /** supersededStepIds: 被替换的旧步骤 ID 列表。 */
        supersededStepIds: string[];
    },
): void {
    events.append({
        eventType: "task.plan.revised",
        scopeType: "task",
        scopeId: input.taskId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        taskId: input.taskId,
        status: "running",
        title: "任务计划重规划",
        summary: input.reason,
        payload: {
            taskId: input.taskId,
            planVersion: input.planVersion,
            reason: input.reason,
            supersededStepIds: input.supersededStepIds,
            mergeRule: "保留仍有效步骤，将过期步骤标记为 superseded，并把新增需求追加到同一 taskId。",
        },
    });
}

/**
 * submitGuidanceForActiveTask：把用户中途补充或修改需求合并到当前任务。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param input 用户补充引导上下文。
 * @returns 合并后的任务和新增步骤身份。
 */
/**
 * updateTurnStatus：更新轮次状态，并同步默认任务终态。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param turnId 轮次 ID。
 * @param status 新轮次状态。
 * @param preferredTaskId 当前图执行任务 ID；传入后只同步该任务状态。
 * @returns 更新后的轮次记录；不存在时返回 null。
 */
export function updateTurnStatus(
    database: CenterDatabase,
    events: CenterEventStore,
    turnId: string,
    status: "waiting_user" | "completed" | "failed" | "cancelled",
    preferredTaskId?: string,
): ConversationTurn | null {
    const turn = new SessionRepository(database).findTurn(turnId);

    if (!turn) {
        return null;
    }

    // now: 终态轮次固定结束时间，等待用户状态仍不写结束时间。
    const now = formatCenterLocalDateTime();
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
        preferredTaskId,
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
        || status === "cancelled"
        || status === "superseded";
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
    const now = formatCenterLocalDateTime();
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
 * appendSessionTouchedEvent：发送消息后广播会话元信息变化。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param session 会话记录。
 * @param turnId 触发更新时间的轮次 ID。
 * @param taskId 触发更新时间的任务 ID。
 * @returns 更新后的会话记录。
 */
export function appendSessionTouchedEvent(
    database: CenterDatabase,
    events: CenterEventStore,
    session: ConversationSession,
    turnId: string,
    taskId: string,
): ConversationSession {
    const updatedSession = findSession(
        database,
        session.sessionId,
    );
    if (!updatedSession) {
        throw new Error("SESSION_TOUCHED_ROW_NOT_FOUND");
    }

    events.append({
        eventType: "session.updated",
        scopeType: "session",
        scopeId: session.sessionId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: "completed",
        title: "会话更新时间",
        summary: "用户消息已写入，会话导航需要刷新。",
        payload: {
            session: updatedSession,
            previousTitle: session.title,
            titleSummarySource: "message-send",
        },
    });

    return updatedSession;
}

/**
 * completeCreatedTurn：把已创建的消息轮次接入最小执行闭环。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 发送接口创建的消息、轮次和任务身份。
 * @param userText 用户原始输入。
 * @param centerDirectory 中心目录。
 * @param memoryQueues 智能体记忆单写队列。
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
    await runDeepAgentsTurn({
        database,
        events,
        sent,
        userText,
        centerDirectory,
        memoryQueues,
        executors: createDeepAgentsNodeExecutors(
            database,
            events,
            centerDirectory,
            memoryQueues,
        ),
    });
}

/**
 * createDeepAgentsNodeExecutors：创建 Deep Agents 多节点执行器。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param memoryQueues 智能体记忆单写队列。
 * @returns 每个 Deep Agents 执行节点对应的执行函数。
 */
function createDeepAgentsNodeExecutors(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory?: string,
    memoryQueues?: Map<string, MemoryQueueState>,
): DeepAgentsNodeExecutors {
    return {
        thinkingContext: async (state) => {
            const graphContext = createStateGraphContext(state);
            const checkpoint = createStateGraphCheckpoint(
                state,
                "thinking.context",
                "thinking",
                1,
                null,
                [
                    "model.stream",
                ],
                "整理会话、项目、记忆和可用能力上下文。",
            );
            startWorkerTask(database, events, state.taskId);
            const thinkingStep = createTaskStep(
                database,
                events,
                stepTaskFromGraphContext(graphContext),
                "思考与上下文整理",
                {},
                checkpoint,
            );
            // 真实思考只能来自供应商明确公开的 reasoning/thinking 摘要；上下文整理节点只维护任务步骤，不写 thinking.* 正文事件。
            updateTaskStep(
                database,
                events,
                thinkingStep.stepId,
                "completed",
                "思考过程和上下文整理完成。",
                checkpoint,
            );
            return {};
        },
        modelStream: async (state) => {
            const graphContext = createStateGraphContext(state);
            const checkpoint = createStateGraphCheckpoint(
                state,
                "model.stream",
                "model",
                2,
                "thinking.context",
                [
                    "tool.execute",
                    "message.persist",
                ],
                "调用供应商模型并接收 OpenAI Chat Completions 流式回复。",
            );
            const modelStep = createTaskStep(
                database,
                events,
                stepTaskFromGraphContext(graphContext),
                "模型流式输出",
                {},
                checkpoint,
            );
            try {
                const modelResult = await invokeProviderModelGateway(
                    database,
                    events,
                    state.sessionId,
                    state.taskId,
                    state.turnId,
                    state.userText,
                    checkpoint,
                );
                updateTaskStep(
                    database,
                    events,
                    modelStep.stepId,
                    "completed",
                    modelResult.toolCalls.length > 0
                        ? "模型已通过 OpenAI tool_calls 请求工具。"
                        : "模型流式输出完成并准备固化助手消息。",
                    checkpoint,
                );
                return {
                    modelResult,
                    finalModelResult: modelResult.toolCalls.length === 0
                        ? modelResult
                        : state.finalModelResult,
                };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "UNKNOWN_MODEL_ERROR";
                updateTaskStep(
                    database,
                    events,
                    modelStep.stepId,
                    "failed",
                    errorMessage,
                    checkpoint,
                );
                return {
                    failed: true,
                    errorMessage,
                };
            }
        },
        toolExecute: async (state) => {
            if (!state.modelResult || state.modelResult.toolCalls.length === 0) {
                return {
                    toolResults: [],
                };
            }
            if (state.totalToolRound >= 16) {
                return {
                    failed: true,
                    errorMessage: "长任务已达到任务级工具总预算。已保留当前进度、工具结果和任务步骤，请根据已完成内容继续收敛或补充目标。",
                };
            }
            if (state.toolRound >= 4) {
                const checkpoint = createStateGraphCheckpoint(
                    state,
                    "agent.loop.batch_limit_reached",
                    "tool",
                    3 + state.totalToolRound * 2,
                    "tool.result",
                    [
                        "tool.execute",
                    ],
                    "单批工具循环达到内部预算，自动续跑同一轮次同一任务。",
                );
                events.append({
                    eventType: "agent.loop.batch_limit_reached",
                    scopeType: "task",
                    scopeId: state.taskId,
                    sessionId: state.sessionId,
                    turnId: state.turnId,
                    taskId: state.taskId,
                    status: "running",
                    title: "工具批次自动续跑",
                    summary: "单批工具循环达到内部上限，中心服务已自动进入下一批继续执行。",
                    payload: withTurnGraphCheckpoint({
                        turnId: state.turnId,
                        taskId: state.taskId,
                        toolBatchCount: state.toolBatchCount + 1,
                        totalToolRound: state.totalToolRound,
                        nextPlan: "沿用当前上下文、已完成工具结果和同一任务步骤继续执行。",
                    }, checkpoint),
                });
                return {
                    toolRound: 0,
                    toolBatchCount: state.toolBatchCount + 1,
                    batchContinuation: true,
                };
            }
            const checkpoint = createStateGraphCheckpoint(
                state,
                "tool.execute",
                "tool",
                3 + state.toolRound * 2,
                "model.stream",
                [
                    "tool.result",
                ],
                "执行模型请求的命令或 MCP 工具并记录副作用结果。",
            );
            const toolResults = await executeModelRequestedTools(
                database,
                events,
                state.sent,
                state.modelResult,
                checkpoint,
            );
            return {
                toolResults: toolResults.map((toolResult): DeepAgentsToolResult => {
                    return {
                        toolCall: toolResult.toolCall,
                        resultText: toolResult.resultText,
                        executedTool: {
                            toolId: toolResult.unifiedToolIntent.toolId,
                            toolKind: toolResult.unifiedToolIntent.toolKind,
                            inputSummary: toolResult.unifiedToolIntent.inputSummary,
                        },
                    };
                }),
                executedTool: toolResults[0]
                    ? {
                        toolId: toolResults[0].unifiedToolIntent.toolId,
                        toolKind: toolResults[0].unifiedToolIntent.toolKind,
                        inputSummary: toolResults[0].unifiedToolIntent.inputSummary,
                    }
                    : state.executedTool,
            };
        },
        toolResult: async (state) => {
            const checkpoint = createStateGraphCheckpoint(
                state,
                "tool.result",
                "model",
                4 + state.toolRound * 2,
                "tool.execute",
                [
                    "tool.execute",
                    "message.persist",
                ],
                "按 OpenAI tool_call_id 把工具结果回填模型生成后续回复。",
            );
            if (state.toolResults.length === 0) {
                return {
                    modelResult: state.modelResult,
                    finalModelResult: state.modelResult,
                    toolRound: state.toolRound + 1,
                    totalToolRound: state.totalToolRound + 1,
                    batchContinuation: false,
                };
            }
            const commandInputFailureText = resolveCommandInputFailureAssistantText(state.toolResults);
            if (commandInputFailureText && state.modelResult) {
                // 空命令参数已经是工具输入错误，继续回填给模型只会触发同一个空工具调用循环。
                const finalModelResult: ProviderModelGatewayResult = {
                    ...state.modelResult,
                    assistantText: commandInputFailureText,
                    toolCall: null,
                    toolCalls: [],
                };
                return {
                    modelResult: finalModelResult,
                    finalModelResult,
                    toolResults: [],
                    toolRound: state.toolRound + 1,
                    totalToolRound: state.totalToolRound + 1,
                    batchContinuation: false,
                };
            }
            try {
                const nextModelResult = await continueProviderModelGatewayWithToolResults(
                    database,
                    events,
                    state.sessionId,
                    state.taskId,
                    state.turnId,
                    state.userText,
                    state.toolResults.map((toolResult) => {
                        return {
                            toolCall: toolResult.toolCall,
                            resultText: toolResult.resultText,
                        };
                    }),
                    checkpoint,
                );
                return {
                    modelResult: nextModelResult,
                    finalModelResult: nextModelResult.toolCalls.length === 0
                        ? nextModelResult
                        : state.finalModelResult,
                    toolResults: [],
                    toolRound: state.toolRound + 1,
                    totalToolRound: state.totalToolRound + 1,
                    batchContinuation: false,
                };
            } catch (error) {
                return {
                    failed: true,
                    errorMessage: error instanceof Error ? error.message : "UNKNOWN_TOOL_RESULT_MODEL_ERROR",
                };
            }
        },
        toolPlan: async (state) => {
            const graphContext = createStateGraphContext(state);
            const checkpoint = createStateGraphCheckpoint(
                state,
                "tool.plan",
                "tool",
                5 + state.toolRound * 2,
                "memory.commit",
                [
                    "usage.record",
                ],
                "记录模型工具计划和后续可用能力状态。",
            );
            const toolPlanStep = createTaskStep(
                database,
                events,
                stepTaskFromGraphContext(graphContext),
                "工具计划生成",
                {},
                checkpoint,
            );
            appendToolPlanCreatedEvents(
                events,
                state,
                checkpoint,
            );
            appendToolVisibilityEvents(
                events,
                state.sessionId,
                state.taskId,
                state.turnId,
                checkpoint,
            );
            updateTaskStep(
                database,
                events,
                toolPlanStep.stepId,
                "completed",
                state.executedTool
                    ? "工具计划已由模型工具调用请求生成并执行。"
                    : "工具计划已生成，本轮模型未请求可执行工具。",
                checkpoint,
            );
            return {};
        },
        messagePersist: async (state) => {
            const finalModelResult = state.finalModelResult ?? state.modelResult;
            if (!finalModelResult) {
                return {
                    failed: true,
                    errorMessage: "MODEL_RESULT_NOT_AVAILABLE",
                };
            }
            const checkpoint = createStateGraphCheckpoint(
                state,
                "message.persist",
                "message",
                6 + state.toolRound * 2,
                state.executedTool ? "tool.result" : "model.stream",
                [
                    "memory.commit",
                    "failure.close",
                ],
                "固化助手消息并处理半截工具意图失败。",
            );
            const assistantText = finalModelResult.assistantText;
            const turnSessionId = new SessionRepository(database).findSessionIdByTurn(state.turnId);
            if (isIncompleteToolIntentReply(assistantText)) {
                markTurnIncompleteToolIntent(
                    database,
                    events,
                    state.sent,
                    turnSessionId,
                    assistantText,
                    checkpoint,
                );
                return {
                    failed: true,
                    incompleteToolIntent: true,
                    assistantText,
                    errorMessage: "INCOMPLETE_TOOL_INTENT_REPLY",
                };
            }
            const assistantMessageId = randomUUID();
            new SessionRepository(database).insertAssistantMessageForTurn({
                messageId: assistantMessageId,
                turnId: state.turnId,
                contentMarkdown: assistantText,
                createdAt: formatCenterLocalDateTime(),
            });
            events.append({
                eventType: "message.created",
                scopeType: "message",
                scopeId: assistantMessageId,
                sessionId: turnSessionId,
                turnId: state.turnId,
                taskId: state.taskId,
                status: "completed",
                title: "消息创建",
                summary: "助手回复已写入中心服务。",
                payload: withTurnGraphCheckpoint({
                    messageId: assistantMessageId,
                    role: "assistant",
                }, checkpoint),
            });
            handleWorkerMessage(database, events, "task.complete", state.taskId, {
                assistantMessageId,
                providerId: finalModelResult.providerId,
                model: finalModelResult.model,
                usage: finalModelResult.usage,
            });
            return {
                assistantText,
                assistantMessageId,
                finalModelResult,
            };
        },
        memoryCommit: async (state) => {
            const checkpoint = createStateGraphCheckpoint(
                state,
                "memory.commit",
                "memory",
                7 + state.toolRound * 2,
                "message.persist",
                [
                    "usage.record",
                ],
                "提交主智能体长期记忆和语义记忆索引。",
            );
            if (centerDirectory && memoryQueues && state.assistantText) {
                await commitMainAgentMemoryAfterTurn(
                    database,
                    events,
                    centerDirectory,
                    memoryQueues,
                    state.sent,
                    state.userText,
                    state.assistantText,
                    checkpoint,
                );
            }
            return {};
        },
        usageRecord: async (state) => {
            const finalModelResult = state.finalModelResult ?? state.modelResult;
            if (!finalModelResult || !state.assistantText) {
                return {
                    failed: true,
                    errorMessage: "FINAL_MODEL_RESULT_NOT_AVAILABLE",
                };
            }
            const checkpoint = createStateGraphCheckpoint(
                state,
                "usage.record",
                "usage",
                8 + state.toolRound * 2,
                "tool.plan",
                [
                    "END",
                ],
                "写入模型用量、刷新日聚合并更新会话标题。",
            );
            recordModelUsageAfterTurn(
                database,
                events,
                state.sent,
                finalModelResult,
                checkpoint,
            );
            updateSessionTitleAfterTurn(
                database,
                events,
                state.sent,
                    state.userText,
                    state.assistantText,
                );
            const latestTurn = new SessionRepository(database).findTurn(state.turnId);
            if (latestTurn?.status === "cancelled") {
                return {};
            }
            updateTurnStatus(
                database,
                events,
                state.turnId,
                "completed",
                state.taskId,
            );
            return {};
        },
        failureClose: async (state) => {
            const turnSessionId = new SessionRepository(database).findSessionIdByTurn(state.turnId);
            const message = state.errorMessage ?? "UNKNOWN_MODEL_ERROR";
            new SessionRepository(database).updateTaskStatus(
                state.taskId,
                "failed",
                formatCenterLocalDateTime(),
            );
            const failedAt = formatCenterLocalDateTime();
            new SessionRepository(database).updateTurnStatus({
                turnId: state.turnId,
                status: "failed",
                endedAt: failedAt,
                durationMs: 0,
            });
            events.append({
                eventType: "model.failed",
                scopeType: "model",
                scopeId: state.taskId,
                sessionId: turnSessionId,
                turnId: state.turnId,
                taskId: state.taskId,
                status: "failed",
                title: "模型调用失败",
                summary: message,
                payload: {
                    taskId: state.taskId,
                    turnId: state.turnId,
                    errorMessage: message,
                },
            });
            handleWorkerMessage(database, events, "task.failed", state.taskId, {
                errorMessage: message,
            });
            return {};
        },
    };
}

/**
 * appendToolPlanCreatedEvents：按模型工具调用结果写入工具计划事件。
 *
 * @param events 事件日志仓储。
 * @param state 当前 Deep Agents 状态。
 * @param checkpoint 工具计划节点检查点。
 * @returns 无返回值。
 */
function appendToolPlanCreatedEvents(
    events: CenterEventStore,
    state: DeepAgentsTurnState,
    checkpoint: TurnGraphCheckpoint,
): void {
    if (state.toolResults.length === 0) {
        events.append({
            eventType: "tool.plan.created",
            scopeType: "tool-plan",
            scopeId: state.taskId,
            sessionId: state.sessionId,
            turnId: state.turnId,
            taskId: state.taskId,
            status: "completed",
            title: "工具计划",
            summary: "当前模型回复未请求工具调用，已记录内联工具、MCP 和 skill 可用性。",
            payload: withTurnGraphCheckpoint({
                toolCallId: null,
                plannedToolId: null,
                plannedToolKind: null,
                inputSummary: null,
                fallbackToolKinds: [
                    "agent",
                    "command",
                    "mcp",
                    "skill",
                ],
            }, checkpoint),
        });
        return;
    }
    for (const toolResult of state.toolResults) {
        // toolCallId: 每个 OpenAI 工具调用都要有独立计划事件，避免多工具同轮时只聚合第一个工具卡片。
        events.append({
            eventType: "tool.plan.created",
            scopeType: "tool-plan",
            scopeId: state.taskId,
            sessionId: state.sessionId,
            turnId: state.turnId,
            taskId: state.taskId,
            status: "completed",
            title: "工具计划",
            summary: "模型已基于 OpenAI 结构化工具定义请求工具调用。",
            payload: withTurnGraphCheckpoint({
                toolCallId: toolResult.toolCall.toolCallId,
                plannedToolId: toolResult.executedTool.toolId,
                plannedToolKind: toolResult.executedTool.toolKind,
                inputSummary: toolResult.executedTool.inputSummary,
                fallbackToolKinds: [
                    "agent",
                    "command",
                    "mcp",
                    "skill",
                ],
            }, checkpoint),
        });
    }
}

/**
 * createStateGraphContext：从 Deep Agents 状态生成中心服务图上下文。
 *
 * @param state 当前 Deep Agents 状态。
 * @returns 中心服务图上下文。
 */
function createStateGraphContext(state: DeepAgentsTurnState): TurnGraphContext {
    return createTurnGraphContext({
        sessionId: state.sessionId,
        turnId: state.turnId,
        taskId: state.taskId,
    });
}

/**
 * createStateGraphCheckpoint：为 Deep Agents 执行节点生成中心服务 checkpoint。
 *
 * @param state 当前 Deep Agents 状态。
 * @param nodeId 节点 ID。
 * @param nodeKind 节点类型。
 * @param superstep 节点层级。
 * @param parentNodeId 父节点 ID。
 * @param nextNodeIds 后续节点 ID。
 * @param stateSummary 状态摘要。
 * @returns 可写入事件载荷的图检查点。
 */
function createStateGraphCheckpoint(
    state: DeepAgentsTurnState,
    nodeId: string,
    nodeKind: TurnGraphCheckpoint["nodeKind"],
    superstep: number,
    parentNodeId: string | null,
    nextNodeIds: string[],
    stateSummary: string,
): TurnGraphCheckpoint {
    return createTurnGraphCheckpoint(
        createStateGraphContext(state),
        {
            nodeId,
            nodeKind,
            superstep,
            parentNodeId,
            nextNodeIds,
            stateSummary,
        },
    );
}

/**
 * resolveCommandInputFailureAssistantText：把命令工具空参数失败转换为本轮可固化回复。
 *
 * @param toolResults 当前工具执行结果列表。
 * @returns 全部工具结果都是命令参数缺失时返回助手回复，否则返回 null。
 */
function resolveCommandInputFailureAssistantText(toolResults: DeepAgentsToolResult[]): string | null {
    if (toolResults.length === 0) {
        return null;
    }
    const allCommandInputFailures = toolResults.every((toolResult) => {
        return toolResult.executedTool.toolId === "builtin.command.run"
            && toolResult.resultText.includes("COMMAND_INPUT_EMPTY");
    });
    if (!allCommandInputFailures) {
        return null;
    }
    return "命令工具调用失败：模型没有提供可执行的 shellCommand 或 executablePath。请重新发起命令请求，中心服务会继续要求模型使用结构化命令参数。";
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
 * @param graphCheckpoint 失败收尾节点图检查点。
 * @returns 没有返回值。
 */
function markTurnIncompleteToolIntent(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    sessionId: string | null,
    assistantText: string,
    graphCheckpoint?: TurnGraphCheckpoint,
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
        payload: withOptionalGraphCheckpoint({
            taskId: sent.taskId,
            turnId: sent.turnId,
            interceptedAssistantText: assistantText,
            reason: "INCOMPLETE_TOOL_INTENT_REPLY",
        }, graphCheckpoint),
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
 * recordModelUsageAfterTurn：真实模型调用完成后写入用量原始记录并刷新日聚合。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param sent 当前发送接口返回的会话、轮次和任务身份。
 * @param modelResult 模型网关返回的真实供应商、模型和用量。
 * @param graphCheckpoint 用量节点图检查点。
 * @returns 写入成功时返回用量记录 ID；模型未返回用量时返回 null。
 */
export function recordModelUsageAfterTurn(
    database: CenterDatabase,
    events: CenterEventStore,
    sent: SendMessageResponse,
    modelResult: ProviderModelGatewayResult,
    graphCheckpoint?: TurnGraphCheckpoint,
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
            payload: withOptionalGraphCheckpoint({
                providerId: modelResult.providerId,
                model: modelResult.model,
                reason: "MODEL_USAGE_NOT_PROVIDED",
            }, graphCheckpoint),
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
            payload: withOptionalGraphCheckpoint({
                sessionId: sent.sessionId,
                providerId: modelResult.providerId,
                model: modelResult.model,
                reason: "SESSION_NOT_FOUND",
            }, graphCheckpoint),
            errorCode: "USAGE_SESSION_NOT_FOUND",
        });
        return null;
    }

    const usage = recordUsage(database, events, {
        providerId: modelResult.providerId,
        model: modelResult.model,
        projectId: session.projectId,
        sessionId: sent.sessionId,
        turnId: sent.turnId,
        taskId: sent.taskId,
        inputTokens: modelResult.usage.inputTokens,
        outputTokens: modelResult.usage.outputTokens,
        cacheHitTokens: modelResult.usage.cacheHitTokens,
        cacheMissTokens: modelResult.usage.cacheMissTokens,
        status: "completed",
        graphPayload: graphCheckpoint
            ? {
                graph: graphCheckpoint,
            }
            : undefined,
    });
    events.append({
        eventType: "usage.recorded.graph_checkpoint",
        scopeType: "usage",
        scopeId: usage.usageId,
        sessionId: sent.sessionId,
        turnId: sent.turnId,
        taskId: sent.taskId,
        status: "completed",
        title: "用量图检查点",
        summary: "模型用量记录已绑定当前 Deep Agents 执行节点。",
        payload: withOptionalGraphCheckpoint({
            usageId: usage.usageId,
            providerId: modelResult.providerId,
            model: modelResult.model,
        }, graphCheckpoint),
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
    const turn = new SessionRepository(database).findTurn(sent.turnId);
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
    if (!turn || turn.turnNumber !== 1) {
        events.append({
            eventType: "session.title_summary.skipped",
            scopeType: "session",
            scopeId: session.sessionId,
            sessionId: session.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            projectId: session.projectId,
            status: "completed",
            title: "会话标题总结跳过",
            summary: "会话标题只在第一次对话完成后自动总结，后续轮次保留原标题。",
            payload: {
                sessionId: session.sessionId,
                turnNumber: turn?.turnNumber ?? null,
                preservedTitle: session.title,
                reason: "SESSION_TITLE_SUMMARY_SKIPPED_AFTER_FIRST_TURN",
            },
        });
        return session;
    }
    try {
        // nextTitle: 标题摘要只使用当前轮真实用户输入和助手回复，避免从旧标题或多候选字段猜测。
        const nextTitle = summarizeSessionTitle(
            userText,
            assistantText,
        );
        // now: 会话标题变化属于会话元信息更新，需要刷新列表排序和详情更新时间。
        const now = formatCenterLocalDateTime();
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

export {
    deleteProject,
    deleteSession,
    listEvents,
    listPendingMessages,
    savePendingMessage,
} from "./session-query-domain.js";
export {
    submitGuidanceForActiveTask,
} from "./session-guidance-domain.js";

