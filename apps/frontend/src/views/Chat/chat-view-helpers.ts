import type {
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
}

/**
 * createProcessMessageRow：把事件转换为过程消息行。
 *
 * @param event 中心服务事件。
 * @returns 过程消息行。
 */
export function createProcessMessageRow(event: EventRecord): ProcessMessageRow {
    if (event.eventType.startsWith("thinking.")) {
        return {
            rowId: event.eventId,
            kind: "thinking",
            event,
            title: event.eventType === "thinking.completed" ? "思考完成 · 阶段状态：完成" : "思考中 · 阶段状态：生成中",
            summary: event.summary || "无思考内容：中心服务未返回可展示的思考片段。",
        };
    }

    if (event.eventType.startsWith("model.stream.")) {
        return {
            rowId: event.eventId,
            kind: "stream",
            event,
            title: event.eventType === "model.stream.completed" ? "流式输出完成 · 阶段状态：完成" : "流式输出中 · 阶段状态：生成中",
            summary: readEventText(
                event,
                "deltaText",
            ) || event.summary,
        };
    }

    return {
        rowId: event.eventId,
        kind: "tool",
        event,
        title: event.eventType,
        summary: event.summary,
    };
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
