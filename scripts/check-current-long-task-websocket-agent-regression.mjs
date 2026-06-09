/**
 * 本轮长任务、WebSocket 对话页、LangChain 和智能体架构静态回归检查。
 *
 * 用途：作为 TDD 红灯脚本，证明当前实现仍会暴露工具循环上限、对话页仍混用 REST、
 * 模型协议仍依赖插件适配器，以及中心服务目录和智能体类层级尚未收敛。
 * 关键逻辑：只扫描源码和目录信号，不运行 TypeScript 编译器，符合项目质量门槛约束。
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  join,
} from "node:path";

// root: 仓库根目录，来源于脚本执行目录。
const root = process.cwd();
// failures: 收集所有失败，便于一次性输出本轮缺口。
const failures = [];

/**
 * readText：读取 UTF-8 文本文件。
 *
 * @param {string} relativePath 仓库相对路径。
 * @returns {string} 文件文本；缺失时返回空字符串并记录失败。
 */
function readText(relativePath) {
  const absolutePath = join(
    root,
    relativePath,
  );
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: 文件不存在。`);
    return "";
  }
  return readFileSync(
    absolutePath,
    "utf-8",
  );
}

/**
 * listFiles：递归列出目录文件。
 *
 * @param {string} relativeDirectory 仓库相对目录。
 * @returns {string[]} 仓库相对文件路径。
 */
function listFiles(relativeDirectory) {
  const absoluteDirectory = join(
    root,
    relativeDirectory,
  );
  if (!existsSync(absoluteDirectory)) {
    failures.push(`${relativeDirectory}: 目录不存在。`);
    return [];
  }
  return readdirSync(absoluteDirectory).flatMap((name) => {
    const relativePath = join(
      relativeDirectory,
      name,
    );
    const absolutePath = join(
      root,
      relativePath,
    );
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      if (name === "node_modules" || name === "dist") {
        return [];
      }
      return listFiles(relativePath);
    }
    return [
      relativePath,
    ];
  });
}

/**
 * assertIncludes：断言源码包含指定片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 必须存在的片段。
 * @param {string} message 失败说明。
 */
function assertIncludes(
  source,
  fragment,
  message,
) {
  if (!source.includes(fragment)) {
    failures.push(message);
  }
}

/**
 * assertNotIncludes：断言源码不包含指定片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 禁止存在的片段。
 * @param {string} message 失败说明。
 */
function assertNotIncludes(
  source,
  fragment,
  message,
) {
  if (source.includes(fragment)) {
    failures.push(message);
  }
}

/**
 * assertRegex：断言源码匹配指定正则。
 *
 * @param {string} source 源码文本。
 * @param {RegExp} pattern 必须匹配的正则。
 * @param {string} message 失败说明。
 */
function assertRegex(
  source,
  pattern,
  message,
) {
  if (!pattern.test(source)) {
    failures.push(message);
  }
}

/**
 * assertPathExists：断言路径存在。
 *
 * @param {string} relativePath 仓库相对路径。
 * @param {string} message 失败说明。
 */
function assertPathExists(
  relativePath,
  message,
) {
  if (!existsSync(join(root, relativePath))) {
    failures.push(message);
  }
}

const sessionDomain = readText("services/center/src/session-domain.ts");
const langGraphRunner = readText("services/center/src/langgraph-runner.ts");
const realtime = readText("services/center/src/realtime.ts");
const syncRoute = readText("services/center/src/api/sync-route.ts");
const websocketClient = readText("packages/api-client/src/websocket-client.ts");
const appStore = readText("apps/frontend/src/stores/app.ts");
const conversationActions = readText("apps/frontend/src/stores/app-conversation-actions.ts");
const projectActions = readText("apps/frontend/src/stores/app-project-actions.ts");
const chatPanel = readText("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue");
const autoScroll = readText("apps/frontend/src/views/Chat/useMessageListAutoScroll.ts");
const providerDomain = readText("services/center/src/provider-domain.ts");
const modelGateway = readText("services/center/src/model-gateway-runtime.ts");
const centerPackage = readText("services/center/package.json");
const apiClient = readText("packages/api-client/src/index.ts");
const workspace = readText("pnpm-workspace.yaml");
const desktopDevScript = readText("scripts/dev-desktop-shell.mjs");
const desktopZipScript = readText("apps/desktop-shell/scripts/build-zip.mjs");
const frontendProviderPage = readText("apps/frontend/src/views/Providers/RouterIndex.vue");

assertIncludes(
  sessionDomain + langGraphRunner,
  "agent.loop.batch_limit_reached",
  "单批工具预算触顶必须写入 agent.loop.batch_limit_reached 事件。",
);
assertNotIncludes(
  sessionDomain,
  'errorMessage: "MODEL_TOOL_LOOP_LIMIT_EXCEEDED"',
  "工具循环上限不能直接作为失败错误暴露给用户。",
);
assertRegex(
  sessionDomain + langGraphRunner,
  /automatic[A-Za-z0-9_]*Tool[A-Za-z0-9_]*Batch|auto[A-Za-z0-9_]*Continue|toolBatchCount|batchContinuation/iu,
  "长任务必须具备自动续跑或批次计数状态信号。",
);
assertIncludes(
  sessionDomain + langGraphRunner,
  "task.plan.revised",
  "用户中途修改需求后必须写入 task.plan.revised 重规划事件。",
);
assertIncludes(
  sessionDomain + langGraphRunner,
  "superseded",
  "任务步骤必须支持 superseded 状态以保留被新需求替换的旧步骤。",
);

assertIncludes(
  websocketClient + syncRoute,
  "requestId",
  "WebSocket 客户端与服务端必须支持请求/响应 requestId，承载首屏、历史和发送动作。",
);
assertIncludes(
  websocketClient + syncRoute,
  "session.snapshot",
  "对话页首屏详情和历史必须通过 WebSocket session.snapshot 获取。",
);
assertIncludes(
  websocketClient + syncRoute,
  "session.message.send",
  "对话页发送消息必须通过 WebSocket session.message.send。",
);
for (const forbiddenRest of [
  "this.api().getSessionDetail(",
  "this.api().listSessionEvents(",
  "this.api().sendSessionMessage(",
  "this.api().commitSessionAttachment(",
  "this.api().listProjects(",
  "this.api().deleteSession(",
  "this.api().deleteProject(",
  "this.api().registerProject(",
  "this.api().listPendingEdits(",
  "this.api().savePendingEdit(",
  "this.api().saveAllPendingEdits(",
  "this.api().revertPendingEdit(",
  "this.api().revertAllPendingEdits(",
  "this.api().getPendingEditDiff(",
  "this.api().getAgentSubConversation(",
  "this.api().sendAgentSubConversationMessage(",
  "this.api().createTemporaryAttachment(",
  "this.api().commitAttachment(",
  "this.api().listProviders(",
  "this.api().listProviderProtocolPlugins(",
  "this.api().listProviderModels(",
  "this.api().listAgents(",
  "this.api().countComposerContextTokens(",
]) {
  assertNotIncludes(
    appStore + conversationActions + projectActions + readText("apps/frontend/src/stores/app-management-actions.ts"),
    forbiddenRest,
    `对话页状态和动作不能继续调用 REST 客户端：${forbiddenRest}`,
  );
}
assertNotIncludes(
  appStore,
  "refreshEvents();",
  "对话页不能再通过 REST refreshEvents 补齐事件，应通过 WebSocket 请求补齐。",
);
assertIncludes(
  syncRoute + appStore,
  "navigation.snapshot",
  "对话页导航项目和会话列表必须通过 WebSocket navigation.snapshot 获取。",
);
assertIncludes(
  syncRoute + appStore + readText("apps/frontend/src/stores/app-management-actions.ts"),
  "chat.bootstrap.snapshot",
  "对话页供应商、协议能力、模型列表和智能体快照必须通过 WebSocket chat.bootstrap.snapshot 获取。",
);
assertIncludes(
  syncRoute + readText("apps/frontend/src/stores/app-management-actions.ts"),
  "tokenizer.count",
  "对话页上下文 token 统计必须通过 WebSocket tokenizer.count 获取。",
);
assertRegex(
  appStore,
  /await this\.connectRealtime\(\);[\s\S]*await this\.loadNavigationData\(\);/u,
  "对话页 bootstrap 必须先等待 WebSocket 连接打开，再通过 navigation.snapshot 加载导航。",
);
assertIncludes(
  websocketClient,
  "waitUntilOpen",
  "WebSocket 客户端必须提供等待连接打开能力，避免初始化阶段回退 REST 或抛错。",
);
assertIncludes(
  syncRoute + appStore,
  "session.create",
  "对话页发送前创建会话必须通过 WebSocket session.create。",
);
assertIncludes(
  syncRoute + conversationActions,
  "session.guidance.submit",
  "运行中补充引导必须通过 WebSocket 合并到当前任务。",
);

assertIncludes(
  autoScroll + chatPanel,
  "100",
  "消息区滚动快捷箭头阈值必须固定覆盖 100px。",
);
assertIncludes(
  autoScroll + chatPanel,
  "lastScrollDirection",
  "消息区必须记录最近滚动方向以决定回顶部或回底部箭头。",
);
assertIncludes(
  autoScroll + chatPanel,
  "scroll-shortcut",
  "消息区右下角必须渲染滚动快捷箭头。",
);
assertIncludes(
  autoScroll + chatPanel,
  "isAtTop",
  "消息区贴顶时必须隐藏快捷箭头。",
);
assertIncludes(
  autoScroll + chatPanel,
  "isAtBottom",
  "消息区贴底时必须隐藏快捷箭头并允许 token 流贴底跟随。",
);

assertIncludes(
  centerPackage + modelGateway,
  "@langchain/openai",
  "OpenAI 模型调用必须直接使用 LangChain ChatOpenAI。",
);
assertIncludes(
  centerPackage + modelGateway,
  "@langchain/anthropic",
  "Anthropic 模型调用必须直接使用 LangChain ChatAnthropic。",
);
assertIncludes(
  modelGateway,
  "ChatOpenAI",
  "模型网关必须出现 ChatOpenAI 初始化路径。",
);
assertIncludes(
  modelGateway,
  "ChatAnthropic",
  "模型网关必须出现 ChatAnthropic 初始化路径。",
);
assertNotIncludes(
  modelGateway,
  "void chatModel",
  "LangChain ChatModel 不能只是实例化后丢弃，必须承载真实模型调用。",
);
assertIncludes(
  modelGateway,
  "invokeLangChainChatModel",
  "模型网关必须通过 LangChain 执行真实模型调用。",
);
assertIncludes(
  modelGateway,
  "bindTools",
  "模型工具定义必须通过 LangChain bindTools 注入。",
);
for (const legacyProtocol of [
  "ModelProtocolPluginDescriptor",
  "listBuiltinModelAdapterPlugins",
  "OPENAI_BUILTIN_PROTOCOL_ADAPTER",
  "plugins/builtin-model-*",
]) {
  assertNotIncludes(
    providerDomain + apiClient + frontendProviderPage,
    legacyProtocol,
    `OpenAI/Anthropic 不再通过插件协议适配器字段或注册表：${legacyProtocol}`,
  );
}
assertNotIncludes(
  workspace,
  "plugins/builtin-*",
  "当前阶段插件全部内联，pnpm workspace 不应继续纳入 plugins/builtin-*。",
);
assertNotIncludes(
  desktopDevScript + desktopZipScript,
  "builtinPlugins",
  "桌面开发和打包不应继续构建或同步内置插件。",
);

assertPathExists(
  "services/center/src/api",
  "中心服务对外暴露 API 必须集中到 services/center/src/api。",
);
assertPathExists(
  "services/center/src/tools",
  "中心服务内联工具必须集中到 services/center/src/tools。",
);
assertPathExists(
  "services/center/src/agents",
  "智能体执行类必须集中到 services/center/src/agents。",
);
assertPathExists(
  "services/center/src/tools/create-long-term-agent-tool.ts",
  "创建长期智能体工具必须是 tools 下独立文件。",
);
assertPathExists(
  "services/center/src/tools/create-sub-agent-tool.ts",
  "创建子智能体工具必须是 tools 下独立文件。",
);
for (const agentFile of [
  "services/center/src/agents/base-agent.ts",
  "services/center/src/agents/main-agent.ts",
  "services/center/src/agents/long-term-agent.ts",
  "services/center/src/agents/sub-agent.ts",
]) {
  assertPathExists(
    agentFile,
    `${agentFile} 必须存在，承载智能体类层级。`,
  );
}

const agentSources = existsSync(join(root, "services/center/src/agents"))
  ? listFiles("services/center/src/agents")
      .map((file) => readText(file))
      .join("\n")
  : "";
const toolRuntime = readText("services/center/src/tool-runtime.ts");
for (const className of [
  "class BaseAgent",
  "class MainAgent",
  "class LongTermAgent",
  "class SubAgent",
]) {
  assertIncludes(
    agentSources,
    className,
    `智能体类层级缺少 ${className}。`,
  );
}
assertRegex(
  agentSources,
  /MainAgent[\s\S]*create-long-term-agent|MainAgent[\s\S]*createLongTermAgent/iu,
  "主智能体必须注入创建长期智能体工具。",
);
assertRegex(
  agentSources,
  /MainAgent[\s\S]*create-sub-agent|MainAgent[\s\S]*createSubAgent/iu,
  "主智能体必须注入创建子智能体工具。",
);
assertRegex(
  agentSources,
  /LongTermAgent[\s\S]*create-sub-agent|LongTermAgent[\s\S]*createSubAgent/iu,
  "长期智能体必须注入创建子智能体工具。",
);
assertRegex(
  agentSources,
  /SubAgent[\s\S]*(forbid|禁止|withoutCreation|creationTools:\s*\[\])/iu,
  "子智能体必须明确禁止创建任何智能体工具。",
);
const sessionTurnEffects = readText("services/center/src/session-turn-effects.ts");
assertIncludes(
  toolRuntime,
  "builtin.agent.createLongTerm",
  "创建长期智能体工具必须进入统一工具注册表。",
);
assertIncludes(
  toolRuntime,
  "builtin.agent.createSubAgent",
  "创建子智能体工具必须进入统一工具注册表。",
);
for (const forbiddenPluginRuntimeSignal of [
  "builtin.plugin.call",
  "PLUGIN_NOT_SELECTED",
  "requiredPermission: \"plugin.call\"",
  "toolKind: \"plugin\"",
]) {
  assertNotIncludes(
    toolRuntime + sessionDomain,
    forbiddenPluginRuntimeSignal,
    `当前阶段插件能力已内联，运行时工具链不能残留：${forbiddenPluginRuntimeSignal}`,
  );
}
assertIncludes(
  sessionTurnEffects,
  "executeCreateLongTermAgentTool",
  "模型请求创建长期智能体后必须进入真实执行链路。",
);
assertIncludes(
  sessionTurnEffects,
  "executeCreateSubAgentTool",
  "模型请求创建子智能体后必须进入真实执行链路。",
);

if (failures.length > 0) {
  console.error("本轮长任务/WebSocket/LangChain/智能体架构回归检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("本轮长任务/WebSocket/LangChain/智能体架构回归检查通过。");
