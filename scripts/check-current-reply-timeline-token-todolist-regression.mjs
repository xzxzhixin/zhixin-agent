import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// root: 仓库根目录，来源于脚本执行目录。
const root = process.cwd();
// failures: 收集所有失败项，便于一次性定位本轮四类回归缺口。
const failures = [];

/**
 * readText：读取仓库内 UTF-8 文本。
 *
 * @param {string} relativePath 仓库相对路径。
 * @returns {string} 文件内容；文件缺失时返回空字符串。
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
 * assertIncludes：断言源码或文档必须包含指定片段。
 *
 * @param {string} source 被检查文本。
 * @param {string} fragment 必须存在的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(
  source,
  fragment,
  message,
) {
  if (!source.includes(fragment)) {
    failures.push(`${message}\n缺少片段：${fragment}`);
  }
}

/**
 * assertNotIncludes：断言源码不能包含指定片段。
 *
 * @param {string} source 被检查文本。
 * @param {string} fragment 禁止存在的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotIncludes(
  source,
  fragment,
  message,
) {
  if (source.includes(fragment)) {
    failures.push(`${message}\n禁止片段：${fragment}`);
  }
}

// requirementDoc: 产品需求事实源，必须记录本轮最新口径。
const requirementDoc = readText("需求.md");
// architectureDoc: 架构事实源，必须记录本轮数据库和组件边界。
const architectureDoc = readText("架构.md");
// planDoc: 实施计划事实源，必须记录本轮任务。
const planDoc = readText("计划.md");
// syncRoute: WebSocket 请求、会话快照和 token 统计入口。
const syncRoute = readText("services/center/src/api/sync-route.ts");
// tokenizerDomain: token 统计领域，必须负责持久化最新窗口用量。
const tokenizerDomain = readText("services/center/src/domain/tokenizer-domain.ts");
// migrations: SQLite 迁移集合，用于确认 token 用量持久表。
const migrations = readText("services/center/src/database.ts")
  + readText("services/center/src/data-access/index.ts");
// frontendManagementActions: 前端 token 请求和响应归属处理。
const frontendManagementActions = readText("apps/frontend/src/stores/app-management-actions.ts");
// frontendConversationActions: 前端对话实时事件和停止动作处理。
const frontendConversationActions = readText("apps/frontend/src/stores/app-conversation-actions.ts");
// frontendStore: 前端主状态，不能把数据库事实源重置为默认值。
const frontendStore = readText("apps/frontend/src/stores/app.ts");
// conversationPanel: 主对话和智能体弹框共享对话组件。
const conversationPanel = readText("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue");
// baseAgent: 智能体基类工具权限边界。
const baseAgent = readText("services/center/src/agents/base-agent.ts");
// subAgent: 子智能体能力边界。
const subAgent = readText("services/center/src/agents/sub-agent.ts");
// sharedProtocol: 共享协议类型，必须暴露 agent 级任务事实。
const sharedProtocol = readText("packages/shared/src/index.ts");
// databaseSchema: SQLite 初始化脚本，必须给任务表保存智能体归属。
const databaseSchema = readText("services/center/src/database.ts");
// dataAccessSchema: Drizzle schema，必须同步描述 agent_id 列。
const dataAccessSchema = readText("services/center/src/data-access/schema.ts");
// sessionRepository: 会话仓储，必须按 agentId 写入和查询任务。
const sessionRepository = readText("services/center/src/data-access/session-repository.ts");

assertIncludes(
  requirementDoc,
  "中心服务必须把每次最新 token 用量、窗口上限、占用比例、所属 `sessionId`、`turnId`、`agentId` 和统计时间写入数据库",
  "需求.md 必须明确 token 用量写入数据库并作为事实源。",
);
assertIncludes(
  architectureDoc,
  "最新上下文 token 总览按 `sessionId + agentId` 写入 SQLite",
  "架构.md 必须明确 token 用量按 sessionId + agentId 持久化。",
);
assertIncludes(
  planDoc,
  "停止后才显示回复、弹框时间线、token 保存与 todoList 同步",
  "计划.md 必须记录本轮修复阶段。",
);

assertIncludes(
  migrations + tokenizerDomain + syncRoute,
  "conversation_token_usage",
  "中心服务必须具备 conversation_token_usage 持久表或明确同名仓储，保存当前窗口 token 用量。",
);
assertIncludes(
  tokenizerDomain + syncRoute,
  "saveConversationTokenUsage",
  "tokenizer.count 统计完成后必须保存最新 token 用量。",
);
assertIncludes(
  syncRoute,
  "tokenUsage",
  "会话快照必须返回持久化 token 用量，供重新打开会话恢复。",
);
assertIncludes(
  frontendManagementActions + frontendStore,
  "applyPersistedTokenUsage",
  "前端必须从会话快照应用数据库返回的 token 用量，而不是只靠临时请求结果。",
);
assertNotIncludes(
  frontendStore,
  "this.composerSettings.contextUsedTokens = 0;",
  "切换会话不能无条件把 token 用量清空为 0，应等待或应用数据库快照。",
);

assertNotIncludes(
  conversationPanel,
  "document.querySelector(`[data-message-anchor=\"${messageId}\"]`)",
  "时间线定位不能使用全局 document 查询，否则智能体弹框会命中主页面锚点。",
);
assertIncludes(
  conversationPanel,
  "messageListRef.value?.querySelector",
  "时间线定位必须限定在当前组件消息滚动容器内。",
);
assertIncludes(
  conversationPanel,
  "data-agent-conversation",
  "智能体弹框对话组件必须有可区分的组件范围标记，便于定位和验收。",
);

assertNotIncludes(
  baseAgent,
  "return this.getAgentKind() !== \"sub\";",
  "BaseAgent 不能再按类型禁止子智能体创建自己的 todoList。",
);
assertNotIncludes(
  baseAgent + subAgent,
  "canUseTodoListTool",
  "旧 todoList 工具链已删除，智能体不能继续暴露 canUseTodoListTool。",
);
assertNotIncludes(
  subAgent,
  "\"todo-list\"",
  "旧 todoList 工具权限不能继续写在子智能体权限里。",
);
assertNotIncludes(
  subAgent,
  "\"create-sub-agent\"",
  "子智能体仍必须禁止创建长期智能体或下级子智能体。",
);
assertNotIncludes(
  subAgent,
  "\"create-long-term-agent\"",
  "子智能体仍必须禁止创建长期智能体。",
);
assertIncludes(
  sharedProtocol,
  "agentId: string;",
  "TaskRecord 必须包含 agentId，所有智能体 todoList 才能按智能体隔离保存和恢复。",
);
assertIncludes(
  sharedProtocol,
  "tasks: TaskRecord[];",
  "AgentSubConversationDetail 必须返回当前智能体自己的任务列表，弹框任务入口不能复用主会话任务。",
);
assertIncludes(
  sharedProtocol,
  "taskSteps: TaskStepRecord[];",
  "AgentSubConversationDetail 必须返回当前智能体自己的任务步骤，弹框任务详情需要按 agentId 恢复。",
);
assertIncludes(
  sharedProtocol,
  "events: EventRecord[];",
  "AgentSubConversationDetail 必须返回当前智能体自己的任务事件，右上角任务状态才能同步。",
);
assertIncludes(
  databaseSchema + dataAccessSchema,
  "agent_id",
  "tasks 表必须保存 agent_id，不能只按 sessionId/turnId 混用主对话任务。",
);
assertIncludes(
  sessionRepository,
  "listTasksByAgent",
  "会话仓储必须支持按 sessionId + agentId 查询智能体自己的 todoList。",
);
assertIncludes(
  sessionRepository,
  "listTaskStepsByAgent",
  "会话仓储必须支持按 sessionId + agentId 查询智能体自己的 todoList 步骤。",
);
assertIncludes(
  conversationPanel,
  "agentDetail.value?.tasks",
  "智能体弹框任务入口必须读取当前 agentDetail.tasks，不能继续复用主会话 taskPanelRows。",
);
assertIncludes(
  conversationPanel,
  "agentDetail.value?.taskSteps",
  "智能体弹框任务详情必须读取当前 agentDetail.taskSteps。",
);
assertIncludes(
  conversationPanel,
  "agentDetail.value?.events",
  "智能体弹框任务状态必须读取当前 agentDetail.events。",
);
assertNotIncludes(
  conversationPanel,
  "return chatConversation.taskPanelRows.value;",
  "智能体弹框不能无条件复用主会话任务列表。",
);

assertIncludes(
  frontendManagementActions + syncRoute,
  "lastAssistantMessageCreatedAt",
  "前端或会话快照必须提供最后助手回复时间，用于对比轮次时间和最终回复时间。",
);
assertIncludes(
  frontendConversationActions,
  "event.eventType === \"message.created\"",
  "最终回复显示不能依赖停止动作刷新，前端必须监听助手消息固化事件。",
);
assertIncludes(
  frontendConversationActions,
  "event.eventType === \"turn.updated\"",
  "轮次完成事件必须触发快照刷新，避免 UI 停在执行中。",
);
assertIncludes(
  frontendConversationActions,
  "event.eventType === \"task.updated\"",
  "任务完成事件必须触发快照刷新，避免任务入口停在执行中。",
);
assertIncludes(
  frontendConversationActions,
  "event.payload as {status?: string}",
  "任务完成状态来自事件 payload.status，不能读取不存在的 event.status。",
);
assertIncludes(
  frontendConversationActions,
  "event.status === \"completed\"",
  "轮次完成事件也必须兼容事件表顶层 status 字段，避免完成状态形态差异导致 UI 卡住。",
);
assertIncludes(
  frontendConversationActions,
  "message.type === \"task.updated\"",
  "中心服务会把任务更新转成独立 WebSocket 包，前端必须处理该包并刷新快照。",
);
assertIncludes(
  frontendConversationActions,
  "event.eventType === \"model.stream.completed\"",
  "模型流完成时必须刷新快照或触发收尾兜底，避免没有 task.updated completed 时停在执行中。",
);
assertIncludes(
  frontendConversationActions,
  "startRunningTurnSnapshotRecovery",
  "发送后必须启动运行中轮次快照恢复兜底，确保打开会话和当前页面都能从数据库恢复最终回复。",
);
assertIncludes(
  frontendConversationActions,
  "scheduleRunningTurnSnapshotRecovery",
  "运行中轮次必须短轮询中心服务快照，避免 WebSocket 后半段漏收时只能靠点击停止恢复。",
);
assertIncludes(
  frontendConversationActions,
  "loadActiveSessionSnapshot()",
  "助手消息固化后必须刷新当前会话快照，补齐数据库中的最终回复。",
);

if (failures.length > 0) {
  console.error("本轮回复、弹框时间线、token 持久化和 todoList 回归检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("本轮回复、弹框时间线、token 持久化和 todoList 回归检查通过。");
