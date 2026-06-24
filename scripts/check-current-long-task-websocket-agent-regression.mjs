/**
 * 本轮长任务、WebSocket 对话页、AI SDK 模型供应商和智能体架构静态回归检查。
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

/**
 * assertPathNotExists：断言历史路径已经删除。
 *
 * @param {string} relativePath 仓库相对路径。
 * @param {string} message 失败说明。
 */
function assertPathNotExists(
  relativePath,
  message,
) {
  if (existsSync(join(root, relativePath))) {
    failures.push(message);
  }
}

const sessionDomain = readText("services/center/src/domain/session-domain.ts");
const sharedProtocol = readText("packages/shared/src/index.ts");
const centerTypes = readText("services/center/src/types.ts");
const database = readText("services/center/src/database.ts");
const sessionRepository = readText("services/center/src/data-access/session-repository.ts");
const sessionTurnEffects = readText("services/center/src/domain/session-turn-effects.ts");
const toolCapabilityRegistry = readText("services/center/src/StructuredTool/tool-capability-registry.ts");
const deepAgentsAgent = readText("services/center/src/deepagents-agent.ts");
const baseAgent = readText("services/center/src/agents/base-agent.ts");
const realtime = readText("services/center/src/realtime.ts");
const syncRoute = readText("services/center/src/api/sync-route.ts");
const websocketClient = readText("packages/api-client/src/websocket-client.ts");
const appStore = readText("apps/frontend/src/stores/app.ts");
const conversationActions = readText("apps/frontend/src/stores/app-conversation-actions.ts");
const appVue = readText("apps/frontend/src/App.vue");
const projectActions = readText("apps/frontend/src/stores/app-project-actions.ts");
const chatPanel = readText("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue");
const chatConversation = readText("apps/frontend/src/views/Chat/useChatConversation.ts");
const taskDetailDialog = readText("apps/frontend/src/views/Chat/dialogs/TaskDetailDialog.vue");
const sessionGuidanceDomain = readText("services/center/src/domain/session-guidance-domain.ts");
const autoScroll = readText("apps/frontend/src/views/Chat/useMessageListAutoScroll.ts");
const modelProviderRuntimeFactory = readText("services/center/src/model-provider/ModelProviderRuntimeFactory.ts");
const aiSdkChatModelAdapter = readText("services/center/src/model-provider/AiSdkChatModelAdapter.ts");
const modelProviderSourceRegistry = readText("services/center/src/model-provider/ModelProviderSourceRegistry.ts");
const modelProviderApi = readText("services/center/src/api/model-provider.ts");
const centerPackage = readText("services/center/package.json");
const apiClient = readText("packages/api-client/src/index.ts");
const workspace = readText("pnpm-workspace.yaml");
const desktopDevScript = readText("scripts/dev-desktop-shell.mjs");
const desktopZipScript = readText("apps/desktop-shell/scripts/build-zip.mjs");
const frontendProviderPage = readText("apps/frontend/src/views/Providers/RouterIndex.vue");

