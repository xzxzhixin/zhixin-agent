import {randomUUID} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

import type {AgentRuntimeStatus, EventRecord, ExecutionMode} from "@zhixin/shared";

import {writeAgentMemory} from "./agent-domain.js";
import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {createDataAccess} from "../data-access/index.js";
import {findProject, findSession, createMessageTurnAndTask, isFinalTaskStatus} from "./session-domain.js";
import {listAgents} from "./agent-domain.js";
import type {MemoryQueueState, SubAgentRuntimeRecord} from "../types.js";
import {writeJsonFile} from "../helpers.js";
import type {ProviderModelGatewayResult} from "../model-gateway-runtime.js";
import {formatCenterLocalDateTime} from "../time.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
} from "./turn-graph-domain.js";

export function collectOneSkill(
    centerDirectory: string,
    skillRelativeDirectory: string,
    skillName: string,
    scope: "global" | "project",
    projectId: string | null,
    output: Array<{
        skillName: string;
        scope: "global" | "project";
        projectId: string | null;
        relativePath: string;
        content: string;
    }>,
): void {
    const relativePath = join(skillRelativeDirectory, "SKILL.md");
    const filePath = join(centerDirectory, relativePath);
    if (!existsSync(filePath)) {
        return;
    }
    output.push({
        skillName,
        scope,
        projectId,
        relativePath,
        content: readFileSync(filePath, "utf-8"),
    });
}

export function createTodo(database: CenterDatabase, events: CenterEventStore, title: string, dueAt: string | null): {
    todoId: string
} {
    const todoId = randomUUID();
    createDataAccess(database).workflow.createTodo({
        todoId,
        title,
        dueAt,
        updatedAt: formatCenterLocalDateTime(),
    });
    events.append({
        eventType: "personal.todo.created",
        scopeType: "personal",
        scopeId: todoId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "待办创建",
        summary: title,
        payload: {todoId}
    });
    return {todoId};
}

export function createCalendarEvent(database: CenterDatabase, events: CenterEventStore, title: string, startsAt: string, endsAt: string): {
    eventId: string
} {
    const eventId = randomUUID();
    createDataAccess(database).workflow.createCalendarEvent({
        eventId,
        title,
        startsAt,
        endsAt,
        updatedAt: formatCenterLocalDateTime(),
    });
    events.append({
        eventType: "personal.calendar.created",
        scopeType: "personal",
        scopeId: eventId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "日程创建",
        summary: title,
        payload: {eventId}
    });
    return {eventId};
}

export function createKnowledgeItem(database: CenterDatabase, events: CenterEventStore, title: string, summary: string, sourceRef: string): {
    itemId: string
} {
    const itemId = randomUUID();
    createDataAccess(database).workflow.createKnowledgeItem({
        itemId,
        title,
        summary,
        sourceRef,
        updatedAt: formatCenterLocalDateTime(),
    });
    events.append({
        eventType: "personal.knowledge.created",
        scopeType: "personal",
        scopeId: itemId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "知识条目创建",
        summary,
        payload: {itemId}
    });
    return {itemId};
}

/**
 * createSubAgentRuntime：创建一次性子智能体运行记录。
 *
 * @param events 事件日志仓储。
 * @param subAgents 运行期子智能体表。
 * @param parentAgentId 创建它的长期智能体 ID。
 * @param taskId 所属任务 ID。
 * @param parentProviderId 父级智能体当前实际使用的供应商 ID。
 * @param parentModelId 父级智能体当前实际使用的模型 ID 或模型名称。
 * @param parentReasoningEffort 父级智能体决定传给子智能体的推理深度。
 * @param name 子智能体展示名称。
 * @returns 子智能体运行期身份。
 */
