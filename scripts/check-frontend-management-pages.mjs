/**
 * 前端管理页面能力检查。
 *
 * 用途：防止供应商、代理、运行环境和用量统计页面退化为只有标题的空页面。
 * 关键逻辑：检查页面、状态容器和 API 客户端是否存在明确中心服务协议调用。
 * 参数：无。
 * 返回值：检查通过时正常退出；缺少任一能力信号时返回非零退出码。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// mainViewPath: 工作台页面源码路径。
const mainViewPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "MainView.vue",
);
// workspacePageHostPath: 顶部管理页路由入口源码路径。
const workspacePageHostPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "Providers",
  "RouterIndex.vue",
);
// storePath: 前端状态容器源码路径。
const storePath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "stores",
  "app.ts",
);
// storeManagementActionsPath: 管理页 actions 拆分文件路径。
const storeManagementActionsPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "stores",
  "app-management-actions.ts",
);
// storeHelpersPath: 管理页 helper 拆分文件路径。
const storeHelpersPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "stores",
  "app-helpers.ts",
);
// apiClientPath: 中心服务 API 客户端源码路径。
const apiClientPath = join(
  process.cwd(),
  "packages",
  "api-client",
  "src",
  "index.ts",
);
// centerServicePath: 中心服务源码路径，用于检查服务端协议落地。
const centerServicePath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "index.ts",
);
// centerApiRoutesPath: 中心服务 API 路由拆分文件路径。
const centerApiRoutesPath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "api",
  "api-routes.ts",
);
// centerProviderRoutesPath: 供应商、代理、运行环境和模型网关路由拆分文件路径。
const centerProviderRoutesPath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "api",
  "provider-routes.ts",
);
// centerProviderDomainPath: 中心服务供应商和代理领域文件路径。
const centerProviderDomainPath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "provider-domain.ts",
);
// centerUsageDomainPath: 中心服务用量领域文件路径。
const centerUsageDomainPath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "usage-domain.ts",
);
// centerAgentDomainPath: 中心服务智能体领域文件路径，用于检查主智能体编辑和动态能力说明。
const centerAgentDomainPath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "agent-domain.ts",
);
// desktopShellMainPath: 桌面壳主进程源码路径，用于确认桌面壳启动新版中心服务。
const desktopShellMainPath = join(
  process.cwd(),
  "apps",
  "desktop-shell",
  "src",
  "main.ts",
);
// desktopDevScriptPath: 桌面端开发脚本路径，用于确认开发期没有绕回旧中心服务。
const desktopDevScriptPath = join(
  process.cwd(),
  "scripts",
  "dev-desktop-shell.mjs",
);
// routerPath: 前端路由源码路径，用于确认顶部菜单页面有独立 URL。
const routerPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "router.ts",
);
// managementDialogShellPath: 管理配置弹框共享外壳源码路径。
const managementDialogShellPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "components",
  "ManagementDialogShell.vue",
);

// mainViewOnly: 工作台主页面源码文本，用于检查对话页和外壳。
const mainViewOnly = readFileSync(
  mainViewPath,
  "utf-8",
);
// chatPagePath: 对话页真实入口源码路径，执行模式说明已经从公共壳拆到该页面。
const chatPagePath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "Chat",
  "RouterIndex.vue",
);
// chatPageOnly: 对话页入口源码文本，用于检查输入区执行模式下拉说明。
const chatPageOnly = readFileSync(
  chatPagePath,
  "utf-8",
);
// chatConversationPanelOnly: 对话主体组件源码，输入区和执行模式下拉已从页面入口拆到该组件。
const chatConversationPanelOnly = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    "Chat",
    "components",
    "ChatConversationPanel.vue",
  ),
  "utf-8",
);
// chatOptionsOnly: 对话选项源码，执行模式说明文案在这里统一维护。
const chatOptionsOnly = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    "Chat",
    "chat-view-options.ts",
  ),
  "utf-8",
);
// managementDialogShellOnly: 共享弹框外壳源码，用于检查默认宽度和滚动布局。
const managementDialogShellOnly = readFileSync(
  managementDialogShellPath,
  "utf-8",
);
// workspacePageHost: 供应商真实路由入口源码文本，用于检查真实表单、列表和操作按钮。
const workspacePageHost = readFileSync(
  workspacePageHostPath,
  "utf-8",
);
// pageComponentPaths: 顶部管理页必须直接承载业务的路由入口组件。
const pageComponentPaths = [
  "apps/frontend/src/views/AgentManagement/RouterIndex.vue",
  "apps/frontend/src/views/Providers/RouterIndex.vue",
  "apps/frontend/src/views/Proxies/RouterIndex.vue",
  "apps/frontend/src/views/Runtimes/RouterIndex.vue",
  "apps/frontend/src/views/Usage/RouterIndex.vue",
  "apps/frontend/src/views/Plugins/RouterIndex.vue",
  "apps/frontend/src/views/Mcp/RouterIndex.vue",
  "apps/frontend/src/views/Skills/RouterIndex.vue",
  "apps/frontend/src/views/Center/RouterIndex.vue",
];
// allManagementPages: 管理页真实入口合并文本，用于检查能力信号已经分散到各页面。
const allManagementPages = pageComponentPaths.map((relativePath) => {
  return readFileSync(
    join(
      process.cwd(),
      relativePath,
    ),
    "utf-8",
  );
}).join("\n");
// managementPageError: 独立页面通过 managementError computed 读取当前页面错误状态；保留旧检查关键字兼容回归语义。
const managementPageError = allManagementPages.includes("const managementError = computed");
// mainView: 管理页能力检查使用主页面和页面宿主合并文本，适配管理页面已从 MainView 拆出的架构。
const mainView = `${mainViewOnly}\n${chatPageOnly}\n${chatConversationPanelOnly}\n${chatOptionsOnly}\n${workspacePageHost}\n${allManagementPages}\n${managementPageError ? "managementPageError" : ""}`;
// store: 用于检查页面是否通过状态容器调用 API 客户端；P01 已把管理动作和 helper 拆出，因此这里合并当前职责文件。
const store = [
  storePath,
  storeManagementActionsPath,
  storeHelpersPath,
].map((sourcePath) => {
  return readFileSync(
    sourcePath,
    "utf-8",
  );
}).join("\n");
// apiClient: 用于检查协议是否集中在 API 客户端。
const apiClient = readFileSync(
  apiClientPath,
  "utf-8",
);
// centerService: 用于检查中心服务不是只声明接口而没有落地行为；P01/P02 已把路由和领域逻辑拆出，因此这里合并当前职责文件。
const centerService = [
  centerServicePath,
  centerApiRoutesPath,
  centerProviderRoutesPath,
  centerProviderDomainPath,
  centerUsageDomainPath,
  centerAgentDomainPath,
].map((sourcePath) => {
  return readFileSync(
    sourcePath,
    "utf-8",
  );
}).join("\n");
// desktopShellMain: 桌面壳主进程源码文本。
const desktopShellMain = readFileSync(
  desktopShellMainPath,
  "utf-8",
);
// desktopDevScript: 桌面端开发脚本源码文本。
const desktopDevScript = readFileSync(
  desktopDevScriptPath,
  "utf-8",
);
// routerSource: 前端路由源码文本。
const routerSource = readFileSync(
  routerPath,
  "utf-8",
);

/**
 * expectations: 管理页必须具备的中心服务功能信号。
 */
