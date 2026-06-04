/**
 * 用户反馈回归检查。
 *
 * 用途：锁定桌面端和浏览器端近期反馈的 UI 退化点。
 * 关键逻辑：只读取前端源码做静态检查，不启动服务、不修改业务数据。
 * 参数：无。
 * 返回值：检查通过时退出码为 0；发现反馈项未修复时退出码为 1。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * readProjectFile：读取项目内文本文件。
 *
 * @param {string} pathInProject 项目相对路径。
 * @returns {string} 文件内容。
 */
function readProjectFile(pathInProject) {
  return readFileSync(
    join(
      process.cwd(),
      pathInProject,
    ),
    "utf-8",
  );
}

// mainViewOnlySource: 工作台页面源码，覆盖桌面端和浏览器端主 UI 外壳。
const mainViewOnlySource = readProjectFile("apps/frontend/src/views/MainView.vue");
// chatPageSource: 对话页真实入口源码，承载对话导航、输入区和轮次时间。
const chatPageSource = readProjectFile("apps/frontend/src/views/Chat/RouterIndex.vue");
// managementPageSources: 顶部管理页真实路由入口源码，入口文件直接承载供应商、插件、MCP、skill 等页面内容。
const managementPageSources = [
  "apps/frontend/src/views/AgentManagement/RouterIndex.vue",
  "apps/frontend/src/views/Providers/RouterIndex.vue",
  "apps/frontend/src/views/Proxies/RouterIndex.vue",
  "apps/frontend/src/views/Runtimes/RouterIndex.vue",
  "apps/frontend/src/views/Usage/RouterIndex.vue",
  "apps/frontend/src/views/Plugins/RouterIndex.vue",
  "apps/frontend/src/views/Mcp/RouterIndex.vue",
  "apps/frontend/src/views/Skills/RouterIndex.vue",
  "apps/frontend/src/views/Center/RouterIndex.vue",
].map((pathInProject) => readProjectFile(pathInProject)).join("\n");
// projectCapabilityDialogSource: 项目能力详情弹框源码，页面拆分后承载项目级能力说明和不可用原因。
const projectCapabilityDialogSource = readProjectFile("apps/frontend/src/views/Chat/dialogs/ProjectCapabilityDialog.vue");
// mainViewSource: 回归检查合并主页面、页面宿主和关键弹框，避免页面拆分后误判能力缺失。
const mainViewSource = `${mainViewOnlySource}\n${chatPageSource}\n${managementPageSources}\n${projectCapabilityDialogSource}`;
// storeSource: 前端状态容器源码，覆盖连接状态和桌面壳状态同步。
const storeSource = readProjectFile("apps/frontend/src/stores/app.ts");
// managementActionsSource: 管理页动作拆分源码，覆盖供应商、插件、MCP 和 skill 的真实中心服务动作。
const managementActionsSource = readProjectFile("apps/frontend/src/stores/app-management-actions.ts");
// storeHelpersSource: store 辅助函数源码，覆盖供应商模型刷新草稿解析等页面无关逻辑。
const storeHelpersSource = readProjectFile("apps/frontend/src/stores/app-helpers.ts");
// apiClientSource: API 客户端源码，覆盖插件、MCP 和 skill 管理页是否接入中心服务。
const apiClientSource = readProjectFile("packages/api-client/src/index.ts");
// centerSource: 中心服务路由源码，覆盖扩展管理接口是否真实存在。
const centerSource = readProjectFile("services/center/src/api-routes.ts");
// combinedStoreSource: store 主体和管理动作合并事实源，避免拆分文件后误判功能缺失。
const combinedStoreSource = `${storeSource}\n${managementActionsSource}\n${storeHelpersSource}`;

/**
 * fail：记录检查失败原因。
 *
 * @param {string} message 失败说明。
 * @returns {void}
 */
function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

/**
 * assertIncludes：检查源码必须包含指定文本。
 *
 * @param {string} source 源码文本。
 * @param {string} pattern 必须存在的文本。
 * @param {string} message 缺失时的失败说明。
 * @returns {void}
 */
function assertIncludes(
  source,
  pattern,
  message,
) {
  if (!source.includes(pattern)) {
    fail(message);
  }
}

/**
 * assertNotIncludes：检查源码不能包含指定文本。
 *
 * @param {string} source 源码文本。
 * @param {string} pattern 禁止出现的文本。
 * @param {string} message 出现时的失败说明。
 * @returns {void}
 */
