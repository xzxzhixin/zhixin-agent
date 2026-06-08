import type {
    AgentStatusTreeNode,
} from "@stores/app";
import type {
    ConversationMessage,
    ConversationSession,
    ConversationTurn,
    EventRecord,
    ProjectRecord,
    TaskStatus,
    TurnGraphCheckpoint,
} from "@zhixin/shared";
import {
    CircleCheck,
    CircleClose,
    Clock,
    Loading,
    Warning,
} from "@element-plus/icons-vue";

/**
 * NavigationStatusMeta：左侧导航状态图标元信息。
 */
export interface NavigationStatusMeta {
    /** icon: Element Plus 图标组件。 */
    icon: unknown;
    /** title: 鼠标悬停状态说明。 */
    title: string;
    /** tone: CSS 状态色名称。 */
    tone: string;
}

/**
 * formatConnectionState：把连接状态协议值转成中文。
 *
 * @param state 当前连接状态。
 * @returns 中文状态。
 */
export function formatConnectionState(state: string): string {
    const labels: Record<string, string> = {
        connecting: "连接中",
        open: "已连接",
        retrying: "重连中",
        stopped: "已停止",
    };

    return labels[state] ?? "未知状态";
}

/**
 * AgentStatusTreeRow：智能体状态树扁平展示行。
 */
export interface AgentStatusTreeRow {
    /** node: 智能体树节点。 */
    node: AgentStatusTreeNode;
    /** level: 当前节点层级，根节点为 0。 */
    level: number;
}

/**
 * flattenAgentTreeRows：把子智能体树转换为渲染行。
 *
 * @param nodes 当前层级节点数组。
 * @param level 当前层级，根节点为 0。
 * @returns 带层级信息的渲染行。
 */
export function flattenAgentTreeRows(
    nodes: AgentStatusTreeNode[],
    level: number,
): AgentStatusTreeRow[] {
    return nodes.flatMap((node) => {
        return [
            {
                node,
                level,
            },
            ...flattenAgentTreeRows(
                node.children,
                level + 1,
            ),
        ];
    });
}

/**
 * ProcessEventStatus：过程事件在浏览器端展示用的阶段状态。
 */
export type ProcessEventStatus =
    | "running"
    | "completed"
    | "failed"
    | "unknown";

/**
 * ProcessEventStatusMeta：过程事件状态推导结果。
 */
export interface ProcessEventStatusMeta {
    /** status: 归一化阶段状态，来源于事件类型和载荷内明确字段。 */
    status: ProcessEventStatus;
    /** label: 阶段状态中文文案。 */
    label: string;
}

/**
 * ProcessMessageRow：对话事件流过程消息。
 */
export interface ProcessMessageRow {
    /** rowId: 过程行唯一 ID。 */
    rowId: string;
    /** kind: 过程类型。 */
    kind:
        | "thinking"
        | "tool";
    /** event: 原始事件记录。 */
    event: EventRecord;
    /** title: 展示标题。 */
    title: string;
    /** summary: 展示摘要。 */
    summary: string;
    /** statusLabel: 由事件类型推导出的阶段状态中文文案。 */
    statusLabel: string;
}

/**
 * ProcessMessageGroupRow：同一过程聚合后的过程卡片。
 */
export interface ProcessMessageGroupRow {
    /** rowId: 过程卡片唯一 ID。 */
    rowId: string;
    /** turnId: 所属轮次 ID，来自中心服务事件；无轮次时为 null。 */
    turnId: string | null;
    /** taskId: 所属任务 ID，来自中心服务事件；无任务时为 null。 */
    taskId: string | null;
    /** kind: 渲染行大类，当前过程卡片统一归为工具过程。 */
    kind: "tool";
    /** processKind: 过程细分类型，来源于事件类型或 payload.toolKind，用于区分命令、MCP、插件、skill 和普通工具。 */
    processKind:
        | "command"
        | "mcp"
        | "plugin"
        | "skill"
        | "tool";
    /** title: 展示标题。 */
    title: string;
    /** statusLabel: 当前聚合过程状态。 */
    statusLabel: string;
    /** defaultOpen: 是否默认展开；运行中展开，完成和失败后折叠。 */
    defaultOpen: boolean;
    /** traceId: 最近事件排查 ID。 */
    traceId: string;
    /** summary: 聚合摘要。 */
    summary: string;
    /** responseText: 工具卡片响应内容，开始时显示等待响应，完成后显示输出或失败原因。 */
    responseText: string;
    /** orderSequence: 当前过程在轮次内首次出现的事件序号。 */
    orderSequence: number;
    /** logs: 同一过程内按 sequence 排列的日志。 */
    logs: Array<{
        /** eventId: 事件 ID。 */
        eventId: string;
        /** text: 日志或过程输出。 */
        text: string;
        /** occurredAt: 统一格式时间。 */
        occurredAt: string;
    }>;
}

/**
 * ThinkingProcessRow：单次思考过程行。
 */
