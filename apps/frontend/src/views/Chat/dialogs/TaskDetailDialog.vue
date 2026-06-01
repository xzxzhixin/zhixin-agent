<script setup lang="ts">
/**
 * TaskDetailDialog：输入区任务详情小弹框。
 *
 * 用途：展示当前对话或当前轮次的任务进度。
 * 关键逻辑：只接收 MainView 已整理好的任务行，不在弹框内猜测中心服务字段。
 */
interface TaskPanelRow {
  /** id: 任务行唯一标识，来源于中心服务 taskId 或前端明确空态 ID。 */
  id: string;
  /** title: 任务标题，来源于中心服务任务标题或明确空态文案。 */
  title: string;
  /** status: 任务状态中文文案，来源于 MainView 的状态格式化规则。 */
  status: string;
  /** summary: 任务状态说明，说明当前对话内排队等边界。 */
  summary: string;
}

const props = defineProps<{
  /** modelValue: 弹框显隐状态，由 MainView 控制。 */
  modelValue: boolean;
  /** tasks: 当前任务详情行；没有真实任务时由 MainView 传入明确空态行。 */
  tasks: TaskPanelRow[];
}>();

const emit = defineEmits<{
  /** update:modelValue: Element Plus 弹框关闭时回写显隐状态。 */
  "update:modelValue": [
    value: boolean,
  ];
}>();
</script>

<template>
  <el-dialog
      :model-value="props.modelValue"
      class="composer-mini-dialog task-detail-dialog"
      title="任务"
      width="720px"
      @update:model-value="emit('update:modelValue', $event)"
  >
    <section class="composer-mini-dialog-body composer-task-panel">
      <article
          v-for="task in props.tasks"
          :key="task.id"
          class="composer-panel-row"
      >
        <strong>{{ task.title }}</strong>
        <span>{{ task.status }}</span>
        <small>{{ task.summary }}</small>
      </article>
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

.composer-task-panel {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  overflow-x: hidden;
  overflow-y: auto;
}

.composer-panel-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
  padding: 8px 10px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
}

.composer-panel-row strong,
.composer-panel-row span,
.composer-panel-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-panel-row small {
  grid-column: 1 / -1;
  color: var(--zhixin-text-soft);
  font-size: 12px;
}
</style>
