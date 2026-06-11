import {
    computed,
    type ComputedRef,
} from "vue";

import {
    type AgentStatusTreeNode,
    type ComposerEditFile,
} from "@stores/app";
import type {
    ConversationMessage,
    ConversationTurn,
    EventRecord,
    TaskRecord,
} from "@zhixin/shared";

import {
    createGroupedProcessRows,
    createMergedThinkingRows,
    formatOptionalElapsed,
    formatTaskElapsed,
    formatTaskStatus,
    resolveTaskStatusMeta,
    type ProcessMessageGroupRow,
    type ThinkingProcessRow,
} from "./chat-view-helpers";

/**
 * TaskPanelRow：任务详情弹框统一展示行。
 *
 * 来源：中心服务当前会话任务、任务步骤和事件日志。
 * 含义：输入区任务入口、任务详情弹框和智能体对话内任务区共用同一结构。
 * 格式：任务基础字段、步骤数组、当前轮次提示。
 * 默认值：无真实任务时返回明确空态行。
 * 约束：不能用对话次数冒充任务数量。
 */
export interface TaskPanelRow {
    /** id: 任务行唯一标识，来源于 taskId 或固定空态 ID。 */
    id: string;
    /** title: 任务标题，来源于中心服务 task.title。 */
    title: string;
    /** status: 任务状态中文文案，来源于共享 TaskStatus 映射。 */
    status: string;
    /** summary: 任务状态说明，包含当前对话当前轮次作用域。 */
    summary: string;
    /** elapsed: 任务耗时，来源于 createdAt/updatedAt。 */
    elapsed: string;
    /** traceId: 最近任务事件排查 ID。 */
    traceId: string;
    /** traceIdUnavailableReason: 排查 ID 未出现时的固定说明。 */
    traceIdUnavailableReason: string;
    /** failureReason: 失败步骤摘要；非失败时为 null。 */
    failureReason: string | null;
    /** scopeHint: 状态作用域说明，避免误解为全局队列。 */
    scopeHint: string;
    /** currentTurnNotice: 当前轮次排队、引导或确认提示。 */
    currentTurnNotice: string;
    /** steps: 当前任务步骤列表。 */
    steps: Array<{
        /** id: 步骤 ID。 */
        id: string;
        /** title: 步骤标题。 */
        title: string;
        /** status: 步骤状态中文文案。 */
        status: string;
        /** elapsed: 步骤耗时。 */
        elapsed: string;
        /** positionText: 步骤序号，格式为 当前序号/总数。 */
        positionText: string;
        /** traceId: 步骤所属任务最近排查 ID。 */
        traceId: string;
    }>;
}

/**
 * ChatConversationContext：完整对话视图统一能力。
 *
 * 来源：当前 Pinia store 和中心服务会话详情。
 * 含义：普通对话、项目对话和智能体对话弹框共用的消息、任务、事件和发送能力。
 * 格式：计算属性与发送函数集合。
 * 默认值：没有会话时返回空数组和空态任务。
 * 约束：conversationId 是唯一驱动 ID，不按标题、项目名或智能体名猜测。
 */
