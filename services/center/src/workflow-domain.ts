import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {existsSync, readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

import type {ModelRequest, ModelUsage} from "@zhixin/model-protocol";
import type {AgentRuntimeStatus, ClientType, EventRecord, ExecutionMode} from "@zhixin/shared";

import {
    readProviderConfig,
    readSecretValue,
    resolveProviderModelSelection,
} from "./provider-domain.js";
import {writeAgentMemory} from "./agent-domain.js";
import {broadcastGlobalEvent} from "./realtime.js";
import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import {findProject, findSession, createMessageTurnAndTask} from "./session-domain.js";
import {listAgents} from "./agent-domain.js";
import type {MemoryQueueState, RealtimeClientConnection, SubAgentRuntimeRecord} from "./types.js";
import {writeJsonFile} from "./helpers.js";

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
    database.connection().prepare("INSERT INTO todos (id, title, completed, due_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(todoId, title, 0, dueAt, new Date().toISOString());
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
    database.connection().prepare("INSERT INTO calendar_events (id, title, starts_at, ends_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(eventId, title, startsAt, endsAt, new Date().toISOString());
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
    database.connection().prepare("INSERT INTO knowledge_items (id, title, summary, source_ref, updated_at) VALUES (?, ?, ?, ?, ?)").run(itemId, title, summary, sourceRef, new Date().toISOString());
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

export function createNotification(database: CenterDatabase, events: CenterEventStore, realtimeClients: Map<string, RealtimeClientConnection>, targetClientType: ClientType, title: string, summary: string, requiresUserAction: boolean): {
    notificationId: string
} {
    const notificationId = randomUUID();
    database.connection().prepare("INSERT INTO notifications (id, target_client_type, session_id, project_id, title, summary, created_at, requires_user_action) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)").run(notificationId, targetClientType, title, summary, new Date().toISOString(), requiresUserAction ? 1 : 0);
    const event = events.append({
        eventType: "notification.created",
        scopeType: "notification",
        scopeId: notificationId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title,
        summary,
        payload: {notificationId, targetClientType}
    });
    broadcastGlobalEvent(realtimeClients, event);
    return {notificationId};
}

/**
 * createSubAgentRuntime：创建一次性子智能体运行记录。
 *
 * @param events 事件日志仓储。
 * @param subAgents 运行期子智能体表。
 * @param parentAgentId 创建它的长期智能体 ID。
 * @param taskId 所属任务 ID。
 * @param name 子智能体展示名称。
 * @returns 子智能体运行期身份。
 */
export function createSubAgentRuntime(
    events: CenterEventStore,
    subAgents: Map<string, SubAgentRuntimeRecord>,
    parentAgentId: string,
    taskId: string,
    name: string,
): {
    subAgentId: string;
    parentAgentId: string;
    taskId: string;
    persistent: false;
    createdAt: string;
} {
    // subAgentId: 使用运行期前缀，避免和长期智能体 Markdown 定义混淆。
    const subAgentId = `sub-${randomUUID()}`;
    // createdAt: 子智能体只存在于当前任务上下文和事件日志。
    const createdAt = new Date().toISOString();
    subAgents.set(subAgentId, {
        subAgentId,
        parentAgentId,
        taskId,
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
            persistent: false,
        },
    });

    return {
        subAgentId,
        parentAgentId,
        taskId,
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
    const updatedAt = new Date().toISOString();
    database.connection()
        .prepare(`
            INSERT INTO agent_runtime_states (agent_id,
                                              status,
                                              current_task_id,
                                              updated_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(agent_id) DO
            UPDATE SET
                status = excluded.status,
                current_task_id = excluded.current_task_id,
                updated_at = excluded.updated_at
        `)
        .run(
            agentId,
            status,
            currentTaskId,
            updatedAt,
        );

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
        updatedAt: new Date().toISOString(),
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
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheHitTokens?: number | null;
    cacheMissTokens?: number | null;
    status?: string
}): { usageId: string } {
    const usageId = randomUUID();
    database.connection().prepare("INSERT INTO usage_records (id, provider_id, model, project_id, session_id, input_tokens, output_tokens, cache_hit_tokens, cache_miss_tokens, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(usageId, input.providerId, input.model, input.projectId ?? null, input.sessionId ?? null, input.inputTokens ?? null, input.outputTokens ?? null, input.cacheHitTokens ?? null, input.cacheMissTokens ?? null, input.status, new Date().toISOString());
    events.append({
        eventType: "usage.recorded",
        scopeType: "usage",
        scopeId: usageId,
        sessionId: input.sessionId ?? null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "用量记录",
        summary: input.model ?? "",
        payload: {usageId}
    });
    return {usageId};
}

export function markWorkerTaskFailed(database: CenterDatabase, events: CenterEventStore, taskId: string, reason: string): {
    taskId: string;
    status: string
} {
    const now = new Date().toISOString();
    database.connection().prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run("failed", now, taskId);
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
    const now = new Date().toISOString();
    database.connection().prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run("running", now, taskId);
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
    const now = new Date().toISOString();
    database.connection().prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run("cancelled", now, taskId);
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
    const task = database.connection().prepare("SELECT id AS taskId, session_id AS sessionId, status, title FROM tasks WHERE id = ?").get(taskId) as {
        sessionId: string
    } | undefined;
    const session = task ? findSession(database, task.sessionId) : null;
    const project = session?.projectId ? findProject(database, session.projectId) : null;
    return {
        task: task ?? null,
        session,
        project,
        agents: listAgents(database),
        memoryIndex: database.connection().prepare("SELECT agent_id AS agentId, keywords, summary, memory_path AS memoryPath FROM memory_index ORDER BY created_at DESC").all(),
        permissions: [
            "file.read",
            "file.write",
            "command.run",
            "plugin.call",
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

export interface ProviderModelGatewayResult {
    providerId: string;
    model: string;
    reasoningEffort: string | null;
    assistantText: string;
    usage: {
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
        cacheHitTokens: number | null;
        cacheMissTokens: number | null;
        rawUsage: unknown;
    } | null;
}

/**
 * ProviderModelGatewayHttpResult：模型网关 HTTP 返回结果。
 *
 * 来源：中心服务向供应商发起的真实 HTTP 调用。
 * 含义：把供应商响应文本和用量从原始 JSON 中解析出来。
 * 格式：助手文本 + 可空用量。
 * 默认值：供应商未返回 usage 时 usage 为 null。
 * 约束：不保存 API Key 或其他敏感请求头。
 */
interface ProviderModelGatewayHttpResult {
    /** assistantText: 供应商返回的助手正文。 */
    assistantText: string;
    /** usage: 供应商返回的真实用量；未提供时为 null。 */
    usage: ProviderModelGatewayResult["usage"];
}

export function appendModelStreamEvent(events: CenterEventStore, taskId: string, turnId: string, result: ProviderModelGatewayResult): void {
    events.append({
        eventType: "model.stream.delta",
        scopeType: "model",
        scopeId: taskId,
        sessionId: null,
        turnId,
        taskId,
        status: "running",
        title: "模型流式片段",
        summary: result.assistantText.slice(0, 120),
        payload: {
            providerId: result.providerId,
            model: result.model,
            reasoningEffort: result.reasoningEffort,
            deltaText: result.assistantText,
        },
    });
    events.append({
        eventType: "model.stream.completed",
        scopeType: "model",
        scopeId: taskId,
        sessionId: null,
        turnId,
        taskId,
        status: "completed",
        title: "模型流式结束",
        summary: "模型流式输出已结束。",
        payload: {
            providerId: result.providerId,
            model: result.model,
            usage: result.usage,
        },
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
                "plugin.call",
                "mcp.call",
            ],
        },
    });
    return toolPlanId;
}

/**
 * invokeProviderModelGateway：基于中心服务供应商配置执行最小模型调用。
 *
 * @param database 中心服务数据库。
 * @param events 事件日志仓储。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param userText 用户输入。
 * @returns 模型网关执行结果。
 */
export function invokeProviderModelGateway(
    database: CenterDatabase,
    events: CenterEventStore,
    taskId: string,
    turnId: string,
    userText: string,
): ProviderModelGatewayResult {
    const provider = readProviderConfigByPriority(database, taskId);
    if (!provider) {
        throw new Error("PROVIDER_NOT_AVAILABLE");
    }

    const centerDirectory = extractCenterDirectory(database);
    const modelSelection = resolveProviderModelSelection(
        centerDirectory,
        provider.providerId,
        provider.defaultModel,
    );
    const requestPayload = buildModelRequestPayload(userText, modelSelection.model, modelSelection.reasoningEffort);
    const gatewayRequest = provider.protocolPluginId === "builtin-model-anthropic-messages"
        ? buildAnthropicGatewayRequest(requestPayload)
        : buildOpenAiGatewayRequest(requestPayload, provider.protocolMode);
    const apiKey = readSecretValue(
        centerDirectory,
        provider.apiKeySecretRef,
    );
    const httpResult = sendModelRequest(
        provider.baseUrl,
        gatewayRequest.endpoint,
        gatewayRequest.body,
        apiKey,
        provider.protocolMode,
    );
    const result: ProviderModelGatewayResult = {
        providerId: provider.providerId,
        model: modelSelection.model,
        reasoningEffort: modelSelection.reasoningEffort,
        assistantText: httpResult.assistantText,
        usage: httpResult.usage ?? buildUsageSummary(userText, httpResult.assistantText, provider.protocolPluginId),
    };

    events.append({
        eventType: "model.orchestrated",
        scopeType: "model",
        scopeId: taskId,
        sessionId: null,
        turnId,
        taskId,
        status: "completed",
        title: "模型编排",
        summary: "中心服务已准备模型网关调用。",
        payload: {
            providerId: result.providerId,
            model: result.model,
            assistantTextPreview: result.assistantText.slice(0, 120),
        },
    });

    return result;
}

function extractCenterDirectory(database: CenterDatabase): string {
    const row = database.connection()
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("centerDirectory") as { value?: string } | undefined;
    return row?.value ?? "";
}

function readProviderConfigByPriority(database: CenterDatabase, taskId: string): {
    providerId: string;
    protocolPluginId: string;
    protocolMode: string;
    baseUrl: string;
    defaultModel: string;
    apiKeySecretRef: string | null;
} | null {
    const centerDirectory = extractCenterDirectory(database);
    if (!centerDirectory) {
        return null;
    }
    void taskId;
    const providersDirectory = join(centerDirectory, "providers");
    if (!existsSync(providersDirectory)) {
        return null;
    }
    const providerFiles = readdirSync(providersDirectory)
        .filter((fileName) => {
            return fileName.endsWith(".json")
                && !fileName.endsWith(".models.json")
                && !fileName.endsWith(".patch.json");
        })
        .sort();
    for (const fileName of providerFiles) {
        const providerId = fileName.replace(/\.json$/u, "");
        const provider = readProviderConfig(centerDirectory, providerId);
        if (provider?.enabled) {
            return provider;
        }
    }

    return null;
}

function buildModelRequestPayload(userText: string, model: string, reasoningEffort: string | null): ModelRequest {
    return {
        requestId: randomUUID(),
        providerId: "",
        model,
        reasoningEffort,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: userText,
                    },
                ],
            },
        ],
        tools: [],
        stream: true,
    };
}

