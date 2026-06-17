import type {
    SessionUpdatedPayload,
} from "@zhixin/api-client";
import {
    markRaw,
} from "vue";

import {
    CenterApiError,
    ReconnectingWebSocketClient,
} from "@zhixin/api-client";
import {
    createEmptyComposerDraft,
    canSendComposerDraft,
    type ComposerAttachmentDraft,
} from "@zhixin/ui";
import type {
    AgentSubConversationDetail,
    EventRecord,
    PendingEditRecord,
    SessionDetailResult,
} from "@zhixin/shared";

/**
 * TaskUpdatedPayload：中心服务 task.updated 事件和专项 WebSocket 包的载荷。
 *
 * 来源：中心服务 `task.updated` 事件 payload。
 * 含义：描述任务所属会话、任务和最新状态。
 * 格式：JSON 对象。
 * 默认值：无；字段缺失时只能按无归属处理，不能猜测其他候选字段。
 * 约束：`status` 是任务完成判断的事实字段，不能读取 EventRecord 上不存在的 `status`。
 */
interface TaskUpdatedPayload {
    /** sessionId：任务所属会话 ID，专项包可能缺失时只用于辅助归属判断。 */
    sessionId?: string;
    /** taskId：任务 ID，来自中心服务任务表。 */
    taskId?: string;
    /** status：任务最新状态，completed 表示任务已完成。 */
    status?: string;
}

/**
 * isTerminalExecutionStatus：判断轮次或任务是否进入终态。
 *
 * 关键逻辑：前端需要把 completed、failed、cancelled 都视为当前轮次已结束，
 * 否则失败或取消后不会刷新快照，UI 会残留本地 running 状态。
 *
 * @param status 中心服务明确返回的状态字段。
 * @returns 命中终态时返回 true。
 */
function isTerminalExecutionStatus(status: string | undefined): boolean {
    return status === "completed"
        || status === "failed"
        || status === "cancelled";
}

// RUNNING_TURN_RECOVERY_INTERVAL_MS：运行中轮次快照恢复间隔，保持轻量轮询且能及时刷新最终消息。
const RUNNING_TURN_RECOVERY_INTERVAL_MS = 1500;
// RUNNING_TURN_RECOVERY_IDLE_ATTEMPTS：连续约 10 分钟无事件、任务或步骤活动时，停止当前页面本地观察并输出诊断日志。
const RUNNING_TURN_RECOVERY_IDLE_ATTEMPTS = 400;
// RUNNING_TURN_RECOVERY_HARD_MAX_ATTEMPTS：极端保护预算；活动持续推进时通常不会触发，避免异常页面永久高频轮询。
const RUNNING_TURN_RECOVERY_HARD_MAX_ATTEMPTS = 172800;

/**
 * isCompletedTaskUpdate：判断任务更新是否表示当前任务完成。
 *
 * 关键逻辑：中心服务把任务状态放在事件 payload 中，并会额外发送 `task.updated` 专项包；
 * 前端必须读取明确的 payload.status，避免数据库已完成但 UI 仍停留在执行中的状态。
 *
 * @param payload 任务更新事件载荷。
 * @returns 为明确终态时返回 true。
 */
function isCompletedTaskUpdate(payload: unknown): payload is TaskUpdatedPayload {
    const taskUpdate = payload as TaskUpdatedPayload;
    return isTerminalExecutionStatus(taskUpdate.status);
}

/**
 * isCompletedEvent：判断中心服务事件是否已经完成。
 *
 * 关键逻辑：历史事件和不同仓储映射同时存在顶层 `status` 与 `payload.status` 两种明确形态；
 * 兼容这两个固定字段可以避免轮次已完成但前端仍停在执行中。
 *
 * @param event 中心服务实时事件。
 * @returns 任一明确状态为终态时返回 true。
 */
function isCompletedEvent(event: EventRecord): boolean {
    const payload = event.payload as {status?: string};
    return isTerminalExecutionStatus(event.status)
        || isTerminalExecutionStatus(payload.status);
}

/**
 * isTaskUpdateForActiveSession：判断专项任务更新是否属于当前展示窗口。
 *
 * 关键逻辑：专项包可能只携带 taskId；当缺少 sessionId 时，使用当前任务列表做单一明确归属校验，
 * 避免刷新无关会话，也避免因为专项包缺少会话字段而漏掉当前任务完成刷新。
 *
 * @param payload 任务更新事件载荷。
 * @param activeSessionId 当前会话 ID。
 * @param activeTaskIds 当前会话详情中的任务 ID 集合。
 * @returns 属于当前会话或当前任务集合时返回 true。
 */
function isTaskUpdateForActiveSession(
    payload: TaskUpdatedPayload,
    activeSessionId: string | null,
    activeTaskIds: Set<string>,
): boolean {
    if (!activeSessionId) {
        return false;
    }
    if (payload.sessionId === activeSessionId) {
        return true;
    }
    if (payload.taskId && activeTaskIds.has(payload.taskId)) {
        return true;
    }
    return false;
}

/**
 * isRecoverableTurnRunning：判断轮次是否需要通过快照兜底恢复终态。
 *
 * 关键逻辑：多端页面不是发送端，可能只收到起始 `session.updated`，后续完成事件如果漏收就会停在执行中；
 * 只对中心服务明确仍未结束的运行态轮次启动短轮询，避免空闲会话产生无意义请求。
 *
 * @param turn 会话详情中的轮次记录。
 * @returns 轮次仍处于运行、排队或等待用户时返回 true。
 */
