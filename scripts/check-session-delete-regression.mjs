/**
 * 会话删除回归检查。
 *
 * 用途：防止会话删除退回前端占位或只删本地列表。
 * 关键逻辑：检查中心服务接口、API 客户端、前端 store 和对话页按钮调用链。
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

/**
 * assertNotIncludes：检查源码不能包含指定片段。
 *
 * @param source 源码文本。
 * @param fragment 禁止出现的源码片段。
 * @param message 出现时抛出的中文错误。
 * @returns 检查通过时没有返回值。
 */
function assertNotIncludes(source, fragment, message) {
  if (source.includes(fragment)) {
    throw new Error(message);
  }
}

// centerRoutes: 中心服务 API 路由源码，必须提供事实源删除入口。
const centerRoutes = readFileSync(
  join(
    process.cwd(),
    "services",
    "center",
    "src",
    "api-routes.ts",
  ),
  "utf-8",
);
// sessionDomain: 会话领域源码，必须删除会话相关事实表。
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
// sessionRepository: 会话事实表删除 SQL 位于数据访问层。
const sessionRepository = readFileSync(
  join(
    process.cwd(),
    "services",
    "center",
    "src",
    "data-access",
    "session-repository.ts",
  ),
  "utf-8",
);
// apiClient: 前端 API 客户端源码，必须暴露正式删除方法。
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
// appStore: 前端状态源码，必须调用中心服务并刷新导航。
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
// chatPage: 对话页源码，按钮必须调用真实删除动作。
const chatPage = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    "Chat",
    "RouterIndex.vue",
  ),
  "utf-8",
);
// sharedTypes: 共享协议源码，项目删除结果需要成为跨端明确协议。
const sharedTypes = readFileSync(
  join(
    process.cwd(),
    "packages",
    "shared",
    "src",
    "index.ts",
  ),
  "utf-8",
);

assertIncludes(
  centerRoutes,
  'app.post("/api/session/delete"',
  "中心服务缺少 /api/session/delete 路由。",
);
assertIncludes(
  centerRoutes,
  "SESSION_DELETE_INVALID",
  "会话删除接口缺少空 sessionId 错误处理。",
);
assertIncludes(
  sessionDomain,
  "export function deleteSession",
  "会话领域缺少 deleteSession 函数。",
);
[
  "DELETE FROM task_steps",
  "DELETE FROM tasks WHERE session_id = ?",
  "DELETE FROM conversation_turns WHERE session_id = ?",
  "DELETE FROM pending_messages WHERE session_id = ?",
  "DELETE FROM attachments WHERE session_id = ?",
  "DELETE FROM messages WHERE session_id = ?",
  "DELETE FROM sessions WHERE id = ?",
].forEach((fragment) => {
  assertIncludes(
    sessionDomain + sessionRepository,
    fragment,
    `会话删除缺少相关事实表清理：${fragment}`,
  );
});
assertIncludes(
  apiClient,
  "deleteSession(payload:",
  "API 客户端缺少 deleteSession 方法。",
);
assertIncludes(
  apiClient,
  'return this.post("/api/session/delete", payload);',
  "API 客户端 deleteSession 没有调用中心服务删除接口。",
);
assertIncludes(
  appStore,
  "async deleteConversation(sessionId: string): Promise<void>",
  "前端 store 缺少真实 deleteConversation 动作。",
);
assertIncludes(
  appStore,
  "await this.api().deleteSession",
  "前端 store 删除会话没有调用 API 客户端。",
);
assertIncludes(
  appStore,
  "await this.loadNavigationData();",
  "前端 store 删除会话后没有刷新导航数据。",
);
assertIncludes(
  appStore,
  "this.sessionDetail = null;",
  "前端 store 删除当前会话后没有清空会话详情。",
);
assertIncludes(
  appStore,
  "this.lastError = error instanceof Error",
  "前端 store 删除失败没有写入可见错误状态。",
);
assertIncludes(
  chatPage,
  "appStore.requestDeleteConversation(session)",
  "对话页删除按钮没有调用带确认的删除动作。",
);
assertNotIncludes(
  chatPage,
  "deleteConversationPlaceholder",
  "对话页仍在调用删除占位函数。",
);
assertNotIncludes(
  appStore,
  "deleteConversationPlaceholder",
  "前端 store 仍保留删除占位函数。",
);
assertIncludes(
  centerRoutes,
  'app.post("/api/project/delete"',
  "中心服务缺少 /api/project/delete 路由。",
);
assertIncludes(
  centerRoutes,
  "PROJECT_DELETE_INVALID",
  "项目删除接口缺少空 projectId 错误处理。",
);
assertIncludes(
  sessionDomain,
  "export function deleteProject",
  "会话领域缺少 deleteProject 函数。",
);
[
  "DELETE FROM task_steps",
  "DELETE FROM tasks",
  "DELETE FROM conversation_turns",
  "DELETE FROM pending_messages",
  "DELETE FROM attachments",
  "DELETE FROM messages",
  "DELETE FROM sessions WHERE project_id = ?",
  "DELETE FROM projects WHERE id = ?",
].forEach((fragment) => {
  assertIncludes(
    sessionDomain + sessionRepository,
    fragment,
    `项目删除缺少相关事实表清理：${fragment}`,
  );
});
assertIncludes(
  sharedTypes,
  "export interface DeleteProjectResult",
  "共享协议缺少 DeleteProjectResult。",
);
assertIncludes(
  apiClient,
  "deleteProject(payload:",
  "API 客户端缺少 deleteProject 方法。",
);
assertIncludes(
  apiClient,
  'return this.post("/api/project/delete", payload);',
  "API 客户端 deleteProject 没有调用中心服务删除接口。",
);
assertIncludes(
  appStore,
  "async deleteProject(projectId: string): Promise<void>",
  "前端 store 缺少真实 deleteProject 动作。",
);
assertIncludes(
  appStore,
  "await this.api().deleteProject",
  "前端 store 删除项目没有调用 API 客户端。",
);
assertIncludes(
  appStore,
  "requestDeleteProject(project",
  "前端 store 缺少项目删除确认动作。",
);
assertIncludes(
  chatPage,
  "appStore.requestDeleteProject(group.project)",
  "对话页项目删除按钮没有调用带确认的项目删除动作。",
);
assertNotIncludes(
  appStore,
  "deleteProjectPlaceholder",
  "前端 store 仍保留项目删除占位函数。",
);

console.log("会话和项目删除回归检查通过。");
