/**
 * 本轮弹框、任务、流式、工具和智能体回归检查。
 *
 * 用途：覆盖 P01-P07 的静态边界，避免实现退化为静态空 UI。
 * 关键逻辑：检查前端默认弹框约束、事件流渲染、任务步骤详情、工具入口、智能体两级树和中心服务工具事件。
 * 参数：无。
 * 返回值：检查通过时退出码为 0，发现缺失时为 1。
 */
import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * readProjectFile：读取仓库相对路径文件。
 *
 * @param {string} pathInProject 仓库相对路径。
 * @returns {string} 文件内容。
 */
function readProjectFile(pathInProject) {
  return readFileSync(
    join(
      process.cwd(),
      pathInProject,
    ),
    "utf-8",
  );
}

/**
 * readOptionalProjectFile：读取可选仓库文件。
 *
 * @param {string} pathInProject 仓库相对路径。
 * @returns {string} 文件存在时返回内容，不存在时返回空字符串。
 */
function readOptionalProjectFile(pathInProject) {
  const fullPath = join(
    process.cwd(),
    pathInProject,
  );
  return existsSync(fullPath)
    ? readFileSync(
      fullPath,
      "utf-8",
    )
    : "";
}

/**
 * assertIncludes：检查源码必须包含指定片段。
 *
 * @param {string} source 源码。
 * @param {string} signal 片段。
 * @param {string} message 错误消息。
 * @returns {void}
 */
function assertIncludes(
  source,
  signal,
  message,
) {
  if (!source.includes(signal)) {
    console.error(message);
    process.exitCode = 1;
  }
}

/**
 * assertNotIncludes：检查源码不能包含指定片段。
 *
 * @param {string} source 源码。
 * @param {string} signal 禁止出现的片段。
 * @param {string} message 错误消息。
 * @returns {void}
 */
function assertNotIncludes(
  source,
  signal,
  message,
) {
  if (source.includes(signal)) {
    console.error(message);
    process.exitCode = 1;
  }
}

const globalStyles = readProjectFile("apps/frontend/src/styles.css");
const chatPage = readProjectFile("apps/frontend/src/views/Chat/RouterIndex.vue");
const chatConversationPanel = readProjectFile("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue");
const chatStyle = readProjectFile("apps/frontend/src/views/Chat/style.css");
const chatHelpers = readProjectFile("apps/frontend/src/views/Chat/chat-view-helpers.ts");
const chatConversation = readProjectFile("apps/frontend/src/views/Chat/useChatConversation.ts");
const chatAutoScroll = readProjectFile("apps/frontend/src/views/Chat/useMessageListAutoScroll.ts");
const chatComposerResize = readProjectFile("apps/frontend/src/views/Chat/useComposerPanelResize.ts");
const taskDialog = readProjectFile("apps/frontend/src/views/Chat/dialogs/TaskDetailDialog.vue");
const agentDialog = readProjectFile("apps/frontend/src/views/Chat/dialogs/AgentStatusDialog.vue");
const agentConversationDialog = readOptionalProjectFile("apps/frontend/src/views/Chat/dialogs/AgentConversationDialog.vue");
const editDialog = readProjectFile("apps/frontend/src/views/Chat/dialogs/EditDetailDialog.vue");
const projectConversationTestFile = readProjectFile("项目对话测试/致心项目对话测试.md");
const appStore = readProjectFile("apps/frontend/src/stores/app.ts");
const appConversationActions = readProjectFile("apps/frontend/src/stores/app-conversation-actions.ts");
const appManagementActions = readProjectFile("apps/frontend/src/stores/app-management-actions.ts");
const appHelpers = readProjectFile("apps/frontend/src/stores/app-helpers.ts");
const apiClient = readProjectFile("packages/api-client/src/index.ts");
const workflowDomain = readProjectFile("services/center/src/domain/workflow-domain.ts");
const apiRoutes = readProjectFile("services/center/src/api/api-routes.ts");
const sessionDomain = readProjectFile("services/center/src/domain/session-domain.ts");
const sessionTurnEffects = readProjectFile("services/center/src/domain/session-turn-effects.ts");
const deepAgentsAgent = readProjectFile("services/center/src/deepagents-agent.ts");
const toolRuntime = [
  readProjectFile("services/center/src/StructuredTool/index.ts"),
  readProjectFile("services/center/src/StructuredTool/deepagents-tool-runtime.ts"),
  readProjectFile("services/center/src/StructuredTool/CenterStructuredToolBase.ts"),
  readProjectFile("services/center/src/StructuredTool/command-tool-executor.ts"),
  readProjectFile("services/center/src/StructuredTool/mcp-adapter-config.ts"),
  readProjectFile("services/center/src/StructuredTool/McpToolProvider.ts"),
  readProjectFile("services/center/src/StructuredTool/McpToolWrapperStructuredTool.ts"),
  readProjectFile("services/center/src/StructuredTool/McpToolResultNormalizer.ts"),
  readProjectFile("services/center/src/StructuredTool/mcp-tool-specs.ts"),
  readProjectFile("services/center/src/StructuredTool/tool-model-specs.ts"),
].join("\n");
const toolCapabilityRegistry = readProjectFile("services/center/src/StructuredTool/tool-capability-registry.ts");
const toolEvents = readProjectFile("services/center/src/StructuredTool/tool-events.ts");
const capabilityApi = readProjectFile("services/center/src/api/capability.ts");
const modelProviderRuntimeFactory = readProjectFile("services/center/src/model-provider/ModelProviderRuntimeFactory.ts");
const chatRuntimeSource = chatPage + chatConversationPanel + chatStyle;
const chatProcessAggregationSource = chatHelpers + chatConversation + chatConversationPanel;