function isRecoverableTurnRunning(turn: {
    /** endedAt：中心服务轮次结束时间；null 表示尚未结束。 */
    endedAt: string | null;
    /** status：中心服务轮次状态。 */
    status: string;
    /** startedAt：中心服务轮次开始时间。 */
    startedAt: string;
}, options?: {
    /** processStartedAt：当前中心服务进程启动时间。 */
    processStartedAt: string | null;
    /** activityAt：当前轮次最近活动时间。 */
    activityAt?: string | null;
}): boolean {
    if (turn.endedAt !== null) {
        return false;
    }
    if (
        turn.status !== "queued"
        && turn.status !== "running"
        && turn.status !== "waiting_user"
    ) {
        return false;
    }
    if (!options?.processStartedAt) {
        return true;
    }
    const processStartedAtMs = readTimeMs(options.processStartedAt);
    const turnStartedAtMs = readTimeMs(turn.startedAt);
    if (processStartedAtMs === null || turnStartedAtMs === null) {
        return true;
    }
    if (turnStartedAtMs >= processStartedAtMs) {
        return true;
    }
    const activityAtMs = readTimeMs(options.activityAt ?? null);
    return activityAtMs !== null && activityAtMs >= processStartedAtMs;
}

/**
 * readTimeMs：把中心服务时间字符串转为毫秒时间戳。
 *
 * 关键逻辑：活动续租只能使用中心服务事实时间；解析失败时忽略该字段，避免本地时间兜底污染恢复判断。
 *
 * @param value 中心服务返回的时间字符串或空值。
 * @returns 可比较的毫秒时间戳；无法解析时返回 null。
 */
function readTimeMs(value: string | null | undefined): number | null {
    if (!value) {
        return null;
    }
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp)
        ? null
        : timestamp;
}

/**
 * writeMaxActivity：把候选活动时间写入当前最大活动时间。
 *
 * @param current 当前最大活动时间。
 * @param candidate 中心服务候选时间。
 * @returns 推进后的最大活动时间。
 */
function writeMaxActivity(
    current: {
        /** ms：用于比较的时间戳毫秒值。 */
        ms: number;
        /** text：中心服务返回的原始时间文本。 */
        text: string;
    } | null,
    candidate: string | null | undefined,
): {
    /** ms：用于比较的时间戳毫秒值。 */
    ms: number;
    /** text：中心服务返回的原始时间文本。 */
    text: string;
} | null {
    const candidateMs = readTimeMs(candidate);
    if (candidateMs === null || !candidate) {
        return current;
    }
    if (current === null || candidateMs > current.ms) {
        return {
            ms: candidateMs,
            text: candidate,
        };
    }
    return current;
}

/**
 * resolveTurnSnapshotActivityAt：从当前会话快照推导指定轮次最近活动时间。
 *
 * 关键逻辑：超长期任务会持续产生模型输出、命令输出、工具事件和步骤切换；
 * 前端恢复必须根据中心服务快照中的事件、任务、步骤和轮次时间续租，不能按固定总时长停止。
 *
 * @param detail 当前会话详情快照。
 * @param events 当前会话事件快照。
 * @param turnId 运行中轮次 ID。
 * @returns 最近活动时间字符串；没有任何活动事实时返回 null。
 */
function resolveTurnSnapshotActivityAt(
    detail: SessionDetailResult | null,
    events: EventRecord[],
    turnId: string,
): string | null {
    let activity: {
        /** ms：用于比较的时间戳毫秒值。 */
        ms: number;
        /** text：中心服务返回的原始时间文本。 */
        text: string;
    } | null = null;
    const turn = detail?.turns.find((item) => {
        return item.turnId === turnId;
    });
    activity = writeMaxActivity(activity, turn?.startedAt);
    activity = writeMaxActivity(activity, turn?.endedAt);
    const taskIds = new Set<string>();
    detail?.tasks.forEach((task) => {
        if (task.turnId !== turnId) {
            return;
        }
        taskIds.add(task.taskId);
        activity = writeMaxActivity(activity, task.createdAt);
        activity = writeMaxActivity(activity, task.updatedAt);
    });
    detail?.taskSteps.forEach((step) => {
        if (!taskIds.has(step.taskId)) {
            return;
        }
        activity = writeMaxActivity(activity, step.startedAt);
        activity = writeMaxActivity(activity, step.endedAt);
    });
    events.forEach((event) => {
        if (event.turnId !== turnId) {
            return;
        }
        activity = writeMaxActivity(activity, event.occurredAt);
    });
    return activity === null
        ? null
        : activity.text;
}

/**
 * createConversationActions：创建对话发送、附件和实时同步相关 Pinia actions。
 *
 * 用途：把对话主链路从主 store 拆出，避免状态定义文件继续膨胀。
 * 关键逻辑：仍通过中心服务 REST 与 WebSocket 作为唯一事实入口。
 * @returns 可被 Pinia actions 展开的对话动作集合。
 */
