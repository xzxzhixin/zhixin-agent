<script setup lang="ts">
import {
  BarChart,
  PieChart,
} from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import {
  init,
  use,
  type ECharts,
} from "echarts/core";
import {
  CanvasRenderer,
} from "echarts/renderers";
import {
  ElMessage,
} from "element-plus";
import {
  ArrowDown,
  ArrowRight,
  ChatDotRound,
  CircleCheck,
  CircleClose,
  Clock,
  Delete,
  Folder,
  FolderAdd,
  FolderOpened,
  Loading,
  Plus,
  Warning,
} from "@element-plus/icons-vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
} from "vue";

import {
  useAppStore,
  type AgentStatusTreeNode,
  type ComposerEditFile,
} from "../stores/app";
import type {
  ConversationMessage,
  ConversationSession,
  ConversationTurn,
  ProjectRecord,
  TaskStatus,
} from "@zhixin/shared";

/**
 * WorkspacePage：桌面工作台顶部菜单页面。
 *
 * 来源：需求中的工作台主页面。
 * 含义：只控制本地 UI 展示，不作为中心服务权限依据。
 * 格式：固定字符串枚举。
 * 默认值：chat。
 * 约束：中心服务页面只能在桌面壳能力存在时展示。
 */
type WorkspacePage =
    | "chat"
    | "agent-management"
    | "providers"
    | "proxies"
    | "runtimes"
    | "usage"
    | "plugins"
    | "mcp"
    | "skills"
    | "center";

/**
 * ComposerEntryKind：输入框三段入口。
 *
 * 来源：本轮输入框产品需求。
 * 含义：控制任务、智能体状态和编辑详情小弹框内容。
 * 格式：固定字符串枚举。
 * 默认值：task。
 * 约束：只影响本地 UI 弹框，不改变中心服务发送协议。
 */
type ComposerEntryKind =
    | "task"
    | "agentStatus"
    | "edit";

/**
 * WorkspaceMenuItem：顶部主菜单项。
 *
 * 来源：需求“对话、供应商、网络代理、运行环境、用量统计、中心服务”。
 * 含义：定义桌面工作台可切换页面。
 * 格式：页面值和中文标签。
 * 默认值：无。
 * 约束：中心服务项只在桌面壳展示。
 */
interface WorkspaceMenuItem {
  /**
   * page: 页面协议值。
   */
  page: WorkspacePage;

  /**
   * label: 菜单展示文案。
   */
  label: string;

  /**
   * desktopOnly: 是否仅桌面壳可见。
   */
  desktopOnly: boolean;
}

/**
 * SelectOption：输入区下拉选项。
 *
 * 来源：执行模式和推理深度控件。
 * 含义：同时保存协议值、中文标签和说明，避免用户看到裸英文枚举。
 * 格式：固定字符串对象。
 * 默认值：无。
 * 约束：选项只服务当前输入框 UI，中心服务仍是审批和执行事实源。
 */
interface SelectOption {
  /**
   * value: 协议值。
   */
  value: string;

  /**
   * label: 中文标签。
   */
  label: string;

  /**
   * description: 选项解释。
   */
  description: string;
}

/**
 * NavigationStatusMeta：左侧导航状态图标元信息。
 *
 * 来源：中心服务任务状态和会话状态。
 * 含义：统一描述项目行、项目对话行和普通对话行的状态展示。
 * 格式：图标组件、中文标题和 CSS 状态名。
 * 默认值：空闲。
 * 约束：只展示明确状态，不从多个业务字段兜底猜测。
 */
interface NavigationStatusMeta {
  /**
   * icon: Element Plus 图标组件。
   */
  icon: unknown;

  /**
   * title: 鼠标悬停状态说明。
   */
  title: string;

  /**
   * tone: CSS 状态色名称。
   */
  tone: string;
}

/**
 * AgentStatusTreeRow：智能体状态树扁平展示行。
 *
 * 来源：store 中的智能体状态树。
 * 含义：把两级树节点转换成可渲染列表，同时保留层级缩进。
 * 格式：节点和层级数字。
 * 默认值：无。
 * 约束：只转换单一临时约定，不兼容候选字段。
 */
interface AgentStatusTreeRow {
  /**
   * node: 智能体树节点。
   */
  node: AgentStatusTreeNode;

  /**
   * level: 当前节点层级，根节点为 0。
   */
  level: number;
}

