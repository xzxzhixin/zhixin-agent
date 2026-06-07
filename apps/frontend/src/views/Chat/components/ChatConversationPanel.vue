<script setup lang="ts">
import {
  type ComponentPublicInstance,
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {ElMessageBox} from "element-plus";

import {
  type AgentStatusTreeNode,
  type ComposerEditFile,
  useAppStore,
} from "@stores/app";
import type {
  AgentSubConversationDetail,
  ConversationMessage,
  ConversationTurn,
} from "@zhixin/shared";
import {
  createConversationRenderRows,
  createMessageTimelineNodes,
  flattenAgentTreeRows,
  formatConnectionState,
  formatDisplayTime,
  formatDurationMs,
  formatTurnTimeFooter,
  type AgentStatusTreeRow,
  type ConversationRenderRow,
  type ThinkingProcessRow,
  type ProcessMessageGroupRow,
} from "@views/Chat/chat-view-helpers";
import {
  executionModeOptions,
  reasoningEffortOptions,
} from "@views/Chat/chat-view-options";
import AgentConversationDialog from "@views/Chat/dialogs/AgentConversationDialog.vue";
import AgentStatusDialog from "@views/Chat/dialogs/AgentStatusDialog.vue";
import EditDetailDialog from "@views/Chat/dialogs/EditDetailDialog.vue";
import TaskDetailDialog from "@views/Chat/dialogs/TaskDetailDialog.vue";
import {
  useChatConversation,
} from "@views/Chat/useChatConversation";
import {
  useComposerContextUsage,
} from "@views/Chat/useComposerContextUsage";
import {
  useComposerPanelResize,
} from "@views/Chat/useComposerPanelResize";
import {
  useMessageListAutoScroll,
} from "@views/Chat/useMessageListAutoScroll";

type ComposerEntryKind = "task" | "agentStatus" | "edit";

const props = withDefaults(defineProps<{
  /** variant: main 表示主对话，agent 表示智能体独立子对话。 */
  variant?: "main" | "agent";
  /** agentNode: 智能体子对话所属节点，仅 agent 模式必填。 */
  agentNode?: AgentStatusTreeNode | null;
}>(), {
  variant: "main",
  agentNode: null,
});

// appStore: 当前客户端 UI 状态和中心服务数据访问入口。
const appStore = useAppStore();
// chatConversation: 主会话完整对话组合能力，agent 模式只复用任务、事件和输入区周边状态。
const chatConversation = useChatConversation(appStore);
// agentDetail: 当前主会话内指定智能体的独立子对话详情。
const agentDetail = ref<AgentSubConversationDetail | null>(null);
// agentDraft: 智能体子对话输入草稿，避免污染主对话输入框。
const agentDraft = ref("");
// selectedAgentStatusNode: 主对话内当前准备打开的智能体节点。
const selectedAgentStatusNode = ref<AgentStatusTreeNode | null>(null);
// agentConversationDialogVisible: 主对话点击智能体节点后打开完整子对话弹框。
const agentConversationDialogVisible = ref(false);
// activeComposerEntry: 输入框三入口当前激活项。
const activeComposerEntry = ref<ComposerEntryKind>("task");
// composerMiniDialogVisible: 输入区上方浮层显隐。
const composerMiniDialogVisible = ref(false);
// composerRootRef: 输入区根节点，用于外部点击判断。
const composerRootRef = ref<HTMLElement | null>(null);
// composerMiniDialogRef: 三入口浮层节点，用于外部点击判断。
const composerMiniDialogRef = ref<HTMLElement | null>(null);
// composerInputRef: Element Plus 输入框引用，打开浮层时释放真实焦点。
const composerInputRef = ref<ComponentPublicInstance<{
  /** blur: Element Plus 输入组件失焦方法。 */
  blur: () => void;
}> | null>(null);
// composerFocused: 输入框视觉焦点状态，只影响当前浏览器 UI。
const composerFocused = ref(false);
// selectedComposerEditFilePath: 当前选中的编辑文件路径。
const selectedComposerEditFilePath = ref("");
// diffDialogVisible: Web 端编辑对比弹框显隐。
const diffDialogVisible = ref(false);
// diffPreviewText: Web 端展示的统一 diff 文本。
const diffPreviewText = ref("");

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
const {
  composerContextPercentText,
  composerContextProgressValue,
  contextUsageTooltip,
} = useComposerContextUsage(appStore);

// isAgentConversation: 当前组件是否渲染智能体独立子对话。
const isAgentConversation = computed(() => props.variant === "agent");
// messages: 当前组件消息源，主对话来自 sessionDetail，智能体弹框来自子对话 API。
const messages = computed<ConversationMessage[]>(() => {
  if (!isAgentConversation.value) {
    return chatConversation.messages.value;
  }
  return (agentDetail.value?.messages ?? []).map((message) => {
    return {
      messageId: message.messageId,
      sessionId: message.parentSessionId,
      turnId: null,
      role: message.role,
      contentMarkdown: message.contentMarkdown,
      createdAt: message.createdAt,
    };
  });
});
// turns: 主对话展示轮次时间，智能体子对话当前没有独立轮次事实。
const turns = computed<ConversationTurn[]>(() => {
  return isAgentConversation.value
    ? []
    : chatConversation.turns.value;
});
// messageTimelineNodes: 左侧时间线直接从当前消息源派生。
const messageTimelineNodes = computed(() => {
  return createMessageTimelineNodes(messages.value);
});
// thinkingProcessRows: 思考过程仅主对话来源于中心服务事件。
const thinkingProcessRows = computed<ThinkingProcessRow[]>(() => {
  return isAgentConversation.value
    ? []
    : chatConversation.thinkingProcessRows.value;
});
// processMessageRows: 工具过程仅主对话来源于中心服务事件。
const processMessageRows = computed<ProcessMessageGroupRow[]>(() => {
  return isAgentConversation.value
    ? []
    : chatConversation.processMessageRows.value;
});
// conversationRenderRows: 当前完整对话区渲染行。
const conversationRenderRows = computed<ConversationRenderRow[]>(() => {
  return createConversationRenderRows(
    messages.value,
    thinkingProcessRows.value,
    processMessageRows.value,
    isAgentConversation.value
      ? []
      : appStore.events,
  );
});
// agentStatusTreeRows: 智能体浮层两级树行。
const agentStatusTreeRows = computed<AgentStatusTreeRow[]>(() => {
  return flattenAgentTreeRows(
    appStore.agentStatusTree,
    0,
  );
});
// activeTaskPanelRows: 当前轮次任务列表。
const activeTaskPanelRows = computed(() => {
  return chatConversation.taskPanelRows.value;
});
// activeComposerEditFile: 当前编辑浮层选中文件。
const activeComposerEditFile = computed(() => {
  const selectedFile = appStore.composerEditFiles.find((file) => {
    return file.filePath === selectedComposerEditFilePath.value;
  });
  const [
    firstFile,
  ] = appStore.composerEditFiles;
  return selectedFile ?? firstFile ?? null;
});
// taskProgressText: 任务入口数字。
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
// agentStatusProgressText: 智能体入口数字。
const agentStatusProgressText = computed(() => {
  const longTermNodes = appStore.agentStatusTree.filter((node) => {
    return node.nodeKind === "主智能体" || node.nodeKind === "长期智能体";
  });
  const running = longTermNodes.filter((node) => {
    return node.status === "工作中" || node.status === "执行中";
  }).length;
  return longTermNodes.length === 0
    ? "0/0"
    : `${running}/${longTermNodes.length}`;
});
// editProgressText: 编辑入口增删摘要。
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
  return totals.added === 0 && totals.removed === 0
    ? ""
    : ` +${totals.added} -${totals.removed}`;
});
// activeRunningTurn: 主对话当前运行轮次。
const activeRunningTurn = computed(() => {
  if (isAgentConversation.value) {
    return null;
  }
  return [...turns.value].reverse().find((turn) => {
    return turn.endedAt === null && (
      turn.status === "running"
      || turn.status === "waiting_user"
    );
  }) ?? null;
});
// nowTick: 运行中耗时刷新时钟，只影响当前 UI。
const nowTick = ref(Date.now());
// activeTurnElapsedText: 当前轮次耗时文案。
const activeTurnElapsedText = computed(() => {
  if (!activeRunningTurn.value) {
    return "";
  }
  const startedAt = new Date(activeRunningTurn.value.startedAt).getTime();
  return Number.isNaN(startedAt)
    ? "本轮处理中"
    : formatDurationMs(Math.max(0, nowTick.value - startedAt));
});
// composerPrimaryButtonText: 输入区主按钮只展示发送或停止。
const composerPrimaryButtonText = computed(() => {
  return activeRunningTurn.value
    ? "停止"
    : "发送";
});
// draftText: 主对话和智能体子对话共用 textarea 模型。
const draftText = computed({
  get() {
    return isAgentConversation.value
      ? agentDraft.value
      : appStore.draft.text;
  },
  set(value: string) {
    if (isAgentConversation.value) {
      agentDraft.value = value;
      return;
    }
    appStore.draft.text = value;
  },
});
// elapsedTimer: 当前轮次耗时刷新定时器。
const elapsedTimer = window.setInterval(() => {
  nowTick.value = Date.now();
}, 1000);