export interface ThinkingProcessRow {
    /** rowId: 思考卡片唯一 ID，优先使用 thinkingId。 */
    rowId: string;
    /** turnId: 所属轮次 ID，来自中心服务事件；无轮次时为 null。 */
    turnId: string | null;
    /** taskId: 所属任务 ID，来自中心服务事件；无任务时为 null。 */
    taskId: string | null;
    /** title: 思考块标题。 */
    title: string;
    /** statusLabel: 当前阶段状态中文说明。 */
    statusLabel: string;
    /** startedAt: 思考过程首个事件时间，来源于中心服务事件 createdAt。 */
    startedAt: string;
    /** endedAt: 思考过程结束或最近事件时间，来源于中心服务事件 createdAt。 */
    endedAt: string;
    /** defaultOpen: 是否默认展开，只影响浏览器当前 UI。 */
    defaultOpen: boolean;
    /** traceId: 最近事件排查 ID。 */
    traceId: string;
    /** orderSequence: 当前思考过程在轮次内首次出现的事件序号。 */
    orderSequence: number;
    /** segments: 思考阶段片段数组。 */
    segments: Array<{
        /** eventId: 片段事件 ID。 */
        eventId: string;
        /** summary: 片段摘要，只保存思考内容正文，不混入状态文案。 */
        summary: string;
    }>;
}

/**
 * ConversationRenderRow：对话区统一渲染行。
 *
 * 来源：消息、思考事件和工具过程事件合并结果。
 * 含义：保证同一轮用户消息先出现，过程记录居中，助手回复最后。
 * 格式：判别联合类型。
 * 默认值：无。
 * 约束：不能把过程区独立渲染到全部消息之前。
 */
export type ConversationRenderRow =
    | {
        /** rowKind: 固化消息行。 */
        rowKind: "message";
        /** rowId: 渲染行唯一 ID。 */
        rowId: string;
        /** message: 中心服务固化消息。 */
        message: ConversationMessage;
        /** temporary: 是否为浏览器从流式事件派生的临时消息。 */
        temporary?: boolean;
    }
    | {
        /** rowKind: 思考过程行。 */
        rowKind: "thinking";
        /** rowId: 渲染行唯一 ID。 */
        rowId: string;
        /** thinking: 合并后的思考过程。 */
        thinking: ThinkingProcessRow;
    }
    | {
        /** rowKind: 工具、模型或命令过程行。 */
        rowKind: "process";
        /** rowId: 渲染行唯一 ID。 */
        rowId: string;
        /** process: 聚合后的过程卡片。 */
        process: ProcessMessageGroupRow;
    };

/**
 * StreamingAssistantRow：运行中模型流式回复派生的临时助手消息。
 */
interface StreamingAssistantRow {
    /** rowId: 临时助手行唯一 ID，按轮次固定。 */
    rowId: string;
    /** turnId: 所属轮次 ID，来自模型流事件。 */
    turnId: string;
    /** orderSequence: 首个模型 delta 的事件序号。 */
    orderSequence: number;
    /** message: 渲染层临时助手消息，不写入中心服务消息事实源。 */
    message: ConversationMessage;
}

/**
 * MessageTimelineNode：用户消息时间线节点。
 */
export interface MessageTimelineNode {
    /** messageId: 用户消息 ID，作为 DOM 锚点唯一来源。 */
    messageId: string;
    /** label: 节点短标签。 */
    label: string;
    /** preview: 用户发送内容摘要。 */
    preview: string;
    /** sentAt: 统一格式发送时间。 */
    sentAt: string;
}

/**
 * resolveProcessEventStatus：推导中心服务过程事件的展示状态。
 *
 * 关键逻辑：EventRecord 共享协议没有顶层 status 字段，真实详情接口只保证
 * eventType 和 payload，因此浏览器端不能读取事件顶层状态，否则历史事件会被误判为完成。
 *
 * @param event 中心服务事件。
 * @returns 过程事件展示状态和中文文案。
 */
export function resolveProcessEventStatus(event: EventRecord): ProcessEventStatusMeta {
    if (isFailedEventType(event.eventType)) {
        return {
            status: "failed",
            label: "失败",
        };
    }

    if (event.eventType.endsWith(".delta") || event.eventType.endsWith(".started")) {
        return {
            status: "running",
            label: "生成中",
        };
    }

    if (event.eventType.endsWith(".completed")) {
        return {
            status: "completed",
            label: "已完成",
        };
    }

    const payloadStatus = readPayloadStatus(event);
    if (payloadStatus !== null) {
        return payloadStatus;
    }

    return {
        status: "unknown",
        label: "处理中",
    };
}

/**
 * readPayloadStatus：读取载荷中明确声明的阶段状态。
 *
 * @param event 中心服务事件。
 * @returns 可识别状态；无明确字段时返回 null。
 */
function readPayloadStatus(event: EventRecord): ProcessEventStatusMeta | null {
    if (typeof event.payload !== "object" || event.payload === null) {
        return null;
    }

    const payload = event.payload as Record<string, unknown>;
    const rawStatus = typeof payload.status === "string"
        ? payload.status
        : typeof payload.phaseStatus === "string"
            ? payload.phaseStatus
            : "";

    if (rawStatus === "running" || rawStatus === "streaming" || rawStatus === "thinking") {
        return {
            status: "running",
            label: "生成中",
        };
    }

    if (rawStatus === "completed" || rawStatus === "success" || rawStatus === "done") {
        return {
            status: "completed",
            label: "已完成",
        };
    }

    if (rawStatus === "failed" || rawStatus === "error") {
        return {
            status: "failed",
            label: "失败",
        };
    }

    return null;
}

/**
 * isFailedEventType：识别失败类事件类型。
 *
 * @param eventType 中心服务事件类型。
 * @returns 是否属于失败事件。
 */