// appStore：主界面读取运行时、会话、消息、任务和桌面能力状态。
const appStore = useAppStore();
// ECharts：用量统计图表只注册当前页面需要的图表和组件，避免引入完整包。
use([
  BarChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);
// activePage：顶部主菜单当前页面，本地 UI 状态不进入中心服务事实源。
const activePage = ref<WorkspacePage>("chat");
// activeComposerEntry：输入框三段入口当前弹框内容。
const activeComposerEntry = ref<ComposerEntryKind>("task");
// composerMiniDialogVisible：输入框三段入口小弹框显隐。
const composerMiniDialogVisible = ref(false);
// selectedAgentStatusNode：当前被点开的智能体状态节点。
const selectedAgentStatusNode = ref<AgentStatusTreeNode | null>(null);
// agentConversationDraft：智能体对话详情输入草稿，发送时仍写入当前会话。
const agentConversationDraft = ref("");
// selectedComposerEditFilePath：输入框“编辑”入口当前选中文件路径，空字符串表示等待默认选中第一项。
const selectedComposerEditFilePath = ref("");
// projectCapabilityDialogVisible：项目能力详情弹框显隐，只属于当前客户端 UI 状态。
const projectCapabilityDialogVisible = ref(false);
// usageTotalChartRef：总量图表 DOM 容器。
const usageTotalChartRef = ref<HTMLElement | null>(null);
// usageProviderChartRef：供应商维度图表 DOM 容器。
const usageProviderChartRef = ref<HTMLElement | null>(null);
// usageProjectChartRef：项目维度图表 DOM 容器。
const usageProjectChartRef = ref<HTMLElement | null>(null);
// usageTotalChart：总量图表实例。
let usageTotalChart: ECharts | null = null;
// usageProviderChart：供应商维度图表实例。
let usageProviderChart: ECharts | null = null;
// usageProjectChart：项目维度图表实例。
let usageProjectChart: ECharts | null = null;
// messages：当前会话消息列表。
const messages = computed(() => appStore.sessionDetail?.messages ?? []);
// normalSessions：普通会话列表，来源于中心服务 sessionType 字段。
const normalSessions = computed(() => appStore.sessions.filter((session) => session.sessionType === "normal"));
// activeSessionTitle：顶部标题使用当前会话标题，没有会话时展示固定入口名。
const activeSessionTitle = computed(() => appStore.sessionDetail?.session.title ?? "对话");
// agentStatusEvents：智能体状态来源于中心服务事件日志，不在右栏展示中心服务配置摘要。
const agentStatusEvents = computed(() => appStore.events.filter((event) => {
  return event.eventType.includes("agent");
}).slice(-6));
// auditSummaryEvents：右栏审计摘要展示最近事件，帮助用户追踪任务、工具和协作过程。
const auditSummaryEvents = computed(() => appStore.events.slice(-8).reverse());
// agentStatusTreeRows：把智能体状态树压平为带层级的状态树行。
const agentStatusTreeRows = computed<AgentStatusTreeRow[]>(() => {
  return flattenAgentTreeRows(
    appStore.agentStatusTree,
    0,
  );
});
// selectedAgentConversationMessages：智能体对话列表复用当前会话消息，后续独立 API 明确后可替换来源。
const selectedAgentConversationMessages = computed(() => {
  return messages.value.map((message) => {
    return {
      messageId: message.messageId,
      role: message.role,
      contentMarkdown: message.contentMarkdown,
    };
  });
});
// activeTaskPanelRows：输入框“任务”入口展示当前任务，没有任务时给出当前会话内空闲说明。
const activeTaskPanelRows = computed(() => {
  if (appStore.activeTasks.length > 0) {
    return appStore.activeTasks.map((task) => {
      return {
        id: task.taskId,
        title: task.title,
        status: formatTaskStatus(task.status),
        summary: resolveTaskStatusMeta(task.status).title,
      };
    });
  }

  return [
    {
      id: "composer-task-idle",
      title: "当前对话暂无编排任务",
      status: "空闲",
      summary: "发送消息后，本入口展示本轮任务、阶段和当前对话内排队状态。",
    },
  ];
});
// activeComposerEditFile：输入框“编辑”入口展示当前选中文件；没有真实编辑事件时返回 null 并显示空态。
const activeComposerEditFile = computed(() => {
  const selectedFile = appStore.composerEditFiles.find((file) => {
    return file.filePath === selectedComposerEditFilePath.value;
  });
  // firstFile：默认选中第一条真实编辑记录；协议未齐备时列表为空，不伪造 diff。
  const [
    firstFile,
  ] = appStore.composerEditFiles;
  return selectedFile ?? firstFile ?? null;
});
// nowTick：运行中轮次耗时展示使用的本地时钟，只影响 UI 文案，不写入中心服务事实。
const nowTick = ref(Date.now());
// activeRunningTurn：当前会话中尚未结束的最新轮次。
const activeRunningTurn = computed(() => {
  return [...(appStore.sessionDetail?.turns ?? [])].reverse().find((turn) => {
    return turn.endedAt === null && (turn.status === "running" || turn.status === "waiting_user");
  }) ?? null;
});
// activeTurnElapsedText：输入框上方固定展示的本轮已耗时。
const activeTurnElapsedText = computed(() => {
  if (!activeRunningTurn.value) {
    return "";
  }

  const startedAt = new Date(activeRunningTurn.value.startedAt).getTime();
  if (Number.isNaN(startedAt)) {
    return "本轮处理中";
  }

  return formatDurationMs(Math.max(0, nowTick.value - startedAt));
});
// elapsedTimer：运行中轮次耗时刷新计时器。
const elapsedTimer = window.setInterval(() => {
  nowTick.value = Date.now();
}, 1000);
// managementPageError：当前管理页最近一次接口错误，来源于 store 层捕获结果。
const managementPageError = computed(() => {
  if (activePage.value === "providers") {
    return appStore.managementErrors.providers;
  }
  if (activePage.value === "proxies") {
    return appStore.managementErrors.proxies;
  }
  if (activePage.value === "runtimes") {
    return appStore.managementErrors.runtimes;
  }
  if (activePage.value === "usage") {
    return appStore.managementErrors.usage;
  }
  if (activePage.value === "plugins") {
    return appStore.managementErrors.plugins;
  }
  if (activePage.value === "mcp") {
    return appStore.managementErrors.mcp;
  }
  if (activePage.value === "skills") {
    return appStore.managementErrors.skills;
  }

  return "";
});
// selectedProviderModelOptions：当前编辑供应商已保存或刷新得到的模型列表。
const selectedProviderModelOptions = computed(() => {
  const providerId = appStore.providerDraft.providerId;
  if (!providerId) {
    return [];
  }

  return appStore.providerModelOptions[providerId]?.models ?? [];
});
// providerModelSourceText：默认模型下拉的数据来源说明。
const providerModelSourceText = computed(() => {
  if (!appStore.providerDraft.providerId) {
    return "模型列表来源：新增供应商保存后，可通过刷新模型列表获得下拉选项。";
  }

  if (selectedProviderModelOptions.value.length > 0) {
    return "模型列表来源：中心服务已保存或刚刷新得到的供应商模型列表。";
  }

  return "模型列表来源：该供应商未提供模型列表接口或当前刷新失败，模型名称由用户手动维护。";
});
// composerModelSourceText：输入区模型选择来源说明，提醒只影响后续发送。
const composerModelSourceText = computed(() => {
  if (!appStore.composerSettings.selectedProviderId) {
    return "";
  }

  if (appStore.composerSelectedModelOptions.length > 0) {
    return "模型来源：当前启用供应商已保存或刷新得到的模型列表；切换只影响后续发送，不回改历史消息。";
  }

  return "模型来源：该供应商未提供模型列表接口或当前刷新失败，模型名称由用户手动维护；切换只影响后续发送。";
});
// projectCapabilityDialogRows：项目能力详情弹框直接使用 store 中的结构化能力项，避免硬编码伪造启用状态。
const projectCapabilityDialogRows = computed(() => {
  const summary = appStore.projectCapabilitySummary;
  if (!summary) {
    return [];
  }

  return [
    ...summary.plugins,
    ...summary.mcpServers,
    ...summary.skills,
  ];
});
// workspaceMenuItems：主工作台共用的顶部菜单，中心服务项受桌面壳能力限制。
const workspaceMenuItems: WorkspaceMenuItem[] = [
  {
    page: "chat",
    label: "对话",
    desktopOnly: false,
  },
  {
    page: "agent-management",
    label: "智能体管理",
    desktopOnly: false,
  },
  {
    page: "providers",
    label: "供应商",
    desktopOnly: false,
  },
  {
    page: "proxies",
    label: "网络代理",
    desktopOnly: false,
  },
  {
    page: "runtimes",
    label: "运行环境",
    desktopOnly: false,
  },
  {
    page: "usage",
    label: "用量统计",
    desktopOnly: false,
  },
  {
    page: "plugins",
    label: "插件",
    desktopOnly: false,
  },
  {
    page: "mcp",
    label: "MCP",
    desktopOnly: false,
  },
  {
    page: "skills",
    label: "skill",
    desktopOnly: false,
  },
  {
    page: "center",
    label: "中心服务",
    desktopOnly: true,
  },
];
// visibleMenuItems：顶部主菜单按宿主能力过滤；浏览器端不展示中心服务入口，避免误导用户以为 Web 端能启停中心服务。
const visibleMenuItems = computed(() => workspaceMenuItems.filter((item) => {
  return !item.desktopOnly || appStore.runtime.capabilities.canManageCenterService;
}));
// executionModeOptions：执行模式完整下拉，来源于需求中的三种执行模式。
const executionModeOptions: SelectOption[] = [
  {
    value: "suggest",
    label: "建议模式",
    description: "每一步副作用操作都需要确认",
  },
  {
    value: "auto_edit",
    label: "自动编辑",
    description: "低风险读取自动执行，高风险操作确认",
  },
  {
    value: "full_auto",
    label: "全自动",
    description: "在权限范围内自动执行",
  },
];
// reasoningEffortOptions：推理深度内置下拉；动态供应商推理深度接入前先提供明确中文解释。
const reasoningEffortOptions: SelectOption[] = [
  {
    value: "low",
    label: "低推理",
    description: "更快响应，适合简单问题",
  },
  {
    value: "medium",
    label: "中推理",
    description: "默认平衡速度和质量",
  },
  {
    value: "high",
    label: "高推理",
    description: "更充分分析复杂任务",
  },
  {
    value: "xhigh",
    label: "超高推理",
    description: "最充分分析，耗时更长",
  },
];

/**
 * switchPage：切换顶部工作台页面。
 *
 * @param page 目标页面。
 * @returns 没有返回值。
 */
function switchPage(page: WorkspacePage): void {
  activePage.value = page;
  void loadPageData(page);
}

/**
 * flattenAgentTreeRows：把子智能体树转换为渲染行。
 *
 * @param nodes 当前层级节点数组。
 * @param level 当前层级，根节点为 0。
 * @returns 带层级信息的渲染行。
 */
function flattenAgentTreeRows(
    nodes: AgentStatusTreeNode[],
    level: number,
): AgentStatusTreeRow[] {
  return nodes.flatMap((node) => {
    return [
      {
        node,
        level,
      },
      ...flattenAgentTreeRows(
        node.children,
        level + 1,
      ),
    ];
  });
}

/**
 * openComposerMiniDialog：打开输入区三段入口小弹框。
 *
 * @param entry 入口类型。
 * @returns 没有返回值。
 */
function openComposerMiniDialog(entry: ComposerEntryKind): void {
  activeComposerEntry.value = entry;
  composerMiniDialogVisible.value = true;
  if (entry === "agentStatus" && !selectedAgentStatusNode.value) {
    const [
      firstNode,
    ] = agentStatusTreeRows.value;
    selectedAgentStatusNode.value = firstNode?.node ?? null;
  }
}

/**
 * selectAgentStatusNode：切换智能体状态弹框当前节点。
 *
 * @param node 被点击的智能体状态节点。
 * @returns 没有返回值。
 */
function selectAgentStatusNode(node: AgentStatusTreeNode): void {
  selectedAgentStatusNode.value = node;
}

/**
 * sendAgentConversationDraft：向当前智能体发送消息。
 *
 * @returns 没有返回值。
 */
async function sendAgentConversationDraft(): Promise<void> {
  if (!selectedAgentStatusNode.value) {
    return;
  }

  const messageText = agentConversationDraft.value.trim();
  if (messageText.length === 0) {
    return;
  }

  // 当前中心服务没有独立智能体会话 API，所以这里明确基于现有会话消息接口发送；消息前缀保留目标智能体，后续协议明确后替换为专用 API。
  appStore.draft.text = `@${selectedAgentStatusNode.value.name} ${messageText}\n\n（仍通过当前会话发送）`;
  agentConversationDraft.value = "";
  await appStore.sendDraft();
}

/**
 * selectComposerEditFile：切换输入框“编辑”入口当前 diff 文件。
 *
 * @param file 用户点击的编辑文件记录。
 * @returns 没有返回值。
 */
function selectComposerEditFile(file: ComposerEditFile): void {
  selectedComposerEditFilePath.value = file.filePath;
}

/**
 * openProjectFileContextPicker：复用现有 @ 项目引用候选作为文件上下文入口。
 *
 * @returns 没有返回值。
 */
function openProjectFileContextPicker(): void {
  if (!appStore.canUseProjectReferences) {
    // 文件上下文选择依赖当前输入区的项目 ID；这里使用 Element Plus 可见消息，避免只写入当前页面未渲染的错误状态。
    ElMessage.warning("当前输入区没有项目上下文，不能选择文件上下文。");
    return;
  }

  // 通过现有 projectReferenceSuggestions 与 insertProjectReference 链路展示文件、文件夹和代码位置候选，避免新增一套临时上下文协议。
  appStore.projectReferenceQuery = "";
  appStore.showProjectReferencePopover = true;
}

/**
 * formatConnectionState：把连接状态协议值转成中文。
 *
 * @param state 当前连接状态。
 * @returns 中文状态。
 */
function formatConnectionState(state: string): string {
  const labels: Record<string, string> = {
    connecting: "连接中",
    open: "已连接",
    retrying: "重连中",
    stopped: "已停止",
  };

  return labels[state] ?? "未知状态";
}

/**
 * formatTaskStatus：把任务和轮次状态协议值转成中文。
 *
 * @param status 状态协议值。
 * @returns 中文状态。
 */
function formatTaskStatus(status: string): string {
  const labels: Record<string, string> = {
    queued: "排队中",
    running: "执行中",
    waiting_user: "等待用户",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };

  return labels[status] ?? "未知状态";
}

/**
 * sessionTooltipContent：生成对话行 tooltip。
 *
 * @param session 会话记录。
 * @returns 完整标题和统一格式时间。
 */
function sessionTooltipContent(session: ConversationSession): string {
  return `${session.title}\n用户发出：${sessionUserPreview(session)}\n${formatDisplayTime(session.updatedAt)}`;
}

/**
 * sessionUserPreview：生成会话行 hover 的用户消息摘要。
 *
 * @param session 会话记录。
 * @returns 用户最近发送内容摘要。
 */
function sessionUserPreview(session: ConversationSession): string {
  const currentUserMessage = session.sessionId === appStore.sessionDetail?.session.sessionId
    ? [...messages.value].reverse().find((message) => {
      return message.role === "user";
    })?.contentMarkdown
    : session.lastUserMessagePreview;
  const normalized = (currentUserMessage ?? "").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    return "暂无用户消息，打开后读取消息详情";
  }

  return normalized.length > 80
    ? `${normalized.slice(0, 80)}...`
    : normalized;
}

/**
 * resolveSessionStatusMeta：计算对话状态图标。
 *
 * @param session 会话记录。
 * @returns 状态图标元信息。
 */
function resolveSessionStatusMeta(session: ConversationSession): NavigationStatusMeta {
  const status = appStore.sessionDetail?.session.sessionId === session.sessionId
    ? appStore.activeTasks[0]?.status
    : undefined;

  return resolveTaskStatusMeta(status);
}

/**
 * resolveProjectStatusMeta：计算项目级状态图标。
 *
 * @param project 项目记录。
 * @returns 状态图标元信息。
 */
function resolveProjectStatusMeta(project: ProjectRecord): NavigationStatusMeta {
  const projectTask = appStore.sessionDetail?.session.projectId === project.projectId
    ? appStore.activeTasks[0]
    : undefined;

  return resolveTaskStatusMeta(projectTask?.status);
}

