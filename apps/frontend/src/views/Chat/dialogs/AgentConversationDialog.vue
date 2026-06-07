<script setup lang="ts">
import type {
  AgentStatusTreeNode,
} from "@stores/app";
import ChatConversationPanel from "@views/Chat/components/ChatConversationPanel.vue";

const props = defineProps<{
  /** modelValue: 弹窗显隐状态。 */
  modelValue: boolean;
  /** node: 当前打开独立子对话的智能体节点。 */
  node: AgentStatusTreeNode | null;
}>();

const emit = defineEmits<{
  /** update:modelValue: 关闭弹窗时回写显隐。 */
  "update:modelValue": [
    value: boolean,
  ];
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
    <section class="agent-conversation-panel-shell">
      <ChatConversationPanel
          v-if="props.node"
          variant="agent"
          :agent-node="props.node"
      />
    </section>
  </el-dialog>
</template>

<style scoped>
:global(.agent-conversation-dialog .el-dialog__body) {
  display: flex;
  height: min(72vh, 760px);
  min-height: 40vh;
}

.agent-conversation-panel-shell {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 40vh;
  flex: 1 1 0;
  overflow: hidden;
}

:global(.agent-conversation-dialog .agent-conversation-panel-shell .conversation-body),
:global(.agent-conversation-dialog .agent-conversation-panel-shell .message-list) {
  min-height: 40vh;
}
</style>
