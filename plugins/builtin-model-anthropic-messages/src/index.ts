import type {
  ModelMessage,
  ModelRequest,
  ModelUsage,
} from "@zhixin/model-protocol";
import type {PluginManifest} from "@zhixin/plugin-sdk";

/**
 * anthropicMessagesPluginManifest：Anthropic Messages 内置模型协议插件清单。
 *
 * 来源：系统内置模型协议插件交付要求。
 * 含义：供中心服务启动时注册插件身份和不可卸载来源。
 * 格式：插件 SDK 标准清单。
 * 默认值：系统内置、全局范围、无额外权限。
 * 约束：ID 必须与供应商配置 protocolPluginId 保持一致。
 */
export const anthropicMessagesPluginManifest: PluginManifest = {
  id: "builtin-model-anthropic-messages",
  name: "Anthropic Messages",
  version: "0.1.0",
  source: "system-builtin",
  scope: "global",
  permissions: [],
};

/**
 * anthropicMessagesModelProtocolPlugin：Anthropic Messages 协议插件注册描述。
 *
 * 来源：中心服务模型协议插件注册表。
 * 含义：描述供应商页可选协议、可用模式和默认能力。
 * 格式：JSON 可序列化对象。
 * 默认值：默认模式为 messages。
 * 约束：转换函数只做协议适配，认证和网络请求仍由中心服务处理。
 */
export const anthropicMessagesModelProtocolPlugin = {
  pluginId: anthropicMessagesPluginManifest.id,
  pluginName: anthropicMessagesPluginManifest.name,
  protocolModes: [
    {
      mode: "messages",
      label: "Messages",
      description: "适用于 Anthropic /v1/messages 协议。",
    },
  ],
  defaultProtocolMode: "messages",
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
 * AnthropicMessagesRequest：Anthropic Messages 请求载荷。
 *
 * 来源：内部 ModelRequest 转换结果。
 * 含义：发送给 Anthropic Messages 协议供应商的 JSON 请求体。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：认证、代理和 URL 由中心服务模型网关处理。
 */
export interface AnthropicMessagesRequest {
  /**
   * endpoint: 相对接口路径。
   */
  endpoint: "/v1/messages";

  /**
   * body: 请求体。
   */
  body: Record<string, unknown>;
}

/**
 * toAnthropicMessagesRequest：把内部模型请求转换为 Anthropic Messages 请求。
 *
 * @param request 内部模型请求。
 * @returns Anthropic Messages 请求载荷。
 */
export function toAnthropicMessagesRequest(request: ModelRequest): AnthropicMessagesRequest {
  return {
    endpoint: "/v1/messages",
    body: {
      model: request.model,
      messages: request.messages
        .filter((message) => message.role !== "system")
        .map(toAnthropicMessage),
      system: request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"))
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
 * @returns 内部统一用量。
 */
export function normalizeAnthropicUsage(rawUsage: Record<string, unknown> | null): ModelUsage | null {
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
 * toAnthropicMessage：转换内部消息到 Anthropic 消息。
 *
 * @param message 内部模型消息。
 * @returns Anthropic 消息对象。
 */
function toAnthropicMessage(message: ModelMessage): Record<string, unknown> {
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content.map((part) => {
      if (part.type === "text") {
        return {
          type: "text",
          text: part.text,
        };
      }

      if (part.type === "image") {
        return {
          type: "image",
          source: {
            type: "attachment",
            attachment_id: part.attachmentId,
          },
        };
      }

      return {
        type: "tool_result",
        tool_use_id: part.toolCallId,
        content: part.resultText,
      };
    }),
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
