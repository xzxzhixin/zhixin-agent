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