function isFailedEventType(eventType: string): boolean {
    return eventType.endsWith(".failed")
        || eventType.endsWith(".error")
        || eventType.includes(".failed.")
        || eventType.includes(".error.");
}

/**
 * createProcessMessageRow：把事件转换为过程消息行。
 *
 * @param event 中心服务事件。
 * @returns 过程消息行。
 */
export function createProcessMessageRow(event: EventRecord): ProcessMessageRow {
    const statusMeta = resolveProcessEventStatus(event);
    if (event.eventType.startsWith("thinking.")) {
        return {
            rowId: event.eventId,
            kind: "thinking",
            event,
            title: statusMeta.status === "completed"
                ? "思考完成"
                : "思考中",
            summary: readEventText(
                event,
                "thinkingText",
            ) || event.summary,
            statusLabel: statusMeta.label,
        };
    }

    return {
        rowId: event.eventId,
        kind: "tool",
        event,
        title: event.eventType,
        summary: event.summary,
        statusLabel: statusMeta.label,
    };
}

/**
 * createGroupedProcessRows：把流式、命令、MCP 和工具过程按同一任务与工具类型聚合。
 *
 * @param events 中心服务事件数组。
 * @returns 聚合后的过程卡片数组。
 */
export function createGroupedProcessRows(events: EventRecord[]): ProcessMessageGroupRow[] {
    const processEvents = events.filter((event) => {
        return [
            "model.failed",
            "message.turn.failed",
            "worker.task.failed",
            "tool.command.started",
            "tool.command.output",
            "tool.command.completed",
            "tool.mcp.started",
            "tool.mcp.completed",
            "tool.mcp.failed",
            "tool.call.started",
            "tool.call.output",
            "tool.call.completed",
            "tool.call.failed",
        ].includes(event.eventType);
    });
    const groups = new Map<string, EventRecord[]>();
    for (const event of processEvents) {
        const key = resolveProcessGroupKey(event);
        groups.set(
            key,
            [
                ...(groups.get(key) ?? []),
                event,
            ],
        );
    }

    return Array.from(groups.entries()).map(([
        groupKey,
        groupEvents,
    ]) => {
        const sortedEvents = [...groupEvents].sort((left, right) => {
            return left.sequence - right.sequence;
        });
        const latestEvent = sortedEvents[sortedEvents.length - 1];
        const statusEntries = sortedEvents.map((event) => {
            return {
                event,
                statusMeta: resolveProcessEventStatus(event),
            };
        });
        const hasFailed = statusEntries.some((entry) => {
            return entry.statusMeta.status === "failed";
        });
        const hasCompleted = statusEntries.some((entry) => {
            return entry.statusMeta.status === "completed";
        });
        const isRunning = statusEntries.some((entry) => {
            return entry.statusMeta.status === "running";
        }) && !hasCompleted && !hasFailed;
        const title = resolveProcessGroupTitle(latestEvent);
        const processKind = resolveProcessKind(latestEvent);
        return {
            rowId: `process-${groupKey}`,
            turnId: latestEvent.turnId,
            taskId: latestEvent.taskId,
            kind: "tool",
            processKind,
            title,
            statusLabel: hasFailed
                ? "失败"
                : isRunning
                    ? "执行中"
                    : "已完成",
            defaultOpen: isRunning,
            traceId: latestEvent.traceId,
            summary: resolveProcessSummary(latestEvent),
            responseText: resolveProcessResponseText(
                sortedEvents,
                latestEvent,
            ),
            orderSequence: sortedEvents[0].sequence,
            logs: statusEntries.map((entry) => {
                return {
                    eventId: entry.event.eventId,
                    text: resolveProcessLogText(entry.event),
                    occurredAt: formatDisplayTime(entry.event.occurredAt),
                };
            }),
        };
    });
}

/**
 * resolveProcessGroupKey：解析同一过程聚合键。
 *
 * @param event 中心服务事件。
 * @returns 聚合键。
 */
function resolveProcessGroupKey(event: EventRecord): string {
    const payload = typeof event.payload === "object" && event.payload !== null
        ? event.payload as Record<string, unknown>
        : {};
    const commandGroupId = resolveCommandProcessGroupId(
        event,
        payload,
    );
    if (commandGroupId) {
        return [
            event.turnId ?? "no-turn",
            event.taskId ?? "no-task",
            "command",
            commandGroupId,
        ].join(":");
    }
    if (event.eventType.startsWith("tool.mcp.")) {
        const toolCallId = typeof payload.toolCallId === "string" && payload.toolCallId.length > 0
            ? payload.toolCallId
            : [
                payload.serverId,
                payload.toolName,
            ].filter((item) => typeof item === "string" && item.length > 0).join(".");
        return [
            event.turnId ?? "no-turn",
            event.taskId ?? "no-task",
            "mcp",
            toolCallId || event.eventId,
        ].join(":");
    }
    const toolKind = typeof payload.toolKind === "string"
        ? payload.toolKind
        : "tool";
    return [
        event.turnId ?? "no-turn",
        event.taskId ?? "no-task",
        toolKind,
    ].join(":");
}

/**
 * readEventGraphCheckpoint：读取历史事件中的图检查点。
 *
 * @param event 中心服务事件。
 * @returns graphCheckpoint 存在且结构可识别时返回，否则返回 null。
 */
