/**
 * SUSPECTED_STALE_FAST_INTERVAL_MS：疑似卡住窗口的快速轮询间隔。
 *
 * 来源：用户明确要求“没有到停止终态，也没有消息返回就要启动 20ms 轮询一次”。
 * 约束：只用于短暂疑似卡住窗口，确认中心服务仍在活动后切回常规间隔，避免长期压测中心服务。
 */
export const SUSPECTED_STALE_FAST_INTERVAL_MS = 20;

/**
 * CONFIRMED_RUNNING_INTERVAL_MS：中心服务确认仍在运行且活动推进后的常规轮询间隔。
 *
 * 来源：运行中轮次恢复兜底策略。
 * 约束：只轮询轻量 `session.turn.state`，终态时再拉完整快照。
 */
export const CONFIRMED_RUNNING_INTERVAL_MS = 1500;

/** FAST_POLL_MAX_ATTEMPTS：单个疑似卡住窗口最多快速探测次数。 */
const FAST_POLL_MAX_ATTEMPTS = 150;

/** HARD_MAX_ATTEMPTS：极端保护预算，避免异常页面永久调度。 */
const HARD_MAX_ATTEMPTS = 172800;

/**
 * TurnStateSnapshot：中心服务轻量轮次状态响应。
 *
 * 来源：WebSocket `session.turn.state`。
 * 含义：只描述当前会话最新轮次状态，不携带完整消息和事件列表。
 */
export interface TurnStateSnapshot {
    /** sessionId: 当前会话 ID。 */
    sessionId: string;
    /** turnId: 最新轮次 ID；没有轮次时为 null。 */
    turnId: string | null;
    /** taskId: 最新任务 ID；没有任务时为 null。 */
    taskId: string | null;
    /** status: 最新轮次状态。 */
    status: "idle" | "queued" | "running" | "waiting_user" | "completed" | "failed" | "cancelled";
    /** endedAt: 轮次结束时间；未结束时为 null。 */
    endedAt: string | null;
    /** durationMs: 轮次耗时；未结束时为 null。 */
    durationMs: number | null;
    /** lastSequence: 当前轮次最后事件序号。 */
    lastSequence: number;
    /** lastActivityAt: 当前轮次最后活动时间。 */
    lastActivityAt: string | null;
    /** serverNow: 中心服务本机时间。 */
    serverNow: string;
}

/**
 * TurnStateReconcilerOptions：状态收敛器运行依赖。
 *
 * 来源：Pinia app store 注入。
 * 含义：让状态机只处理调度和收敛，不直接持有 store。
 */
export interface TurnStateReconcilerOptions {
    /** getActiveSessionId: 读取当前 UI 打开的会话 ID。 */
    getActiveSessionId: () => string | null;
    /** requestTurnState: 请求中心服务轻量轮次状态。 */
    requestTurnState: (sessionId: string) => Promise<TurnStateSnapshot>;
    /** getLocalLastSequence: 读取当前会话本地已经合并的最大事件序号。 */
    getLocalLastSequence: () => number;
    /** loadActiveSessionSnapshot: 终态或缺口确认时刷新完整会话快照。 */
    loadActiveSessionSnapshot: () => Promise<void>;
    /** updateRecoveryState: 同步旧恢复状态字段，供现有 UI 和诊断读取。 */
    updateRecoveryState: (state: {
        /** recoveryTimer: 当前定时器 ID。 */
        recoveryTimer: number | null;
        /** sessionId: 当前收敛目标会话 ID。 */
        sessionId: string | null;
        /** turnId: 当前收敛目标轮次 ID。 */
        turnId: string | null;
        /** attempts: 已请求次数。 */
        attempts: number;
        /** lastActivityAt: 最近活动时间。 */
        lastActivityAt: string | null;
        /** idleAttempts: 快速探测连续未推进次数。 */
        idleAttempts: number;
        /** processStartedAt: 保留旧字段；状态收敛器不使用进程边界。 */
        processStartedAt: string | null;
    }) => void;
    /** logInfo: 输出运行期诊断。 */
    logInfo: (message: string, payload: unknown) => void;
    /** logWarn: 输出异常诊断。 */
    logWarn: (message: string, payload: unknown) => void;
}