export function createConversationActions() {
    return {
        /**
         * refreshActiveConversationState：按实时事件刷新当前会话事实。
         *
         * @returns 刷新完成后没有返回值。
         */
        async refreshActiveConversationState(): Promise<void> {
            if (!this.activeSessionId) {
                return;
            }
            try {
                await this.loadActiveSessionDetail();
                await this.loadPendingEditsForActiveSession();
            } catch (error) {
                if (error instanceof CenterApiError && error.code === "SESSION_NOT_FOUND") {
                    // 删除事件和普通事件可能交错到达；当前会话已被删时只清理本地状态，不能把竞态错误冒泡到控制台。
                    this.clearDeletedActiveSessionState();
                    await this.loadNavigationData();
                    await this.ensureSession();
                    return;
                }
                throw error;
            }
        },

        /**
         * clearDeletedActiveSessionState：清理已删除当前会话的本地展示状态。
         *
         * @returns 没有返回值。
         */
        clearDeletedActiveSessionState(): void {
            this.activeSessionId = null;
            this.sessionDetail = null;
            this.events = [];
            this.pendingSessionDraft = null;
            this.composerEditFiles = [];
            this.resetComposerContextUsageForWindow();
        },

        /**
         * replaceRealtimeEvent：用新数组引用合并实时事件。
         *
         * @param event 中心服务推送的事件记录。
         * @returns 没有返回值。
         */
        replaceRealtimeEvent(event: EventRecord): void {
            const retainedEvents = this.events.filter((item: EventRecord) => {
                return item.eventId !== event.eventId;
            });
            // 实时事件不能原地 push/sort；新数组引用能让 Vue/Pinia 立即刷新流式回复和过程卡片。
            this.events = [
                ...retainedEvents,
                event,
            ].sort((left: EventRecord, right: EventRecord) => {
                return left.sequence - right.sequence;
            });
        },

        /**
         * sendDraft：发送当前输入框文本。
         *
         * @returns 发送完成后没有返回值。
         */
        async sendDraft(): Promise<void> {
            if (!canSendComposerDraft(this.draft)) {
                return;
            }
            if (!this.ensureRealtimeOpenForUserAction("发送消息")) {
                return;
            }

            const contentMarkdown = this.buildDraftMarkdown();
            const attachments = [
                ...this.draft.attachments,
            ];
            if (this.hasActiveRunningTurn()) {
                this.queueDraftForCurrentTurn(
                    contentMarkdown,
                );
                this.draft = createEmptyComposerDraft();
                this.showProjectReferencePopover = false;
                this.projectReferenceQuery = "";
                return;
            }
            this.draft = createEmptyComposerDraft();
            this.showProjectReferencePopover = false;
            this.projectReferenceQuery = "";

            const sessionId = await this.ensureSessionForSending();
            if (!sessionId) {
                return;
            }

            const sent = await this.requireRealtimeRequest<{
                /** sessionId: 中心服务确认的会话 ID。 */
                sessionId: string;
                /** messageId: 用户消息 ID。 */
                messageId: string;
                /** turnId: 本轮轮次 ID。 */
                turnId: string;
                /** taskId: 本轮任务 ID。 */
                taskId: string;
            }>("session.message.send", {
                sessionId,
                contentMarkdown,
            });
            this.applySentMessageOptimisticState(
                sessionId,
                contentMarkdown,
                sent,
            );
            this.startRunningTurnSnapshotRecovery(
                sessionId,
                sent.turnId,
            );
            await this.commitDraftAttachments(
                sessionId,
                sent.messageId,
                attachments,
            );
            await this.loadNavigationData();
            await this.loadActiveSessionSnapshot();
            await this.updateComposerContextUsageFromExecution();
        },

        /**
         * hasActiveRunningTurn：判断当前对话是否存在运行中或等待用户轮次。
         *
         * @returns 存在运行中或等待用户轮次时返回 true。
         */
        hasActiveRunningTurn(): boolean {
            return Boolean(this.sessionDetail?.turns.some((turn) => {
                return isRecoverableTurnRunning(
                    turn,
                    {
                        processStartedAt: this.centerHealth?.processStartedAt ?? null,
                        activityAt: resolveTurnSnapshotActivityAt(
                            this.sessionDetail,
                            this.events,
                            turn.turnId,
                        ),
                    },
                );
            }));
        },

        /**
         * recoverActiveRunningTurnSnapshot：从当前会话快照启动运行中轮次恢复。
         *
         * 关键逻辑：其他端收到 `session.updated` 后只能先拉到用户消息和运行态轮次；
         * 如果后续完成事件没有抵达，活动续租式恢复会按中心服务快照持续拉取，直到终态写入 UI 或长时间无活动。
         *
         * @returns 没有返回值。
         */
        recoverActiveRunningTurnSnapshot(): void {
            if (!this.activeSessionId || !this.sessionDetail) {
                return;
            }
            const runningTurn = [
                ...this.sessionDetail.turns,
            ].reverse().find((turn) => {
                return isRecoverableTurnRunning(
                    turn,
                    {
                        processStartedAt: this.centerHealth?.processStartedAt ?? null,
                        activityAt: resolveTurnSnapshotActivityAt(
                            this.sessionDetail,
                            this.events,
                            turn.turnId,
                        ),
                    },
                );
            });
            if (!runningTurn) {
                return;
            }
            if (this.runningTurnSnapshotRecovery.sessionId === this.activeSessionId
                && this.runningTurnSnapshotRecovery.turnId === runningTurn.turnId) {
                return;
            }
            this.startRunningTurnSnapshotRecovery(
                this.activeSessionId,
                runningTurn.turnId,
            );
        },

        /**
         * queueDraftForCurrentTurn：把运行中新发送内容放入本地排队消息区。
         *
         * @param contentMarkdown 发送瞬间构建好的 Markdown 正文。
         * @returns 没有返回值。
         */
        queueDraftForCurrentTurn(contentMarkdown: string): void {
            const trimmedContent = contentMarkdown.trim();
            if (trimmedContent.length === 0) {
                return;
            }
            this.queuedComposerMessages.push({
                queuedMessageId: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                sessionId: this.activeSessionId ?? "",
                contentMarkdown: trimmedContent,
                createdAt: new Date().toISOString(),
            });
        },

        /**
         * submitQueuedMessageAsGuidance：排队消息转为当前轮次引导并立即移除。
         *
         * @param queuedMessageId 本地排队消息 ID。
         * @returns 引导提交完成后没有返回值。
         */
        async submitQueuedMessageAsGuidance(queuedMessageId: string): Promise<void> {
            if (!this.ensureRealtimeOpenForUserAction("提交引导")) {
                return;
            }
            const queuedMessage = this.queuedComposerMessages.find((message) => {
                return message.queuedMessageId === queuedMessageId;
            });
            if (!queuedMessage) {
                return;
            }
            this.queuedComposerMessages = this.queuedComposerMessages.filter((message) => {
                return message.queuedMessageId !== queuedMessageId;
            });
            const sessionId = this.activeSessionId ?? await this.ensureSessionForSending();
            if (!sessionId) {
                return;
            }
            // 当前中心服务尚未提供独立 guidance API；这里绕过运行中入队判断，按单一引导文本协议直接提交到当前会话。
            const contentMarkdown = `针对当前对话当前轮次补充引导：${queuedMessage.contentMarkdown}`;
            await this.requireRealtimeRequest<{
                /** taskId: 被合并的当前任务 ID。 */
                taskId: string;
                /** turnId: 被合并的当前轮次 ID。 */
                turnId: string;
                /** stepId: 新增引导步骤 ID。 */
                stepId: string;
                /** status: 固定 merged。 */
                status: "merged";
            }>("session.guidance.submit", {
                sessionId,
                contentMarkdown,
            });
            await this.loadNavigationData();
            await this.loadActiveSessionSnapshot();
            await this.updateComposerContextUsageFromExecution();
        },

        /**
         * stopActiveConversationTurn：停止当前对话执行。
         *
         * @returns 没有返回值。
         */
        async stopActiveConversationTurn(): Promise<void> {
            if (!this.activeSessionId) {
                return;
            }
            if (!this.ensureRealtimeOpenForUserAction("停止执行")) {
                return;
            }
            await this.requireRealtimeRequest<{
                /** sessionId: 被停止的当前会话 ID。 */
                sessionId: string;
                /** turnId: 被停止的当前运行轮次 ID；没有运行轮次时为 null。 */
                turnId: string | null;
                /** taskId: 被停止的当前任务 ID；没有运行任务时为 null。 */
                taskId: string | null;
                /** status: 停止后的状态。 */
                status: "cancelled" | "idle";
                /** cancelledStepCount: 本次同步取消的运行中步骤数量。 */
                cancelledStepCount: number;
            }>("session.turn.cancel", {
                sessionId: this.activeSessionId,
                reason: "用户点击停止当前执行。",
            });
            await this.loadActiveSessionSnapshot();
            await this.updateComposerContextUsageFromExecution();
        },

        /**
         * applySentMessageOptimisticState：发送成功后立即补入浏览器可见的首包状态。
         *
         * @param sessionId 当前会话 ID。
         * @param contentMarkdown 用户发送正文。
         * @param sent 中心服务返回的消息、轮次和任务身份。
         * @returns 没有返回值。
         */
        applySentMessageOptimisticState(
            sessionId: string,
            contentMarkdown: string,
            sent: {
                messageId: string;
                turnId: string;
                taskId: string;
            },
        ): void {
            if (!this.sessionDetail || this.sessionDetail.session.sessionId !== sessionId) {
                return;
            }

            // now: 只作为浏览器首包占位时间；随后 loadActiveSessionDetail 会用中心服务事实覆盖。
            const now = new Date().toISOString();
            const nextMessages = this.sessionDetail.messages.some((message) => message.messageId === sent.messageId)
                ? this.sessionDetail.messages
                : [
                    ...this.sessionDetail.messages,
                    {
                        messageId: sent.messageId,
                        sessionId,
                        turnId: sent.turnId,
                        role: "user",
                        contentMarkdown,
                        createdAt: now,
                    },
                ];
            const nextTurns = this.sessionDetail.turns.some((turn) => turn.turnId === sent.turnId)
                ? this.sessionDetail.turns
                : [
                    ...this.sessionDetail.turns,
                    {
                        turnId: sent.turnId,
                        sessionId,
                        turnNumber: this.sessionDetail.turns.length + 1,
                        userMessageId: sent.messageId,
                        status: "running",
                        startedAt: now,
                        endedAt: null,
                        durationMs: null,
                    },
                ];
            const nextTasks = this.sessionDetail.tasks.some((task) => task.taskId === sent.taskId)
                ? this.sessionDetail.tasks
                : [
                    ...this.sessionDetail.tasks,
                    {
                        taskId: sent.taskId,
                        turnId: sent.turnId,
                        sessionId,
                        status: "running",
                        title: "正在生成回复",
                        createdAt: now,
                        updatedAt: now,
                    },
                ];
            // sessionDetail: 用新对象和新数组替换，确保发送端在快照返回前也能立即刷新消息列表和运行态区域。
            this.sessionDetail = {
                ...this.sessionDetail,
                messages: nextMessages,
                turns: nextTurns,
                tasks: nextTasks,
            };
            // 过程事件只能来自中心服务 sequence 事实源；浏览器不再插入负 sequence 占位，避免命令开始、输出和完成顺序被本地假事件打乱。
        },

        /**
         * startRunningTurnSnapshotRecovery：启动运行中轮次快照恢复兜底。
         *
         * 关键逻辑：恢复生命周期由中心服务活动时间续租，避免超长期任务持续输出时被固定总时长误停。
         *
         * @param sessionId 当前发送会话 ID。
         * @param turnId 当前发送轮次 ID。
         * @returns 没有返回值。
         */
        startRunningTurnSnapshotRecovery(
            sessionId: string,
            turnId: string,
        ): void {
            this.stopRunningTurnSnapshotRecovery();
            this.runningTurnSnapshotRecovery.sessionId = sessionId;
            this.runningTurnSnapshotRecovery.turnId = turnId;
            this.runningTurnSnapshotRecovery.attempts = 0;
            this.runningTurnSnapshotRecovery.lastActivityAt = resolveTurnSnapshotActivityAt(
                this.sessionDetail,
                this.events,
                turnId,
            );
            this.runningTurnSnapshotRecovery.idleAttempts = 0;
            this.runningTurnSnapshotRecovery.processStartedAt = this.centerHealth?.processStartedAt ?? null;
            console.info("[frontend:turn-recovery] started", JSON.stringify({
                sessionId,
                turnId,
                lastActivityAt: this.runningTurnSnapshotRecovery.lastActivityAt,
                idleAttemptsLimit: RUNNING_TURN_RECOVERY_IDLE_ATTEMPTS,
                hardMaxAttempts: RUNNING_TURN_RECOVERY_HARD_MAX_ATTEMPTS,
                intervalMs: RUNNING_TURN_RECOVERY_INTERVAL_MS,
            }));
            this.scheduleRunningTurnSnapshotRecovery();
        },

        /**
         * stopRunningTurnSnapshotRecovery：停止运行中轮次快照恢复兜底。
         *
         * @returns 没有返回值。
         */
        stopRunningTurnSnapshotRecovery(): void {
            if (this.runningTurnSnapshotRecovery.recoveryTimer !== null) {
                window.clearTimeout(this.runningTurnSnapshotRecovery.recoveryTimer);
            }
            this.runningTurnSnapshotRecovery.recoveryTimer = null;
            this.runningTurnSnapshotRecovery.sessionId = null;
            this.runningTurnSnapshotRecovery.turnId = null;
            this.runningTurnSnapshotRecovery.attempts = 0;
            this.runningTurnSnapshotRecovery.lastActivityAt = null;
            this.runningTurnSnapshotRecovery.idleAttempts = 0;
            this.runningTurnSnapshotRecovery.processStartedAt = null;
        },

        /**
         * scheduleRunningTurnSnapshotRecovery：按活动续租策略短间隔拉取当前会话数据库快照。
         *
         * 关键逻辑：只要中心服务快照中的事件、任务或步骤时间继续推进，就刷新最近活动时间；
         * 只有连续多次没有任何活动推进时，才停止当前页面本地观察并保留控制台诊断。
         *
         * @returns 没有返回值。
         */
        scheduleRunningTurnSnapshotRecovery(): void {
            const recovery = this.runningTurnSnapshotRecovery;
            if (!recovery.sessionId || !recovery.turnId) {
                return;
            }
            if (recovery.attempts >= RUNNING_TURN_RECOVERY_HARD_MAX_ATTEMPTS) {
                console.warn("[frontend:turn-recovery] stopped by hard budget", JSON.stringify({
                    sessionId: recovery.sessionId,
                    turnId: recovery.turnId,
                    attempts: recovery.attempts,
                    lastActivityAt: recovery.lastActivityAt,
                }));
                this.stopRunningTurnSnapshotRecovery();
                return;
            }
            if (recovery.idleAttempts >= RUNNING_TURN_RECOVERY_IDLE_ATTEMPTS) {
                console.warn("[frontend:turn-recovery] stopped by idle budget", JSON.stringify({
                    sessionId: recovery.sessionId,
                    turnId: recovery.turnId,
                    attempts: recovery.attempts,
                    idleAttempts: recovery.idleAttempts,
                    lastActivityAt: recovery.lastActivityAt,
                }));
                this.stopRunningTurnSnapshotRecovery();
                return;
            }
            recovery.recoveryTimer = window.setTimeout(async () => {
                const currentSessionId = this.runningTurnSnapshotRecovery.sessionId;
                const currentTurnId = this.runningTurnSnapshotRecovery.turnId;
                if (!currentSessionId || !currentTurnId || currentSessionId !== this.activeSessionId) {
                    this.stopRunningTurnSnapshotRecovery();
                    return;
                }
                this.runningTurnSnapshotRecovery.attempts += 1;
                try {
                    // 运行中轮次最终事实在中心服务数据库；短轮询只把已完成快照恢复到当前 UI。
                    await this.loadActiveSessionSnapshot();
                    console.info("[frontend:turn-recovery] snapshot loaded", JSON.stringify({
                        sessionId: currentSessionId,
                        turnId: currentTurnId,
                        attempts: this.runningTurnSnapshotRecovery.attempts,
                    }));
                    const activityAt = resolveTurnSnapshotActivityAt(
                        this.sessionDetail,
                        this.events,
                        currentTurnId,
                    );
                    if (activityAt && activityAt !== this.runningTurnSnapshotRecovery.lastActivityAt) {
                        this.runningTurnSnapshotRecovery.lastActivityAt = activityAt;
                        this.runningTurnSnapshotRecovery.idleAttempts = 0;
                        console.info("[frontend:turn-recovery] activity renewed", JSON.stringify({
                            sessionId: currentSessionId,
                            turnId: currentTurnId,
                            attempts: this.runningTurnSnapshotRecovery.attempts,
                            lastActivityAt: activityAt,
                        }));
                    } else {
                        this.runningTurnSnapshotRecovery.idleAttempts += 1;
                    }
                } catch (error) {
                    console.warn("[frontend:turn-recovery] snapshot failed", JSON.stringify({
                        sessionId: currentSessionId,
                        turnId: currentTurnId,
                        attempts: this.runningTurnSnapshotRecovery.attempts,
                        errorMessage: error instanceof Error
                            ? error.message
                            : "UNKNOWN_SNAPSHOT_RECOVERY_ERROR",
                    }));
                    // WebSocket 请求可能与重连竞态冲突；下一轮继续尝试，避免单次失败让 UI 永久卡住。
                }
                const stillRunning = this.sessionDetail?.turns.some((turn) => {
                    return turn.turnId === currentTurnId
                        && isRecoverableTurnRunning(
                            turn,
                            {
                                processStartedAt: this.runningTurnSnapshotRecovery.processStartedAt,
                                activityAt: resolveTurnSnapshotActivityAt(
                                    this.sessionDetail,
                                    this.events,
                                    currentTurnId,
                                ),
                            },
                        );
                }) ?? false;
                if (!stillRunning) {
                    console.info("[frontend:turn-recovery] completed", JSON.stringify({
                        sessionId: currentSessionId,
                        turnId: currentTurnId,
                        attempts: this.runningTurnSnapshotRecovery.attempts,
                        lastActivityAt: this.runningTurnSnapshotRecovery.lastActivityAt,
                    }));
                    this.stopRunningTurnSnapshotRecovery();
                    return;
                }
                this.scheduleRunningTurnSnapshotRecovery();
            }, RUNNING_TURN_RECOVERY_INTERVAL_MS);
        },

        /**
         * refreshEvents：拉取当前会话缺失事件。
         *
         * @returns 拉取完成后没有返回值。
         */
        async refreshEvents(): Promise<void> {
            const result = await this.requireRealtimeRequest<{
                /** events: 中心服务返回的事件列表。 */
                events: EventRecord[];
            }>("session.event.replay", {
                sessionId: this.activeSessionId,
                turnId: null,
                afterSequence: 0,
            });
            this.events = result.events;
        },

        /**
         * requireRealtimeRequest：对话页 WebSocket-only 请求入口。
         *
         * @param type WebSocket 请求类型。
         * @param payload 请求载荷。
         * @returns 服务端响应载荷。
         */
        async requireRealtimeRequest<TResponse>(type: string, payload: unknown): Promise<TResponse> {
            if (!this.webSocketClient) {
                throw new Error("对话页 WebSocket 尚未连接，不能使用 REST 兜底。");
            }
            return this.webSocketClient.request<TResponse>(
                type,
                payload,
            );
        },

        /**
         * ensureRealtimeOpenForUserAction：用户主动动作发送前校验实时连接。
         *
         * 关键逻辑：已停止、连接中或重连中都不能创建会话、清空草稿或向中心服务发送请求；
         * 本地未发送内容必须留在输入框或排队区，等待连接恢复后由用户再次明确发送。
         *
         * @param actionLabel 用户正在执行的动作名称。
         * @returns 当前 WebSocket 已打开时返回 true。
         */
        ensureRealtimeOpenForUserAction(actionLabel: string): boolean {
            if (this.connectionState === "open") {
                this.lastError = "";
                return true;
            }
            this.lastError = `实时连接未恢复，${actionLabel}未发送。`;
            return false;
        },

        /**
         * loadPendingEditsForActiveSession：加载当前会话真实待确认编辑。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadPendingEditsForActiveSession(): Promise<void> {
            if (!this.activeSessionId) {
                this.composerEditFiles = [];
                return;
            }
            const result = await this.requireRealtimeRequest<{
                /** edits: 当前会话待确认编辑。 */
                edits: PendingEditRecord[];
            }>("edit.pending.list", {
                sessionId: this.activeSessionId,
            });
            this.composerEditFiles = result.edits.map(mapPendingEditToComposerFile);
        },

        /**
         * saveComposerEditFile：确认保存单个文件编辑。
         *
         * @param editId 编辑记录 ID。
         * @returns 没有返回值。
         */
        async saveComposerEditFile(editId: string): Promise<void> {
            await this.requireRealtimeRequest<{
                /** edit: 保存后的编辑记录。 */
                edit: PendingEditRecord;
            }>("edit.pending.save", {
                editId,
            });
            await this.loadPendingEditsForActiveSession();
        },

        /**
         * revertComposerEditFile：撤回单个文件编辑。
         *
         * @param editId 编辑记录 ID。
         * @returns 没有返回值。
         */
        async revertComposerEditFile(editId: string): Promise<void> {
            await this.requireRealtimeRequest<{
                /** edit: 撤回后的编辑记录。 */
                edit: PendingEditRecord;
            }>("edit.pending.revert", {
                editId,
            });
            await this.loadPendingEditsForActiveSession();
        },

        /**
         * saveAllComposerEditFiles：确认保存当前会话全部待确认编辑。
         *
         * @returns 没有返回值。
         */
        async saveAllComposerEditFiles(): Promise<void> {
            if (!this.activeSessionId) {
                return;
            }
            await this.requireRealtimeRequest<{
                /** edits: 保存后的编辑列表。 */
                edits: PendingEditRecord[];
            }>("edit.pending.save_all", {
                sessionId: this.activeSessionId,
            });
            await this.loadPendingEditsForActiveSession();
        },

        /**
         * revertAllComposerEditFiles：撤回当前会话全部待确认编辑。
         *
         * @returns 没有返回值。
         */
        async revertAllComposerEditFiles(): Promise<void> {
            if (!this.activeSessionId) {
                return;
            }
            await this.requireRealtimeRequest<{
                /** edits: 撤回后的编辑列表。 */
                edits: PendingEditRecord[];
            }>("edit.pending.revert_all", {
                sessionId: this.activeSessionId,
            });
            await this.loadPendingEditsForActiveSession();
        },

        /**
         * openComposerEditDiff：打开 Web 或 IDE 编辑对比。
         *
         * @param editId 编辑记录 ID。
         * @returns 对比文本，Web 端可用于弹框展示。
         */
        async openComposerEditDiff(editId: string): Promise<string> {
            const diff = await this.requireRealtimeRequest<{
                /** editId: 编辑记录 ID。 */
                editId: string;
                /** filePath: 文件路径。 */
                filePath: string;
                /** beforeContent: 编辑前内容。 */
                beforeContent: string;
                /** afterContent: 编辑后内容。 */
                afterContent: string;
                /** diffText: 统一 diff 文本。 */
                diffText: string;
            }>("edit.pending.diff", {
                editId,
            });
            const ideBridge = window.zhixinPlugin;
            if (ideBridge?.openEditDiff) {
                await ideBridge.openEditDiff({
                    filePath: diff.filePath,
                    beforeContent: diff.beforeContent,
                    afterContent: diff.afterContent,
                    title: `致心编辑对比：${diff.filePath}`,
                });
            }
            return diff.diffText;
        },

        /**
         * loadAgentSubConversation：读取当前会话内某智能体独立子对话。
         *
         * @param payload 主会话和智能体身份。
         * @returns 智能体子对话详情。
         */
        async loadAgentSubConversation(payload: {
            parentSessionId: string;
            agentId: string;
            agentName: string;
        }): Promise<AgentSubConversationDetail> {
            return this.requireRealtimeRequest<AgentSubConversationDetail>(
                "agent.sub_conversation.detail",
                payload,
            );
        },

        /**
         * sendAgentSubConversationMessage：向智能体独立子对话发送消息。
         *
         * @param payload 主会话、智能体和正文。
         * @returns 更新后的智能体子对话详情。
         */
        async sendAgentSubConversationMessage(payload: {
            parentSessionId: string;
            agentId: string;
            agentName: string;
            contentMarkdown: string;
        }): Promise<AgentSubConversationDetail> {
            if (!this.ensureRealtimeOpenForUserAction("发送智能体消息")) {
                return this.loadAgentSubConversation({
                    parentSessionId: payload.parentSessionId,
                    agentId: payload.agentId,
                    agentName: payload.agentName,
                });
            }
            return this.requireRealtimeRequest<AgentSubConversationDetail>(
                "agent.sub_conversation.message.send",
                payload,
            );
        },

        /**
         * connectRealtime：建立 WebSocket 实时同步连接。
         *
         * @returns WebSocket 连接打开后完成；未授权时直接返回。
         */
        async connectRealtime(): Promise<void> {
            if (!this.authorization) {
                return;
            }

            const webSocketUrl = this.runtime.centerBaseUrl.replace(/^http/u, "ws");
            const previousWebSocketClient = this.webSocketClient;
            const nextWebSocketClient = new ReconnectingWebSocketClient({
                url: `${webSocketUrl}/api/sync`,
                clientId: this.authorization.clientId,
                clientType: this.runtime.clientType,
                projectId: this.runtime.projectContext?.projectId ?? null,
                maxRetries: 5,
                retryIntervalMs: 2000,
                onStateChange: (state) => {
                    if (this.webSocketClient !== nextWebSocketClient) {
                        return;
                    }
                    this.connectionState = state;
                },
                onMessage: (message) => {
                    if (message.type === "event.appended") {
                        const event = message.payload as EventRecord;
                        if (event.sessionId !== this.activeSessionId) {
                            return;
                        }
                        this.replaceRealtimeEvent(event);
                        if (shouldRefreshComposerContextUsage(event)) {
                            void this.updateComposerContextUsageFromExecution();
                        }
                        if (event.eventType === "message.created"
                            && (event.payload as {role?: string}).role === "assistant") {
                            // 助手消息固化后必须刷新当前会话快照，否则漏掉流式片段时只能靠停止按钮触发刷新。
                            void this.loadActiveSessionSnapshot();
                        }
                        if (event.eventType === "model.stream.completed") {
                            // 模型流完成后先做一次快照兜底；如果后续消息固化或轮次完成事件漏收，UI 也不会长期停在流式运行态。
                            void this.loadActiveSessionSnapshot();
                        }
                        if (event.eventType === "turn.updated"
                            && isCompletedEvent(event)) {
                            // 轮次完成状态来自事件载荷；读取 payload 能避免 UI 因字段位置不一致停在执行中。
                            void this.loadActiveSessionSnapshot();
                        }
                        if (event.eventType === "task.updated"
                            && isCompletedEvent(event)) {
                            // 轮次或任务完成时也刷新快照，避免完成事件晚于消息事件或消息事件被漏收时 UI 仍停在执行中。
                            void this.loadActiveSessionSnapshot();
                        }
                    }
                    if (message.type === "task.updated") {
                        const taskUpdate = message.payload as TaskUpdatedPayload;
                        const activeTaskIds = new Set(
                            this.sessionDetail?.tasks.map((task) => task.taskId) ?? [],
                        );
                        if (isCompletedTaskUpdate(taskUpdate)
                            && isTaskUpdateForActiveSession(
                                taskUpdate,
                                this.activeSessionId,
                                activeTaskIds,
                            )) {
                            // 专项 task.updated 包不进入 event.appended 分支，必须单独刷新快照才能恢复最终回复和任务终态。
                            void this.loadActiveSessionSnapshot();
                        }
                    }
                    if (message.type === "agent.state.changed") {
                        this.applyAgentRuntimeState(message.payload as {
                            agentId: string;
                            status: string;
                            currentTaskId: string | null;
                            updatedAt: string;
                        });
                    }
                    if (message.type === "session.updated") {
                        void this.handleSessionUpdated(message.payload as SessionUpdatedPayload);
                    }
                    if (message.type === "session.deleted") {
                        void this.handleSessionDeleted(message.payload as {
                            sessionId: string;
                            sessionType: "normal" | "project";
                            projectId: string | null;
                        });
                    }
                },
            });
            // markRaw: WebSocket 客户端是带私有状态的运行期对象，不能被 Vue 代理，否则身份比较会失效。
            this.webSocketClient = markRaw(nextWebSocketClient);
            previousWebSocketClient?.close();
            this.webSocketClient.connect();
            await this.webSocketClient.waitUntilOpen();
        },

        /**
         * addClipboardImageAttachment：把剪贴板图片登记为临时附件草稿。
         *
         * @param file 剪贴板图片文件。
         * @returns 登记完成后没有返回值。
         */
        async addClipboardImageAttachment(file: File): Promise<void> {
            const fileName = file.name || `clipboard-${Date.now()}.png`;
            const temporary = await this.requireRealtimeRequest<{
                /** temporaryAttachmentId: 临时附件 ID。 */
                temporaryAttachmentId: string;
                /** storageFileName: 临时存储文件名。 */
                storageFileName: string;
                /** relativePath: 临时附件相对中心目录路径。 */
                relativePath: string;
            }>("attachment.temporary.create", {
                fileName,
                mimeType: file.type,
                sizeBytes: file.size,
                file,
            });
            this.draft.attachments.push({
                temporaryAttachmentId: temporary.temporaryAttachmentId,
                temporaryRelativePath: temporary.relativePath,
                fileName,
                mimeType: file.type,
                sizeBytes: file.size,
            });
        },

        /**
         * commitDraftAttachments：消息发送成功后提交所有临时附件。
         *
         * @param sessionId 当前会话 ID。
         * @param messageId 已创建消息 ID。
         * @param attachments 临时附件草稿数组。
         * @returns 全部提交完成后没有返回值。
         */
        async commitDraftAttachments(
            sessionId: string,
            messageId: string,
            attachments: ComposerAttachmentDraft[],
        ): Promise<void> {
            for (const attachment of attachments) {
                await this.requireRealtimeRequest<{
                    /** attachmentId: 正式附件 ID。 */
                    attachmentId: string;
                    /** relativePath: 兼容字段，等同于 archivePath。 */
                    relativePath: string;
                    /** archivePath: 正式归档附件相对中心目录路径。 */
                    archivePath: string;
                }>("attachment.commit", {
                    sessionId,
                    messageId,
                    temporaryAttachmentId: attachment.temporaryAttachmentId,
                    temporaryRelativePath: attachment.temporaryRelativePath,
                    fileName: attachment.fileName,
                    mimeType: attachment.mimeType,
                    sizeBytes: attachment.sizeBytes,
                });
            }
        },

        /**
         * applyAgentRuntimeState：合并中心服务推送的智能体运行状态。
         *
         * @param payload WebSocket `agent.state.changed` 载荷。
         * @returns 没有返回值。
         */
        applyAgentRuntimeState(payload: {
            agentId: string;
            status: string;
            currentTaskId: string | null;
            updatedAt: string;
        }): void {
            const statusLabel = this.formatAgentRuntimeStatus(payload.status);
            this.mainAgentStatusTree = this.mainAgentStatusTree.map((node) => {
                if (node.agentId === payload.agentId) {
                    return {
                        ...node,
                        status: statusLabel,
                        taskSummary: payload.currentTaskId
                            ? `当前任务：${payload.currentTaskId}`
                            : "当前没有执行任务。",
                    };
                }
                return {
                    ...node,
                    children: node.children.map((child) => {
                        if (child.agentId !== payload.agentId) {
                            return child;
                        }
                        return {
                            ...child,
                            status: statusLabel,
                            taskSummary: payload.currentTaskId
                                ? `当前任务：${payload.currentTaskId}`
                                : "当前没有执行任务。",
                        };
                    }),
                };
            });
        },

        /**
         * formatAgentRuntimeStatus：把中心服务智能体状态协议转成中文。
         *
         * @param status 中心服务 AgentRuntimeStatus。
         * @returns 中文状态。
         */
        formatAgentRuntimeStatus(status: string): string {
            const labels: Record<string, string> = {
                idle: "空闲",
                working: "工作中",
                queued: "排队中",
                waiting_user: "等待用户",
                ended: "已结束",
                failed: "失败",
            };
            return labels[status] ?? "未知状态";
        },
    };
}

