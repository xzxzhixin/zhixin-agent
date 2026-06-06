/**
 * 模型内容片段。
 *
 * 来源：内部统一模型协议。
 * 含义：表达文本、图片或工具结果等多模态输入输出片段。
 * 格式：判别联合类型。
 * 默认值：无。
 * 约束：供应商原始结构必须在模型协议插件内转换成该类型。
 */
export type ModelContentPart =
  | {
      /**
       * type: 文本片段类型。
       */
      type: "text";

      /**
       * text: 文本内容。
       */
      text: string;
    }
  | {
      /**
       * type: 图片片段类型。
       */
      type: "image";

      /**
       * attachmentId: 中心服务正式附件 ID。
       */
      attachmentId: string;
    }
  | {
      /**
       * type: 工具结果片段类型。
       */
      type: "tool_result";

      /**
       * toolCallId: 对应工具调用 ID。
       */
      toolCallId: string;

      /**
       * resultText: 工具返回文本摘要。
       */
      resultText: string;
    };

/**
 * 模型消息角色。
 *
 * 来源：内部统一模型协议。
 * 含义：描述发送给模型的消息来源。
 * 格式：固定字符串枚举。
 * 默认值：无。
 * 约束：不同供应商角色名差异由协议插件适配。
 */
export type ModelMessageRole =
  | "system"
  | "user"
  | "assistant"
  | "tool";

/**
 * 模型消息。
 *
 * 来源：内部统一模型协议。
 * 含义：Agent 引擎传给模型网关的标准消息。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：content 使用结构化片段，不传供应商原始 content。
 */
export interface ModelMessage {
  /**
   * role: 模型消息角色。
   */
  role: ModelMessageRole;

  /**
   * content: 消息内容片段列表。
   */
  content: ModelContentPart[];

  /**
   * toolCalls: 助手消息关联的工具调用记录。
   *
   * 来源：模型首次请求工具后，中心服务回填工具结果前补充的协议上下文。
   * 含义：让供应商知道后续 tool 消息对应哪个工具调用。
   * 格式：ModelToolCall 数组。
   * 默认值：未发生工具调用时省略。
   * 约束：仅 assistant 消息使用；tool 消息通过 content 内 tool_result 关联 toolCallId。
   */
  toolCalls?: ModelToolCall[];
}

/**
 * 模型工具规格。
 *
 * 来源：内部统一模型工具调用协议。
 * 含义：声明模型可请求调用的工具。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：parametersJsonSchema 使用 JSON Schema 对象，不使用供应商私有字段。
 */
export interface ModelToolSpec {
  /**
   * name: 提供给模型供应商的工具名称。
   *
   * 来源：内部工具 ID 经模型协议命名规则转换。
   * 含义：满足 OpenAI 兼容、Anthropic 等模型工具名的通用安全名称。
   * 格式：只能使用字母、数字、下划线或连字符。
   * 默认值：无。
   * 约束：不能直接使用带点号的内部工具 ID。
   */
  name: string;

  /**
   * sourceToolId: 中心服务内部工具 ID。
   *
   * 来源：统一工具能力注册表。
   * 含义：模型返回安全工具名后，中心服务用该字段映射回真实执行器。
   * 格式：稳定字符串，例如 builtin.command.run。
   * 默认值：无。
   * 约束：只在中心服务内部使用，不要求供应商认识。
   */
  sourceToolId: string;

  /**
   * description: 工具中文或英文说明。
   */
  description: string;

  /**
   * parametersJsonSchema: 工具参数 JSON Schema。
   */
  parametersJsonSchema: Record<string, unknown>;
}

/**
 * 模型请求。
 *
 * 来源：Agent Worker 到模型网关的统一协议。
 * 含义：描述一次模型调用所需上下文和能力。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：供应商、模型和推理深度必须由中心服务解析后填入。
 */
export interface ModelRequest {
  /**
   * requestId: 模型请求 ID。
   */
  requestId: string;

  /**
   * providerId: 中心服务供应商 ID。
   */
  providerId: string;