/**
 * projectTooltipContent：生成项目行详情提示。
 *
 * @param project 项目记录。
 * @returns 项目文件夹名或未登记状态，以及项目 ID。
 */
function projectTooltipContent(project: ProjectRecord): string {
  const nameLine = project.displayName === "未登记项目名称"
    ? "项目名称：未登记项目名称"
    : `项目文件夹名：${project.displayName}`;
  const aliasLine = project.alias
    ? `备注：${project.alias}`
    : "备注：无";
  return `${nameLine}\n项目 ID：${project.projectId}\n${aliasLine}`;
}

/**
 * resolveTaskStatusMeta：把任务状态映射为左侧导航图标。
 *
 * @param status 任务状态协议值。
 * @returns 状态图标元信息。
 */
function resolveTaskStatusMeta(status: TaskStatus | undefined): NavigationStatusMeta {
  if (status === "running") {
    return {
      icon: Loading,
      title: "执行中",
      tone: "running",
    };
  }
  if (status === "queued") {
    return {
      icon: Clock,
      title: "排队中：仅表示当前对话内等待上一项处理，多个对话框可并发执行",
      tone: "queued",
    };
  }
  if (status === "waiting_user") {
    return {
      icon: Warning,
      title: "等待用户：引导/审批/需要用户确认归属当前对话当前轮次",
      tone: "waiting",
    };
  }
  if (status === "failed" || status === "cancelled") {
    return {
      icon: CircleClose,
      title: status === "failed" ? "失败" : "已取消",
      tone: "failed",
    };
  }
  if (status === "completed") {
    return {
      icon: CircleCheck,
      title: "已完成",
      tone: "completed",
    };
  }

  return {
    icon: CircleCheck,
    title: "空闲",
    tone: "idle",
  };
}

/**
 * handleProjectRowCreate：从项目行新增项目对话。
 *
 * @param project 项目记录。
 * @returns 没有返回值。
 */
function handleProjectRowCreate(project: ProjectRecord): void {
  void appStore.createProjectConversationForProject(project);
}

/**
 * handleProjectHeaderCreate：从项目对话标题新增入口创建对话。
 *
 * @returns 没有返回值。
 */
function handleProjectHeaderCreate(): void {
  const firstProject = appStore.projects[0];
  if (!firstProject) {
    appStore.lastError = "新增项目入口待接入项目登记流程。";
    return;
  }

  void appStore.createProjectConversationForProject(firstProject);
}

/**
 * stopNavigationAction：阻止行内图标按钮触发选中或展开。
 *
 * @param event 鼠标事件。
 * @returns 没有返回值。
 */
function stopNavigationAction(event: MouseEvent): void {
  event.stopPropagation();
}

/**
 * loadPageData：按当前顶部页面加载中心服务事实数据。
 *
 * @param page 目标页面。
 * @returns 加载完成后没有返回值。
 */
async function loadPageData(page: WorkspacePage): Promise<void> {
  if (page === "providers") {
    await appStore.loadProviders();
  }
  if (page === "agent-management") {
    await appStore.loadAgents();
  }
  if (page === "proxies") {
    await appStore.loadProxies();
  }
  if (page === "runtimes") {
    await appStore.loadRuntimes();
  }
  if (page === "usage") {
    await appStore.loadUsageStatistics();
    await nextTick();
    renderUsageCharts();
  }
  if (page === "plugins") {
    await appStore.loadPlugins();
  }
  if (page === "mcp") {
    await appStore.loadMcpConfigs();
  }
  if (page === "skills") {
    await appStore.loadSkills();
  }
}

/**
 * formatDisplayTime：统一格式化前端展示时间。
 *
 * @param value ISO 时间、空值或服务端时间字符串。
 * @returns `YYYY-MM-DD HH:mm:ss`，无值时返回“未保存”。
 */
function formatDisplayTime(value: string | null | undefined): string {
  if (!value) {
    return "未保存";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + " " + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(":");
}

/**
 * formatDurationMs：格式化轮次耗时。
 *
 * @param durationMs 持续毫秒数。
 * @returns 中文耗时。
 */
function formatDurationMs(durationMs: number | null | undefined): string {
  if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
    return "未结束";
  }

  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }

  return `${seconds}秒`;
}

/**
 * findTurnForMessage：按消息 turnId 找到所属轮次。
 *
 * @param message 会话消息。
 * @returns 所属轮次；无轮次时返回 null。
 */
function findTurnForMessage(message: ConversationMessage): ConversationTurn | null {
  if (!message.turnId) {
    return null;
  }

  return appStore.sessionDetail?.turns.find((turn) => {
    return turn.turnId === message.turnId;
  }) ?? null;
}

/**
 * shouldShowTurnTimeFooter：判断当前消息后是否展示轮次时间尾注。
 *
 * @param message 当前消息。
 * @param messageIndex 当前消息索引。
 * @returns 当前消息是所属轮次最后一条消息时返回 true。
 */
function shouldShowTurnTimeFooter(
    message: ConversationMessage,
    messageIndex: number,
): boolean {
  if (!message.turnId) {
    return false;
  }

  const turn = findTurnForMessage(message);
  if (!turn?.endedAt) {
    return false;
  }

  const nextMessage = messages.value[messageIndex + 1];
  return !nextMessage || nextMessage.turnId !== message.turnId;
}

/**
 * formatTurnTimeFooter：生成轮次末尾时间文案。
 *
 * @param turn 轮次记录。
 * @returns 开始、结束和耗时文案。
 */
function formatTurnTimeFooter(turn: ConversationTurn): string {
  const endedText = formatDisplayTime(turn.endedAt);
  const durationText = formatDurationMs(turn.durationMs);
  return `第 ${turn.turnNumber} 轮 · 开始 ${formatDisplayTime(turn.startedAt)} · 结束 ${endedText} · 耗时 ${durationText}`;
}

/**
 * selectSession：选择会话并加载详情。
 *
 * @param sessionId 会话 ID。
 * @returns 没有返回值。
 */
function selectSession(sessionId: string): void {
  appStore.activeSessionId = sessionId;
  void appStore.loadActiveSessionDetail();
}

/**
 * openProjectCapabilityDialog：打开项目能力详情弹框。
 *
 * @returns 没有返回值。
 */
function openProjectCapabilityDialog(): void {
  projectCapabilityDialogVisible.value = true;
}

/**
 * formatUsageRecordForDisplay：递归格式化用量记录中的时间字段。
 *
 * @param value 中心服务返回的用量记录或聚合记录。
 * @returns 时间字段已转为 `YYYY-MM-DD HH:mm:ss` 的展示副本。
 */
function formatUsageRecordForDisplay(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => formatUsageRecordForDisplay(item));
  }

  if (value !== null && typeof value === "object") {
    const formatted: Record<string, unknown> = {};
    for (const [
      fieldName,
      fieldValue,
    ] of Object.entries(value)) {
      // fieldName: 服务端用量、事件和配置协议中的时间字段统一以后缀 At 或 Date 表达，展示前必须格式化。
      if (typeof fieldValue === "string" && isDisplayTimeField(fieldName, fieldValue)) {
        formatted[fieldName] = formatDisplayTime(fieldValue);
      } else {
        formatted[fieldName] = formatUsageRecordForDisplay(fieldValue);
      }
    }
    return formatted;
  }

  return value;
}

/**
 * formatUsageJson：把用量记录展示副本格式化为 JSON。
 *
 * @param value 中心服务返回的用量记录或聚合记录。
 * @returns 不含 ISO 时间直出的 JSON 字符串。
 */
function formatUsageJson(value: unknown): string {
  return JSON.stringify(formatUsageRecordForDisplay(value), null, 2);
}

/**
 * isDisplayTimeField：判断字段是否需要按 UI 时间格式展示。
 *
 * @param fieldName 字段名。
 * @param value 字段值。
 * @returns 属于时间字段且可解析为时间时返回 true。
 */
function isDisplayTimeField(fieldName: string, value: string): boolean {
  const normalizedName = fieldName.toLowerCase();
  const isTimeName = normalizedName.endsWith("at")
    || normalizedName.endsWith("date")
    || normalizedName.includes("time");
  if (!isTimeName) {
    return false;
  }

  return !Number.isNaN(new Date(value).getTime());
}

/**
 * renderUsageCharts：根据聚合统计刷新用量图表。
 *
 * @returns 没有返回值。
 */
function renderUsageCharts(): void {
  if (!usageTotalChartRef.value || !usageProviderChartRef.value || !usageProjectChartRef.value) {
    return;
  }

  const rows = appStore.usageAggregate.map(normalizeUsageAggregateRecord);
  usageTotalChart = usageTotalChart ?? init(usageTotalChartRef.value);
  usageProviderChart = usageProviderChart ?? init(usageProviderChartRef.value);
  usageProjectChart = usageProjectChart ?? init(usageProjectChartRef.value);

  usageTotalChart.setOption({
    tooltip: {},
    xAxis: {
      type: "category",
      data: [
        "输入",
        "输出",
        "总量",
        "调用",
      ],
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        type: "bar",
        data: [
          sumUsage(rows, "inputTokens"),
          sumUsage(rows, "outputTokens"),
          sumUsage(rows, "totalTokens"),
          sumUsage(rows, "callCount"),
        ],
      },
    ],
  });

  usageProviderChart.setOption({
    tooltip: {
      trigger: "item",
    },
    legend: {
      bottom: 0,
    },
    series: [
      {
        type: "pie",
        radius: [
          "42%",
          "70%",
        ],
        data: groupUsageBy(rows, "providerId"),
      },
    ],
  });

  usageProjectChart.setOption({
    tooltip: {},
    xAxis: {
      type: "category",
      data: groupUsageBy(rows, "projectId").map((item) => item.name),
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        type: "bar",
        data: groupUsageBy(rows, "projectId").map((item) => item.value),
      },
    ],
  });
}

watch(
  () => appStore.usageAggregate,
  () => {
    if (activePage.value === "usage") {
      void nextTick(renderUsageCharts);
    }
  },
  {
    deep: true,
  },
);

watch(
  () => appStore.composerEditFiles,
  (files) => {
    if (files.length === 0) {
      selectedComposerEditFilePath.value = "";
      return;
    }

    const hasSelectedFile = files.some((file) => {
      return file.filePath === selectedComposerEditFilePath.value;
    });
    if (!hasSelectedFile) {
      // 默认选中第一条真实文件编辑记录；中心服务未返回编辑事件时保持空选中。
      const [
        firstFile,
      ] = files;
      selectedComposerEditFilePath.value = firstFile.filePath;
    }
  },
  {
    immediate: true,
    deep: true,
  },
);