export function readEventGraphCheckpoint(event: EventRecord): TurnGraphCheckpoint | null {
    if (typeof event.payload !== "object" || event.payload === null) {
        return null;
    }
    const payload = event.payload as Record<string, unknown>;
    const graphCheckpoint = payload.graph;
    if (typeof graphCheckpoint !== "object" || graphCheckpoint === null) {
        return null;
    }
    const graph = graphCheckpoint as Partial<TurnGraphCheckpoint>;
    if (typeof graph.graphRunId !== "string"
        || typeof graph.threadId !== "string"
        || typeof graph.nodeId !== "string"
        || typeof graph.checkpointId !== "string") {
        return null;
    }
    return graph as TurnGraphCheckpoint;
}

/**
 * resolveCommandProcessGroupId：生成单条命令过程的独立聚合 ID。
 *
 * @param event 中心服务事件。
 * @param payload 事件载荷。
 * @returns 命令聚合 ID；非命令事件返回空字符串。
 */
function resolveCommandProcessGroupId(
    event: EventRecord,
    payload: Record<string, unknown>,
): string {
    const isCommandEvent = event.eventType.startsWith("tool.command.")
        || (
            event.eventType === "tool.call.failed"
            && payload.toolKind === "command"
        );
    if (!isCommandEvent) {
        return "";
    }
    for (const key of [
        "toolCallId",
        "command",
        "inputSummary",
    ]) {
        const value = payload[key];
        if (typeof value === "string" && value.length > 0) {
            return value;
        }
    }
    return event.eventId;
}

/**
 * resolveProcessGroupTitle：生成过程卡片标题。
 *
 * @param event 同组最新事件。
 * @returns 用户可见标题。
 */
function resolveProcessGroupTitle(event: EventRecord): string {
    const payload = typeof event.payload === "object" && event.payload !== null
        ? event.payload as Record<string, unknown>
        : {};
    if (event.eventType === "message.turn.failed" || event.eventType === "worker.task.failed") {
        return "对话执行失败";
    }
    if (event.eventType.startsWith("tool.command.") || payload.toolKind === "command") {
        const command = readEventText(
            event,
            "command",
        );
        return command
            ? command
            : "命令";
    }
    if (event.eventType.startsWith("tool.call.")) {
        return readEventText(
            event,
            "toolName",
        ) || "工具";
    }
    if (event.eventType.startsWith("tool.mcp.")) {
        const serverId = readEventText(
            event,
            "serverId",
        );
        const toolName = readEventText(
            event,
            "toolName",
        );
        return serverId || toolName
            ? `MCP：${serverId}${toolName ? ` · ${toolName}` : ""}`
            : "MCP";
    }
    if (event.eventType.startsWith("tool.plugin.")) {
        const pluginName = readEventText(
            event,
            "pluginName",
        );
        return pluginName
            ? `插件：${pluginName}`
            : "插件";
    }
    if (event.eventType.startsWith("tool.skill.")) {
        const skillName = readEventText(
            event,
            "skillName",
        );
        return skillName
            ? `skill：${skillName}`
            : "skill";
    }
    return "工具";
}

/**
 * resolveProcessResponseText：生成工具卡片唯一响应内容。
 *
 * @param sortedEvents 同一工具调用按事件序号排列后的事件。
 * @param latestEvent 当前工具调用的最新事件。
 * @returns 工具响应内容；工具未返回时显示等待响应。
 */
function resolveProcessResponseText(
    sortedEvents: EventRecord[],
    latestEvent: EventRecord,
): string {
    const responseParts = sortedEvents.map((event) => {
        if (event.eventType === "tool.command.output") {
            return resolveProcessLogText(event);
        }
        if (event.eventType.endsWith(".failed")) {
            return resolveProcessSummary(event);
        }
        if (event.eventType.endsWith(".completed")) {
            return resolveProcessSummary(event);
        }
        return "";
    }).filter((text) => {
        return text.trim().length > 0;
    });

    if (responseParts.length > 0) {
        return deduplicateProcessTextParts(responseParts).join("\n");
    }

    const title = resolveProcessGroupTitle(latestEvent);
    return `${title} 已开始，等待响应。`;
}

/**
 * deduplicateProcessTextParts：去除同一过程卡片里的重复正文片段。
 *
 * @param parts 按事件顺序读取的输出、完成摘要和失败原因。
 * @returns 去重后的正文片段。
 */
function deduplicateProcessTextParts(parts: string[]): string[] {
    const seen = new Set<string>();
    return parts.filter((part) => {
        const normalizedPart = part.trim();
        if (normalizedPart.length === 0 || seen.has(normalizedPart)) {
            return false;
        }
        seen.add(normalizedPart);
        return true;
    });
}

/**
 * resolveProcessSummary：生成过程卡片摘要。
 *
 * @param event 同组最新事件。
 * @returns 可展示摘要。
 */
function resolveProcessSummary(event: EventRecord): string {
    return readEventText(
        event,
        "failureReason",
    ) || readEventText(
        event,
        "errorMessage",
    ) || readEventText(
        event,
        "outputSummary",
    ) || event.summary;
}

/**
 * resolveProcessLogText：读取过程日志正文。
 *
 * @param event 中心服务事件。
 * @returns 日志正文。
 */
function resolveProcessLogText(event: EventRecord): string {
    return readEventText(
        event,
        "outputSummary",
    ) || readEventText(
        event,
        "inputSummary",
    ) || readEventText(
        event,
        "outputChunk",
    ) || readEventText(
        event,
        "deltaText",
    ) || readEventText(
        event,
        "failureReason",
    ) || event.summary;
}