const expectations = [
  [
    apiClient,
    "listProviders(",
    "API 客户端必须封装供应商列表接口。",
  ],
  [
    store,
    "loadProviders",
    "前端状态容器必须加载供应商列表。",
  ],
  [
    store,
    "agentDraft",
    "前端状态容器必须提供智能体管理草稿。",
  ],
  [
    store,
    "saveAgent",
    "智能体管理页必须支持创建和修改长期智能体。",
  ],
  [
    store,
    "disableAgent",
    "智能体管理页必须支持停用长期智能体。",
  ],
  [
    store,
    "deleteAgent",
    "智能体管理页必须支持删除长期智能体。",
  ],
  [
    mainView,
    "saveProvider",
    "供应商页面必须支持新增或修改配置。",
  ],
  [
    mainView,
    "toggleProvider",
    "供应商页面必须支持启用停用。",
  ],
  [
    mainView,
    "refreshProviderModels",
    "供应商页面必须支持刷新模型或推理深度。",
  ],
  [
    mainView,
    "fetchProviderModelsForDialog",
    "供应商弹框必须提供获取模型按钮，不能只依赖手填模型列表。",
  ],
  [
    mainView,
    "获取",
    "供应商弹框获取模型按钮必须使用用户可识别的“获取”文案。",
  ],
  [
    apiClient,
    "listProxies(",
    "API 客户端必须封装代理列表接口。",
  ],
  [
    store,
    "loadProxies",
    "前端状态容器必须加载代理列表。",
  ],
  [
    mainView,
    "saveProxy",
    "代理页面必须支持新增或修改代理。",
  ],
  [
    mainView,
    "setGlobalDefaultProxy",
    "代理页面必须支持设置或体现全局默认代理。",
  ],
  [
    apiClient,
    "listRuntimes(",
    "API 客户端必须封装运行环境列表接口。",
  ],
  [
    store,
    "loadRuntimes",
    "前端状态容器必须加载运行环境列表。",
  ],
  [
    mainView,
    "saveRuntime",
    "运行环境页面必须支持新增或修改环境。",
  ],
  [
    mainView,
    "setDefaultRuntime",
    "运行环境页面必须支持设置或体现默认环境。",
  ],
  [
    store,
    "loadUsageAggregate",
    "用量统计页面必须加载聚合统计。",
  ],
  [
    mainView,
    "usageFilters",
    "用量统计页面必须提供供应商、模型、项目/会话和时间范围筛选。",
  ],
  [
    mainView,
    "echarts/core",
    "用量统计页面必须引入 ECharts，不能只展示 JSON 列表。",
  ],
  [
    mainView,
    "usage-total-chart",
    "用量统计页面必须展示总量图表容器。",
  ],
  [
    mainView,
    "usage-provider-chart",
    "用量统计页面必须展示供应商维度图表容器。",
  ],
  [
    mainView,
    "usage-project-chart",
    "用量统计页面必须展示项目维度图表容器。",
  ],
  [
    mainView,
    "providerModelOptions",
    "供应商默认模型必须使用来自模型列表的下拉选项。",
  ],
  [
    mainView,
    "模型列表来源",
    "供应商页面必须说明默认模型选项来源。",
  ],
  [
    mainView,
    "refreshModelContextWindowsText",
    "供应商页面必须支持手填模型窗口上下文。",
  ],
  [
    store,
    "parseModelContextWindows",
    "前端状态容器必须把模型窗口 K 值转换为 token 数值。",
  ],
  [
    store,
    "buildProviderModelRefreshDraft",
    "供应商行级模型刷新必须按当前供应商构造负载，不能误用其他供应商草稿。",
  ],
  [
    store,
    "sortProviderModelsByNumericVersion",
    "前端状态容器必须按模型名数字段降序排序获取到的模型。",
  ],
  [
    store,
    "model.match(/\\d+(?:\\.\\d+)?/gu)",
    "前端模型排序必须从模型名任意位置匹配数字段，不能只匹配末尾数字。",
  ],
  [
    store,
    "return rightValue - leftValue",
    "前端模型排序必须按数字段降序排列，大数字模型排在前面。",
  ],
  [
    store,
    "fetchProviderModels",
    "前端状态容器必须封装供应商真实模型获取动作。",
  ],
  [
    apiClient,
    "fetchProviderModels(",
    "API 客户端必须封装供应商真实模型获取接口。",
  ],
  [
    centerService,
    "/api/provider/model-fetch",
    "中心服务必须提供供应商真实模型获取接口。",
  ],
  [
    centerService,
    "fetchProviderModelsFromUpstream",
    "中心服务必须通过供应商上游模型接口获取模型列表。",
  ],
  [
    centerService,
    "existingContextWindowByModel",
    "中心服务获取上游模型时必须保留用户已维护的模型上下文窗口。",
  ],
  [
    centerService,
    "DEFAULT_FETCHED_MODEL_CONTEXT_WINDOW_TOKENS",
    "中心服务必须为上游新增且未返回窗口的模型使用明确默认窗口。",
  ],
  [
    store,
    "draft.providerId === provider.providerId",
    "只有表单正在编辑当前供应商时才允许使用手填模型窗口配置。",
  ],
  [
    apiClient,
    "contextWindows",
    "API 客户端模型列表协议必须包含模型上下文窗口配置。",
  ],
  [
    centerService,
    "contextWindowTokens",
    "中心服务必须保存模型上下文窗口 token 数值。",
  ],
  [
    mainView,
    "主智能体不可删除",
    "智能体管理页必须说明主智能体不可删除。",
  ],
  [
    mainView,
    "agent-management-dialog",
    "智能体管理新增和编辑必须进入弹窗。",
  ],
  [
    mainView,
    "dialog-class=\"agent-management-dialog\"",
    "智能体管理弹窗默认宽度必须为 80vw。",
  ],
  [
    managementDialogShellOnly,
    'width: "80vw"',
    "管理配置弹框共享外壳默认宽度必须为 80vw。",
  ],
  [
    mainView,
    "<el-table",
    "智能体管理外层必须使用表格列表。",
  ],
  [
    mainView,
    "openEditAgentDialog(row)",
    "主智能体和长期智能体都必须可通过表格行进入编辑弹窗。",
  ],
  [
    centerService,
    "AGENT_DYNAMIC_CAPABILITY_BOUNDARY",
    "中心服务必须使用动态能力兼容说明，前端不再编辑能力边界。",
  ],
  [
    mainView,
    "confirmDeleteAgent",
    "智能体管理页必须在删除前展示影响确认。",
  ],
  [
    centerService,
    "/api/agent/delete",
    "中心服务必须提供长期智能体删除接口。",
  ],
  [
    centerService,
    "MAIN_AGENT_DELETE_FORBIDDEN",
    "中心服务必须显式禁止删除主智能体。",
  ],
  [
    mainView,
    "formatDisplayTime",
    "前端展示时间必须统一调用 YYYY-MM-DD HH:mm:ss 格式化函数。",
  ],
  [
    mainView,
    "formatUsageRecordForDisplay",
    "用量统计原始记录和聚合统计必须在展示前格式化时间字段，不能直接 JSON.stringify 原始对象。",
  ],
  [
    mainView,
    "project-capability-dialog",
    "项目对话页必须通过项目能力详情弹框展示项目级插件/MCP/skill。",
  ],
  [
    mainView,
    "project-capability-entry",
    "项目对话页必须只保留项目能力详情入口按钮或简短摘要。",
  ],
  [
    mainView,
    "appStore.globalPlugins",
    "插件全局管理页不能渲染项目级插件。",
  ],
  [
    store,
    "plugin.projectId === null",
    "全局插件 getter 必须排除带 projectId 的项目级插件。",
  ],
  [
    store,
    "plugin.source !== \"project-local\"",
    "全局插件 getter 必须排除 project-local 插件。",
  ],
  [
    mainView,
    "appStore.globalMcpConfigs",
    "MCP 全局管理页不能渲染项目级配置。",
  ],
  [
    mainView,
    "appStore.globalSkills",
    "skill 全局管理页不能渲染项目级 skill。",
  ],
  [
    mainView,
    "由打开项目目录扫描",
    "项目能力摘要为空时必须说明项目级能力由打开项目目录扫描，不在全局页管理。",
  ],
  [
    store,
    "projectCapabilitySummary",
    "前端状态容器必须提供当前项目级插件、MCP 和 skill 能力摘要。",
  ],
  [
    store,
    "providerModelOptions",
    "前端状态容器必须保存每个供应商刷新得到的模型列表。",
  ],
  [
    apiClient,
    "ProviderModelListView",
    "API 客户端必须定义供应商模型列表展示结构。",
  ],
  [
    apiClient,
    "listProviderModels(",
    "API 客户端必须封装供应商模型列表接口。",
  ],
  [
    centerService,
    "/api/provider/model-list",
    "中心服务必须提供已保存模型列表查询接口，供默认模型下拉使用。",
  ],
  [
    desktopShellMain,
    "services\", \"center\", \"src\", \"index.ts\"",
    "桌面壳开发期必须启动当前 services/center/src/index.ts，不允许指回旧中心服务。",
  ],
  [
    desktopDevScript,
    "@zhixin/desktop-shell",
    "桌面端开发脚本必须启动新版 desktop-shell 包。",
  ],
  [
    mainView,
    "全局扩展能力管理",
    "插件/MCP/skill 页面必须明确是全局扩展能力管理。",
  ],
  [
    mainView,
    "项目级能力只在项目对话中展示",
    "全局扩展管理页必须说明项目级能力边界。",
  ],
  [
    mainView,
    "任务状态",
    "右侧状态栏必须保留任务状态语义。",
  ],
  [
    store,
    "managementErrors",
    "管理页接口失败必须记录到页面错误状态，不能只变成未捕获 Promise。",
  ],
  [
    store,
    "recordManagementError",
    "管理页接口失败必须通过统一方法记录可见错误信息。",
  ],
  [
    store,
    "console.error",
    "管理页接口失败必须保留控制台排查信息，不能静默吞错。",
  ],
  [
    allManagementPages,
    "managementError",
    "管理页必须读取当前页面错误状态用于展示。",
  ],
  [
    mainView,
    "el-alert",
    "管理页接口失败必须在页面上显示可见错误信息。",
  ],
];