for (const taskStepField of [
  "planVersion",
  "stepOrder",
  "source",
  "dependsOn",
  "acceptance",
  "supersededBy",
  "supersededReason",
]) {
  assertIncludes(
    sharedProtocol,
    `${taskStepField}:`,
    `共享 TaskStepRecord 必须包含 ${taskStepField} 字段。`,
  );
  assertIncludes(
    centerTypes,
    `${taskStepField}:`,
    `中心服务 TaskStepRecord 必须包含 ${taskStepField} 字段。`,
  );
}
for (const taskStepColumn of [
  "plan_version",
  "step_order",
  "source",
  "depends_on",
  "acceptance",
  "superseded_by",
  "superseded_reason",
]) {
  assertIncludes(
    database + sessionRepository,
    taskStepColumn,
    `task_steps 表迁移和仓储读写必须覆盖 ${taskStepColumn} 字段。`,
  );
}
assertIncludes(
  database,
  "DEFAULT 1",
  "旧 task_steps 数据的 plan_version 必须默认迁移为 1。",
);
assertIncludes(
  database,
  "DEFAULT 'graph'",
  "旧 task_steps 数据的 source 必须默认迁移为 graph。",
);
assertPathNotExists(
  "services/center/src/StructuredTool/todo-list-tool.ts",
  "旧 todo-list-tool.ts 必须删除，避免继续保留原来的 todolist 代码。",
);
assertPathNotExists(
  "services/center/src/StructuredTool/deepagents-todo-tool.ts",
  "Deep Agents 自带 todoList，中心服务不得继续保留 deepagents-todo-tool.ts 包装工具。",
);
assertIncludes(
  sessionGuidanceDomain,
  "maxPlanVersion + 1",
  "重规划新计划版本必须基于当前最大版本 + 1，不能复用旧版本或使用 Date.now。",
);
for (const legacyTodoSignal of [
  "builtin.todo.list",
  "builtin.deepagents.write_todos",
  "executeDeepAgentsTodoTool",
  "DeepAgentsTodoTaskStepItem",
  "syncDeepAgentTodosToTaskSteps",
  "executeTodoListTool",
  "TodoListToolItem",
  "readTodoListItems",
  "todo-list-tool",
  "deepagents-todo-tool",
]) {
  assertNotIncludes(
    sessionTurnEffects + toolCapabilityRegistry + baseAgent + deepAgentsAgent,
    legacyTodoSignal,
    `旧 todolist 入口必须删除，不能残留：${legacyTodoSignal}`,
  );
}
assertNotIncludes(
  sessionDomain,
  "const now = new Date().toISOString();",
  "session-domain 本轮任务、步骤和重规划新增代码不能继续使用 UTC ISO 时间。",
);