/**
 * mapPendingEditToComposerFile：把中心服务编辑记录转换为输入区展示模型。
 *
 * @param record 中心服务待确认编辑记录。
 * @returns 输入区编辑文件行。
 */
function mapPendingEditToComposerFile(record: PendingEditRecord) {
    return {
        editId: record.editId,
        filePath: record.filePath,
        changeKind: record.changeKind,
        status: record.status,
        previousEditLabel: "编辑前",
        currentEditLabel: "当前文件",
        diffLines: [
            ...Array.from({
                length: record.removedLines,
            }, (_, index) => {
                return {
                    kind: "removed" as const,
                    content: `-${index + 1}`,
                };
            }),
            ...Array.from({
                length: record.addedLines,
            }, (_, index) => {
                return {
                    kind: "added" as const,
                    content: `+${index + 1}`,
                };
            }),
        ],
    };
}

/**
 * shouldRefreshComposerContextUsage：判断事件是否代表模型响应上下文发生变化。
 *
 * @param event 中心服务实时事件。
 * @returns 需要刷新输入框当前窗口 token 总览时返回 true。
 */
function shouldRefreshComposerContextUsage(event: EventRecord): boolean {
    return event.eventType === "model.stream.started"
        || event.eventType === "model.stream.delta"
        || event.eventType === "model.stream.completed"
        || event.eventType === "model.tool.result.appended"
        || event.eventType === "message.created"
        || event.eventType === "message.assistant.created";
}