export function createSubAgentRuntime(
    events: CenterEventStore,
    subAgents: Map<string, SubAgentRuntimeRecord>,
    parentAgentId: string,
    taskId: string,
    parentProviderId: string,
    parentModelId: string,
    parentReasoningEffort: string | null,
    name: string,
): {
    subAgentId: string;
    parentAgentId: string;
    taskId: string;
    parentProviderId: string;
    parentModelId: string;
    parentReasoningEffort: string | null;
    persistent: false;
    createdAt: string;
} {
    // subAgentId: 使用运行期前缀，避免和长期智能体 Markdown 定义混淆。
    const subAgentId = `sub-${randomUUID()}`;
    // createdAt: 子智能体只存在于当前任务上下文和事件日志。
    const createdAt = formatCenterLocalDateTime();
    subAgents.set(subAgentId, {
        subAgentId,
        parentAgentId,
        taskId,
        parentProviderId,
        parentModelId,
        parentReasoningEffort,
        name,
        createdAt,
    });
    events.append({
        eventType: "subagent.created",
        scopeType: "agent",
        scopeId: subAgentId,
        sessionId: null,
        turnId: null,
        taskId,
        agentId: parentAgentId,
        status: "running",
        title: "子智能体创建",
        summary: name,
        payload: {
            subAgentId,
            parentAgentId,
            parentProviderId,
            parentModelId,
            parentReasoningEffort,
            persistent: false,
        },
    });

    return {
        subAgentId,
        parentAgentId,
        taskId,
        parentProviderId,
        parentModelId,
        parentReasoningEffort,
        persistent: false,
        createdAt,
    };
}

/**
 * recordAgentCollaborationEvent：记录智能体协作展示事件。
 *
 * @param events 事件日志仓储。
 * @param taskId 所属任务 ID。
 * @param collaborationKind 协作类型，支持管线通话和群聊讨论。
 * @param title 事件标题。
 * @param summary 事件摘要。
 * @returns 已写入事件的展示信息。
 */
export function recordAgentCollaborationEvent(
    events: CenterEventStore,
    taskId: string,
    collaborationKind: "pipeline" | "group-chat",
    title: string,
    summary: string,
): {
    taskId: string;
    collaborationKind: "pipeline" | "group-chat";
    eventType: string;
} {
    // eventType: UI 按固定事件类型展示管线和群聊协作过程。
    const eventType = collaborationKind === "pipeline"
        ? "agent.collaboration.pipeline"
        : "agent.collaboration.group_chat";
    events.append({
        eventType,
        scopeType: "agent-collaboration",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        status: "running",
        title,
        summary,
        payload: {
            collaborationKind,
        },
    });

    return {
        taskId,
        collaborationKind,
        eventType,
    };
}

/**
 * setAgentRuntimeState：保存智能体运行状态并实时广播。
 *
 * @param database 中心服务数据库。
 * @param events 事件日志仓储。
 * @param realtimeClients WebSocket 客户端集合。
 * @param agentId 智能体 ID，来源于中心服务智能体索引。
 * @param status 智能体运行状态，来源于共享协议 AgentRuntimeStatus。
 * @param currentTaskId 当前任务 ID；空值表示智能体没有绑定具体任务。
 * @returns 已保存的智能体运行状态。
 */
export function setAgentRuntimeState(
    database: CenterDatabase,
    events: CenterEventStore,
    realtimeClients: Map<string, RealtimeClientConnection>,
    agentId: string,
    status: AgentRuntimeStatus,
    currentTaskId: string | null,
): {
    agentId: string;
    status: AgentRuntimeStatus;
    currentTaskId: string | null;
    updatedAt: string;
} {
    // updatedAt: 服务端状态更新时间，作为多端展示的事实时间。
    const updatedAt = formatCenterLocalDateTime();
    createDataAccess(database).workflow.upsertAgentRuntimeState({
        agentId,
        status,
        currentTaskId,
        updatedAt,
    });

    const event = events.append({
        eventType: "agent.state.changed",
        scopeType: "agent",
        scopeId: agentId,
        sessionId: null,
        turnId: null,
        taskId: currentTaskId,
        agentId,
        status,
        title: "智能体状态变更",
        summary: `智能体 ${agentId} 状态更新为 ${status}。`,
        payload: {
            agentId,
            status,
            currentTaskId,
            updatedAt,
        },
    });
    broadcastGlobalEvent(realtimeClients, event);

    return {
        agentId,
        status,
        currentTaskId,
        updatedAt,
    };
}

