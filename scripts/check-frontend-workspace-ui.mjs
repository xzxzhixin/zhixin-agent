/**
 * 前端工作台 UI 结构检查。
 *
 * 用途：防止统一前端退化成临时骨架，偏离桌面端原有工作台页面。
 * 关键逻辑：只检查结构性类名和关键中文入口，不绑定具体 DOM 深度。
 */
import {
  readFileSync,
  existsSync,
} from "node:fs";
import {
  join,
} from "node:path";

// mainViewPath: 统一前端工作台页面源码。
const mainViewPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "MainView.vue",
);
// workspaceRouteHostPath: 工作台二级路由出口组件源码。
const workspaceRouteHostPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "WorkspaceRouteHost.vue",
);
// centerServicePath: 智能体领域源码，用于检查记忆 Markdown 标题协议。
const centerServicePath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "agent-domain.ts",
);
// viteConfigPath: Vite 配置源码，用于检查前端路径别名。
const viteConfigPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "vite.config.ts",
);
// frontendTsconfigPath: 前端 IDE 识别配置源码，用于检查路径别名。
const frontendTsconfigPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "tsconfig.json",
);
// stylesPath: 统一前端全局样式源码。
const stylesPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "styles.css",
);
// mainViewShell: 公共工作台壳源码，用于检查顶部菜单和插槽边界。
const mainViewShell = readFileSync(
  mainViewPath,
  "utf-8",
);
// workspaceRouteHost: 独立二级路由出口源码，避免公共壳菜单状态和主体更新混在同一组件。
const workspaceRouteHost = readFileSync(
  workspaceRouteHostPath,
  "utf-8",
);
// chatPagePath: 对话页真实入口源码，承载对话主体、移动模式和插件紧凑模式。
const chatPagePath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "Chat",
  "RouterIndex.vue",
);
// chatPage: 对话页源码文本，用于检查输入区和执行模式说明。
const chatPage = readFileSync(
  chatPagePath,
  "utf-8",
);
// chatConversationPanel: 对话主体组件源码，输入区、三入口和消息流已从页面入口拆入该组件。
const chatConversationPanel = readFileSync(
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
// composerContextUsage: 输入区上下文用量组合函数源码，负责百分比和 hover 明细。
const composerContextUsage = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    "Chat",
    "useComposerContextUsage.ts",
  ),
  "utf-8",
);
const chatOptions = readFileSync(
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
// mainView: 工作台整体源码，合并公共壳和对话页入口，适配页面主体已迁出 MainView 的结构。
const mainView = `${mainViewShell}\n${chatPage}\n${chatConversationPanel}\n${composerContextUsage}\n${chatOptions}\n${workspaceRouteHost}`;
// centerService: 中心服务源码文本。
const centerService = readFileSync(
  centerServicePath,
  "utf-8",
);
// viteConfig: Vite 配置源码文本。
const viteConfig = readFileSync(
  viteConfigPath,
  "utf-8",
);
// frontendTsconfig: 前端 IDE 配置源码文本；不存在时让别名检查失败。
const frontendTsconfig = existsSync(frontendTsconfigPath)
  ? readFileSync(
    frontendTsconfigPath,
    "utf-8",
  )
  : "";
// routerPath: 前端路由源码路径，用于检查动态 import 写法。
const routerPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "router.ts",
);
// routerSource: 前端路由源码文本。
const routerSource = readFileSync(
  routerPath,
  "utf-8",
);
// pageComponentPaths: 顶部管理页的真实路由入口组件。
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
// workspacePageHost: 管理页真实路由入口源码合并文本，用于跨页面能力检查。
const workspacePageHost = pageComponentPaths.map((relativePath) => {
  return readFileSync(
    join(
      process.cwd(),
      relativePath,
    ),
    "utf-8",
  );
}).join("\n");
// styles: 工作台样式文本，用于检查固定视口 flex 布局。
const styles = readFileSync(
  stylesPath,
  "utf-8",
);
// appStorePath: 统一前端 Pinia store 源码，用于检查初始化容错逻辑。
const appStorePath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "stores",
  "app.ts",
);
// appStore: 工作台数据初始化源码，用于防止项目列表旧接口失败阻断会话渲染。
const appStore = readFileSync(
  appStorePath,
  "utf-8",
);
const appManagementActions = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "stores",
    "app-management-actions.ts",
  ),
  "utf-8",
);
const appHelpers = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "stores",
    "app-helpers.ts",
  ),
  "utf-8",
);
const chatHelpers = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    "Chat",
    "chat-view-helpers.ts",
  ),
  "utf-8",
);
// chatStyle: 对话页专属样式源码，用于检查输入区内部入口和小浮层高度边界。
const chatStyle = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    "Chat",
    "style.css",
  ),
  "utf-8",
);
// agentStatusDialogPath: 智能体状态弹框组件源码。
const agentStatusDialogPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "Chat",
  "dialogs",
  "AgentStatusDialog.vue",
);
// agentStatusDialog: 智能体状态弹框组件文本。
const agentStatusDialog = existsSync(agentStatusDialogPath)
  ? readFileSync(
    agentStatusDialogPath,
    "utf-8",
  )
  : "";
