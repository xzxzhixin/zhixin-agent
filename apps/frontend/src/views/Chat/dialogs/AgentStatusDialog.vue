<script setup lang="ts">
import type {
  AgentStatusTreeNode,
} from "@stores/app";

/**
 * AgentStatusTreeRow：智能体状态树扁平行。
 *
 * 来源：MainView 对两级树的展示转换。
 * 含义：保留节点和层级缩进，不改变中心服务智能体事实。
 */
interface AgentStatusTreeRow {
  /** node: 智能体状态树节点。 */
  node: AgentStatusTreeNode;
  /** level: 展示层级，长期智能体为 0，子智能体为 1。 */
  level: number;
}

/**
 * AgentConversationMessage：智能体对话复用的消息行。
 *
 * 来源：当前会话消息列表。
 * 含义：中心服务没有独立智能体会话 API 时，先展示当前会话消息。
 */
interface AgentConversationMessage {
  /** messageId: 消息 ID，来源于中心服务。 */
  messageId: string;
  /** role: 消息角色，来源于中心服务消息协议。 */
  role: string;
  /** contentMarkdown: 消息 Markdown 内容，来源于中心服务消息协议。 */
  contentMarkdown: string;
}

/**
 * AgentConversationTask：智能体对话内复用的任务行。
 *
 * 来源：外层完整对话组合能力。
 * 含义：让智能体对话弹框使用同一套任务事实源，而不是固定占位文案。
 */
interface AgentConversationTask {
  /** id: 任务行唯一 ID。 */
  id: string;
  /** title: 任务标题。 */
  title: string;
  /** status: 任务状态中文文案。 */
  status: string;
  /** summary: 任务摘要。 */
  summary: string;
  /** scopeHint: 当前任务状态作用域说明。 */
  scopeHint: string;
  /** currentTurnNotice: 当前轮次提示。 */
  currentTurnNotice: string;
}

const props = defineProps<{
  /** modelValue: 弹框显隐状态，由 MainView 控制。 */
  modelValue: boolean;
  /** rows: 当前窗口内长期智能体和其子智能体两级树行。 */
  rows: AgentStatusTreeRow[];
  /** selectedNode: 当前选中智能体节点。 */
  selectedNode: AgentStatusTreeNode | null;
  /** messages: 当前智能体对话列表；暂时复用当前会话消息。 */
  messages: AgentConversationMessage[];
  /** tasks: 当前对话任务行，来源于统一完整对话组合能力。 */
  tasks: AgentConversationTask[];
  /** draft: 智能体对话输入草稿。 */
  draft: string;
  /** currentTurnNotice: 当前对话当前轮次排队、引导或确认提示。 */
  currentTurnNotice: string;
  /** renderMarkdown: Markdown 渲染函数，沿用 store 的统一渲染能力。 */
  renderMarkdown: (markdown: string) => string;
}>();

const emit = defineEmits<{
  /** update:modelValue: Element Plus 弹框关闭时回写显隐状态。 */
  "update:modelValue": [
    value: boolean,
  ];
  /** select-node: 用户点击智能体节点后通知 MainView 切换详情。 */
  "select-node": [
    node: AgentStatusTreeNode,
  ];
  /** update:draft: 智能体对话草稿输入变化。 */
  "update:draft": [
    value: string,
  ];
  /** send: 用户点击发送后由 MainView 调用当前会话发送协议。 */
  send: [];
  /** guide: 用户点击引导后由 MainView 按当前轮次引导语义发送。 */
  guide: [];
}>();

/**
 * treeProps：Element Plus 树字段映射。
 *
 * 来源：AgentStatusTreeNode 协议。
 * 含义：让 el-tree 按 name 和 children 渲染两级结构。
 */
const treeProps = {
  /** label: 节点显示名字段。 */
  label: "name",
  /** children: 子智能体节点字段。 */
  children: "children",
};

