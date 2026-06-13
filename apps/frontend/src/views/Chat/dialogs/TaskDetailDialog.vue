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
    <section
        v-if="props.tasks.length > 0"
        class="composer-mini-dialog-body composer-task-panel"
    >
      <template
          v-for="task in props.tasks"
          :key="task.id"
      >
        <article
            v-for="step in task.steps"
            :key="step.id"
            class="composer-task-step-row"
        >
          <span class="composer-task-step-status">{{ step.status }}</span>
          <strong>{{ step.title }}</strong>
          <span class="composer-task-step-meta">{{ task.elapsed }}</span>
        </article>
      </template>
    </section>
    <el-empty
        v-else
        description="暂无拆解步骤"
        :image-size="56"
    />
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
  overflow: visible;
}

.composer-task-panel {
  display: flex;
  min-height: 0;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 4px;
  overflow: visible;
}

.composer-task-step-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 3px 10px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--zhixin-border);
  background: var(--zhixin-soft-bg);
}

.composer-task-step-row:last-child {
  border-bottom: 0;
}

.composer-task-step-status {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.composer-task-step-row strong,
.composer-task-step-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-task-step-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
