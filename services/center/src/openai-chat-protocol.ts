/**
 * OpenAiToolCall：中心服务内部统一的 OpenAI Chat Completions 工具调用。
 *
 * 来源：OpenAI Chat Completions `message.tool_calls`。
 * 含义：模型请求中心服务工具执行的结构化调用。
 * 格式：工具调用 ID、函数名和 JSON 参数对象。
 * 默认值：无。
 * 约束：不得由模型普通文本 JSON 猜测生成，只能来自 OpenAI 结构化 `tool_calls`。
 */
export interface OpenAiToolCall {
    /** toolCallId: OpenAI `tool_calls[].id`，用于工具结果 `tool_call_id` 回填。 */
    toolCallId: string;
    /** name: OpenAI `tool_calls[].function.name`，必须是模型工具安全名。 */
    name: string;
    /** argumentsJson: OpenAI `tool_calls[].function.arguments` 解析后的 JSON 对象。 */
    argumentsJson: Record<string, unknown>;
}

/**
 * OpenAiToolSpec：中心服务内部统一的 OpenAI 工具定义。
 *
 * 来源：中心服务统一工具注册表和 MCP tools/list。
 * 含义：发送给 OpenAI Chat Completions `tools` 的函数工具声明。
 * 格式：函数名、说明、JSON Schema 和内部来源工具 ID。
 * 默认值：无。
 * 约束：`sourceToolId` 只在中心服务内部映射使用，不发送给供应商。
 */
export interface OpenAiToolSpec {
    /** name: OpenAI `tools[].function.name`，只能包含协议允许的安全字符。 */
    name: string;
    /** sourceToolId: 中心服务内部工具 ID，用于安全名回查。 */
    sourceToolId: string;
    /** description: OpenAI `tools[].function.description`。 */
    description: string;
    /** parametersJsonSchema: OpenAI `tools[].function.parameters` JSON Schema。 */
    parametersJsonSchema: Record<string, unknown>;
}

/**
 * OpenAiChatMessage：中心服务内部统一的 OpenAI Chat Completions 消息。
 *
 * 来源：会话消息、长期记忆、工具结果和模型工具调用回填。
 * 含义：发送给 `/v1/chat/completions` 的标准消息。
 * 格式：OpenAI role、文本 content、可选 tool_calls 和 tool_call_id。
 * 默认值：无。
 * 约束：工具结果必须使用 `role: "tool"` 并携带匹配的 `tool_call_id`。
 */
export interface OpenAiChatMessage {
    /** role: OpenAI Chat Completions 消息角色。 */
    role: "system" | "user" | "assistant" | "tool";
    /** content: OpenAI 消息文本；工具调用 assistant 消息允许为空文本。 */
    content: string | null;
    /** tool_calls: assistant 消息携带的结构化工具调用记录。 */
    tool_calls?: Array<{
        /** id: OpenAI 工具调用 ID。 */
        id: string;
        /** type: OpenAI 工具调用类型，中心服务只使用 function。 */
        type: "function";
        /** function: OpenAI 函数调用结构。 */
        function: {
            /** name: 工具函数名。 */
            name: string;
            /** arguments: JSON 字符串形式参数。 */
            arguments: string;
        };
    }>;
    /** tool_call_id: tool 消息回填的工具调用 ID。 */
    tool_call_id?: string;
}

/**
 * OpenAiChatRequest：中心服务内部唯一模型请求规范。
 *
 * 来源：模型网关组装结果。
 * 含义：直接发送给 OpenAI Chat Completions 或交给其他供应商适配器转换。
 * 格式：OpenAI Chat Completions 请求体。
 * 默认值：`stream` 为 true。
 * 约束：中心服务内部不得再使用自创模型请求协议。
 */
export interface OpenAiChatRequest {
    /** requestId: 中心服务生成的请求 ID，用于排查日志和事件关联。 */
    requestId: string;
    /** providerId: 中心服务供应商 ID。 */
    providerId: string;
    /** model: OpenAI Chat Completions 模型名。 */
    model: string;
    /** reasoningEffort: 推理深度，供应商支持时透传或由适配器转换。 */
    reasoningEffort: string | null;
    /** messages: OpenAI Chat Completions 标准消息列表。 */
    messages: OpenAiChatMessage[];
    /** tools: OpenAI 函数工具定义。 */
    tools: OpenAiToolSpec[];
    /** stream: 是否使用 SSE 流式响应。 */
    stream: boolean;
}

/**
 * OpenAiUsage：中心服务统一用量结构。
 *
 * 来源：OpenAI usage 或其他供应商适配器归一化结果。
 * 含义：写入用量统计和事件载荷。
 * 格式：token 数和原始用量对象。
 * 默认值：供应商未提供时为 null。
 * 约束：不能用它替代供应商原始 usage，必须保留 `rawUsage`。
 */
export interface OpenAiUsage {
    /** inputTokens: 输入 token 数，对应 OpenAI prompt_tokens。 */
    inputTokens: number | null;
    /** outputTokens: 输出 token 数，对应 OpenAI completion_tokens。 */
    outputTokens: number | null;
    /** totalTokens: 总 token 数，对应 OpenAI total_tokens。 */
    totalTokens: number | null;
    /** cacheHitTokens: 缓存命中 token 数，无该字段时为 null。 */
    cacheHitTokens: number | null;
    /** cacheMissTokens: 缓存未命中 token 数，无该字段时为 null。 */
    cacheMissTokens: number | null;
    /** rawUsage: 供应商返回或适配后的原始用量对象。 */
    rawUsage: unknown;
}