/**
 * openComposerMiniDialog：打开或切换输入区三入口浮层。
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
}

/**
 * closeComposerMiniDialogOnInputFocus：点击输入框时关闭已打开浮层。
 *
 * @returns 没有返回值。
 */
function closeComposerMiniDialogOnInputFocus(): void {
  composerMiniDialogVisible.value = false;
  setComposerFocused(true);
}

/**
 * handleComposerOutsidePointerDown：点击输入区外部时关闭浮层。
 *
 * @param event 指针事件。
 * @returns 没有返回值。
 */
function handleComposerOutsidePointerDown(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }
  const clickedInsideComposer = composerRootRef.value?.contains(target) ?? false;
  const clickedInsideDialog = composerMiniDialogRef.value?.contains(target) ?? false;
  if (!clickedInsideComposer && !clickedInsideDialog) {
    composerMiniDialogVisible.value = false;
  }
}

/**
 * openAgentConversationDialog：打开指定智能体的完整子对话弹框。
 *
 * @param node 智能体状态节点。
 * @returns 没有返回值。
 */
function openAgentConversationDialog(node: AgentStatusTreeNode): void {
  selectedAgentStatusNode.value = node;
  agentConversationDialogVisible.value = true;
  composerMiniDialogVisible.value = false;
}

/**
 * selectComposerEditFile：切换编辑浮层当前文件。
 *
 * @param file 编辑文件。
 * @returns 没有返回值。
 */