export function saveExecutionMode(centerDirectory: string, clientType: ClientType, executionMode: string): {
    clientType: ClientType;
    executionMode: string
} {
    writeJsonFile(join(centerDirectory, "config", `execution-mode-${clientType}.json`), {
        clientType,
        executionMode,
        updatedAt: formatCenterLocalDateTime(),
    });
    return {clientType, executionMode};
}

export function readExecutionMode(centerDirectory: string, clientType: ClientType): ExecutionMode {
    const filePath = join(centerDirectory, "config", `execution-mode-${clientType}.json`);
    if (!existsSync(filePath)) {
        return "full_auto";
    }

    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as {
        executionMode?: ExecutionMode;
    };
    return parsed.executionMode ?? "full_auto";
}

export function evaluateApprovalPolicy(
    centerDirectory: string,
    clientType: ClientType,
    operationKind: "read" | "write" | "delete" | "command" | "plugin" | "mcp" | "skill",
): {
    clientType: ClientType;
    executionMode: ExecutionMode;
    operationKind: string;
    requiresApproval: boolean;
    reason: string;
} {
    const executionMode = readExecutionMode(centerDirectory, clientType);
    if (executionMode === "suggest") {
        return {
            clientType,
            executionMode,
            operationKind,
            requiresApproval: true,
            reason: "建议模式下所有副作用步骤都需要用户确认。"
        };
    }

    if (executionMode === "auto_edit") {
        const requiresApproval = operationKind === "delete" || operationKind === "command" || operationKind === "plugin" || operationKind === "mcp";
        return {
            clientType,
            executionMode,
            operationKind,
            requiresApproval,
            reason: requiresApproval ? "自动编辑模式下高风险操作需要审批。" : "自动编辑模式允许低风险读写流程自动执行。"
        };
    }

    return {
        clientType,
        executionMode,
        operationKind,
        requiresApproval: false,
        reason: "全自动模式在沙箱和权限范围内自动执行。"
    };
}

export function recordUsage(database: CenterDatabase, events: CenterEventStore, input: {
    providerId?: string;
    model?: string;
    projectId?: string | null;
    sessionId?: string | null;
    turnId?: string | null;
    taskId?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheHitTokens?: number | null;
    cacheMissTokens?: number | null;
    status?: string;
    graphPayload?: Record<string, unknown>;
}): { usageId: string } {
    const usageId = randomUUID();
    createDataAccess(database).usage.insertUsageRecord({
        usageId,
        providerId: input.providerId,
        model: input.model,
        projectId: input.projectId ?? null,
        sessionId: input.sessionId ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        cacheHitTokens: input.cacheHitTokens ?? null,
        cacheMissTokens: input.cacheMissTokens ?? null,
        status: input.status,
        createdAt: formatCenterLocalDateTime(),
    });
    events.append({
        eventType: "usage.recorded",
        scopeType: "usage",
        scopeId: usageId,
        sessionId: input.sessionId ?? null,
        turnId: input.turnId ?? null,
        taskId: input.taskId ?? null,
        status: "completed",
        title: "用量记录",
        summary: input.model ?? "",
        payload: {
            usageId,
            ...(input.graphPayload ?? {}),
        },
    });
    return {usageId};
}

