import type {PluginManifest} from "@zhixin/plugin-sdk";

/**
 * OpenAiChatPayload：Anthropic 适配器接收的 OpenAI Chat Completions 请求。
 *
 * 来源：中心服务内部唯一模型协议。
 * 含义：其他供应商协议必须先以 OpenAI Chat Completions 形态进入适配器。
 * 格式：模型、消息、工具、流式和推理深度字段。
 * 默认值：无。
 * 约束：适配器不能向中心服务暴露旧协议模式。
 */
export interface OpenAiChatPayload {
  /** model: 模型名。 */
  model: string;
  /** messages: OpenAI Chat Completions 标准消息。 */
  messages: Array<{
    /** role: OpenAI 消息角色。 */
    role: "system" | "user" | "assistant" | "tool";
    /** content: 消息文本，工具调用消息可为空。 */
    content: string | null;
    /** tool_call_id: tool 消息回填工具调用 ID。 */
    tool_call_id?: string;
  }>;
  /** tools: OpenAI 函数工具定义。 */
  tools: Array<{
    /** name: 函数工具名。 */
    name: string;
    /** description: 函数工具说明。 */
    description: string;
    /** parametersJsonSchema: 函数工具参数 JSON Schema。 */
    parametersJsonSchema: Record<string, unknown>;
  }>;
  /** stream: 是否流式输出。 */
  stream: boolean;
  /** reasoningEffort: 推理深度；适配器按供应商能力转换。 */
  reasoningEffort: string | null;
}

/**
 * anthropicMessagesPluginManifest：Anthropic 内置模型适配器插件清单。
 *
 * 来源：系统内置协议适配器插件交付要求。
 * 含义：供中心服务启动时注册插件身份和不可卸载来源。
 * 格式：插件 SDK 标准清单。
 * 默认值：系统内置、全局范围、无额外权限。
 * 约束：内部仍按 OpenAI Chat Completions 规范接收请求。
 */
export const anthropicMessagesPluginManifest: PluginManifest = {
  id: "builtin-model-anthropic-messages",
  name: "Anthropic 适配器",
  version: "0.1.0",
  source: "system-builtin",
  scope: "global",
  permissions: [],
};

/**
 * anthropicMessagesModelProtocolPlugin：Anthropic 适配器注册描述。
 *
 * 来源：中心服务协议适配器注册表。
 * 含义：描述该插件只接受中心内部 OpenAI Chat Completions 模式。
 * 格式：JSON 可序列化对象。
 * 默认值：默认模式为 chat-completions。
 * 约束：不能再把 Anthropic 私有模式暴露为中心内部协议。
 */
export const anthropicMessagesModelProtocolPlugin = {
  pluginId: anthropicMessagesPluginManifest.id,
  pluginName: anthropicMessagesPluginManifest.name,
  protocolModes: [
    {
      mode: "chat-completions",
      label: "Chat Completions",
      description: "中心内部使用 OpenAI Chat Completions，插件负责转换到 Anthropic 请求。",
    },
  ],
  defaultProtocolMode: "chat-completions",
  defaultCapabilities: {
    supportsVision: true,
    supportsToolCalling: true,
    supportsJsonOutput: true,
    supportsReasoningEffort: true,
    providesCacheUsage: true,
    supportsModelList: false,
    supportsStreaming: true,
  },
} as const;

/**
 * AnthropicAdapterRequest：Anthropic 供应商请求载荷。
 *
 * 来源：OpenAI Chat Completions 请求适配结果。
 * 含义：发送给 Anthropic 供应商的 JSON 请求体。
 * 格式：接口路径和请求体。
 * 默认值：路径固定。
 * 约束：认证、代理和 URL 由中心服务模型网关处理。
 */
export interface AnthropicAdapterRequest {
  /** endpoint: 相对接口路径。 */
  endpoint: "/v1/messages";
  /** body: Anthropic 请求体。 */
  body: Record<string, unknown>;
}

/**
 * toAnthropicAdapterRequest：把 OpenAI Chat Completions 请求转换为 Anthropic 请求。
 *
 * @param request 中心内部 OpenAI Chat Completions 请求。
 * @returns Anthropic 请求载荷。
 */
export function toAnthropicAdapterRequest(request: OpenAiChatPayload): AnthropicAdapterRequest {
  return {
    endpoint: "/v1/messages",
    body: {
      model: request.model,
      messages: request.messages
        .filter((message) => message.role !== "system")
        .map(toAnthropicMessage),
      system: request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content ?? "")
        .filter((content) => content.length > 0)
        .join("\n"),
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parametersJsonSchema,
      })),
      stream: request.stream,
      thinking: request.reasoningEffort
        ? {
            type: "enabled",
            effort: request.reasoningEffort,
          }
        : undefined,
    },
  };
}

/**
 * normalizeAnthropicUsage：转换 Anthropic 用量字段。
 *
 * @param rawUsage 供应商原始 usage 对象。
 * @returns 中心服务统一用量字段。
 */
export function normalizeAnthropicUsage(rawUsage: Record<string, unknown> | null): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
  rawUsage: Record<string, unknown>;
} | null {
  if (!rawUsage) {
    return null;
  }

  return {
    inputTokens: readNumberOrNull(rawUsage.input_tokens),
    outputTokens: readNumberOrNull(rawUsage.output_tokens),
    totalTokens: null,
    cacheHitTokens: readNumberOrNull(rawUsage.cache_read_input_tokens),
    cacheMissTokens: readNumberOrNull(rawUsage.cache_creation_input_tokens),
    rawUsage,
  };
}

/**
 * toAnthropicMessage：转换 OpenAI 消息到 Anthropic 消息。
 *
 * @param message OpenAI Chat Completions 消息。
 * @returns Anthropic 消息对象。
 */
function toAnthropicMessage(message: OpenAiChatPayload["messages"][number]): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.tool_call_id,
          content: message.content ?? "",
        },
      ],
    };
  }

  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: [
      {
        type: "text",
        text: message.content ?? "",
      },
    ],
  };
}

/**
 * readNumberOrNull：读取供应商数字字段。
 *
 * @param value 原始字段值。
 * @returns 数字或 null。
 */
function readNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