function selectComposerEditFile(file: ComposerEditFile): void {
  selectedComposerEditFilePath.value = file.filePath;
}

/**
 * saveComposerEditFile：保存单文件编辑。
 *
 * @param file 编辑文件。
 * @returns 没有返回值。
 */
function saveComposerEditFile(file: ComposerEditFile): void {
  void appStore.saveComposerEditFile(file.editId);
}

/**
 * revertComposerEditFile：撤回单文件编辑。
 *
 * @param file 编辑文件。
 * @returns 没有返回值。
 */
function revertComposerEditFile(file: ComposerEditFile): void {
  void appStore.revertComposerEditFile(file.editId);
}

/**
 * saveAllComposerEditFiles：保存全部待确认编辑。
 *
 * @returns 没有返回值。
 */
function saveAllComposerEditFiles(): void {
  void appStore.saveAllComposerEditFiles();
}

/**
 * revertAllComposerEditFiles：撤回全部待确认编辑。
 *
 * @returns 没有返回值。
 */
function revertAllComposerEditFiles(): void {
  void appStore.revertAllComposerEditFiles();
}

/**
 * openComposerEditDiff：打开文件编辑对比。
 *
 * @param file 编辑文件。
 * @returns 没有返回值。
 */
async function openComposerEditDiff(file: ComposerEditFile): Promise<void> {
  diffPreviewText.value = await appStore.openComposerEditDiff(file.editId);
  if (!window.zhixinPlugin?.openEditDiff) {
    diffDialogVisible.value = true;
  }
}