function buildOpenAiGatewayRequest(request: ModelRequest, protocolMode: string): {
    endpoint: "/v1/responses" | "/v1/chat/completions";
    body: Record<string, unknown>;
} {
    return protocolMode === "responses"
        ? {
            endpoint: "/v1/responses",
            body: {
                model: request.model,
                input: request.messages.map(toProviderMessage),
                stream: false,
            },
        }
        : {
            endpoint: "/v1/chat/completions",
            body: {
                model: request.model,
                messages: request.messages.map(toChatCompletionMessage),
                stream: false,
            },
        };
}

function buildAnthropicGatewayRequest(request: ModelRequest): {
    endpoint: "/v1/messages";
    body: Record<string, unknown>;
} {
    return {
        endpoint: "/v1/messages",
        body: {
            model: request.model,
            messages: request.messages.map(toProviderMessage),
            stream: false,
        },
    };
}

function sendModelRequest(
    baseUrl: string,
    endpoint: string,
    body: Record<string, unknown>,
    apiKey: string | null,
    protocolMode: string,
): ProviderModelGatewayHttpResult {
    const response = executeFetchSync(joinProviderEndpoint(baseUrl, endpoint), {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(apiKey
                ? {
                    authorization: `Bearer ${apiKey}`,
                }
                : {}),
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`PROVIDER_RESPONSE_${response.status}`);
    }

    return parseProviderModelResponse(
        response.body,
        protocolMode,
    );
}