export function markWorkerTaskFailed(database: CenterDatabase, events: CenterEventStore, taskId: string, reason: string): {
    taskId: string;
    status: string
} {
    const now = formatCenterLocalDateTime();
    createDataAccess(database).sessions.updateTaskStatus(
        taskId,
        "failed",
        now,
    );
    events.append({
        eventType: "task.failed",
        scopeType: "task",
        scopeId: taskId || null,
        sessionId: null,
        turnId: null,
        taskId: taskId || null,
        status: "failed",
        title: "Worker 任务失败",
        summary: reason,
        payload: {taskId, reason}
    });
    return {taskId, status: "failed"};
}

export function startWorkerTask(database: CenterDatabase, events: CenterEventStore, taskId: string): {
    taskId: string;
    status: string;
    heartbeatAt: string
} {
    const now = formatCenterLocalDateTime();
    createDataAccess(database).sessions.updateTaskStatus(
        taskId,
        "running",
        now,
    );
    events.append({
        eventType: "worker.started",
        scopeType: "worker",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        status: "running",
        title: "Worker 启动",
        summary: "中心服务已为任务启动 Worker 生命周期。",
        payload: {taskId, heartbeatAt: now}
    });
    events.append({
        eventType: "task.updated",
        scopeType: "task",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        status: "running",
        title: "任务运行中",
        summary: "Worker 已接管任务。",
        payload: {taskId, status: "running"}
    });
    return {taskId, status: "running", heartbeatAt: now};
}

export function cancelWorkerTask(database: CenterDatabase, events: CenterEventStore, taskId: string, reason: string): {
    taskId: string;
    status: string
} {
    const now = formatCenterLocalDateTime();
    createDataAccess(database).sessions.updateTaskStatus(
        taskId,
        "cancelled",
        now,
    );
    events.append({
        eventType: "worker.cancelled",
        scopeType: "worker",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        status: "cancelled",
        title: "Worker 取消",
        summary: reason,
        payload: {taskId, reason}
    });
    return {taskId, status: "cancelled"};
}

export function buildWorkerContext(database: CenterDatabase, taskId: string): {
    task: unknown;
    session: unknown;
    project: unknown;
    agents: unknown[];
    memoryIndex: unknown[];
    permissions: string[];
} {
    const task = createDataAccess(database).workflow.findTaskContext(taskId);
    const session = task ? findSession(database, task.sessionId) : null;
    const project = session?.projectId ? findProject(database, session.projectId) : null;
    return {
        task: task ?? null,
        session,
        project,
        agents: listAgents(database),
        memoryIndex: createDataAccess(database).workflow.listMemoryIndex(),
        permissions: [
            "file.read",
            "file.write",
            "command.run",
            "mcp.call",
            "skill.use",
            "memory.write",
        ],
    };
}

/**
 * runTurnEngine：执行一轮最小 Agent 编排闭环。
 *
 * @param database 中心服务数据库。
 * @param events 事件日志仓储。
 * @param centerDirectory 中心目录。
 * @param memoryQueues 智能体记忆单写队列。
 * @param sessionId 会话 ID。
 * @param userText 用户输入文本。
 * @returns 执行引擎各分层产物身份。
 */
