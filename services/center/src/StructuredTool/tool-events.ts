import type {
    UnifiedToolCapability,
} from "@zhixin/shared";
import {
    EVENT_SCOPE_TYPES,
    EVENT_TYPE_PREFIXES,
    EVENT_TYPE_SUFFIXES,
    TASK_STATUSES,
} from "@zhixin/shared";

import type {CenterEventStore} from "../events.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
} from "../domain/turn-graph-domain.js";
import {
    listUnifiedToolCapabilities,
} from "./tool-capability-registry.js";

/**
 * appendToolVisibilityEvents：写入自动工具使用可见过程。
 *
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @returns 没有返回值。
 */
export function appendToolVisibilityEvents(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    graphCheckpoint?: TurnGraphCheckpoint,
): void {
    for (const capability of listUnifiedToolCapabilities()) {
        if (capability.availability === "available") {
            continue;
        }
        appendUnifiedToolUnavailableEvent(
            events,
            sessionId,
            taskId,
            turnId,
            capability,
            graphCheckpoint,
        );
    }
}

/**
 * appendUnifiedToolUnavailableEvent：用统一事件模型写入不可用工具状态。
 *
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param capability 工具能力。
 * @returns 没有返回值。
 */
function appendUnifiedToolUnavailableEvent(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    capability: UnifiedToolCapability,
    graphCheckpoint?: TurnGraphCheckpoint,
): void {
    events.append({
        eventType: `${EVENT_TYPE_PREFIXES.TOOL}${capability.toolKind}${EVENT_TYPE_SUFFIXES.UNAVAILABLE}`,
        scopeType: EVENT_SCOPE_TYPES.TOOL,
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: TASK_STATUSES.COMPLETED,
        title: `${capability.displayName}状态`,
        summary: `当前会话未解析到可执行${capability.displayName}，已记录为不可用状态。`,
        payload: withOptionalGraphCheckpoint({
            toolId: capability.toolId,
            toolKind: capability.toolKind,
            availability: capability.availability,
            requiredPermission: capability.requiredPermission,
            unavailableReason: capability.unavailableReason,
        }, graphCheckpoint),
    });
}
