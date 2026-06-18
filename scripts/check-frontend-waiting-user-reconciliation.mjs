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

if (!activeRunningTurnBlock.includes('turn.status !== "queued"')
  || !activeRunningTurnBlock.includes('turn.status !== "running"')) {
  throw new Error("输入区运行态必须只识别 queued/running。");
}

if (activeRunningTurnBlock.includes('turn.status !== "waiting_user"')) {
  throw new Error("waiting_user 不能继续驱动输入区停止按钮和当前轮次耗时。");
}

const recoverableTurnBlock = actions.slice(
  actions.indexOf("function isRecoverableTurnRunning"),
  actions.indexOf("function readTimeMs"),
);

if (!recoverableTurnBlock.includes('turn.status !== "queued"')
  || !recoverableTurnBlock.includes('turn.status !== "running"')) {
  throw new Error("运行中轮次恢复必须只跟踪 queued/running。");
}

if (recoverableTurnBlock.includes('turn.status !== "waiting_user"')) {
  throw new Error("waiting_user 不能启动运行中轮次恢复。");
}

const terminalStatusBlock = actions.slice(
  actions.indexOf("function isTerminalExecutionStatus"),
  actions.indexOf("function isCompletedTaskUpdate"),
);

if (!terminalStatusBlock.includes('|| status === "waiting_user"')) {
  throw new Error("waiting_user 必须触发实时事件收敛并刷新快照。");
}

const reconcilerTerminalBlock = reconciler.slice(
  reconciler.indexOf("private isTerminalState"),
  reconciler.indexOf("private syncRecoveryState"),
);

if (!reconcilerTerminalBlock.includes('state.status === "waiting_user"')) {
  throw new Error("TurnStateReconciler 必须把 waiting_user 视为收敛状态。");
}

if (!reconciler.includes("getLocalLastSequence")) {
  throw new Error("TurnStateReconciler 必须能读取本地最大事件序号。");
}

if (!reconciler.includes("hasEventSequenceGap")) {
  throw new Error("TurnStateReconciler 必须在轻量状态发现事件序号缺口时补快照。");
}

if (!reconciler.includes("sequence gap reconciled")) {
  throw new Error("事件序号缺口补齐必须有前端诊断日志。");
}