/**
 * providerUpdatePayloadFields: 供应商修改必须提交的页面表单字段。
 *
 * 来源：代码审查问题 2。
 * 含义：防止 updateProvider 只提交 enabled/defaultModel 等局部字段。
 * 格式：字段名数组。
 * 默认值：固定审查要求字段。
 * 约束：字段必须出现在 store 的 updateProvider 调用对象和 API 客户端入参中。
 */
const providerUpdatePayloadFields = [
  "providerName",
  "protocolPluginId",
  "protocolMode",
  "baseUrl",
  "defaultModel",
  "apiKey",
  "enabled",
  "capabilities",
  "proxyPolicy",
];

for (const [
  source,
  pattern,
  message,
] of expectations) {
  if (!source.includes(pattern)) {
    console.error(message);
    process.exitCode = 1;
  }
}

/**
 * assertIncludes：检查源码中必须存在的明确文本。
 *
 * @param source 源码文本。
 * @param pattern 必须存在的文本。
 * @param message 缺失时输出的错误说明。
 * @returns 没有返回值。
 */
function assertIncludes(
  source,
  pattern,
  message,
) {
  if (!source.includes(pattern)) {
    console.error(message);
    process.exitCode = 1;
  }
}

/**
 * assertNotIncludes：检查源码中不能存在的风险文本。
 *
 * @param source 源码文本。
 * @param pattern 禁止存在的文本。
 * @param message 存在时输出的错误说明。
 * @returns 没有返回值。
 */