for (const signal of [
  ".el-dialog",
  "width: 80vw;",
  "max-height: 80vh;",
  ".el-overlay-dialog",
  "overflow: hidden;",
]) {
  assertIncludes(
    globalStyles,
    signal,
    `全局弹框默认行为缺少：${signal}`,
  );
}

assertIncludes(
  projectConversationTestFile,
  "项目对话测试",
  "项目对话测试目录缺少本轮全流程测试文件。",
);

for (const signal of [
  "ProcessMessageRow",
  "ProcessMessageGroupRow",
  "processMessageRows",
  "createGroupedProcessRows",
  "createMergedThinkingRows",
  "startsWith(\"thinking.\")",
  "model.stream.delta",
  "process-card",
  "process-card__body",
  "max-height: 200px;",
  "thinking-block",
  "readEventText",
  "model.failed",
  "message.turn.failed",
  "worker.task.failed",
  "resolveProcessSummary",
]) {
    assertIncludes(
    chatRuntimeSource + chatHelpers + appConversationActions,
    signal,
    `主对话流式/思考展示缺少：${signal}`,
  );
}

for (const signal of [
  "agent.loop.batch_limit_reached",
  "model.tool.requested",
  "model.tool.result.appended",
]) {
  assertIncludes(
    chatProcessAggregationSource,
    signal,
    `主智能体对话过程聚合缺少正在做什么的事件信号：${signal}`,
  );
}

for (const signal of [
  "task.step.created",
  "task.step.started",
  "task.step.updated",
]) {
  assertNotIncludes(
    chatProcessAggregationSource,
    signal,
    `task.step.* 属于内部任务步骤事件，不能继续进入主对话过程聚合：${signal}`,
  );
}

for (const signal of [
  "graph.node.started",
  "graph.node.completed",
  "graph.node.failed",
]) {
  assertIncludes(
    sessionDomain,
    signal,
    `Deep Agents 内部执行图审计缺少事件信号：${signal}`,
  );
  assertNotIncludes(
    chatProcessAggregationSource,
    signal,
    `graph.node.* 是内部执行图审计事件，不能进入用户可见过程聚合：${signal}`,
  );
}

for (const signal of [
  "taskSteps",
  "failureReason",
  "traceId",
  "steps:",
  "任务",
  "scopeHint",
  "currentTurnNotice",
]) {
  assertIncludes(
    taskDialog + chatRuntimeSource + chatConversation,
    signal,
    `任务编排详情缺少：${signal}`,
  );
}

for (const signal of [
  "UNIFIED_TOOL_CAPABILITY_REGISTRY",
  "UnifiedToolCapability",
  "executeCommandTool",
  "CommandToolExecutionRequest",
  "tool.command.started",
  "tool.command.output",
  "tool.command.completed",
  "tool.${capability.toolKind}.unavailable",
  "MCP_SERVER_NOT_CONFIGURED",
  "SKILL_NOT_SELECTED",
  "run.toolCalls",
]) {
  assertIncludes(
    chatRuntimeSource + appStore + appConversationActions + apiClient + apiRoutes + capabilityApi + workflowDomain + sessionDomain + sessionTurnEffects + deepAgentsAgent + toolRuntime + toolCapabilityRegistry + toolEvents,
    signal,
    `Deep Agents 结构化工具可见闭环缺少：${signal}`,
  );
}

for (const forbiddenSignal of [
  "builtin.plugin.call",
  "PLUGIN_NOT_SELECTED",
]) {
  assertNotIncludes(
    chatRuntimeSource + appStore + appConversationActions + apiClient + apiRoutes + capabilityApi + workflowDomain + sessionDomain + sessionTurnEffects + toolRuntime + toolCapabilityRegistry + toolEvents,
    forbiddenSignal,
    `当前阶段插件已内联，自动工具可见闭环不能残留：${forbiddenSignal}`,
  );
}

