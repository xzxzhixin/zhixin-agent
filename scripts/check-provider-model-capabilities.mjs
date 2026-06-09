import {readFileSync} from "node:fs";

/**
 * readSource：读取源码文本。
 *
 * @param {string} path 仓库根目录下的源码路径。
 * @returns {string} UTF-8 源码文本。
 */
function readSource(path) {
  return readFileSync(
    new URL(`../${path}`, import.meta.url),
    "utf-8",
  );
}

const providerPage = readSource("apps/frontend/src/views/Providers/RouterIndex.vue");
const storeActions = readSource("apps/frontend/src/stores/app-management-actions.ts");
const storeHelpers = readSource("apps/frontend/src/stores/app-helpers.ts");
const apiClient = readSource("packages/api-client/src/index.ts");
const providerDomain = readSource("services/center/src/domain/provider-domain.ts");

/**
 * assertIncludes：检查源码中必须存在的协议片段。
 *
 * @param {string} source 源码文本。
 * @param {string} pattern 必须出现的文本。
 * @param {string} message 缺失时输出的错误。
 * @returns {void}
 */
function assertIncludes(
  source,
  pattern,
  message,
) {
  if (!source.includes(pattern)) {
    console.error(message);
    process.exitCode = 1;
  }
}

/**
 * assertNotIncludes：检查源码中不能存在的风险片段。
 *
 * @param {string} source 源码文本。
 * @param {string} pattern 禁止出现的文本。
 * @param {string} message 存在时输出的错误。
 * @returns {void}
 */
function assertNotIncludes(
  source,
  pattern,
  message,
) {
  if (source.includes(pattern)) {
    console.error(message);
    process.exitCode = 1;
  }
}

assertIncludes(
  providerPage,
  "推理深度",
  "供应商页必须提供推理深度手填入口，不能只在 store 中保留隐藏字段。",
);
assertIncludes(
  providerPage,
  "manualReasoningEffortText",
  "供应商页必须通过明确计算属性同步推理深度刷新文本。",
);
assertIncludes(
  providerPage,
  "manualModelContextError",
  "供应商页必须在提交前展示模型上下文格式错误。",
);
assertIncludes(
  storeActions,
  "if (this.providerDraft.providerId === provider.providerId && this.providerModelDraftHasError())",
  "刷新供应商模型前必须阻止当前编辑供应商的非法手填模型窗口。",
);
assertIncludes(
  storeHelpers,
  "parseModelContextWindows",
  "前端必须保留 K 单位模型窗口解析函数。",
);
assertIncludes(
  storeHelpers,
  "Math.round(contextWindowK * 1000)",
  "前端必须把上下文窗口 K 单位转换为 token 数值。",
);
assertIncludes(
  apiClient,
  "reasoningEfforts: string[]",
  "API 客户端模型刷新协议必须包含推理深度列表。",
);
assertIncludes(
  providerDomain,
  "normalizeProviderCapabilities",
  "中心服务必须规范化图片、工具、JSON、推理深度、模型列表和流式能力声明。",
);
assertIncludes(
  providerDomain,
  "apiKeySecretRef",
  "中心服务供应商配置必须使用 API Key secret 引用保存敏感信息。",
);
assertNotIncludes(
  providerDomain,
  "apiKeySha256",
  "供应商 API Key 不能退回摘要保存或回显。",
);
assertNotIncludes(
  providerDomain,
  "apiKeySecretRef: undefined",
  "供应商列表不能把 secret 引用字段混入响应结构。",
);
