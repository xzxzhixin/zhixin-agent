import type {
    AgentStatusTreeNode,
} from "@stores/app";
import type {
    ConversationMessage,
    ConversationTurn,
    EventRecord,
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
    /** processKind: 过程细分类型，来源于事件类型或 payload.toolKind，用于区分命令、MCP、插件、skill、任务、智能体和普通工具。 */
    processKind:
        | "command"
        | "mcp"
        | "plugin"
        | "skill"
        | "task"
        | "agent"
        | "model"
        | "tool";
    /** title: 展示标题。 */
    title: string;
    /** statusLabel: 当前聚合过程状态。 */
    statusLabel: string;
    /** traceId: 最近事件排查 ID。 */
    traceId: string;
    /** summary: 聚合摘要。 */
    summary: string;
    /** responseText: 工具卡片响应内容，开始时显示等待响应，完成后显示输出或失败原因。 */
    responseText: string;
    /** terminalText: 终端风格正文，命令卡片第一行固定为真实命令，后续直接追加执行过程。 */
    terminalText: string;
    /** orderSequence: 当前过程在轮次内首次出现的事件序号。 */
    orderSequence: number;
    /** logs: 同一过程内按 sequence 排列的日志。 */
    logs: Array<{
        /** eventId: 事件 ID。 */
        eventId: string;
        /** label: 当前日志阶段标签。 */
        label: string;
        /** text: 日志或过程输出。 */
        text: string;
        /** occurredAt: 统一格式时间。 */
        occurredAt: string;
    }>;
}

/**
 * ModelInterimMarkdownRow：模型在工具过程之间输出的中途 Markdown 卡片。
 */
