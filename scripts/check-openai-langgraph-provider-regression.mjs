/**
 * 本轮 OpenAI 协议、Deep Agents 全量节点和供应商提示回归检查。
 *
 * 用途：作为 TDD 红灯/绿灯脚本，验证 Deep Agents 执行图、模型协议和供应商交互不再退回旧口径。
 * 关键逻辑：只做源码级协议检查，不运行 TypeScript 编译器，遵守项目质量门槛约束。
 */
import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * root: 仓库根目录，来源于当前脚本执行目录。
 */
const root = process.cwd();

/**
 * failures: 收集所有失败，便于一次性看到本轮缺口。
 */
const failures = [];

/**
 * readText：读取 UTF-8 文本文件。
 *
 * @param relativePath 仓库根目录下的相对路径。
 * @returns 文件文本。
 */
function readText(relativePath) {
  return readFileSync(
    join(
      root,
      relativePath,
    ),
    "utf-8",
  );
}

/**
 * fail：记录失败原因。
 *
 * @param message 可展示失败说明。
 * @returns 没有返回值。
 */
function fail(message) {
  failures.push(message);
}

/**
 * assertIncludes：断言源码包含关键片段。
 *
 * @param source 源码文本。
 * @param fragment 必须存在的片段。
 * @param message 失败说明。
 * @returns 没有返回值。
 */
function assertIncludes(source, fragment, message) {
  if (!source.includes(fragment)) {
    fail(message);
  }
}

/**
 * assertNotIncludes：断言源码不包含旧口径片段。
 *
 * @param source 源码文本。
 * @param fragment 禁止出现的片段。
 * @param message 失败说明。
 * @returns 没有返回值。
 */
function assertNotIncludes(source, fragment, message) {
  if (source.includes(fragment)) {
    fail(message);
  }
}

/**
 * assertRegex：断言源码匹配正则。
 *
 * @param source 源码文本。
 * @param pattern 必须匹配的正则。
 * @param message 失败说明。
 * @returns 没有返回值。
 */
function assertRegex(source, pattern, message) {
  if (!pattern.test(source)) {
    fail(message);
  }
}

const deepAgentsAgent = readText("services/center/src/deepagents-agent.ts");
const sessionDomain = readText("services/center/src/domain/session-domain.ts");
const sessionTurnEffects = readText("services/center/src/domain/session-turn-effects.ts");
const sessionRepository = readText("services/center/src/data-access/session-repository.ts");
const modelGateway = readText("services/center/src/model-gateway-runtime.ts");
const openAiChatProtocol = readText("services/center/src/openai-chat-protocol.ts");
const providerRoutes = readText("services/center/src/api/provider-routes.ts");
const toolRuntime = readText("services/center/src/tools/index.ts") + readText("services/center/src/tools/tool-capability-registry.ts");
const providerDomain = readText("services/center/src/domain/provider-domain.ts");
const providerPage = readText("apps/frontend/src/views/Providers/RouterIndex.vue");
const rootPackage = readText("package.json");
const workspace = readText("pnpm-workspace.yaml");
const tsconfigBase = readText("tsconfig.base.json");

if (existsSync(join(root, "packages/model-protocol"))) {
  fail("必须彻底删除 packages/model-protocol 内部模型协议包。");
}

const protocolSearchSources = [
  [
    "services/center/src/model-gateway-runtime.ts",
    modelGateway,
  ],
  [
    "services/center/src/tools/index.ts",
    toolRuntime,
  ],
  [
    "services/center/package.json",
    readText("services/center/package.json"),
  ],
  [
    "plugins/builtin-model-anthropic-messages/package.json",
    readText("plugins/builtin-model-anthropic-messages/package.json"),
  ],
];

for (const [
  sourceName,
  sourceText,
] of protocolSearchSources) {
  assertNotIncludes(
    sourceText,
    "@zhixin/model-protocol",
    `${sourceName} 仍依赖 @zhixin/model-protocol。`,
  );
  assertNotIncludes(
    sourceText,
    "ModelRequest",
    `${sourceName} 仍使用旧 ModelRequest 内部协议。`,
  );
  assertNotIncludes(
    sourceText,
    "ModelMessage",
    `${sourceName} 仍使用旧 ModelMessage 内部协议。`,
  );
  assertNotIncludes(
    sourceText,
    "ModelStreamEvent",
    `${sourceName} 仍使用旧 ModelStreamEvent 内部协议。`,
  );
}