function assertNotIncludes(
  source,
  pattern,
  message,
) {
  if (source.includes(pattern)) {
    console.error(message);
    process.exitCode = 1;
  }
}

// agentManagementPage: 智能体管理页面源码，用于检查本轮表格加弹窗和能力边界移除口径。
const agentManagementPage = readFileSync(
  join(
    process.cwd(),
    "apps/frontend/src/views/AgentManagement/RouterIndex.vue",
  ),
  "utf-8",
);

assertNotIncludes(
  agentManagementPage,
  "能力边界",
  "智能体管理页不能继续展示或编辑“能力边界”字段。",
);

assertNotIncludes(
  agentManagementPage,
  "capabilityBoundary",
  "智能体管理页不能继续绑定 capabilityBoundary 表单字段。",
);

/**
 * providerDialogBlock: 供应商配置弹框源码块。
 *
 * 来源：T08 复测失败。
 * 含义：新增和编辑必须使用同一个可见 80vw 弹框，不能只留下空 dialog 容器。
 * 格式：从供应商弹框开始标签到表单结束标签的源码片段。
 * 默认值：缺失时标记检查失败。
 * 约束：弹框内容保持稳定挂载，编辑入口必须在草稿写入后打开该弹框。
 */
const providerDialogBlock = extractRequiredBlock(
  workspacePageHost,
  "<ManagementDialogShell",
  "</ManagementDialogShell>",
  "供应商页面必须存在配置弹框。",
);
const openEditProviderDialogBlock = extractRequiredBlock(
  workspacePageHost,
  "function openEditProviderDialog",
  "void nextTick();",
  "供应商页面必须存在编辑弹框打开函数。",
);