export interface ModelInterimMarkdownRow {
    /** rowId: 中途响应卡片唯一 ID。 */
    rowId: string;
    /** turnId: 所属轮次 ID，来源于模型流事件。 */
    turnId: string | null;
    /** taskId: 所属任务 ID，来源于模型流事件。 */
    taskId: string | null;
    /** contentMarkdown: 中途响应 Markdown 正文，按流式片段拼接。 */
    contentMarkdown: string;
    /** eventIds: 已归入该卡片的模型流事件 ID，用于避免临时最终回复重复消费。 */
    eventIds: string[];
    /** orderSequence: 当前卡片首个模型片段的事件序号。 */
    orderSequence: number;
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
    }
    | {
        /** rowKind: 模型中途 Markdown 卡片。 */
        rowKind: "model_interim";
        /** rowId: 渲染行唯一 ID。 */
        rowId: string;
        /** interim: 中途响应内容。 */
        interim: ModelInterimMarkdownRow;
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
        return isVisibleProcessEvent(event);
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
        const representativeEvent = resolveProcessRepresentativeEvent(
            sortedEvents,
            latestEvent,
        );
        const title = resolveProcessGroupTitle(representativeEvent);
        const processKind = resolveProcessKind(representativeEvent);
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
            traceId: latestEvent.traceId,
            summary: resolveProcessSummary(latestEvent),
            responseText: resolveProcessResponseText(
                sortedEvents,
                latestEvent,
            ),
            terminalText: resolveProcessTerminalText(
                sortedEvents,
                title,
                processKind,
            ),
            orderSequence: sortedEvents[0].sequence,
            logs: statusEntries.map((entry) => {
                return {
                    eventId: entry.event.eventId,
                    label: resolveProcessLogLabel(entry.event),
                    text: resolveProcessLogText(entry.event),
                    occurredAt: formatDisplayTime(entry.event.occurredAt),
                };
            }).filter((log) => {
                return log.text.trim().length > 0;
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
    if (event.eventType.startsWith("task.step.")) {
        return [
            event.turnId ?? "no-turn",
            event.taskId ?? "no-task",
            "task-step",
            event.stepId ?? event.scopeId ?? event.eventId,
        ].join(":");
    }
    const toolCallProcessGroupId = resolveToolCallProcessGroupId(
        event,
        payload,
    );
    if (toolCallProcessGroupId) {
        return [
            event.turnId ?? "no-turn",
            event.taskId ?? "no-task",
            "tool-call",
            toolCallProcessGroupId,
        ].join(":");
    }
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
    if (event.eventType.startsWith("model.tool.")) {
        const toolCallId = typeof payload.toolCallId === "string" && payload.toolCallId.length > 0
            ? payload.toolCallId
            : "";
        return [
            event.turnId ?? "no-turn",
            event.taskId ?? "no-task",
            "model-tool",
            toolCallId || event.eventType,
        ].join(":");
    }
    if (event.eventType.startsWith("agent.loop.")) {
        return [
            event.turnId ?? "no-turn",
            event.taskId ?? "no-task",
            "agent-loop",
            event.eventType,
        ].join(":");
    }
    const toolKind = typeof payload.toolKind === "string"
        ? payload.toolKind
        : "tool";
    const toolCallId = typeof payload.toolCallId === "string" && payload.toolCallId.length > 0
        ? payload.toolCallId
        : "";
    return [
        event.turnId ?? "no-turn",
        event.taskId ?? "no-task",
        toolKind,
        toolCallId || event.eventId,
    ].join(":");
}

/**
 * isVisibleProcessEvent：判断事件是否应进入对话过程卡片。
 *
 * @param event 中心服务事件。
 * @returns 需要在消息流中展示“正在做什么”时返回 true。
 */
function isVisibleProcessEvent(event: EventRecord): boolean {
    if ([
        "model.failed",
        "message.turn.failed",
        "worker.task.failed",
        "model.tool.requested",
        "model.tool.rejected",
        "model.tool.result.appended",
        "tool.plan.created",
        "agent.loop.batch_limit_reached",
        "task.plan.revised",
        "task.step.started",
        "task.step.updated",
    ].includes(event.eventType)) {
        return true;
    }
    return isVisibleToolProcessEvent(event)
        || event.eventType.startsWith("agent.team.");
}

/**
 * isVisibleToolProcessEvent：判断工具类事件是否是真实过程，而不是不可用审计。
 *
 * @param event 中心服务事件。
 * @returns 可以进入消息流过程卡片时返回 true。
 */
function isVisibleToolProcessEvent(event: EventRecord): boolean {
    if (event.eventType.endsWith(".unavailable")) {
        return false;
    }
    return event.eventType.startsWith("tool.command.")
        || event.eventType.startsWith("tool.mcp.")
        || event.eventType.startsWith("tool.call.")
        || event.eventType.startsWith("tool.skill.")
        || event.eventType.startsWith("tool.plugin.")
        || event.eventType.startsWith("tool.agent.");
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
 * resolveToolCallProcessGroupId：解析模型工具调用闭环的统一聚合 ID。
 *
 * @param event 中心服务事件。
 * @param payload 事件载荷。
 * @returns 有 toolCallId 时返回该 ID，否则返回空字符串。
 */
function resolveToolCallProcessGroupId(
    event: EventRecord,
    payload: Record<string, unknown>,
): string {
    if (![
        "model.tool.requested",
        "model.tool.rejected",
        "model.tool.result.appended",
        "tool.plan.created",
    ].includes(event.eventType)
        && !event.eventType.startsWith("tool.command.")
        && !event.eventType.startsWith("tool.mcp.")
        && !event.eventType.startsWith("tool.call.")) {
        return "";
    }
    const toolCallId = payload.toolCallId;
    return typeof toolCallId === "string" && toolCallId.length > 0
        ? toolCallId
        : "";
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
    if (event.eventType.startsWith("model.tool.")) {
        return readEventText(
            event,
            "toolName",
        ) || event.title || "模型工具请求";
    }
    if (event.eventType === "tool.plan.created") {
        return "工具计划";
    }
    if (event.eventType.startsWith("agent.loop.")) {
        return event.title || "智能体自动续跑";
    }
    if (event.eventType.startsWith("task.step.")) {
        return readEventText(
            event,
            "title",
        ) || event.title || "任务步骤";
    }
    if (event.eventType === "task.plan.revised") {
        return "任务计划重规划";
    }
    if (event.eventType.startsWith("tool.agent.") || event.eventType.startsWith("agent.team.")) {
        return readEventText(
            event,
            "agentName",
        ) || readEventText(
            event,
            "teamName",
        ) || event.title || "智能体协作";
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
    if (resolveProcessKind(latestEvent) === "command") {
        const commandOutputChunks = sortedEvents.filter((event) => {
            return event.eventType === "tool.command.output";
        }).map((event) => {
            return readEventText(
                event,
                "outputChunk",
            );
        }).filter((text) => {
            return text.trim().length > 0;
        });
        if (commandOutputChunks.length > 0) {
            return commandOutputChunks.join("\n");
        }
    }

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
        // 非 started 的过程事件本身已经携带“正在做什么”，需要直接展示，避免卡片只有等待文案。
        if (isVisibleProcessEvent(event) && !event.eventType.endsWith(".started")) {
            return resolveProcessSummary(event) || resolveProcessLogText(event);
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
 * resolveProcessTerminalText：生成过程卡片的终端风格正文。
 *
 * 关键逻辑：命令卡片按用户要求模拟 bash，一行真实命令后直接追加执行过程；
 * 其他工具卡片也只保留正文内容，不再在正文里渲染“请求/计划/时间线”这类 UI 小标题。
 *
 * @param sortedEvents 同一过程内按事件序号排列的事件。
 * @param title 过程卡片标题，命令卡片标题就是展示命令。
 * @param processKind 过程卡片类型。
 * @returns 可以直接放入 pre 的正文。
 */
function resolveProcessTerminalText(
    sortedEvents: EventRecord[],
    title: string,
    processKind: ProcessMessageGroupRow["processKind"],
): string {
    if (processKind === "command") {
        const commandProcessParts = sortedEvents.map((event) => {
            if (event.eventType === "tool.command.output"
                || event.eventType.endsWith(".failed")
                || event.eventType.endsWith(".completed")) {
                return resolveProcessLogText(event);
            }
            return "";
        }).filter((text) => {
            return text.trim().length > 0;
        });
        const commandLine = title.trim().length > 0
            ? `$ ${title}`
            : "$";
        return [
            commandLine,
            ...deduplicateProcessTextParts(commandProcessParts),
        ].join("\n");
    }

    const textParts = sortedEvents.map((event) => {
        return resolveProcessLogText(event);
    }).filter((text) => {
        return text.trim().length > 0;
    });
    const deduplicatedParts = deduplicateProcessTextParts(textParts);
    if (deduplicatedParts.length > 0) {
        return deduplicatedParts.join("\n");
    }
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
    ) || readEventText(
        event,
        "resultSummary",
    ) || readEventText(
        event,
        "inputSummary",
    ) || readEventText(
        event,
        "nextPlan",
    ) || readEventText(
        event,
        "reason",
    ) || event.summary;
}

/**
 * resolveProcessLogLabel：生成过程卡片内部阶段标签。
 *
 * @param event 中心服务事件。
 * @returns 面向用户的短标签。
 */
function resolveProcessLogLabel(event: EventRecord): string {
    if (event.eventType === "model.tool.requested") {
        return "请求";
    }
    if (event.eventType === "tool.plan.created") {
        return "计划";
    }
    if (event.eventType.endsWith(".started")) {
        return "开始";
    }
    if (event.eventType === "tool.command.output") {
        return "输出";
    }
    if (event.eventType.endsWith(".completed")) {
        return "完成";
    }
    if (event.eventType === "model.tool.result.appended") {
        return "回填";
    }
    if (event.eventType.endsWith(".failed") || event.eventType.endsWith(".rejected")) {
        return "失败";
    }
    return "过程";
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
        "resultSummary",
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
    ) || readEventText(
        event,
        "nextPlan",
    ) || readEventText(
        event,
        "reason",
    ) || event.summary;
}

/**
 * resolveProcessRepresentativeEvent：为聚合卡片选择最能代表标题和类型的事件。
 *
 * @param sortedEvents 同一过程内按序排列的事件。
 * @param latestEvent 最新事件。
 * @returns 优先返回真实工具执行事件；没有时返回最新事件。
 */
function resolveProcessRepresentativeEvent(
    sortedEvents: EventRecord[],
    latestEvent: EventRecord,
): EventRecord {
    const toolEvent = sortedEvents.find((event) => {
        return event.eventType.startsWith("tool.command.")
            || event.eventType.startsWith("tool.mcp.")
            || event.eventType.startsWith("tool.agent.")
            || event.eventType.startsWith("tool.call.")
            || event.eventType.startsWith("tool.skill.")
            || event.eventType.startsWith("tool.plugin.");
    });
    return toolEvent ?? latestEvent;
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
    if (event.eventType.startsWith("task.") || event.eventType === "worker.task.failed") {
        return "task";
    }
    if (event.eventType.startsWith("tool.agent.")
        || event.eventType.startsWith("agent.team.")
        || event.eventType.startsWith("agent.loop.")) {
        return "agent";
    }
    if (event.eventType.startsWith("model.")) {
        return "model";
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
    const modelInterimRowsByTurn = groupRowsByTurn(createModelInterimMarkdownRows(
        events,
        processRows,
    ));
    const streamingAssistantRowsByTurn = groupRowsByTurn(createStreamingAssistantRows(
        messages,
        events,
        modelInterimRowsByTurn,
    ));
    const consumedThinkingRowIds = new Set<string>();
    const consumedProcessRowIds = new Set<string>();
    const consumedModelInterimRowIds = new Set<string>();
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
                modelInterimRowsByTurn,
                streamingAssistantRowsByTurn,
                consumedThinkingRowIds,
                consumedProcessRowIds,
                consumedModelInterimRowIds,
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
                modelInterimRowsByTurn,
                streamingAssistantRowsByTurn,
                consumedThinkingRowIds,
                consumedProcessRowIds,
                consumedModelInterimRowIds,
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
        modelInterimRowsByTurn,
        streamingAssistantRowsByTurn,
        consumedThinkingRowIds,
        consumedProcessRowIds,
        consumedModelInterimRowIds,
        consumedStreamingAssistantRowIds,
    );
    return rows;
}

/**
 * createStreamingAssistantRows：从模型 SSE delta 事件派生临时最终助手消息。
 *
 * @param messages 当前会话固化消息。
 * @param events 当前会话事件数组。
 * @returns 仅包含尚未固化助手消息的临时助手行。
 */
function createStreamingAssistantRows(
    messages: ConversationMessage[],
    events: EventRecord[],
    modelInterimRowsByTurn: Map<string, ModelInterimMarkdownRow[]>,
): StreamingAssistantRow[] {
    const assistantTurnIds = new Set(messages.filter((message) => {
        return message.role === "assistant" && message.turnId !== null;
    }).map((message) => {
        return message.turnId as string;
    }));
    const groups = new Map<string, EventRecord[]>();

    for (const event of events) {
        if (event.eventType !== "model.stream.delta"
            || !event.turnId
            || assistantTurnIds.has(event.turnId)
            || isConsumedByModelInterimRow(
                event,
                modelInterimRowsByTurn,
            )) {
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
 * createModelInterimMarkdownRows：把工具过程之前或过程之间的模型文字拆为无标题 Markdown 卡片。
 *
 * 关键逻辑：如果同一轮后续还存在工具过程，当前模型文字就是中途解释；
 * 如果模型文字后面没有工具过程，则保留给临时最终助手消息，避免最终回复被重复渲染。
 *
 * @param events 当前会话事件数组。
 * @param processRows 已聚合工具过程，用于确定工具过程序号边界。
 * @returns 模型中途 Markdown 卡片数组。
 */
function createModelInterimMarkdownRows(
    events: EventRecord[],
    processRows: ProcessMessageGroupRow[],
): ModelInterimMarkdownRow[] {
    const processOrderByTurn = new Map<string, number[]>();
    for (const process of processRows) {
        if (!process.turnId) {
            continue;
        }
        processOrderByTurn.set(
            process.turnId,
            [
                ...(processOrderByTurn.get(process.turnId) ?? []),
                process.orderSequence,
            ],
        );
    }

    const groups = new Map<string, EventRecord[]>();
    for (const event of events) {
        if (event.eventType !== "model.stream.delta" || !event.turnId) {
            continue;
        }
        const laterProcessSequence = resolveNextProcessSequence(
            event,
            processOrderByTurn,
        );
        if (laterProcessSequence === null) {
            continue;
        }
        const groupKey = [
            event.turnId,
            laterProcessSequence,
        ].join(":");
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
            rowId: `model-interim-${groupKey}`,
            turnId: firstEvent.turnId,
            taskId: firstEvent.taskId,
            contentMarkdown,
            eventIds: sortedEvents.map((event) => {
                return event.eventId;
            }),
            orderSequence: firstEvent.sequence,
        };
    }).filter((row) => {
        return row.contentMarkdown.trim().length > 0;
    });
}

/**
 * resolveNextProcessSequence：查找当前模型文字之后最近的工具过程序号。
 *
 * @param event 模型流式片段事件。
 * @param processOrderByTurn 每个轮次内的过程首序号。
 * @returns 后续过程序号；没有后续过程时返回 null。
 */
function resolveNextProcessSequence(
    event: EventRecord,
    processOrderByTurn: Map<string, number[]>,
): number | null {
    if (!event.turnId) {
        return null;
    }
    const processOrders = processOrderByTurn.get(event.turnId) ?? [];
    const laterOrders = processOrders.filter((orderSequence) => {
        return orderSequence > event.sequence;
    }).sort((left, right) => {
        return left - right;
    });
    return laterOrders[0] ?? null;
}

/**
 * isConsumedByModelInterimRow：判断模型流式片段是否已经归入中途 Markdown 卡片。
 *
 * @param event 模型流式片段事件。
 * @param modelInterimRowsByTurn 中途 Markdown 卡片索引。
 * @returns 已被中途卡片消费时返回 true。
 */
function isConsumedByModelInterimRow(
    event: EventRecord,
    modelInterimRowsByTurn: Map<string, ModelInterimMarkdownRow[]>,
): boolean {
    if (!event.turnId) {
        return false;
    }
    const interimRows = modelInterimRowsByTurn.get(event.turnId) ?? [];
    return interimRows.some((row) => {
        return row.eventIds.includes(event.eventId);
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
    modelInterimRowsByTurn: Map<string, ModelInterimMarkdownRow[]>,
    streamingAssistantRowsByTurn: Map<string, StreamingAssistantRow[]>,
    consumedThinkingRowIds: Set<string>,
    consumedProcessRowIds: Set<string>,
    consumedModelInterimRowIds: Set<string>,
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
        ...(modelInterimRowsByTurn.get(turnId) ?? []).map((interim) => {
            return {
                kind: "model-interim" as const,
                orderSequence: interim.orderSequence,
                row: interim,
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

        if (item.kind === "model-interim") {
            if (consumedModelInterimRowIds.has(item.row.rowId)) {
                continue;
            }
            consumedModelInterimRowIds.add(item.row.rowId);
            rows.push({
                rowKind: "model_interim",
                rowId: item.row.rowId,
                interim: item.row,
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
    modelInterimRowsByTurn: Map<string, ModelInterimMarkdownRow[]>,
    streamingAssistantRowsByTurn: Map<string, StreamingAssistantRow[]>,
    consumedThinkingRowIds: Set<string>,
    consumedProcessRowIds: Set<string>,
    consumedModelInterimRowIds: Set<string>,
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
    for (const interimRows of modelInterimRowsByTurn.values()) {
        for (const interim of interimRows) {
            if (consumedModelInterimRowIds.has(interim.rowId)) {
                continue;
            }
            rows.push({
                rowKind: "model_interim",
                rowId: interim.rowId,
                interim,
            });
        }
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
