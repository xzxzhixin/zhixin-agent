import type {ModelMessageDiagnostics} from "../AgentMiddleware/CenterToolChoiceMiddleware.js";
import type {ProviderModelGatewayResult} from "../model-gateway-runtime.js";

/** AgentCompletionStatus：中心服务对单次 Deep Agents 候选结果的判定状态。 */
export type AgentCompletionStatus =
    | "completed"
    | "continue"
    | "retry"
    | "waiting_user"
    | "failed";

/** AgentCompletionDecision：完成网关返回的下一步动作。 */
export interface AgentCompletionDecision {
    /** status: 候选结果应进入的下一步状态。 */
    status: AgentCompletionStatus;
    /** reason: 机器可读原因，用于日志、预算和验收检查。 */
    reason: string;
    /** retryPrompt: 仅追加给下一次模型运行的内部续跑提示，不写入用户可见消息。 */
    retryPrompt?: string;
}

/** AgentSupervisorBudget：同一轮次内监督循环的安全预算。 */
export interface AgentSupervisorBudget {
    /** maxSupervisorAttempts: 同一轮次允许启动 Deep Agents 的最大次数。 */
    maxSupervisorAttempts: number;
    /** protocolRetryBudget: 普通文本伪工具形态的最大重试次数。 */
    protocolRetryBudget: number;
    /** noProgressRetryBudget: 连续过程文本但无结构化工具调用的最大续跑次数。 */
    noProgressRetryBudget: number;
    /** toolFailureRetryBudget: 工具失败后仍允许模型换路径尝试的最大次数。 */
    toolFailureRetryBudget: number;
}

/** AgentRunCandidate：一次 Deep Agents graph 结束后的候选结果。 */
export interface AgentRunCandidate {
    /** attemptIndex: 当前候选是本轮监督循环中的第几次运行，从 1 开始。 */
    attemptIndex: number;
    /** visibleText: 本次候选可见助手文本，可能只是过程文字。 */
    visibleText: string;
    /** streamedText: Deep Agents 流式阶段累计文本。 */
    streamedText: string;
    /** modelResult: 模型供应商、模型名和用量等运行结果。 */
    modelResult: ProviderModelGatewayResult | null;
    /** lastModelMessageDiagnostics: middleware 记录的最后一条 AIMessage 诊断摘要。 */
    lastModelMessageDiagnostics: ModelMessageDiagnostics | null;
    /** hasStructuredToolCall: 最后模型响应是否包含结构化工具调用。 */
    hasStructuredToolCall: boolean;
    /** hasToolExecutionEvents: 当前轮次是否已经出现真实工具请求、执行或结果回填事件。 */
    hasToolExecutionEvents: boolean;
    /** hasRecentToolResult: 当前候选结束前是否刚产生工具结果回填。 */
    hasRecentToolResult: boolean;
    /** hasPendingTaskState: 当前任务事实源是否仍处于运行或排队状态。 */
    hasPendingTaskState: boolean;
    /** hasToolFailureEvents: 当前轮次是否已经出现工具失败事件。 */
    hasToolFailureEvents: boolean;
    /** cancelled: 当前轮次是否已经被用户取消。 */
    cancelled: boolean;
    /** budget: 监督循环预算快照。 */
    budget: AgentSupervisorBudget;
    /** protocolRetryCount: 已发生普通文本伪工具形态重试次数。 */
    protocolRetryCount: number;
    /** noProgressRetryCount: 已发生过程文本无进展续跑次数。 */
    noProgressRetryCount: number;
    /** toolFailureRetryCount: 已发生工具失败替代路径重试次数。 */
    toolFailureRetryCount: number;
}