assertIncludes(
  providerDialogBlock,
  "dialog-class=\"provider-config-dialog\"",
  "供应商新增和编辑弹框默认宽度必须为 80vw。",
);
assertIncludes(
  providerDialogBlock,
  "class=\"management-form\"",
  "供应商弹框必须包含真实配置表单，不能只渲染空容器。",
);
assertNotIncludes(
  providerDialogBlock,
  "destroy-on-close",
  "供应商配置弹框不能销毁内容，否则编辑入口可能只留下空 dialog 容器。",
);
assertIncludes(
  openEditProviderDialogBlock,
  "providerDialogVisible.value = true;",
  "供应商编辑入口必须先打开配置弹框，避免后续草稿兼容逻辑异常时只留下不可见空容器。",
);
assertIncludes(
  openEditProviderDialogBlock,
  "...defaultProviderCapabilities",
  "供应商编辑入口必须为旧记录补齐能力声明默认结构。",
);
assertIncludes(
  openEditProviderDialogBlock,
  "...defaultProviderProxyPolicy",
  "供应商编辑入口必须为旧记录补齐代理策略默认结构，避免展开空字段导致事件异常。",
);
assertIncludes(
  openEditProviderDialogBlock,
  "Array.isArray(providerModelOptions?.contextWindows)",
  "供应商编辑入口必须把模型窗口列表归一化为数组。",
);
assertIncludes(
  openEditProviderDialogBlock,
  "Array.isArray(providerModelOptions?.reasoningEfforts)",
  "供应商编辑入口必须把推理深度列表归一化为数组。",
);
assertNotIncludes(
  openEditProviderDialogBlock,
  "appStore.editProvider(provider);",
  "供应商编辑入口不能继续调用旧 store editProvider，否则旧记录缺 proxyPolicy 时会在事件处理器抛错。",
);
assertIncludes(
  workspacePageHost,
  "@click=\"openEditProviderDialog(provider)\"",
  "供应商列表行修改按钮必须调用编辑弹框入口。",
);

for (const pagePath of [
  "apps/frontend/src/views/Providers/RouterIndex.vue",
  "apps/frontend/src/views/Proxies/RouterIndex.vue",
  "apps/frontend/src/views/Runtimes/RouterIndex.vue",
  "apps/frontend/src/views/Plugins/RouterIndex.vue",
  "apps/frontend/src/views/Mcp/RouterIndex.vue",
  "apps/frontend/src/views/Skills/RouterIndex.vue",
]) {
  const pageSource = readFileSync(
    join(
      process.cwd(),
      pagePath,
    ),
    "utf-8",
  );
  assertIncludes(
    pageSource,
    "<ManagementDialogShell",
    `${pagePath} 必须把新增或编辑配置放入弹框。`,
  );
  assertIncludes(
    pageSource,
    "dialog-class=",
    `${pagePath} 的配置弹框默认宽度必须为 80vw。`,
  );
  const pageScrollIndex = pageSource.indexOf("class=\"page-scroll\"");
  const dialogIndex = pageSource.indexOf("<ManagementDialogShell");
  const formIndex = pageSource.indexOf("class=\"management-form\"");
  if (pageScrollIndex >= 0 && formIndex >= 0 && (dialogIndex < 0 || formIndex < dialogIndex)) {
    console.error(`${pagePath} 不能在页面滚动区常驻 management-form，新增或编辑表单必须进入弹框。`);
    process.exitCode = 1;
  }
}

