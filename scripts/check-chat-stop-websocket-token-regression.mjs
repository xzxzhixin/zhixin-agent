import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// root: 仓库根目录，来源于脚本执行目录。
const root = process.cwd();
// failures: 收集所有失败，便于一次性输出本轮停止与 token 归属缺口。
const failures = [];

/**
 * readText：读取项目内 UTF-8 文本。
 *
 * @param {string} relativePath 仓库相对路径。
 * @returns {string} 文件文本；文件缺失时返回空字符串。
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
 * assertIncludes：断言源码必须包含指定片段。
 *
 * @param {string} source 被检查文本。
 * @param {string} fragment 必须存在的源码片段。
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
 * @param {string} fragment 禁止存在的源码片段。
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

// requirementDoc: 产品需求事实源，必须记录停止和 token 当前窗口归属。
const requirementDoc = readText("需求.md");
// architectureDoc: 架构事实源，必须记录 WebSocket cancel 请求和取消收尾。
const architectureDoc = readText("架构.md");
// planDoc: 计划事实源，必须记录当前阶段任务。
const planDoc = readText("计划.md");
// conversationActions: 前端对话发送和停止 action。
const conversationActions = readText("apps/frontend/src/stores/app-conversation-actions.ts");
// managementActions: 前端上下文 token 统计 action。
const managementActions = readText("apps/frontend/src/stores/app-management-actions.ts");
// appStore: 前端主状态，负责切换会话时清理窗口态。
const appStore = readText("apps/frontend/src/stores/app.ts");
// syncRoute: 中心服务 WebSocket 请求入口。
const syncRoute = readText("services/center/src/api/sync-route.ts");
// sessionDomain: 中心服务会话领域，负责轮次、任务、步骤状态收尾。
const sessionDomain = readText("services/center/src/domain/session-domain.ts");
// sessionCancelDomain: 中心服务会话取消领域，负责当前运行轮次取消收尾。
const sessionCancelDomain = readText("services/center/src/domain/session-cancel-domain.ts");
// workflowDomain: 中心服务 Worker 领域，负责取消执行任务。
const workflowDomain = readText("services/center/src/domain/workflow-domain.ts");

assertIncludes(
  requirementDoc,
  "点击“停止”只取消当前会话当前正在执行的轮次，不取消同一会话输入框中的本地排队消息",
  "需求.md 必须明确停止只取消当前运行轮次且保留本地排队消息。",
);
assertIncludes(
  architectureDoc,
  "session.turn.cancel",
  "架构.md 必须把停止动作纳入对话页 WebSocket 请求类型。",
);
assertIncludes(
  planDoc,
  "## 本轮阶段：停止取消、WebSocket-only 回归与窗口级 token 统计",
  "计划.md 必须记录本轮停止、WebSocket-only 和 token 统计修复阶段。",
);

assertIncludes(
  conversationActions,
  "session.turn.cancel",
  "前端停止按钮必须通过 WebSocket session.turn.cancel 请求中心服务。",
);
assertNotIncludes(
  conversationActions,
  "中心服务接口待接入",
  "停止 action 不能继续停留在待接入错误提示。",
);
assertIncludes(
  conversationActions,
  "queuedComposerMessages",
  "停止 action 必须保留本地排队消息，不能清空 queuedComposerMessages。",
);
assertIncludes(
  syncRoute,
  "input.envelope.type === \"session.turn.cancel\"",
  "中心服务 WebSocket 路由必须处理 session.turn.cancel。",
);
assertIncludes(
  syncRoute + sessionDomain + sessionCancelDomain,
  "cancelActiveConversationTurn",
  "中心服务必须提供按 sessionId 取消当前运行轮次的领域方法。",
);
assertIncludes(
  sessionDomain + sessionCancelDomain,
  "updateRunningTaskStepsByTurn",
  "取消当前轮次时必须同步收尾运行中的任务步骤。",
);
assertIncludes(
  sessionDomain + workflowDomain,
  "agent.state.changed",
  "取消当前轮次时必须广播智能体状态变化，避免已回复但仍显示执行中。",
);
assertIncludes(
  sessionDomain + sessionCancelDomain,
  "turn.status === \"running\"",
  "取消当前轮次必须只匹配当前会话正在运行的轮次。",
);

assertIncludes(
  managementActions,
  "turnId",
  "tokenizer.count 请求签名必须包含当前轮次 ID，避免旧轮次覆盖当前窗口。",
);
assertIncludes(
  managementActions,
  "contextUsageWindowKey",
  "前端必须保存 token 响应所属窗口键。",
);
assertIncludes(
  managementActions,
  "requestWindowKey !== this.composerContextUsageState.contextUsageWindowKey",
  "token 统计响应必须校验窗口键，旧会话或旧轮次响应不能覆盖当前窗口。",
);
assertIncludes(
  appStore + conversationActions,
  "resetComposerContextUsageForWindow",
  "切换会话、新建草稿或发送新轮次时必须重置当前窗口 token 显示。",
);
assertIncludes(
  syncRoute,
  "windowKey",
  "中心服务 tokenizer.count 响应必须回传窗口键，供前端做归属校验。",
);

if (failures.length > 0) {
  console.error("对话停止、WebSocket-only 和窗口级 token 统计回归检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("对话停止、WebSocket-only 和窗口级 token 统计回归检查通过。");