/**
 * joinProviderEndpoint：拼接供应商 baseUrl 和接口路径。
 *
 * @param baseUrl 用户保存的供应商基础地址。
 * @param endpoint 协议插件给出的接口路径。
 * @returns 完整请求地址。
 */
function joinProviderEndpoint(
    baseUrl: string,
    endpoint: string,
): string {
    const normalizedBaseUrl = baseUrl.replace(/\/$/u, "");
    if (normalizedBaseUrl.endsWith("/v1") && endpoint.startsWith("/v1/")) {
        return `${normalizedBaseUrl}${endpoint.slice(3)}`;
    }
    return `${normalizedBaseUrl}${endpoint}`;
}

/**
 * executeFetchSync：用同步子进程执行 Node fetch，保持当前中心服务发送流程仍为同步闭环。
 *
 * @param url 供应商完整接口地址。
 * @param requestInit fetch 请求参数。
 * @returns HTTP 状态和响应文本。
 */
function executeFetchSync(
    url: string,
    requestInit: {
        method: string;
        headers: Record<string, string>;
        body: string;
    },
): {
    ok: boolean;
    status: number;
    body: string;
} {
    // script: 当前代码运行在 CommonJS/tsx 环境中；用 node -e 保持同步调用，避免扩大 API 路由异步改造范围。
    const script = [
        "const input = JSON.parse(process.argv[1]);",
        "(async () => {",
        "const response = await fetch(input.url, input.init);",
        "const body = await response.text();",
        "process.stdout.write(JSON.stringify({status: response.status, ok: response.ok, body}));",
        "})().catch((error) => {",
        "process.stdout.write(JSON.stringify({status: 0, ok: false, body: error && error.message ? error.message : 'FETCH_FAILED'}));",
        "process.exitCode = 1;",
        "});",
    ].join("");
    const output = spawnSync(
        process.execPath,
        [
            "-e",
            script,
            JSON.stringify({
                url,
                init: requestInit,
            }),
        ],
        {
            encoding: "utf-8",
            windowsHide: true,
        },
    );
    const parsed = JSON.parse(output.stdout || "{\"status\":0,\"ok\":false,\"body\":\"FETCH_OUTPUT_EMPTY\"}") as {
        ok: boolean;
        status: number;
        body: string;
    };
    if (output.status !== 0 && parsed.status === 0) {
        throw new Error(`PROVIDER_CONNECT_FAILED:${parsed.body}`);
    }
    return parsed;
}

