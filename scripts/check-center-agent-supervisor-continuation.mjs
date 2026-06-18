import fs from "node:fs";

const gatePath = "services/center/src/agent-runtime/AgentCompletionGate.ts";
const supervisorPath = "services/center/src/agent-runtime/DeepAgentTurnSupervisor.ts";
const agentPath = "services/center/src/deepagents-agent.ts";
const middlewarePath = "services/center/src/AgentMiddleware/CenterToolChoiceMiddleware.ts";

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
const middleware = read(middlewarePath);

if (!gate.includes("class AgentCompletionGate")) {
  throw new Error("AgentCompletionGate 必须用 class 组织完成标准。");
}

if (!gate.includes('status: "waiting_user"')) {
  throw new Error("协议或无进展预算耗尽后必须优先等待用户，不能直接完全失败。");
}

if (gate.includes("FINAL_TEXT_READY")) {
  throw new Error("完成网关不能继续使用 FINAL_TEXT_READY 这类有文本即完成口径。");
}

if (!gate.includes("REACT_FINAL_MESSAGE_READY")) {
  throw new Error("完成网关必须使用 LangChain ReAct 最终 AIMessage 完成口径。");
}

if (gate.includes("hasFinalOutputEvidence") || gate.includes("finalOutputSource")) {
  throw new Error("完成网关不能保留额外 final output 证据门槛，Deep Agents 最终 AIMessage 即 final。");
}

if (gate.includes("isFinalOutputConfirmed")) {
  throw new Error("完成网关不能额外判断 final output 证据，避免偏离 LangChain ReAct 语义。");
}

if (gate.includes("protocolRetry")) {
  throw new Error("完成网关不能保留普通文本协议重试预算，避免旧文本解析逻辑影响判断。");
}

if (gate.includes("containsTextToolShape")) {
  throw new Error("完成网关不能保留普通文本伪工具字段启发式，避免旧逻辑影响 final output 判断。");
}

if (gate.includes("isProcessTextOnly")) {
  throw new Error("完成网关不能保留过程文本关键词启发式，Deep Agents 最终 AIMessage 即 final。");
}

if (!gate.includes("MALFORMED_TEXT_TOOL_CALL_BLOCK")) {
  throw new Error("完成网关必须识别 text content block 夹带工具字段的协议形态错误。");
}

if (!middleware.includes("hasMalformedTextToolCallBlock")) {
  throw new Error("工具选择诊断必须标记 text content block 夹带 id/name/args 的协议错误。");
}

if (!agent.includes("禁止在普通文本、Markdown、JSON 文本或 text content block 中写 id、name、args")) {
  throw new Error("系统提示必须前置约束：工具调用必须用结构化 tool_calls，不能用文本块伪造。");
}

if (!agent.includes("任务拆解不能替代用户明确要求的外部工具操作")) {
  throw new Error("系统提示必须约束 todo/计划不能替代真实浏览、命令或 MCP 工具调用。");
}

if (!agent.includes("优先调用对应外部工具推进任务")) {
  throw new Error("系统提示必须要求用户明确请求工具能力时优先调用对应外部工具。");
}

if (gate.includes("FINAL_OUTPUT_NOT_CONFIRMED")) {
  throw new Error("完成网关不能保留额外 final output 证据门槛，Deep Agents 最终 AIMessage 即 final。");
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

if (supervisor.includes("protocolRetry")) {
  throw new Error("Supervisor 不能保留旧普通文本协议重试计数，畸形工具块只走 continuation 预算。");
}

if (supervisor.includes("noProgressRetry")) {
  throw new Error("Supervisor 不能保留过程文本无进展计数，避免按自然语言过程状态判断。");
}

if (!agent.includes("DeepAgentTurnSupervisor")) {
  throw new Error("deepagents-agent.ts 必须把终态交给 Supervisor。");
}

if (!agent.includes("resolveFinalAssistantText")) {
  throw new Error("deepagents-agent.ts 必须从 Deep Agents 最终状态读取最终 AIMessage 文本。");
}

if (agent.includes("resolveFinalOutputCandidate")) {
  throw new Error("deepagents-agent.ts 不能保留额外 final output 候选门槛。");
}

if (agent.includes("hasFinalOutputEvidence") || agent.includes("finalOutputSource")) {
  throw new Error("deepagents-agent.ts 不能保留 final output 证据字段，最终 AIMessage 即 final。");
}

if (agent.includes("isIncompleteToolIntentText(")) {
  throw new Error("旧的窄正则半截意图判断不能继续作为主路径。");
}