export function runTurnEngine(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    memoryQueues: Map<string, MemoryQueueState>,
    sessionId: string,
    userText: string,
): {
    turnId: string;
    taskId: string;
    agentId: string;
    contextKeys: string[];
    modelEventType: string;
    toolPlanId: string;
    collaborationEventTypes: string[];
    memoryRelativePath: string;
    usageId: string;
} {
    // sent: 复用会话消息发送事实源，保证轮次、任务和事件一致。
    const session = findSession(database, sessionId);
    if (!session) {
        throw new Error("执行引擎无法找到会话");
    }

    const sent = createMessageTurnAndTask(database, events, session, userText);
    // context: context-builder 分层产物，后续执行只消费中心服务返回上下文。
    const context = buildWorkerContext(database, sent.taskId);
    // agentId: agent-router 当前最小策略选择主智能体，后续可替换为多智能体路由。
    const agentId = routeAgentForTurn(context);
    // modelEventType: model-orchestrator 只写内部编排事件，不直连供应商。
    const modelEventType = orchestrateModelCall(events, sent.taskId, agentId, userText);
    // toolPlanId: tool-planner 生成审计可见的工具计划。
    const toolPlanId = planToolCalls(events, sent.taskId, agentId);
    // collaborationEventTypes: collaboration-engine 记录管线通话和群聊讨论事件。
    const collaborationEventTypes = [
        recordAgentCollaborationEvent(events, sent.taskId, "pipeline", "管线协作", "主智能体把阶段结论传给执行步骤。").eventType,
        recordAgentCollaborationEvent(events, sent.taskId, "group-chat", "群聊讨论", "多个智能体协作讨论形成结论。").eventType,
    ];
    // memory: memory-committer 在轮次结束后按单写队列追加主智能体记忆。
    const memory = writeAgentMemory(database, events, centerDirectory, memoryQueues, {
        agentId,
        keywords: "执行引擎",
        summary: "轮次执行编排完成",
        userText,
        assistantText: "执行引擎已完成最小编排闭环。",
        sourceSessionId: sessionId,
        sourceTurnId: sent.turnId,
    });
    // usageId: usage-collector 写入一条模型用量原始记录。
    const usage = recordUsage(database, events, {
        providerId: "engine-internal",
        model: "engine-orchestrator",
        projectId: null,
        sessionId,
        inputTokens: userText.length,
        outputTokens: 1,
        cacheHitTokens: null,
        cacheMissTokens: null,
        status: "completed",
    });

    handleWorkerMessage(database, events, "task.complete", sent.taskId, {
        agentId,
        toolPlanId,
    });

    return {
        turnId: sent.turnId,
        taskId: sent.taskId,
        agentId,
        contextKeys: Object.keys(context),
        modelEventType,
        toolPlanId,
        collaborationEventTypes,
        memoryRelativePath: memory.relativePath,
        usageId: usage.usageId,
    };
}

/**
 * routeAgentForTurn：选择当前轮次执行智能体。
 *
 * @param context context-builder 产物。
 * @returns 智能体 ID。
 */
export function routeAgentForTurn(context: {
    agents: unknown[];
}): string {
    // mainAgent: 当前最小路由策略优先选择系统内置主智能体。
    const mainAgent = context.agents.find((agent) => {
        return typeof agent === "object"
            && agent !== null
            && "agentId" in agent
            && (agent as { agentId?: string }).agentId === "main";
    });
    return mainAgent ? "main" : "main";
}

/**
 * orchestrateModelCall：记录模型编排事件。
 *
 * @param events 事件日志仓储。
 * @param taskId 任务 ID。
 * @param agentId 智能体 ID。
 * @param userText 用户输入。
 * @returns 模型编排事件类型。
 */
export function orchestrateModelCall(events: CenterEventStore, taskId: string, agentId: string, userText: string): string {
    const eventType = "model.orchestrated";
    events.append({
        eventType,
        scopeType: "model",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        agentId,
        status: "completed",
        title: "模型编排",
        summary: "已按内部模型协议准备模型调用。",
        payload: {
            requestSummary: userText.slice(0, 120),
        },
    });
    return eventType;
}

export function appendThinkingEvents(
    events: CenterEventStore,
    database: CenterDatabase,
    sessionId: string,
    taskId: string,
    turnId: string,
    userText: string,
    graphCheckpoint?: TurnGraphCheckpoint,
): void {
    // 保留函数边界给后续供应商公开 reasoning/thinking 摘要接入；当前没有真实公开思考时不写 thinking.* 事件。
    void events;
    void database;
    void sessionId;
    void taskId;
    void turnId;
    void userText;
    void graphCheckpoint;
}

