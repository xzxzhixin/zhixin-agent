<script setup lang="ts">
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
  onBeforeUnmount,
  ref,
  watch,
} from "vue";

import {
  useAppStore,
  type AgentStatusTreeNode,
  type ComposerEditFile,
} from "@stores/app";
import TaskDetailDialog from "@views/Chat/dialogs/TaskDetailDialog.vue";
import AgentStatusDialog from "@views/Chat/dialogs/AgentStatusDialog.vue";
import EditDetailDialog from "@views/Chat/dialogs/EditDetailDialog.vue";
import ProjectCapabilityDialog from "@views/Chat/dialogs/ProjectCapabilityDialog.vue";
import type {
  ConversationMessage,
  ConversationSession,
  ConversationTurn,
  ProjectRecord,
  TaskStatus,
} from "@zhixin/shared";

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
// taskProgressText：任务入口外部数字，语义为已完成任务数/总任务数；没有真实任务时按明确空态展示 0/0。
const taskProgressText = computed(() => {
  const total = appStore.activeTasks.length;
  if (total === 0) {
    return "0/0";
  }

  const completed = appStore.activeTasks.filter((task) => {
    return task.status === "completed";
  }).length;
  return `${completed}/${total}`;
});
// agentStatusProgressText：智能体状态入口外部数字，语义为运行中数量/总数；没有真实树节点时按明确空态展示 0/0。
const agentStatusProgressText = computed(() => {
  // longTermNodes: 入口计数只统计当前窗口一级长期节点，子智能体只在详情树中展示。
  const longTermNodes = appStore.agentStatusTree.filter((node) => {
    return node.nodeKind === "主智能体" || node.nodeKind === "长期智能体";
  });
  const total = longTermNodes.length;
  if (total === 0) {
    return "0/0";
  }

  const running = longTermNodes.filter((node) => {
    return node.status === "工作中" || node.status === "执行中";
  }).length;
  return `${running}/${total}`;
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
// composerContextUsageText：当前窗口上下文占用，比例允许超过 100%，用于提示 history 过大风险。
const composerContextUsageText = computed(() => {
  const limitTokens = appStore.composerSelectedModelContextWindowTokens;
  if (!Number.isFinite(limitTokens) || limitTokens <= 0) {
    return "0% / 未配置窗口";
  }

  const usedTokens = Number.isFinite(appStore.composerSettings.contextUsedTokens)
    ? appStore.composerSettings.contextUsedTokens
    : 0;
  const percent = Math.round((usedTokens / limitTokens) * 100);
  return `${percent}% / ${formatContextWindowLimit(limitTokens)}`;
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
// executionModeOptions：执行模式完整下拉，来源于需求中的三种执行模式。
const executionModeOptions: SelectOption[] = [
  {
    value: "suggest",
    label: "建议模式",
    description: "每一步副作用操作都需要用户确认，适合需要逐步审阅的对话。",
  },
  {
    value: "auto_edit",
    label: "自动编辑",
    description: "低风险读取或编辑流程可自动执行，高风险操作仍需用户确认。",
  },
  {
    value: "full_auto",
    label: "全自动",
    description: "在权限和沙箱范围内自动执行，写文件和命令会立即生效。",
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
 * formatContextWindowLimit：格式化模型窗口上限。
 *
 * @param tokens token 数值。
 * @returns K 或 M 简写。
 */
function formatContextWindowLimit(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "未配置窗口";
  }
  if (tokens >= 1000000 && tokens % 1000000 === 0) {
    return `${tokens / 1000000}M`;
  }
  return `${Math.round(tokens / 1000)}K`;
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
});
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
      :class="appStore.entryMode === 'plugin-compact' ? [
        'app-shell',
        'plugin-shell',
      ] : 'chat-page-host'"
  >
      <section
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

          <ProjectCapabilityDialog
              class="project-capability-dialog"
              v-model="projectCapabilityDialogVisible"
              :summary="appStore.projectCapabilitySummary"
              :rows="projectCapabilityDialogRows"
          />

          <TaskDetailDialog
              v-if="activeComposerEntry === 'task'"
              v-model="composerMiniDialogVisible"
              :tasks="activeTaskPanelRows"
          />

          <AgentStatusDialog
              v-if="activeComposerEntry === 'agentStatus'"
              v-model="composerMiniDialogVisible"
              :rows="agentStatusTreeRows"
              :selected-node="selectedAgentStatusNode"
              :messages="selectedAgentConversationMessages"
              :draft="agentConversationDraft"
              :render-markdown="appStore.renderMarkdown"
              @select-node="selectAgentStatusNode"
              @update:draft="agentConversationDraft = $event"
              @send="sendAgentConversationDraft"
          />

          <EditDetailDialog
              v-if="activeComposerEntry === 'edit'"
              v-model="composerMiniDialogVisible"
              :files="appStore.composerEditFiles"
              :active-file="activeComposerEditFile"
              @select-file="selectComposerEditFile"
          />

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
                  任务 {{ taskProgressText }}
                </button>
                <button
                    class="composer-entry-tab"
                    :class="{ active: activeComposerEntry === 'agentStatus' && composerMiniDialogVisible }"
                    type="button"
                    @click="openComposerMiniDialog('agentStatus')"
                >
                  智能体状态 {{ agentStatusProgressText }}
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
                  <span class="composer-context-usage">
                    上下文 {{ composerContextUsageText }}
                  </span>
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
                      <div class="select-option-row execution-mode-option-row">
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
  </main>
</template>