/**
 * readEventText：读取事件载荷中的字符串字段。
 *
 * @param event 中心服务事件。
 * @param key 字段名。
 * @returns 字符串字段；不存在时返回空字符串。
 */
export function readEventText(
    event: EventRecord,
    key: string,
): string {
    if (typeof event.payload !== "object" || event.payload === null) {
        return "";
    }
    const value = (event.payload as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
}

/**
 * createThinkingProcessRows：把思考事件拆成独立思考卡片。
 *
 * @param events 中心服务事件数组。
 * @returns 按 thinkingId 或阶段拆分后的思考卡片数组。
 */
export function createThinkingProcessRows(events: EventRecord[]): ThinkingProcessRow[] {
    const groups = new Map<string, EventRecord[]>();
    for (const event of events) {
        if (!event.eventType.startsWith("thinking.")) {
            continue;
        }
        // groupKey: 优先使用 thinkingId，确保同一轮里的多次思考过程分别展示为独立卡片。
        const groupKey = resolveThinkingGroupKey(event);
        groups.set(
            groupKey,
            [
                ...(groups.get(groupKey) ?? []),
                event,
            ],
        );
    }

    return Array.from(groups.entries()).map(([
        groupKey,
        groupEvents,
    ]) => {
        const sortedEvents = [...groupEvents].sort((a, b) => {
            return a.sequence - b.sequence;
        });
        const latestEvent = sortedEvents[sortedEvents.length - 1];
        const statusEntries = sortedEvents.map((event) => {
            return {
                event,
                statusMeta: resolveProcessEventStatus(event),
            };
        });
        const isRunning = statusEntries.some((entry) => {
            return entry.statusMeta.status === "running";
        }) && !statusEntries.some((entry) => {
            return entry.statusMeta.status === "completed";
        });
        const hasFailed = statusEntries.some((entry) => {
            return entry.statusMeta.status === "failed";
        });
        const startedAt = sortedEvents[0].createdAt;
        const endedAt = latestEvent.createdAt;
        const durationText = formatThinkingDuration(
            startedAt,
            endedAt,
        );
        return {
            rowId: `thinking-${groupKey}`,
            turnId: latestEvent.turnId,
            taskId: latestEvent.taskId,
            title: isRunning
                ? "正在思考"
                : `已思考（用时 ${durationText}）`,
            statusLabel: hasFailed
                ? "失败"
                : isRunning
                    ? "生成中"
                    : "已完成",
            startedAt,
            endedAt,
            defaultOpen: isRunning,
            traceId: latestEvent.traceId,
            orderSequence: sortedEvents[0].sequence,
            segments: statusEntries.map((entry) => {
                return {
                    eventId: entry.event.eventId,
                    summary: readEventText(
                        entry.event,
                        "thinkingText",
                    ),
                };
            }).filter((segment) => {
                return segment.summary.trim().length > 0;
            }),
        };
    });
}

/**
 * resolveProcessKind：解析过程卡片细分类型。
 *
 * @param event 同组最新事件。
 * @returns 命令、MCP、插件、skill 或普通工具。
 */
function resolveProcessKind(event: EventRecord): ProcessMessageGroupRow["processKind"] {
    const payload = typeof event.payload === "object" && event.payload !== null
        ? event.payload as Record<string, unknown>
        : {};
    if (event.eventType.startsWith("tool.command.") || payload.toolKind === "command") {
        return "command";
    }
    if (event.eventType.startsWith("tool.mcp.") || payload.toolKind === "mcp") {
        return "mcp";
    }
    if (event.eventType.startsWith("tool.plugin.") || payload.toolKind === "plugin") {
        return "plugin";
    }
    if (event.eventType.startsWith("tool.skill.") || payload.toolKind === "skill") {
        return "skill";
    }
    return "tool";
}

/**
 * formatThinkingDuration：格式化单个思考过程耗时。
 *
 * @param startedAt 思考首个事件时间。
 * @param endedAt 思考完成或最近事件时间。
 * @returns 面向思考卡片标题的耗时文本。
 */
function formatThinkingDuration(
    startedAt: string,
    endedAt: string,
): string {
    const startedTime = new Date(startedAt).getTime();
    const endedTime = new Date(endedAt).getTime();
    if (!Number.isFinite(startedTime) || !Number.isFinite(endedTime) || endedTime < startedTime) {
        return "0 秒";
    }
    const durationSeconds = Math.max(
        0,
        Math.round((endedTime - startedTime) / 1000),
    );
    return `${durationSeconds} 秒`;
}

/**
 * createMergedThinkingRows：兼容旧调用名称的思考过程入口。
 *
 * @param events 中心服务事件数组。
 * @returns 独立思考卡片数组。
 */
export function createMergedThinkingRows(events: EventRecord[]): ThinkingProcessRow[] {
    return createThinkingProcessRows(events);
}

/**
 * resolveThinkingGroupKey：解析单次思考过程的聚合键。
 *
 * @param event 中心服务思考事件。
 * @returns 思考过程聚合键。
 */
function resolveThinkingGroupKey(event: EventRecord): string {
    const payload = typeof event.payload === "object" && event.payload !== null
        ? event.payload as Record<string, unknown>
        : {};
    for (const key of [
        "thinkingId",
        "phaseId",
    ]) {
        const value = payload[key];
        if (typeof value === "string" && value.length > 0) {
            return [
                event.turnId ?? "no-turn",
                value,
            ].join(":");
        }
    }
    const phase = typeof payload.phase === "string"
        ? payload.phase
        : "";
    if (phase.length > 0) {
        return [
            event.turnId ?? "no-turn",
            event.taskId ?? "no-task",
            phase,
        ].join(":");
    }
    return event.eventId;
}

/**
 * createMessageTimelineNodes：从用户消息生成对话时间线节点。
 *
 * @param messages 当前会话消息列表。
 * @returns 用户消息时间线节点数组。
 */
export function createMessageTimelineNodes(messages: ConversationMessage[]): MessageTimelineNode[] {
    return messages.filter((message) => {
        return message.role === "user";
    }).map((message, index) => {
        const preview = message.contentMarkdown.replace(/\s+/gu, " ").trim();
        return {
            messageId: message.messageId,
            label: `#${index + 1}`,
            preview: preview.length > 80
                ? `${preview.slice(0, 80)}...`
                : preview || "空消息",
            sentAt: formatDisplayTime(message.createdAt),
        };
    });
}

/**
 * createConversationRenderRows：按轮次语义合并消息、思考和工具过程。
 *
 * @param messages 当前会话消息列表。
 * @param thinkingRows 已按轮次合并的思考过程。
 * @param processRows 已按任务聚合的工具和模型过程。
 * @returns 用户消息、过程和助手回复组成的稳定展示序列。
 */
export function createConversationRenderRows(
    messages: ConversationMessage[],
    thinkingRows: ThinkingProcessRow[],
    processRows: ProcessMessageGroupRow[],
    events: EventRecord[] = [],
): ConversationRenderRow[] {
    const processRowsByTurn = groupRowsByTurn(processRows);
    const thinkingRowsByTurn = groupRowsByTurn(thinkingRows);
    const streamingAssistantRowsByTurn = groupRowsByTurn(createStreamingAssistantRows(
        messages,
        events,
    ));
    const consumedThinkingRowIds = new Set<string>();
    const consumedProcessRowIds = new Set<string>();
    const consumedStreamingAssistantRowIds = new Set<string>();
    const rows: ConversationRenderRow[] = [];

    for (const message of messages) {
        if (message.role === "user") {
            rows.push({
                rowKind: "message",
                rowId: message.messageId,
                message,
            });
            appendTurnProcessRows(
                rows,
                message.turnId,
                thinkingRowsByTurn,
                processRowsByTurn,
                streamingAssistantRowsByTurn,
                consumedThinkingRowIds,
                consumedProcessRowIds,
                consumedStreamingAssistantRowIds,
            );
            continue;
        }

        if (message.role === "assistant") {
            appendTurnProcessRows(
                rows,
                message.turnId,
                thinkingRowsByTurn,
                processRowsByTurn,
                streamingAssistantRowsByTurn,
                consumedThinkingRowIds,
                consumedProcessRowIds,
                consumedStreamingAssistantRowIds,
            );
        }
        rows.push({
            rowKind: "message",
            rowId: message.messageId,
            message,
        });
    }

    appendUnconsumedProcessRows(
        rows,
        thinkingRows,
        processRows,
        streamingAssistantRowsByTurn,
        consumedThinkingRowIds,
        consumedProcessRowIds,
        consumedStreamingAssistantRowIds,
    );
    return rows;
}

/**
 * createStreamingAssistantRows：从模型 SSE delta 事件派生运行中助手消息。
 *
 * @param messages 当前会话固化消息。
 * @param events 当前会话事件数组。
 * @returns 仅包含尚未固化助手消息的临时助手行。
 */
function createStreamingAssistantRows(
    messages: ConversationMessage[],
    events: EventRecord[],
): StreamingAssistantRow[] {
    const assistantTurnIds = new Set(messages.filter((message) => {
        return message.role === "assistant" && message.turnId !== null;
    }).map((message) => {
        return message.turnId as string;
    }));
    const groups = new Map<string, EventRecord[]>();

    for (const event of events) {
        if (event.eventType !== "model.stream.delta" || !event.turnId || assistantTurnIds.has(event.turnId)) {
            continue;
        }
        groups.set(
            event.turnId,
            [
                ...(groups.get(event.turnId) ?? []),
                event,
            ],
        );
    }

    return Array.from(groups.entries()).map(([
        turnId,
        groupEvents,
    ]) => {
        const sortedEvents = [...groupEvents].sort((left, right) => {
            return left.sequence - right.sequence;
        });
        const firstEvent = sortedEvents[0];
        const contentMarkdown = sortedEvents.map((event) => {
            return readEventText(
                event,
                "deltaText",
            );
        }).join("");

        return {
            rowId: `streaming-assistant-${turnId}`,
            turnId,
            orderSequence: firstEvent.sequence,
            message: {
                messageId: `streaming-assistant-${turnId}`,
                sessionId: firstEvent.sessionId,
                turnId,
                role: "assistant",
                contentMarkdown,
                createdAt: firstEvent.occurredAt,
            },
        };
    }).filter((row) => {
        return row.message.contentMarkdown.length > 0;
    });
}

/**
 * groupRowsByTurn：按轮次聚合过程行。
 *
 * @param rows 带 turnId 的过程行。
 * @returns 轮次到过程行数组的映射。
 */
function groupRowsByTurn<T extends { turnId: string | null; rowId: string }>(rows: T[]): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
        if (!row.turnId) {
            continue;
        }
        const currentRows = groups.get(row.turnId) ?? [];
        currentRows.push(row);
        groups.set(row.turnId, currentRows);
    }
    return groups;
}

