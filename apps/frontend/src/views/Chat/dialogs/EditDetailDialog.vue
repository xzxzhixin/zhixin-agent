<script setup lang="ts">
import type {
  ComposerEditFile,
} from "@stores/app";

const props = defineProps<{
  /** modelValue: 弹框显隐状态，由 MainView 控制。 */
  modelValue: boolean;
  /** files: 本轮真实编辑文件列表；无数据时展示明确空态。 */
  files: ComposerEditFile[];
  /** activeFile: 当前选中的编辑文件。 */
  activeFile: ComposerEditFile | null;
  /** canDeleteConversation: 当前是否有中心服务真实会话可进入删除确认。 */
  canDeleteConversation: boolean;
}>();

const emit = defineEmits<{
  /** update:modelValue: Element Plus 弹框关闭时回写显隐状态。 */
  "update:modelValue": [
    value: boolean,
  ];
  /** select-file: 用户选择某个编辑文件。 */
  "select-file": [
    file: ComposerEditFile,
  ];
  /** request-delete-conversation: 用户请求打开会话删除确认。 */
  "request-delete-conversation": [];
}>();
</script>

<template>
  <el-dialog
      :model-value="props.modelValue"
      append-to-body
      class="composer-mini-dialog edit-detail-dialog"
      title="编辑"
      width="720px"
      @update:model-value="emit('update:modelValue', $event)"
  >
    <section class="composer-mini-dialog-body composer-edit-panel">
      <el-empty
          v-if="props.files.length === 0"
          description="暂无本次编辑"
      />
      <section class="conversation-delete-section">
        <header>
          <strong>会话删除</strong>
          <span>点击后只打开确认弹框；复测取消路径不会执行不可逆删除。</span>
        </header>
        <el-button
            type="danger"
            plain
            :disabled="!props.canDeleteConversation"
            @click="emit('request-delete-conversation')"
        >
          确认删除对话
        </el-button>
      </section>
      <button
          v-for="file in props.files"
          :key="file.filePath"
          class="composer-edit-file"
          :class="{ active: props.activeFile?.filePath === file.filePath }"
          type="button"
          @click="emit('select-file', file)"
      >
        <header>
          <strong>{{ file.filePath }}</strong>
          <span>{{ file.changeKind }} · {{ file.previousEditLabel }} → {{ file.currentEditLabel }}</span>
        </header>
      </button>
      <pre
          v-if="props.activeFile"
          class="composer-diff-view"
      ><code
          v-for="line in props.activeFile.diffLines"
          :key="`${props.activeFile.filePath}-${line.kind}-${line.content}`"
          :class="`diff-${line.kind}`"
      >{{ line.content }}
</code></pre>
    </section>
  </el-dialog>
</template>

<style scoped>
:deep(.composer-mini-dialog .el-dialog__body) {
  max-height: min(68vh, 620px);
  overflow: hidden;
}

.composer-mini-dialog-body,
.composer-edit-panel {
  display: flex;
  min-height: 0;
  max-height: min(58vh, 520px);
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  overflow-x: hidden;
  overflow-y: auto;
}

.composer-edit-file {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
  color: var(--zhixin-text);
  text-align: left;
  cursor: pointer;
}

.conversation-delete-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
}

.conversation-delete-section header {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.conversation-delete-section span {
  color: var(--zhixin-text-soft);
  font-size: 12px;
}

.composer-edit-file.active,
.composer-edit-file:hover {
  border-color: var(--zhixin-selected-border);
  background: var(--zhixin-hover-bg);
}

.composer-edit-file header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.composer-edit-file strong,
.composer-edit-file span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-edit-file span {
  color: var(--zhixin-text-soft);
  font-size: 12px;
}

.composer-diff-view {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
}

.composer-diff-view code {
  display: block;
  font-family: Consolas, "Microsoft YaHei", monospace;
  white-space: pre;
}

.composer-diff-view .diff-added {
  color: #15803d;
}

.composer-diff-view .diff-removed {
  color: #dc2626;
}

.composer-diff-view .diff-context {
  color: var(--zhixin-text-soft);
}
</style>