const agentConversationDialog = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    "Chat",
    "dialogs",
    "AgentConversationDialog.vue",
  ),
  "utf-8",
);
const statusSummaryPanel = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    "Chat",
    "StatusSummaryPanel.vue",
  ),
  "utf-8",
);
// requirementsPath: 产品需求文档，用于确认本轮 UI 需求只写入产品语义。
const requirementsPath = join(
  process.cwd(),
  "需求.md",
);
// planPath: 实施计划文档，用于确认本轮任务已同步到计划并完成勾选。
const planPath = join(
  process.cwd(),
  "计划.md",
);
// requirements: 产品需求文档文本。
const requirements = readFileSync(
  requirementsPath,
  "utf-8",
);
// plan: 实施计划文档文本。
const plan = readFileSync(
  planPath,
  "utf-8",
);

// requiredComponentPaths: 本轮要求拆出的页面宿主和弹框组件。
const requiredComponentPaths = [
  [
    "apps/frontend/src/views/Login/RouterIndex.vue",
    "登录页面入口必须迁移或包装到 views/Login/RouterIndex.vue。",
  ],
  [
    "apps/frontend/src/views/Chat/RouterIndex.vue",
    "对话顶部菜单页面必须建立 views/Chat/RouterIndex.vue 入口。",
  ],
  [
    "apps/frontend/src/views/AgentManagement/RouterIndex.vue",
    "智能体管理顶部菜单页面必须建立 views/AgentManagement/RouterIndex.vue 入口。",
  ],
  [
    "apps/frontend/src/views/Providers/RouterIndex.vue",
    "供应商顶部菜单页面必须建立 views/Providers/RouterIndex.vue 入口。",
  ],
  [
    "apps/frontend/src/views/Proxies/RouterIndex.vue",
    "网络代理顶部菜单页面必须建立 views/Proxies/RouterIndex.vue 入口。",
  ],
  [
    "apps/frontend/src/views/Runtimes/RouterIndex.vue",
    "运行环境顶部菜单页面必须建立 views/Runtimes/RouterIndex.vue 入口。",
  ],
  [
    "apps/frontend/src/views/Usage/RouterIndex.vue",
    "用量统计顶部菜单页面必须建立 views/Usage/RouterIndex.vue 入口。",
  ],
  [
    "apps/frontend/src/views/Plugins/RouterIndex.vue",
    "插件顶部菜单页面必须建立 views/Plugins/RouterIndex.vue 入口。",
  ],
  [
    "apps/frontend/src/views/Mcp/RouterIndex.vue",
    "MCP 顶部菜单页面必须建立 views/Mcp/RouterIndex.vue 入口。",
  ],
  [
    "apps/frontend/src/views/Skills/RouterIndex.vue",
    "skill 顶部菜单页面必须建立 views/Skills/RouterIndex.vue 入口。",
  ],
  [
    "apps/frontend/src/views/Center/RouterIndex.vue",
    "中心服务顶部菜单页面必须建立 views/Center/RouterIndex.vue 入口。",
  ],
  [
    "apps/frontend/src/views/Chat/dialogs/TaskDetailDialog.vue",
    "任务详情小弹框必须拆到 Chat 页面专属 dialogs 目录。",
  ],
  [
    "apps/frontend/src/views/Chat/dialogs/AgentStatusDialog.vue",
    "智能体状态小弹框和智能体对话必须拆到 Chat 页面专属 dialogs 目录。",
  ],
  [
    "apps/frontend/src/views/Chat/dialogs/AgentConversationDialog.vue",
    "智能体完整对话必须拆到 Chat 页面专属 dialogs 目录。",
  ],
  [
    "apps/frontend/src/views/Chat/dialogs/EditDetailDialog.vue",
    "编辑详情小弹框必须拆到 Chat 页面专属 dialogs 目录。",
  ],
  [
    "apps/frontend/src/views/Chat/dialogs/ProjectCapabilityDialog.vue",
    "项目能力详情弹框必须拆到 Chat 页面专属 dialogs 目录。",
  ],
];

for (const [
  relativePath,
  message,
] of requiredComponentPaths) {
  if (!existsSync(join(process.cwd(), relativePath))) {
    console.error(message);
    process.exitCode = 1;
  }
}

/**
 * expectations: 工作台 UI 必须保留的结构信号。
 */
