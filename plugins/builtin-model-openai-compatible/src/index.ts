import type {
  ModelMessage,
  ModelRequest,
  ModelUsage,
} from "@zhixin/model-protocol";
import type {PluginManifest} from "@zhixin/plugin-sdk";

/**
 * OpenAI 兼容协议模式。
 *
 * 来源：阶段 9 模型协议插件要求。
 * 含义：区分 Responses API 和 Chat Completions API。
 * 格式：固定字符串。
 * 默认值：由供应商配置 protocolMode 决定。
 * 约束：只做协议转换，不直接保存供应商敏感信息。
 */
export type OpenAiCompatibleMode =
  | "responses"
  | "chat-completions";

/**
 * openAiCompatiblePluginManifest：OpenAI 兼容内置模型协议插件清单。
 *
 * 来源：系统内置模型协议插件交付要求。
 * 含义：供中心服务启动时注册插件身份和不可卸载来源。
 * 格式：插件 SDK 标准清单。
 * 默认值：系统内置、全局范围、无额外权限。
 * 约束：ID 必须与供应商配置 protocolPluginId 保持一致。
 */
export const openAiCompatiblePluginManifest: PluginManifest = {
  id: "builtin-model-openai-compatible",
  name: "OpenAI 兼容",
  version: "0.1.0",
  source: "system-builtin",
  scope: "global",
  permissions: [],
};

/**
 * openAiCompatibleModelProtocolPlugin：OpenAI 兼容协议插件注册描述。
 *
 * 来源：中心服务模型协议插件注册表。
 * 含义：描述供应商页可选协议、可用模式和默认能力。
 * 格式：JSON 可序列化对象。
 * 默认值：默认模式为 chat-completions。
 * 约束：转换函数只做协议适配，认证和网络请求仍由中心服务处理。
 */
export const openAiCompatibleModelProtocolPlugin = {
  pluginId: openAiCompatiblePluginManifest.id,
  pluginName: openAiCompatiblePluginManifest.name,
  protocolModes: [
    {
      mode: "chat-completions",
      label: "Chat Completions",
      description: "适用于 OpenAI 兼容 /v1/chat/completions 协议。",
    },
    {
      mode: "responses",
      label: "Responses",
      description: "适用于 OpenAI 兼容 /v1/responses 协议。",
    },
  ],
  defaultProtocolMode: "chat-completions",
  defaultCapabilities: {
    supportsVision: true,
    supportsToolCalling: true,
    supportsJsonOutput: true,
    supportsReasoningEffort: true,
    providesCacheUsage: true,
    supportsModelList: true,
    supportsStreaming: true,
  },
} as const;

/**
 * OpenAICompatibleRequest：OpenAI 兼容请求载荷。
 *
 * 来源：内部 ModelRequest 转换结果。
 * 含义：发送给 OpenAI 兼容供应商的 JSON 请求体。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：baseUrl、API Key、代理策略由中心服务模型网关处理。
 */
export interface OpenAiCompatibleRequest {
  /**
   * endpoint: 相对接口路径。
   */
  endpoint: "/v1/responses" | "/v1/chat/completions";

  /**
   * body: 请求体。
   */
  body: Record<string, unknown>;
}

/**
 * toOpenAiCompatibleRequest：把内部模型请求转换为 OpenAI 兼容请求。
 *
 * @param request 内部模型请求。
 * @param mode OpenAI 兼容协议模式。
 * @returns OpenAI 兼容请求载荷。
 */
export function toOpenAiCompatibleRequest(
  request: ModelRequest,
  mode: OpenAiCompatibleMode,
): OpenAiCompatibleRequest {
  if (mode === "responses") {
    return {
      endpoint: "/v1/responses",
      body: {
        model: request.model,
        input: request.messages.map(toOpenAiMessage),
        tools: request.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parametersJsonSchema,
        })),
        stream: request.stream,
        reasoning: request.reasoningEffort
          ? {
              effort: request.reasoningEffort,
            }
          : undefined,
      },
    };
  }

  return {
    endpoint: "/v1/chat/completions",
    body: {
      model: request.model,
      messages: request.messages.map(toOpenAiMessage),
      tools: request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parametersJsonSchema,
        },
      })),
      stream: request.stream,
      reasoning_effort: request.reasoningEffort,
    },
  };
}

/**
 * normalizeOpenAiUsage：转换 OpenAI 兼容用量字段。
 *
 * @param rawUsage 供应商原始 usage 对象。
 * @returns 内部统一用量。
 */
export function normalizeOpenAiUsage(rawUsage: Record<string, unknown> | null): ModelUsage | null {
  if (!rawUsage) {
    return null;
  }

  return {
    inputTokens: readNumberOrNull(rawUsage.input_tokens),
    outputTokens: readNumberOrNull(rawUsage.output_tokens),
    totalTokens: readNumberOrNull(rawUsage.total_tokens),
    cacheHitTokens: readNumberOrNull(rawUsage.cached_tokens),
    cacheMissTokens: null,
    rawUsage,
  };
}

/**
 * toOpenAiMessage：转换内部消息到 OpenAI 兼容消息。
 *
 * @param message 内部模型消息。
 * @returns OpenAI 兼容消息对象。
 */
function toOpenAiMessage(message: ModelMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content.map((part) => {
      if (part.type === "text") {
        return {
          type: "text",
          text: part.text,
        };
      }

      if (part.type === "image") {
        return {
          type: "input_image",
          image_url: part.attachmentId,
        };
      }

      return {
        type: "tool_result",
        tool_call_id: part.toolCallId,
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
