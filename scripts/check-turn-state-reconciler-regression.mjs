/**
 * 轮次状态收敛回归检查。
 *
 * 用途：锁定多端运行态残留问题的架构边界，避免继续退回散落事件判断。
 * 关键逻辑：只读取源码做静态检查，不启动中心服务，不修改业务数据。
 * 参数：无。
 * 返回值：检查通过时退出码为 0；发现缺口时退出码为 1。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// rootDirectory：脚本运行目录固定为仓库根目录。
const rootDirectory = process.cwd();

/**
 * readProjectFile：读取项目内文本文件。
 *
 * @param {string} pathInProject 项目相对路径。
 * @returns {string} 文件内容。
 */
function readProjectFile(pathInProject) {
  return readFileSync(
    join(
      rootDirectory,
      pathInProject,
    ),
    "utf8",
  );
}

/**
 * fail：记录检查失败原因。
 *
 * @param {string} message 失败说明。
 * @returns {void}
 */
function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

/**
 * assertIncludes：检查源码必须包含指定文本。
 *
 * @param {string} source 源码文本。
 * @param {string} pattern 必须存在的文本。
 * @param {string} message 缺失时的失败说明。
 * @returns {void}
 */
function assertIncludes(
  source,
  pattern,
  message,
) {
  if (!source.includes(pattern)) {
    fail(message);
  }
}

// syncRouteSource：中心服务 WebSocket 路由源码，承载轻量轮次状态请求。
const syncRouteSource = readProjectFile("services/center/src/api/sync-route.ts");
// sessionDomainSource：会话领域源码，承载轮次状态查询和统一终态事件。
const sessionDomainSource = readProjectFile("services/center/src/domain/session-domain.ts");
// conversationActionsSource：前端对话动作源码，承载发送、停止和运行态恢复入口。
const conversationActionsSource = readProjectFile("apps/frontend/src/stores/app-conversation-actions.ts");
// reconcilerSource：运行态收敛器源码，承载运行态事实对账。
let reconcilerSource = "";
try {
  reconcilerSource = readProjectFile("apps/frontend/src/stores/TurnStateReconciler.ts");
} catch {
  fail("缺少 apps/frontend/src/stores/TurnStateReconciler.ts，前端运行态仍缺少统一状态收敛器。");
}

assertIncludes(
  syncRouteSource,
  "session.turn.state",
  "WebSocket 必须提供 session.turn.state 轻量轮次状态请求。",
);
assertIncludes(
  sessionDomainSource,
  "turn.state.changed",
  "轮次终态必须追加统一 turn.state.changed 事件。",
);
assertIncludes(
  sessionDomainSource,
  "getActiveTurnState",
  "中心服务必须提供 getActiveTurnState 轻量轮次状态事实函数。",
);
assertIncludes(
  conversationActionsSource,
  "TurnStateReconciler",
  "会话动作必须接入 TurnStateReconciler。",
);
assertIncludes(
  reconcilerSource,
  "SUSPECTED_STALE_FAST_INTERVAL_MS = 20",
  "疑似失联阶段必须使用 20ms 快速追赶。",
);
assertIncludes(
  reconcilerSource,
  "CONFIRMED_RUNNING_INTERVAL_MS",
  "确认运行态必须使用低频事实对账。",
);
assertIncludes(
  reconcilerSource,
  "session.turn.state",
  "收敛器必须通过轻量轮次状态事实源追赶终态。",
);
assertIncludes(
  conversationActionsSource,
  "turn.state.changed",
  "实时事件处理必须识别统一轮次状态事件。",
);
