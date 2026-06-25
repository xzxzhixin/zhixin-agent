import fs from "node:fs";

const agentPath = "services/center/src/deepagents-agent.ts";
const summaryServicePath = "services/center/src/agent-runtime/TurnFailureSummaryService.ts";

/**
 * read：读取源码文本。
 *
 * @param {string} path 源码路径。
 * @returns {string} 源码文本。
 */
function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`缺少文件：${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const agent = read(agentPath);

if (agent.includes("DeepAgentTurnSupervisor")) {
  throw new Error("runDeepAgentsAgentTurn 不能再依赖 DeepAgentTurnSupervisor 外围监督循环。");
}

if (agent.includes("AgentCompletionGate")) {
  throw new Error("deepagents-agent.ts 不能再依赖 AgentCompletionGate 完成网关。");
}

if (agent.includes("createDefaultSupervisorBudget")) {
  throw new Error("deepagents-agent.ts 不能继续保留监督预算工厂。");
}

if (!agent.includes("await runSingleDeepAgentCandidate(")) {
  throw new Error("runDeepAgentsAgentTurn 必须直接执行一次 Deep Agents 候选运行。");
}

if (!agent.includes("await finalizeDeepAgentTurn(")) {
  throw new Error("runDeepAgentsAgentTurn 必须直接固化 Deep Agents 最终 AIMessage。");
}

if (fs.existsSync(summaryServicePath)) {
  throw new Error("中心服务不得保留 TurnFailureSummaryService 外部失败总结服务。");
}

if (agent.includes("TurnFailureSummaryService")) {
  throw new Error("deepagents-agent.ts 不得调用 TurnFailureSummaryService。");
}

if (agent.includes("message.failure_summary.failed")) {
  throw new Error("deepagents-agent.ts 不得生成失败总结创建失败事件。");
}

if (agent.includes("turn_failure_summary")) {
  throw new Error("deepagents-agent.ts 不得写入失败总结来源标记。");
}

if (agent.includes("appendFailureSummaryAssistantMessage")) {
  throw new Error("deepagents-agent.ts 不得在异常收尾时追加外部失败总结助手消息。");
}

if (agent.includes("fallbackText")) {
  throw new Error("deepagents-agent.ts 不得用流式文本兜底 Deep Agents 最终 AIMessage。");
}