const centerPageSource = readFileSync(
  join(
    process.cwd(),
    "apps/frontend/src/views/Center/RouterIndex.vue",
  ),
  "utf-8",
);
assertIncludes(
  centerPageSource,
  "center-service-form",
  "中心服务页必须进入后直接展示配置编辑面板。",
);
assertIncludes(
  centerPageSource,
  "选择中心目录",
  "中心服务页必须提供中心目录选择入口。",
);
assertNotIncludes(
  centerPageSource,
  "<el-dialog",
  "中心服务页不能再通过弹框维护本机配置。",
);

// tableManagementPagePaths: T10 覆盖的管理页必须继续使用 Element Plus el-table 展示主体信息。
const tableManagementPagePaths = [
  "apps/frontend/src/views/Providers/RouterIndex.vue",
  "apps/frontend/src/views/Proxies/RouterIndex.vue",
  "apps/frontend/src/views/Runtimes/RouterIndex.vue",
  "apps/frontend/src/views/Plugins/RouterIndex.vue",
  "apps/frontend/src/views/Mcp/RouterIndex.vue",
  "apps/frontend/src/views/Skills/RouterIndex.vue",
];

for (const pagePath of tableManagementPagePaths) {
  const pageSource = readFileSync(
    join(
      process.cwd(),
      pagePath,
    ),
    "utf-8",
  );
  assertIncludes(
    pageSource,
    "<el-table",
    `${pagePath} 的管理信息主体必须使用 Element Plus el-table，不能退化为普通列表或卡片。`,
  );
  assertIncludes(
    pageSource,
    "<el-table-column",
    `${pagePath} 的管理表格必须定义 el-table-column 表头。`,
  );
}

/**
 * extractRequiredBlock：抽取源码中指定起止片段。
 *
 * @param source 源码文本。
 * @param startText 起始文本。
 * @param endText 结束文本。
 * @param message 缺失时输出的错误说明。
 * @returns 抽取到的源码片段；缺失时返回空字符串并标记失败。
 */
function extractRequiredBlock(
  source,
  startText,
  endText,
  message,
) {
  const startIndex = source.indexOf(startText);
  if (startIndex < 0) {
    console.error(message);
    process.exitCode = 1;
    return "";
  }

  const endIndex = source.indexOf(endText, startIndex);
  if (endIndex < 0) {
    console.error(message);
    process.exitCode = 1;
    return "";
  }

  return source.slice(
    startIndex,
    endIndex + endText.length,
  );
}

// providerUpdateStoreBlock: 只抽取 saveProvider 内真正提交 updateProvider 的 payload，避免 createProvider 字段误判通过。
const providerUpdateStoreBlock = extractRequiredBlock(
  store,
  "await this.api().updateProvider({",
  "});",
  "前端状态容器必须存在 updateProvider 提交块。",
);
// providerUpdateClientBlock: 只抽取 API 客户端 updateProvider 方法，避免其他接口字段误判通过。
const providerUpdateClientBlock = extractRequiredBlock(
  apiClient,
  "updateProvider(payload: {",
  "return this.post(\"/api/provider/update\", payload);",
  "API 客户端必须存在 updateProvider 方法块。",
);
// providerDefaultModelFormBlock: 供应商默认模型字段源码块，用于防止无模型列表时退回普通输入框。
const providerDefaultModelFormBlock = extractRequiredBlock(
  mainView,
  "<el-form-item label=\"默认模型\">",
  "<small class=\"field-helper\">{{ providerModelSourceText }}</small>",
  "供应商页面必须存在默认模型表单字段。",
);
for (const field of providerUpdatePayloadFields) {
  assertIncludes(
    providerUpdateStoreBlock,
    field === "defaultModel" ? "defaultModel:" : `${field}:`,
    `供应商 updateProvider payload 必须包含 ${field} 字段。`,
  );
  assertIncludes(
    providerUpdateClientBlock,
    field,
    `API 客户端 updateProvider 入参必须包含 ${field} 字段。`,
  );
}

assertIncludes(
  providerDefaultModelFormBlock,
  "<el-select",
  "供应商默认模型字段必须使用 el-select 承载，不能使用普通输入框作为主控件。",
);
assertIncludes(
  providerDefaultModelFormBlock,
  "<el-option",
  "供应商默认模型下拉必须渲染来自 providerModelOptions 的 el-option。",
);
assertIncludes(
  providerDefaultModelFormBlock,
  "allow-create",
  "供应商默认模型下拉必须支持无模型列表时手动创建或输入模型名称。",
);
assertIncludes(
  providerDefaultModelFormBlock,
  "filterable",
  "供应商默认模型下拉必须支持按供应商模型列表筛选。",
);
assertIncludes(
  providerDefaultModelFormBlock,
  "default-first-option",
  "供应商默认模型可创建下拉必须支持回车选择或创建当前输入项。",
);
assertNotIncludes(
  providerDefaultModelFormBlock,
  "<el-input",
  "供应商默认模型字段不能在无模型列表时退回 el-input，否则 Windows 客户端会识别为编辑框。",
);

