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
        | "stream"
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
    /** kind: 过程类型。 */
    kind:
        | "stream"
        | "tool";
    /** title: 展示标题。 */
    title: string;
    /** statusLabel: 当前聚合过程状态。 */
    statusLabel: string;
    /** traceId: 最近事件排查 ID。 */
    traceId: string;
    /** summary: 聚合摘要。 */
    summary: string;
    /** logs: 同一过程内按 sequence 排列的日志。 */
    logs: Array<{
        /** eventId: 事件 ID。 */
        eventId: string;
        /** statusLabel: 当前片段状态中文文案。 */
        statusLabel: string;
        /** text: 日志或过程输出。 */
        text: string;
        /** occurredAt: 统一格式时间。 */
        occurredAt: string;
    }>;
}

/**
 * ThinkingProcessRow：按轮次合并后的思考过程行。
 */
export interface ThinkingProcessRow {
    /** rowId: 合并行唯一 ID，优先使用 turnId。 */
    rowId: string;
    /** turnId: 所属轮次 ID，来自中心服务事件；无轮次时为 null。 */
    turnId: string | null;
    /** taskId: 所属任务 ID，来自中心服务事件；无任务时为 null。 */
    taskId: string | null;
    /** title: 思考块标题。 */
    title: string;
    /** statusLabel: 当前阶段状态中文说明。 */
    statusLabel: string;
    /** defaultOpen: 是否默认展开，只影响浏览器当前 UI。 */
    defaultOpen: boolean;
    /** traceId: 最近事件排查 ID。 */
    traceId: string;
    /** segments: 思考阶段片段数组。 */
    segments: Array<{
        /** eventId: 片段事件 ID。 */
        eventId: string;
        /** statusLabel: 片段状态中文说明。 */
        statusLabel: string;
        /** summary: 片段摘要。 */
        summary: string;
    }>;
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
            summary: event.summary || "无思考内容：中心服务未返回可展示的思考片段。",
            statusLabel: statusMeta.label,
        };
    }

    if (event.eventType.startsWith("model.stream.")) {
        return {
            rowId: event.eventId,
            kind: "stream",
            event,
            title: statusMeta.status === "completed"
                ? "流式输出完成"
                : "流式输出中",
            summary: readEventText(
                event,
                "deltaText",
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
            "model.stream.delta",
            "model.stream.completed",
            "model.failed",
            "message.turn.failed",
            "worker.task.failed",
            "tool.command.started",
            "tool.command.output",
            "tool.command.completed",
            "tool.call.started",
            "tool.call.output",
            "tool.call.completed",
            "tool.plugin.unavailable",
            "tool.mcp.unavailable",
            "tool.skill.unavailable",
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
        const kind = latestEvent.eventType.startsWith("model.")
            ? "stream"
            : "tool";
        const title = resolveProcessGroupTitle(latestEvent);
        return {
            rowId: `process-${groupKey}`,
            kind,
            title,
            statusLabel: hasFailed
                ? "失败"
                : isRunning
                    ? "执行中"
                    : "已完成",
            traceId: latestEvent.traceId,
            summary: resolveProcessSummary(latestEvent),
            logs: statusEntries.map((entry) => {
                return {
                    eventId: entry.event.eventId,
                    statusLabel: entry.statusMeta.label,
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
    const toolKind = typeof payload.toolKind === "string"
        ? payload.toolKind
        : event.eventType.startsWith("model.stream.")
            ? "model-stream"
            : "tool";
    return [
        event.turnId ?? "no-turn",
        event.taskId ?? "no-task",
        toolKind,
    ].join(":");
}

/**
 * resolveProcessGroupTitle：生成过程卡片标题。
 *
 * @param event 同组最新事件。
 * @returns 用户可见标题。
 */
function resolveProcessGroupTitle(event: EventRecord): string {
    if (event.eventType.startsWith("model.")) {
        return "模型流式输出";
    }
    if (event.eventType === "message.turn.failed" || event.eventType === "worker.task.failed") {
        return "对话执行失败";
    }
    if (event.eventType.startsWith("tool.command.")) {
        return "命令工具调用";
    }
    if (event.eventType.startsWith("tool.call.")) {
        return "工具调用过程";
    }
    if (event.eventType.startsWith("tool.mcp.")) {
        return "MCP 调用过程";
    }
    if (event.eventType.startsWith("tool.plugin.")) {
        return "插件调用过程";
    }
    if (event.eventType.startsWith("tool.skill.")) {
        return "skill 调用过程";
    }
    return "工具调用过程";
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
 * createMergedThinkingRows：把同一轮思考事件合并成单个展示块。
 *
 * @param events 中心服务事件数组。
 * @returns 按轮次或任务合并后的思考块数组。
 */
export function createMergedThinkingRows(events: EventRecord[]): ThinkingProcessRow[] {
    const groups = new Map<string, EventRecord[]>();
    for (const event of events) {
        if (!event.eventType.startsWith("thinking.")) {
            continue;
        }
        // groupKey: 优先使用 turnId，避免同一轮多个思考片段分散展示；无 turnId 时退到 taskId 或事件 ID。
        const groupKey = event.turnId ?? event.taskId ?? event.eventId;
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
        return {
            rowId: `thinking-${groupKey}`,
            turnId: latestEvent.turnId,
            taskId: latestEvent.taskId,
            title: isRunning
                ? "思考中"
                : "思考过程",
            statusLabel: hasFailed
                ? "失败"
                : isRunning
                    ? "生成中"
                    : "已完成",
            defaultOpen: isRunning,
            traceId: latestEvent.traceId,
            segments: statusEntries.map((entry) => {
                return {
                    eventId: entry.event.eventId,
                    statusLabel: entry.statusMeta.label,
                    summary: readEventText(
                        entry.event,
                        "thinkingText",
                    ) || entry.event.summary || "无思考内容：中心服务未返回可展示的思考片段。",
                };
            }),
        };
    });
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
    const limitText = input.limitTokens > 0
        ? `${input.limitTokens} token`
        : "未配置窗口上限";
    const modelText = input.modelId.trim().length > 0
        ? input.modelId
        : "未选择模型";
    const sourceText = input.source.trim().length > 0
        ? input.source
        : "中心服务 tokenizer 统计待返回";
    return [
        `已用：${input.usedTokens} token`,
        `窗口上限：${limitText}`,
        `占用比例：${input.percentText}`,
        `模型：${modelText}`,
        `输入范围：当前会话消息、草稿、项目引用 ${input.referenceCount} 项、附件 ${input.attachmentCount} 项`,
        `统计来源：${sourceText}`,
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