/**
 * TurnStateReconciler：当前会话运行中轮次状态收敛器。
 *
 * 用途：当实时消息缺失且轮次尚未终态时，用轻量状态轮询补齐终态并触发完整快照刷新。
 * 关键逻辑：无消息返回进入 20ms 疑似卡住轮询；看到中心服务活动推进后切回常规轮询；看到终态立即刷新完整快照并停止。
 */
export class TurnStateReconciler {
    /** options: Pinia store 注入的运行依赖。 */
    private readonly options: TurnStateReconcilerOptions;

    /** timer: 当前浏览器定时器 ID。 */
    private timer: number | null = null;

    /** sessionId: 当前收敛目标会话 ID。 */
    private sessionId: string | null = null;

    /** turnId: 当前收敛目标轮次 ID。 */
    private turnId: string | null = null;

    /** attempts: 当前目标累计轮询次数。 */
    private attempts = 0;

    /** idleAttempts: 疑似卡住窗口连续没有活动推进次数。 */
    private idleAttempts = 0;

    /** lastActivityAt: 最近一次中心服务活动时间。 */
    private lastActivityAt: string | null = null;

    /** lastSequence: 最近一次中心服务事件序号。 */
    private lastSequence = 0;

    /** fastMode: 是否处于 20ms 疑似卡住快轮询窗口。 */
    private fastMode = true;

    /**
     * constructor：保存状态收敛器依赖。
     *
     * @param options Pinia store 注入的请求、快照和诊断函数。
     */
    constructor(options: TurnStateReconcilerOptions) {
        this.options = options;
    }

    /**
     * isTracking：判断当前是否正在收敛指定轮次。
     *
     * @param sessionId 会话 ID。
     * @param turnId 轮次 ID。
     * @returns 正在跟踪同一目标时返回 true。
     */
    isTracking(
        sessionId: string,
        turnId: string,
    ): boolean {
        return this.sessionId === sessionId && this.turnId === turnId;
    }

    /**
     * start：启动指定轮次的状态收敛。
     *
     * @param sessionId 会话 ID。
     * @param turnId 轮次 ID。
     * @param lastActivityAt 当前快照推导出的最近活动时间。
     * @returns 没有返回值。
     */
    start(
        sessionId: string,
        turnId: string,
        lastActivityAt: string | null,
    ): void {
        this.stop();
        this.sessionId = sessionId;
        this.turnId = turnId;
        this.attempts = 0;
        this.idleAttempts = 0;
        this.lastActivityAt = lastActivityAt;
        this.lastSequence = 0;
        this.fastMode = true;
        this.options.logInfo("[frontend:turn-state-reconciler] started", {
            sessionId,
            turnId,
            lastActivityAt,
            fastIntervalMs: SUSPECTED_STALE_FAST_INTERVAL_MS,
            confirmedIntervalMs: CONFIRMED_RUNNING_INTERVAL_MS,
        });
        this.syncRecoveryState();
        this.schedule(SUSPECTED_STALE_FAST_INTERVAL_MS);
    }

    /**
     * stop：停止当前状态收敛。
     *
     * @returns 没有返回值。
     */
    stop(): void {
        if (this.timer !== null) {
            window.clearTimeout(this.timer);
        }
        this.timer = null;
        this.sessionId = null;
        this.turnId = null;
        this.attempts = 0;
        this.idleAttempts = 0;
        this.lastActivityAt = null;
        this.lastSequence = 0;
        this.fastMode = true;
        this.syncRecoveryState();
    }

    /**
     * markRealtimeActivity：记录实时事件活动，避免已有消息返回时仍处于快轮询。
     *
     * @param sessionId 事件所属会话 ID。
     * @param turnId 事件所属轮次 ID。
     * @param occurredAt 事件发生时间。
     * @param sequence 事件序号。
     * @returns 没有返回值。
     */
    markRealtimeActivity(
        sessionId: string | null,
        turnId: string | null,
        occurredAt: string | null,
        sequence: number,
    ): void {
        if (!sessionId || !turnId || !this.isTracking(sessionId, turnId)) {
            return;
        }
        this.applyActivity(
            occurredAt,
            sequence,
        );
        this.fastMode = false;
        this.syncRecoveryState();
    }

