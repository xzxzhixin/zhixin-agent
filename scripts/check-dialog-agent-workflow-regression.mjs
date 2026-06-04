/**
 * 本轮弹框、任务、流式、工具和智能体回归检查。
 *
 * 用途：覆盖 P01-P07 的静态边界，避免实现退化为静态空 UI。
 * 关键逻辑：检查前端默认弹框约束、事件流渲染、任务步骤详情、工具入口、智能体两级树和中心服务工具事件。
 * 参数：无。
 * 返回值：检查通过时退出码为 0，发现缺失时为 1。
 */
import {
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

const globalStyles = readProjectFile("apps/frontend/src/styles.css");
const chatPage = readProjectFile("apps/frontend/src/views/Chat/RouterIndex.vue");
const chatStyle = readProjectFile("apps/frontend/src/views/Chat/style.css");
const chatHelpers = readProjectFile("apps/frontend/src/views/Chat/chat-view-helpers.ts");
const chatConversation = readProjectFile("apps/frontend/src/views/Chat/useChatConversation.ts");
const taskDialog = readProjectFile("apps/frontend/src/views/Chat/dialogs/TaskDetailDialog.vue");
const agentDialog = readProjectFile("apps/frontend/src/views/Chat/dialogs/AgentStatusDialog.vue");
const appStore = readProjectFile("apps/frontend/src/stores/app.ts");
const appConversationActions = readProjectFile("apps/frontend/src/stores/app-conversation-actions.ts");
const appHelpers = readProjectFile("apps/frontend/src/stores/app-helpers.ts");
const apiClient = readProjectFile("packages/api-client/src/index.ts");
const workflowDomain = readProjectFile("services/center/src/workflow-domain.ts");
const apiRoutes = readProjectFile("services/center/src/api-routes.ts");
const sessionDomain = readProjectFile("services/center/src/session-domain.ts");
const toolRuntime = readProjectFile("services/center/src/tool-runtime.ts");

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

for (const signal of [
  "ProcessMessageRow",
  "ProcessMessageGroupRow",
  "processMessageRows",
  "createGroupedProcessRows",
  "thinking.delta",
  "model.stream.delta",
  "process-card",
  "process-log-list",
  "max-height: 20vh;",
  "thinking-block",
  "readEventText",
]) {
    assertIncludes(
    chatPage + chatHelpers + chatStyle + appConversationActions,
    signal,
    `主对话流式/思考展示缺少：${signal}`,
  );
}

for (const signal of [
  "taskSteps",
  "failureReason",
  "traceId",
  "steps:",
  "任务编排详情",
  "composer-task-step-row",
  "scopeHint",
  "currentTurnNotice",
]) {
  assertIncludes(
    taskDialog + chatPage + chatConversation,
    signal,
    `任务编排详情缺少：${signal}`,
  );
}

for (const signal of [
  "planCommandToolForUserText",
  "runCommandTool",
  "CommandToolRequest",
  "tool.command.started",
  "tool.command.output",
  "tool.command.completed",
  "tool.plugin.unavailable",
  "tool.mcp.unavailable",
  "tool.skill.unavailable",
]) {
  assertIncludes(
    chatPage + appStore + appConversationActions + apiClient + apiRoutes + workflowDomain + sessionDomain + toolRuntime,
    signal,
    `自动工具可见闭环缺少：${signal}`,
  );
}

for (const signal of [
  "nodeKind: isMainAgent ? \"主智能体\" : \"长期智能体\"",
  "nodeKind: \"长期智能体\"",
  "nodeKind: \"子智能体\"",
  "发送引导",
  "el-tree",
  "@guide",
  "sendAgentGuidanceDraft",
  "currentTurnNotice",
]) {
  assertIncludes(
    appHelpers + chatPage + agentDialog,
    signal,
    `智能体两级树或引导能力缺少：${signal}`,
  );
}

for (const forbiddenSignal of [
  "主智能体不在该状态树中展示",
  "agent.agentId !== \"main\"",
  "任务 0/0",
  "智能体状态 1/1",
  "title=\"智能体状态\"\n      width=\"720px\"",
  "title=\"任务\"\n      width=\"720px\"",
]) {
  if ((chatPage + taskDialog + agentDialog).includes(forbiddenSignal)) {
    console.error(`发现本轮禁止回归片段：${forbiddenSignal}`);
    process.exitCode = 1;
  }
}

for (const signal of [
  "useChatConversation",
  "conversationId",
  "messages",
  "activeTasks",
  "taskPanelRows",
  "processMessageRows",
  "sendDraftForConversation",
  "sendGuidanceForConversation",
  "currentTurnNotice",
]) {
  assertIncludes(
    chatConversation + chatPage + agentDialog,
    signal,
    `统一完整对话组合能力缺少：${signal}`,
  );
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
