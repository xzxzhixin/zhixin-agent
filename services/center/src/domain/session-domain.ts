import {randomUUID} from "node:crypto";

import type {
    ActiveTurnStateStatus,
    ClientType,
    ConversationMessage,
    ConversationSession,
    ConversationTurn,
    ProjectRecord,
    SessionType,
    TaskRecord,
} from "@zhixin/shared";
import {
    ACTIVE_TURN_STATE_STATUSES,
    CONVERSATION_TURN_STATUSES,
    EVENT_SCOPE_TYPES,
    EVENT_TYPE_PREFIXES,
    EVENT_TYPES,
    FINAL_TASK_STATUSES,
    TASK_STATUSES,
} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import type {SendMessageResponse, TaskStepRecord} from "../types.js";
import {SessionRepository} from "../data-access/session-repository.js";
import {runDeepAgentsAgentTurn} from "../deepagents-agent.js";
import type {MemoryQueueState} from "../types.js";
import {
    recordUsage,
} from "./workflow-domain.js";
import {refreshUsageDailyStats} from "./usage-domain.js";
import type {ProviderModelGatewayResult} from "../model-provider/ModelProviderRuntimeTypes.js";
import {
    type TurnGraphCheckpoint,
    type TurnGraphContext,
    withOptionalGraphCheckpoint,
    withTurnGraphCheckpoint,
} from "./turn-graph-domain.js";
import {formatCenterLocalDateTime} from "../time.js";

/**
 * ActiveTurnState：当前会话最新轮次的轻量状态事实。
 *
 * 来源：中心服务会话、轮次、任务和事件表。
 * 含义：给前端运行中状态收敛器使用，避免为判断终态反复拉取完整会话快照。
 */
export interface ActiveTurnState {
    /** sessionId: 当前会话 ID。 */
    sessionId: string;
    /** turnId: 最新轮次 ID；会话还没有轮次时为 null。 */
    turnId: string | null;
    /** taskId: 最新轮次关联任务 ID；没有任务时为 null。 */
    taskId: string | null;
    /** status: 最新轮次状态；无轮次时为 idle。 */
    status: ActiveTurnStateStatus;
    /** endedAt: 最新轮次结束时间；未结束或无轮次时为 null。 */
    endedAt: string | null;
    /** durationMs: 最新轮次耗时；未结束或无轮次时为 null。 */
    durationMs: number | null;
    /** lastSequence: 最新轮次最后事件序号；没有事件时为 0。 */
    lastSequence: number;
    /** lastActivityAt: 最新任务、事件或轮次开始时间中的最近活动时间；无轮次时为 null。 */
    lastActivityAt: string | null;
    /** serverNow: 中心服务本机时间，用于前端诊断和节流，不作为业务时间回写。 */
    serverNow: string;
}

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
 * getActiveTurnState：读取当前会话最新轮次的轻量状态。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 最新轮次状态；会话不存在或没有轮次时返回 idle 状态。
 */
export function getActiveTurnState(database: CenterDatabase, sessionId: string): ActiveTurnState {
    const repository = new SessionRepository(database);
    const turn = repository.findLatestTurnForSession(sessionId);
    if (!turn) {
        return {
            sessionId,
            turnId: null,
            taskId: null,
            status: ACTIVE_TURN_STATE_STATUSES.IDLE,
            endedAt: null,
            durationMs: null,
            lastSequence: 0,
            lastActivityAt: null,
            serverNow: formatCenterLocalDateTime(),
        };
    }

    const task = repository.findLatestTaskForTurn(turn.turnId);
    const event = repository.findLatestEventForTurn(turn.turnId);
    return {
        sessionId,
        turnId: turn.turnId,
        taskId: task?.taskId ?? null,
        status: normalizeTurnStateStatus(turn.status),
        endedAt: turn.endedAt,
        durationMs: turn.durationMs,
        lastSequence: event?.sequence ?? 0,
        lastActivityAt: resolveActiveTurnLastActivityAt(
            turn,
            task,
            event,
        ),
        serverNow: formatCenterLocalDateTime(),
    };
}

