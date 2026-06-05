<script setup lang="ts">
import type {
  AgentStatusTreeNode,
} from "@stores/app";

/**
 * AgentConversationMessage：智能体对话弹窗消息行。
 *
 * 来源：当前会话消息列表。
 * 含义：中心服务未提供独立智能体会话 API 前，弹窗复用当前会话消息。
 * 格式：消息 ID、角色和 Markdown 内容。
 * 默认值：无消息时展示空态。
 * 约束：不猜测独立智能体会话字段。
 */
interface AgentConversationMessage {
  /** messageId: 消息 ID，来源于中心服务消息协议。 */
  messageId: string;
  /** role: 消息角色，来源于中心服务消息协议。 */
  role: string;
  /** contentMarkdown: 消息 Markdown 内容，来源于中心服务消息协议。 */
  contentMarkdown: string;
}

const props = defineProps<{
  /** modelValue: 弹窗显隐状态。 */
  modelValue: boolean;
  /** node: 当前打开完整对话的智能体节点。 */
  node: AgentStatusTreeNode | null;
  /** messages: 当前会话消息列表，作为临时智能体对话视图。 */
  messages: AgentConversationMessage[];
  /** draft: 智能体对话输入草稿。 */
  draft: string;
  /** taskText: 任务入口摘要。 */
  taskText: string;
  /** agentText: 智能体入口摘要。 */
  agentText: string;
  /** editText: 编辑入口摘要。 */
  editText: string;
  /** contextUsageText: 当前窗口上下文用量展示。 */
  contextUsageText: string;
  /** contextUsageTooltip: 当前窗口上下文用量说明。 */
  contextUsageTooltip: string;
  /** selectedModel: 当前模型名称。 */
  selectedModel: string;
  /** executionModeLabel: 当前执行模式中文名。 */
  executionModeLabel: string;
  /** reasoningEffortLabel: 当前推理深度中文名。 */
  reasoningEffortLabel: string;
  /** renderMarkdown: Markdown 渲染函数。 */
  renderMarkdown: (markdown: string) => string;
}>();

const emit = defineEmits<{
  /** update:modelValue: 关闭弹窗时回写显隐。 */
  "update:modelValue": [
    value: boolean,
  ];
  /** update:draft: 输入草稿变化。 */
  "update:draft": [
    value: string,
  ];
  /** send: 发送当前智能体草稿。 */
  send: [];
}>();
</script>

<template>
  <el-dialog
      :model-value="props.modelValue"
      class="agent-conversation-dialog"
      width="80vw"
      :title="props.node ? `${props.node.name} 对话` : '智能体对话'"
      @update:model-value="emit('update:modelValue', $event)"
  >
    <section
        v-if="props.node"
        class="agent-dialog-shell"
    >
      <header class="agent-dialog-summary">
        <strong>{{ props.node.nodeKind }} · {{ props.node.status }}</strong>
        <span>{{ props.node.taskSummary }}</span>
        <small>{{ props.node.conversationHint }} 当前仍通过当前会话发送。</small>
      </header>

      <section class="agent-dialog-message-list">
        <article
            v-for="message in props.messages"
            :key="`${props.node.agentId}-${message.messageId}`"
            :class="[
            'agent-dialog-message',
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
            description="暂无对话消息"
        />
      </section>

      <footer class="agent-dialog-composer">
        <section class="agent-dialog-entry-strip">
          <button
              class="agent-dialog-entry"
              type="button"
          >
            {{ props.taskText }}
          </button>
          <button
              class="agent-dialog-entry"
              type="button"
          >
            {{ props.agentText }}
          </button>
          <button
              class="agent-dialog-entry"
              type="button"
          >
            {{ props.editText }}
          </button>
        </section>
        <section class="agent-dialog-composer-shell">
          <el-input
              class="agent-dialog-textarea"
              :model-value="props.draft"
              type="textarea"
              :autosize="false"
              :rows="5"
              placeholder="向当前智能体发送消息"
              @update:model-value="emit('update:draft', $event)"
              @keyup.enter.exact.prevent="emit('send')"
          />
          <section class="agent-dialog-toolbar">
            <div class="agent-dialog-tools">
              <el-tooltip
                  placement="top"
                  :content="props.contextUsageTooltip"
              >
                <span class="context-usage-tooltip">
                  上下文 {{ props.contextUsageText }}
                </span>
              </el-tooltip>
            </div>
            <div class="agent-dialog-controls">
              <span>{{ props.selectedModel }}</span>
              <span>{{ props.executionModeLabel }}</span>
              <span>{{ props.reasoningEffortLabel }}</span>
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
      </footer>
    </section>
  </el-dialog>
</template>

<style scoped>
.agent-dialog-shell {
  display: flex;
  height: min(72vh, 760px);
  min-height: 0;
  flex-direction: column;
  gap: 12px;
}

.agent-dialog-summary {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 4px;
}

.agent-dialog-summary span,
.agent-dialog-summary small {
  color: var(--zhixin-text-soft);
}

.agent-dialog-message-list {
  display: flex;
  min-height: 0;
  flex: 1 1 0;
  flex-direction: column;
  gap: 10px;
  overflow-x: hidden;
  overflow-y: auto;
}

.agent-dialog-message {
  max-width: 82%;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
}

.agent-dialog-message.user {
  align-self: flex-end;
  background: var(--zhixin-selected-bg);
}

.agent-dialog-composer {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 8px;
}

.agent-dialog-entry-strip {
  display: flex;
  gap: 8px;
}

.agent-dialog-entry {
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
  color: var(--zhixin-text);
}

.agent-dialog-composer-shell {
  display: flex;
  min-height: 170px;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
}

.agent-dialog-textarea {
  flex: 1 1 auto;
}

.agent-dialog-toolbar,
.agent-dialog-controls,
.agent-dialog-tools {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.agent-dialog-toolbar {
  justify-content: space-between;
}

.agent-dialog-controls span {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