    /**
     * markTerminal：实时终态事件到达后立即刷新完整快照并停止。
     *
     * @param sessionId 事件所属会话 ID。
     * @param turnId 事件所属轮次 ID。
     * @returns 没有返回值。
     */
    async markTerminal(
        sessionId: string | null,
        turnId: string | null,
    ): Promise<void> {
        if (!sessionId || !turnId || !this.isTracking(sessionId, turnId)) {
            return;
        }
        await this.options.loadActiveSessionSnapshot();
        this.options.logInfo("[frontend:turn-state-reconciler] terminal event reconciled", {
            sessionId,
            turnId,
            attempts: this.attempts,
        });
        this.stop();
    }

    /**
     * forceTerminal：不依赖当前 tracking 状态，按中心服务终态事件强制清理本地运行态。
     *
     * @param sessionId 事件所属会话 ID。
     * @param turnId 事件所属轮次 ID。
     * @returns 没有返回值。
     */
    async forceTerminal(
        sessionId: string | null,
        turnId: string | null,
    ): Promise<void> {
        if (!sessionId || !turnId || this.options.getActiveSessionId() !== sessionId) {
            return;
        }
        await this.options.loadActiveSessionSnapshot();
        this.options.logInfo("[frontend:turn-state-reconciler] terminal event forced", {
            sessionId,
            turnId,
            trackedSessionId: this.sessionId,
            trackedTurnId: this.turnId,
            attempts: this.attempts,
        });
        this.stop();
    }

    /**
     * schedule：按指定间隔安排下一次轻量状态查询。
     *
     * @param intervalMs 下一次查询间隔。
     * @returns 没有返回值。
     */
    private schedule(intervalMs: number): void {
        if (!this.sessionId || !this.turnId) {
            return;
        }
        if (this.attempts >= HARD_MAX_ATTEMPTS) {
            this.options.logWarn("[frontend:turn-state-reconciler] stopped by hard budget", {
                sessionId: this.sessionId,
                turnId: this.turnId,
                attempts: this.attempts,
            });
            this.stop();
            return;
        }
        this.timer = window.setTimeout(() => {
            void this.reconcile();
        }, intervalMs);
        this.syncRecoveryState();
    }

    /**
     * reconcile：执行一次轻量状态收敛。
     *
     * @returns 没有返回值。
     */
    private async reconcile(): Promise<void> {
        const sessionId = this.sessionId;
        const turnId = this.turnId;
        if (!sessionId || !turnId) {
            return;
        }
        if (this.options.getActiveSessionId() !== sessionId) {
            this.stop();
            return;
        }

        this.attempts += 1;
        try {
            const state = await this.options.requestTurnState(sessionId);
            if (state.turnId !== turnId) {
                await this.options.loadActiveSessionSnapshot();
                this.stop();
                return;
            }
            if (this.isTerminalState(state)) {
                await this.options.loadActiveSessionSnapshot();
                this.options.logInfo("[frontend:turn-state-reconciler] completed", {
                    sessionId,
                    turnId,
                    attempts: this.attempts,
                    status: state.status,
                });
                this.stop();
                return;
            }
            if (this.hasEventSequenceGap(state)) {
                await this.options.loadActiveSessionSnapshot();
                this.options.logInfo("[frontend:turn-state-reconciler] sequence gap reconciled", {
                    sessionId,
                    turnId,
                    attempts: this.attempts,
                    localLastSequence: this.options.getLocalLastSequence(),
                    serverLastSequence: state.lastSequence,
                });
                this.applyActivity(
                    state.lastActivityAt,
                    state.lastSequence,
                );
                this.fastMode = false;
                this.idleAttempts = 0;
                this.syncRecoveryState();
                this.schedule(CONFIRMED_RUNNING_INTERVAL_MS);
                return;
            }
            this.updateProgressMode(state);
        } catch (error) {
            this.options.logWarn("[frontend:turn-state-reconciler] state request failed", {
                sessionId,
                turnId,
                attempts: this.attempts,
                errorMessage: error instanceof Error
                    ? error.message
                    : "UNKNOWN_TURN_STATE_ERROR",
            });
        }

        const intervalMs = this.fastMode
            ? SUSPECTED_STALE_FAST_INTERVAL_MS
            : CONFIRMED_RUNNING_INTERVAL_MS;
        this.schedule(intervalMs);
    }

