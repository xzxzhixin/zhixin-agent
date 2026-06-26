/**
 * 对话轮次渲染顺序检查。
 *
 * 用途：验证前端不会把同一轮工具过程和模型过程显示到用户问题上方。
 * 关键逻辑：直接调用对话 helper 构造用户消息、思考、工具过程和助手消息，检查统一渲染队列顺序。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错。
 */
import {
  createGroupedProcessRows,
  createConversationRenderRows,
  createThinkingProcessRows,
} from "../apps/frontend/src/views/Chat/chat-view-helpers";
import type {
  ConversationMessage,
  EventRecord,
} from "../packages/shared/src/index";

/**
 * assert：用统一错误格式表达检查失败原因。
 *
 * @param condition 需要满足的布尔条件。
 * @param message 条件不满足时抛出的中文错误。
 * @returns 条件满足时没有返回值。
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const now = "2026-06-06T08:00:00.000Z";
const messages: ConversationMessage[] = [
  {
    messageId: "message-user",
    sessionId: "session-order",
    turnId: "turn-order",
    role: "user",
    contentMarkdown: "查看可用的 node 版本和 python 版本",
    createdAt: now,
  },
  {
    messageId: "message-assistant",
    sessionId: "session-order",
    turnId: "turn-order",
    role: "assistant",
    contentMarkdown: "Node.js 与 Python 版本已读取。",
    createdAt: now,
  },
];
const thinkingEvents: EventRecord[] = [
  {
    eventId: "event-thinking-1-delta",
    eventType: "thinking.delta",
    scopeType: "thinking",
    scopeId: "thinking-1",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: "agent-main",
    projectId: null,
    clientId: null,
    sequence: 1,
    status: "running",
    occurredAt: now,
    title: "思考片段",
    summary: "正在判断可用工具。",
    payload: {
      thinkingId: "thinking-1",
      phase: "工具判断",
      thinkingText: "正在判断可用工具。",
    },
    errorCode: null,
    traceId: "trace-thinking",
  },
  {
    eventId: "event-thinking-1-completed",
    eventType: "thinking.completed",
    scopeType: "thinking",
    scopeId: "thinking-1",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: "agent-main",
    projectId: null,
    clientId: null,
    sequence: 2,
    status: "completed",
    occurredAt: now,
    title: "思考完成",
    summary: "已经确认需要执行命令工具。",
    payload: {
      thinkingId: "thinking-1",
      phase: "工具判断",
      thinkingText: "已经确认需要执行命令工具。",
    },
    errorCode: null,
    traceId: "trace-thinking-completed",
  },
  {
    eventId: "event-thinking-2-delta",
    eventType: "thinking.delta",
    scopeType: "thinking",
    scopeId: "thinking-2",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: "agent-main",
    projectId: null,
    clientId: null,
    sequence: 7,
    status: "running",
    occurredAt: now,
    title: "思考片段",
    summary: "正在分析命令输出。",
    payload: {
      thinkingId: "thinking-2",
      phase: "结果分析",
      thinkingText: "正在分析命令输出。",
    },
    errorCode: null,
    traceId: "trace-thinking-2",
  },
];
const commandEvents: EventRecord[] = [
  {
    eventId: "event-node-started",
    eventType: "tool.command.started",
    scopeType: "tool",
    scopeId: "task-order",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 3,
    status: "running",
    occurredAt: now,
    title: "命令工具开始",
    summary: "查看当前可用的 Node.js 版本",
    payload: {
      toolKind: "command",
      toolCallId: "tool-call-node",
      command: "node -v",
      inputSummary: "查看当前可用的 Node.js 版本",
    },
    errorCode: null,
    traceId: "trace-node-started",
  },
  {
    eventId: "event-node-completed",
    eventType: "tool.command.completed",
    scopeType: "tool",
    scopeId: "task-order",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 4,
    status: "completed",
    occurredAt: now,
    title: "命令工具完成",
    summary: "v20.18.0",
    payload: {
      toolKind: "command",
      toolCallId: "tool-call-node",
      command: "node -v",
      outputSummary: "v20.18.0",
    },
    errorCode: null,
    traceId: "trace-node-completed",
  },
  {
    eventId: "event-python-started",
    eventType: "tool.command.started",
    scopeType: "tool",
    scopeId: "task-order",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 5,
    status: "running",
    occurredAt: now,
    title: "命令工具开始",
    summary: "查看当前可用的 Python 版本",
    payload: {
      toolKind: "command",
      toolCallId: "tool-call-python",
      command: "python -V",
      inputSummary: "查看当前可用的 Python 版本",
    },
    errorCode: null,
    traceId: "trace-python-started",
  },
  {
    eventId: "event-python-completed",
    eventType: "tool.command.completed",
    scopeType: "tool",
    scopeId: "task-order",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 6,
    status: "completed",
    occurredAt: now,
    title: "命令工具完成",
    summary: "Python 3.13.2",
    payload: {
      toolKind: "command",
      toolCallId: "tool-call-python",
      command: "python -V",
      outputSummary: "Python 3.13.2",
    },
    errorCode: null,
    traceId: "trace-python-completed",
  },
  {
    eventId: "event-python-failed",
    eventType: "tool.call.failed",
    scopeType: "tool",
    scopeId: "task-order",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 8,
    status: "failed",
    occurredAt: now,
    title: "命令工具失败",
    summary: "COMMAND_EXIT_NON_ZERO",
    payload: {
      toolKind: "command",
      toolCallId: "tool-call-python",
      command: "python -V",
      failureReason: "COMMAND_EXIT_NON_ZERO",
    },
    errorCode: null,
    traceId: "trace-python-failed",
  },
];
const unavailableEvents: EventRecord[] = [
  {
    eventId: "event-mcp-unavailable",
    eventType: "tool.mcp.unavailable",
    scopeType: "tool",
    scopeId: "task-order",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 10,
    status: "completed",
    occurredAt: now,
    title: "MCP 不可用",
    summary: "当前会话未解析到可执行 MCP 工具。",
    payload: {
      toolKind: "mcp",
      unavailableReason: "当前会话未解析到可执行 MCP 工具。",
    },
    errorCode: null,
    traceId: "trace-mcp-unavailable",
  },
  {
    eventId: "event-skill-unavailable",
    eventType: "tool.skill.unavailable",
    scopeType: "tool",
    scopeId: "task-order",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 11,
    status: "completed",
    occurredAt: now,
    title: "skill 不可用",
    summary: "当前会话未解析到可执行 skill。",
    payload: {
      toolKind: "skill",
      unavailableReason: "当前会话未解析到可执行 skill。",
    },
    errorCode: null,
    traceId: "trace-skill-unavailable",
  },
];
const streamEvents: EventRecord[] = [
  {
    eventId: "event-stream-1-delta-1",
    eventType: "model.stream.delta",
    scopeType: "message",
    scopeId: "stream-1",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 12,
    status: "running",
    occurredAt: now,
    title: "模型流式片段",
    summary: "Node.js ",
    payload: {
      streamId: "stream-1",
      deltaText: "Node.js ",
    },
    errorCode: null,
    traceId: "trace-stream-1",
  },
  {
    eventId: "event-stream-1-delta-2",
    eventType: "model.stream.delta",
    scopeType: "message",
    scopeId: "stream-1",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 13,
    status: "running",
    occurredAt: now,
    title: "模型流式片段",
    summary: "版本已读取。",
    payload: {
      streamId: "stream-1",
      deltaText: "版本已读取。",
    },
    errorCode: null,
    traceId: "trace-stream-1-2",
  },
  {
    eventId: "event-stream-2-delta-1",
    eventType: "model.stream.delta",
    scopeType: "message",
    scopeId: "stream-2",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 14,
    status: "running",
    occurredAt: now,
    title: "模型流式片段",
    summary: "Python ",
    payload: {
      streamId: "stream-2",
      deltaText: "Python ",
    },
    errorCode: null,
    traceId: "trace-stream-2",
  },
  {
    eventId: "event-stream-2-completed",
    eventType: "model.stream.completed",
    scopeType: "message",
    scopeId: "stream-2",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 15,
    status: "completed",
    occurredAt: now,
    title: "模型流式完成",
    summary: "Python 版本已读取。",
    payload: {
      streamId: "stream-2",
      deltaText: "版本已读取。",
    },
    errorCode: null,
    traceId: "trace-stream-2-completed",
  },
];
const thinkingRows = createThinkingProcessRows(thinkingEvents);
const processRows = createGroupedProcessRows([
  ...commandEvents,
  ...unavailableEvents,
  ...streamEvents,
]);

assert(
  thinkingRows.length === 2,
  `两个 thinkingId 必须渲染为两个独立思考卡片，当前为 ${thinkingRows.length} 个。`,
);
assert(
  thinkingRows[0].defaultOpen === false && thinkingRows[1].defaultOpen === true,
  "思考完成后必须默认折叠，仍在思考时必须默认展开。",
);
assert(
  thinkingRows.every((row) => row.segments.every((segment) => !("statusLabel" in segment))),
  "思考过程正文片段不能携带状态标签，状态只能显示在思考过程标题后面。",
);
assert(
  processRows.every((row) => row.kind !== "stream"),
  "模型 SSE 流必须进入助手最终回复气泡，不能在对话区渲染为模型输出过程卡片。",
);

assert(
  processRows.length === 2,
  `只有真实工具调用才允许渲染过程卡片，当前为 ${processRows.length} 个。`,
);
assert(
  processRows.some((row) => row.logs.some((log) => log.text === "v20.18.0")),
  "Node.js 命令输出必须保留在对应命令卡片内。",
);
assert(
  processRows.some((row) => row.logs.some((log) => log.text === "Python 3.13.2")),
  "Python 命令输出必须保留在对应命令卡片内。",
);
const duplicatedCommandRows = createGroupedProcessRows([
  {
    eventId: "event-duplicate-output",
    eventType: "tool.command.output",
    scopeType: "tool",
    scopeId: "task-duplicate",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 30,
    status: "running",
    occurredAt: now,
    title: "命令工具输出",
    summary: "你好，致心",
    payload: {
      toolKind: "command",
      toolCallId: "tool-call-duplicate",
      command: "powershell -Command Write-Output '你好，致心'",
      outputChunk: "你好，致心",
    },
    errorCode: null,
    traceId: "trace-duplicate-output",
  },
  {
    eventId: "event-duplicate-completed",
    eventType: "tool.command.completed",
    scopeType: "tool",
    scopeId: "task-duplicate",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 31,
    status: "completed",
    occurredAt: now,
    title: "命令工具完成",
    summary: "你好，致心",
    payload: {
      toolKind: "command",
      toolCallId: "tool-call-duplicate",
      command: "powershell -Command Write-Output '你好，致心'",
      outputSummary: "你好，致心",
    },
    errorCode: null,
    traceId: "trace-duplicate-completed",
  },
]);
assert(
  duplicatedCommandRows.length === 1 && duplicatedCommandRows[0].responseText === "你好，致心",
  "命令卡片正文不能把输出事件和完成摘要重复拼接成两份相同内容。",
);
const mcpDuplicatedRows = createGroupedProcessRows([
  {
    eventId: "event-mcp-completed",
    eventType: "tool.mcp.completed",
    scopeType: "tool",
    scopeId: "task-mcp",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 40,
    status: "completed",
    occurredAt: now,
    title: "MCP 调用完成",
    summary: "## Pages\n1: https://github.com/trending\n2: https://example.com",
    payload: {
      toolKind: "mcp",
      toolCallId: "tool-call-mcp-duplicate",
      toolName: "mcp__chrome-devtools__new_page",
      outputSummary: "## Pages\n1: https://github.com/trending\n2: https://example.com",
    },
    errorCode: null,
    traceId: "trace-mcp-completed",
  },
  {
    eventId: "event-mcp-result-appended",
    eventType: "model.tool.result.appended",
    scopeType: "model",
    scopeId: "task-mcp",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 41,
    status: "completed",
    occurredAt: now,
    title: "工具结果回填模型",
    summary: "已回填工具结果：mcp__chrome-devtools__new_page",
    payload: {
      toolId: "builtin.mcp.call",
      toolCallId: "tool-call-mcp-duplicate",
      toolName: "mcp__chrome-devtools__new_page",
      status: "completed",
      resultSummary: "## Pages\n1: https://github.com/trending",
    },
    errorCode: null,
    traceId: "trace-mcp-result-appended",
  },
]);
assert(
  mcpDuplicatedRows.length === 1
    && mcpDuplicatedRows[0].responseText === "## Pages\n1: https://github.com/trending\n2: https://example.com",
  "MCP 卡片正文不能把完成结果和截断回填结果重复拼接。",
);
assert(
  processRows.some((row) => row.title === "python -V" && row.logs.some((log) => log.text === "COMMAND_EXIT_NON_ZERO")),
  "命令失败事件必须保留在对应命令卡片内，不能单独渲染为工具调用过程。",
);
assert(
  processRows.every((row) => ![
    "插件调用过程",
    "MCP 调用过程",
    "skill 调用过程",
    "工具调用过程",
    "模型输出",
  ].includes(row.title)),
  "对话区过程卡片不能显示系统分类标题，只显示具体动作或内容。",
);

const rows = createConversationRenderRows(
  messages,
  thinkingRows,
  processRows,
);
const order = rows.map((row) => {
  if (row.rowKind === "message") {
    return row.message.role;
  }
  return row.rowKind;
});

assert(
  order.join(">") === "user>thinking>process>process>thinking>assistant",
  `同一轮渲染顺序错误：${order.join(">")}`,
);

const streamingRows = createConversationRenderRows(
  [
    messages[0],
  ],
  thinkingRows,
  processRows,
  streamEvents,
);
const streamingOrder = streamingRows.map((row) => {
  if (row.rowKind === "message") {
    return row.message.role;
  }
  return row.rowKind;
});
const streamingAssistantRow = streamingRows.find((row) => {
  return row.rowKind === "message" && row.message.role === "assistant";
});

assert(
  streamingOrder.join(">") === "user>thinking>process>process>thinking>assistant",
  `运行中模型流必须拼接为临时助手回复并保持轮次顺序，当前为 ${streamingOrder.join(">")}`,
);
assert(
  streamingAssistantRow?.rowKind === "message"
    && streamingAssistantRow.message.contentMarkdown === "Node.js 版本已读取。Python ",
  "运行中模型 SSE delta 必须拼接到助手回复气泡，completed 事件不能重复追加正文。",
);
assert(
  streamingAssistantRow?.rowId === "streaming-assistant-turn-order",
  "临时助手回复必须使用稳定轮次 ID，避免流式更新时整条消息重新挂载。",
);

const continuedMessages: ConversationMessage[] = [
  {
    messageId: "message-turn-1-user",
    sessionId: "session-continue-order",
    turnId: "turn-1",
    role: "user",
    contentMarkdown: "用浏览器查 GitHub 今日 AI 新技术。",
    createdAt: "2026-06-26T08:00:00.000Z",
  },
  {
    messageId: "message-turn-2-user",
    sessionId: "session-continue-order",
    turnId: "turn-2",
    role: "user",
    contentMarkdown: "继续",
    createdAt: "2026-06-26T08:10:00.000Z",
  },
  {
    messageId: "message-turn-2-assistant",
    sessionId: "session-continue-order",
    turnId: "turn-2",
    role: "assistant",
    contentMarkdown: "我会沿着上一轮失败原因继续说明。",
    createdAt: "2026-06-26T08:10:30.000Z",
  },
];
const firstTurnLateProcessRows = createGroupedProcessRows([
  {
    eventId: "event-turn-1-failed-late",
    eventType: "tool.call.failed",
    scopeType: "tool",
    scopeId: "task-turn-1",
    sessionId: "session-continue-order",
    turnId: "turn-1",
    taskId: "task-turn-1",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 22,
    status: "failed",
    occurredAt: "2026-06-26T08:03:00.000Z",
    title: "模型调用失败",
    summary: "502 Upstream request failed",
    payload: {
      toolKind: "model",
      toolCallId: "tool-call-turn-1-failed",
      errorMessage: "502 Upstream request failed",
    },
    errorCode: null,
    traceId: "trace-turn-1-failed-late",
  },
]);
const continuedRows = createConversationRenderRows(
  continuedMessages,
  [],
  firstTurnLateProcessRows,
);
const continuedOrder = continuedRows.map((row) => {
  if (row.rowKind === "message") {
    return `${row.message.role}:${row.message.turnId}`;
  }
  return `${row.rowKind}:${row.process.turnId}`;
});
const firstTurnProcessIndex = continuedOrder.indexOf("process:turn-1");
const secondTurnAssistantIndex = continuedOrder.indexOf("assistant:turn-2");

assert(
  firstTurnProcessIndex > -1,
  "第一轮失败过程必须仍然可见。",
);
assert(
  firstTurnProcessIndex < secondTurnAssistantIndex,
  `第一轮过程不能漂移到第二轮助手回复后面，当前顺序为 ${continuedOrder.join(">")}`,
);

const orphanProcessRows = createGroupedProcessRows([
  {
    eventId: "event-orphan-turn-process",
    eventType: "tool.call.failed",
    scopeType: "tool",
    scopeId: "task-orphan",
    sessionId: "session-continue-order",
    turnId: "turn-orphan",
    taskId: "task-orphan",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 12,
    status: "failed",
    occurredAt: "2026-06-26T08:05:00.000Z",
    title: "孤立历史过程",
    summary: "历史轮次缺少消息锚点。",
    payload: {
      toolKind: "command",
      toolCallId: "tool-call-orphan",
      command: "node -v",
      errorMessage: "历史轮次缺少消息锚点。",
    },
    errorCode: null,
    traceId: "trace-orphan-turn-process",
  },
]);
const orphanRows = createConversationRenderRows(
  continuedMessages,
  [],
  orphanProcessRows,
);
const orphanOrder = orphanRows.map((row) => {
  if (row.rowKind === "message") {
    return `${row.message.role}:${row.message.turnId}`;
  }
  return `${row.rowKind}:${row.process.turnId}`;
});
const orphanProcessIndex = orphanOrder.indexOf("process:turn-orphan");
const latestAssistantIndex = orphanOrder.indexOf("assistant:turn-2");

assert(
  orphanProcessIndex > -1,
  "缺少消息锚点的带 turnId 历史过程必须保留为审计可见。",
);
assert(
  orphanProcessIndex < latestAssistantIndex,
  `缺少消息锚点的历史过程不能追加到最新回复后面，当前顺序为 ${orphanOrder.join(">")}`,
);
