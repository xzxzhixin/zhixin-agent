<script setup lang="ts">
import type {
  ProjectCapabilityItem,
  ProjectCapabilitySummary,
} from "@stores/app";

const props = defineProps<{
  /** modelValue: 弹框显隐状态，由 MainView 控制。 */
  modelValue: boolean;
  /** summary: 当前项目级能力摘要，来源于中心服务项目上下文。 */
  summary: ProjectCapabilitySummary | null;
  /** rows: 插件、MCP 和 skill 的统一展示行。 */
  rows: ProjectCapabilityItem[];
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
      class="project-capability-dialog"
      title="项目能力详情"
      width="720px"
      @update:model-value="emit('update:modelValue', $event)"
  >
    <section
        v-if="props.summary"
        class="project-capability-dialog-body"
    >
      <p>
        项目级插件、MCP 和 skill 由打开项目目录扫描，注入当前项目对话上下文，不在全局插件 / MCP / skill 页管理。
      </p>
      <p>
        当前项目 ID：{{ props.summary.projectId }}
      </p>
      <el-table
          v-if="props.rows.length > 0"
          :data="props.rows"
          size="small"
      >
        <el-table-column
            prop="kind"
            label="类型"
            width="86"
        />
        <el-table-column
            prop="name"
            label="名称"
        />
        <el-table-column
            prop="source"
            label="来源"
        />
        <el-table-column
            prop="scope"
            label="全局/项目级"
            width="120"
        />
        <el-table-column
            prop="status"
            label="启用状态"
            width="100"
        />
        <el-table-column
            prop="unavailableReason"
            label="不可用原因"
        />
      </el-table>
      <el-empty
          v-else
          description="当前项目暂无项目级插件、MCP 或 skill；不可用原因：尚未扫描到项目级能力。"
      />
    </section>
  </el-dialog>
</template>

<style scoped>
.project-capability-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.project-capability-dialog-body p {
  margin: 0;
  color: var(--zhixin-text-soft);
  font-size: 13px;
}
</style>
