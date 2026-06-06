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
  computed,
  ref,
} from "vue";

import {
  useAppStore,
} from "@stores/app";
import ProjectCapabilityDialog from "@views/Chat/dialogs/ProjectCapabilityDialog.vue";
import ChatConversationPanel from "@views/Chat/components/ChatConversationPanel.vue";
import {
  formatConnectionState,
  formatDisplayTime,
  flattenAgentTreeRows,
  projectTooltipContent,
  resolveTaskStatusMeta,
  type NavigationStatusMeta,
} from "@views/Chat/chat-view-helpers";
import type {
  ConversationSession,
  ProjectRecord,
} from "@zhixin/shared";
import {
  useChatConversation,
} from "./useChatConversation";
import StatusSummaryPanel from "./StatusSummaryPanel.vue";
import "./style.css";
// appStore：主界面读取运行时、会话、消息、任务和桌面能力状态。
const appStore = useAppStore();
// chatConversation：普通对话、项目对话和智能体对话弹框共用的完整对话组合能力。
const chatConversation = useChatConversation(appStore);
// messages：移动端简化消息列表继续复用当前主会话消息。
const messages = chatConversation.messages;
// projectCapabilityDialogVisible: 项目能力详情弹框显隐状态，只属于当前页面 UI。
const projectCapabilityDialogVisible = ref(false);
// activeTaskPanelRows: 右侧任务状态栏复用当前完整对话组合能力的任务行。
const activeTaskPanelRows = computed(() => {
  return chatConversation.taskPanelRows.value;
});
// agentStatusTreeRows: 右侧智能体状态栏与输入区智能体浮层同源，避免两处展示口径分裂。
const agentStatusTreeRows = computed(() => {
  return flattenAgentTreeRows(
    appStore.agentStatusTree,
    0,
  );
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
 * stopNavigationAction：阻止行内图标按钮触发选中或展开。
 *
 * @param event 鼠标事件。
 * @returns 没有返回值。
 */
function stopNavigationAction(event: MouseEvent): void {
  event.stopPropagation();
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

          <ChatConversationPanel />
        </article>

        <StatusSummaryPanel
            v-if="appStore.entryMode !== 'plugin-compact'"
            :tasks="activeTaskPanelRows"
            :agent-rows="agentStatusTreeRows"
        />
      </section>
  </section>
</template>