/**
 * parseProviderModelResponse：从供应商原始 JSON 中解析助手文本和用量。
 *
 * @param body 供应商响应文本。
 * @param protocolMode 供应商协议模式。
 * @returns 统一助手文本和用量。
 */
function parseProviderModelResponse(
    body: string,
    protocolMode: string,
): ProviderModelGatewayHttpResult {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const assistantText = protocolMode === "responses"
        ? readResponsesText(parsed)
        : readChatCompletionText(parsed);
    if (!assistantText) {
        throw new Error("PROVIDER_RESPONSE_TEXT_EMPTY");
    }

    return {
        assistantText,
        usage: normalizeProviderUsage(parsed.usage),
    };
}

/**
 * readResponsesText：读取 Responses API 文本。
 *
 * @param parsed 供应商响应 JSON。
 * @returns 助手正文；无法解析时返回空字符串。
 */
function readResponsesText(parsed: Record<string, unknown>): string {
    if (typeof parsed.output_text === "string") {
        return parsed.output_text;
    }
    const output = Array.isArray(parsed.output)
        ? parsed.output
        : [];
    const textParts: string[] = [];
    for (const item of output) {
        if (typeof item !== "object" || item === null) {
            continue;
        }
        const content = Array.isArray((item as { content?: unknown }).content)
            ? (item as { content: unknown[] }).content
            : [];
        for (const contentItem of content) {
            if (typeof contentItem !== "object" || contentItem === null) {
                continue;
            }
            const text = (contentItem as { text?: unknown }).text;
            if (typeof text === "string") {
                textParts.push(text);
            }
        }
    }
    return textParts.join("");
}

/**
 * readChatCompletionText：读取 Chat Completions 或 Messages API 文本。
 *
 * @param parsed 供应商响应 JSON。
 * @returns 助手正文；无法解析时返回空字符串。
 */
function readChatCompletionText(parsed: Record<string, unknown>): string {
    const choices = Array.isArray(parsed.choices)
        ? parsed.choices
        : [];
    const firstChoice = choices[0];
    if (typeof firstChoice === "object" && firstChoice !== null) {
        const message = (firstChoice as { message?: unknown }).message;
        if (typeof message === "object" && message !== null) {
            const content = (message as { content?: unknown }).content;
            if (typeof content === "string") {
                return content;
            }
        }
    }
    const content = Array.isArray(parsed.content)
        ? parsed.content
        : [];
    const textParts = content.map((item) => {
        if (typeof item !== "object" || item === null) {
            return "";
        }
        const text = (item as { text?: unknown }).text;
        return typeof text === "string"
            ? text
            : "";
    });
    return textParts.join("");
}

/**
 * normalizeProviderUsage：把供应商 usage 转换为内部用量。
 *
 * @param rawUsage 供应商原始 usage 字段。
 * @returns 内部用量；未提供时返回 null。
 */
