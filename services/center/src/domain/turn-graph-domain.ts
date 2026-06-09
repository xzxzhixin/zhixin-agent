import {createHash} from "node:crypto";

import type {TaskRecord} from "@zhixin/shared";

/**
 * TurnGraphNodeKind：对话图节点类型。
 *
 * 来源：中心服务对话执行编排。
 * 含义：描述节点职责，供历史恢复和任务详情展示。
 * 格式：固定字符串枚举。
 * 默认值：无。
 * 约束：第一版只覆盖当前线性编排节点，后续 graph runner 可继续扩展。
 */
export type TurnGraphNodeKind = "control" | "thinking" | "model" | "tool" | "extension" | "message" | "memory" | "usage";

/**
 * TurnGraphCheckpoint：对话图检查点元数据。
 *
 * 来源：中心服务在每个可恢复节点边界写入事件 payload.graph。
 * 含义：记录当前会话当前轮次执行到哪个节点、属于第几个 superstep、失败后应从哪里恢复。
 * 格式：可 JSON 序列化对象。
 * 默认值：无。
 * 约束：checkpoint 只保存恢复索引和摘要，不保存模型 token 或命令输出正文。
 */
export interface TurnGraphCheckpoint {
    /** graphRunId: 当前图执行 ID，使用 turnId 保证一轮对话一个图运行。 */
    graphRunId: string;
    /** threadId: 当前对话线程 ID，映射为 sessionId。 */
    threadId: string;
    /** nodeId: 图节点稳定 ID，例如 model.stream。 */
    nodeId: string;
    /** nodeKind: 图节点类型。 */
    nodeKind: TurnGraphNodeKind;
    /** superstep: 图执行层级序号，从 1 开始递增。 */
    superstep: number;
    /** checkpointId: 当前检查点稳定 ID。 */
    checkpointId: string;
    /** parentCheckpointId: 上一个节点检查点 ID，首节点为 null。 */
    parentCheckpointId: string | null;
    /** attempt: 当前节点尝试次数，第一版固定为 1。 */
    attempt: number;
    /** idempotencyKey: 副作用节点幂等键，恢复时避免重复执行。 */
    idempotencyKey: string;
    /** resumable: 是否允许从该节点完成边界恢复。 */
    resumable: boolean;
    /** nextNodeIds: 节点完成后可能进入的下一个节点 ID。 */
    nextNodeIds: string[];
    /** stateSummary: 节点状态摘要，供任务详情和恢复排查展示。 */
    stateSummary: string;
}

/**
 * TurnGraphContext：当前轮次图执行上下文。
 *
 * 来源：send message 返回的 sessionId、turnId、taskId。
 * 含义：为本轮所有节点生成统一 checkpoint。
 * 格式：不可持久化的运行期对象。
 * 默认值：无。
 * 约束：只在中心服务主进程内使用，不传给客户端。
 */
export interface TurnGraphContext {
    /** graphRunId: 当前图执行 ID。 */
    graphRunId: string;
    /** threadId: 当前对话线程 ID。 */
    threadId: string;
    /** taskId: 当前默认任务 ID。 */
    taskId: string;
}

/**
 * createTurnGraphContext：创建当前轮次图上下文。
 *
 * @param input 会话、轮次和任务身份。
 * @returns 图执行上下文。
 */
export function createTurnGraphContext(input: {
    sessionId: string;
    turnId: string;
    taskId: string;
}): TurnGraphContext {
    return {
        graphRunId: input.turnId,
        threadId: input.sessionId,
        taskId: input.taskId,
    };
}

/**
 * createTurnGraphCheckpoint：生成节点检查点。
 *
 * @param context 图执行上下文。
 * @param input 节点元数据。
 * @returns 可写入事件 payload.graph 的检查点。
 */
export function createTurnGraphCheckpoint(
    context: TurnGraphContext,
    input: {
        nodeId: string;
        nodeKind: TurnGraphNodeKind;
        superstep: number;
        parentNodeId: string | null;
        nextNodeIds: string[];
        stateSummary: string;
        resumable?: boolean;
        attempt?: number;
    },
): TurnGraphCheckpoint {
    const attempt = input.attempt ?? 1;
    const checkpointSeed = [
        context.graphRunId,
        input.nodeId,
        input.superstep,
        attempt,
    ].join(":");
    const parentCheckpointId = input.parentNodeId
        ? createStableCheckpointId(
            context.graphRunId,
            input.parentNodeId,
        )
        : null;

    return {
        graphRunId: context.graphRunId,
        threadId: context.threadId,
        nodeId: input.nodeId,
        nodeKind: input.nodeKind,
        superstep: input.superstep,
        checkpointId: createStableCheckpointId(
            checkpointSeed,
            "checkpoint",
        ),
        parentCheckpointId,
        attempt,
        idempotencyKey: [
            context.taskId,
            input.nodeId,
            attempt,
        ].join(":"),
        resumable: input.resumable ?? true,
        nextNodeIds: input.nextNodeIds,
        stateSummary: input.stateSummary,
    };
}

/**
 * withTurnGraphCheckpoint：把 graph 检查点合并进事件 payload。
 *
 * @param payload 原事件载荷。
 * @param graphCheckpoint 图检查点。
 * @returns 带 graph 字段的新载荷。
 */
export function withTurnGraphCheckpoint<TPayload extends Record<string, unknown>>(
    payload: TPayload,
    graphCheckpoint: TurnGraphCheckpoint,
): TPayload & {
    graph: TurnGraphCheckpoint;
} {
    return {
        ...payload,
        graph: graphCheckpoint,
    };
}

/**
 * withOptionalGraphCheckpoint：兼容尚未接入图编排的旧事件调用方。
 *
 * @param payload 原事件载荷。
 * @param graphCheckpoint 可选图检查点。
 * @returns 原载荷或带 graph 字段的新载荷。
 */
export function withOptionalGraphCheckpoint<TPayload extends Record<string, unknown>>(
    payload: TPayload,
    graphCheckpoint?: TurnGraphCheckpoint,
): TPayload | (TPayload & {
    graph: TurnGraphCheckpoint;
}) {
    if (!graphCheckpoint) {
        return payload;
    }
    return withTurnGraphCheckpoint(
        payload,
        graphCheckpoint,
    );
}

/**
 * stepTaskFromGraphContext：为步骤创建函数提供任务上下文。
 *
 * @param context 图执行上下文。
 * @returns 任务记录兼容对象。
 */
export function stepTaskFromGraphContext(context: TurnGraphContext): TaskRecord {
    const now = new Date().toISOString();
    return {
        taskId: context.taskId,
        turnId: context.graphRunId,
        sessionId: context.threadId,
        status: "running",
        title: "对话图执行",
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * createStableCheckpointId：生成稳定短 ID。
 *
 * @param parts 组成 checkpoint 的稳定片段。
 * @returns 带 graph-checkpoint 前缀的短哈希。
 */
function createStableCheckpointId(...parts: string[]): string {
    return `graph-checkpoint-${createHash("sha256")
        .update(parts.join(":"))
        .digest("hex")
        .slice(0, 16)}`;
}
