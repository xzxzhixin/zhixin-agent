import {isTransientModelErrorTest} from "../services/center/src/AgentMiddleware/CenterModelRetryMiddleware.js";

/**
 * assert：脚本式回归断言。
 *
 * @param condition 断言条件。
 * @param message 失败时展示的中文说明。
 */
function assert(
    condition: boolean,
    message: string,
): void {
    if (!condition) {
        throw new Error(message);
    }
}

assert(
    isTransientModelErrorTest(new Error("502 Upstream request failed")),
    "502 Upstream request failed 必须被识别为可重试的模型瞬时异常",
);

assert(
    isTransientModelErrorTest({
        status: 503,
        message: "Service unavailable",
    }),
    "HTTP 503 必须被识别为可重试的模型瞬时异常",
);

assert(
    !isTransientModelErrorTest(new Error("MODEL_TOOL_NAME_MISSING:shellCommand")),
    "模型协议错误不能触发模型调用重试",
);

console.log("check-model-retry-middleware passed");