/**
 * scrollToMessageAnchor：按消息 ID 定位消息。
 *
 * @param messageId 消息 ID。
 * @returns 没有返回值。
 */
function scrollToMessageAnchor(messageId: string): void {
  const anchor = document.querySelector(`[data-message-anchor="${messageId}"]`);
  if (!anchor) {
    return;
  }
  pauseAutoScrollForHistoryView();
  // timeline-target: 时间线定位需要短暂高亮目标消息，避免用户在长消息流里丢失定位结果。
  anchor.classList.add("timeline-target");
  anchor.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
  window.setTimeout(
    () => {
      anchor.classList.remove("timeline-target");
    },
    1600,
  );
}

/**
 * setComposerFocused：设置输入框焦点视觉状态。
 *
 * @param focused 是否聚焦。
 * @returns 没有返回值。
 */
function setComposerFocused(focused: boolean): void {
  composerFocused.value = focused;
}

/**
 * blurComposerInput：释放输入框真实焦点。
 *
 * @returns 没有返回值。
 */
function blurComposerInput(): void {
  composerInputRef.value?.blur();
  composerFocused.value = false;
}

/**
 * findTurnForMessage：查找消息所属轮次。
 *
 * @param message 当前消息。
 * @returns 轮次或 null。
 */
function findTurnForMessage(message: ConversationMessage): ConversationTurn | null {
  if (!message.turnId) {
    return null;
  }
  return turns.value.find((turn) => {
    return turn.turnId === message.turnId;
  }) ?? null;
}

/**
 * shouldShowTurnTimeFooter：判断是否展示轮次时间尾注。
 *
 * @param message 当前消息。
 * @param renderRowIndex 当前渲染行索引。
 * @returns 需要展示时返回 true。
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
 * handleComposerEnterSend：处理 Enter 发送。
 *
 * @returns 没有返回值。
 */
function handleComposerEnterSend(): void {
  void handleComposerPrimaryAction();
}

/**
 * handleComposerPrimaryAction：处理发送或停止。
 *
 * @returns 没有返回值。
 */
async function handleComposerPrimaryAction(): Promise<void> {
  if (activeRunningTurn.value) {
    await appStore.stopActiveConversationTurn();
    return;
  }
  if (isAgentConversation.value) {
    await sendAgentDraft();
    return;
  }
  await chatConversation.sendDraftForConversation();
}

/**
 * sendAgentDraft：发送智能体子对话草稿。
 *
 * @returns 没有返回值。
 */
async function sendAgentDraft(): Promise<void> {
  if (!props.agentNode || !appStore.activeSessionId || agentDraft.value.trim().length === 0) {
    return;
  }
  agentDetail.value = await appStore.sendAgentSubConversationMessage({
    parentSessionId: appStore.activeSessionId,
    agentId: props.agentNode.agentId,
    agentName: props.agentNode.name,
    contentMarkdown: agentDraft.value.trim(),
  });
  agentDraft.value = "";
}

/**
 * loadAgentDetail：加载智能体子对话详情。
 *
 * @returns 没有返回值。
 */
async function loadAgentDetail(): Promise<void> {
  if (!isAgentConversation.value || !props.agentNode || !appStore.activeSessionId) {
    return;
  }
  agentDetail.value = await appStore.loadAgentSubConversation({
    parentSessionId: appStore.activeSessionId,
    agentId: props.agentNode.agentId,
    agentName: props.agentNode.name,
  });
}

