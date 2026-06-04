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
  /** elapsed: 当前任务耗时，来源于任务创建和更新时间。 */
  elapsed: string;
  /** traceId: 当前任务最近事件排查 ID。 */
  traceId: string;
  /** traceIdUnavailableReason: 没有真实排查 ID 时的固定原因说明。 */
  traceIdUnavailableReason: string;
  /** failureReason: 失败任务的明确原因；非失败为 null。 */
  failureReason: string | null;
  /** scopeHint: 当前任务状态的作用域说明。 */
  scopeHint: string;
  /** currentTurnNotice: 当前对话当前轮次的排队、引导或确认提示。 */
  currentTurnNotice: string;
  /** steps: 当前任务编排步骤列表。 */
  steps: Array<{
    /** id: 步骤 ID。 */
    id: string;
    /** title: 步骤标题。 */
    title: string;
    /** status: 步骤中文状态。 */
    status: string;
    /** elapsed: 步骤耗时。 */
    elapsed: string;
    /** summary: 步骤摘要或排查信息。 */
    summary: string;
    /** traceId: 步骤所属任务最近事件排查 ID。 */
    traceId: string;
  }>;
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
      append-to-body
      class="composer-mini-dialog task-detail-dialog"
      title="任务编排详情"
      @update:model-value="emit('update:modelValue', $event)"
  >
    <section class="composer-mini-dialog-body composer-task-panel">
      <article
          v-for="task in props.tasks"
          :key="task.id"
          class="composer-panel-row"
      >
        <header class="composer-task-row-header">
          <strong>{{ task.title }}</strong>
          <span>{{ task.status }}</span>
        </header>
        <small>{{ task.summary }}</small>
        <small>{{ task.scopeHint }}</small>
        <small>{{ task.currentTurnNotice }}</small>
        <small>耗时：{{ task.elapsed }} · 排查 ID：{{ task.traceId }}</small>
        <small v-if="task.traceIdUnavailableReason">{{ task.traceIdUnavailableReason }}</small>
        <small v-if="task.failureReason">失败原因：{{ task.failureReason }}</small>
        <div
            v-if="task.steps.length > 0"
            class="composer-task-step-list"
        >
          <article
              v-for="step in task.steps"
              :key="step.id"
              class="composer-task-step-row"
          >
            <strong>{{ step.title }}</strong>
            <span>{{ step.status }}</span>
            <small>{{ step.elapsed }} · {{ step.summary }}</small>
            <small>步骤排查 ID：{{ step.traceId }}</small>
          </article>
        </div>
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
  display: flex;
  flex-direction: column;
  gap: 4px 10px;
  padding: 8px 10px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
}

.composer-task-row-header,
.composer-task-step-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
}

.composer-task-step-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.composer-task-step-row {
  padding: 7px 8px;
  border: 1px dashed var(--zhixin-border);
  border-radius: 7px;
}

.composer-panel-row strong,
.composer-panel-row span,
.composer-panel-row small,
.composer-task-step-row strong,
.composer-task-step-row span,
.composer-task-step-row small {
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
