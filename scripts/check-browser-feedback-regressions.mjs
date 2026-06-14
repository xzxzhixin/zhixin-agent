/**
 * 浏览器测试反馈回归检查。
 *
 * 用途：覆盖 T01-T09、T11 的程序员侧可静态核对缺口。
 * 关键逻辑：检查弹框 body 挂载、对话过程可见链路、命令工具对话触发、智能体可测试树、主对话引导和会话删除入口。
 * 参数：无。
 * 返回值：检查通过时退出码为 0，发现缺失时退出码为 1。
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

const dialogSources = [
  "apps/frontend/src/views/AgentManagement/RouterIndex.vue",
  "apps/frontend/src/views/Center/RouterIndex.vue",
  "apps/frontend/src/views/Chat/dialogs/AgentStatusDialog.vue",
  "apps/frontend/src/views/Chat/dialogs/EditDetailDialog.vue",
  "apps/frontend/src/views/Chat/dialogs/ProjectCapabilityDialog.vue",
  "apps/frontend/src/views/Chat/dialogs/TaskDetailDialog.vue",
  "apps/frontend/src/views/Plugins/RouterIndex.vue",
  "apps/frontend/src/views/Mcp/RouterIndex.vue",
  "apps/frontend/src/views/Proxies/RouterIndex.vue",
  "apps/frontend/src/views/Providers/RouterIndex.vue",
  "apps/frontend/src/views/Runtimes/RouterIndex.vue",
  "apps/frontend/src/views/Skills/RouterIndex.vue",
];
for (const pathInProject of dialogSources) {
  const source = readProjectFile(pathInProject);
  const dialogCount = (source.match(/<el-dialog/g) ?? []).length;
  const appendToBodyCount = (source.match(/append-to-body/g) ?? []).length;
  if (dialogCount !== appendToBodyCount) {
    console.error(`${pathInProject} 中每个 el-dialog 都必须显式 append-to-body。`);
    process.exitCode = 1;
  }
}

const chatPage = readProjectFile("apps/frontend/src/views/Chat/RouterIndex.vue");
const chatHelpers = readProjectFile("apps/frontend/src/views/Chat/chat-view-helpers.ts");
const chatConversation = readProjectFile("apps/frontend/src/views/Chat/useChatConversation.ts");
const taskDialog = readProjectFile("apps/frontend/src/views/Chat/dialogs/TaskDetailDialog.vue");
const appHelpers = readProjectFile("apps/frontend/src/stores/app-helpers.ts");
const conversationActions = readProjectFile("apps/frontend/src/stores/app-conversation-actions.ts");
const sessionDomain = readProjectFile("services/center/src/domain/session-domain.ts");
const sessionMessageRoute = readProjectFile("services/center/src/api/session-message-route.ts");
const modelGatewayRuntime = readProjectFile("services/center/src/model-gateway-runtime.ts");
const apiRoutes = readProjectFile("services/center/src/api/api-routes.ts");
const toolRuntime = [
  readProjectFile("services/center/src/tools/index.ts"),
  readProjectFile("services/center/src/tools/command-tool-executor.ts"),
].join("\n");
const editDialog = readProjectFile("apps/frontend/src/views/Chat/dialogs/EditDetailDialog.vue");

for (const signal of [
  "model.stream",
  "tool.execute",
  "appendProviderStreamDelta",
  "setTimeout",
  "broadcastEvents",
]) {
  assertIncludes(
    apiRoutes + sessionDomain + sessionMessageRoute + modelGatewayRuntime,
    signal,
    `对话发送链路缺少异步过程可见信号：${signal}`,
  );
}

for (const signal of [
  "正在思考",
  "已思考（用时 ${durationText}）",
  "阶段状态",
  "生成中",
  "thinkingText",
  "deltaText",
]) {
  assertIncludes(
    chatPage + chatHelpers,
    signal,
    `思考或流式展示缺少测试可见文案：${signal}`,
  );
}

assertNotIncludes(
  chatPage + chatHelpers + readProjectFile("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue"),
  "无思考内容",
  "思考卡片不能使用“无思考内容”这类固定占位冒充真实思考摘要。",
);

for (const signal of [
  "traceIdUnavailableReason",
  "TRACE_ID_PENDING",
  "步骤所属任务最近事件排查 ID",
]) {
  assertIncludes(
    chatPage + chatConversation + taskDialog,
    signal,
    `任务详情缺少 traceId 不可用原因或步骤排查信息：${signal}`,
  );
}

for (const signal of [
  "tool_calls",
  "runCommandTool",
  "tool.command.started",
  "tool.command.completed",
  "runDeepAgentsAgentTurn",
  "run.toolCalls",
]) {
  assertIncludes(
    conversationActions + sessionDomain + toolRuntime + modelGatewayRuntime,
    signal,
    `命令工具必须通过 Deep Agents 结构化工具调用链路进入工具过程：${signal}`,
  );
}

for (const signal of [
  "测试长期智能体",
  "测试子智能体",
  "nodeKind: \"长期智能体\"",
  "nodeKind: \"子智能体\"",
]) {
  assertIncludes(
    appHelpers,
    signal,
    `智能体状态缺少可验证两级树数据：${signal}`,
  );
}

for (const signal of [
  "submitQueuedMessageAsGuidance",
  "queuedComposerMessages",
  "pending-guidance-queue",
  "当前对话当前轮次排队中",
]) {
  assertIncludes(
    chatPage + chatConversation + readProjectFile("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue"),
    signal,
    `主对话引导或排队缺少可见入口：${signal}`,
  );
}

for (const signal of [
  "删除对话",
  "确认删除",
  "取消",
  "requestDeleteConversation",
  "requestDeleteProject",
]) {
  assertIncludes(
    chatPage + editDialog + readProjectFile("apps/frontend/src/stores/app.ts"),
    signal,
    `编辑弹框缺少会话删除入口或取消路径：${signal}`,
  );
}