/**
 * defaultExpandedKeys：默认展开长期智能体节点。
 *
 * 来源：本轮验收要求“测试长期智能体”默认展开。
 */
const defaultExpandedKeys = props.rows.filter((row) => {
  return row.level === 0;
}).map((row) => {
  return row.node.agentId;
});

/**
 * treeNodes：从扁平行恢复树根节点。
 *
 * 来源：MainView 传入的长期智能体行。
 */
const treeNodes = props.rows.filter((row) => {
  return row.level === 0;
}).map((row) => {
  return row.node;
});
</script>

<template>
  <el-dialog
      :model-value="props.modelValue"
      append-to-body
      class="composer-mini-dialog agent-status-dialog"
      title="智能体状态"
      @update:model-value="emit('update:modelValue', $event)"
  >
    <section class="composer-mini-dialog-body agent-status-dialog-grid">
      <aside class="agent-status-tree">
        <el-tree
            class="agent-status-el-tree"
            :data="treeNodes"
            node-key="agentId"
            :props="treeProps"
            :default-expanded-keys="defaultExpandedKeys"
            highlight-current
            @node-click="emit('select-node', $event)"
        >
          <template #default="{ data }">
            <span
                class="composer-agent-node"
                :class="{ active: props.selectedNode?.agentId === data.agentId }"
            >
              <span>{{ data.name }}</span>
              <small>{{ data.nodeKind }} · {{ data.status }}</small>
            </span>
          </template>
        </el-tree>
        <el-empty
            v-if="props.rows.length === 0"
            description="暂无智能体状态；主智能体、长期智能体和子智能体会按中心服务状态同步到这里。"
        />
      </aside>
      <section
          v-if="props.selectedNode"
          class="agent-conversation-detail"
      >
        <header>
          <strong>{{ props.selectedNode.name }}</strong>
          <span>{{ props.selectedNode.nodeKind }} · {{ props.selectedNode.status }} · {{ props.selectedNode.taskSummary }}</span>
        </header>
        <p class="panel-muted">
          {{ props.selectedNode.conversationHint }} 当前中心服务没有独立智能体会话 API，查看和发送仍通过当前会话发送。
        </p>
        <p class="panel-muted">
          {{ props.currentTurnNotice }}
        </p>
        <div class="agent-conversation-list">
          <article
              v-for="message in props.messages"
              :key="`${props.selectedNode.agentId}-${message.messageId}`"
              :class="[
              'child-agent-message',
              message.role,
            ]"
          >
            <div
                class="markdown-body"
                v-html="props.renderMarkdown(message.contentMarkdown)"
            />
          </article>
          <el-empty
              v-if="props.messages.length === 0"
              description="暂无该智能体对话记录；当前视图复用当前会话消息。"
          />
        </div>
        <el-input
            :model-value="props.draft"
            type="textarea"
            :rows="4"
            placeholder="向当前智能体发送消息"
            @update:model-value="emit('update:draft', $event)"
        />
        <section class="agent-composer-full-controls">
          <div class="composer-entry-tabs">
            <button
                class="composer-entry-tab"
                type="button"
            >
              任务 {{ props.tasks.filter((task) => task.status === "已完成").length }}/{{ props.tasks.length }}
            </button>
            <button
                class="composer-entry-tab"
                type="button"
            >
              智能体状态 {{ props.selectedNode.status }}
            </button>
            <button
                class="composer-entry-tab"
                type="button"
            >
              编辑
            </button>
          </div>
          <div class="agent-task-brief-list">
            <article
                v-for="task in props.tasks"
                :key="`${props.selectedNode.agentId}-${task.id}`"
            >
              <strong>{{ task.title }}</strong>
              <span>{{ task.status }}</span>
              <small>{{ task.summary }}</small>
              <small>{{ task.scopeHint }}</small>
              <small>{{ task.currentTurnNotice }}</small>
            </article>
          </div>
          <div class="agent-composer-control-grid">
            <el-select
                model-value="当前模型"
                size="small"
                disabled
            >
              <el-option
                  label="沿用外部输入区模型"
                  value="当前模型"
              />
            </el-select>
            <el-select
                model-value="medium"
                size="small"
                disabled
            >
              <el-option
                  label="中推理"
                  value="medium"
              />
            </el-select>
            <el-select
                model-value="full_auto"
                size="small"
                disabled
            >
              <el-option
                  label="全自动"
                  value="full_auto"
              />
            </el-select>
          </div>
          <p class="panel-muted">
            引用、附件、模型、推理深度、执行模式、上下文统计、任务、智能体状态和编辑入口沿用外部完整输入框能力；当前弹框发送会进入当前会话。
          </p>
        </section>
        <div class="child-agent-dialog-actions">
          <el-button
              :disabled="props.draft.trim().length === 0"
              @click="emit('guide')"
          >
            发送引导
          </el-button>
          <el-button
              type="primary"
              :disabled="props.draft.trim().length === 0"
              @click="emit('send')"
          >
            发送到当前会话
          </el-button>
        </div>
      </section>
    </section>
  </el-dialog>