  /**
   * model: 模型名称。
   */
  model: string;

  /**
   * reasoningEffort: 推理深度；供应商不支持时为 null。
   */
  reasoningEffort: string | null;

  /**
   * messages: 标准模型消息列表。
   */
  messages: ModelMessage[];

  /**
   * tools: 可用工具规格列表。
   */
  tools: ModelToolSpec[];

  /**
   * stream: 是否请求流式输出。
   */
  stream: boolean;
}

/**
 * 模型工具调用。
 *
 * 来源：内部统一模型流式事件。
 * 含义：表示模型请求调用某个工具。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：argumentsJson 必须是解析后的 JSON 对象。
 */
export interface ModelToolCall {
  /**
   * toolCallId: 工具调用 ID。
   */
  toolCallId: string;

  /**
   * name: 工具名称。
   */
  name: string;

  /**
   * argumentsJson: 工具参数 JSON 对象。
   */
  argumentsJson: Record<string, unknown>;
}

/**
 * 模型流式事件。
 *
 * 来源：模型网关输出给 Agent Worker 的统一事件。
 * 含义：屏蔽 OpenAI 兼容和 Anthropic Messages 的原始 SSE 差异。
 * 格式：判别联合类型。
 * 默认值：无。
 * 约束：sequence 在单次模型请求内递增。
 */
export type ModelStreamEvent =
  | {
      /**
       * type: 文本增量事件。
       */
      type: "message.delta";

      /**
       * sequence: 单次模型请求内递增序号。
       */
      sequence: number;

      /**
       * deltaText: 增量文本。
       */
      deltaText: string;
    }
  | {
      /**
       * type: 工具调用事件。
       */
      type: "tool.call";

      /**
       * sequence: 单次模型请求内递增序号。
       */
      sequence: number;

      /**
       * toolCall: 标准工具调用结构。
       */
      toolCall: ModelToolCall;
    }
  | {
      /**
       * type: 模型完成事件。
       */
      type: "message.completed";

      /**
       * sequence: 单次模型请求内递增序号。
       */
      sequence: number;

      /**
       * usage: 本次调用用量；供应商未提供时为 null。
       */
      usage: ModelUsage | null;
    };

/**
 * 模型用量。
 *
 * 来源：供应商原始用量经模型协议插件转换。
 * 含义：统一统计输入、输出、缓存命中和缓存未命中 token。
 * 格式：JSON 对象。
 * 默认值：字段可为 null 表示供应商未提供。
 * 约束：不能用 0 冒充供应商未提供的缓存字段。
 */
export interface ModelUsage {
  /**
   * inputTokens: 输入 token 数；供应商未提供时为 null。
   */
  inputTokens: number | null;

  /**
   * outputTokens: 输出 token 数；供应商未提供时为 null。
   */
  outputTokens: number | null;

  /**
   * totalTokens: 总 token 数；供应商未提供时为 null。
   */
  totalTokens: number | null;

  /**
   * cacheHitTokens: 缓存命中 token 数；供应商未提供时为 null。
   */
  cacheHitTokens: number | null;

  /**
   * cacheMissTokens: 缓存未命中 token 数；供应商未提供时为 null。
   */
  cacheMissTokens: number | null;

  /**
   * rawUsage: 供应商原始用量对象，用于审计和排查。
   */
  rawUsage: unknown;
}

/**
 * 模型错误。
 *
 * 来源：模型协议插件错误转换。
 * 含义：统一表示代理、认证、供应商连接、供应商接口和协议解析失败。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：错误分类必须明确，不能只返回 unknown。
 */
export interface ModelError {
  /**
   * category: 模型调用失败类别。
   */
  category:
    | "proxy_connection_failed"
    | "proxy_auth_failed"
    | "provider_connection_failed"
    | "provider_api_failed"
    | "protocol_parse_failed";

  /**
   * message: 面向日志的错误消息。
   */
  message: string;

  /**
   * displayMessage: 可展示给用户的中文原因。
   */
  displayMessage: string;

  /**
   * traceId: 排查 ID。
   */
  traceId: string;
}
