/**
 * 模型协议插件和内置插件清单检查。
 *
 * 用途：验证阶段 9 和阶段 11 的内置插件导出可用，且插件权限校验生效。
 * 关键逻辑：直接调用纯转换函数，不访问外部供应商网络。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import {
  toOpenAiCompatibleRequest,
  normalizeOpenAiUsage,
} from "../plugins/builtin-model-openai-compatible/src/index";
import {
  toAnthropicMessagesRequest,
  normalizeAnthropicUsage,
} from "../plugins/builtin-model-anthropic-messages/src/index";
import {
  assertPluginPermission,
  validatePluginManifest,
} from "../packages/plugin-sdk/src/index";
import { builtinAutomationManifest } from "../plugins/builtin-automation/src/index";
import { builtinBrowserCollectorManifest } from "../plugins/builtin-browser-collector/src/index";
import { builtinFileOrganizerManifest } from "../plugins/builtin-file-organizer/src/index";
import { builtinOfficeIntegrationManifest } from "../plugins/builtin-office-integration/src/index";
import type { ModelRequest } from "../packages/model-protocol/src/index";

/**
 * assert：用统一错误格式表达检查失败原因。
 *
 * @param condition 需要满足的布尔条件。
 * @param message 条件不满足时抛出的中文错误。
 * @returns 条件满足时没有返回值。
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// request: 内部模型请求样例，覆盖文本、工具和推理深度。
const request: ModelRequest = {
  requestId: "request-check",
  providerId: "provider-check",
  model: "model-check",
  reasoningEffort: "medium",
  messages: [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: "系统提示",
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "用户消息",
        },
      ],
    },
  ],
  tools: [
    {
      name: "tool_check",
      description: "检查工具",
      parametersJsonSchema: {
        type: "object",
      },
    },
  ],
  stream: true,
};

const responsesRequest = toOpenAiCompatibleRequest(request, "responses");
assert(responsesRequest.endpoint === "/v1/responses", "OpenAI Responses endpoint 错误");

const chatRequest = toOpenAiCompatibleRequest(request, "chat-completions");
assert(chatRequest.endpoint === "/v1/chat/completions", "OpenAI Chat Completions endpoint 错误");

const anthropicRequest = toAnthropicMessagesRequest(request);
assert(anthropicRequest.endpoint === "/v1/messages", "Anthropic Messages endpoint 错误");

const openAiUsage = normalizeOpenAiUsage({
  input_tokens: 1,
  output_tokens: 2,
  total_tokens: 3,
});
assert(openAiUsage?.cacheMissTokens === null, "OpenAI 未提供缓存未命中字段时必须为 null");

const anthropicUsage = normalizeAnthropicUsage({
  input_tokens: 1,
  output_tokens: 2,
});
assert(anthropicUsage?.cacheHitTokens === null, "Anthropic 未提供缓存字段时必须为 null");

for (const manifest of [
  builtinAutomationManifest,
  builtinBrowserCollectorManifest,
  builtinFileOrganizerManifest,
  builtinOfficeIntegrationManifest,
]) {
  const validated = validatePluginManifest(manifest);
  assert(validated.source === "system-builtin", "内置插件来源必须是 system-builtin");
  assertPluginPermission(validated, "plugin.call");
}