export function appendModelStreamEvent(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    result: ProviderModelGatewayResult,
    graphCheckpoint?: TurnGraphCheckpoint,
): void {
    events.append({
        eventType: "model.stream.delta",
        scopeType: "model",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "running",
        title: "模型流式片段",
        summary: result.assistantText.slice(0, 120),
        payload: withOptionalGraphCheckpoint({
            providerId: result.providerId,
            model: result.model,
            reasoningEffort: result.reasoningEffort,
            deltaText: result.assistantText,
        }, graphCheckpoint),
    });
    events.append({
        eventType: "model.stream.completed",
        scopeType: "model",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "completed",
        title: "模型流式结束",
        summary: "模型流式输出已结束。",
        payload: withOptionalGraphCheckpoint({
            providerId: result.providerId,
            model: result.model,
            usage: result.usage,
        }, graphCheckpoint),
    });
}

/**
 * planToolCalls：生成工具调用计划事件。
 *
 * @param events 事件日志仓储。
 * @param taskId 任务 ID。
 * @param agentId 智能体 ID。
 * @returns 工具计划 ID。
 */
export function planToolCalls(events: CenterEventStore, taskId: string, agentId: string): string {
    const toolPlanId = `tool-plan-${randomUUID()}`;
    events.append({
        eventType: "tool.plan.created",
        scopeType: "tool-plan",
        scopeId: toolPlanId,
        sessionId: null,
        turnId: null,
        taskId,
        agentId,
        status: "completed",
        title: "工具计划",
        summary: "已生成需要审批策略评估的工具调用计划。",
        payload: {
            toolPlanId,
            requiredPermissions: [
                "file.read",
                "mcp.call",
                "skill.use",
            ],
        },
    });
    return toolPlanId;
}

/**
 * handleWorkerMessage：处理 Worker 回传的任务状态消息。
 *
 * @param database 中心服务数据库。
 * @param events 事件日志仓储。
 * @param type Worker 消息类型。
 * @param taskId 任务 ID，空值表示只记录 Worker 消息。
 * @param payload Worker 消息载荷。
 * @returns Worker 消息接收结果。
 */
export function handleWorkerMessage(
    database: CenterDatabase,
    events: CenterEventStore,
    type: string,
    taskId: string | null,
    payload: unknown,
): {
    type: string;
    accepted: boolean;
} {
    if (type === "task.complete" && taskId) {
        const task = createDataAccess(database).sessions.findTask(taskId);
        // 任务已经被停止或失败时，后台图后续完成消息不能覆盖终态。
        if (task && !isFinalTaskStatus(task.status)) {
            createDataAccess(database).sessions.updateTaskStatus(
                taskId,
                "completed",
                formatCenterLocalDateTime(),
            );
        }
    }

    if (type === "task.failed" && taskId) {
        const task = createDataAccess(database).sessions.findTask(taskId);
        // 任务已经被停止或完成时，不允许迟到失败消息覆盖事实终态。
        if (task && !isFinalTaskStatus(task.status)) {
            createDataAccess(database).sessions.updateTaskStatus(
                taskId,
                "failed",
                formatCenterLocalDateTime(),
            );
        }
    }

    events.append({
        eventType: `worker.${type}`,
        scopeType: "worker",
        scopeId: taskId,
        sessionId: null,
        turnId: null,
        taskId,
        status: "completed",
        title: "Worker 消息",
        summary: type,
        payload,
    });

    return {
        type,
        accepted: true,
    };
}

export function queryAuditEvents(database: CenterDatabase, eventType: string | null): EventRecord[] {
    const rows = createDataAccess(database).sessions.listAuditEvents(eventType);
    return (rows as Array<{
        eventId: string;
        eventType: string;
        turnId: string | null;
        taskId: string | null;
        sequence: number;
        occurredAt: string;
        summary: string;
        payloadJson: string;
        traceId: string
    }>).map((row) => ({
        eventId: row.eventId,
        eventType: row.eventType,
        turnId: row.turnId,
        taskId: row.taskId,
        sequence: row.sequence,
        occurredAt: row.occurredAt,
        summary: row.summary,
        payload: JSON.parse(row.payloadJson),
        traceId: row.traceId
    }));
}