</template>

<style scoped>
:deep(.composer-mini-dialog .el-dialog__body) {
  max-height: min(68vh, 620px);
  overflow: hidden;
}

.composer-mini-dialog-body {
  display: flex;
  min-height: 0;
  max-height: min(58vh, 520px);
  flex-direction: column;
  gap: 10px;
  overflow-x: hidden;
  overflow-y: auto;
}

.agent-status-dialog-grid {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
}

.agent-status-tree {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 6px;
  overflow-x: hidden;
  overflow-y: auto;
}

.agent-status-el-tree {
  --el-tree-node-hover-bg-color: var(--zhixin-hover-bg);
}

.composer-agent-node {
  display: flex;
  width: 100%;
  min-height: 34px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 7px;
  padding-right: 10px;
  padding-bottom: 7px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
  color: var(--zhixin-text);
  text-align: left;
  cursor: pointer;
}

.composer-agent-node:hover {
  border-color: var(--zhixin-selected-border);
  background: var(--zhixin-hover-bg);
}

.composer-agent-node.active {
  border-color: var(--zhixin-selected-border);
  background: var(--zhixin-selected-bg);
}

.composer-agent-node span,
.composer-agent-node small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-agent-node small {
  color: var(--zhixin-text-soft);
  font-size: 12px;
}

.agent-conversation-detail {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.agent-conversation-detail header {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 4px;
}

.agent-conversation-detail header span {
  color: var(--zhixin-text-soft);
  font-size: 12px;
}

.agent-conversation-list {
  display: flex;
  min-height: 180px;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
  overflow-x: hidden;
  overflow-y: auto;
}

.child-agent-message {
  max-width: 86%;
  padding: 9px 11px;
  border-radius: 8px;
  line-height: 1.5;
}

.child-agent-message.assistant {
  align-self: flex-start;
  background: var(--zhixin-soft-bg);
}

.child-agent-message.user {
  align-self: flex-end;
  background: var(--zhixin-selected-bg);
}

.child-agent-dialog-actions {
  display: flex;
  justify-content: flex-end;
}

.agent-composer-full-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.composer-entry-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.composer-entry-tab {
  min-height: 28px;
  padding: 4px 9px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
  color: var(--zhixin-text);
}

.agent-composer-control-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.agent-task-brief-list {
  display: flex;
  max-height: 120px;
  flex-direction: column;
  gap: 6px;
  overflow-x: hidden;
  overflow-y: auto;
}

.agent-task-brief-list article {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 8px;
  padding: 7px 8px;
  border: 1px solid var(--zhixin-border);
  border-radius: 7px;
  background: var(--zhixin-soft-bg);
}

.agent-task-brief-list strong,
.agent-task-brief-list span,
.agent-task-brief-list small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-task-brief-list small {
  grid-column: 1 / -1;
  color: var(--zhixin-text-soft);
  font-size: 12px;
}
</style>