function assertNotIncludes(
  source,
  pattern,
  message,
) {
  if (source.includes(pattern)) {
    fail(message);
  }
}

/**
 * assertNotMatches：检查源码不能匹配指定正则。
 *
 * @param {string} source 源码文本。
 * @param {RegExp} pattern 禁止匹配的正则。
 * @param {string} message 出现时的失败说明。
 * @returns {void}
 */
function assertNotMatches(
  source,
  pattern,
  message,
) {
  if (pattern.test(source)) {
    fail(message);
  }
}

/**
 * extractFunctionBody：按函数名提取源码中的函数体。
 *
 * @param {string} source 源码文本。
 * @param {string} functionName 函数名。
 * @returns {string} 函数体文本；未找到时返回空字符串。
 */
function extractFunctionBody(
  source,
  functionName,
) {
  const declarationPattern = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function\\s+)?${functionName}\\s*\\(`, "u");
  const match = declarationPattern.exec(source);
  const nameIndex = match?.index ?? -1;
  if (nameIndex < 0) {
    fail(`未找到函数：${functionName}`);
    return "";
  }

  const bodyStart = source.indexOf("{", nameIndex);
  if (bodyStart < 0) {
    fail(`函数缺少函数体：${functionName}`);
    return "";
  }

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index + 1);
      }
    }
  }

  fail(`函数体括号未闭合：${functionName}`);
  return "";
}

// createNormalSessionBody: 点击新增普通对话入口的动作体，必须只进入本地草稿。
const createNormalSessionBody = extractFunctionBody(storeSource, "createNormalSession");
// createProjectConversationBody: 点击新增项目对话入口的动作体，必须只进入本地草稿。
const createProjectConversationBody = extractFunctionBody(storeSource, "createProjectConversationForProject");
// ensureSessionForSendingBody: 发送前获取真实会话的动作体，不能在消息发送成功前插入左侧历史列表。
const ensureSessionForSendingBody = extractFunctionBody(storeSource, "ensureSessionForSending");
const chatHelpersSource = readProjectFile("apps/frontend/src/views/Chat/chat-view-helpers.ts");
// formatTurnTimeFooterBody: 轮次末尾时间文案，只允许已结束轮次显示。
const formatTurnTimeFooterBody = extractFunctionBody(chatHelpersSource, "formatTurnTimeFooter");

assertIncludes(
  mainViewSource,
  "center-service",
  "工作台菜单必须保留中心服务页面键值，桌面端需要展示六项顶部菜单。",
);
assertIncludes(
  mainViewSource,
  "canManageCenterService",
  "中心服务页面入口必须受桌面壳能力控制，浏览器端不能展示中心服务管理入口。",
);
assertIncludes(
  mainViewSource,
  "formatConnectionState",
  "连接状态必须通过中文格式化函数展示，不能直接显示 stopped/open/retrying。",
);
assertIncludes(
  mainViewSource,
  "插件",
  "顶部菜单必须包含插件管理入口。",
);
assertIncludes(
  mainViewSource,
  "MCP",
  "顶部菜单必须包含 MCP 管理入口。",
);
assertIncludes(
  mainViewSource,
  "skill",
  "顶部菜单必须包含 skill 管理入口。",
);
assertIncludes(
  mainViewSource,
  "agent-management",
  "顶部菜单必须包含智能体管理页面键值。",
);
assertIncludes(
  mainViewSource,
  "智能体管理",
  "桌面端和桌面 Web 顶部菜单必须包含“智能体管理”。",
);
assertIncludes(
  mainViewSource,
  "主智能体",
  "智能体管理页必须说明主智能体管理语义。",
);
assertIncludes(
  mainViewSource,
  "长期智能体",
  "智能体管理页必须说明长期智能体管理语义。",
);
assertIncludes(
  mainViewSource,
  "project-capability-dialog",
  "项目级插件/MCP/skill 必须通过项目能力详情弹框展示。",
);
assertIncludes(
  mainViewSource,
  "openProjectCapabilityDialog",
  "对话页必须只保留项目能力详情入口按钮或小摘要。",
);
assertIncludes(
  mainViewSource,
  "项目能力详情",
  "项目能力弹框标题必须明确为项目能力详情。",
);
assertIncludes(
  mainViewSource,
  "不在全局插件 / MCP / skill 页管理",
  "项目能力弹框必须说明项目级能力不在全局插件/MCP/skill页管理。",
);
assertIncludes(
  mainViewSource,
  "不可用原因",
  "项目能力弹框必须展示不可用原因字段或空状态说明。",
);
assertNotIncludes(
  mainViewSource,
  "class=\"project-capability-panel\"",
  "项目级插件/MCP/skill 不能常驻占用主对话内容大块区域。",
);
assertNotIncludes(
  mainViewSource,
  "composer-provider-select",
  "输入框内部不能展示供应商选择，供应商只能作为模型来源或会话设置说明。",
);
assertIncludes(
  mainViewSource,
  "composer-model-select",
  "输入区必须提供模型选择。",
);
assertIncludes(
  mainViewSource,
  "composer-mode-select",
  "输入区必须保留执行模式选择。",
);
assertIncludes(
  mainViewSource,
  "composerContextUsageText",
  "输入区必须展示当前窗口上下文用量。",
);
assertIncludes(
  mainViewSource,
  "composer-context-usage",
  "输入区必须使用稳定样式展示上下文用量。",
);
assertNotIncludes(
  mainViewSource,
  "文件上下文",
  "输入区不能继续展示独立文件上下文按钮。",
);
assertIncludes(
  mainViewSource,
  "composer-reasoning-select",
  "输入区必须提供推理深度选择。",
);
assertNotIncludes(
  chatPageSource,
  "composer-model-hint",
  "对话输入区底部不能继续展示模型来源说明。",
);
assertNotIncludes(
  chatPageSource,
  "模型来源：该供应商未提供模型列表接口或当前刷新失败",
  "对话输入区底部不能继续展示供应商未提供模型列表的可见说明。",
);
assertIncludes(
  mainViewSource,
  "当前对话内等待上一项处理",
  "排队中状态必须说明只表示当前对话内等待上一项处理。",
);
assertIncludes(
  mainViewSource,
  "多个对话框可并发执行",
  "任务状态说明必须明确多个对话框或页签可并发执行。",
);
assertIncludes(
  mainViewSource,
  "当前对话当前轮次",
  "引导/审批/需要用户确认说明必须限定在当前对话当前轮次。",
);
assertIncludes(
  storeSource,
  "selectedProviderId",
  "状态容器可以保存中心服务后续发送使用的供应商来源，但输入框内部不能直接展示供应商。",
);
assertIncludes(
  storeSource,
  "selectedModel",
  "状态容器必须保存当前会话发送前模型选择。",
);
assertIncludes(
  storeSource,
  "applyDefaultComposerModelSettings",
  "状态容器必须根据启用供应商和默认模型初始化输入区模型选择。",
);
assertIncludes(
  storeSource,
  "await this.loadProviders();",
  "启动流程必须加载供应商，确保输入区模型选择有默认来源。",
);
assertIncludes(
  storeSource,
  "await this.loadNavigationData();",
  "启动流程必须加载会话和项目导航数据。",
);
assertIncludes(
  storeSource,
  "this.applyDefaultComposerModelSettings();",
  "供应商列表刷新后必须同步输入区默认供应商和模型。",
);
assertIncludes(
  storeSource,
  "composerSelectedModelOptions",
  "状态容器必须为输入区模型选择提供模型列表来源。",
);
assertIncludes(
  storeSource,
  "composerSelectedModelContextWindowTokens",
  "状态容器必须为输入区上下文用量提供模型窗口上限。",
);
assertIncludes(
  storeSource,
  "contextUsedTokens",
  "状态容器必须保存当前窗口已使用上下文数量。",
);
assertIncludes(
  combinedStoreSource,
  "countComposerContextTokens",
  "当前窗口上下文用量必须通过中心服务 tokenizer 读取。",
);
assertIncludes(
  storeSource,
  "buildProviderModelRefreshDraft",
  "行级刷新模型列表必须按当前供应商构造负载，不能误用其他供应商草稿。",
);
assertIncludes(
  combinedStoreSource,
  "draft.providerId === provider.providerId",
  "只有表单正在编辑当前供应商时，才能使用表单里的手填模型窗口配置。",
);
assertIncludes(
  storeSource,
  "pendingSessionDraft",
  "新增对话必须先进入本地待发送草稿，不能立即创建中心服务可见会话。",
);
assertIncludes(
  storeSource,
  "startNewNormalConversationDraft",
  "普通对话新增入口必须启动本地草稿。",
);
assertIncludes(
  storeSource,
  "startProjectConversationDraft",
  "项目对话新增入口必须启动本地草稿。",
);
assertIncludes(
  storeSource,
  "ensureSessionForSending",
  "真实发送前必须按草稿创建会话并取得 sessionId。",
);
assertNotIncludes(
  storeSource,
  "async createNormalSession(): Promise<void> {\n            const session = await this.api().createSession",
  "点击新增普通对话不能立即调用 createSession。",
);
assertNotIncludes(
  createNormalSessionBody,
  "this.sessions = [",
  "点击新增普通对话不能向 sessions 列表插入任何可见历史项。",
);
assertNotIncludes(
  createNormalSessionBody,
  "this.api().createSession",
  "点击新增普通对话动作体不能调用中心服务 createSession。",
);
assertNotIncludes(
  storeSource,
  "async createProjectConversationForProject(project: ProjectRecord): Promise<void> {\n            const projectName = project.alias ?? project.displayName;",
  "点击新增项目对话不能立即调用 createSession，也不能用别名替代文件夹名。",
);
assertNotIncludes(
  createProjectConversationBody,
  "this.sessions = [",
  "点击新增项目对话不能向 sessions 列表插入任何可见历史项。",
);
assertNotIncludes(
  createProjectConversationBody,
  "this.api().createSession",
  "点击新增项目对话动作体不能调用中心服务 createSession。",
);
assertNotIncludes(
  ensureSessionForSendingBody,
  "this.sessions = [\n                session,\n                ...this.sessions,\n            ];",
  "真实消息发送成功前不能把刚创建的会话插入左侧历史列表。",
);
assertNotMatches(
  ensureSessionForSendingBody,
  /this\.sessions\s*=\s*\[\s*session,\s*\.\.\.this\.sessions,\s*\]/u,
  "发送流程不能在消息真实发送成功前把新会话插入可见历史列表。",
);
assertIncludes(
  mainViewSource,
  "conversation-time-node",
  "对话导航行右侧必须展示时间节点。",
);
assertIncludes(
  mainViewSource,
  "sessionUserPreview",
  "对话行 hover 必须能看到用户发出了什么。",
);
assertIncludes(
  mainViewSource,
  "active-turn-elapsed",
  "当前轮次未结束时必须在输入框上方固定显示耗时。",
);
assertIncludes(
  mainViewSource,
  "turn-time-footer",
  "已结束轮次时间必须展示在对话内容本轮最后面。",
);
assertNotIncludes(
  formatTurnTimeFooterBody,
  "进行中",
  "运行中轮次的消息内容尾部不能显示“结束 进行中”。",
);
assertNotIncludes(
  formatTurnTimeFooterBody,
  "activeTurnElapsedText",
  "运行中轮次耗时只能固定显示在输入框上方，不能重复拼到消息内容尾部。",
);
assertIncludes(
  mainViewSource,
  "turn.endedAt",
  "轮次时间尾注必须显式要求轮次已结束后才展示。",
);
assertIncludes(
  mainViewSource,
  "projectTooltipContent",
  "项目名称缺失时必须通过 tooltip 或详情展示项目 ID。",
);
assertIncludes(
  storeSource,
  "plugin.scope === \"project\" && plugin.projectId === projectId",
  "项目能力弹框中的插件必须按当前项目 projectId 精确筛选。",
);
assertNotIncludes(
  storeSource,
  "plugin.scope === \"project\" || plugin.source === \"project-local\"",
  "项目能力弹框不能用 scope/source 候选条件猜测插件项目归属。",
);
assertIncludes(
  storeSource,
  "globalPlugins",
  "顶部插件管理页必须通过全局插件 getter 过滤项目级能力。",
);
assertIncludes(
  storeSource,
  "plugin.projectId === null",
  "全局插件 getter 必须排除带 projectId 的项目级插件。",
);
assertIncludes(
  storeSource,
  "plugin.source !== \"project-local\"",
  "全局插件 getter 必须排除 project-local 插件。",
);
assertIncludes(
  storeSource,
  "globalMcpConfigs",
  "顶部 MCP 管理页必须通过全局配置 getter 过滤项目级能力。",
);
assertIncludes(
  storeSource,
  "globalSkills",
  "顶部 skill 管理页必须通过全局 skill getter 过滤项目级能力。",
);
assertIncludes(
  storeSource,
  "return provider.defaultModel || savedModels[0] || \"\";",
  "模型默认值为空时必须使用当前供应商模型列表第一项。",
);
assertIncludes(
  chatPageSource,
  "...summary.plugins",
  "项目能力弹框必须使用结构化能力项，不能硬编码伪造启用状态和不可用原因。",
);
assertIncludes(
  chatPageSource,
  "...summary.mcpServers",
  "项目能力弹框必须使用结构化 MCP 能力项。",
);
assertIncludes(
  chatPageSource,
  "...summary.skills",
  "项目能力弹框必须使用结构化 skill 能力项。",
);
assertNotIncludes(
  mainViewSource,
  "status: \"启用\"",
  "项目能力弹框不能把所有能力硬编码为启用。",
);
assertIncludes(
  mainViewSource,
  "appStore.globalPlugins",
  "插件全局管理页只能渲染全局插件。",
);
assertIncludes(
  mainViewSource,
  "appStore.globalMcpConfigs",
  "MCP 全局管理页只能渲染全局配置。",
);
assertIncludes(
  mainViewSource,
  "appStore.globalSkills",
  "skill 全局管理页只能渲染全局 skill。",
);
assertNotIncludes(
  mainViewSource,
  "{{ appStore.runtime.clientType }}",
  "顶部不能直接显示 desktop-shell、web-local 等英文客户端类型。",
);
assertNotIncludes(
  mainViewSource,
  "formatClientType(",
  "顶部不应展示桌面端、本机 Web 等端类型标志，只保留连接状态。",
);
assertNotIncludes(
  mainViewOnlySource,
  "本机 Web",
  "顶部不应展示本机 Web 端类型标志。",
);
assertNotIncludes(
  extractFunctionBody(mainViewOnlySource, "formatConnectionState"),
  "桌面端",
  "顶部不应展示桌面端类型标志。",
);
assertNotIncludes(
  mainViewSource,
  "{{ appStore.connectionState }}",
  "顶部和对话区不能直接显示 stopped 等英文连接状态。",
);
assertIncludes(
  mainViewSource,
  "theme-icon",
  "主题切换按钮必须使用图标样式标记，不能只显示亮色/暗黑文字。",
);
assertNotIncludes(
  mainViewSource,
  "{{ appStore.themeMode === \"dark\" ? \"亮色\" : \"暗黑\" }}",
  "主题切换按钮不能显示“亮色”或“暗黑”文字。",
);
assertIncludes(
  mainViewSource,
  "executionModeOptions",
  "执行模式下拉必须集中声明完整选项和解释，不能只写一个全自动选项。",
);
assertIncludes(
  mainViewSource,
  "建议模式",
  "执行模式下拉必须包含建议模式。",
);
assertIncludes(
  mainViewSource,
  "自动编辑",
  "执行模式下拉必须包含自动编辑。",
);
assertIncludes(
  mainViewSource,
  "全自动",
  "执行模式下拉必须包含全自动。",
);
assertIncludes(
  mainViewSource,
  "reasoningEffortOptions",
  "推理深度下拉必须集中声明完整中文选项和解释，不能只显示 medium。",
);
assertNotIncludes(
  mainViewSource,
  "label=\"medium\"",
  "推理深度下拉不能直接显示 medium 英文值。",
);
assertIncludes(
  storeSource,
  "connectionState: \"stopped\"",
  "状态容器可以保存协议态 stopped，但展示层必须做中文格式化。",
);
assertIncludes(
  combinedStoreSource,
  "loadPlugins",
  "前端必须提供插件管理加载动作。",
);
assertIncludes(
  combinedStoreSource,
  "saveMcpConfig",
  "前端必须提供 MCP 配置保存动作。",
);
assertIncludes(
  combinedStoreSource,
  "installSkill",
  "前端必须提供 skill 安装动作。",
);
assertIncludes(
  apiClientSource,
  "listPlugins(",
  "API 客户端必须接入插件列表接口。",
);
assertIncludes(
  apiClientSource,
  "listMcpConfigs(",
  "API 客户端必须接入 MCP 列表接口。",
);
assertIncludes(
  apiClientSource,
  "listSkills(",
  "API 客户端必须接入 skill 列表接口。",
);
assertIncludes(
  centerSource,
  "/api/mcp/list",
  "中心服务必须提供 MCP 列表接口，前端管理页不能只保存不展示。",
);