watch(
  () => appStore.composerEditFiles,
  (files) => {
    const [
      firstFile,
    ] = files;
    if (!firstFile) {
      selectedComposerEditFilePath.value = "";
      return;
    }
    const exists = files.some((file) => file.filePath === selectedComposerEditFilePath.value);
    if (!exists) {
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
    props.agentNode?.agentId,
  ],
  () => {
    void loadAgentDetail();
    void appStore.loadPendingEditsForActiveSession();
    requestAutoScrollToBottom(true);
  },
  {
    immediate: true,
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
  <section class="chat-conversation-panel">
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
                  <span>{{ segment.summary }}</span>
                </p>
              </div>
            </details>
          </article>
          <article
              v-else-if="row.rowKind === 'process'"
              :class="['message-row', 'process', row.process.kind]"
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
              :class="['message-row', row.message.role]"
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
            :class="{ 'is-focused': composerFocused, 'is-resizing': isComposerResizing }"
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
                @save-file="saveComposerEditFile"
                @revert-file="revertComposerEditFile"
                @diff-file="openComposerEditDiff"
                @save-all="saveAllComposerEditFiles"
                @revert-all="revertAllComposerEditFiles"
            />
          </section>

          <section
              v-if="!isAgentConversation && appStore.queuedComposerMessages.length > 0"
              class="pending-guidance-queue"
          >
            <article
                v-for="message in appStore.queuedComposerMessages"
                :key="message.queuedMessageId"
                class="pending-guidance-item"
            >
              <span>{{ message.contentMarkdown }}</span>
              <small>{{ formatDisplayTime(message.createdAt) }}</small>
              <el-button
                  size="small"
                  type="primary"
                  @click="appStore.submitQueuedMessageAsGuidance(message.queuedMessageId)"
              >
                引导
              </el-button>
            </article>
          </section>

          <div
              v-if="!isAgentConversation && (appStore.draft.attachments.length > 0 || appStore.draft.references.length > 0)"
              class="composer-tags"
          >
            <el-tag
                v-for="(attachment, index) in appStore.draft.attachments"
                :key="attachment.temporaryAttachmentId"
                class="composer-attachment-tag"
                closable
                type="info"
                @close="appStore.removeAttachment(index)"
            >
              {{ attachment.fileName }}
            </el-tag>
            <el-tag
                v-for="(reference, index) in appStore.draft.references"
                :key="`${reference.type}-${index}`"
                class="composer-reference-tag"
                closable
                type="success"
                @close="appStore.removeReference(index)"
            >
              {{ reference.displayName }}
            </el-tag>
          </div>

          <div
              v-if="!isAgentConversation && appStore.canUseProjectReferences && appStore.showProjectReferencePopover"
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
                v-model="draftText"
                class="composer-textarea"
                type="textarea"
                :autosize="false"
                :rows="5"
                placeholder="输入消息，Enter 发送，@ 引用项目上下文"
                @paste="!isAgentConversation && appStore.handleComposerPaste($event)"
                @input="!isAgentConversation && appStore.updateProjectReferenceQuery()"
                @focus="closeComposerMiniDialogOnInputFocus"
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
                  <el-progress
                      class="composer-context-progress"
                      type="circle"
                      :percentage="composerContextProgressValue"
                      :width="16"
                      :stroke-width="2"
                      :show-text="false"
                  />
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

    <AgentConversationDialog
        v-if="!isAgentConversation"
        v-model="agentConversationDialogVisible"
        :node="selectedAgentStatusNode"
    />
    <el-dialog
        v-model="diffDialogVisible"
        title="编辑前后对比"
        width="72vw"
    >
      <pre class="composer-edit-diff-preview">{{ diffPreviewText }}</pre>
    </el-dialog>
  </section>
</template>

<style scoped>
.chat-conversation-panel {
  display: flex;
  min-height: 0;
  flex: 1 1 0;
  flex-direction: column;
  overflow: hidden;
}

.conversation-body {
  display: flex;
  min-height: 40vh;
  flex: 1 1 0;
  gap: 10px;
  overflow: hidden;
}

.conversation-timeline {
  display: flex;
  width: 54px;
  min-height: 0;
  flex: 0 0 54px;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 4px;
  overflow: hidden auto;
  border-right: 1px solid var(--el-border-color-lighter);
}

.message-list {
  min-width: 0;
  min-height: 40vh;
  flex: 1 1 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.composer {
  display: flex;
  width: 100%;
  box-sizing: border-box;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  margin-top: auto;
  padding-top: 12px;
  padding-bottom: 10px;
  position: relative;
  z-index: 2;
}

.composer-frame {
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
}

.composer-edit-diff-preview {
  max-height: 62vh;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
}
</style>
