import {SessionRepository} from "../data-access/session-repository.js";
import {updateTurnStatus} from "../domain/session-domain.js";
import type {DeepAgentsAgentRunInput} from "../StructuredTool/index.js";
import type {
    AgentCompletionDecision,
    AgentRunCandidate,
    AgentSupervisorBudget,
} from "./AgentRunCandidate.js";
import {AgentCompletionGate} from "./AgentCompletionGate.js";

/** DeepAgentRunCandidateFactory：执行一次 Deep Agents graph 并返回候选结果。 */
export type DeepAgentRunCandidateFactory = (input: {
    /** attemptIndex: 当前监督尝试序号，从 1 开始。 */
    attemptIndex: number;
    /** internalPrompt: 上一次候选结果生成的内部续跑提示。 */
    internalPrompt: string | null;
}) => Promise<AgentRunCandidate>;

/** DeepAgentFinalizeHandler：固化最终助手消息的回调。 */
export type DeepAgentFinalizeHandler = (candidate: AgentRunCandidate) => Promise<void>;

/** DeepAgentFailureHandler：失败收尾回调。 */
export type DeepAgentFailureHandler = (candidate: AgentRunCandidate, decision: AgentCompletionDecision) => Promise<void>;

/** DeepAgentTurnSupervisorOptions：监督循环依赖项。 */
export interface DeepAgentTurnSupervisorOptions {
    /** input: 当前轮次运行输入。 */
    input: DeepAgentsAgentRunInput;
    /** runCandidate: 执行一次 Deep Agents graph 的函数。 */
    runCandidate: DeepAgentRunCandidateFactory;
    /** finalize: 候选结果通过完成网关后的固化函数。 */
    finalize: DeepAgentFinalizeHandler;
    /** fail: 预算耗尽或协议错误后的失败收尾函数。 */
    fail: DeepAgentFailureHandler;
    /** budget: 同一轮次监督循环预算。 */
    budget: AgentSupervisorBudget;
}

/** DeepAgentTurnSupervisor：中心服务任务监督循环。 */
export class DeepAgentTurnSupervisor {
    /** completionGate: 候选终态判断网关。 */
    private readonly completionGate = new AgentCompletionGate();

    /** continuationRetryCount: 协议形态错误或空最终文本已续跑次数。 */
    private continuationRetryCount = 0;

    /** toolFailureRetryCount: 工具失败替代路径已重试次数。 */
    private toolFailureRetryCount = 0;

    /** supervisorAttemptCount: 当前预算窗口内已启动 Deep Agents 的次数。 */
    private supervisorAttemptCount = 0;

    /** lastBudgetReason: 最近一次消耗监督预算的原因，用于判断续跑是否已经脱离同类失败。 */
    private lastBudgetReason: string | null = null;

    /**
     * constructor：保存监督循环依赖。
     *
     * @param options 监督循环依赖项。
     */
    public constructor(private readonly options: DeepAgentTurnSupervisorOptions) {}

    /**
     * run：执行监督循环直到完成、等待用户或失败。
     *
     * @returns 没有返回值。
     */
    public async run(): Promise<void> {
        let internalPrompt: string | null = null;
        let lastCandidate: AgentRunCandidate | null = null;
        while (this.supervisorAttemptCount < this.options.budget.maxSupervisorAttempts) {
            this.supervisorAttemptCount += 1;
            const candidate = await this.options.runCandidate({
                attemptIndex: this.supervisorAttemptCount,
                internalPrompt,
            });
            this.resetBudgetCountersAfterProgress(candidate);
            lastCandidate = this.attachBudgetCounters(candidate);
            const decision = this.completionGate.evaluate(lastCandidate);
            this.recordDecision(
                lastCandidate,
                decision,
            );
            if (decision.status === "completed") {
                await this.options.finalize(lastCandidate);
                return;
            }
            if (decision.status === "failed") {
                await this.options.fail(
                    lastCandidate,
                    decision,
                );
                return;
            }
            if (decision.status === "waiting_user") {
                this.markWaitingUser(
                    lastCandidate,
                    decision,
                );
                return;
            }
            this.increaseBudgetCounter(decision);
            internalPrompt = decision.retryPrompt ?? this.createDefaultContinuationPrompt();
        }
        if (lastCandidate) {
            await this.options.fail(
                lastCandidate,
                {
                    status: "failed",
                    reason: "maxSupervisorAttempts_BUDGET_EXHAUSTED",
                },
            );
        }
    }

    /**
     * attachBudgetCounters：把当前预算计数写入候选结果。
     *
     * @param candidate 原始候选结果。
     * @returns 带预算计数的候选结果。
     */
    private attachBudgetCounters(candidate: AgentRunCandidate): AgentRunCandidate {
        return {
            ...candidate,
            attemptIndex: this.supervisorAttemptCount,
            continuationRetryCount: this.continuationRetryCount,
            toolFailureRetryCount: this.toolFailureRetryCount,
        };
    }