onBeforeUnmount(() => {
  window.clearInterval(elapsedTimer);
  usageTotalChart?.dispose();
  usageProviderChart?.dispose();
  usageProjectChart?.dispose();
});

/**
 * normalizeUsageAggregateRecord：把中心服务聚合记录转换为图表需要的明确字段。
 *
 * @param value 聚合统计记录。
 * @returns 图表统计字段。
 */
function normalizeUsageAggregateRecord(value: unknown): {
  providerId: string;
  projectId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
} {
  const record = value as {
    providerId?: unknown;
    projectId?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
    callCount?: unknown;
  };

  return {
    providerId: typeof record.providerId === "string"
      ? record.providerId
      : "未知供应商",
    projectId: typeof record.projectId === "string"
      ? record.projectId
      : "全局",
    inputTokens: typeof record.inputTokens === "number"
      ? record.inputTokens
      : 0,
    outputTokens: typeof record.outputTokens === "number"
      ? record.outputTokens
      : 0,
    totalTokens: typeof record.totalTokens === "number"
      ? record.totalTokens
      : 0,
    callCount: typeof record.callCount === "number"
      ? record.callCount
      : 0,
  };
}

/**
 * sumUsage：按字段汇总用量数值。
 *
 * @param rows 聚合记录。
 * @param field 需要汇总的字段。
 * @returns 汇总值。
 */
function sumUsage(
    rows: Array<ReturnType<typeof normalizeUsageAggregateRecord>>,
    field: "inputTokens" | "outputTokens" | "totalTokens" | "callCount",
): number {
  return rows.reduce((total, row) => total + row[field], 0);
}

/**
 * groupUsageBy：按供应商或项目归集总 token。
 *
 * @param rows 聚合记录。
 * @param field 分组字段。
 * @returns ECharts 数据数组。
 */
function groupUsageBy(
    rows: Array<ReturnType<typeof normalizeUsageAggregateRecord>>,
    field: "providerId" | "projectId",
): Array<{
  name: string;
  value: number;
}> {
  const groups = new Map<string, number>();
  for (const row of rows) {
    groups.set(
      row[field],
      (groups.get(row[field]) ?? 0) + row.totalTokens,
    );
  }

  return Array.from(groups.entries()).map(([name, value]) => ({
    name,
    value,
  }));
}
</script>

