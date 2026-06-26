/**
 * 会话续接上下文检查。
 *
 * 用途：验证新轮次发送给 Deep Agents 的上下文按 messages 投影，而不是拼入主 systemPrompt。
 * 关键逻辑：直接调用上下文构造器的纯函数，并静态检查 Deep Agents 调用点。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错。
 */
import {
  readFileSync,
} from "node:fs";
import {
  SessionModelMessageHistoryBuilder,
} from "../services/center/src/domain/SessionModelMessageHistoryBuilder";
import type {
  ConversationMessage,
  ConversationTurn,
  EventRecord,
  TaskRecord,
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

const currentUserText = "继续";
const currentTurnId = "turn-current";
const historyMessages: ConversationMessage[] = [
  {
    messageId: "message-old-user-1",
    sessionId: "session-context",
    agentId: "main",
    turnId: "turn-old-1",
    role: "user",
    contentMarkdown: "请记录一下今天的项目目标。",
    createdAt: "2026-06-26 08:00:00",
  },
  {
    messageId: "message-old-assistant-1",
    sessionId: "session-context",
    agentId: "main",
    turnId: "turn-old-1",
    role: "assistant",
    contentMarkdown: "已经记录。",
    createdAt: "2026-06-26 08:01:00",
  },
  {
    messageId: "message-old-user-2",
    sessionId: "session-context",
    agentId: "main",
    turnId: "turn-failed",
    role: "user",
    contentMarkdown: "用可以控制的浏览器新开3个页面去github查询今天ai圈出了什么新技术。",
    createdAt: "2026-06-26 08:10:00",
  },
  {
    messageId: "message-current-user",
    sessionId: "session-context",
    agentId: "main",
    turnId: currentTurnId,
    role: "user",
    contentMarkdown: currentUserText,
    createdAt: "2026-06-26 08:20:00",
  },
];
const turns: ConversationTurn[] = [
  {
    turnId: "turn-old-1",
    sessionId: "session-context",
    turnNumber: 1,
    userMessageId: "message-old-user-1",
    status: "completed",
    startedAt: "2026-06-26 08:00:00",
    endedAt: "2026-06-26 08:01:00",
    durationMs: 60000,
  },
  {
    turnId: "turn-failed",
    sessionId: "session-context",
    turnNumber: 2,
    userMessageId: "message-old-user-2",
    status: "failed",
    startedAt: "2026-06-26 08:10:00",
    endedAt: "2026-06-26 08:12:00",
    durationMs: 120000,
  },
  {
    turnId: currentTurnId,
    sessionId: "session-context",
    turnNumber: 3,
    userMessageId: "message-current-user",
    status: "running",
    startedAt: "2026-06-26 08:20:00",
    endedAt: null,
    durationMs: null,
  },
];
const tasks: TaskRecord[] = [
  {
    taskId: "task-failed",
    turnId: "turn-failed",
    sessionId: "session-context",
    agentId: "main",
    status: "failed",
    title: "浏览器三页 GitHub 查询",
    createdAt: "2026-06-26 08:10:00",
    updatedAt: "2026-06-26 08:12:00",
  },
];
const events: EventRecord[] = [
  {
    eventId: "event-failed",
    eventType: "message.turn.failed",
    scopeType: "turn",
    scopeId: "turn-failed",
    sessionId: "session-context",
    turnId: "turn-failed",
    taskId: "task-failed",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 9,
    status: "failed",
    occurredAt: "2026-06-26 08:12:00",
    title: "对话执行失败",
    summary: "502 Upstream request failed",
    payload: {
      errorMessage: "502 Upstream request failed",
    },
    errorCode: null,
    traceId: "trace-failed",
  },
];
const overflowHistoryMessages: ConversationMessage[] = Array.from({
  length: 12,
}).map((_, index) => {
  const turnNumber = index + 1;
  return {
    messageId: `message-overflow-${turnNumber}`,
    sessionId: "session-context",
    agentId: "main",
    turnId: `turn-overflow-${turnNumber}`,
    role: "user",
    contentMarkdown: `历史消息 ${turnNumber}`,
    createdAt: `2026-06-26 07:${String(turnNumber).padStart(2, "0")}:00`,
  };
});

const messages = SessionModelMessageHistoryBuilder.buildMessagesFromFacts({
  currentTurnId,
  messages: historyMessages,
  turns,
  tasks,
  events,
});

assert(
  Array.isArray(messages),
  "续接上下文必须返回 Deep Agents messages 数组。",
);
assert(
  messages.some((message) => {
    return message.role === "user"
      && message.content === "请记录一下今天的项目目标。";
  }),
  "续接上下文必须保留历史 user 消息角色。",
);
assert(
  messages.some((message) => {
    return message.role === "assistant"
      && message.content === "已经记录。";
  }),
  "续接上下文必须保留历史 assistant 消息角色。",
);
assert(
  messages.some((message) => {
    return message.role === "system"
      && message.content.includes("浏览器三页 GitHub 查询")
      && message.content.includes("502 Upstream request failed");
  }),
  "上一轮任务和失败原因必须作为邻近 system 上下文消息进入 messages。",
);
assert(
  !messages.some((message) => {
    return message.content === currentUserText;
  }),
  "当前用户消息不能由历史构造器重复注入。",
);
assert(
  messages[messages.length - 1]?.role === "system",
  "上一轮状态摘要必须放在历史消息之后、当前用户消息之前。",
);

const limitedMessages = SessionModelMessageHistoryBuilder.buildMessagesFromFacts({
  currentTurnId,
  messages: [
    ...overflowHistoryMessages,
    historyMessages[3],
  ],
  turns,
  tasks: [],
  events: [],
});
const limitedHistoryMessages = limitedMessages.filter((message) => {
  return message.role === "user"
    && message.content.startsWith("历史消息 ");
});

assert(
  limitedHistoryMessages.length === 10,
  "续接上下文最多只能投影最近 10 条非当前轮次历史消息。",
);
assert(
  limitedHistoryMessages[0]?.content === "历史消息 3"
    && limitedHistoryMessages[9]?.content === "历史消息 12",
  "最近 10 条历史消息必须保持时间升序进入 Deep Agents messages。",
);

const builderSourceText = readFileSync(
  new URL("../services/center/src/domain/SessionModelMessageHistoryBuilder.ts", import.meta.url),
  "utf8",
);
const deepAgentsSourceText = readFileSync(
  new URL("../services/center/src/deepagents-agent.ts", import.meta.url),
  "utf8",
);

assert(
  !builderSourceText.includes("buildPrompt"),
  "续接构造器不能继续提供 systemPrompt 字符串构造入口。",
);
assert(
  deepAgentsSourceText.includes("...historyMessages"),
  "Deep Agents 调用点必须把历史消息投影追加到 messages 数组。",
);
assert(
  /messages:\s*\[\s*\.\.\.historyMessages,\s*\{\s*role:\s*"user",\s*content:\s*input\.userText,?\s*\}/u.test(deepAgentsSourceText),
  "当前用户消息必须位于历史消息投影之后。",
);
assert(
  deepAgentsSourceText.includes("content: input.userText"),
  "Deep Agents 调用点必须由当前轮次最后追加当前用户消息。",
);
assert(
  !deepAgentsSourceText.includes("continuationContextPrompt"),
  "Deep Agents 调用点不能继续把续接上下文拼入 systemPrompt。",
);

for (const forbiddenText of [
  "继续",
  "接着",
  "继续做",
]) {
  assert(
    !builderSourceText.includes(`"${forbiddenText}"`) && !builderSourceText.includes(`'${forbiddenText}'`),
    `续接上下文不能硬编码识别用户文本：${forbiddenText}`,
  );
}