    /**
     * increaseBudgetCounter：根据决策原因递增对应预算计数。
     *
     * @param decision 完成网关决策。
     * @returns 没有返回值。
     */
    private increaseBudgetCounter(decision: AgentCompletionDecision): void {
        // lastBudgetReason: 记录本次预算消耗来源，下一次候选若不再命中同类失败则重置全部预算。
        this.lastBudgetReason = decision.reason;
        if (decision.reason === "TOOL_FAILURE_RETRY") {
            this.toolFailureRetryCount += 1;
            return;
        }
        this.continuationRetryCount += 1;
    }

    /**
     * resetBudgetCountersAfterProgress：候选结果脱离上一类预算失败后重置所有预算计数。
     *
     * @param candidate Deep Agents 单次运行候选结果。
     * @returns 没有返回值。
     */
    private resetBudgetCountersAfterProgress(candidate: AgentRunCandidate): void {
        if (!this.lastBudgetReason) {
            return;
        }
        if (this.isSameBudgetReason(
            candidate,
            this.lastBudgetReason,
        )) {
            return;
        }
        this.continuationRetryCount = 0;
        this.toolFailureRetryCount = 0;
        // supervisorAttemptCount: 当前候选已经占用新预算窗口中的一次尝试，因此重置为 1 而不是 0。
        this.supervisorAttemptCount = 1;
        this.lastBudgetReason = null;
    }

    /**
     * isSameBudgetReason：判断当前候选是否仍然命中上一轮消耗预算的失败类型。
     *
     * @param candidate Deep Agents 单次运行候选结果。
     * @param reason 最近一次消耗预算的原因。
     * @returns 仍然属于同类失败时返回 true。
     */
    private isSameBudgetReason(
        candidate: AgentRunCandidate,
        reason: string,
    ): boolean {
        if (reason === "TOOL_FAILURE_RETRY") {
            return candidate.hasToolFailureEvents && candidate.visibleText.length === 0;
        }
        if (reason === "MALFORMED_TEXT_TOOL_CALL_BLOCK") {
            return candidate.lastModelMessageDiagnostics?.hasMalformedTextToolCallBlock === true;
        }
        if (reason === "EMPTY_FINAL_TEXT") {
            return candidate.visibleText.length === 0;
        }
        return false;
    }

    /**
     * recordDecision：记录监督网关决策过程。
     *
     * @param candidate Deep Agents 候选结果。
     * @param decision 完成网关决策。
     * @returns 没有返回值。
     */
    private recordDecision(
        candidate: AgentRunCandidate,
        decision: AgentCompletionDecision,
    ): void {
        this.options.input.events.append({
            eventType: "agent.supervisor.decision",
            scopeType: "turn",
            scopeId: this.options.input.sent.turnId,
            sessionId: this.options.input.sent.sessionId,
            turnId: this.options.input.sent.turnId,
            taskId: this.options.input.sent.taskId,
            status: decision.status === "completed" ? "completed" : "running",
            title: "Agent 任务完成判断",
            summary: `监督层判断为 ${decision.status}:${decision.reason}`,
            payload: {
                attemptIndex: candidate.attemptIndex,
                decision,
                continuationRetryCount: this.continuationRetryCount,
                toolFailureRetryCount: this.toolFailureRetryCount,
            },
        });
    }

    /**
     * markWaitingUser：把轮次收敛到等待用户状态。
     *
     * @param candidate Deep Agents 候选结果。
     * @param decision 完成网关决策。
     * @returns 没有返回值。
     */
    private markWaitingUser(
        candidate: AgentRunCandidate,
        decision: AgentCompletionDecision,
    ): void {
        const currentTurn = new SessionRepository(this.options.input.database).findTurn(this.options.input.sent.turnId);
        if (!currentTurn || currentTurn.endedAt !== null || currentTurn.status === "cancelled") {
            return;
        }
        this.options.input.events.append({
            eventType: "agent.supervisor.waiting_user",
            scopeType: "turn",
            scopeId: this.options.input.sent.turnId,
            sessionId: this.options.input.sent.sessionId,
            turnId: this.options.input.sent.turnId,
            taskId: this.options.input.sent.taskId,
            status: "running",
            title: "等待用户补充",
            summary: "监督层预算耗尽，当前轮次等待用户补充信息。",
            payload: {
                attemptIndex: candidate.attemptIndex,
                reason: decision.reason,
            },
        });
        updateTurnStatus(
            this.options.input.database,
            this.options.input.events,
            this.options.input.sent.turnId,
            "waiting_user",
            this.options.input.sent.taskId,
        );
    }

    /**
     * createDefaultContinuationPrompt：生成通用内部续跑提示。
     *
     * @returns 续跑提示。
     */
    private createDefaultContinuationPrompt(): string {
        return "上一轮没有形成可固化结果。需要继续使用工具时，可以先输出一句简短过程说明，但必须同时返回结构化 tool_calls；禁止在普通文本、Markdown、JSON 文本或 text content block 中写 id、name、args 代替 tool_calls。如果已有信息足够回答用户目标，请停止继续调用工具，直接给出完整最终答案。";
    }
}