export interface ChatConversationContext {
    /** conversationId: 当前真实会话 ID；未创建草稿时为 null。 */
    conversationId: ComputedRef<string | null>;
    /** messages: 当前会话消息列表。 */
    messages: ComputedRef<ConversationMessage[]>;
    /** turns: 当前会话轮次列表。 */
    turns: ComputedRef<ConversationTurn[]>;
    /** events: 当前订阅事件列表。 */
    events: ComputedRef<EventRecord[]>;
    /** activeTasks: 当前会话任务列表。 */
    activeTasks: ComputedRef<TaskRecord[]>;
    /** currentTurnTasks: 当前轮次任务编排列表，不包含历史轮次任务。 */
    currentTurnTasks: ComputedRef<TaskRecord[]>;
    /** taskPanelRows: 任务详情统一展示行。 */
    taskPanelRows: ComputedRef<TaskPanelRow[]>;
    /** thinkingProcessRows: 按轮次合并后的思考过程。 */
    thinkingProcessRows: ComputedRef<ThinkingProcessRow[]>;
    /** processMessageRows: 按同一过程聚合后的流式、命令、MCP 和工具过程。 */
    processMessageRows: ComputedRef<ProcessMessageGroupRow[]>;
    /** currentTurnNotice: 当前对话当前轮次的排队、引导和确认提示。 */
    currentTurnNotice: ComputedRef<string>;
    /** sendDraftForConversation: 使用统一输入草稿发送消息。 */
    sendDraftForConversation: () => Promise<void>;
    /** sendGuidanceForConversation: 使用当前草稿按引导语义发送。 */
    sendGuidanceForConversation: (target: AgentStatusTreeNode | null) => Promise<void>;
    /** composerEditFiles: 当前编辑摘要文件列表。 */
    composerEditFiles: ComputedRef<ComposerEditFile[]>;
}

/**
 * useChatConversation：创建完整对话组合能力。
 *
 * @param appStore Pinia 主状态容器。
 * @returns 普通对话、项目对话和智能体对话共享的完整对话上下文。
 */
export function useChatConversation(appStore: {
    activeSessionId: string | null;
    sessionDetail: {
        session: {
            sessionId: string;
        };
        messages: ConversationMessage[];
        turns: ConversationTurn[];
        tasks: TaskRecord[];
        taskSteps: Array<{
            stepId: string;
            taskId: string;
            source?: string;
            title: string;
            status: string;
            summary: string | null;
            startedAt: string | null;
            endedAt: string | null;
        }>;
    } | null;
    events: EventRecord[];
    draft: {
        text: string;
    };
    composerEditFiles: ComposerEditFile[];
    sendDraft: () => Promise<void>;
    requireRealtimeRequest: <TResponse>(type: string, payload: unknown) => Promise<TResponse>;
    loadNavigationData: () => Promise<void>;
    loadActiveSessionSnapshot: () => Promise<void>;
    updateComposerContextUsageFromExecution: () => Promise<void>;
}): ChatConversationContext {
    const conversationId = computed(() => {
        return appStore.sessionDetail?.session.sessionId ?? appStore.activeSessionId;
    });
    const messages = computed(() => {
        return appStore.sessionDetail?.messages ?? [];
    });
    const turns = computed(() => {
        return appStore.sessionDetail?.turns ?? [];
    });
    const events = computed(() => {
        return appStore.events;
    });
    const activeTasks = computed(() => {
        return appStore.sessionDetail?.tasks ?? [];
    });
    const currentTurnTasks = computed(() => {
        return resolveCurrentTurnTaskScope(
            turns.value,
            activeTasks.value,
        );
    });
    const currentTurnNotice = computed(() => {
        return resolveCurrentTurnNotice(turns.value);
    });
    const taskPanelRows = computed<TaskPanelRow[]>(() => {
        return createTaskPanelRows(
            currentTurnTasks.value,
            appStore.sessionDetail?.taskSteps ?? [],
            events.value,
            currentTurnNotice.value,
        );
    });
    const thinkingProcessRows = computed(() => {
        return createMergedThinkingRows(events.value);
    });
    const processMessageRows = computed(() => {
        return createGroupedProcessRows(events.value);
    });
    const composerEditFiles = computed(() => {
        return appStore.composerEditFiles;
    });

    return {
        conversationId,
        messages,
        turns,
        events,
        activeTasks,
        currentTurnTasks,
        taskPanelRows,
        thinkingProcessRows,
        processMessageRows,
        currentTurnNotice,
        sendDraftForConversation: async () => {
            await appStore.sendDraft();
        },
        sendGuidanceForConversation: async (target) => {
            const messageText = appStore.draft.text.trim();
            if (messageText.length === 0) {
                return;
            }
            // 引导必须合并进当前轮次；这里调用已有 WebSocket 引导动作，避免走普通发送创建新轮次。
            const contentMarkdown = target
                ? `引导 @${target.name}：${messageText}`
                : `针对当前对话当前轮次补充引导：${messageText}`;
            appStore.draft.text = "";
            await submitGuidanceToCurrentTurn(
                appStore,
                contentMarkdown,
            );
        },
        composerEditFiles,
    };
}

