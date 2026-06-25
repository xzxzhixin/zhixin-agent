/**
 * OpenAiProtocolShape：OpenAI 兼容接口返回的真实协议形态。
 */
export type OpenAiProtocolShape = "responses" | "chat_completions" | "unknown";

/**
 * OpenAiProtocolShapeDetector：按原始响应结构识别 OpenAI 返回形态。
 *
 * 用途：兼容供应商可能在 `/responses` 返回 Chat Completions，或在
 * `/chat/completions` 返回 Responses 的情况。这里仅检查协议结构，不读取提示词、
 * 工具名或业务参数，避免把模型文本当作工具调用恢复来源。
 */
export class OpenAiProtocolShapeDetector {
    /**
     * detectPayload：识别非流式响应体形态。
     *
     * @param payload 外部供应商返回的原始响应体。
     * @returns 协议形态。
     */
    public detectPayload(payload: unknown): OpenAiProtocolShape {
        if (!this.isRecord(payload)) {
            return "unknown";
        }
        if (Array.isArray(payload.output)) {
            return "responses";
        }
        if (payload.object === "response") {
            return "responses";
        }
        if (Array.isArray(payload.choices)) {
            return "chat_completions";
        }
        if (payload.object === "chat.completion") {
            return "chat_completions";
        }
        return "unknown";
    }

    /**
     * detectStreamEvent：识别流式事件形态。
     *
     * @param event 外部供应商返回的原始流式事件。
     * @returns 协议形态。
     */
    public detectStreamEvent(event: unknown): OpenAiProtocolShape {
        if (!this.isRecord(event)) {
            return "unknown";
        }
        if (typeof event.type === "string" && event.type.startsWith("response.")) {
            return "responses";
        }
        if (Array.isArray(event.choices)) {
            return "chat_completions";
        }
        if (event.object === "chat.completion.chunk") {
            return "chat_completions";
        }
        return this.detectPayload(event);
    }

    /**
     * isRecord：判断值是否为普通对象。
     *
     * @param value 待检查值。
     * @returns 是对象时返回 true。
     */
    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }
}