/**
 * appendTurnProcessRows：把同一轮过程追加到当前用户消息之后、助手消息之前。
 *
 * @param rows 目标渲染行。
 * @param turnId 当前消息所属轮次。
 * @param thinkingRowsByTurn 思考过程索引。
 * @param processRowsByTurn 工具过程索引。
 * @param consumedThinkingRowIds 已消费思考行 ID。
 * @param consumedProcessRowIds 已消费过程行 ID。
 * @returns 没有返回值。
 */
function appendTurnProcessRows(
    rows: ConversationRenderRow[],
    turnId: string | null,
    thinkingRowsByTurn: Map<string, ThinkingProcessRow[]>,
    processRowsByTurn: Map<string, ProcessMessageGroupRow[]>,
    streamingAssistantRowsByTurn: Map<string, StreamingAssistantRow[]>,
    consumedThinkingRowIds: Set<string>,
    consumedProcessRowIds: Set<string>,
    consumedStreamingAssistantRowIds: Set<string>,
): void {
    if (!turnId) {
        return;
    }
    const orderedRows = [
        ...(thinkingRowsByTurn.get(turnId) ?? []).map((thinking) => {
            return {
                kind: "thinking" as const,
                orderSequence: thinking.orderSequence,
                row: thinking,
            };
        }),
        ...(processRowsByTurn.get(turnId) ?? []).map((process) => {
            return {
                kind: "process" as const,
                orderSequence: process.orderSequence,
                row: process,
            };
        }),
        ...(streamingAssistantRowsByTurn.get(turnId) ?? []).map((assistant) => {
            return {
                kind: "streaming-assistant" as const,
                orderSequence: assistant.orderSequence,
                row: assistant,
            };
        }),
    ].sort((left, right) => {
        return left.orderSequence - right.orderSequence;
    });

    for (const item of orderedRows) {
        if (item.kind === "thinking") {
            if (consumedThinkingRowIds.has(item.row.rowId)) {
                continue;
            }
            consumedThinkingRowIds.add(item.row.rowId);
            rows.push({
                rowKind: "thinking",
                rowId: item.row.rowId,
                thinking: item.row,
            });
            continue;
        }

        if (item.kind === "streaming-assistant") {
            if (consumedStreamingAssistantRowIds.has(item.row.rowId)) {
                continue;
            }
            consumedStreamingAssistantRowIds.add(item.row.rowId);
            rows.push({
                rowKind: "message",
                rowId: item.row.rowId,
                message: item.row.message,
                temporary: true,
            });
            continue;
        }

        if (consumedProcessRowIds.has(item.row.rowId)) {
            continue;
        }
        consumedProcessRowIds.add(item.row.rowId);
        rows.push({
            rowKind: "process",
            rowId: item.row.rowId,
            process: item.row,
        });
    }
}

