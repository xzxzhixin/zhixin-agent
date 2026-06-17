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
        if (this.containsTextToolShape(candidate)) {
            return this.retryOrFail(
                candidate,
                "TEXT_TOOL_SHAPE",
                "你刚才把工具调用字段放在了普通文本内容里，这不是有效工具调用。必须使用供应商结构化 tool_calls 调用工具；如果任务已经满足，请直接给出最终答案。",
            );
        }
        if (candidate.hasPendingTaskState && candidate.visibleText.length === 0) {
            return this.continueOrFail(
                candidate,
                "TASK_STILL_RUNNING",
                "当前任务还没有形成最终回复。请继续完成任务；需要工具时使用结构化 tool_calls，已经满足用户目标时给出最终答案。",
            );
        }
        if (!candidate.hasStructuredToolCall && this.isProcessTextOnly(candidate)) {
            return this.continueOrFail(
                candidate,
                "PROCESS_TEXT_ONLY",
                "上一轮输出只是过程状态，当前任务尚未完成。不要重复说明正在处理，请继续调用可用工具完成任务，或在已经满足用户目标时给出最终答案。",
            );
        }
        if (candidate.hasToolFailureEvents && candidate.visibleText.length === 0) {
            return this.retryToolFailureOrFail(candidate);
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
            reason: "FINAL_TEXT_READY",
        };
    }

    /**
     * containsTextToolShape：识别普通文本里夹带的伪工具调用字段。
     *
     * @param candidate Deep Agents 单次运行候选结果。
     * @returns 发现 name/args 等通用工具字段形态时返回 true。
     */
    private containsTextToolShape(candidate: AgentRunCandidate): boolean {
        const diagnosticText = this.stringifyDiagnosticContent(candidate);
        if (diagnosticText.length === 0) {
            return false;
        }
        const hasNameField = /["']?name["']?\s*:/u.test(diagnosticText);
        const hasArgsField = /["']?(args|arguments)["']?\s*:/u.test(diagnosticText);
        const hasTextType = /["']?type["']?\s*:\s*["']?text["']?/u.test(diagnosticText);
        return hasNameField && hasArgsField && hasTextType;
    }

    /**
     * isProcessTextOnly：判断当前文本是否更像过程状态而不是最终答案。
     *
     * @param candidate Deep Agents 单次运行候选结果。
     * @returns 只有过程信号且没有最终答复信号时返回 true。
     */
    private isProcessTextOnly(candidate: AgentRunCandidate): boolean {
        const text = candidate.visibleText.trim();
        if (text.length === 0) {
            return true;
        }
        const hasFinalSignal = /结论|总结|推荐|结果|如下|已经完成|我看到|我发现|分别是/u.test(text);
        if (hasFinalSignal) {
            return false;
        }
        const hasProcessSignal = /正在|准备|接下来|下一步|继续|我先|读取|打开|筛选|检索|查询|调用/u.test(text);
        return hasProcessSignal || candidate.hasRecentToolResult;
    }

    /**
     * retryOrFail：协议形态错误先重试，超过预算才失败。
     *
     * @param candidate Deep Agents 单次运行候选结果。
     * @param reason 判定原因。
     * @param retryPrompt 追加给模型的内部提示。
     * @returns 下一步动作。
     */
    private retryOrFail(
        candidate: AgentRunCandidate,
        reason: string,
        retryPrompt: string,
    ): AgentCompletionDecision {
        if (candidate.protocolRetryCount < candidate.budget.protocolRetryBudget
            && candidate.attemptIndex < candidate.budget.maxSupervisorAttempts) {
            return {
                status: "retry",
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
        if (candidate.noProgressRetryCount < candidate.budget.noProgressRetryBudget
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

    /**
     * stringifyDiagnosticContent：把诊断内容压缩为可匹配文本。
     *
     * @param candidate Deep Agents 单次运行候选结果。
     * @returns 诊断文本。
     */
    private stringifyDiagnosticContent(candidate: AgentRunCandidate): string {
        const parts = [
            candidate.visibleText,
            candidate.lastModelMessageDiagnostics?.contentText,
            JSON.stringify(candidate.lastModelMessageDiagnostics?.rawModelMessage.content ?? ""),
        ];
        return parts.join("\n");
    }
}