<template>
  <main
      v-if="appStore.entryMode === 'mobile'"
      class="mobile-shell"
  >
    <van-nav-bar
        title="致心智能体"
        :border="false"
    >
      <template #right>
        <button
            class="theme-toggle mobile-theme-toggle"
            type="button"
            :title="appStore.themeMode === 'dark' ? '切换亮色主题' : '切换暗黑主题'"
            @click="appStore.toggleTheme"
        >
          <span class="theme-icon">
            {{ appStore.themeMode === "dark" ? "☀" : "☾" }}
          </span>
        </button>
      </template>
    </van-nav-bar>
    <section class="mobile-message-list">
      <van-cell
          v-for="message in messages"
          :key="message.messageId"
          :title="message.role"
          :label="message.contentMarkdown"
      />
      <van-empty
          v-if="messages.length === 0"
          description="暂无消息"
      />
    </section>
    <footer class="mobile-composer">
      <van-field
          v-model="appStore.draft.text"
          rows="2"
          autosize
          type="textarea"
          placeholder="输入消息"
          @paste="appStore.handleComposerPaste"
          @update:model-value="appStore.updateProjectReferenceQuery"
      />
      <van-button
          type="primary"
          block
          @click="appStore.sendDraft"
      >
        发送
      </van-button>
    </footer>
  </main>

  <main
      v-else
      :class="[
      'app-shell',
      appStore.entryMode === 'plugin-compact' ? 'plugin-shell' : 'workspace-shell',
    ]"
  >
    <section class="workspace">
      <header
          v-if="appStore.entryMode !== 'plugin-compact'"
          class="topbar"
      >
        <nav class="top-menu">
          <button
              v-for="item in visibleMenuItems"
              :key="item.page"
              class="top-menu-item"
              :class="{ active: activePage === item.page }"
              @click="switchPage(item.page)"
          >
            {{ item.label }}
          </button>
        </nav>
        <div class="topbar-status">
          <strong>{{ formatConnectionState(appStore.connectionState) }}</strong>
          <button
              class="theme-toggle"
              type="button"
              :title="appStore.themeMode === 'dark' ? '切换亮色主题' : '切换暗黑主题'"
              @click="appStore.toggleTheme"
          >
            <span class="theme-icon">
              {{ appStore.themeMode === "dark" ? "☀" : "☾" }}
            </span>
          </button>
        </div>
      </header>

      <section
          v-if="activePage === 'chat' || appStore.entryMode === 'plugin-compact'"
          class="content-grid"
      >
        <aside
            v-if="appStore.entryMode !== 'plugin-compact'"
            class="conversation-sidebar"
        >
          <section
              v-if="appStore.entryMode !== 'plugin-compact'"
              class="conversation-group"
          >
            <div class="conversation-group-header">
              <h2>项目对话</h2>
              <button
                  class="conversation-icon-button create-project-entry-button"
                  type="button"
                  title="新增项目对话"
                  @click="handleProjectHeaderCreate"
              >
                <el-icon>
                  <FolderAdd/>
                </el-icon>
              </button>
            </div>
            <div class="conversation-group-body">
              <el-empty
                  v-if="appStore.projectConversationGroups.length === 0"
                  description="暂无项目对话"
              />
              <div
                  v-for="group in appStore.projectConversationGroups"
                  :key="group.project.projectId"
                  class="project-conversation-tree"
              >
                <el-tooltip
                    placement="right"
                    :content="projectTooltipContent(group.project)"
                >
                  <div
                      class="conversation-item project-row"
                      data-nav-kind="project"
                      role="button"
                      tabindex="0"
                      @click="appStore.toggleProjectExpanded(group.project.projectId)"
                      @keydown.enter="appStore.toggleProjectExpanded(group.project.projectId)"
                  >
                    <span class="conversation-row-main">
                      <el-icon class="project-toggle-icon">
                        <ArrowDown v-if="group.expanded"/>
                        <ArrowRight v-else/>
                      </el-icon>
                      <el-icon class="project-folder-icon">
                        <FolderOpened v-if="group.expanded"/>
                        <Folder v-else/>
                      </el-icon>
                      <span class="conversation-title">
                        {{ group.project.displayName }}
                      </span>
                      <small
                          v-if="group.project.alias"
                          class="project-note"
                      >
                        {{ group.project.alias }}
                      </small>
                    </span>
                    <span class="conversation-row-trailing">
                      <el-icon
                          class="conversation-status-icon"
                          :class="`status-${resolveProjectStatusMeta(group.project).tone}`"
                          :title="resolveProjectStatusMeta(group.project).title"
                      >
                        <component :is="resolveProjectStatusMeta(group.project).icon"/>
                      </el-icon>
                      <span class="conversation-row-actions">
                        <button
                            class="conversation-icon-button"
                            type="button"
                            title="删除项目"
                            @click="stopNavigationAction($event); appStore.deleteProjectPlaceholder(group.project.projectId)"
                        >
                          <el-icon>
                            <Delete/>
                          </el-icon>
                        </button>
                        <button
                            class="conversation-icon-button"
                            type="button"
                            title="新增项目对话"
                            @click="stopNavigationAction($event); handleProjectRowCreate(group.project)"
                        >
                          <el-icon>
                            <Plus/>
                          </el-icon>
                        </button>
                      </span>
                    </span>
                  </div>
                </el-tooltip>
                <div
                    v-if="group.expanded"
                    class="project-session-list"
                >
                  <el-empty
                      v-if="group.sessions.length === 0"
                      description="暂无项目对话"
                  />
                  <el-tooltip
                      v-for="session in group.sessions"
                      :key="session.sessionId"
                      placement="right"
                      :content="sessionTooltipContent(session)"
                  >
                    <div
                        class="conversation-item project-session-row"
                        data-nav-kind="project-session"
                        :class="{ active: session.sessionId === appStore.activeSessionId }"
                        role="button"
                        tabindex="0"
                        @click="selectSession(session.sessionId)"
                        @keydown.enter="selectSession(session.sessionId)"
                    >
                      <span class="conversation-row-main">
                        <el-icon class="session-kind-icon">
                          <ChatDotRound/>
                        </el-icon>
                        <span class="conversation-title">{{ session.title }}</span>
                      </span>
                      <span class="conversation-row-trailing">
                        <small class="conversation-time-node">
                          {{ formatDisplayTime(session.updatedAt) }}
                        </small>
                        <span class="conversation-row-actions">
                          <button
                              class="conversation-icon-button"
                              type="button"
                              title="删除对话"
                              @click="stopNavigationAction($event); appStore.deleteConversationPlaceholder(session.sessionId)"
                          >
                            <el-icon>
                              <Delete/>
                            </el-icon>
                          </button>
                        </span>
                      </span>
                    </div>
                  </el-tooltip>
                </div>
              </div>
            </div>
          </section>

          <section class="conversation-group">
            <div class="conversation-group-header">
              <h2>普通对话</h2>
              <button
                  v-if="appStore.entryMode !== 'plugin-compact'"
                  class="conversation-icon-button create-normal-session-button"
                  type="button"
                  title="新增普通对话"
                  @click="appStore.createNormalSession"
              >
                <el-icon>
                  <Plus/>
                </el-icon>
              </button>
            </div>
            <div class="conversation-group-body">
              <el-empty
                  v-if="normalSessions.length === 0 && appStore.entryMode !== 'plugin-compact'"
                  description="暂无普通对话"
              />
              <el-tooltip
                  v-for="session in appStore.entryMode === 'plugin-compact' ? appStore.sessions : normalSessions"
                  :key="session.sessionId"
                  placement="right"
                  :content="sessionTooltipContent(session)"
              >
                <div
                    class="conversation-item normal-session-row"
                    data-nav-kind="normal-session"
                    :class="{ active: session.sessionId === appStore.activeSessionId }"
                    role="button"
                    tabindex="0"
                    @click="selectSession(session.sessionId)"
                    @keydown.enter="selectSession(session.sessionId)"
                >
                  <span class="conversation-row-main">
                    <el-icon class="session-kind-icon">
                      <ChatDotRound/>
                    </el-icon>
                    <span class="conversation-title">{{ session.title }}</span>
                  </span>
                      <span class="conversation-row-trailing">
                    <small class="conversation-time-node">
                      {{ formatDisplayTime(session.updatedAt) }}
                    </small>
                    <span class="conversation-row-actions">
                      <button
                          class="conversation-icon-button"
                          type="button"
                          title="删除对话"
                          @click="stopNavigationAction($event); appStore.deleteConversationPlaceholder(session.sessionId)"
                      >
                        <el-icon>
                          <Delete/>
                        </el-icon>
                      </button>
                    </span>
                  </span>
                  <span class="session-tooltip-content">
                    {{ sessionTooltipContent(session) }}
                  </span>
                </div>
              </el-tooltip>
            </div>
          </section>
        </aside>

        <article class="chat-surface">
          <section
              v-if="appStore.entryMode === 'plugin-compact'"
              class="plugin-top-tabs"
          >
            <button
                v-for="session in appStore.sessions"
                :key="session.sessionId"
                class="plugin-top-tab"
                :class="{ active: session.sessionId === appStore.activeSessionId }"
                type="button"
                @click="selectSession(session.sessionId)"
            >
              <span>{{ session.title }}</span>
              <small>{{ resolveSessionStatusMeta(session).title }}</small>
            </button>
            <button
                class="plugin-top-tab add"
                type="button"
                title="新增项目页签"
                @click="appStore.createProjectConversationTab"
            >
              <el-icon>
                <Plus/>
              </el-icon>
            </button>
          </section>

          <header class="chat-header">
            <div>
              <h1>{{ activeSessionTitle }}</h1>
              <span
                  v-if="appStore.entryMode === 'plugin-compact' && appStore.runtime.projectContext"
                  class="plugin-project-name"
              >
                当前项目：{{ appStore.runtime.projectContext.displayName }}
              </span>
              <span>{{ formatConnectionState(appStore.connectionState) }}</span>
            </div>
            <div class="chat-header-actions">
              <button
                  v-if="appStore.entryMode === 'plugin-compact'"
                  class="theme-toggle chat-theme-toggle"
                  type="button"
                  :title="appStore.themeMode === 'dark' ? '切换亮色主题' : '切换暗黑主题'"
                  @click="appStore.toggleTheme"
              >
                <span class="theme-icon">
                  {{ appStore.themeMode === "dark" ? "☀" : "☾" }}
                </span>
              </button>
              <el-button
                  size="small"
                  @click="appStore.refreshEvents"
              >
                刷新事件
              </el-button>
            </div>
          </header>

          <section
              v-if="appStore.projectCapabilitySummary"
              class="project-capability-summary"
          >
            <el-button
                size="small"
                class="project-capability-entry"
                @click="openProjectCapabilityDialog"
            >
              项目能力详情
            </el-button>
            <span>
              项目级插件 {{ appStore.projectCapabilitySummary.plugins.length }} · MCP {{ appStore.projectCapabilitySummary.mcpServers.length }} · skill {{ appStore.projectCapabilitySummary.skills.length }}
            </span>
          </section>

          <el-dialog
              v-model="projectCapabilityDialogVisible"
              class="project-capability-dialog"
              title="项目能力详情"
              width="720px"
          >
            <section
                v-if="appStore.projectCapabilitySummary"
                class="project-capability-dialog-body"
            >
              <p>
                项目级插件、MCP 和 skill 由打开项目目录扫描，注入当前项目对话上下文，不在全局插件 / MCP / skill 页管理。
              </p>
              <p>
                当前项目 ID：{{ appStore.projectCapabilitySummary.projectId }}
              </p>
              <el-table
                  v-if="projectCapabilityDialogRows.length > 0"
                  :data="projectCapabilityDialogRows"
                  size="small"
              >
                <el-table-column
                    prop="kind"
                    label="类型"
                    width="86"
                />
                <el-table-column
                    prop="name"
                    label="名称"
                />
                <el-table-column
                    prop="source"
                    label="来源"
                />
                <el-table-column
                    prop="scope"
                    label="全局/项目级"
                    width="120"
                />
                <el-table-column
                    prop="status"
                    label="启用状态"
                    width="100"
                />
                <el-table-column
                    prop="unavailableReason"
                    label="不可用原因"
                />
              </el-table>
              <el-empty
                  v-else
                  description="当前项目暂无项目级插件、MCP 或 skill；不可用原因：尚未扫描到项目级能力。"
              />
            </section>
          </el-dialog>

          <el-dialog
              v-model="composerMiniDialogVisible"
              class="composer-mini-dialog"
              :title="activeComposerEntry === 'task' ? '任务' : activeComposerEntry === 'agentStatus' ? '智能体状态' : '编辑'"
              width="720px"
          >
            <section
                v-if="activeComposerEntry === 'task'"
                class="composer-mini-dialog-body composer-task-panel"
            >
              <article
                  v-for="task in activeTaskPanelRows"
                  :key="task.id"
                  class="composer-panel-row"
              >
                <strong>{{ task.title }}</strong>
                <span>{{ task.status }}</span>
                <small>{{ task.summary }}</small>
              </article>
            </section>

            <section
                v-else-if="activeComposerEntry === 'agentStatus'"
                class="composer-mini-dialog-body agent-status-dialog-grid"
            >
              <aside class="agent-status-tree">
                <button
                    v-for="row in agentStatusTreeRows"
                    :key="row.node.agentId"
                    class="composer-agent-node"
                    type="button"
                    :class="{ active: selectedAgentStatusNode?.agentId === row.node.agentId }"
                    :style="{ paddingLeft: `${10 + row.level * 18}px` }"
                    @click="selectAgentStatusNode(row.node)"
                >
                  <span>{{ row.node.name }}</span>
                  <small>{{ row.node.nodeKind }} · {{ row.node.status }}</small>
                </button>
              </aside>
              <section
                  v-if="selectedAgentStatusNode"
                  class="agent-conversation-detail"
              >
                <header>
                  <strong>{{ selectedAgentStatusNode.name }}</strong>
                  <span>{{ selectedAgentStatusNode.nodeKind }} · {{ selectedAgentStatusNode.status }} · {{ selectedAgentStatusNode.taskSummary }}</span>
                </header>
                <p class="panel-muted">
                  {{ selectedAgentStatusNode.conversationHint }} 当前中心服务没有独立智能体会话 API，查看和发送仍通过当前会话发送。
                </p>
                <div class="agent-conversation-list">
                  <article
                      v-for="message in selectedAgentConversationMessages"
                      :key="`${selectedAgentStatusNode.agentId}-${message.messageId}`"
                      :class="[
                      'child-agent-message',
                      message.role,
                    ]"
                  >
                    <div
                        class="markdown-body"
                        v-html="appStore.renderMarkdown(message.contentMarkdown)"
                    />
                  </article>
                  <el-empty
                      v-if="selectedAgentConversationMessages.length === 0"
                      description="暂无该智能体对话记录；当前视图复用当前会话消息。"
                  />
                </div>
                <el-input
                    v-model="agentConversationDraft"
                    type="textarea"
                    :rows="4"
                    placeholder="向当前智能体发送消息"
                />
                <div class="child-agent-dialog-actions">
                  <el-button
                      type="primary"
                      :disabled="agentConversationDraft.trim().length === 0"
                      @click="sendAgentConversationDraft"
                  >
                    发送到当前会话
                  </el-button>
                </div>
              </section>
            </section>

            <section
                v-else
                class="composer-mini-dialog-body composer-edit-panel"
            >
              <el-empty
                  v-if="appStore.composerEditFiles.length === 0"
                  description="暂无本次编辑"
              />
              <button
                  v-for="file in appStore.composerEditFiles"
                  :key="file.filePath"
                  class="composer-edit-file"
                  :class="{ active: activeComposerEditFile?.filePath === file.filePath }"
                  type="button"
                  @click="selectComposerEditFile(file)"
              >
                <header>
                  <strong>{{ file.filePath }}</strong>
                  <span>{{ file.changeKind }} · {{ file.previousEditLabel }} → {{ file.currentEditLabel }}</span>
                </header>
              </button>
              <pre
                  v-if="activeComposerEditFile"
                  class="composer-diff-view"
              ><code
                  v-for="line in activeComposerEditFile.diffLines"
                  :key="`${activeComposerEditFile.filePath}-${line.kind}-${line.content}`"
                  :class="`diff-${line.kind}`"
              >{{ line.content }}