assertIncludes(
  centerService,
  "session_id = ?",
  "用量统计服务端必须按 usage_records.session_id 筛选会话 ID。",
);
assertNotIncludes(
  centerService,
  "void filters.sessionId",
  "用量统计不能保留 void filters.sessionId 伪功能。",
);
assertNotIncludes(
  centerService,
  ": {\n      providerId: input.providerId",
  "供应商不存在时不能 fallback 写入只有 providerId 的残缺配置。",
);
assertNotIncludes(
  centerService,
  "apiKeySha256",
  "供应商 API Key 不能只保存或回显 SHA-256 摘要字段。",
);
assertNotIncludes(
  centerService,
  "ProxyConfigRecord",
  "代理配置类型不能继续使用仅服务校验的密码摘要结构。",
);
assertNotIncludes(
  centerService,
  "existing?.passwordSha256",
  "代理密码为空时应保留中心服务 secret 引用，不能保留哈希摘要。",
);
assertNotIncludes(
  centerService,
  "proxy.passwordSha256",
  "代理列表接口不能通过密码摘要判断认证状态。",
);
assertIncludes(
  centerService,
  "apiKeySecretRef",
  "供应商配置必须使用中心服务可用且客户端不可见的 API Key secret 引用字段。",
);
assertNotIncludes(
  centerService,
  "apiKeySecretRef: undefined",
  "供应商列表接口必须白名单返回字段，不能把 secret 引用字段置空后混入响应结构。",
);
assertIncludes(
  centerService,
  "passwordSecretRef",
  "代理配置必须使用中心服务可用且客户端不可见的密码 secret 引用字段。",
);
assertIncludes(
  mainView,
  "value=\"SOCKS4\"",
  "网络代理页面必须提供 SOCKS4 协议选项。",
);
assertIncludes(
  mainView,
  "value=\"SOCKS4a\"",
  "网络代理页面必须提供 SOCKS4a 协议选项。",
);
assertIncludes(
  mainView,
  "v-model=\"appStore.proxyDraft.username\"",
  "网络代理页面必须恢复用户名输入。",
);
assertIncludes(
  mainView,
  "v-model=\"appStore.proxyDraft.password\"",
  "网络代理页面必须恢复密码输入。",
);
assertIncludes(
  mainView,
  "v-model=\"appStore.proxyDraft.clearAuth\"",
  "网络代理页面必须提供清除已保存认证的显式控件。",
);
assertIncludes(
  store,
  "clearAuth: this.proxyDraft.clearAuth",
  "代理保存必须提交 clearAuth，支持把已认证代理改回无认证代理。",
);
assertIncludes(
  apiClient,
  "clearAuth: boolean",
  "API 客户端代理保存协议必须包含 clearAuth 字段。",
);
assertIncludes(
  centerService,
  "removeSecretValue",
  "中心服务必须能在用户明确清除认证时删除代理密码 secret。",
);
assertIncludes(
  mainView,
  "v-model=\"appStore.providerDraft.proxyPolicy.mode\"",
  "供应商页面必须提供代理策略选择。",
);
assertIncludes(
  mainView,
  "value=\"use-specified\"",
  "供应商代理策略必须支持指定代理。",
);
assertIncludes(
  mainView,
  "v-model=\"appStore.providerDraft.proxyPolicy.proxyId\"",
  "供应商页面必须提供指定代理 ID 选择。",
);
assertIncludes(
  store,
  "note: proxy.note",
  "前端编辑或切换代理时必须保留代理备注，不能静默清空。",
);
assertIncludes(
  centerService,
  "note: proxy.note ?? \"\"",
  "中心服务代理列表必须返回备注并兼容旧配置缺省值。",
);
assertIncludes(
  centerService,
  "PROVIDER_NOT_FOUND",
  "供应商更新或删除不存在 providerId 时必须返回统一业务错误。",
);
assertNotIncludes(
  store,
  "supportsStreaming: true",
  "新建供应商 supportsStreaming 默认值必须为 false。",
);
assertNotIncludes(
  mainView,
  "placeholder=\"留空保存为全局配置\"",
  "全局 MCP 管理页不能继续提供项目 ID 输入入口。",
);
assertNotIncludes(
  mainView,
  "placeholder=\"留空安装为全局\"",
  "全局 skill 管理页不能继续提供项目 ID 输入入口。",
);
assertNotIncludes(
  mainView,
  "{{ session.updatedAt }}",
  "会话列表不能直接展示 ISO 时间，必须格式化。",
);
assertNotIncludes(
  mainView,
  "{{ plugin.updatedAt }}",
  "插件列表不能直接展示 ISO 时间，必须格式化。",
);
assertNotIncludes(
  mainView,
  "{{ config.updatedAt || \"未保存\" }}",
  "MCP 列表不能直接展示 ISO 时间，必须格式化。",
);
assertNotIncludes(
  mainView,
  "function formatJson(value: unknown): string {\n  return JSON.stringify(value, null, 2);\n}",
  "用量统计不能直接 JSON.stringify 原始记录，必须先递归格式化时间字段。",
);
assertNotIncludes(
  mainView,
  "{{ formatJson(record) }}",
  "用量统计模板不能继续直接展示原始 JSON 格式化结果。",
);
assertNotIncludes(
  mainViewOnly,
  "WorkspacePageHost",
  "MainView 不能继续导入或渲染 WorkspacePageHost，管理页必须拆到各自 views 页面。",
);
assertNotIncludes(
  allManagementPages,
  "import WorkspacePage from \"./WorkspacePage.vue\"",
  "RouterIndex.vue 不能继续只导入 WorkspacePage，页面业务必须直接写在入口文件内。",
);
assertNotIncludes(
  allManagementPages,
  "<WorkspacePage",
  "RouterIndex.vue 不能继续只渲染 WorkspacePage，页面业务必须直接写在入口文件内。",
);
assertNotIncludes(
  mainViewOnly,
  "initialPage",
  "MainView 不能继续接收 initialPage 伪页面参数。",
);
assertNotIncludes(
  mainViewOnly,
  "activePage === 'providers'",
  "MainView 不能继续用 activePage 条件渲染供应商页面。",
);