function normalizeProviderUsage(rawUsage: unknown): ProviderModelGatewayResult["usage"] {
    if (typeof rawUsage !== "object" || rawUsage === null) {
        return null;
    }
    const usage = rawUsage as Record<string, unknown>;
    const inputTokens = readNumberField(
        usage,
        [
            "input_tokens",
            "prompt_tokens",
        ],
    );
    const outputTokens = readNumberField(
        usage,
        [
            "output_tokens",
            "completion_tokens",
        ],
    );
    const totalTokens = readNumberField(
        usage,
        [
            "total_tokens",
        ],
    );
    const cacheHitTokens = readNestedNumberField(
        usage,
        "prompt_tokens_details",
        "cached_tokens",
    ) ?? readNumberField(
        usage,
        [
            "cache_hit_tokens",
        ],
    );

    return {
        inputTokens,
        outputTokens,
        totalTokens,
        cacheHitTokens,
        cacheMissTokens: null,
        rawUsage,
    };
}

/**
 * readNumberField：按固定字段名读取数字。
 *
 * @param source 原始对象。
 * @param keys 字段名列表。
 * @returns 第一个数字字段；不存在时为 null。
 */
function readNumberField(
    source: Record<string, unknown>,
    keys: string[],
): number | null {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "number") {
            return value;
        }
    }
    return null;
}

/**
 * readNestedNumberField：读取嵌套数字字段。
 *
 * @param source 原始对象。
 * @param objectKey 嵌套对象字段名。
 * @param valueKey 数字字段名。
 * @returns 数字或 null。
 */
function readNestedNumberField(
    source: Record<string, unknown>,
    objectKey: string,
    valueKey: string,
): number | null {
    const objectValue = source[objectKey];
    if (typeof objectValue !== "object" || objectValue === null) {
        return null;
    }
    const value = (objectValue as Record<string, unknown>)[valueKey];
    return typeof value === "number"
        ? value
        : null;
}

/**
 * toProviderMessage：把内部模型消息转换为当前最小供应商消息结构。
 *
 * @param message 内部模型消息。
 * @returns 供应商消息对象。
 */
function toProviderMessage(message: ModelRequest["messages"][number]): Record<string, unknown> {
    return {
        role: message.role,
        content: message.content.map((part) => {
            if (part.type === "text") {
                return {
                    type: "text",
                    text: part.text,
                };
            }
            if (part.type === "image") {
                return {
                    type: "image_url",
                    image_url: {
                        url: part.attachmentId,
                    },
                };
            }
            return {
                type: "text",
                text: part.resultText,
            };
        }),
    };
}

/**
 * toChatCompletionMessage：转换为 Chat Completions 常见消息结构。
 *
 * @param message 内部模型消息。
 * @returns Chat Completions 消息对象。
 */
function toChatCompletionMessage(message: ModelRequest["messages"][number]): Record<string, unknown> {
    const textContent = message.content.map((part) => {
        if (part.type === "text") {
            return part.text;
        }
        if (part.type === "image") {
            return `[图片附件:${part.attachmentId}]`;
        }
        return part.resultText;
    }).join("\n");
    return {
        role: message.role,
        content: textContent,
    };
}

function buildUsageSummary(userText: string, assistantText: string, providerId: string): ModelUsage {
    return {
        inputTokens: userText.length,
        outputTokens: assistantText.length,
        totalTokens: userText.length + assistantText.length,
        cacheHitTokens: null,
        cacheMissTokens: null,
        rawUsage: {
            providerId,
            inputTextLength: userText.length,
            outputTextLength: assistantText.length,
        },
    };
}

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
        database.connection()
            .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
            .run(
                "completed",
                new Date().toISOString(),
                taskId,
            );
    }

    if (type === "task.failed" && taskId) {
        database.connection()
            .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
            .run(
                "failed",
                new Date().toISOString(),
                taskId,
            );
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
    const rows = eventType
        ? database.connection().prepare("SELECT id AS eventId, event_type AS eventType, turn_id AS turnId, task_id AS taskId, sequence, occurred_at AS occurredAt, summary, payload_json AS payloadJson, trace_id AS traceId FROM events WHERE event_type = ? ORDER BY occurred_at ASC").all(eventType)
        : database.connection().prepare("SELECT id AS eventId, event_type AS eventType, turn_id AS turnId, task_id AS taskId, sequence, occurred_at AS occurredAt, summary, payload_json AS payloadJson, trace_id AS traceId FROM events ORDER BY occurred_at ASC").all();
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

