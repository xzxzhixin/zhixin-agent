/**
 * 对话多端同步与历史恢复回归检查。
 *
 * 用途：防止删除不同步、历史重开缺过程卡片、浏览器 URL 混用 Vite 路径。
 * 关键逻辑：静态检查中心服务广播删除事件，前端处理 session.deleted，并在加载会话详情时补齐事件。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * readProjectFile：读取项目内源码文件。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件内容。
 */
function readProjectFile(relativePath) {
  return readFileSync(
    join(
      process.cwd(),
      relativePath,
    ),
    "utf-8",
  );
}

/**
 * assertIncludes：检查源码包含必要片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 必须存在的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(
  source,
  fragment,
  message,
) {
  if (!source.includes(fragment)) {
    throw new Error(message);
  }
}

/**
 * assertNotIncludes：检查源码不包含禁止片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 禁止出现的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotIncludes(
  source,
  fragment,
  message,
) {
  if (source.includes(fragment)) {
    throw new Error(message);
  }
}

const apiRoutes = readProjectFile("services/center/src/api/api-routes.ts");
const realtime = readProjectFile("services/center/src/realtime.ts");
const appStore = readProjectFile("apps/frontend/src/stores/app.ts");
const conversationActions = readProjectFile("apps/frontend/src/stores/app-conversation-actions.ts");
const desktopMain = readProjectFile("apps/desktop-shell/src/main.ts");
const centerConfig = readProjectFile("services/center/src/config.ts");

assertIncludes(
  apiRoutes,
  "const deleteResult = deleteSession(",
  "删除会话路由必须保留删除结果并广播，不应直接 return deleteSession。",
);
assertIncludes(
  apiRoutes,
  "broadcastEvents(",
  "删除会话后必须通过 WebSocket 广播 session.deleted 给其他端。",
);
assertIncludes(
  realtime,
  'event.eventType === "session.deleted"',
  "实时同步层必须把 session.deleted 转成领域专项包。",
);
assertIncludes(
  realtime,
  'type: "session.deleted"',
  "实时同步层必须发送 session.deleted 专项 WebSocket 消息。",
);
assertIncludes(
  conversationActions,
  'message.type === "session.deleted"',
  "前端 WebSocket 必须处理 session.deleted。",
);
assertIncludes(
  conversationActions,
  "handleSessionDeleted",
  "前端收到 session.deleted 后必须统一刷新导航和当前详情。",
);
assertIncludes(
  appStore,
  "async handleSessionDeleted",
  "前端 store 必须提供 session.deleted 处理动作。",
);
assertIncludes(
  appStore,
  "this.events = snapshot.events;",
  "加载会话详情时必须通过 WebSocket session.snapshot 同步补齐事件，历史重开才能恢复过程卡片。",
);
assertIncludes(
  appStore,
  "async loadActiveSessionSnapshot",
  "前端必须有详情和事件一体加载函数，避免历史恢复漏拉事件。",
);
assertNotIncludes(
  appStore,
  "async loadActiveSessionDetail(): Promise<void> {\n            if (!this.activeSessionId) {\n                this.sessionDetail = null;\n                return;\n            }\n\n            this.sessionDetail = await this.api().getSessionDetail",
  "loadActiveSessionDetail 不能只拉详情而不拉事件。",
);

assertIncludes(
  desktopMain,
  "resolveDesktopWindowUrl",
  "桌面壳必须集中规范窗口加载 URL，避免拼出 /chat?port=8866#/chat。",
);
assertNotIncludes(
  desktopMain,
  "`${frontendDevUrl}?port=${centerLaunchConfig.port}`",
  "桌面壳开发期不能直接暴露 Vite 根地址作为桌面窗口规范 URL。",
);
assertIncludes(
  centerConfig,
  "normalizeFrontendDevRedirectPath",
  "中心服务开发期重定向必须规范 pathname，避免 /chat?port=8866#/chat。",
);
assertNotIncludes(
  centerConfig,
  "url.pathname = requestPath",
  "中心服务开发期重定向不能把 /chat 这类前端路径原样放到 Vite pathname。",
);

console.log("对话多端同步与历史恢复回归检查通过。");
