/**
 * 对话轮次渲染顺序检查。
 *
 * 用途：验证前端不会把同一轮工具过程和模型过程显示到用户问题上方。
 * 关键逻辑：直接调用对话 helper 构造用户消息、思考、工具过程和助手消息，检查统一渲染队列顺序。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错。
 */
import {
  createConversationRenderRows,
  type ProcessMessageGroupRow,
  type ThinkingProcessRow,
} from "../apps/frontend/src/views/Chat/chat-view-helpers";
import type {
  ConversationMessage,
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
const processRows: ProcessMessageGroupRow[] = [
  {
    rowId: "process-turn-order",
    turnId: "turn-order",
    taskId: "task-order",
    kind: "tool",
    title: "命令工具调用",
    statusLabel: "已完成",
    traceId: "trace-process",
    summary: "命令工具已完成。",
    logs: [
      {
        eventId: "event-command",
        statusLabel: "已完成",
        text: "v20.18.0",
        occurredAt: "2026-06-06 08:00:01",
      },
    ],
  },
];

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
  order.join(">") === "user>thinking>process>assistant",
  `同一轮渲染顺序错误：${order.join(">")}`,
);
