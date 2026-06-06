<script setup lang="ts">
import {
  ArrowDown,
  ArrowRight,
  ChatDotRound,
  Delete,
  Folder,
  FolderAdd,
  FolderOpened,
  Plus,
} from "@element-plus/icons-vue";
import {
  type ComponentPublicInstance,
  computed,
  onBeforeUnmount,
  onMounted,
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
import AgentConversationDialog from "@views/Chat/dialogs/AgentConversationDialog.vue";
import EditDetailDialog from "@views/Chat/dialogs/EditDetailDialog.vue";
import ProjectCapabilityDialog from "@views/Chat/dialogs/ProjectCapabilityDialog.vue";
import {
  createConversationRenderRows,
  createMessageTimelineNodes,
  flattenAgentTreeRows,
  formatConnectionState,
  formatContextUsageTooltip,
  formatContextWindowLimit,
  formatDisplayTime,
  formatDurationMs,
  formatTurnTimeFooter,
  projectTooltipContent,
  resolveTaskStatusMeta,
  type AgentStatusTreeRow,
  type ConversationRenderRow,
  type NavigationStatusMeta,
  type ThinkingProcessRow,
  type ProcessMessageGroupRow,
} from "@views/Chat/chat-view-helpers";
import {
  executionModeOptions,
  reasoningEffortOptions,
} from "@views/Chat/chat-view-options";
import type {
  ConversationMessage,
  ConversationSession,
  ConversationTurn,
  ProjectRecord,
} from "@zhixin/shared";
import {
  useChatConversation,
} from "./useChatConversation";
import {
  useComposerPanelResize,
} from "./useComposerPanelResize";
import {
  useMessageListAutoScroll,
} from "./useMessageListAutoScroll";
import StatusSummaryPanel from "./StatusSummaryPanel.vue";
import "./style.css";
type ComposerEntryKind = "task" | "agentStatus" | "edit";
// appStore：主界面读取运行时、会话、消息、任务和桌面能力状态。
const appStore = useAppStore();
// chatConversation：普通对话、项目对话和智能体对话弹框共用的完整对话组合能力。
const chatConversation = useChatConversation(appStore);
// activeComposerEntry：输入框三段入口当前弹框内容。
const activeComposerEntry = ref<ComposerEntryKind>("task");
// composerMiniDialogVisible：输入框三段入口小弹框显隐。
const composerMiniDialogVisible = ref(false);
// composerRootRef：输入区根节点，用于判断点击是否落在输入区内部。
const composerRootRef = ref<HTMLElement | null>(null);
// composerMiniDialogRef：输入区小弹框节点，用于判断点击是否落在浮层内部。
const composerMiniDialogRef = ref<HTMLElement | null>(null);
// composerInputRef：输入区文本组件引用，仅用于打开浮层时释放真实输入焦点。
const composerInputRef = ref<ComponentPublicInstance<{
  /** blur：Element Plus 输入组件提供的失焦方法。 */
  blur: () => void;
}> | null>(null);
// selectedAgentStatusNode：当前被点开的智能体状态节点。
const selectedAgentStatusNode = ref<AgentStatusTreeNode | null>(null);
// agentConversationDialogVisible：智能体完整对话弹窗显隐。
const agentConversationDialogVisible = ref(false);
// agentConversationDraft：智能体对话详情输入草稿，发送时仍写入当前会话。
const agentConversationDraft = ref("");
// selectedComposerEditFilePath：输入框“编辑”入口当前选中文件路径，空字符串表示等待默认选中第一项。
const selectedComposerEditFilePath = ref("");
// projectCapabilityDialogVisible：项目能力详情弹框显隐，只属于当前客户端 UI 状态。
const projectCapabilityDialogVisible = ref(false);
// composerFocused：输入框整体聚焦状态，只影响浏览器当前视觉，不写入中心服务事实源。
const composerFocused = ref(false);
const {
  messageListRef,
  updateMessageListPinnedState,
  requestAutoScrollToBottom,
  pauseAutoScrollForHistoryView,
  disposeMessageListAutoScroll,
} = useMessageListAutoScroll();
const {
  isComposerResizing,
  composerPanelStyle,
  composerResizeHandleLabel,
  startComposerResize,
  stopComposerResize,
} = useComposerPanelResize();
// messages：当前会话消息列表。
const messages = chatConversation.messages;
// messageTimelineNodes：对话时间线只从用户消息生成，不伪造发送内容。
const messageTimelineNodes = computed(() => {
  return createMessageTimelineNodes(messages.value);
});
// normalSessions：普通会话列表，来源于中心服务 sessionType 字段。
const normalSessions = computed(() => appStore.sessions.filter((session) => session.sessionType === "normal"));
// activeSessionTitle：顶部标题优先展示真实会话；没有真实会话时展示本地待发送草稿标题。
const activeSessionTitle = computed(() => appStore.sessionDetail?.session.title ?? "对话");
// activeDraftProjectName：项目对话草稿绑定的项目名称，用于点击新增后给出可见反馈。
const activeDraftProjectName = computed(() => {
  if (appStore.pendingSessionDraft?.sessionType !== "project" || !appStore.pendingSessionDraft.projectId) {
    return "";
  }
  const project = appStore.projects.find((item) => {
    return item.projectId === appStore.pendingSessionDraft?.projectId;
  });
  return project?.displayName ?? appStore.pendingSessionDraft.projectId;
});
// agentStatusTreeRows：把智能体状态树压平为带层级的状态树行。
const agentStatusTreeRows = computed<AgentStatusTreeRow[]>(() => {
  return flattenAgentTreeRows(
    appStore.agentStatusTree,
    0,
  );
});
// thinkingProcessRows：同一轮思考事件合并为单个思考块，避免分散卡片打断消息流。
const thinkingProcessRows = computed<ThinkingProcessRow[]>(() => {
  return chatConversation.thinkingProcessRows.value;
});
// processMessageRows：把非思考事件流展示为过程消息，让流式输出在整轮完成前可见。
const processMessageRows = computed<ProcessMessageGroupRow[]>(() => {
  return chatConversation.processMessageRows.value;
});
// conversationRenderRows：把用户消息、思考过程、工具过程和助手回复按同一轮次合并，避免过程记录显示到用户问题上方。
const conversationRenderRows = computed<ConversationRenderRow[]>(() => {
  return createConversationRenderRows(
    messages.value,
    thinkingProcessRows.value,
    processMessageRows.value,
    appStore.events,
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
  const total = chatConversation.currentTurnTasks.value.length;
  if (total === 0) {
    return "0/0";
  }

  const completed = chatConversation.currentTurnTasks.value.filter((task) => {
    return task.status === "completed";
  }).length;
  return `${completed}/${total}`;
});
// agentStatusProgressText：智能体状态入口外部数字，语义为运行中数量/总数；没有真实树节点时按明确空态展示 0/0。
const agentStatusProgressText = computed(() => {
  // longTermNodes: 入口计数只统计当前窗口一级长期节点，主智能体计入分母，子智能体不计入分母。
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
// editProgressText：编辑入口外部摘要，来源于本轮真实编辑 diff 行，协议未返回时保持空态。
const editProgressText = computed(() => {
  const totals = appStore.composerEditFiles.reduce(
    (
      summary,
      file,
    ) => {
      for (const line of file.diffLines) {
        if (line.kind === "added") {
          summary.added += 1;
        }
        if (line.kind === "removed") {
          summary.removed += 1;
        }
      }
      return summary;
    },
    {
      added: 0,
      removed: 0,
    },
  );
  if (totals.added === 0 && totals.removed === 0) {
    return "";
  }
  return ` +${totals.added} -${totals.removed}`;
});
// activeTaskPanelRows：输入框“任务”入口展示当前任务，没有任务时给出当前会话内空闲说明。
const activeTaskPanelRows = computed(() => {
  return chatConversation.taskPanelRows.value;
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
    return turn.endedAt === null && (turn.status === "queued" || turn.status === "running" || turn.status === "waiting_user");
  }) ?? null;
});
// composerPrimaryButtonText：发送按钮只有“发送”和“停止”两种展示状态。
const composerPrimaryButtonText = computed(() => {
  return activeRunningTurn.value
    ? "停止"
    : "发送";
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
// composerContextPercentText：当前窗口上下文占用百分比，外层只展示百分比避免输入区底栏过长。
const composerContextPercentText = computed(() => {
  const limitTokens = appStore.composerSelectedModelContextWindowTokens;
  if (!Number.isFinite(limitTokens) || limitTokens <= 0) {
    return "0.0%";
  }

  const usedTokens = Number.isFinite(appStore.composerSettings.contextUsedTokens)
    ? appStore.composerSettings.contextUsedTokens
    : 0;
  return `${((usedTokens / limitTokens) * 100).toFixed(1)}%`;
});
// composerContextUsageText：当前窗口上下文占用明细，供智能体弹窗或可访问标题复用。
const composerContextUsageText = computed(() => {
  const limitTokens = appStore.composerSelectedModelContextWindowTokens;
  if (!Number.isFinite(limitTokens) || limitTokens <= 0) {
    return `${composerContextPercentText.value} · 0 / 未配置窗口 上下文`;
  }

  const usedTokens = Number.isFinite(appStore.composerSettings.contextUsedTokens)
    ? appStore.composerSettings.contextUsedTokens
    : 0;
  const usedTokenText = usedTokens > 0
    ? formatContextWindowLimit(usedTokens)
    : "0";
  const limitTokenText = formatContextWindowLimit(limitTokens);
  return `${composerContextPercentText.value} · ${usedTokenText} / ${limitTokenText} 上下文`;
});
// context-usage-tooltip：展示真实 token 统计明细，但隐藏 tokenizer 实现名称。
const contextUsageTooltip = computed(() => {
  const usedTokens = Number.isFinite(appStore.composerSettings.contextUsedTokens)
    ? appStore.composerSettings.contextUsedTokens
    : 0;
  const limitTokens = appStore.composerSelectedModelContextWindowTokens;
  return formatContextUsageTooltip({
    usedTokens,
    limitTokens,
    percentText: composerContextPercentText.value,
    modelId: appStore.composerSettings.selectedModel,
    referenceCount: appStore.draft.references.length,
    attachmentCount: appStore.draft.attachments.length,
    source: appStore.composerSettings.contextTokenizerSource
      ? "中心服务 token 统计"
      : "中心服务 token 统计待返回",
  });
});
// executionModeLabel：智能体完整对话弹窗复用当前输入区执行模式标签。
const executionModeLabel = computed(() => {
  return executionModeOptions.find((option) => {
    return option.value === appStore.composerSettings.executionMode;
  })?.label ?? appStore.composerSettings.executionMode;
});
// reasoningEffortLabel：智能体完整对话弹窗复用当前输入区推理深度标签。
const reasoningEffortLabel = computed(() => {
  return reasoningEffortOptions.find((option) => {
    return option.value === appStore.composerSettings.reasoningEffort;
  })?.label ?? appStore.composerSettings.reasoningEffort;
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
/**
 * openComposerMiniDialog：切换输入区三段入口小弹框。
 *
 * @param entry 入口类型。
 * @returns 没有返回值。
 */
function openComposerMiniDialog(entry: ComposerEntryKind): void {
  blurComposerInput();
  if (composerMiniDialogVisible.value && activeComposerEntry.value === entry) {
    composerMiniDialogVisible.value = false;
    return;
  }

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
 * handleComposerOutsidePointerDown：点击输入区弹层外部时关闭小弹框。
 *
 * @param event 浏览器指针事件。
 * @returns 没有返回值。
 */
function handleComposerOutsidePointerDown(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }

  const clickedInsideComposer = composerRootRef.value?.contains(target) ?? false;
  const clickedInsideDialog = composerMiniDialogRef.value?.contains(target) ?? false;
  // 小弹层只在点击入口再次切换，或点击输入区外部时关闭；输入区内部编辑不打断用户输入。
  if (!clickedInsideComposer && !clickedInsideDialog) {
    composerMiniDialogVisible.value = false;
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
 * openAgentConversationDialog：打开智能体完整对话弹窗。
 *
 * @param node 被点击的智能体节点。
 * @returns 没有返回值。
 */
function openAgentConversationDialog(node: AgentStatusTreeNode): void {
  selectedAgentStatusNode.value = node;
  agentConversationDialogVisible.value = true;
  composerMiniDialogVisible.value = false;
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
  await chatConversation.sendDraftForConversation();
}
/**
 * sendAgentGuidanceDraft：向当前智能体发送引导内容。
 *
 * @returns 没有返回值。
 */
async function sendAgentGuidanceDraft(): Promise<void> {
  if (!selectedAgentStatusNode.value) {
    return;
  }

  const messageText = agentConversationDraft.value.trim();
  if (messageText.length === 0) {
    return;
  }

  appStore.draft.text = messageText;
  agentConversationDraft.value = "";
  await chatConversation.sendGuidanceForConversation(selectedAgentStatusNode.value);
}

/**
 * updateAgentConversationDraft：更新智能体完整对话弹窗草稿。
 *
 * @param value 输入框新值。
 * @returns 没有返回值。
 */
function updateAgentConversationDraft(value: string): void {
  agentConversationDraft.value = value;
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
 * scrollToMessageAnchor：按用户消息 ID 定位到消息 DOM。
 *
 * @param messageId 用户消息 ID。
 * @returns 没有返回值。
 */
function scrollToMessageAnchor(messageId: string): void {
  const anchor = document.querySelector(`[data-message-anchor="${messageId}"]`);
  if (!anchor) {
    return;
  }
  pauseAutoScrollForHistoryView();
  // scrollIntoView: 滚动仍发生在消息列表主滚动容器内，避免制造页面级滚动。
  anchor.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
  // timeline-target：短暂定位反馈只改当前 DOM 状态，不写中心服务事实源。
  anchor.classList.remove("timeline-target");
  window.requestAnimationFrame(() => {
    anchor.classList.add("timeline-target");
    window.setTimeout(() => anchor.classList.remove("timeline-target"), 1800);
  });
}

/**
 * setComposerFocused：记录输入框整体焦点状态。
 *
 * @param focused 是否聚焦。
 * @returns 没有返回值。
 */
function setComposerFocused(focused: boolean): void {
  composerFocused.value = focused;
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
 * handleProjectRowCreate：从项目行新增项目对话。
 *
 * @param project 项目记录。
 * @returns 没有返回值。
 */
function handleProjectRowCreate(project: ProjectRecord): void {
  void appStore.createProjectConversationForProject(project);
}

/**
 * handleProjectGroupCreate：从项目对话标题新增入口选择文件夹并创建项目对话。
 *
 * @returns 没有返回值。
 */
function handleProjectGroupCreate(): void {
  void appStore.createProjectConversationFromDirectorySelection();
}

/**
 * blurComposerInput：打开输入区浮层前释放文本输入焦点。
 *
 * @returns 没有返回值。
 */
function blurComposerInput(): void {
  // Element Plus 的真实 textarea 会保留焦点；这里调用组件 blur，避免浮层打开后输入框仍处于激活样式。
  composerInputRef.value?.blur();
  composerFocused.value = false;
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
 * @param renderRowIndex 当前渲染行索引。
 * @returns 当前消息是所属轮次最后一条消息时返回 true。
 */
function shouldShowTurnTimeFooter(
    message: ConversationMessage,
    renderRowIndex: number,
): boolean {
  if (!message.turnId) {
    return false;
  }

  const turn = findTurnForMessage(message);
  if (!turn?.endedAt) {
    return false;
  }

  const nextMessage = conversationRenderRows.value.slice(renderRowIndex + 1).find((row) => {
    return row.rowKind === "message";
  });
  return !nextMessage || nextMessage.message.turnId !== message.turnId;
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
 * handleComposerEnterSend：处理输入区 Enter 发送。
 *
 * @returns 没有返回值。
 */
function handleComposerEnterSend(): void {
  void chatConversation.sendDraftForConversation();
}

/**
 * handleComposerPrimaryAction：处理发送或停止按钮。
 *
 * @returns 没有返回值。
 */
function handleComposerPrimaryAction(): void {
  if (activeRunningTurn.value) {
    void appStore.stopActiveConversationTurn();
    return;
  }
  void chatConversation.sendDraftForConversation();
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

watch(
  () => [
    appStore.activeSessionId,
    appStore.sessionDetail?.session.sessionId,
  ],
  () => {
    requestAutoScrollToBottom(true);
  },
  {
    flush: "post",
  },
);

watch(
  () => [
    messages.value.length,
    messages.value.map((message) => message.contentMarkdown.length).join(":"),
    processMessageRows.value.length,
    thinkingProcessRows.value.length,
    appStore.events.length,
  ],
  () => {
    requestAutoScrollToBottom(false);
  },
  {
    flush: "post",
  },
);

onMounted(() => {
  requestAutoScrollToBottom(true);
  document.addEventListener("pointerdown", handleComposerOutsidePointerDown);
});

onBeforeUnmount(() => {
  window.clearInterval(elapsedTimer);
  stopComposerResize();
  disposeMessageListAutoScroll();
  document.removeEventListener("pointerdown", handleComposerOutsidePointerDown);
});
</script>

<template>
  <section
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
  </section>

  <section
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
                  @click="handleProjectGroupCreate"
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
                            @click="stopNavigationAction($event); appStore.requestDeleteProject(group.project)"
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
                  <button
                      v-if="appStore.pendingSessionDraft?.sessionType === 'project' && appStore.pendingSessionDraft.projectId === group.project.projectId"
                      class="conversation-item project-session-row pending-session-row active"
                      type="button"
                      data-nav-kind="project-session-draft"
                  >
                    <span class="conversation-row-main">
                      <el-icon class="session-kind-icon">
                        <ChatDotRound/>
                      </el-icon>
                      <span class="conversation-title">{{ appStore.pendingSessionDraft.title }}</span>
                    </span>
                    <span class="conversation-row-trailing">
                      <small class="conversation-time-node">
                        待发送
                      </small>
                    </span>
                  </button>
                  <el-empty
                      v-if="group.sessions.length === 0 && !(appStore.pendingSessionDraft?.sessionType === 'project' && appStore.pendingSessionDraft.projectId === group.project.projectId)"
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
                              @click="stopNavigationAction($event); appStore.requestDeleteConversation(session)"
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
                          @click="stopNavigationAction($event); appStore.requestDeleteConversation(session)"
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
              <h1>
                {{ appStore.pendingSessionDraft ? appStore.pendingSessionDraft.title : activeSessionTitle }}
              </h1>
              <span
                  v-if="appStore.pendingSessionDraft?.sessionType === 'project'"
                  class="pending-session-hint"
              >
                项目对话草稿：{{ activeDraftProjectName }}，发送第一条消息后写入历史列表
              </span>
              <span
                  v-else-if="appStore.pendingSessionDraft?.sessionType === 'normal'"
                  class="pending-session-hint"
              >
                普通对话草稿，发送第一条消息后写入历史列表
              </span>
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

          <el-alert
              v-if="appStore.lastError"
              class="chat-visible-error"
              type="warning"
              :title="appStore.lastError"
              show-icon
              :closable="false"
          />

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

          <section class="conversation-body">
            <aside
                v-if="messageTimelineNodes.length > 0"
                class="conversation-timeline"
            >
              <el-tooltip
                  v-for="node in messageTimelineNodes"
                  :key="node.messageId"
                  placement="right"
                  :content="`${node.preview}\n${node.sentAt}`"
              >
                <button
                    class="timeline-node"
                    type="button"
                    @click="scrollToMessageAnchor(node.messageId)"
                >
                  <span class="timeline-dot"></span>
                  <span class="timeline-label">{{ node.label }}</span>
                </button>
              </el-tooltip>
            </aside>
            <section
                ref="messageListRef"
                class="message-list"
                data-auto-scroll="pinned-to-bottom"
                @scroll="updateMessageListPinnedState"
            >
            <template
                v-for="(row, rowIndex) in conversationRenderRows"
                :key="row.rowId"
            >
            <article
                v-if="row.rowKind === 'thinking'"
                class="message-row process thinking"
            >
              <details
                  class="thinking-block"
                  :open="row.thinking.defaultOpen"
              >
                <summary>{{ row.thinking.title }} · {{ row.thinking.statusLabel }}</summary>
                <div class="thinking-segments">
                  <p
                      v-for="segment in row.thinking.segments"
                      :key="segment.eventId"
                  >
                    <strong>{{ segment.statusLabel }}</strong>
                    <span>{{ segment.summary }}</span>
                  </p>
                </div>
              </details>
            </article>
            <article
                v-else-if="row.rowKind === 'process'"
                :class="[
                'message-row',
                'process',
                row.process.kind,
              ]"
            >
              <section class="process-card">
                <header>
                  <strong>{{ row.process.title }}</strong>
                  <small>{{ row.process.statusLabel }}</small>
                </header>
                <p>{{ row.process.summary }}</p>
                <div class="process-log-list">
                  <p
                      v-for="log in row.process.logs"
                      :key="log.eventId"
                  >
                    <code>{{ log.text }}</code>
                  </p>
                </div>
              </section>
            </article>
            <article
                v-else
                :class="[
                'message-row',
                row.message.role,
              ]"
                :data-message-anchor="row.message.role === 'user' ? row.message.messageId : undefined"
            >
              <div
                  class="markdown-body"
                v-html="appStore.renderMarkdown(row.message.contentMarkdown)"
              />
              <footer
                  v-if="shouldShowTurnTimeFooter(row.message, rowIndex) && findTurnForMessage(row.message)"
                  class="turn-time-footer"
              >
                {{ formatTurnTimeFooter(findTurnForMessage(row.message)!) }}
              </footer>
            </article>
            </template>
            <el-empty
                v-if="conversationRenderRows.length === 0"
                description="暂无消息"
            />
            </section>
          </section>

          <footer class="composer">
            <div
                v-if="activeRunningTurn"
                class="active-turn-elapsed"
            >
              当前轮次已耗时 {{ activeTurnElapsedText }}
            </div>
              <section
                  ref="composerRootRef"
                  class="composer-frame"
              >
                <section
                    class="composer-shell"
                    :class="{ 'is-focused': composerFocused }"
                    :style="composerPanelStyle"
                >
                <button
                    class="composer-resize-handle"
                    type="button"
                    :aria-label="composerResizeHandleLabel"
                    :title="composerResizeHandleLabel"
                    @pointerdown="startComposerResize"
                >
                  <span></span>
                </button>

                <section class="composer-entry-strip">
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
                    智能体 {{ agentStatusProgressText }}
                  </button>
                  <button
                      class="composer-entry-tab"
                      :class="{ active: activeComposerEntry === 'edit' && composerMiniDialogVisible }"
                      type="button"
                      @click="openComposerMiniDialog('edit')"
                  >
                    编辑<span class="composer-edit-summary">{{ editProgressText }}</span>
                  </button>
                </section>

                <section
                    v-if="composerMiniDialogVisible"
                    ref="composerMiniDialogRef"
                    class="composer-mini-popover"
                >
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
                      @select-node="openAgentConversationDialog"
                  />

                  <EditDetailDialog
                      v-if="activeComposerEntry === 'edit'"
                      v-model="composerMiniDialogVisible"
                      :files="appStore.composerEditFiles"
                      :active-file="activeComposerEditFile"
                      @select-file="selectComposerEditFile"
                  />
                </section>

                <section
                    v-if="appStore.queuedComposerMessages.length > 0"
                    class="pending-guidance-queue"
                >
                  <article
                      v-for="message in appStore.queuedComposerMessages"
                      :key="message.queuedMessageId"
                    class="pending-guidance-item"
                  >
                    <span>{{ message.contentMarkdown }}</span>
                    <small>{{ formatDisplayTime(message.createdAt) }}</small>
                    <el-button size="small" type="primary" @click="appStore.submitQueuedMessageAsGuidance(message.queuedMessageId)">
                      引导
                    </el-button>
                  </article>
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
                    ref="composerInputRef"
                    v-model="appStore.draft.text"
                    class="composer-textarea"
                    type="textarea"
                    :autosize="false"
                    :rows="5"
                    placeholder="输入消息，Enter 发送，@ 引用项目上下文"
                    @paste="appStore.handleComposerPaste"
                    @input="appStore.updateProjectReferenceQuery"
                    @focus="setComposerFocused(true)"
                    @blur="setComposerFocused(false)"
                    @keyup.enter.exact.prevent="handleComposerEnterSend"
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
                  <el-tooltip
                      placement="top"
                      :content="contextUsageTooltip"
                  >
                    <span class="composer-context-usage context-usage-tooltip">
                      <span
                          class="composer-context-ring"
                          :style="{ '--context-percent': composerContextPercentText }"
                          aria-hidden="true"
                      ></span>
                      <span class="composer-context-percent">
                        {{ composerContextPercentText }}
                      </span>
                    </span>
                  </el-tooltip>
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
                      @click="handleComposerPrimaryAction"
                  >
                    {{ composerPrimaryButtonText }}
                  </el-button>
                </div>
              </section>
              <section
                  v-if="appStore.entryMode === 'plugin-compact'"
                  class="plugin-inline-status"
              >
                <span>连接：{{ formatConnectionState(appStore.connectionState) }}</span>
                <span>任务：{{ activeTaskPanelRows[0].status }}</span>
                <span>{{ chatConversation.currentTurnNotice.value }}</span>
                <span>智能体：{{ agentStatusTreeRows.length > 0 ? `${agentStatusTreeRows.length} 个` : "暂无智能体" }}</span>
              </section>
            </section>
            </section>
          </footer>
        </article>

        <AgentConversationDialog
            v-model="agentConversationDialogVisible"
            :node="selectedAgentStatusNode"
            :messages="selectedAgentConversationMessages"
            :draft="agentConversationDraft"
            :task-text="`任务 ${taskProgressText}`"
            :agent-text="`智能体 ${agentStatusProgressText}`"
            :edit-text="`编辑${editProgressText}`"
            :context-usage-text="composerContextUsageText"
            :context-usage-tooltip="contextUsageTooltip"
            :selected-model="appStore.composerSettings.selectedModel"
            :execution-mode-label="executionModeLabel"
            :reasoning-effort-label="reasoningEffortLabel"
            :render-markdown="appStore.renderMarkdown"
            @update:draft="updateAgentConversationDraft"
            @send="sendAgentConversationDraft"
        />

        <StatusSummaryPanel
            v-if="appStore.entryMode !== 'plugin-compact'"
            :tasks="activeTaskPanelRows"
            :agent-rows="agentStatusTreeRows"
        />
      </section>
  </section>
</template>