// routeExpectations: 顶部菜单子路由必须指向各自 RouterIndex.vue，避免刷新或复制链接后回到对话页。
const routeExpectations = [
  [
    "chat",
    "@views/Chat/RouterIndex.vue",
  ],
  [
    "agent-management",
    "@views/AgentManagement/RouterIndex.vue",
  ],
  [
    "providers",
    "@views/Providers/RouterIndex.vue",
  ],
  [
    "proxies",
    "@views/Proxies/RouterIndex.vue",
  ],
  [
    "runtimes",
    "@views/Runtimes/RouterIndex.vue",
  ],
  [
    "usage",
    "@views/Usage/RouterIndex.vue",
  ],
  [
    "plugins",
    "@views/Plugins/RouterIndex.vue",
  ],
  [
    "mcp",
    "@views/Mcp/RouterIndex.vue",
  ],
  [
    "skills",
    "@views/Skills/RouterIndex.vue",
  ],
  [
    "center",
    "@views/Center/RouterIndex.vue",
  ],
];

for (const [
  routePath,
  importPath,
] of routeExpectations) {
  assertIncludes(
    routerSource,
    `path: "${routePath}"`,
    `路由必须注册独立子路径 ${routePath}。`,
  );
  assertIncludes(
    routerSource,
    `component: () => import("${importPath}")`,
    `路由 ${routePath} 必须懒加载 ${importPath}。`,
  );
}

assertIncludes(
  routerSource,
  "path: \"/\"",
  "工作台父路由必须保持根路径。",
);
assertIncludes(
  routerSource,
  "component: () => import(\"@views/MainView.vue\")",
  "工作台父路由必须懒加载 MainView 作为公共壳。",
);
assertIncludes(
  routerSource,
  "children: [",
  "工作台路由必须使用 children 承载各页面入口。",
);

assertIncludes(
  mainViewOnly,
  "await router.push(targetPath);",
  "顶部菜单切换必须调用 Vue Router 更新 hash URL。",
);
assertIncludes(
  mainViewOnly,
  "resolveWorkspacePageFromRoute(route.path)",
  "顶部菜单激活状态必须由真实路由推导。",
);
assertIncludes(
  chatConversationPanelOnly + chatOptionsOnly,
  "每一步副作用操作都需要用户确认",
  "执行模式下拉必须展示建议模式说明。",
);
assertIncludes(
  chatConversationPanelOnly + chatOptionsOnly,
  "低风险读取或编辑流程可自动执行",
  "执行模式下拉必须展示自动编辑说明。",
);
assertIncludes(
  chatConversationPanelOnly + chatOptionsOnly,
  "在权限和沙箱范围内自动执行",
  "执行模式下拉必须展示全自动说明。",
);
assertIncludes(
  desktopDevScript,
  "@zhixin/desktop-shell",
  "dev:desktop-shell 必须启动桌面壳包。",
);
assertNotIncludes(
  desktopDevScript,
  "@zhixin/center",
  "dev:desktop-shell 不能直接启动中心服务包。",
);
assertNotIncludes(
  desktopDevScript,
  "services/center/src/index.ts",
  "dev:desktop-shell 不能直接运行中心服务入口。",
);
