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
    "api",
    "api-routes.ts",
  ),
  "utf-8",
);
// sessionRoutes: 会话路由拆分文件，承载 /api/session/*。
const sessionRoutes = readFileSync(
  join(
    process.cwd(),
    "services",
    "center",
    "src",
    "api",
    "session.ts",
  ),
  "utf-8",
);
// projectRoutes: 项目路由拆分文件，承载 /api/project/*。
const projectRoutes = readFileSync(
  join(
    process.cwd(),
    "services",
    "center",
    "src",
    "api",
    "project.ts",
  ),
  "utf-8",
);
// routeSources: 聚合入口和资源路由合并文本，适配 API 按资源拆分后的检查范围。
const routeSources = `${centerRoutes}\n${sessionRoutes}\n${projectRoutes}`;
// sessionDomain: 会话领域源码，必须删除会话相关事实表。
const sessionDomain = readFileSync(
  join(
    process.cwd(),
    "services",
    "center",
    "src",
    "domain",
    "session-domain.ts",
  ),
  "utf-8",
);
// sessionQueryDomain: 删除会话和项目的真实领域实现已拆到查询领域文件。
const sessionQueryDomain = readFileSync(
  join(
    process.cwd(),
    "services",
    "center",
    "src",
    "domain",
    "session-query-domain.ts",
  ),
  "utf-8",
);
// sessionDeleteDomainSource: 会话聚合出口和删除实现的合并文本。
const sessionDeleteDomainSource = `${sessionDomain}\n${sessionQueryDomain}`;
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
// appProjectActions: 项目选择、登记和删除动作位于 store 分片，避免主 store 文件继续超过行数上限。
const appProjectActions = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "stores",
    "app-project-actions.ts",
  ),
  "utf-8",
);
// appConversationActions: 会话发送和实时同步分片，包含删除事件竞态处理。
const appConversationActions = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "stores",
    "app-conversation-actions.ts",
  ),
  "utf-8",
);
// frontendStoreSource: 删除链路允许拆分到 store 分片，检查时合并源码片段。
const frontendStoreSource = `${appStore}\n${appProjectActions}\n${appConversationActions}`;
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
  routeSources,
  'app.post("/api/session/delete"',
  "中心服务缺少 /api/session/delete 路由。",
);
assertIncludes(
  routeSources,
  "SESSION_DELETE_INVALID",
  "会话删除接口缺少空 sessionId 错误处理。",
);
assertIncludes(
  sessionDeleteDomainSource,
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
    sessionDeleteDomainSource + sessionRepository,
    fragment,
    `会话删除缺少相关事实表清理：${fragment}`,
  );
});
assertIncludes(
  frontendStoreSource,
  "async deleteConversation(sessionId: string): Promise<void>",
  "前端 store 缺少真实 deleteConversation 动作。",
);
assertIncludes(
  frontendStoreSource,
  'await this.requireRealtimeRequest<',
  "前端 store 删除会话没有调用实时请求入口。",
);
assertIncludes(
  frontendStoreSource,
  '"session.delete"',
  "前端 store 删除会话没有调用 /session.delete 实时接口。",
);
assertIncludes(
  frontendStoreSource,
  "await this.loadNavigationData();",
  "前端 store 删除会话后没有刷新导航数据。",
);
assertIncludes(
  frontendStoreSource,
  "this.sessionDetail = null;",
  "前端 store 删除当前会话后没有清空会话详情。",
);
assertIncludes(
  frontendStoreSource,
  "this.lastError = error instanceof Error",
  "前端 store 删除失败没有写入可见错误状态。",
);
assertIncludes(
  frontendStoreSource,
  'error.code === "SESSION_NOT_FOUND"',
  "实时事件刷新已删除会话详情时必须识别 SESSION_NOT_FOUND。",
);
assertIncludes(
  frontendStoreSource,
  "clearDeletedActiveSessionState()",
  "前端缺少清理已删除当前会话本地状态的统一函数。",
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
  frontendStoreSource,
  "deleteConversationPlaceholder",
  "前端 store 仍保留删除占位函数。",
);
assertIncludes(
  routeSources,
  'app.post("/api/project/delete"',
  "中心服务缺少 /api/project/delete 路由。",
);
assertIncludes(
  routeSources,
  "PROJECT_DELETE_INVALID",
  "项目删除接口缺少空 projectId 错误处理。",
);
assertIncludes(
  sessionDeleteDomainSource,
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
    sessionDeleteDomainSource + sessionRepository,
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
  frontendStoreSource,
  "async deleteProject(projectId: string): Promise<void>",
  "前端 store 缺少真实 deleteProject 动作。",
);
assertIncludes(
  frontendStoreSource,
  "removeDeletedProjectFromLocalState(projectId: string): boolean",
  "前端 store 缺少项目删除后的本地状态收尾函数。",
);
[
  "this.projects = this.projects.filter",
  "this.sessions = this.sessions.filter",
  "this.expandedProjectIds = this.expandedProjectIds.filter",
  "this.composerEditFiles = []",
].forEach((fragment) => {
  assertIncludes(
    frontendStoreSource,
    fragment,
    `前端项目删除本地收尾缺少：${fragment}`,
  );
});
assertIncludes(
  frontendStoreSource,
  'error.code === "PROJECT_NOT_FOUND"',
  "前端项目删除遇到中心服务已删除时必须继续清理本地残留。",
);
assertIncludes(
  frontendStoreSource,
  "CenterApiError",
  "前端项目删除需要识别中心服务业务错误码。",
);
assertNotIncludes(
  frontendStoreSource,
  "this.projectCapabilitySummary =",
  "projectCapabilitySummary 是 Pinia getter，不能在删除项目或会话时直接赋值。",
);
assertIncludes(
  frontendStoreSource,
  '"project.delete"',
  "前端 store 删除项目没有调用 /project.delete 实时接口。",
);
assertIncludes(
  frontendStoreSource,
  "requestDeleteProject(project",
  "前端 store 缺少项目删除确认动作。",
);
assertIncludes(
  chatPage,
  "appStore.requestDeleteProject(group.project)",
  "对话页项目删除按钮没有调用带确认的项目删除动作。",
);
assertNotIncludes(
  frontendStoreSource,
  "deleteProjectPlaceholder",
  "前端 store 仍保留项目删除占位函数。",
);

console.log("会话和项目删除回归检查通过。");
