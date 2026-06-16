/**
 * 中心服务 Deep Agents 原生工具闭环静态检查。
 *
 * 用途：防止工具执行退回到旧 OpenAI tool loop 或旧执行图壳，确保当前主路径为 Deep Agents + StructuredTool。
 * 关键逻辑：扫描新入口、模型工厂、工具元数据和会话编排源码中的关键协议片段。
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
  "services/center/src/StructuredTool/index.ts",
  "services/center/src/StructuredTool/tool-capability-registry.ts",
  "services/center/src/StructuredTool/tool-model-specs.ts",
  "services/center/src/StructuredTool/deepagents-tool-runtime.ts",
  "services/center/src/StructuredTool/CenterStructuredToolBase.ts",
  "services/center/src/StructuredTool/deepagents-tool-middleware.ts",
].map((path) => readText(path)).join("\n");
const modelGateway = readText("services/center/src/model-gateway-runtime.ts");
const sessionDomain = readText("services/center/src/domain/session-domain.ts");
const deepAgentsAgent = readText("services/center/src/deepagents-agent.ts");
const sharedTypes = readText("packages/shared/src/index.ts");

assertIncludes(sharedTypes, "UnifiedToolRiskLevel", "共享协议缺少工具风险等级");
assertIncludes(sharedTypes, "UnifiedToolInputSchema", "共享协议缺少工具输入 schema");
assertIncludes(toolRuntime, "inputSchema", "工具运行时缺少结构化输入 schema");
assertIncludes(toolRuntime, "listAvailableModelToolSpecs", "工具运行时缺少模型工具定义转换函数");
assertIncludes(modelGateway, "const tools = await listAvailableModelToolSpecsForCenter", "模型网关必须读取中心服务工具定义");
assertIncludes(modelGateway, "buildOpenAiChatPayload", "模型网关必须把工具定义传入 OpenAI Chat payload");
assertIncludes(modelGateway, "tool_calls", "模型网关缺少 OpenAI tool_calls 解析");
assertIncludes(modelGateway, "tool_call_id", "模型网关缺少 OpenAI tool_call_id 回填");
assertIncludes(deepAgentsAgent, "createDeepAgent({", "Deep Agents 原生入口缺少 createDeepAgent 调用");
assertIncludes(deepAgentsAgent, "model: createLangChainChatModel(", "Deep Agents 原生入口必须直接注入 LangChain model");
assertIncludes(deepAgentsAgent, "run.toolCalls", "Deep Agents 原生入口必须消费工具调用流");
assertIncludes(toolRuntime, "model.tool.requested", "Deep Agents StructuredTool 基类缺少模型工具请求事件");
assertIncludes(toolRuntime, "model.tool.result.appended", "Deep Agents StructuredTool 基类缺少工具结果回填事件");
assertIncludes(deepAgentsAgent, "tool.plan.created", "Deep Agents 原生入口缺少工具计划事件");
assertIncludes(toolRuntime, "extends StructuredTool", "Deep Agents 工具没有按 StructuredTool 类实现");
assertIncludes(toolRuntime, "createDeepAgentsStructuredToolMiddleware", "Deep Agents 工具缺少 middleware 注册入口");
assertIncludes(sessionDomain, "runDeepAgentsAgentTurn", "会话域必须直接切到新 Deep Agents 原生入口");
assertNotIncludes(toolRuntime, "normalized.includes(\"node\")", "工具运行时仍通过 node 文本硬编码触发工具");
assertNotIncludes(toolRuntime, "normalized.includes(\"python\")", "工具运行时仍通过 python 文本硬编码触发工具");
assertNotIncludes(toolRuntime, "planUnifiedToolCallForUserText", "工具运行时不能继续保留按用户文本猜测工具调用的旧入口");
assertNotIncludes(deepAgentsAgent, "buildUnifiedToolCallIntentFromModelCall", "Deep Agents 原生入口不能再依赖旧工具意图转换器");
assertNotIncludes(deepAgentsAgent, "continueProviderModelGatewayWithToolResults", "Deep Agents 原生入口不能再回到旧模型工具回填循环");

