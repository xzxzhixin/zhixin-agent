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
  type ThinkingProcessRow,
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
const thinkingRows: ThinkingProcessRow[] = [
  {
    rowId: "thinking-turn-order",
    turnId: "turn-order",
    taskId: "task-order",
    title: "思考过程",
    statusLabel: "执行中",
    defaultOpen: false,
    traceId: "trace-thinking",
    segments: [
      {
        eventId: "event-thinking",
        statusLabel: "执行中",
        summary: "正在判断可用工具。",
      },
    ],
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
    sequence: 1,
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
    sequence: 2,
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
    sequence: 3,
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
    sequence: 4,
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
    sequence: 5,
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
const processRows = createGroupedProcessRows(commandEvents);

assert(
  processRows.length === 2,
  `两个命令工具调用及其失败事件必须渲染为两个独立卡片，当前为 ${processRows.length} 个。`,
);
assert(
  processRows.some((row) => row.logs.some((log) => log.text === "v20.18.0")),
  "Node.js 命令输出必须保留在对应命令卡片内。",
);
assert(
  processRows.some((row) => row.logs.some((log) => log.text === "Python 3.13.2")),
  "Python 命令输出必须保留在对应命令卡片内。",
);
assert(
  processRows.some((row) => row.title === "命令工具调用" && row.logs.some((log) => log.text === "COMMAND_EXIT_NON_ZERO")),
  "命令失败事件必须保留在对应命令卡片内，不能单独渲染为工具调用过程。",
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
  order.join(">") === "user>thinking>process>process>assistant",
  `同一轮渲染顺序错误：${order.join(">")}`,
);
