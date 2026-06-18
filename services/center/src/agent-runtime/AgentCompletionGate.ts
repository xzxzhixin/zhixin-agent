import type {
    AgentCompletionDecision,
    AgentRunCandidate,
} from "./AgentRunCandidate.js";

/** AgentCompletionGate：把 Deep Agents 候选结果转换为致心任务终态或续跑动作。 */
export class AgentCompletionGate {
    /**
     * evaluate：判断一次 Deep Agents 候选结果是否可以固化为最终助手消息。
     *
     * @param candidate Deep Agents 单次运行候选结果。
     * @returns 中心服务下一步动作。
     */
    public evaluate(candidate: AgentRunCandidate): AgentCompletionDecision {
        if (candidate.cancelled) {
            return {
                status: "failed",
                reason: "TURN_CANCELLED",
            };
        }
        if (candidate.hasToolFailureEvents && candidate.visibleText.length === 0) {
            return this.retryToolFailureOrFail(candidate);
        }
        if (candidate.lastModelMessageDiagnostics?.hasMalformedTextToolCallBlock) {
            return this.continueOrFail(
                candidate,
                "MALFORMED_TEXT_TOOL_CALL_BLOCK",
                "上一条模型响应把工具调用字段放进了 text 内容块，这不是有效工具调用。需要继续使用工具时，可以先输出一句简短过程说明，但必须同时返回结构化 tool_calls；禁止在普通文本或 text content block 中写 id、name、args 代替 tool_calls。如果任务已经完成，请给出完整最终答案。",
            );
        }
        if (candidate.visibleText.length === 0) {
            return this.continueOrFail(
                candidate,
                "EMPTY_FINAL_TEXT",
                "上一轮没有形成可展示回复。请继续完成任务，或在需要用户补充信息时明确说明需要什么。",
            );
        }
        return {
            status: "completed",
            reason: "REACT_FINAL_MESSAGE_READY",
        };
    }

    /**
     * continueOrFail：无进展候选先续跑，超过预算后等待用户或失败。
     *
     * @param candidate Deep Agents 单次运行候选结果。
     * @param reason 判定原因。
     * @param retryPrompt 追加给模型的内部提示。
     * @returns 下一步动作。
     */
    private continueOrFail(
        candidate: AgentRunCandidate,
        reason: string,
        retryPrompt: string,
    ): AgentCompletionDecision {
        if (candidate.continuationRetryCount < candidate.budget.continuationRetryBudget
            && candidate.attemptIndex < candidate.budget.maxSupervisorAttempts) {
            return {
                status: "continue",
                reason,
                retryPrompt,
            };
        }
        return {
            status: "waiting_user",
            reason: `${reason}_BUDGET_EXHAUSTED`,
        };
    }

    /**
     * retryToolFailureOrFail：工具失败后给模型一次替代路径机会。
     *
     * @param candidate Deep Agents 单次运行候选结果。
     * @returns 下一步动作。
     */
    private retryToolFailureOrFail(candidate: AgentRunCandidate): AgentCompletionDecision {
        if (candidate.toolFailureRetryCount < candidate.budget.toolFailureRetryBudget
            && candidate.attemptIndex < candidate.budget.maxSupervisorAttempts) {
            return {
                status: "retry",
                reason: "TOOL_FAILURE_RETRY",
                retryPrompt: "上一次工具执行失败。请根据已有错误选择替代路径继续完成任务；不要重复同一失败调用。无法继续时说明需要用户补充的信息。",
            };
        }
        return {
            status: "waiting_user",
            reason: "TOOL_FAILURE_BUDGET_EXHAUSTED",
        };
    }

}