assertIncludes(
  sessionDomain + deepAgentsAgent,
  "agent.loop.batch_limit_reached",
  "单批工具预算触顶必须写入 agent.loop.batch_limit_reached 事件。",
);
assertNotIncludes(
  sessionDomain,
  'errorMessage: "MODEL_TOOL_LOOP_LIMIT_EXCEEDED"',
  "工具循环上限不能直接作为失败错误暴露给用户。",
);
assertRegex(
  sessionDomain + deepAgentsAgent,
  /automatic[A-Za-z0-9_]*Tool[A-Za-z0-9_]*Batch|auto[A-Za-z0-9_]*Continue|toolBatchCount|batchContinuation/iu,
  "长任务必须具备自动续跑或批次计数状态信号。",
);
assertIncludes(
  sessionDomain + deepAgentsAgent,
  "task.plan.revised",
  "用户中途修改需求后必须写入 task.plan.revised 重规划事件。",
);
assertIncludes(
  sessionDomain + deepAgentsAgent,
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
  "this.api().listSessions(",
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
  websocketClient,
  "manualCloseRequested",
  "WebSocket 客户端必须区分主动关闭和异常断线，避免服务重启后页面永久进入已停止。",
);
assertNotIncludes(
  websocketClient,
  "this.options.onStateChange(\"stopped\");\n            return;\n        }\n        this.retryCount += 1;",
  "WebSocket 异常断线达到重试次数后不能进入永久 stopped，必须持续自动重连。",
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
  conversationActions,
  "ensureRealtimeOpenForUserAction",
  "对话用户动作发送前必须校验 WebSocket 已打开，避免已停止或重连中仍发出请求。",
);
assertIncludes(
  conversationActions,
  "markRaw(nextWebSocketClient)",
  "WebSocket 客户端必须用 markRaw 保存，避免 Vue 代理导致身份比较失效。",
);
assertRegex(
  conversationActions,
  /const previousWebSocketClient = this\.webSocketClient;[\s\S]*this\.webSocketClient = markRaw\(nextWebSocketClient\);[\s\S]*previousWebSocketClient\?\.close\(\);[\s\S]*this\.webSocketClient\.connect\(\);/u,
  "connectRealtime 必须先保存旧连接、赋值新连接，再关闭旧连接，避免旧 close 状态覆盖新连接恢复。",
);
assertIncludes(
  appVue,
  "recoverRealtimeConnection",
  "页面生命周期必须在 stopped 状态下尝试恢复 WebSocket 连接。",
);
assertIncludes(
  appVue,
  "appStore.connectionState !== \"stopped\"",
  "页面生命周期恢复只处理 stopped 状态，不能干扰正常 connecting/open/retrying。",
);
assertIncludes(
  appVue,
  "window.addEventListener(\n    \"online\"",
  "浏览器恢复联网时必须尝试恢复实时连接。",
);
assertNotIncludes(
  appVue,
  "sendDraft",
  "页面自动恢复连接不能自动发送草稿或排队消息。",
);
assertRegex(
  conversationActions,
  /async sendDraft\(\): Promise<void> \{[\s\S]*ensureRealtimeOpenForUserAction\("发送消息"\)[\s\S]*const contentMarkdown = this\.buildDraftMarkdown\(\);/u,
  "sendDraft 必须在构建正文、清空草稿和创建会话前拦截非 open 连接。",
);
assertRegex(
  conversationActions,
  /async submitQueuedMessageAsGuidance[\s\S]*ensureRealtimeOpenForUserAction\("提交引导"\)[\s\S]*const queuedMessage = this\.queuedComposerMessages\.find/u,
  "排队引导必须在移除本地排队消息前拦截非 open 连接。",
);
assertIncludes(
  syncRoute,
  "session.guidance.merged",
  "WebSocket 引导请求必须返回 session.guidance.merged。",
);
assertRegex(
  syncRoute,
  /session\.guidance\.submit[\s\S]*broadcastEvents/u,
  "WebSocket 引导合并后必须广播 task.plan.revised 和任务步骤事件给其他端。",
);
assertIncludes(
  chatConversation,
  "filterVisibleDecompositionSteps",
  "前端任务入口必须先筛选可见拆解步骤，不能把默认任务或单步骤任务展示为拆解入口。",
);
assertIncludes(
  chatConversation,
  "visibleTaskStepSources.includes",
  "前端任务入口必须使用用户可见步骤来源白名单，不能默认展示未知 source。",
);
assertIncludes(
  conversationActions,
  "event.eventType.startsWith(\"task.step.\")",
  "前端收到 task.step.* 后必须刷新会话快照，让用户可见步骤从 task_steps 进入任务入口。",
);
assertIncludes(
  chatConversation,
  "visibleSteps.length <= 1",
  "前端任务入口必须隐藏 0 个或 1 个可见步骤的任务，避免显示任务 0/1、1/1。",
);
assertNotIncludes(
  chatConversation,
  'id: "composer-task-idle"',
  "任务详情弹框不能再注入默认空态任务行。",
);
assertNotIncludes(
  chatConversation,
  "failureReason: failedStep?.summary",
  "失败原因不能从步骤摘要写入任务行，必须留给过程卡片或详情事件。",
);
assertIncludes(
  chatPanel,
  "activeTaskPanelRows.value.flatMap",
  "任务入口数字必须基于可见拆解步骤计算，而不是基于默认任务数量。",
);
assertIncludes(
  chatPanel,
  'taskProgressText ? ` ${taskProgressText}` : ""',
  "没有可见拆解步骤时任务入口不能显示 0/0、0/1 或 1/1 数字。",
);
assertIncludes(
  chatPanel,
  'v-if="taskProgressText"',
  "没有可见拆解步骤时任务入口按钮本身必须隐藏。",
);
assertIncludes(
  taskDetailDialog,
  "composer-task-step-row",
  "任务详情弹框必须按拆解步骤渲染单行，而不是渲染任务容器行。",
);
assertNotIncludes(
  taskDetailDialog,
  "task.elapsed",
  "任务详情步骤右侧不能继续显示本任务耗时。",
);
assertNotIncludes(
  taskDetailDialog,
  "composer-task-step-meta",
  "任务浮窗右侧不能保留时间、耗时或序号信息容器。",
);
assertNotIncludes(
  taskDetailDialog,
  "step.positionText",
  "任务浮窗右侧不能显示序号/总数。",
);
assertNotIncludes(
  taskDetailDialog,
  "task.status",
  "任务详情弹框不应在右侧重复显示任务状态。",
);
assertNotIncludes(
  taskDetailDialog,
  "step.summary",
  "任务详情步骤行不能展示第二行摘要、失败原因、替换原因或工具输出。",
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

for (const aiSdkDependency of [
  "\"ai\"",
  "\"@ai-sdk/openai\"",
  "\"@ai-sdk/openai-compatible\"",
  "\"@ai-sdk/anthropic\"",
  "\"@ai-sdk/google\"",
  "\"@openrouter/ai-sdk-provider\"",
]) {
  assertIncludes(
    centerPackage,
    aiSdkDependency,
    `中心服务必须显式声明 AI SDK 供应商依赖：${aiSdkDependency}。`,
  );
}
for (const runtimeSignal of [
  "createOpenAI",
  "createOpenAICompatible",
  "createAnthropic",
  "createGoogleGenerativeAI",
  "createOpenRouter",
  "new AiSdkChatModelAdapter",
]) {
  assertIncludes(
    modelProviderRuntimeFactory,
    runtimeSignal,
    `模型供应商运行时必须通过 Vercel AI SDK 创建模型：${runtimeSignal}。`,
  );
}
assertIncludes(
  aiSdkChatModelAdapter,
  "extends BaseChatModel",
  "AI SDK 适配器必须包装成 Deep Agents 可消费的 ChatModel。",
);
assertIncludes(
  deepAgentsAgent,
  "new ModelProviderRuntimeFactory",
  "Deep Agents 原生入口必须通过数据库供应商运行时工厂创建模型。",
);
assertIncludes(
  deepAgentsAgent,
  "createChatModel(context.runtime)",
  "Deep Agents 原生入口必须注入 AI SDK ChatModel 适配器。",
);
assertIncludes(
  deepAgentsAgent,
  "createDeepAgent({",
  "模型工具定义必须交给 Deep Agents 原生 agent 装配。",
);
for (const legacyProtocol of [
  "ModelProtocolPluginDescriptor",
  "listBuiltinModelAdapterPlugins",
  "OPENAI_BUILTIN_PROTOCOL_ADAPTER",
  "plugins/builtin-model-*",
  `protocol${"Plugin"}Id`,
  `protocol${"Mode"}`,
  "providerProtocolPlugins",
]) {
  assertNotIncludes(
    modelProviderRuntimeFactory + modelProviderApi + modelProviderSourceRegistry + apiClient + frontendProviderPage,
    legacyProtocol,
    `模型供应商不再通过插件协议适配器字段或注册表：${legacyProtocol}`,
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
  "services/center/src/StructuredTool",
  "中心服务内联工具必须集中到 services/center/src/StructuredTool。",
);
assertPathExists(
  "services/center/src/agents",
  "智能体执行类必须集中到 services/center/src/agents。",
);
assertPathExists(
  "services/center/src/StructuredTool/CreateLongTermAgentStructuredTool.ts",
  "创建长期智能体工具必须是 StructuredTool 下独立文件。",
);
assertPathExists(
  "services/center/src/StructuredTool/CreateSubAgentStructuredTool.ts",
  "创建子智能体工具必须是 StructuredTool 下独立文件。",
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
const toolRuntime = readText("services/center/src/StructuredTool/index.ts") + readText("services/center/src/StructuredTool/tool-capability-registry.ts");
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