/**
 * resolveCurrentTurnTaskScope：解析输入区应展示的当前轮次任务。
 *
 * @param turns 当前会话轮次列表。
 * @param tasks 当前会话任务列表。
 * @returns 当前运行轮次任务；没有运行轮次时返回最新一轮任务。
 */
function resolveCurrentTurnTaskScope(
    turns: ConversationTurn[],
    tasks: TaskRecord[],
): TaskRecord[] {
    const latestActiveTurn = [...turns].reverse().find((turn) => {
        return turn.endedAt === null
            && (turn.status === "queued"
                || turn.status === "running"
                || turn.status === "waiting_user");
    });
    // latestTurn: 没有运行轮次时只展示最新一轮的编排结果，避免把历史对话次数累计成任务数量。
    const latestTurn = latestActiveTurn ?? [...turns].reverse()[0] ?? null;
    const currentTurnId = latestTurn?.turnId ?? null;
    if (!currentTurnId) {
        return [];
    }

    return tasks.filter((task) => {
        return task.turnId === currentTurnId;
    });
}

/**
 * createTaskPanelRows：从中心服务任务和步骤创建详情行。
 *
 * @param tasks 当前会话任务列表。
 * @param taskSteps 当前会话任务步骤列表。
 * @param events 当前会话事件列表。
 * @param currentTurnNotice 当前轮次提示。
 * @returns 任务详情展示行。
 */
export function createTaskPanelRows(
    tasks: TaskRecord[],
    taskSteps: Array<{
        stepId: string;
        taskId: string;
        source?: string;
        title: string;
        status: string;
        summary: string | null;
        startedAt: string | null;
        endedAt: string | null;
    }>,
    events: EventRecord[],
    currentTurnNotice: string,
): TaskPanelRow[] {
    return tasks.flatMap((task) => {
        const visibleSteps = filterVisibleDecompositionSteps(
            task.taskId,
            taskSteps,
        );
        if (visibleSteps.length <= 1) {
            return [];
        }
        const traceId = resolveTaskTraceId(
            events,
            task.taskId,
        );
        const statusMeta = resolveTaskStatusMeta(task.status);
        return [
            {
                id: task.taskId,
                title: normalizeTaskTitle(task.title),
                status: formatTaskStatus(task.status),
                summary: statusMeta.title,
                elapsed: formatTaskElapsed(
                    task.createdAt,
                    task.updatedAt,
                ),
                traceId,
                traceIdUnavailableReason: traceId === "等待中心服务事件"
                    ? "TRACE_ID_PENDING：该任务仍在等待中心服务写入事件排查 ID。"
                    : "",
                failureReason: null,
                scopeHint: "作用域：当前对话当前轮次；排队、等待用户和确认不会阻塞其他对话。",
                currentTurnNotice,
                steps: visibleSteps.map((step, stepIndex) => {
                    return {
                        id: step.stepId,
                        title: step.title,
                        status: formatTaskStatus(step.status),
                        elapsed: formatOptionalElapsed(
                            step.startedAt,
                            step.endedAt,
                        ),
                        positionText: `${stepIndex + 1}/${visibleSteps.length}`,
                        traceId,
                    };
                }),
            },
        ];
    });
}

/**
 * filterVisibleDecompositionSteps：筛选单个任务下可展示的拆解步骤。
 *
 * @param taskId 当前任务 ID。
 * @param taskSteps 当前会话或智能体范围内的任务步骤。
 * @returns 同一任务下的可见拆解步骤。
 */