const expectations = [
  [
    mainViewShell,
    "line-height: 1;",
    "顶部菜单和主题按钮必须固定行高，避免图标文字上下错位。",
  ],
  [
    mainViewShell,
    "display: inline-flex;",
    "顶部菜单项必须使用 inline-flex 保证图标、文字和激活态同一视觉中线。",
  ],
  [
    mainViewShell,
    "height: 34px;",
    "顶部菜单项必须有稳定高度，避免 hover 或激活态导致中线漂移。",
  ],
  [
    mainView,
    "top-menu",
    "工作台必须包含顶部主菜单容器。",
  ],
  [
    mainView,
    "供应商",
    "顶部主菜单必须包含供应商入口。",
  ],
  [
    mainView,
    "网络代理",
    "顶部主菜单必须包含网络代理入口。",
  ],
  [
    mainView,
    "运行环境",
    "顶部主菜单必须包含运行环境入口。",
  ],
  [
    mainView,
    "用量统计",
    "顶部主菜单必须包含用量统计入口。",
  ],
  [
    mainView,
    "中心服务",
    "桌面端必须包含中心服务管理页面入口。",
  ],
  [
    chatPage,
    "conversation-sidebar",
    "对话页必须保留左侧对话导航。",
  ],
  [
    mainView,
    "项目对话",
    "左侧对话导航必须包含项目对话分组。",
  ],
  [
    mainView,
    "普通对话",
    "左侧对话导航必须包含普通对话分组。",
  ],
  [
    mainView,
    "project-conversation-tree",
    "项目对话必须使用两级项目树结构。",
  ],
  [
    mainView,
    "data-nav-kind=\"project\"",
    "项目行必须提供 data-nav-kind 标识，方便回归检查和自动化定位。",
  ],
  [
    mainView,
    "data-nav-kind=\"project-session\"",
    "项目对话行必须提供 data-nav-kind 标识。",
  ],
  [
    mainView,
    "data-nav-kind=\"normal-session\"",
    "普通对话行必须提供 data-nav-kind 标识。",
  ],
  [
    mainView,
    "conversation-group-header",
    "项目对话和普通对话标题行必须有独立容器承载新增图标按钮。",
  ],
  [
    mainView,
    "create-project-entry-button",
    "项目对话标题右侧必须提供新增项目或项目对话图标入口。",
  ],
  [
    mainView,
    "create-normal-session-button",
    "普通对话标题右侧必须提供新增普通对话图标入口。",
  ],
  [
    mainView,
    "conversation-status-icon",
    "项目行和对话行必须有状态图标结构。",
  ],
  [
    mainView,
    "session-tooltip-content",
    "对话行必须通过 tooltip 展示完整标题和格式化时间。",
  ],
  [
    mainView,
    "conversation-time-node",
    "对话导航行右侧必须展示格式化时间节点。",
  ],
  [
    mainView,
    "sessionUserPreview",
    "对话行 tooltip 必须包含用户最近发送内容摘要。",
  ],
  [
    mainView,
    "active-turn-elapsed",
    "当前运行轮次耗时必须固定展示在输入框上方。",
  ],
  [
    mainView,
    "turn-time-footer",
    "轮次结束时间必须展示在对话内容内部本轮最后。",
  ],
  [
    mainView + statusSummaryPanel,
    "config-panel",
    "对话页必须保留右侧任务和智能体栏。",
  ],
  [
    mainView,
    "composer-shell",
    "输入区必须使用原工作台胶囊式输入框结构。",
  ],
  [
    mainView,
    "composer-entry-strip",
    "输入区三入口必须保留在输入框内部并与输入框左右边缘对齐。",
  ],
  [
    mainView,
    "openComposerMiniDialog",
    "输入区三段入口必须打开小弹框，不能在输入框内常驻展开详情面板。",
  ],
  [
    mainView,
    "composerMiniDialogVisible",
    "任务、智能体状态和编辑详情必须共用输入区小弹框状态。",
  ],
  [
    mainView,
    "<TaskDetailDialog",
    "对话组件必须通过任务详情独立弹框组件承载任务详情。",
  ],
  [
    mainView,
    "<AgentStatusDialog",
    "对话组件必须通过智能体状态独立弹框组件承载状态树和对话。",
  ],
  [
    mainView,
    "<EditDetailDialog",
    "对话组件必须通过编辑详情独立弹框组件承载编辑摘要。",
  ],
  [
    mainView,
    "<ProjectCapabilityDialog",
    "MainView 必须通过项目能力详情独立弹框组件承载项目能力详情。",
  ],
  [
    mainViewShell,
    "<WorkspaceRouteHost/>",
    "MainView 必须通过 WorkspaceRouteHost 承载独立顶部菜单页面，不能继续内联所有管理页。",
  ],
  [
    workspaceRouteHost,
    "<RouterView",
    "WorkspaceRouteHost 必须通过 RouterView 承载独立顶部菜单页面。",
  ],
  [
    mainView,
    "智能体 {{ agentStatusProgressText }}",
    "输入区第二段入口必须命名为“智能体”。",
  ],
  [
    mainView,
    "taskProgressText",
    "任务入口外部数字必须使用已完成序号/总数语义。",
  ],
  [
    mainView,
    "agentStatusProgressText",
    "智能体状态入口外部数字必须使用运行中数量/总数语义。",
  ],
  [
    mainView,
    "任务 {{ taskProgressText }}",
    "输入区任务入口必须展示任务进度数字。",
  ],
  [
    mainView,
    "智能体 {{ agentStatusProgressText }}",
    "输入区智能体入口必须展示运行中数量/总数。",
  ],
  [
    mainView,
    "sendAgentDraft",
    "智能体对话详情必须能基于当前会话发送消息闭环。",
  ],
  [
    mainView + appStore,
    "sendAgentSubConversationMessage",
    "中心服务必须提供独立智能体子对话发送 API，不能继续只通过当前会话发送。",
  ],
  [
    agentConversationDialog + chatConversationPanel,
    "variant=\"agent\"",
    "智能体状态弹框必须提供智能体对话消息列表。",
  ],
  [
    agentConversationDialog + chatConversationPanel,
    "agentDraft",
    "智能体对话详情必须提供输入草稿。",
  ],
  [
    appStore,
    "主智能体",
    "智能体状态两级树第一级必须包含主智能体展示语义。",
  ],
  [
    appStore,
    "长期智能体",
    "智能体状态两级树第一级必须覆盖团队长期智能体。",
  ],
  [
    appStore,
    "子智能体",
    "智能体状态两级树第二级必须展示各长期智能体创建的子智能体。",
  ],
  [
    mainView,
    ":autosize=\"false\"",
    "workspace 输入框必须关闭 autosize，交由用户手动调整高度并保持底部输入区稳定。",
  ],
  [
    mainView,
    ":rows=\"5\"",
    "workspace 输入框必须提供稳定默认行数，避免初始高度过低。",
  ],
  [
    mainView,
    "plugin-project-name",
    "插件紧凑页必须在可见头部展示当前项目文件夹名。",
  ],
  [
    mainView,
    "appStore.runtime.projectContext.displayName",
    "插件紧凑页项目名必须来自运行时项目上下文的 displayName。",
  ],
  [
    mainView,
    "canManageCenterService",
    "中心服务管理能力必须受桌面壳能力控制。",
  ],
  [
    styles,
    ".top-menu",
    "样式必须包含顶部主菜单布局。",
  ],
  [
    styles,
    ".conversation-sidebar",
    "样式必须包含左侧对话导航布局。",
  ],
  [
    styles,
    ".project-conversation-tree",
    "样式必须包含项目对话两级树布局。",
  ],
  [
    styles,
    ".conversation-row-actions",
    "样式必须包含 hover 后右侧图标按钮区域。",
  ],
  [
    styles,
    ".composer-shell",
    "样式必须包含胶囊式输入框布局。",
  ],
  [
    chatStyle,
    "max-height: 40vh;",
    "任务、智能体和编辑三个输入区小浮层必须限制最大高度为 40vh。",
  ],
  [
    styles,
    "--zhixin-scrollbar-thumb",
    "必须提供统一滚动条 thumb 颜色变量。",
  ],
  [
    styles,
    "::-webkit-scrollbar",
    "必须覆盖 WebKit 滚动条样式。",
  ],
  [
    styles,
    "scrollbar-width: thin;",
    "必须覆盖 Firefox 窄滚动条样式。",
  ],
  [
    styles,
    ".message-list",
    "消息列表必须纳入统一滚动容器样式覆盖。",
  ],
  [
    agentStatusDialog,
    ".composer-mini-dialog",
    "任务、智能体状态和编辑小弹框样式必须写入页面专属 Vue 组件。",
  ],
  [
    mainView,
    "execution-mode-option-row",
    "执行模式下拉面板必须提供带说明的选项行。",
  ],
  [
    mainView,
    "每一步副作用操作都需要用户确认",
    "执行模式下拉必须解释建议模式的审批语义。",
  ],
  [
    mainView,
    "低风险读取或编辑流程可自动执行",
    "执行模式下拉必须解释自动编辑的审批语义。",
  ],
  [
    mainView,
    "在权限和沙箱范围内自动执行",
    "执行模式下拉必须解释全自动的审批语义。",
  ],
  [
    styles,
    "width: min(900px, 100%);",
    "胶囊输入框和运行中耗时提示宽度必须提升到 min(900px, 100%)。",
  ],
  [
    styles,
    "min-height: 120px;",
    "胶囊输入框最小高度必须提升到 120px。",
  ],
  [
    styles,
    "flex: 0 0 auto;",
    "胶囊输入框在纵向 flex 父容器中不能用 900px 作为 flex-basis，否则会把高度撑到 900px。",
  ],
  [
    styles,
    "overflow: hidden;",
    "工作台根布局必须禁止页面级滚动。",
  ],
  [
    appStore,
    "fallbackProjectsFromSessions",
    "项目列表接口失败时必须从项目会话 projectId 构造兜底项目节点。",
  ],
  [
    appStore,
    "catch (error)",
    "项目列表接口失败必须被捕获，不能阻断会话列表加载。",
  ],
  [
    appStore,
    "项目列表接口失败，已使用项目会话构造兜底项目导航。",
    "项目列表失败兜底必须记录中文排查信息。",
  ],
  [
    appStore + appHelpers + chatHelpers,
    "未登记项目名称",
    "旧中心服务缺少项目登记信息时必须显示明确的未登记名称，不能用项目 ID 冒充主名称。",
  ],
  [
    mainView,
    "projectTooltipContent",
    "项目行必须通过 tooltip 或 title 暴露项目 ID 和登记状态详情。",
  ],
  [
    appStore,
    "pendingSessionDraft",
    "新增对话必须先保存本地草稿，不能立即进入历史列表。",
  ],
  [
    appStore,
    "ensureSessionForSending",
    "发送真实内容时才允许创建中心服务会话。",
  ],
  [
    appStore,
    "AgentStatusTreeNode",
    "store 必须使用智能体状态树节点语义，不能继续使用子代理入口命名。",
  ],
  [
    appStore,
    "mainAgentStatusTree",
    "store 必须能为智能体状态弹框提供包含主智能体的两级树。",
  ],
  [
    requirements,
    "三段入口固定为“任务 / 智能体 / 编辑”",
    "需求文档必须把输入区三段入口更新为任务、智能体和编辑。",
  ],
  [
    requirements,
    "任务详情、智能体状态详情和编辑详情都从输入框内部入口向上打开浮层",
    "需求文档必须要求三段入口详情从输入框内部入口向上打开浮层。",
  ],
  [
    requirements,
    "最大高度为 `40vh`",
    "需求文档必须要求三个输入区小浮层最大高度为 40vh。",
  ],
  [
    requirements,
    "智能体状态弹框使用两级树",
    "需求文档必须明确智能体状态弹框两级树结构。",
  ],
  [
    requirements,
    "仍通过当前会话发送",
    "需求文档必须明确没有独立智能体会话 API 时仍通过当前会话发送。",
  ],
  [
    requirements,
    "滚动条视觉参考 Element Plus",
    "需求文档必须补充统一滚动条视觉要求。",
  ],
  [
    plan,
    "[x] 补齐本轮输入区小弹框、智能体状态树、智能体对话闭环和统一滚动条回归",
    "计划文档必须新增并勾选本轮 UI 和静态回归任务。",
  ],
  [
    plan,
    "插件端只落实代码，不测试、不构建",
    "计划文档必须记录插件端本轮验收边界。",
  ],
  [
    plan,
    "项目对话验证使用项目根目录 `对话测试` 目录",
    "计划文档必须记录项目对话验证目录。",
  ],
  [
    plan,
    "由桌面端拉起中心服务",
    "计划文档必须记录中心服务由桌面端拉起。",
  ],
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

if (mainView.includes("<small>{{ formatDisplayTime(session.updatedAt) }}</small>")) {
  console.error("对话时间节点必须使用 conversation-time-node 语义类，并且只显示在行右侧。");
  process.exitCode = 1;
}

if (appStore.includes("displayName: `项目 ${projectId}`")) {
  console.error("项目主名称不能使用 `项目 ${projectId}` 兜底冒充文件夹名。");
  process.exitCode = 1;
}

if (mainView.includes("const endedText = turn.endedAt ? formatDisplayTime(turn.endedAt) : \"进行中\"")) {
  console.error("运行中轮次消息尾部不能显示“结束 进行中”。");
  process.exitCode = 1;
}

if (mainView.includes("activeRunningTurn.value?.turnId === turn.turnId")) {
  console.error("运行中轮次耗时不能同时出现在输入框上方和消息尾部。");
  process.exitCode = 1;
}

if (mainView.includes("group.project.alias ?? group.project.displayName")) {
  console.error("项目主名称必须使用文件夹名，别名或备注不能替代项目名称。");
  process.exitCode = 1;
}

if (mainView.includes("composer-provider-select")) {
  console.error("输入框内部不能展示供应商选择。");
  process.exitCode = 1;
}

if (mainView.includes("activeComposerPanel = 'task'")) {
  console.error("输入区三段入口不能切换常驻详情面板，必须打开小弹框。");
  process.exitCode = 1;
}

if (mainView.includes("toggleComposerEntries") || mainView.includes("composer-entry-toggle")) {
  console.error("输入区三入口不能再提供收起/展开按钮，三入口必须固定展示在输入框内部。");
  process.exitCode = 1;
}

if (chatStyle.includes("width: min(900px, 100%);")) {
  console.error("输入框不能继续固定 900px 最大宽度，必须占满中间对话区可用宽度。");
  process.exitCode = 1;
}

if (!chatStyle.includes("width: 100%;")) {
  console.error("输入框 frame 必须使用 100% 宽度对齐中间对话区。");
  process.exitCode = 1;
}

if (chatStyle.includes(".composer-shell:has(.composer-mini-popover)")) {
  console.error("输入区浮层不能再把 composer-shell 撑高，必须作为向上浮窗覆盖在输入框上方。");
  process.exitCode = 1;
}

if (!chatStyle.includes("bottom: calc(100% - 1px);")) {
  console.error("输入区小浮层必须从输入框内部入口向上打开，并贴合输入框宽度。");
  process.exitCode = 1;
}

if (mainView.includes("activeComposerPanel = 'subAgents'")) {
  console.error("输入区第二段入口不能继续使用子代理旧面板逻辑。");
  process.exitCode = 1;
}

if (mainView.includes("<section class=\"composer-context-panel\">")) {
  console.error("输入区不能常驻 composer-context-panel 详情面板。");
  process.exitCode = 1;
}

if (mainViewShell.includes("<el-dialog")) {
  console.error("MainView 不能继续内联弹框大模板，弹框必须拆成独立组件。");
  process.exitCode = 1;
}

if (mainViewShell.includes("v-else-if=\"activePage === 'providers'\"")
    || mainViewShell.includes("v-else-if=\"activePage === 'proxies'\"")
    || mainViewShell.includes("v-else-if=\"activePage === 'runtimes'\"")
    || mainViewShell.includes("v-else-if=\"activePage === 'usage'\"")
    || mainViewShell.includes("v-else-if=\"activePage === 'plugins'\"")
    || mainViewShell.includes("v-else-if=\"activePage === 'mcp'\"")
    || mainViewShell.includes("v-else-if=\"activePage === 'skills'\"")
    || mainViewShell.includes("v-else-if=\"activePage === 'center'\"")
    || mainViewShell.includes("v-else-if=\"activePage === 'agent-management'\"")) {
  console.error("MainView 不能继续内联顶部菜单页面内容，必须交给独立页面宿主组件。");
  process.exitCode = 1;
}

if (mainView.includes(">子代理<") || mainView.includes("暂无子代理状态") || mainView.includes("子代理对话")) {
  console.error("前端主界面不能继续出现“子代理”旧文案，必须改为“智能体状态”或“子智能体”。");
  process.exitCode = 1;
}

if (appStore.includes("childAgentTree")) {
  console.error("store 不能继续使用 childAgentTree 作为输入区入口事实，应改为智能体状态树语义。");
  process.exitCode = 1;
}

const loadNavigationIndex = appStore.indexOf("async loadNavigationData");
const loadSessionsIndex = appStore.indexOf("await this.loadSessions()", loadNavigationIndex);
const loadProjectsIndex = appStore.indexOf("await this.loadProjects()", loadNavigationIndex);
if (loadNavigationIndex < 0 || loadSessionsIndex < 0 || loadProjectsIndex < 0 || loadSessionsIndex > loadProjectsIndex) {
  console.error("工作台初始化必须先加载会话，再加载项目，避免 /api/project/list 失败阻断已有会话渲染。");
  process.exitCode = 1;
}

if (appStore.includes("await this.loadProjects();\n            await this.loadSessions();")) {
  console.error("工作台初始化不能先等待项目列表再加载会话列表。");
  process.exitCode = 1;
}

if (!routerSource.includes("redirect: \"/chat\"")) {
  console.error("根路由必须重定向到 /chat，不能保留只转发公共壳的 Main/RouterIndex.vue。");
  process.exitCode = 1;
}

if (routerSource.includes("component: () => import(\"./views/MainView.vue\")")
    || routerSource.includes("component: () => import(\"./views/LoginView.vue\")")
    || routerSource.includes("import(\"./views")) {
  console.error("路由不能继续使用 ./views 相对路径，必须使用 @views 别名。");
  process.exitCode = 1;
}

const requiredRoutes = [
  [
    "/login",
    "@views/Login/RouterIndex.vue",
  ],
  [
    "/chat",
    "@views/Chat/RouterIndex.vue",
  ],
  [
    "/agent-management",
    "@views/AgentManagement/RouterIndex.vue",
  ],
  [
    "/providers",
    "@views/Providers/RouterIndex.vue",
  ],
  [
    "/proxies",
    "@views/Proxies/RouterIndex.vue",
  ],
  [
    "/runtimes",
    "@views/Runtimes/RouterIndex.vue",
  ],
  [
    "/usage",
    "@views/Usage/RouterIndex.vue",
  ],
  [
    "/plugins",
    "@views/Plugins/RouterIndex.vue",
  ],
  [
    "/mcp",
    "@views/Mcp/RouterIndex.vue",
  ],
  [
    "/skills",
    "@views/Skills/RouterIndex.vue",
  ],
  [
    "/center",
    "@views/Center/RouterIndex.vue",
  ],
];

if (!routerSource.includes("component: () => import(\"@views/MainView.vue\")")) {
  console.error("工作台父路由必须懒加载 @views/MainView.vue 作为公共壳。");
  process.exitCode = 1;
}

if (!routerSource.includes("children: [")) {
  console.error("工作台页面必须使用 children 嵌套路由承载各 RouterIndex.vue。");
  process.exitCode = 1;
}

for (const [
  routePath,
  importPath,
] of requiredRoutes) {
  const routerPath = routePath === "/login"
    ? routePath
    : routePath.replace(/^\//u, "");
  if (!routerSource.includes(`path: "${routerPath}"`) || !routerSource.includes(`component: () => import("${importPath}")`)) {
    console.error(`路由 ${routePath} 必须使用 ${importPath} 动态导入注册。`);
    process.exitCode = 1;
  }
}

const pageEntryRoutes = [
  [
    "AgentManagement",
    "agent-management",
  ],
  [
    "Providers",
    "providers",
  ],
  [
    "Proxies",
    "proxies",
  ],
  [
    "Runtimes",
    "runtimes",
  ],
  [
    "Usage",
    "usage",
  ],
  [
    "Plugins",
    "plugins",
  ],
  [
    "Mcp",
    "mcp",
  ],
  [
    "Skills",
    "skills",
  ],
  [
    "Center",
    "center",
  ],
];

for (const [
  pageDirectory,
  initialPage,
] of pageEntryRoutes) {
  const pageEntrySource = readFileSync(
    join(
      process.cwd(),
      "apps",
      "frontend",
      "src",
      "views",
      pageDirectory,
      "RouterIndex.vue",
    ),
    "utf-8",
  );
  if (pageEntrySource.includes("import MainView from \"@views/MainView.vue\"")
      || pageEntrySource.includes("<MainView")
      || pageEntrySource.includes("import WorkspacePage from \"./WorkspacePage.vue\"")
      || pageEntrySource.includes("<WorkspacePage")
      || pageEntrySource.includes("initial-page")) {
    console.error(`views/${pageDirectory}/RouterIndex.vue 不能继续包公共壳、转发 WorkspacePage 或使用 initial-page。`);
    process.exitCode = 1;
  }

  if (!pageEntrySource.includes(`currentWorkspacePage = "${initialPage}"`) && !pageEntrySource.includes("page-panel")) {
    console.error(`views/${pageDirectory}/RouterIndex.vue 必须在入口文件内承载 ${initialPage} 页面业务，不能只转发 WorkspacePage 或使用 initial-page。`);
    process.exitCode = 1;
  }
}

const forbiddenWorkspacePagePaths = [
  "AgentManagement",
  "Providers",
  "Proxies",
  "Runtimes",
  "Usage",
  "Plugins",
  "Mcp",
  "Skills",
  "Center",
];

for (const pageDirectory of forbiddenWorkspacePagePaths) {
  const legacyWorkspacePagePath = join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    pageDirectory,
    "WorkspacePage.vue",
  );
  if (existsSync(legacyWorkspacePagePath)) {
    console.error(`views/${pageDirectory}/WorkspacePage.vue 不应继续存在，页面业务必须写在 RouterIndex.vue。`);
    process.exitCode = 1;
  }
}

const workspacePageHostRequirements = [
  [
    "onMounted",
    "独立管理 URL 必须在页面宿主挂载时主动加载当前页数据。",
  ],
  [
    "onMounted",
    "独立管理 URL 必须在页面挂载时主动加载当前页数据。",
  ],
  [
    "loadUsageStatistics",
    "用量统计独立页面必须主动加载用量数据。",
  ],
  [
    "echarts/core",
    "用量统计页面宿主必须引入 ECharts，不能只展示 JSON 列表。",
  ],
  [
    "usage-total-chart",
    "用量统计页面宿主必须展示总量图表容器。",
  ],
  [
    "usage-provider-chart",
    "用量统计页面宿主必须展示供应商维度图表容器。",
  ],
  [
    "usage-project-chart",
    "用量统计页面宿主必须展示项目维度图表容器。",
  ],
];

for (const [
  pattern,
  message,
] of workspacePageHostRequirements) {
  if (!workspacePageHost.includes(pattern)) {
    console.error(message);
    process.exitCode = 1;
  }
}

const requiredAliases = [
  "@",
  "~",
  "@views",
  "@components",
  "@stores",
  "@api",
];

for (const alias of requiredAliases) {
  if (!viteConfig.includes(`"${alias}"`)) {
    console.error(`Vite 配置必须包含 ${alias} 路径别名。`);
    process.exitCode = 1;
  }

  if (!frontendTsconfig.includes(`"${alias}/*"`)) {
    console.error(`apps/frontend/tsconfig.json 必须包含 ${alias}/* IDE 路径别名。`);
    process.exitCode = 1;
  }
}

if (!centerService.includes("const memoryTimeTitle = formatMemoryTimeTitle(now);")
    || !centerService.includes("`# ${memoryTimeTitle}`")) {
  console.error("writeAgentMemory 的 Markdown 标题必须只写 # HH:mm:ss。");
  process.exitCode = 1;
}

const writeAgentMemoryStart = centerService.indexOf("function writeAgentMemory");
const writeAgentMemoryEnd = centerService.indexOf("function enterMemoryQueue", writeAgentMemoryStart);
const writeAgentMemorySource = centerService.slice(
  writeAgentMemoryStart,
  writeAgentMemoryEnd,
);
if (writeAgentMemorySource.includes("`# 时间：${now.toISOString()}`")
    || writeAgentMemorySource.includes("# 时间：${now.toISOString()}")
    || writeAgentMemorySource.includes("# 时间：${memoryTimeTitle}")) {
  console.error("writeAgentMemory 不允许把 now.toISOString() 写入 Markdown 标题。");
  process.exitCode = 1;
}

if (mainView.includes("文件上下文") || mainView.includes("openProjectFileContextPicker")) {
  console.error("输入区不能继续展示独立文件上下文按钮，应展示当前窗口上下文用量。");
  process.exitCode = 1;
}

if (!mainView.includes("composerContextPercentText")
    || !mainView.includes("contextUsageTooltip")
    || !mainView.includes("composer-context-usage")) {
  console.error("输入区必须展示当前窗口上下文用量百分比，并通过 hover 展示明细。");
  process.exitCode = 1;
}

if (!appStore.includes("contextUsedTokens") || !appStore.includes("composerSelectedModelContextWindowTokens")) {
  console.error("状态容器必须保存当前窗口上下文已用量并读取模型窗口上限。");
  process.exitCode = 1;
}

if (!(appStore + appManagementActions).includes("countComposerContextTokens") || !(appStore + appManagementActions).includes("updateComposerContextUsage")) {
  console.error("当前窗口上下文用量必须通过中心服务 tokenizer 随会话和草稿更新。");
  process.exitCode = 1;
}

for (const signal of [
  "scheduleComposerContextUsageUpdate",
  "lastComposerContextUsageKey",
  "composerContextUsageRequestSerial",
]) {
  if (!(appStore + appManagementActions).includes(signal)) {
    console.error(`当前窗口上下文用量必须节流、去重并防止旧响应覆盖新输入状态：${signal}`);
    process.exitCode = 1;
  }
}

const agentStatusProgressStart = mainView.indexOf("const agentStatusProgressText = computed");
const agentStatusProgressEnd = mainView.indexOf("// activeTaskPanelRows", agentStatusProgressStart);
const agentStatusProgressSource = mainView.slice(
  agentStatusProgressStart,
  agentStatusProgressEnd,
);
if (agentStatusProgressSource.includes("agentStatusTreeRows.value.length")) {
  console.error("agentStatusProgressText 分母不能使用扁平化全部树行，必须只统计一级长期智能体。");
  process.exitCode = 1;
}

if (!agentStatusProgressSource.includes("node.nodeKind === \"主智能体\"")
    || !agentStatusProgressSource.includes("node.nodeKind === \"长期智能体\"")) {
  console.error("agentStatusProgressText 必须明确过滤主智能体和长期智能体。");
  process.exitCode = 1;
}

if (/const\s+\w+\s*=\s*\(\)\s*=>\s*import\("\.\/views\/[^"]+\.vue"\)/u.test(routerSource)) {
  console.error("路由懒加载不能先定义变量再挂载到 component。");
  process.exitCode = 1;
}

if (mainViewShell.includes("initialPage")
    || mainViewShell.includes("defineProps<{")
    || mainViewShell.includes("props.initialPage")
    || mainViewShell.includes("WorkspacePageHost")) {
  console.error("MainView 不能继续通过 initialPage 或 WorkspacePageHost 承载管理页，必须改为公共壳插槽。");
  process.exitCode = 1;
}

// topMenuButtonBlock：顶部菜单按钮模板片段，检查点击和刷新后的激活态可观测信号。
const topMenuButtonBlockStart = mainViewShell.indexOf("v-for=\"item in visibleMenuItems\"");
const topMenuButtonBlockEnd = mainViewShell.indexOf("@click=\"switchPage(item.page)\"", topMenuButtonBlockStart);
const topMenuButtonBlock = topMenuButtonBlockStart >= 0 && topMenuButtonBlockEnd >= 0
  ? mainViewShell.slice(
    topMenuButtonBlockStart,
    topMenuButtonBlockEnd,
  )
  : "";

if (!topMenuButtonBlock.includes(":aria-current=\"activePage === item.page ? 'page' : undefined\"")) {
  console.error("顶部菜单当前项必须设置 aria-current=page，保证直接访问路由和刷新后有可观测激活态。");
  process.exitCode = 1;
}

if (!topMenuButtonBlock.includes(":data-route-path=\"resolveWorkspacePagePath(item.page)\"")) {
  console.error("顶部菜单按钮必须暴露对应路由路径，方便浏览器验证点击菜单后当前项和 URL 一致。");
  process.exitCode = 1;
}

if (!mainViewShell.includes("border-bottom: 2px solid var(--zhixin-accent);")
    || !mainViewShell.includes("box-shadow: inset 0 -2px 0 var(--zhixin-accent);")
    || !mainViewShell.includes("font-weight: 700;")) {
  console.error("顶部菜单激活样式必须有清晰下划线、强调阴影和字重，不能只依赖弱背景色。");
  process.exitCode = 1;
}