for (const signal of [
  "capabilities: listUnifiedToolCapabilities()",
  "model.tool.requested",
  "model.tool.result.appended",
  "requiredPermission",
  "runDeepAgentsAgentTurn",
  "createDeepAgent",
]) {
  assertIncludes(
    apiRoutes + capabilityApi + sessionDomain + sessionTurnEffects + toolRuntime + toolCapabilityRegistry + toolEvents + modelProviderRuntimeFactory + deepAgentsAgent,
    signal,
    `统一工具能力注册、命令执行或审计链路缺少：${signal}`,
  );
}

const deepAgentEntryIndex = sessionDomain.indexOf("await runDeepAgentsAgentTurn({");
const toolExecuteIndex = toolRuntime.indexOf("export abstract class CenterStructuredToolBase");
if (deepAgentEntryIndex < 0 || toolExecuteIndex < 0) {
  console.error("结构化工具调用闭环必须由 Deep Agents 原生入口接收模型工具请求，再执行中心服务工具并回填模型。");
  process.exitCode = 1;
}

if (!toolRuntime.includes("model.tool.requested")
    || !toolRuntime.includes("executeCommandTool(")
    || !toolRuntime.includes("model.tool.result.appended")
    || !deepAgentsAgent.includes("run.toolCalls")) {
  console.error("Deep Agents 原生入口必须执行命令、回填工具结果，并消费工具调用流。");
  process.exitCode = 1;
}

if ((sessionDomain + toolRuntime).includes("planCommandToolForUserText")
    || (sessionDomain + toolRuntime).includes("planUnifiedToolCallForUserText")) {
  console.error("运行时不得保留用户文本命令规划函数，必须使用 Deep Agents 结构化工具调用入口。");
  process.exitCode = 1;
}

for (const signal of [
  "nodeKind: isMainAgent ? \"主智能体\" : \"长期智能体\"",
  "nodeKind: \"长期智能体\"",
  "nodeKind: \"子智能体\"",
  "el-tree",
  "currentTurnNotice",
]) {
  assertIncludes(
    appHelpers + chatRuntimeSource + agentDialog,
    signal,
    `智能体两级树或引导能力缺少：${signal}`,
  );
}

for (const forbiddenSignal of [
  "主智能体不在该状态树中展示",
  "agent.agentId !== \"main\"",
  "任务 0/0",
  "智能体状态 {{ agentStatusProgressText }}",
  "<strong>智能体状态</strong>",
  "关闭任务详情",
  "关闭智能体状态详情",
  "关闭编辑详情",
  "composer-mini-dialog-header",
  "会话删除",
  "request-delete-conversation",
  "@click=\"stopNavigationAction($event); appStore.deleteConversation(session.sessionId)\"",
  "deleteProjectPlaceholder(group.project.projectId)",
  "composer-task-step-list",
  "agent-conversation-detail",
  "agent-composer-full-controls",
  "智能体状态 1/1",
  "title=\"智能体状态\"\n      width=\"720px\"",
  "title=\"任务\"\n      width=\"720px\"",
  "append-to-body",
  "optimistic-thinking",
  "optimistic-stream",
  "sequence: -",
]) {
  if ((chatRuntimeSource + taskDialog + agentDialog + editDialog + appConversationActions).includes(forbiddenSignal)) {
    console.error(`发现本轮禁止回归片段：${forbiddenSignal}`);
    process.exitCode = 1;
  }
}

for (const signal of [
  "useChatConversation",
  "conversationId",
  "messages",
  "activeTasks",
  "currentTurnTasks",
  "taskPanelRows",
  "processMessageRows",
  "sendDraftForConversation",
  "sendGuidanceForConversation",
  "currentTurnNotice",
]) {
  assertIncludes(
    chatConversation + chatRuntimeSource + agentDialog,
    signal,
    `统一完整对话组合能力缺少：${signal}`,
  );
}

for (const signal of [
  "resolveCurrentTurnTaskScope",
  "latestActiveTurn",
  "latestTurn",
  "task.turnId === currentTurnId",
]) {
  assertIncludes(
    chatConversation,
    signal,
    `任务入口必须只统计当前轮次任务编排，不能累加历史对话任务：${signal}`,
  );
}

for (const signal of [
  "scheduleComposerContextUsageUpdate",
  "composerContextUsageTimer",
  "lastComposerContextUsageKey",
  "composerContextUsageRequestSerial",
  "window.setTimeout",
]) {
  assertIncludes(
    appStore + appConversationActions + appManagementActions,
    signal,
    `输入区 token 统计必须节流、去重并防止旧响应覆盖新状态：${signal}`,
  );
}