function filterVisibleDecompositionSteps(
    taskId: string,
    taskSteps: Array<{
        stepId: string;
        taskId: string;
        planVersion?: number;
        source?: string;
        title: string;
        status: string;
        summary: string | null;
        startedAt: string | null;
        endedAt: string | null;
    }>,
) {
    const visibleSteps = taskSteps.filter((step) => {
        return step.taskId === taskId
            && step.source !== "graph";
    });
    const latestPlanVersion = visibleSteps.reduce((current, step) => {
        return Math.max(
            current,
            step.planVersion ?? 1,
        );
    }, 1);
    // latestPlanVersion: todoList 多次重规划会保留历史版本；任务面板只展示最新计划，避免旧计划和新计划叠成重复任务。
    return visibleSteps.filter((step) => {
        return (step.planVersion ?? 1) === latestPlanVersion
            && step.status !== "superseded";
    });
}

/**
 * submitGuidanceToCurrentTurn：把当前输入作为运行中轮次引导提交。
 *
 * @param appStore Pinia 主状态容器。
 * @param contentMarkdown 引导 Markdown 正文。
 * @returns 引导提交完成后没有返回值。
 */
async function submitGuidanceToCurrentTurn(
    appStore: {
        activeSessionId: string | null;
        requireRealtimeRequest: <TResponse>(type: string, payload: unknown) => Promise<TResponse>;
        loadNavigationData: () => Promise<void>;
        loadActiveSessionSnapshot: () => Promise<void>;
        updateComposerContextUsageFromExecution: () => Promise<void>;
    },
    contentMarkdown: string,
): Promise<void> {
    if (!appStore.activeSessionId) {
        return;
    }
    // session.guidance.submit 是运行中引导的既有协议，必须合并当前轮次而不是走普通 sendDraft。
    await appStore.requireRealtimeRequest<{
        /** taskId: 被合并的当前任务 ID。 */
        taskId: string;
        /** turnId: 被合并的当前轮次 ID。 */
        turnId: string;
        /** stepId: 新增或更新的引导步骤 ID。 */
        stepId: string;
        /** status: 中心服务确认的引导合并状态。 */
        status: "merged";
    }>("session.guidance.submit", {
        sessionId: appStore.activeSessionId,
        contentMarkdown,
    });
    await appStore.loadNavigationData();
    await appStore.loadActiveSessionSnapshot();
    await appStore.updateComposerContextUsageFromExecution();
}

/**
 * normalizeTaskTitle：把旧数据中的伪 Agent 状态标题转换为真实任务容器标题。
 *
 * @param title 中心服务任务标题。
 * @returns 用户可见任务标题。
 */
function normalizeTaskTitle(title: string): string {
    if (title === "等待 Agent 执行") {
        return "本轮对话任务";
    }
    return title;
}

/**
 * resolveTaskTraceId：读取任务最近事件排查 ID。
 *
 * @param events 当前会话事件列表。
 * @param taskId 任务 ID。
 * @returns 最近事件排查 ID；没有事件时返回等待说明。
 */
function resolveTaskTraceId(
    events: EventRecord[],
    taskId: string,
): string {
    const taskEvent = [...events].reverse().find((event) => {
        return event.taskId === taskId;
    });
    return taskEvent?.traceId ?? "等待中心服务事件";
}

/**
 * resolveCurrentTurnNotice：生成当前对话当前轮次提示。
 *
 * @param turns 当前会话轮次列表。
 * @returns 当前轮次状态提示。
 */
function resolveCurrentTurnNotice(turns: ConversationTurn[]): string {
    const activeTurn = [...turns].reverse().find((turn) => {
        return turn.endedAt === null;
    });
    if (!activeTurn) {
        return "当前对话没有运行中的轮次。";
    }
    if (activeTurn.status === "queued") {
        return "当前对话当前轮次排队中：仅等待本对话上一项处理，不影响其他对话。";
    }
    if (activeTurn.status === "waiting_user") {
        return "当前对话当前轮次等待用户引导、审批或确认。";
    }
    if (activeTurn.status === "running") {
        return "当前对话当前轮次正在执行。";
    }
    return "当前对话当前轮次状态已由中心服务更新。";
}
