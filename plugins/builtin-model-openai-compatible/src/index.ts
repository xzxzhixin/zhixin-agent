import type {PluginManifest} from "@zhixin/plugin-sdk";

/**
 * OpenAiToolSpec：插件侧最小 OpenAI 工具声明。
 *
 * 来源：OpenAI Chat Completions `tools`。
 * 含义：描述模型可请求的函数工具。
 * 格式：函数名、说明和 JSON Schema。
 * 默认值：无。
 * 约束：插件侧不保存中心服务内部 `sourceToolId`。
 */
export interface OpenAiToolSpec {
  /** name: OpenAI function.name。 */
  name: string;
  /** description: OpenAI function.description。 */
  description: string;
  /** parametersJsonSchema: OpenAI function.parameters。 */
  parametersJsonSchema: Record<string, unknown>;
}

/**
 * OpenAiChatPayload：插件侧最小 OpenAI Chat Completions 请求。
 *
 * 来源：中心服务统一模型网关。
 * 含义：直接发送给 OpenAI 兼容 `/v1/chat/completions`。
 * 格式：模型、消息、工具、流式和推理深度字段。
 * 默认值：`stream` 由中心服务传入。
 * 约束：不再支持 Responses 模式。
 */
export interface OpenAiChatPayload {
  /** model: OpenAI 兼容模型名。 */
  model: string;
  /** messages: OpenAI Chat Completions 标准消息。 */
  messages: Array<Record<string, unknown>>;
  /** tools: OpenAI 函数工具定义。 */
  tools: OpenAiToolSpec[];
  /** stream: 是否流式输出。 */
  stream: boolean;
  /** reasoningEffort: 推理深度；供应商支持时转换为 reasoning_effort。 */
  reasoningEffort: string | null;
}

/**
 * OpenAiCompatibleRequest：OpenAI 兼容请求载荷。
 *
 * 来源：OpenAI Chat Completions 统一规范。
 * 含义：发送给 OpenAI 兼容供应商的 JSON 请求体。
 * 格式：接口路径和请求体。
 * 默认值：路径固定 `/v1/chat/completions`。
 * 约束：baseUrl、API Key、代理策略由中心服务模型网关处理。
 */
export interface OpenAiCompatibleRequest {
  /** endpoint: 相对接口路径。 */
  endpoint: "/v1/chat/completions";
  /** body: OpenAI Chat Completions 请求体。 */
  body: Record<string, unknown>;
}

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
 * 约束：转换函数只做 OpenAI Chat Completions 适配，认证和网络请求仍由中心服务处理。
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
 * toOpenAiCompatibleRequest：生成 OpenAI Chat Completions 请求。
 *
 * @param request OpenAI Chat Completions 统一请求。
 * @returns OpenAI 兼容请求载荷。
 */
export function toOpenAiCompatibleRequest(request: OpenAiChatPayload): OpenAiCompatibleRequest {
  return {
    endpoint: "/v1/chat/completions",
    body: {
      model: request.model,
      messages: request.messages,
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
 * @returns 中心服务统一用量字段。
 */
export function normalizeOpenAiUsage(rawUsage: Record<string, unknown> | null): {
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
    inputTokens: readNumberOrNull(rawUsage.input_tokens ?? rawUsage.prompt_tokens),
    outputTokens: readNumberOrNull(rawUsage.output_tokens ?? rawUsage.completion_tokens),
    totalTokens: readNumberOrNull(rawUsage.total_tokens),
    cacheHitTokens: readNumberOrNull(rawUsage.cached_tokens),
    cacheMissTokens: null,
    rawUsage,
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
