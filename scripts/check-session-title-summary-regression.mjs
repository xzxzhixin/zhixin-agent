/**
 * 会话标题总结回归检查。
 *
 * 用途：防止真实对话完成后仍沿用“新的对话”等初始标题，或只更新本地 UI。
 * 关键逻辑：检查中心服务标题总结、会话更新事件、WebSocket 专项推送和前端刷新链路。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * assertIncludes：检查源码包含指定片段。
 *
 * @param source 源码文本。
 * @param fragment 必须存在的源码片段。
 * @param message 缺失时抛出的中文错误。
 * @returns 检查通过时没有返回值。
 */
function assertIncludes(source, fragment, message) {
  if (!source.includes(fragment)) {
    throw new Error(message);
  }
}

// sessionDomain: 会话领域源码，必须在真实对话完成后生成并固化标题摘要。
const sessionDomain = readFileSync(
  join(
    process.cwd(),
    "services",
    "center",
    "src",
    "session-domain.ts",
  ),
  "utf-8",
);
// realtime: 实时同步源码，必须把会话标题更新转成专项 WebSocket 包。
const realtime = readFileSync(
  join(
    process.cwd(),
    "services",
    "center",
    "src",
    "realtime.ts",
  ),
  "utf-8",
);
// shared: 共享协议源码，必须声明会话更新载荷。
const shared = readFileSync(
  join(
    process.cwd(),
    "packages",
    "shared",
    "src",
    "index.ts",
  ),
  "utf-8",
);
// apiClient: API 客户端源码，必须让 WebSocket 消息可携带会话更新载荷类型。
const apiClient = readFileSync(
  join(
    process.cwd(),
    "packages",
    "api-client",
    "src",
    "index.ts",
  ),
  "utf-8",
);
// appStore: 前端状态源码，必须收到会话更新后刷新列表和当前详情。
const appStore = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "stores",
    "app.ts",
  ),
  "utf-8",
);

assertIncludes(
  sessionDomain,
  "export function summarizeSessionTitle",
  "会话领域缺少 summarizeSessionTitle 标题总结函数。",
);
assertIncludes(
  sessionDomain,
  "export function updateSessionTitleAfterTurn",
  "会话领域缺少真实对话完成后的标题固化函数。",
);
assertIncludes(
  sessionDomain,
  'eventType: "session.updated"',
  "会话标题固化没有写入 session.updated 事件。",
);
assertIncludes(
  sessionDomain,
  'eventType: "session.title_summary.failed"',
  "标题总结失败时没有写入错误事件。",
);
assertIncludes(
  sessionDomain,
  "updateSessionTitleAfterTurn(database, events, sent, userText, modelResult.assistantText)",
  "真实对话完成链路没有调用标题总结固化函数。",
);
assertIncludes(
  realtime,
  'if (event.eventType === "session.updated")',
  "实时同步缺少 session.updated 专项推送。",
);
assertIncludes(
  realtime,
  'type: "session.updated"',
  "实时同步没有发送 session.updated WebSocket 包。",
);
assertIncludes(
  shared,
  "export interface SessionUpdatedPayload",
  "共享协议缺少 SessionUpdatedPayload。",
);
assertIncludes(
  apiClient,
  "SessionUpdatedPayload",
  "API 客户端没有导入 SessionUpdatedPayload。",
);
assertIncludes(
  appStore,
  "async handleSessionUpdated",
  "前端 store 缺少处理会话更新的动作。",
);
assertIncludes(
  appStore,
  'message.type === "session.updated"',
  "前端 WebSocket 收到 session.updated 后没有刷新状态。",
);
assertIncludes(
  appStore,
  "await this.loadNavigationData();",
  "前端会话更新处理没有刷新导航列表。",
);
assertIncludes(
  appStore,
  "this.sessionDetail.session = payload.session",
  "前端会话更新处理没有同步当前会话详情标题。",
);

console.log("会话标题总结回归检查通过。");