/**
 * appendUnconsumedProcessRows：追加无法归属到消息轮次的过程，避免丢失审计可见性。
 *
 * @param rows 目标渲染行。
 * @param thinkingRows 所有思考过程行。
 * @param processRows 所有工具过程行。
 * @param consumedThinkingRowIds 已消费思考行 ID。
 * @param consumedProcessRowIds 已消费过程行 ID。
 * @returns 没有返回值。
 */
function appendUnconsumedProcessRows(
    rows: ConversationRenderRow[],
    thinkingRows: ThinkingProcessRow[],
    processRows: ProcessMessageGroupRow[],
    streamingAssistantRowsByTurn: Map<string, StreamingAssistantRow[]>,
    consumedThinkingRowIds: Set<string>,
    consumedProcessRowIds: Set<string>,
    consumedStreamingAssistantRowIds: Set<string>,
): void {
    for (const thinking of thinkingRows) {
        if (consumedThinkingRowIds.has(thinking.rowId)) {
            continue;
        }
        rows.push({
            rowKind: "thinking",
            rowId: thinking.rowId,
            thinking,
        });
    }
    for (const assistants of streamingAssistantRowsByTurn.values()) {
        for (const assistant of assistants) {
            if (consumedStreamingAssistantRowIds.has(assistant.rowId)) {
                continue;
            }
            rows.push({
                rowKind: "message",
                rowId: assistant.rowId,
                message: assistant.message,
                temporary: true,
            });
        }
    }
    for (const process of processRows) {
        if (consumedProcessRowIds.has(process.rowId)) {
            continue;
        }
        rows.push({
            rowKind: "process",
            rowId: process.rowId,
            process,
        });
    }
}

/**
 * formatContextUsageTooltip：生成上下文占用 tooltip。
 *
 * @param input 上下文统计展示输入。
 * @returns 用户可理解的多行 tooltip 文案。
 */
export function formatContextUsageTooltip(input: {
    usedTokens: number;
    limitTokens: number;
    percentText: string;
    modelId: string;
    referenceCount: number;
    attachmentCount: number;
    source: string;
}): string {
    const usedText = input.usedTokens > 0
        ? formatContextWindowLimit(input.usedTokens)
        : "0K";
    const limitText = input.limitTokens > 0
        ? formatContextWindowLimit(input.limitTokens)
        : "未配置窗口上限";
    return [
        `用量：${usedText} / ${limitText}`,
        `百分比：${input.percentText}`,
    ].join("\n");
}

