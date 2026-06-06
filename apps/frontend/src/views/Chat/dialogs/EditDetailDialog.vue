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
}>();

const emit = defineEmits<{
  /** select-file: 用户选择某个编辑文件。 */
  "select-file": [
    file: ComposerEditFile,
  ];
}>();
</script>

<template>
  <section
      v-if="props.modelValue"
      class="composer-mini-dialog edit-detail-dialog"
  >
    <section class="composer-mini-dialog-body composer-edit-panel">
      <p class="composer-edit-description">
        本轮编辑摘要：以下文字列出本次对话涉及的文件、变更类型和前后版本说明。
      </p>
      <el-empty
          v-if="props.files.length === 0"
          description="暂无本次编辑"
      />
      <ul
          v-else
          class="composer-edit-text-list"
      >
        <li
            v-for="file in props.files"
            :key="file.filePath"
            class="composer-edit-file"
            :class="{ active: props.activeFile?.filePath === file.filePath }"
        >
          <button
              type="button"
              @click="emit('select-file', file)"
          >
            <strong>{{ file.filePath }}</strong>
            <span>{{ file.changeKind }}，{{ file.previousEditLabel }} 调整为 {{ file.currentEditLabel }}</span>
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.composer-mini-dialog {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
}

.composer-mini-dialog-body,
.composer-edit-panel {
  display: flex;
  min-height: 0;
  max-height: 40vh;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 10px;
  overflow: visible;
}

.composer-edit-file {
  display: flex;
  width: 100%;
}

.composer-edit-file button {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 4px;
  padding: 7px 10px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
  color: var(--zhixin-text);
  text-align: left;
  cursor: pointer;
}

.composer-edit-text-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.composer-edit-description {
  margin: 0;
  color: var(--zhixin-text-soft);
  font-size: 12px;
  line-height: 1.5;
}

.composer-edit-file.active button,
.composer-edit-file:hover button {
  border-color: var(--zhixin-selected-border);
  background: var(--zhixin-hover-bg);
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
</style>
