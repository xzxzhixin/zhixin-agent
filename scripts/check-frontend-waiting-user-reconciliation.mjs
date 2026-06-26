import fs from "node:fs";

const panelPath = "apps/frontend/src/views/Chat/components/ChatConversationPanel.vue";
const actionsPath = "apps/frontend/src/stores/app-conversation-actions.ts";
const reconcilerPath = "apps/frontend/src/stores/TurnStateReconciler.ts";

/**
 * read：读取源码文件。
 *
 * @param {string} path 项目相对路径。
 * @returns {string} 文件内容。
 */
function read(path) {
  return fs.readFileSync(
    path,
    "utf8",
  );
}

const panel = read(panelPath);
const actions = read(actionsPath);
const reconciler = read(reconcilerPath);

const activeRunningTurnBlock = panel.slice(
  panel.indexOf("const activeRunningTurn = computed"),
  panel.indexOf("// nowTick:"),
);

if (!activeRunningTurnBlock.includes("ACTIVE_TURN_STATE_STATUSES.QUEUED")
  || !activeRunningTurnBlock.includes("ACTIVE_TURN_STATE_STATUSES.RUNNING")) {
  throw new Error("输入区运行态必须只识别 queued/running。");
}

if (activeRunningTurnBlock.includes("ACTIVE_TURN_STATE_STATUSES.WAITING_USER")) {
  throw new Error("waiting_user 不能继续驱动输入区停止按钮和当前轮次耗时。");
}

const recoverableTurnBlock = actions.slice(
  actions.indexOf("function isRecoverableTurnRunning"),
  actions.indexOf("function readTimeMs"),
);

if (!recoverableTurnBlock.includes("ACTIVE_TURN_STATE_STATUSES.QUEUED")
  || !recoverableTurnBlock.includes("ACTIVE_TURN_STATE_STATUSES.RUNNING")) {
  throw new Error("运行中轮次恢复必须只跟踪 queued/running。");
}

if (recoverableTurnBlock.includes("ACTIVE_TURN_STATE_STATUSES.WAITING_USER")) {
  throw new Error("waiting_user 不能启动运行中轮次恢复。");
}

const terminalStatusBlock = actions.slice(
  actions.indexOf("function isTerminalExecutionStatus"),
  actions.indexOf("function isCompletedTaskUpdate"),
);

if (!terminalStatusBlock.includes("FINAL_TURN_STATUSES.some")) {
  throw new Error("waiting_user 必须触发实时事件收敛并刷新快照。");
}

const reconcilerTerminalBlock = reconciler.slice(
  reconciler.indexOf("private isTerminalState"),
  reconciler.indexOf("private syncRecoveryState"),
);

if (!reconcilerTerminalBlock.includes("FINAL_TURN_STATUSES.some")) {
  throw new Error("TurnStateReconciler 必须把 waiting_user 视为收敛状态。");
}

if (!reconciler.includes("getLocalLastSequence")) {
  throw new Error("TurnStateReconciler 必须能读取本地最大事件序号。");
}

if (!actions.includes("getLocalLastSequence: (turnId) =>")) {
  throw new Error("本地事件序号必须按当前轮次读取，不能用整个会话历史最大 sequence。");
}

if (!actions.includes("event.turnId !== turnId")) {
  throw new Error("本地事件序号读取必须过滤当前 turnId，避免历史轮次大 sequence 掩盖实时缺口。");
}

if (!reconciler.includes("hasEventSequenceGap")) {
  throw new Error("TurnStateReconciler 必须在轻量状态发现事件序号缺口时补快照。");
}

if (!reconciler.includes("sequence gap reconciled")) {
  throw new Error("事件序号缺口补齐必须有前端诊断日志。");
}