/**
 * formatTaskStatus：把任务和轮次状态协议值转成中文。
 *
 * @param status 状态协议值。
 * @returns 中文状态。
 */
export function formatTaskStatus(status: string): string {
    const labels: Record<string, string> = {
        queued: "排队中",
        running: "执行中",
        waiting_user: "等待用户",
        completed: "已完成",
        failed: "失败",
        cancelled: "已取消",
    };

    return labels[status] ?? "未知状态";
}

/**
 * resolveTaskStatusMeta：把任务状态映射为左侧导航图标。
 *
 * @param status 任务状态协议值。
 * @returns 状态图标元信息。
 */
export function resolveTaskStatusMeta(status: TaskStatus | undefined): NavigationStatusMeta {
    if (status === "running") {
        return {
            icon: Loading,
            title: "执行中",
            tone: "running",
        };
    }
    if (status === "queued") {
        return {
            icon: Clock,
            title: "排队中：仅表示当前对话内等待上一项处理，多个对话框可并发执行",
            tone: "queued",
        };
    }
    if (status === "waiting_user") {
        return {
            icon: Warning,
            title: "等待用户：引导/审批/需要用户确认归属当前对话当前轮次",
            tone: "waiting",
        };
    }
    if (status === "failed" || status === "cancelled") {
        return {
            icon: CircleClose,
            title: status === "failed" ? "失败" : "已取消",
            tone: "failed",
        };
    }
    if (status === "completed") {
        return {
            icon: CircleCheck,
            title: "已完成",
            tone: "completed",
        };
    }

    return {
        icon: CircleCheck,
        title: "空闲",
        tone: "idle",
    };
}

/**
 * formatDisplayTime：格式化统一展示时间。
 *
 * @param value ISO 时间。
 * @returns YYYY-MM-DD HH:mm:ss 或占位文案。
 */
export function formatDisplayTime(value: string | null | undefined): string {
    if (!value) {
        return "时间未知";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "时间未知";
    }
    const pad = (part: number) => String(part).padStart(2, "0");
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join("-") + " " + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join(":");
}

/**
 * formatDurationMs：格式化轮次耗时。
 *
 * @param durationMs 持续毫秒数。
 * @returns 中文耗时。
 */
export function formatDurationMs(durationMs: number | null | undefined): string {
    if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
        return "未结束";
    }

    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}小时${minutes}分${seconds}秒`;
    }
    if (minutes > 0) {
        return `${minutes}分${seconds}秒`;
    }

    return `${seconds}秒`;
}

/**
 * formatOptionalElapsed：格式化可空起止时间。
 *
 * @param startedAt 开始时间。
 * @param endedAt 结束时间。
 * @returns 耗时文案。
 */
export function formatOptionalElapsed(
    startedAt: string | null,
    endedAt: string | null,
): string {
    if (!startedAt || !endedAt) {
        return "进行中";
    }
    return formatDurationMs(Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()));
}

/**
 * formatTaskElapsed：格式化任务更新时间差。
 *
 * @param createdAt 创建时间。
 * @param updatedAt 更新时间。
 * @returns 耗时文案。
 */
export function formatTaskElapsed(
    createdAt: string,
    updatedAt: string,
): string {
    return formatDurationMs(Math.max(0, new Date(updatedAt).getTime() - new Date(createdAt).getTime()));
}

/**
 * formatContextWindowLimit：格式化模型窗口上限。
 *
 * @param tokens token 数值。
 * @returns K 或 M 简写。
 */
export function formatContextWindowLimit(tokens: number): string {
    if (!Number.isFinite(tokens) || tokens <= 0) {
        return "未配置窗口";
    }
    if (tokens >= 1000000 && tokens % 1000000 === 0) {
        return `${tokens / 1000000}M`;
    }
    return `${Math.round(tokens / 1000)}K`;
}

/**
 * formatTurnTimeFooter：生成轮次末尾时间文案。
 *
 * @param turn 会话轮次。
 * @returns 时间尾注文案。
 */
export function formatTurnTimeFooter(turn: ConversationTurn): string {
    return `本轮开始 ${formatDisplayTime(turn.startedAt)}，结束 ${formatDisplayTime(turn.endedAt)}，总耗时 ${formatDurationMs(turn.durationMs)}`;
}

/**
 * sessionTooltipContent：生成对话行 tooltip。
 *
 * @param session 会话记录。
 * @param userPreview 用户摘要。
 * @returns 完整标题和统一格式时间。
 */
export function sessionTooltipContent(
    session: ConversationSession,
    userPreview: string,
): string {
    return `${session.title}\n用户发出：${userPreview}\n${formatDisplayTime(session.updatedAt)}`;
}

/**
 * projectTooltipContent：生成项目行详情提示。
 *
 * @param project 项目记录。
 * @returns 项目文件夹名或未登记状态，以及项目 ID。
 */
export function projectTooltipContent(project: ProjectRecord): string {
    const nameLine = project.displayName === "未登记项目名称"
        ? "项目名称：未登记项目名称"
        : `项目文件夹名：${project.displayName}`;
    const aliasLine = project.alias
        ? `备注：${project.alias}`
        : "备注：无";
    return `${nameLine}\n项目 ID：${project.projectId}\n${aliasLine}`;
}
