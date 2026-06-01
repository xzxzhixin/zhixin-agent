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

const props = defineProps<{
  /** modelValue: 弹框显隐状态，由 MainView 控制。 */
  modelValue: boolean;
  /** rows: 当前窗口内长期智能体和其子智能体两级树行。 */
  rows: AgentStatusTreeRow[];
  /** selectedNode: 当前选中智能体节点。 */
  selectedNode: AgentStatusTreeNode | null;
  /** messages: 当前智能体对话列表；暂时复用当前会话消息。 */
  messages: AgentConversationMessage[];
  /** draft: 智能体对话输入草稿。 */
  draft: string;
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
}>();
</script>

<template>
  <el-dialog
      :model-value="props.modelValue"
      class="composer-mini-dialog agent-status-dialog"
      title="智能体状态"
      width="720px"
      @update:model-value="emit('update:modelValue', $event)"
  >
    <section class="composer-mini-dialog-body agent-status-dialog-grid">
      <aside class="agent-status-tree">
        <button
            v-for="row in props.rows"
            :key="row.node.agentId"
            class="composer-agent-node"
            type="button"
            :class="{ active: props.selectedNode?.agentId === row.node.agentId }"
            :style="{ paddingLeft: `${10 + row.level * 18}px` }"
            @click="emit('select-node', row.node)"
        >
          <span>{{ row.node.name }}</span>
          <small>{{ row.node.nodeKind }} · {{ row.node.status }}</small>
        </button>
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
        <div class="child-agent-dialog-actions">
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
</style>