/**
 * normalizeTurnStateStatus：把数据库轮次状态归一为前端收敛器协议状态。
 *
 * @param status 数据库保存的轮次状态。
 * @returns 轻量状态协议允许的状态值。
 */
function normalizeTurnStateStatus(status: string): ActiveTurnState["status"] {
    if (status === ACTIVE_TURN_STATE_STATUSES.QUEUED
        || status === ACTIVE_TURN_STATE_STATUSES.RUNNING
        || status === ACTIVE_TURN_STATE_STATUSES.WAITING_USER
        || status === ACTIVE_TURN_STATE_STATUSES.COMPLETED
        || status === ACTIVE_TURN_STATE_STATUSES.FAILED
        || status === ACTIVE_TURN_STATE_STATUSES.CANCELLED) {
        return status;
    }
    return ACTIVE_TURN_STATE_STATUSES.IDLE;
}

/**
 * resolveActiveTurnLastActivityAt：计算轮次轻量状态的最后活动时间。
 *
 * @param turn 最新轮次。
 * @param task 最新任务；没有任务时为 null。
 * @param event 最新事件；没有事件时为 null。
 * @returns 轮次范围内可用于前端判断是否仍在推进的最新时间。
 */
function resolveActiveTurnLastActivityAt(
    turn: ConversationTurn,
    task: TaskRecord | null,
    event: {
        /** occurredAt: 最新事件发生时间。 */
        occurredAt: string;
    } | null,
): string | null {
    const candidates = [
        turn.startedAt,
        turn.endedAt,
        task?.updatedAt ?? null,
        event?.occurredAt ?? null,
    ].filter((value): value is string => {
        return typeof value === "string" && value.length > 0;
    });
    if (candidates.length === 0) {
        return null;
    }
    return candidates.reduce((latest, current) => {
        const latestTime = new Date(latest).getTime();
        const currentTime = new Date(current).getTime();
        if (Number.isNaN(currentTime)) {
            return latest;
        }
        if (Number.isNaN(latestTime) || currentTime > latestTime) {
            return current;
        }
        return latest;
    });
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
 * createTaskStep：创建用户可见任务步骤并写入事件。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param task 任务记录。
 * @param title 步骤标题。
 * @param graphCheckpoint 可选图检查点；用户可见步骤通常不需要携带内部图节点。
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
        /** source: 步骤来源，默认 system 表示中心服务生成的用户可见步骤。 */
        source?: TaskStepRecord["source"];
        /** dependsOn: 依赖步骤 ID 列表，默认空数组。 */
        dependsOn?: string[];
        /** acceptance: 步骤验收口径，默认没有单独验收说明。 */
        acceptance?: string | null;
        /** initialStatus: 步骤初始状态，默认 running 表示真实开始执行。 */
        initialStatus?: TaskStepRecord["status"];
        /** summary: 初始摘要，默认没有摘要。 */
        summary?: string | null;
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
    const source = options.source ?? "system";
    const dependsOn = options.dependsOn ?? [];
    const acceptance = options.acceptance ?? null;
    const initialStatus = options.initialStatus ?? TASK_STATUSES.RUNNING;
    const summary = options.summary ?? null;
    const startedAt = initialStatus === TASK_STATUSES.RUNNING
        ? now
        : null;
    const endedAt = isFinalTaskStatus(initialStatus)
        ? now
        : null;

    repository.createTaskStep({
        stepId,
        taskId: task.taskId,
        planVersion,
        stepOrder,
        source,
        status: initialStatus,
        title,
        dependsOn,
        acceptance,
        startedAt,
        endedAt,
        summary,
    });

    events.append({
        eventType: initialStatus === TASK_STATUSES.RUNNING
            ? `${EVENT_TYPE_PREFIXES.TASK_STEP}started`
            : `${EVENT_TYPE_PREFIXES.TASK_STEP}created`,
        scopeType: EVENT_SCOPE_TYPES.TASK_STEP,
        scopeId: stepId,
        sessionId: task.sessionId,
        turnId: task.turnId,
        taskId: task.taskId,
        stepId,
        status: initialStatus,
        title: initialStatus === TASK_STATUSES.RUNNING
            ? "任务步骤开始"
            : "任务步骤创建",
        summary: summary ?? title,
        payload: withOptionalGraphCheckpoint({
            stepId,
            status: initialStatus,
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
        status: initialStatus,
        title,
        dependsOn,
        acceptance,
        startedAt,
        endedAt,
        summary,
        supersededBy: null,
        supersededReason: null,
    };
}

/**
 * recordGraphNodeEvent：记录 Deep Agents 内部图节点过程事件。
 *
 * @param events 事件追加器。
 * @param graphContext 图执行上下文。
 * @param checkpoint 图节点检查点，写入 payload.graph 供恢复和审计。
 * @param eventType graph 节点事件类型。
 * @param status 过程状态。
 * @param title 节点标题。
 * @param summary 节点摘要。
 * @returns 没有返回值。
 */
function recordGraphNodeEvent(
    events: CenterEventStore,
    graphContext: TurnGraphContext,
    checkpoint: TurnGraphCheckpoint,
    eventType:
        | typeof EVENT_TYPES.GRAPH_NODE_STARTED
        | typeof EVENT_TYPES.GRAPH_NODE_COMPLETED
        | typeof EVENT_TYPES.GRAPH_NODE_FAILED,
    status:
        | typeof TASK_STATUSES.RUNNING
        | typeof TASK_STATUSES.COMPLETED
        | typeof TASK_STATUSES.FAILED,
    title: string,
    summary: string,
): void {
    events.append({
        eventType,
        scopeType: EVENT_SCOPE_TYPES.TASK,
        scopeId: graphContext.taskId,
        sessionId: graphContext.threadId,
        turnId: graphContext.graphRunId,
        taskId: graphContext.taskId,
        status,
        title,
        summary,
        payload: withTurnGraphCheckpoint({
            nodeId: checkpoint.nodeId,
            nodeKind: checkpoint.nodeKind,
            status,
            title,
            summary,
        }, checkpoint),
    });
}

/**
 * runGraphNodeWithEvents：为 Deep Agents 图节点补齐 started、completed 和 failed 过程事件。
 *
 * @param events 事件追加器。
 * @param graphContext 图执行上下文。
 * @param checkpoint 图节点检查点。
 * @param title 节点用户可读标题。
 * @param startedSummary 节点开始摘要。
 * @param completedSummary 节点完成摘要。
 * @param runner 节点真实业务逻辑。
 * @returns 节点业务逻辑返回值。
 */
export async function runGraphNodeWithEvents<T>(
    events: CenterEventStore,
    graphContext: TurnGraphContext,
    checkpoint: TurnGraphCheckpoint,
    title: string,
    startedSummary: string,
    completedSummary: string,
    runner: () => Promise<T> | T,
): Promise<T> {
    recordGraphNodeEvent(
        events,
        graphContext,
        checkpoint,
        EVENT_TYPES.GRAPH_NODE_STARTED,
        TASK_STATUSES.RUNNING,
        title,
        startedSummary,
    );
    try {
        const result = await runner();
        if (isFailedGraphNodePatch(result)) {
            recordGraphNodeEvent(
                events,
                graphContext,
                checkpoint,
                EVENT_TYPES.GRAPH_NODE_FAILED,
                TASK_STATUSES.FAILED,
                title,
                result.errorMessage ?? "GRAPH_NODE_RETURNED_FAILED_PATCH",
            );
            return result;
        }
        recordGraphNodeEvent(
            events,
            graphContext,
            checkpoint,
            EVENT_TYPES.GRAPH_NODE_COMPLETED,
            TASK_STATUSES.COMPLETED,
            title,
            completedSummary,
        );
        return result;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "UNKNOWN_GRAPH_NODE_ERROR";
        recordGraphNodeEvent(
            events,
            graphContext,
            checkpoint,
            EVENT_TYPES.GRAPH_NODE_FAILED,
            TASK_STATUSES.FAILED,
            title,
            errorMessage,
        );
        throw error;
    }
}

/**
 * isFailedGraphNodePatch：识别节点返回的失败状态补丁。
 *
 * @param result 节点业务逻辑返回值。
 * @returns 返回对象明确 failed=true 时返回 true。
 */
function isFailedGraphNodePatch(
    result: unknown,
): result is {
    /** failed: Deep Agents 节点失败标记。 */
    failed: true;
    /** errorMessage: 失败摘要；没有时使用默认文案。 */
    errorMessage?: string | null;
} {
    if (typeof result !== "object" || result === null) {
        return false;
    }
    const patch = result as {
        /** failed: Deep Agents 节点失败标记。 */
        failed?: unknown;
    };
    return patch.failed === true;
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
        eventType: EVENT_TYPES.TASK_STEP_UPDATED,
        scopeType: EVENT_SCOPE_TYPES.TASK_STEP,
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
        eventType: EVENT_TYPES.TASK_PLAN_REVISED,
        scopeType: EVENT_SCOPE_TYPES.TASK,
        scopeId: input.taskId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        taskId: input.taskId,
        status: TASK_STATUSES.RUNNING,
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
    status:
        | typeof CONVERSATION_TURN_STATUSES.WAITING_USER
        | typeof CONVERSATION_TURN_STATUSES.COMPLETED
        | typeof CONVERSATION_TURN_STATUSES.FAILED
        | typeof CONVERSATION_TURN_STATUSES.CANCELLED,
    preferredTaskId?: string,
): ConversationTurn | null {
    const turn = new SessionRepository(database).findTurn(turnId);

    if (!turn) {
        return null;
    }
    if (
        turn.endedAt !== null
        && (
            turn.status === CONVERSATION_TURN_STATUSES.COMPLETED
            || turn.status === CONVERSATION_TURN_STATUSES.FAILED
            || turn.status === CONVERSATION_TURN_STATUSES.CANCELLED
        )
    ) {
        return turn;
    }

    // now: 终态轮次固定结束时间，等待用户状态仍不写结束时间。
    const now = formatCenterLocalDateTime();
    const endedAt = status === CONVERSATION_TURN_STATUSES.WAITING_USER ? null : now;
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

    const turnUpdatedEvent = events.append({
        eventType: EVENT_TYPES.TURN_UPDATED,
        scopeType: EVENT_SCOPE_TYPES.TURN,
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
    events.append({
        eventType: EVENT_TYPES.TURN_STATE_CHANGED,
        scopeType: EVENT_SCOPE_TYPES.TURN,
        scopeId: turnId,
        sessionId: turn.sessionId,
        turnId,
        taskId: preferredTaskId ?? null,
        status,
        title: "轮次轻量状态更新",
        summary: `轮次轻量状态更新为 ${status}`,
        payload: {
            sessionId: turn.sessionId,
            turnId,
            taskId: preferredTaskId ?? null,
            status,
            endedAt,
            durationMs,
            lastSequence: turnUpdatedEvent.sequence + 1,
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
    return FINAL_TASK_STATUSES.includes(status);
}

/**
 * mapTurnStatusToTaskStatus：把轮次状态映射到任务状态。
 *
 * @param status 轮次状态。
 * @returns 任务状态。
 */
export function mapTurnStatusToTaskStatus(status:
    | typeof CONVERSATION_TURN_STATUSES.WAITING_USER
    | typeof CONVERSATION_TURN_STATUSES.COMPLETED
    | typeof CONVERSATION_TURN_STATUSES.FAILED
    | typeof CONVERSATION_TURN_STATUSES.CANCELLED,
): TaskRecord["status"] {
    if (status === CONVERSATION_TURN_STATUSES.WAITING_USER) {
        return TASK_STATUSES.WAITING_USER;
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
        eventType: EVENT_TYPES.TURN_STARTED,
        scopeType: EVENT_SCOPE_TYPES.TURN,
        scopeId: turnId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: TASK_STATUSES.RUNNING,
        title: "轮次开始",
        summary: "用户发送消息后创建新轮次。",
        payload: {
            turnId,
            turnNumber,
            userMessageId: messageId,
        },
    });

    events.append({
        eventType: EVENT_TYPES.MESSAGE_CREATED,
        scopeType: EVENT_SCOPE_TYPES.MESSAGE,
        scopeId: messageId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: TASK_STATUSES.COMPLETED,
        title: "消息创建",
        summary: "用户消息已写入中心服务。",
        payload: {
            messageId,
            role: "user",
        },
    });

    events.append({
        eventType: EVENT_TYPES.TASK_UPDATED,
        scopeType: EVENT_SCOPE_TYPES.TASK,
        scopeId: taskId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: TASK_STATUSES.QUEUED,
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
        eventType: EVENT_TYPES.SESSION_UPDATED,
        scopeType: EVENT_SCOPE_TYPES.SESSION,
        scopeId: session.sessionId,
        sessionId: session.sessionId,
        turnId,
        taskId,
        projectId: session.projectId,
        status: TASK_STATUSES.COMPLETED,
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
    await runDeepAgentsAgentTurn({
        database,
        events,
        sent,
        userText,
        centerDirectory,
        memoryQueues,
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
            eventType: EVENT_TYPES.USAGE_RECORD_SKIPPED,
            scopeType: EVENT_SCOPE_TYPES.USAGE,
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: TASK_STATUSES.COMPLETED,
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
            eventType: EVENT_TYPES.USAGE_RECORD_FAILED,
            scopeType: EVENT_SCOPE_TYPES.USAGE,
            scopeId: sent.taskId,
            sessionId: sent.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: TASK_STATUSES.FAILED,
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
        status: TASK_STATUSES.COMPLETED,
        graphPayload: graphCheckpoint
            ? {
                graph: graphCheckpoint,
            }
            : undefined,
    });
    events.append({
        eventType: EVENT_TYPES.USAGE_RECORDED_GRAPH_CHECKPOINT,
        scopeType: EVENT_SCOPE_TYPES.USAGE,
        scopeId: usage.usageId,
        sessionId: sent.sessionId,
        turnId: sent.turnId,
        taskId: sent.taskId,
        status: TASK_STATUSES.COMPLETED,
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
            eventType: EVENT_TYPES.SESSION_TITLE_SUMMARY_FAILED,
            scopeType: EVENT_SCOPE_TYPES.SESSION,
            scopeId: turnSessionId,
            sessionId: turnSessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            status: TASK_STATUSES.FAILED,
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
            eventType: EVENT_TYPES.SESSION_TITLE_SUMMARY_SKIPPED,
            scopeType: EVENT_SCOPE_TYPES.SESSION,
            scopeId: session.sessionId,
            sessionId: session.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            projectId: session.projectId,
            status: TASK_STATUSES.COMPLETED,
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
            eventType: EVENT_TYPES.SESSION_UPDATED,
            scopeType: EVENT_SCOPE_TYPES.SESSION,
            scopeId: session.sessionId,
            sessionId: session.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            projectId: session.projectId,
            status: TASK_STATUSES.COMPLETED,
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
            eventType: EVENT_TYPES.SESSION_TITLE_SUMMARY_FAILED,
            scopeType: EVENT_SCOPE_TYPES.SESSION,
            scopeId: session.sessionId,
            sessionId: session.sessionId,
            turnId: sent.turnId,
            taskId: sent.taskId,
            projectId: session.projectId,
            status: TASK_STATUSES.FAILED,
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

