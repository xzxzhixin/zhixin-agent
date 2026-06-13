/**
 * 中心服务工具调用闭环静态检查。
 *
 * 用途：防止工具调用退回到用户文本硬编码识别，确保模型请求携带结构化工具定义。
 * 关键逻辑：扫描中心服务工具运行时、模型网关和会话编排源码中的关键协议片段。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import {readFileSync} from "node:fs";

/**
 * readText：读取 UTF-8 文本文件。
 *
 * @param path 文件路径。
 * @returns 文件文本。
 */
function readText(path) {
  return readFileSync(path, "utf-8");
}

/**
 * assertIncludes：断言文本包含指定片段。
 *
 * @param text 待检查文本。
 * @param snippet 必须存在的片段。
 * @param message 失败说明。
 * @returns 没有返回值。
 */
function assertIncludes(text, snippet, message) {
  if (!text.includes(snippet)) {
    throw new Error(message);
  }
}

/**
 * assertNotIncludes：断言文本不包含指定片段。
 *
 * @param text 待检查文本。
 * @param snippet 禁止存在的片段。
 * @param message 失败说明。
 * @returns 没有返回值。
 */
function assertNotIncludes(text, snippet, message) {
  if (text.includes(snippet)) {
    throw new Error(message);
  }
}

const toolRuntime = [
  "services/center/src/tools/index.ts",
  "services/center/src/tools/tool-capability-registry.ts",
  "services/center/src/tools/tool-openai-adapter.ts",
].map((path) => readText(path)).join("\n");
const modelGateway = readText("services/center/src/model-gateway-runtime.ts");
const sessionDomain = readText("services/center/src/domain/session-domain.ts");
const sessionTurnEffects = readText("services/center/src/domain/session-turn-effects.ts");
const deepAgentsRunner = readText("services/center/src/deepagents-runner.ts");
const sharedTypes = readText("packages/shared/src/index.ts");

assertIncludes(sharedTypes, "UnifiedToolRiskLevel", "共享协议缺少工具风险等级");
assertIncludes(sharedTypes, "UnifiedToolInputSchema", "共享协议缺少工具输入 schema");
assertIncludes(toolRuntime, "inputSchema", "工具运行时缺少结构化输入 schema");
assertIncludes(toolRuntime, "listAvailableModelToolSpecs", "工具运行时缺少模型工具定义转换函数");
assertIncludes(toolRuntime, "buildUnifiedToolCallIntentFromModelCall", "工具运行时缺少模型工具调用转换函数");
assertIncludes(modelGateway, "const tools = await listAvailableModelToolSpecsForCenter", "模型网关必须读取中心服务工具定义");
assertIncludes(modelGateway, "buildOpenAiChatPayload", "模型网关必须把工具定义传入 OpenAI Chat payload");
assertIncludes(modelGateway, "tool_calls", "模型网关缺少 OpenAI tool_calls 解析");
assertIncludes(modelGateway, "tool_call_id", "模型网关缺少 OpenAI tool_call_id 回填");
assertIncludes(deepAgentsRunner, "tool.execute", "Deep Agents runner 缺少工具执行节点");
assertIncludes(deepAgentsRunner, "tool.result", "Deep Agents runner 缺少工具结果回填节点");
assertIncludes(deepAgentsRunner, ".addConditionalEdges(", "Deep Agents runner 缺少 OpenAI tool_calls 条件边");
assertIncludes(sessionTurnEffects, "model.tool.requested", "会话工具执行缺少模型工具请求事件");
assertIncludes(modelGateway, "continueProviderModelGatewayWithToolResults", "模型网关缺少多工具结果回填模型");
assertNotIncludes(toolRuntime, "normalized.includes(\"node\")", "工具运行时仍通过 node 文本硬编码触发工具");
assertNotIncludes(toolRuntime, "normalized.includes(\"python\")", "工具运行时仍通过 python 文本硬编码触发工具");
assertNotIncludes(sessionDomain, "const unifiedToolIntent = planUnifiedToolCallForUserText(userText);", "会话编排仍先按用户文本硬编码生成工具意图");
