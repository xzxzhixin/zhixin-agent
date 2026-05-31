/**
 * 前端工作台 UI 结构检查。
 *
 * 用途：防止统一前端退化成临时骨架，偏离桌面端原有工作台页面。
 * 关键逻辑：只检查结构性类名和关键中文入口，不绑定具体 DOM 深度。
 */
import {
  readFileSync,
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
// stylesPath: 统一前端全局样式源码。
const stylesPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "styles.css",
);
// mainView: 工作台页面文本，用于检查菜单与布局入口。
const mainView = readFileSync(
  mainViewPath,
  "utf-8",
);
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

/**
 * expectations: 工作台 UI 必须保留的结构信号。
 */
const expectations = [
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
    mainView,
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
    mainView,
    "config-panel",
    "对话页必须保留右侧任务和智能体状态栏。",
  ],
  [
    mainView,
    "composer-shell",
    "输入区必须使用原工作台胶囊式输入框结构。",
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
    "composer-mini-dialog",
    "输入区三段入口的小弹框必须有稳定语义类。",
  ],
  [
    mainView,
    "智能体状态",
    "输入区第二段入口必须命名为“智能体状态”。",
  ],
  [
    mainView,
    "agent-conversation-list",
    "智能体状态弹框必须提供智能体对话消息列表。",
  ],
  [
    mainView,
    "agentConversationDraft",
    "智能体对话详情必须提供输入草稿。",
  ],
  [
    mainView,
    "sendAgentConversationDraft",
    "智能体对话详情必须能基于当前会话发送消息闭环。",
  ],
  [
    mainView,
    "仍通过当前会话发送",
    "中心服务缺少独立智能体会话 API 时，UI 文案必须明确仍通过当前会话发送。",
  ],
  [
    mainView,
    "主智能体",
    "智能体状态两级树第一级必须包含主智能体展示语义。",
  ],
  [
    mainView,
    "长期智能体",
    "智能体状态两级树第一级必须覆盖团队长期智能体。",
  ],
  [
    mainView,
    "子智能体",
    "智能体状态两级树第二级必须展示各长期智能体创建的子智能体。",
  ],
  [
    mainView,
    ":autosize=\"{ minRows: 4, maxRows: 8 }\"",
    "workspace 输入框 autosize 必须使用 minRows 4、maxRows 8，保证默认输入区高度稳定。",
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
    styles,
    ".composer-mini-dialog",
    "任务、智能体状态和编辑小弹框内容必须纳入统一滚动样式覆盖。",
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
    appStore,
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
    "三段入口固定为“任务 / 智能体状态 / 编辑”",
    "需求文档必须把输入区三段入口更新为任务、智能体状态和编辑。",
  ],
  [
    requirements,
    "任务详情、智能体状态详情和编辑详情都使用贴近输入区的小弹框展示",
    "需求文档必须要求三段入口详情使用小弹框。",
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

if (mainView.includes("activeComposerPanel = 'subAgents'")) {
  console.error("输入区第二段入口不能继续使用子代理旧面板逻辑。");
  process.exitCode = 1;
}

if (mainView.includes("<section class=\"composer-context-panel\">")) {
  console.error("输入区不能常驻 composer-context-panel 详情面板。");
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