    /**
     * updateProgressMode：根据轻量状态推进情况调整轮询模式。
     *
     * @param state 中心服务轻量轮次状态。
     * @returns 没有返回值。
     */
    private updateProgressMode(state: TurnStateSnapshot): void {
        const activityChanged = this.applyActivity(
            state.lastActivityAt,
            state.lastSequence,
        );
        if (activityChanged) {
            this.idleAttempts = 0;
            this.fastMode = false;
            this.options.logInfo("[frontend:turn-state-reconciler] activity renewed", {
                sessionId: state.sessionId,
                turnId: state.turnId,
                lastActivityAt: state.lastActivityAt,
                lastSequence: state.lastSequence,
            });
            this.syncRecoveryState();
            return;
        }

        this.idleAttempts += 1;
        if (this.fastMode && this.idleAttempts >= FAST_POLL_MAX_ATTEMPTS) {
            this.fastMode = false;
            this.options.logWarn("[frontend:turn-state-reconciler] fast polling cooled down", {
                sessionId: state.sessionId,
                turnId: state.turnId,
                idleAttempts: this.idleAttempts,
                lastActivityAt: this.lastActivityAt,
            });
        }
        this.syncRecoveryState();
    }

    /**
     * applyActivity：应用中心服务活动时间和事件序号。
     *
     * @param lastActivityAt 最新活动时间。
     * @param lastSequence 最新事件序号。
     * @returns 活动事实推进时返回 true。
     */
    private applyActivity(
        lastActivityAt: string | null,
        lastSequence: number,
    ): boolean {
        const activityChanged = typeof lastActivityAt === "string"
            && lastActivityAt.length > 0
            && lastActivityAt !== this.lastActivityAt;
        const sequenceChanged = lastSequence > this.lastSequence;
        if (activityChanged) {
            this.lastActivityAt = lastActivityAt;
        }
        if (sequenceChanged) {
            this.lastSequence = lastSequence;
        }
        return activityChanged || sequenceChanged;
    }

    /**
     * isTerminalState：判断轻量状态是否已经进入终态。
     *
     * @param state 中心服务轻量轮次状态。
     * @returns 轮次已完成、失败、取消、等待用户或转为空闲时返回 true。
     */
    private isTerminalState(state: TurnStateSnapshot): boolean {
        return state.status === "completed"
            || state.status === "failed"
            || state.status === "cancelled"
            || state.status === "waiting_user"
            || state.status === "idle"
            || state.endedAt !== null;
    }

    /**
     * hasEventSequenceGap：判断本地事件流是否落后于中心服务轻量状态。
     *
     * @param state 中心服务轻量轮次状态。
     * @returns 中心服务最后事件序号大于本地已合并序号时返回 true。
     */
    private hasEventSequenceGap(state: TurnStateSnapshot): boolean {
        const localLastSequence = this.options.getLocalLastSequence();
        return state.lastSequence > localLastSequence;
    }

    /**
     * syncRecoveryState：把 class 内部状态镜像到旧 store 字段。
     *
     * @returns 没有返回值。
     */
    private syncRecoveryState(): void {
        this.options.updateRecoveryState({
            recoveryTimer: this.timer,
            sessionId: this.sessionId,
            turnId: this.turnId,
            attempts: this.attempts,
            lastActivityAt: this.lastActivityAt,
            idleAttempts: this.idleAttempts,
            processStartedAt: null,
        });
    }
}