</code></pre>
            </section>
          </el-dialog>

          <section class="message-list">
            <article
                v-for="(message, messageIndex) in messages"
                :key="message.messageId"
                :class="[
                'message-row',
                message.role,
              ]"
            >
              <div
                  class="markdown-body"
                  v-html="appStore.renderMarkdown(message.contentMarkdown)"
              />
              <footer
                  v-if="shouldShowTurnTimeFooter(message, messageIndex) && findTurnForMessage(message)"
                  class="turn-time-footer"
              >
                {{ formatTurnTimeFooter(findTurnForMessage(message)!) }}
              </footer>
            </article>
            <el-empty
                v-if="messages.length === 0"
                description="暂无消息"
            />
          </section>

          <footer class="composer">
            <div
                v-if="activeRunningTurn"
                class="active-turn-elapsed"
            >
              当前轮次已耗时 {{ activeTurnElapsedText }}
            </div>
            <section class="composer-shell">
              <section class="composer-entry-tabs">
                <button
                    class="composer-entry-tab"
                    :class="{ active: activeComposerEntry === 'task' && composerMiniDialogVisible }"
                    type="button"
                    @click="openComposerMiniDialog('task')"
                >
                  任务
                </button>
                <button
                    class="composer-entry-tab"
                    :class="{ active: activeComposerEntry === 'agentStatus' && composerMiniDialogVisible }"
                    type="button"
                    @click="openComposerMiniDialog('agentStatus')"
                >
                  智能体状态
                </button>
                <button
                    class="composer-entry-tab"
                    :class="{ active: activeComposerEntry === 'edit' && composerMiniDialogVisible }"
                    type="button"
                    @click="openComposerMiniDialog('edit')"
                >
                  编辑
                </button>
              </section>

              <div
                  v-if="appStore.draft.attachments.length > 0 || appStore.draft.references.length > 0"
                  class="composer-tags"
              >
                <el-tag
                    v-for="(attachment, index) in appStore.draft.attachments"
                    :key="attachment.temporaryAttachmentId"
                    closable
                    type="info"
                    @close="appStore.removeAttachment(index)"
                >
                  {{ attachment.fileName }}
                </el-tag>
                <el-tag
                    v-for="(reference, index) in appStore.draft.references"
                    :key="`${reference.type}-${index}`"
                    closable
                    type="success"
                    @close="appStore.removeReference(index)"
                >
                  {{ reference.displayName }}
                </el-tag>
              </div>

              <div
                  v-if="appStore.canUseProjectReferences && appStore.showProjectReferencePopover"
                  class="floating-picker"
              >
                <div class="picker-title">@ 项目引用</div>
                <button
                    v-for="suggestion in appStore.projectReferenceSuggestions"
                    :key="suggestion.key"
                    class="floating-picker-option"
                    @click="appStore.insertProjectReference(suggestion)"
                >
                  <strong>{{ suggestion.label }}</strong>
                  <span>{{ suggestion.description }}</span>
                </button>
              </div>

              <section class="composer-input-row">
                <el-input
                    v-model="appStore.draft.text"
                    class="composer-textarea"
                    type="textarea"
                    :autosize="{ minRows: 4, maxRows: 8 }"
                    placeholder="输入消息，Enter 发送，@ 引用项目上下文"
                    @paste="appStore.handleComposerPaste"
                    @input="appStore.updateProjectReferenceQuery"
                    @keyup.enter.exact.prevent="appStore.sendDraft"
                />
              </section>

              <section class="composer-toolbar">
                <div class="composer-tools">
                  <el-button
                      class="composer-tool-button"
                      size="small"
                  >
                    附件
                  </el-button>
                  <el-button
                      class="composer-tool-button"
                      size="small"
                      @click="openProjectFileContextPicker"
                  >
                    文件上下文
                  </el-button>
                </div>
                <div class="composer-controls">
                  <el-select
                      class="composer-model-select"
                      size="small"
                      v-model="appStore.composerSettings.selectedModel"
                      placeholder="模型"
                      filterable
                      allow-create
                      default-first-option
                  >
                    <el-option
                        v-for="model in appStore.composerSelectedModelOptions"
                        :key="model"
                        :label="model"
                        :value="model"
                    />
                  </el-select>
                  <el-select
                      class="composer-mode-select"
                      size="small"
                      v-model="appStore.composerSettings.executionMode"
                  >
                    <el-option
                        v-for="option in executionModeOptions"
                        :key="option.value"
                        :label="option.label"
                        :value="option.value"
                    >
                      <div class="select-option-row">
                        <strong>{{ option.label }}</strong>
                        <small>{{ option.description }}</small>
                      </div>
                    </el-option>
                  </el-select>
                  <el-select
                      class="composer-reasoning-select"
                      size="small"
                      v-model="appStore.composerSettings.reasoningEffort"
                  >
                    <el-option
                        v-for="option in reasoningEffortOptions"
                        :key="option.value"
                        :label="option.label"
                        :value="option.value"
                    >
                      <div class="select-option-row">
                        <strong>{{ option.label }}</strong>
                        <small>{{ option.description }}</small>
                      </div>
                    </el-option>
                  </el-select>
                  <el-button
                      class="composer-send"
                      type="primary"
                      @click="appStore.sendDraft"
                  >
                    发送
                  </el-button>
                </div>
              </section>
              <p
                  v-if="composerModelSourceText"
                  class="composer-model-hint"
              >
                {{ composerModelSourceText }}
              </p>
              <section
                  v-if="appStore.entryMode === 'plugin-compact'"
                  class="plugin-inline-status"
              >
                <span>连接：{{ formatConnectionState(appStore.connectionState) }}</span>
                <span>任务：{{ activeTaskPanelRows[0].status }}</span>
                <span>智能体状态：{{ agentStatusTreeRows.length > 0 ? `${agentStatusTreeRows.length} 个` : "暂无智能体状态" }}</span>
              </section>
            </section>
          </footer>
        </article>

        <aside
            v-if="appStore.entryMode !== 'plugin-compact'"
            class="config-panel"
        >
          <h2>任务状态</h2>
          <p class="panel-muted status-scope-note">
            多个对话框可并发执行；排队中仅表示当前对话内等待上一项处理。引导/审批/需要用户确认属于当前对话当前轮次。
          </p>
          <el-empty
              v-if="appStore.activeTasks.length === 0"
              description="暂无任务"
          />
          <el-scrollbar
              v-else
              class="status-list"
          >
            <article
                v-for="task in appStore.activeTasks"
                :key="task.taskId"
                class="status-item"
            >
              <strong>{{ task.title }}</strong>
              <span :title="resolveTaskStatusMeta(task.status).title">{{ formatTaskStatus(task.status) }}</span>
            </article>
          </el-scrollbar>

          <h2>智能体状态</h2>
          <el-empty
              v-if="agentStatusEvents.length === 0"
              description="暂无智能体状态"
          />
          <el-scrollbar
              v-else
              class="status-list"
          >
            <article
                v-for="event in agentStatusEvents"
                :key="event.eventId"
                class="status-item status-item-column"
            >
              <strong>{{ event.summary }}</strong>
              <span>{{ event.eventType }}</span>
            </article>
          </el-scrollbar>

          <h2>审计摘要</h2>
          <el-scrollbar class="status-list">
            <article
                v-for="event in auditSummaryEvents"
                :key="event.eventId"
                class="status-item status-item-column"
            >
              <strong>{{ event.eventType }}</strong>
              <span>{{ event.summary }}</span>
            </article>
          </el-scrollbar>
        </aside>
      </section>

      <section
          v-else-if="activePage === 'agent-management'"
          class="page-panel"
      >
        <header class="page-header">
          <div>
            <h1>智能体管理</h1>
            <p>展示主智能体和长期智能体的管理入口；主智能体不可删除，长期智能体用于跨会话持续协作。</p>
          </div>
        </header>
        <section class="page-scroll">
          <div class="management-list">
            <article class="management-item">
              <div>
                <strong>主智能体</strong>
                <span>主智能体“致心”是系统内置入口，承担默认对话、任务派发和长期记忆归纳。</span>
                <small>语义：可查看和配置承载供应商、模型、推理深度与记忆；不可删除。</small>
              </div>
            </article>
            <article class="management-item">
              <div>
                <strong>长期智能体</strong>
                <span>长期智能体包括用户创建、主智能体创建或其他长期智能体创建的可固化角色。</span>
                <small>语义：可查看、创建、修改、停用和删除；删除需要中心服务补齐影响确认后才能开放。</small>
              </div>
            </article>
          </div>
          <el-alert
              class="management-error"
              type="info"
              :closable="false"
              title="当前页面先提供智能体管理入口和语义说明；删除等破坏性操作不在前端伪造。"
          />
        </section>
      </section>

      <section
          v-else-if="activePage === 'providers'"
          class="page-panel"
      >
        <header class="page-header">
          <div>
            <h1>供应商</h1>
            <p>API Key 只保存在中心电脑，客户端只展示是否已保存；默认模型优先从供应商模型列表选择。</p>
          </div>
          <el-button
              type="primary"
              @click="appStore.resetProviderDraft"
          >
            新增供应商
          </el-button>
        </header>
        <section class="page-scroll">
          <el-alert
              v-if="managementPageError"
              class="management-error"
              type="error"
              :closable="false"
              :title="managementPageError"
          />
          <el-form
              class="management-form"
              label-position="top"
          >
            <el-row :gutter="12">
              <el-col :span="8">
                <el-form-item label="供应商名称">
                  <el-input v-model="appStore.providerDraft.providerName"/>
                  <small class="field-helper">用于在智能体、审计和用量统计中识别该模型提供方。</small>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="协议插件">
                  <el-select v-model="appStore.providerDraft.protocolPluginId">
                    <el-option
                        label="OpenAI 兼容"
                        value="builtin-model-openai-compatible"
                    />
                    <el-option
                        label="Anthropic Messages"
                        value="builtin-model-anthropic-messages"
                    />
                  </el-select>
                  <small class="field-helper">决定中心服务用哪一种内置模型协议适配请求和响应。</small>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="协议模式">
                  <el-select v-model="appStore.providerDraft.protocolMode">
                    <el-option
                        label="chat-completions"
                        value="chat-completions"
                    />
                    <el-option
                        label="responses"
                        value="responses"
                    />
                    <el-option
                        label="messages"
                        value="messages"
                    />
                  </el-select>
                  <small class="field-helper">来源于协议插件支持的调用模式，只影响后续模型请求。</small>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="Base URL">
                  <el-input v-model="appStore.providerDraft.baseUrl"/>
                  <small class="field-helper">供应商 API 根地址，模型列表刷新和后续调用都会使用该地址。</small>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="默认模型">
                  <!-- 默认模型必须始终使用可创建下拉，避免无模型列表时退回普通输入框导致桌面客户端识别为编辑框。 -->
                  <el-select
                      v-model="appStore.providerDraft.model"
                      filterable
                      allow-create
                      default-first-option
                      placeholder="选择或输入模型名称"
                  >
                    <el-option
                        v-for="model in selectedProviderModelOptions"
                        :key="model"
                        :label="model"
                        :value="model"
                    />
                  </el-select>
                  <small class="field-helper">{{ providerModelSourceText }}</small>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="API Key 新值">
                  <el-input
                      v-model="appStore.providerDraft.apiKey"
                      type="password"
                      show-password
                      placeholder="保存后不回显"
                  />
                  <small class="field-helper">敏感字段只提交到中心服务，本页面不会回显已保存明文。</small>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="代理策略">
                  <el-select v-model="appStore.providerDraft.proxyPolicy.mode">
                    <el-option
                        label="不使用代理"
                        value="none"
                    />
                    <el-option
                        label="使用全局默认代理"
                        value="use-global-default"
                    />
                    <el-option
                        label="使用指定代理"
                        value="use-specified"
                    />
                  </el-select>
                  <small class="field-helper">只影响后续供应商访问、模型列表刷新和模型调用。</small>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="指定代理 ID">
                  <el-input v-model="appStore.providerDraft.proxyPolicy.proxyId"/>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="启用状态">
                  <el-switch v-model="appStore.providerDraft.enabled"/>
                  <small class="field-helper">停用后不再作为后续智能体模型调用候选。</small>
                </el-form-item>
              </el-col>
            </el-row>
            <section class="checkbox-grid">
              <el-checkbox v-model="appStore.providerDraft.capabilities.supportsVision">
                图片
              </el-checkbox>
              <el-checkbox v-model="appStore.providerDraft.capabilities.supportsToolCalling">
                工具调用
              </el-checkbox>
              <el-checkbox v-model="appStore.providerDraft.capabilities.supportsJsonOutput">
                JSON 输出
              </el-checkbox>
              <el-checkbox v-model="appStore.providerDraft.capabilities.supportsReasoningEffort">
                推理深度
              </el-checkbox>
              <el-checkbox v-model="appStore.providerDraft.capabilities.providesCacheUsage">
                缓存用量
              </el-checkbox>
              <el-checkbox v-model="appStore.providerDraft.capabilities.supportsModelList">
                模型列表
              </el-checkbox>
              <el-checkbox v-model="appStore.providerDraft.capabilities.supportsStreaming">
                流式输出
              </el-checkbox>
            </section>
            <p class="field-helper">
              模型列表来源：刷新成功后由中心服务保存；不支持模型列表接口时使用手动填写兜底。
            </p>
            <div class="management-actions">
              <el-button
                  type="primary"
                  @click="appStore.saveProvider"
              >
                保存供应商
              </el-button>
              <el-button @click="appStore.loadProviders">
                刷新列表
              </el-button>
            </div>
          </el-form>

          <el-empty
              v-if="appStore.providers.length === 0"
              description="暂无供应商"
          />
          <section
              v-else
              class="management-list"
          >
            <article
                v-for="provider in appStore.providers"
                :key="provider.providerId"
                class="management-item"
            >
              <div>
                <strong>{{ provider.providerName }}</strong>
                <span>{{ provider.protocolPluginId }} · {{ provider.protocolMode }}</span>
                <small>{{ provider.baseUrl }} · API Key：{{ provider.hasApiKey ? "已保存" : "未保存" }}</small>
              </div>
              <div class="management-actions">
                <el-tag :type="provider.enabled ? 'success' : 'info'">
                  {{ provider.enabled ? "启用" : "停用" }}
                </el-tag>
                <el-button @click="appStore.editProvider(provider)">
                  修改
                </el-button>
                <el-button @click="appStore.toggleProvider(provider)">
                  {{ provider.enabled ? "停用" : "启用" }}
                </el-button>
                <el-button @click="appStore.refreshProviderModels(provider)">
                  刷新模型/推理深度
                </el-button>
                <el-button
                    type="danger"
                    plain
                    @click="appStore.deleteProvider(provider)"
                >
                  删除
                </el-button>
              </div>
            </article>
          </section>
        </section>
      </section>

      <section
          v-else-if="activePage === 'proxies'"
          class="page-panel"
      >
        <header class="page-header">
          <div>
            <h1>网络代理</h1>
            <p>代理账号和密码只保存在中心电脑，客户端不展示明文。</p>
          </div>
          <el-button
              type="primary"
              @click="appStore.resetProxyDraft"
          >
            新增代理
          </el-button>
        </header>
        <section class="page-scroll">
          <el-alert
              v-if="managementPageError"
              class="management-error"
              type="error"
              :closable="false"
              :title="managementPageError"
          />
          <el-form
              class="management-form"
              label-position="top"
          >
            <el-row :gutter="12">
              <el-col :span="6">
                <el-form-item label="代理名称">
                  <el-input v-model="appStore.proxyDraft.proxyName"/>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="协议">
                  <el-select v-model="appStore.proxyDraft.protocol">
                    <el-option
                        label="HTTP"
                        value="HTTP"
                    />
                    <el-option
                        label="HTTPS"
                        value="HTTPS"
                    />
                    <el-option
                        label="SOCKS4"
                        value="SOCKS4"
                    />
                    <el-option
                        label="SOCKS4a"
                        value="SOCKS4a"
                    />
                    <el-option
                        label="SOCKS5"
                        value="SOCKS5"
                    />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="主机">
                  <el-input v-model="appStore.proxyDraft.host"/>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="端口">
                  <el-input-number
                      v-model="appStore.proxyDraft.port"
                      :min="1"
                      :max="65535"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="用户名">
                  <el-input
                      v-model="appStore.proxyDraft.username"
                      placeholder="留空表示无认证"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="密码新值">
                  <el-input
                      v-model="appStore.proxyDraft.password"
                      type="password"
                      show-password
                      placeholder="留空不修改"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="启用状态">
                  <el-switch v-model="appStore.proxyDraft.enabled"/>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="备注">
                  <el-input v-model="appStore.proxyDraft.note"/>
                </el-form-item>
              </el-col>
            </el-row>
            <div class="management-actions">
              <el-button
                  type="primary"
                  @click="appStore.saveProxy"
              >
                保存代理
              </el-button>
              <el-button @click="appStore.setGlobalDefaultProxy(null)">
                清除全局默认
              </el-button>
              <el-button @click="appStore.loadProxies">
                刷新列表
              </el-button>
            </div>
          </el-form>

          <el-empty
              v-if="appStore.proxies.length === 0"
              description="暂无网络代理"
          />
          <section
              v-else
              class="management-list"
          >
            <article
                v-for="proxy in appStore.proxies"
                :key="proxy.proxyId"
                class="management-item"
            >
              <div>
                <strong>{{ proxy.proxyName }}</strong>
                <span>{{ proxy.protocol }} · {{ proxy.host }}:{{ proxy.port }}</span>
                <small>{{ proxy.hasAuth ? "已配置认证" : "无认证" }} ·
                  {{ appStore.defaultProxyId === proxy.proxyId ? "全局默认" : "非默认" }}</small>
              </div>
              <div class="management-actions">
                <el-tag :type="proxy.enabled ? 'success' : 'info'">
                  {{ proxy.enabled ? "启用" : "停用" }}
                </el-tag>
                <el-button @click="appStore.editProxy(proxy)">
                  修改
                </el-button>
                <el-button @click="appStore.toggleProxy(proxy)">
                  {{ proxy.enabled ? "停用" : "启用" }}
                </el-button>
                <el-button @click="appStore.setGlobalDefaultProxy(proxy.proxyId)">
                  设为全局默认
                </el-button>
                <el-button
                    type="danger"
                    plain
                    @click="appStore.deleteProxy(proxy)"
                >
                  删除
                </el-button>
              </div>
            </article>
          </section>
        </section>
      </section>

      <section
          v-else-if="activePage === 'runtimes'"
          class="page-panel"
      >
        <header class="page-header">
          <div>
            <h1>运行环境</h1>
            <p>插件、MCP、skill 和命令任务按这里登记的环境执行。</p>
          </div>
          <el-button
              type="primary"
              @click="appStore.resetRuntimeDraft"
          >
            新增环境
          </el-button>
        </header>
        <section class="page-scroll">
          <el-alert
              v-if="managementPageError"
              class="management-error"
              type="error"
              :closable="false"
              :title="managementPageError"
          />
          <el-form
              class="management-form"
              label-position="top"
          >
            <el-row :gutter="12">
              <el-col :span="6">
                <el-form-item label="环境名称">
                  <el-input v-model="appStore.runtimeDraft.runtimeName"/>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="环境类型">
                  <el-input v-model="appStore.runtimeDraft.runtimeType"/>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="可执行文件">
                  <el-input v-model="appStore.runtimeDraft.executablePath"/>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="根目录">
                  <el-input v-model="appStore.runtimeDraft.rootPath"/>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="版本">
                  <el-input v-model="appStore.runtimeDraft.version"/>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="默认环境">
                  <el-switch v-model="appStore.runtimeDraft.isDefault"/>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="启用状态">
                  <el-switch v-model="appStore.runtimeDraft.enabled"/>
                </el-form-item>
              </el-col>
              <el-col :span="6">
                <el-form-item label="备注">
                  <el-input v-model="appStore.runtimeDraft.note"/>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="环境变量 KEY=VALUE">
                  <el-input
                      v-model="appStore.runtimeDraft.environmentVariablesText"
                      type="textarea"
                      :rows="3"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="PATH 追加目录">
                  <el-input
                      v-model="appStore.runtimeDraft.pathEntriesText"
                      type="textarea"
                      :rows="3"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <div class="management-actions">
              <el-button
                  type="primary"
                  @click="appStore.saveRuntime"
              >
                保存环境
              </el-button>
              <el-button @click="appStore.loadRuntimes">
                刷新列表
              </el-button>
            </div>
          </el-form>

          <el-empty
              v-if="appStore.runtimes.length === 0"
              description="暂无运行环境"
          />
          <section
              v-else
              class="management-list"
          >
            <article
                v-for="runtime in appStore.runtimes"
                :key="runtime.runtimeId"
                class="management-item"
            >
              <div>
                <strong>{{ runtime.runtimeName }}</strong>
                <span>{{ runtime.runtimeType }} · {{ runtime.version }}</span>
                <small>{{ runtime.executablePath }} · {{ runtime.isDefault ? "默认环境" : "非默认" }}</small>
              </div>
              <div class="management-actions">
                <el-tag :type="runtime.enabled ? 'success' : 'info'">
                  {{ runtime.enabled ? "启用" : "停用" }}
                </el-tag>
                <el-button @click="appStore.editRuntime(runtime)">
                  修改
                </el-button>
                <el-button @click="appStore.toggleRuntime(runtime)">
                  {{ runtime.enabled ? "停用" : "启用" }}
                </el-button>
                <el-button @click="appStore.setDefaultRuntime(runtime)">
                  设为默认
                </el-button>
                <el-button
                    type="danger"
                    plain
                    @click="appStore.deleteRuntime(runtime)"
                >
                  删除
                </el-button>
              </div>
            </article>
          </section>
        </section>
      </section>

      <section
          v-else-if="activePage === 'usage'"
          class="page-panel"
      >
        <header class="page-header">
          <div>
            <h1>用量统计</h1>
            <p>按供应商、模型和项目汇总模型调用 token、缓存和调用结果。</p>
          </div>
        </header>
        <section class="page-scroll">
          <el-alert
              v-if="managementPageError"
              class="management-error"
              type="error"
              :closable="false"
              :title="managementPageError"
          />
          <el-form
              class="management-form"
              label-position="top"
          >
            <el-row :gutter="12">
              <el-col :span="4">
                <el-form-item label="供应商 ID">
                  <el-input v-model="appStore.usageFilters.providerId"/>
                </el-form-item>
              </el-col>
              <el-col :span="4">
                <el-form-item label="模型">
                  <el-input v-model="appStore.usageFilters.model"/>
                </el-form-item>
              </el-col>
              <el-col :span="4">
                <el-form-item label="项目 ID">
                  <el-input v-model="appStore.usageFilters.projectId"/>
                </el-form-item>
              </el-col>
              <el-col :span="4">
                <el-form-item label="会话 ID">
                  <el-input v-model="appStore.usageFilters.sessionId"/>
                </el-form-item>
              </el-col>
              <el-col :span="4">
                <el-form-item label="开始时间">
                  <el-input
                      v-model="appStore.usageFilters.startedAt"
                      placeholder="ISO 时间"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="4">
                <el-form-item label="结束时间">
                  <el-input
                      v-model="appStore.usageFilters.endedAt"
                      placeholder="ISO 时间"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <div class="management-actions">
              <el-button
                  type="primary"
                  @click="appStore.loadUsageStatistics"
              >
                查询统计
              </el-button>
              <el-button @click="appStore.loadUsageAggregate">
                仅刷新聚合
              </el-button>
            </div>
          </el-form>

          <section class="usage-chart-grid">
            <article class="usage-chart-card">
              <h2>总量</h2>
              <div
                  ref="usageTotalChartRef"
                  class="usage-chart usage-total-chart"
              />
            </article>
            <article class="usage-chart-card">
              <h2>各供应商</h2>
              <div
                  ref="usageProviderChartRef"
                  class="usage-chart usage-provider-chart"
              />
            </article>
            <article class="usage-chart-card">
              <h2>项目维度</h2>
              <div
                  ref="usageProjectChartRef"
                  class="usage-chart usage-project-chart"
              />
            </article>
          </section>

          <h2 class="section-title">
            聚合统计
          </h2>
          <el-empty
              v-if="appStore.usageAggregate.length === 0"
              description="暂无聚合统计"
          />
          <el-scrollbar
              v-else
              class="usage-list"
          >
            <pre
                v-for="(record, index) in appStore.usageAggregate"
                :key="`aggregate-${index}`"
            >{{ formatUsageJson(record) }}</pre>
          </el-scrollbar>

          <h2 class="section-title">
            原始记录
          </h2>
          <el-empty
              v-if="appStore.usageRecords.length === 0"
              description="暂无用量统计"
          />
          <el-scrollbar
              v-else
              class="usage-list"
          >
            <pre
                v-for="(record, index) in appStore.usageRecords"
                :key="`record-${index}`"
            >{{ formatUsageJson(record) }}</pre>
          </el-scrollbar>
        </section>
      </section>

      <section
          v-else-if="activePage === 'plugins'"
          class="page-panel"
      >
        <header class="page-header">
          <div>
            <h1>插件</h1>
            <p>全局扩展能力管理：插件清单、启停、配置和删除都通过中心服务统一入口处理。项目级能力只在项目对话中展示。</p>
          </div>
          <el-button @click="appStore.loadPlugins">
            刷新列表
          </el-button>
        </header>
        <section class="page-scroll">
          <el-alert
              v-if="managementPageError"
              class="management-error"
              type="error"
              :closable="false"
              :title="managementPageError"
          />
          <el-form
              class="management-form"
              label-position="top"
          >
            <el-row :gutter="12">
              <el-col :span="12">
                <el-form-item label="插件清单 JSON">
                  <el-input
                      v-model="appStore.pluginDraft.manifestJson"
                      type="textarea"
                      :rows="8"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="插件配置 JSON">
                  <el-input
                      v-model="appStore.pluginDraft.configJson"
                      type="textarea"
                      :rows="8"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="当前插件 ID">
                  <el-input v-model="appStore.pluginDraft.pluginId"/>
                </el-form-item>
              </el-col>
            </el-row>
            <div class="management-actions">
              <el-button
                  type="primary"
                  @click="appStore.installPlugin"
              >
                安装插件清单
              </el-button>
              <el-button @click="appStore.configurePlugin">
                保存配置 JSON
              </el-button>
            </div>
          </el-form>

          <el-empty
              v-if="appStore.globalPlugins.length === 0"
              description="暂无插件"
          />
          <section
              v-else
              class="management-list"
          >
            <article
                v-for="plugin in appStore.globalPlugins"
                :key="plugin.pluginId"
                class="management-item"
            >
              <div>
                <strong>{{ plugin.pluginId }}</strong>
                <span>{{ plugin.source }} · {{ plugin.scope }}</span>
                <small>{{ formatDisplayTime(plugin.updatedAt) }}</small>
              </div>
              <div class="management-actions">
                <el-tag :type="plugin.enabled ? 'success' : 'info'">
                  {{ plugin.enabled ? "启用" : "停用" }}
                </el-tag>
                <el-button @click="appStore.editPlugin(plugin)">
                  修改
                </el-button>
                <el-button @click="appStore.togglePlugin(plugin)">
                  {{ plugin.enabled ? "停用" : "启用" }}
                </el-button>
                <el-button
                    type="danger"
                    plain
                    :disabled="plugin.source === 'system-builtin'"
                    @click="appStore.deletePlugin(plugin)"
                >
                  删除
                </el-button>
              </div>
            </article>
          </section>
        </section>
      </section>

      <section
          v-else-if="activePage === 'mcp'"
          class="page-panel"
      >
        <header class="page-header">
          <div>
            <h1>MCP</h1>
            <p>全局扩展能力管理：配置 JSON 根字段必须是 mcpServers。项目级能力只在项目对话中展示。</p>
          </div>
          <el-button @click="appStore.loadMcpConfigs">
            刷新列表
          </el-button>
        </header>
        <section class="page-scroll">
          <el-alert
              v-if="managementPageError"
              class="management-error"
              type="error"
              :closable="false"
              :title="managementPageError"
          />
          <el-form
              class="management-form"
              label-position="top"
          >
            <el-form-item label="MCP 配置 JSON">
              <el-input
                  v-model="appStore.mcpDraft.configJson"
                  type="textarea"
                  :rows="10"
              />
            </el-form-item>
            <div class="management-actions">
              <el-button
                  type="primary"
                  @click="appStore.saveMcpConfig"
              >
                保存 MCP 配置
              </el-button>
            </div>
          </el-form>

          <el-empty
              v-if="appStore.globalMcpConfigs.length === 0"
              description="暂无 MCP 配置"
          />
          <section
              v-else
              class="management-list"
          >
            <article
                v-for="config in appStore.globalMcpConfigs"
                :key="config.relativePath"
                class="management-item"
            >
              <div>
                <strong>{{ config.scope === "global" ? "全局配置" : "项目配置" }}</strong>
                <span>{{ config.relativePath }}</span>
                <small>{{ config.projectId || "全局" }} · {{ formatDisplayTime(config.updatedAt) }}</small>
              </div>
              <div class="management-actions">
                <el-button @click="appStore.editMcpConfig(config)">
                  编辑
                </el-button>
              </div>
            </article>
          </section>
        </section>
      </section>

      <section
          v-else-if="activePage === 'skills'"
          class="page-panel"
      >
        <header class="page-header">
          <div>
            <h1>skill</h1>
            <p>全局扩展能力管理：安装全局 skill，内容保存到中心目录 skills。项目级能力只在项目对话中展示。</p>
          </div>
          <el-button @click="appStore.loadSkills">
            刷新列表
          </el-button>
        </header>
        <section class="page-scroll">
          <el-alert
              v-if="managementPageError"
              class="management-error"
              type="error"
              :closable="false"
              :title="managementPageError"
          />
          <el-form
              class="management-form"
              label-position="top"
          >
            <el-row :gutter="12">
              <el-col :span="8">
                <el-form-item label="skill 名称">
                  <el-input v-model="appStore.skillDraft.skillName"/>
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="skill 内容">
              <el-input
                  v-model="appStore.skillDraft.content"
                  type="textarea"
                  :rows="10"
              />
            </el-form-item>
            <div class="management-actions">
              <el-button
                  type="primary"
                  @click="appStore.installSkill"
              >
                安装 skill
              </el-button>
            </div>
          </el-form>

          <el-empty
              v-if="appStore.globalSkills.length === 0"
              description="暂无 skill"
          />
          <section
              v-else
              class="management-list"
          >
            <article
                v-for="skill in appStore.globalSkills"
                :key="skill.relativePath"
                class="management-item"
            >
              <div>
                <strong>{{ skill.skillName }}</strong>
                <span>{{ skill.scope === "global" ? "全局" : "项目" }} · {{ skill.relativePath }}</span>
                <small>{{ skill.projectId || "全局" }}</small>
              </div>
            </article>
          </section>
        </section>
      </section>

      <section
          v-else-if="activePage === 'center'"
          class="page-panel"
      >
        <header class="page-header">
          <div>
            <h1>中心服务</h1>
            <p>桌面壳本机中心服务进程、端口、目录和 Web 访问配置。</p>
          </div>
          <div
              v-if="appStore.runtime.capabilities.canManageCenterService"
              class="page-header-actions"
          >
            <el-button @click="appStore.saveDesktopConfig">
              保存配置
            </el-button>
          </div>
        </header>
        <section
            v-if="!appStore.runtime.capabilities.canManageCenterService"
            class="page-scroll"
        >
          <el-alert
              type="info"
              :closable="false"
              title="中心服务启停和本机配置只在桌面壳可用。"
          />
        </section>
        <section
            v-else
            class="page-scroll"
        >
          <el-form
              class="center-service-form"
              label-position="top"
          >
            <el-form-item label="端口">
              <el-input-number
                  v-model="appStore.desktopConfigDraft.port"
                  :min="1"
                  :max="65535"
              />
            </el-form-item>
            <el-form-item label="中心目录">
              <el-input v-model="appStore.desktopConfigDraft.centerDirectory"/>
            </el-form-item>
            <el-alert
                v-if="appStore.desktopStatus?.isExternalCenterDirectory"
                type="warning"
                :closable="false"
                title="外部中心目录不会随程序目录删除"
            />
            <el-divider/>
            <el-form-item label="Web 远程访问账号">
              <el-input v-model="appStore.remoteAccessDraft.account"/>
            </el-form-item>
            <el-form-item label="Web 远程访问密码">
              <el-input
                  v-model="appStore.remoteAccessDraft.password"
                  type="password"
                  show-password
              />
            </el-form-item>
            <el-button @click="appStore.saveRemoteAccessAccount">
              保存远程访问
            </el-button>
            <p class="panel-muted">
              系统通知：{{ appStore.notificationPermission || "未检测" }}
            </p>
          </el-form>
        </section>
      </section>
    </section>
  </main>
</template>