assertNotIncludes(
  workspace,
  "packages/model-protocol",
  "pnpm-workspace.yaml 仍纳入 packages/model-protocol。",
);
assertNotIncludes(
  rootPackage,
  "model-protocol",
  "根 package.json 仍引用 model-protocol。",
);
assertNotIncludes(
  tsconfigBase,
  "@zhixin/model-protocol",
  "tsconfig.base.json 仍保留 @zhixin/model-protocol 旧路径别名。",
);

for (const signal of [
  "createDeepAgent",
  "createLangChainChatModel",
  "run.toolCalls",
  "model.tool.requested",
  "model.tool.result.appended",
  "recordToolCallLifecycle",
]) {
  assertIncludes(
    deepAgentsAgent,
    signal,
    `Deep Agents 原生入口缺少：${signal}。`,
  );
}
for (const legacySignal of [
  "StateGraph",
  "thinking.context",
  "tool.result",
  "buildUnifiedToolCallIntentFromModelCall",
  "continueProviderModelGatewayWithToolResults(",
]) {
  assertNotIncludes(
    deepAgentsAgent,
    legacySignal,
    `Deep Agents 原生入口不能残留旧图或旧工具循环：${legacySignal}。`,
  );
}

for (const graphEvent of [
  "memory.write",
  "usage.recorded",
  "message.turn.incomplete",
]) {
  assertIncludes(
    sessionDomain + sessionTurnEffects + modelGateway,
    graphEvent,
    `缺少 ${graphEvent} 事件处理。`,
  );
}

assertIncludes(
  sessionDomain + sessionTurnEffects + modelGateway,
  "graphCheckpoint",
  "记忆、用量或失败收尾事件必须携带 graph checkpoint。",
);
assertRegex(
  sessionDomain,
  /updateTurnStatus\(\s*database,\s*events,\s*state\.turnId,\s*"completed",\s*state\.taskId/u,
  "LangGraph 成功收尾必须把完成轮次同步到当前任务，避免 turn completed 但 task running。",
);
assertRegex(
  sessionRepository,
  /updateTaskStatusByTurn\([\s\S]*preferredTaskId/u,
  "按轮次更新任务状态时必须支持限定当前任务 ID，避免后续步骤把已完成任务重新置为 running。",
);

for (const forbidden of [
  "responses",
  "parseModelToolCallFromText",
  "parseModelToolCallsFromText",
  "readResponsesToolCalls",
  "applyResponsesSseEvent",
  "applyAnthropicMessagesSseEvent",
]) {
  assertNotIncludes(
    modelGateway + providerDomain,
    forbidden,
    `模型网关或供应商注册仍包含旧协议口径：${forbidden}。`,
  );
}
assertNotIncludes(
  modelGateway + providerDomain,
  'protocolMode === "messages"',
  "模型网关仍按 Anthropic messages 协议模式分支。",
);

assertIncludes(
  modelGateway,
  "tool_calls",
  "模型网关必须使用 OpenAI tool_calls。当前缺少 OpenAI 工具调用字段。",
);
assertIncludes(
  modelGateway,
  "tool_call_id",
  "模型网关必须使用 OpenAI tool_call_id 回填工具结果。",
);
assertIncludes(
  modelGateway + openAiChatProtocol + providerRoutes,
  "/v1/chat/completions",
  "模型网关必须以 OpenAI Chat Completions 为内部唯一规范。",
);

assertIncludes(
  providerDomain,
  "assertProviderCanEnable",
  "供应商启用必须通过完整性校验函数阻止不完整配置。",
);
assertRegex(
  providerDomain,
  /enabled:\s*input\.enabled\s*===\s*true\s*\?\s*assertProviderCanEnable/u,
  "供应商创建保存时必须允许不完整保存，但启用时必须校验完整性。",
);
assertRegex(
  providerDomain,
  /enabled:\s*input\.enabled\s*===\s*true\s*\?\s*assertProviderCanEnable/u,
  "供应商更新保存时必须允许不完整保存，但启用时必须校验完整性。",
);

assertIncludes(
  providerPage,
  "ElMessage",
  "供应商页面必须使用 ElMessage 统一展示提示，避免提示被弹框遮挡。",
);
assertIncludes(
  providerPage,
  "配置不完整，无法启用",
  "供应商启用不完整配置时必须用 ElMessage 展示明确提示。",
);
assertNotIncludes(
  providerPage,
  "<el-alert",
  "供应商页面不应继续用 el-alert 在弹框背后展示关键提示。",
);

if (failures.length > 0) {
  console.error("OpenAI/Deep Agents/供应商回归检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("OpenAI/Deep Agents/供应商回归检查通过。");
