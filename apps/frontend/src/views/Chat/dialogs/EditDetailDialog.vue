<script setup lang="ts">
import type {
  ComposerEditFile,
} from "@stores/app";

const props = defineProps<{
  /** modelValue: 弹框显隐状态，由完整对话组件控制。 */
  modelValue: boolean;
  /** files: 当前会话真实待确认编辑列表。 */
  files: ComposerEditFile[];
  /** activeFile: 当前选中的编辑文件。 */
  activeFile: ComposerEditFile | null;
}>();

const emit = defineEmits<{
  /** select-file: 用户选择某个编辑文件。 */
  "select-file": [
    file: ComposerEditFile,
  ];
  /** save-file: 保存单个文件编辑。 */
  "save-file": [
    file: ComposerEditFile,
  ];
  /** revert-file: 撤回单个文件编辑。 */
  "revert-file": [
    file: ComposerEditFile,
  ];
  /** diff-file: 查看单个文件编辑前后对比。 */
  "diff-file": [
    file: ComposerEditFile,
  ];
  /** save-all: 保存全部待确认编辑。 */
  "save-all": [];
  /** revert-all: 撤回全部待确认编辑。 */
  "revert-all": [];
}>();
</script>

<template>
  <section
      v-if="props.modelValue"
      class="composer-mini-dialog edit-detail-dialog"
  >
    <section class="composer-mini-dialog-body composer-edit-panel">
      <header class="composer-edit-actionbar">
        <button
            type="button"
            data-action="revert-all"
            @click="emit('revert-all')"
        >
          撤回全部
        </button>
        <button
            type="button"
            data-action="save-all"
            @click="emit('save-all')"
        >
          保存全部
        </button>
      </header>

      <p
          v-if="props.files.length === 0"
          class="composer-edit-empty"
      >
        暂无本轮编辑
      </p>
      <ul
          v-else
          class="composer-edit-list"
      >
        <li
            v-for="file in props.files"
            :key="file.editId"
            class="composer-edit-row"
            :class="{ active: props.activeFile?.editId === file.editId }"
        >
          <button
              class="composer-edit-main"
              type="button"
              @click="emit('select-file', file)"
          >
            <strong>{{ file.filePath }}</strong>
            <span>{{ file.changeKind }} · {{ file.status }}</span>
          </button>
          <span class="composer-edit-stat">
            +{{ file.diffLines.filter((line) => line.kind === "added").length }}
            -{{ file.diffLines.filter((line) => line.kind === "removed").length }}
          </span>
          <button
              type="button"
              @click="emit('diff-file', file)"
          >
            对比
          </button>
          <button
              type="button"
              @click="emit('revert-file', file)"
          >
            撤回
          </button>
          <button
              type="button"
              @click="emit('save-file', file)"
          >
            保存
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
  gap: 8px;
  overflow: visible;
}

.composer-edit-actionbar {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.composer-edit-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.composer-edit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto auto;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--zhixin-soft-bg);
}

.composer-edit-row.active {
  border-color: var(--zhixin-selected-border);
}

.composer-edit-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  border: 0;
  background: transparent;
  color: var(--zhixin-text);
  text-align: left;
}

.composer-edit-main strong,
.composer-edit-main span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-edit-main span,
.composer-edit-empty {
  color: var(--zhixin-text-soft);
  font-size: 12px;
}

.composer-edit-stat {
  color: var(--zhixin-text-soft);
  font-variant-numeric: tabular-nums;
}
</style>