for (const signal of [
  "messageListRef",
  "isMessageListPinnedToBottom",
  "updateMessageListPinnedState",
  "requestAutoScrollToBottom",
  "scrollMessageListToBottom",
  "data-auto-scroll=\"pinned-to-bottom\"",
  "@scroll=\"updateMessageListPinnedState\"",
]) {
  assertIncludes(
    chatRuntimeSource + chatAutoScroll,
    signal,
    `消息列表贴底和用户离底暂停逻辑缺少：${signal}`,
  );
}

for (const signal of [
  "].sort((left",
  "left.sequence - right.sequence",
]) {
  assertIncludes(
    appConversationActions,
    signal,
    `实时事件进入前端后必须按中心服务 sequence 排序：${signal}`,
  );
}

for (const signal of [
  "height: 100%;",
  "flex: 1 1 0;",
  "overscroll-behavior: contain;",
  ".chat-page-host .message-list[data-auto-scroll=\"pinned-to-bottom\"]",
  "useComposerPanelResize",
  "composerResizeHandleLabel",
  "startComposerResize",
  "--composer-panel-height",
  "composer-resize-handle",
  "class=\"composer-mini-popover\"",
  "v-if=\"composerMiniDialogVisible\"",
  "flex: 0 0 auto;",
  "height: clamp(",
  "resize: none;",
  ".chat-page-host .message-list {",
  ".chat-page-host .composer {",
  ".chat-page-host .composer-shell {",
  "@media (max-height: 840px)",
  "max-height: min(42vh, 340px);",
  "max-height: min(86vh, 760px);",
  "max-height: 40vh;",
]) {
  assertIncludes(
    chatRuntimeSource + chatComposerResize,
    signal,
    `Chat 固定视口 flex 高度或主滚动区域约束缺少：${signal}`,
  );
}

for (const signal of [
  "composerRootRef",
  "composerMiniDialogRef",
  "handleComposerOutsidePointerDown",
  "document.addEventListener(\"pointerdown\"",
  "document.removeEventListener(\"pointerdown\"",
  "composerMiniDialogVisible.value = false",
  "activeComposerEntry.value === entry",
  ".chat-page-host .chat-surface {",
  "display: flex;",
  "flex-direction: column;",
  ".chat-page-host .conversation-body {",
  "flex: 1 1 0;",
  ".chat-page-host .composer {",
  "flex: 0 0 auto;",
  "height: clamp(",
  "max-height: min(86vh, 760px);",
  "智能体 {{ agentStatusProgressText }}",
  "composer-frame",
  "composer-entry-strip",
  ".chat-page-host .composer-frame",
  "width: 100%;",
  "bottom: calc(100% - 1px);",
  "max-height: 40vh;",
  "requestDeleteConversation",
  "requestDeleteProject",
  "ElMessageBox.confirm",
  "<AgentConversationDialog",
  "agentConversationDialogVisible",
  "openAgentConversationDialog",
  "composer-edit-row",
  "composer-edit-stat",
]) {
  assertIncludes(
    chatRuntimeSource + editDialog + appStore,
    signal,
    `本轮输入区 flex、点击关闭或智能体入口文案约束缺少：${signal}`,
  );
}

if (chatStyle.includes("width: min(900px, 100%);")) {
  console.error("输入框不能继续限制为 900px，必须铺满中间对话区。");
  process.exitCode = 1;
}

if (chatStyle.includes(".composer-shell:has(.composer-mini-popover)")) {
  console.error("三入口浮层不能通过撑高输入框展示，必须向上弹出。");
  process.exitCode = 1;
}

for (const signal of [
  "agent-conversation-dialog",
  "variant=\"agent\"",
  "agentDraft",
  "sendAgentDraft",
  "sendAgentSubConversationMessage",
]) {
  assertIncludes(
    agentConversationDialog + chatConversationPanel + appStore,
    signal,
    `智能体点击后的完整对话弹窗缺少：${signal}`,
  );
}

if (chatRuntimeSource.includes("status-scope-note")) {
  console.error("右侧状态栏不能常驻解释性说明，任务和智能体说明应收敛到输入区小浮层。");
  process.exitCode = 1;
}

for (const signal of [
  "@media (max-width: 1100px)",
  ".chat-page-host .composer-toolbar",
  "flex-wrap: wrap;",
  ".chat-page-host .content-grid",
  ".chat-page-host .chat-surface",
  ".chat-page-host .config-panel",
  ".chat-page-host .composer-controls",
  "flex: 1 1 100%;",
  ".chat-page-host .composer-model-select",
  "min-width: 140px;",
  "display: none;",
]) {
  assertIncludes(
    chatStyle,
    signal,
    `窄视口输入区防挤压样式缺少：${signal}`,
  );
}
