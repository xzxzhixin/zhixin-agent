import {
    EVENT_SCOPE_TYPES,
    EVENT_TYPES,
    TASK_STATUSES,
} from "@zhixin/shared";

import type {DeepAgentsToolExecutionContext} from "../StructuredTool/index.js";
import {CenterAgentMiddleware} from "./CenterAgentMiddleware.js";

/** MAX_MODEL_CALL_ATTEMPTS：模型瞬时异常最多尝试次数，包含首次调用。 */
const MAX_MODEL_CALL_ATTEMPTS = 5;

/** RETRY_DELAY_MS：模型瞬时异常重试间隔，避免立即打满上游服务。 */
const RETRY_DELAY_MS = 1200;

/** TRANSIENT_HTTP_STATUS_CODES：可判定为瞬时上游异常的 HTTP 状态码。 */
const TRANSIENT_HTTP_STATUS_CODES = new Set([
    502,
    503,
    504,
]);

/**
 * CenterModelRetryMiddleware：模型瞬时上游异常重试中间件。
 *
 * 用途：网络重置、上游 502/503/504 或超时属于运行异常候选，不能一次波动就让轮次终态失败。
 * 该中间件只做有限重试和诊断事件，不生成助手消息，不恢复工具调用，也不解析用户提示词。
 */
export class CenterModelRetryMiddleware extends CenterAgentMiddleware {
    /** name：Deep Agents 用于识别和过滤当前中间件的固定名称。 */
    public override name = "CenterModelRetryMiddleware";

    /** context：当前轮次工具执行上下文，提供事件、任务和会话事实源。 */
    private readonly context: DeepAgentsToolExecutionContext;

    /**
     * constructor：创建模型重试中间件。
     *
     * @param context 当前轮次工具执行上下文。
     */
    public constructor(context: DeepAgentsToolExecutionContext) {
        super();
        this.context = context;
    }

    /**
     * wrapModelCall：模型调用遇到瞬时异常时执行有限重试。
     *
     * @param request Deep Agents 模型调用请求。
     * @param handler Deep Agents 原始模型调用处理器。
     * @returns 模型调用结果。
     */
    public override wrapModelCall: CenterAgentMiddleware["wrapModelCall"] = async (request, handler) => {
        for (let attempt = 1; attempt <= MAX_MODEL_CALL_ATTEMPTS; attempt += 1) {
            try {
                return await handler(request);
            } catch (error) {
                if (!this.shouldRetryModelError(
                    error,
                    attempt,
                )) {
                    throw error;
                }
                this.appendRetryEvent(
                    error,
                    attempt,
                );
                await waitBeforeRetry();
            }
        }
        throw new Error("MODEL_CALL_RETRY_EXHAUSTED");
    };

    /**
     * shouldRetryModelError：判断模型异常是否允许继续重试。
     *
     * @param error 模型调用抛出的异常。
     * @param attempt 当前尝试序号。
     * @returns 允许重试时返回 true。
     */
    private shouldRetryModelError(
        error: unknown,
        attempt: number,
    ): boolean {
        if (attempt >= MAX_MODEL_CALL_ATTEMPTS) {
            return false;
        }
        return isTransientModelError(error);
    }

    /**
     * appendRetryEvent：写入模型重试诊断事件。
     *
     * @param error 模型调用抛出的异常。
     * @param attempt 当前失败尝试序号。
     * @returns 没有返回值。
     */
    private appendRetryEvent(
        error: unknown,
        attempt: number,
    ): void {
        const errorMessage = readErrorMessage(error);
        this.context.input.events.append({
            eventType: EVENT_TYPES.MODEL_CALL_RETRYING,
            scopeType: EVENT_SCOPE_TYPES.MODEL,
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: TASK_STATUSES.RUNNING,
            title: "模型调用重试",
            summary: `模型调用出现瞬时异常，准备第 ${attempt + 1} 次尝试。`,
            payload: {
                // attempt：当前失败尝试序号，首次失败为 1。
                attempt,
                // maxAttempts：包含首次调用在内的最大尝试次数。
                maxAttempts: MAX_MODEL_CALL_ATTEMPTS,
                // errorMessage：仅记录短错误文本，避免把请求体或敏感信息写入事件。
                errorMessage,
            },
        });
    }
}

/**
 * isTransientModelError：识别模型调用瞬时异常。
 *
 * @param error 模型调用抛出的异常。
 * @returns 可重试的瞬时异常返回 true。
 */
function isTransientModelError(error: unknown): boolean {
    const status = readErrorStatus(error);
    if (typeof status === "number" && TRANSIENT_HTTP_STATUS_CODES.has(status)) {
        return true;
    }
    const message = readErrorMessage(error).toLowerCase();
    return message.includes("502 upstream")
        || message.includes("503")
        || message.includes("504")
        || message.includes("upstream request failed")
        || message.includes("econnreset")
        || message.includes("etimedout")
        || message.includes("timeout")
        || message.includes("socket hang up");
}

/**
 * isTransientModelErrorTest：暴露给回归脚本的瞬时异常识别入口。
 *
 * @param error 模型调用抛出的异常。
 * @returns 可重试的瞬时异常返回 true。
 */
export function isTransientModelErrorTest(error: unknown): boolean {
    return isTransientModelError(error);
}

/**
 * readErrorStatus：读取常见 SDK 错误对象中的 HTTP 状态码。
 *
 * @param error 模型调用抛出的异常。
 * @returns HTTP 状态码；无法读取时返回 null。
 */
function readErrorStatus(error: unknown): number | null {
    if (typeof error !== "object" || error === null) {
        return null;
    }
    const record = error as {
        /** status：OpenAI SDK 常见 HTTP 状态码字段。 */
        status?: unknown;
        /** statusCode：Node/HTTP 客户端常见状态码字段。 */
        statusCode?: unknown;
        /** code：部分 SDK 使用数字 code 表示 HTTP 状态。 */
        code?: unknown;
    };
    for (const value of [
        record.status,
        record.statusCode,
        record.code,
    ]) {
        if (typeof value === "number") {
            return value;
        }
    }
    return null;
}

/**
 * readErrorMessage：读取异常短文本。
 *
 * @param error 模型调用抛出的异常。
 * @returns 错误文本。
 */
function readErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/**
 * waitBeforeRetry：等待下一次模型调用重试。
 *
 * @returns 等待完成的 Promise。
 */
function waitBeforeRetry(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(
            resolve,
            RETRY_DELAY_MS,
        );
    });
}
