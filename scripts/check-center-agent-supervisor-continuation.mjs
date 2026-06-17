import fs from "node:fs";

const gatePath = "services/center/src/agent-runtime/AgentCompletionGate.ts";
const supervisorPath = "services/center/src/agent-runtime/DeepAgentTurnSupervisor.ts";
const agentPath = "services/center/src/deepagents-agent.ts";

/**
 * read：读取检查目标源码。
 *
 * @param {string} path 目标文件路径。
 * @returns {string} 文件文本。
 */
function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`缺少文件：${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const gate = read(gatePath);
const supervisor = read(supervisorPath);
const agent = read(agentPath);

if (!gate.includes("class AgentCompletionGate")) {
  throw new Error("AgentCompletionGate 必须用 class 组织完成标准。");
}

if (!gate.includes("protocolRetryBudget")) {
  throw new Error("完成网关必须包含协议形态重试预算。");
}

if (!gate.includes('status: "waiting_user"')) {
  throw new Error("协议或无进展预算耗尽后必须优先等待用户，不能直接完全失败。");
}

if (!gate.includes("containsTextToolShape")) {
  throw new Error("完成网关必须识别普通文本里的伪工具形态，但不能恢复工具。");
}

if (gate.includes("mcp__chrome") || gate.includes("github")) {
  throw new Error("完成网关不能硬编码具体 MCP 工具或用户场景。");
}

if (!supervisor.includes("class DeepAgentTurnSupervisor")) {
  throw new Error("DeepAgentTurnSupervisor 必须用 class 组织监督循环。");
}

if (!supervisor.includes("maxSupervisorAttempts")) {
  throw new Error("Supervisor 必须包含总续跑预算。");
}

if (!agent.includes("DeepAgentTurnSupervisor")) {
  throw new Error("deepagents-agent.ts 必须把终态交给 Supervisor。");
}

if (agent.includes("isIncompleteToolIntentText(")) {
  throw new Error("旧的窄正则半截意图判断不能继续作为主路径。");
}
