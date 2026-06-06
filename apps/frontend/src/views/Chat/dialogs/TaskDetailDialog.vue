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
</script>

<template>
  <section
      v-if="props.modelValue"
      class="composer-mini-dialog task-detail-dialog"
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
      </article>
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

.composer-mini-dialog-body {
  display: flex;
  min-height: 0;
  max-height: 40vh;
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
  gap: 4px;
  overflow-x: hidden;
  overflow-y: auto;
}

.composer-panel-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 10px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--zhixin-border);
  background: var(--zhixin-soft-bg);
}

.composer-panel-row:last-child {
  border-bottom: 0;
}

.composer-task-row-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
}

.composer-panel-row strong,
.composer-panel-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
