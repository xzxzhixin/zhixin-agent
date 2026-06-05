<script setup lang="ts">
import type {
  AgentStatusTreeNode,
} from "@stores/app";
import type {
  TaskPanelRow,
} from "./useChatConversation";

/**
 * AgentStatusTreeRow：右侧智能体树摘要行。
 *
 * 来源：对话页从 store 智能体树压平后的节点。
 * 含义：右侧摘要和输入区智能体小弹层使用同一批节点。
 * 格式：节点加层级。
 * 默认值：无。
 * 约束：只展示既有节点，不在组件内补默认智能体。
 */
interface AgentStatusTreeRow {
  /** node: 智能体树节点。 */
  node: AgentStatusTreeNode;
  /** level: 节点层级，一级智能体为 0。 */
  level: number;
}

const props = defineProps<{
  /** tasks: 当前轮次任务列表，来源于完整对话组合能力。 */
  tasks: TaskPanelRow[];
  /** agentRows: 当前窗口智能体树摘要行，来源于输入区小弹层同源计算结果。 */
  agentRows: AgentStatusTreeRow[];
}>();
</script>

<template>
  <aside class="config-panel">
    <h2>任务状态</h2>
    <el-empty
        v-if="props.tasks.length === 0"
        description="暂无任务"
    />
    <el-scrollbar
        v-else
        class="status-list"
    >
      <article
          v-for="task in props.tasks"
          :key="task.id"
          class="status-item"
      >
        <strong>{{ task.title }}</strong>
        <span :title="task.summary">{{ task.status }}</span>
      </article>
    </el-scrollbar>

    <h2>智能体</h2>
    <el-empty
        v-if="props.agentRows.length === 0"
        description="暂无智能体"
    />
    <el-scrollbar
        v-else
        class="status-list"
    >
      <article
          v-for="row in props.agentRows"
          :key="row.node.agentId"
          class="status-item status-item-column"
      >
        <strong>{{ row.node.name }}</strong>
        <span>{{ row.node.nodeKind }} · {{ row.node.status }}</span>
        <small>{{ row.node.taskSummary }}</small>
        <small>{{ row.node.conversationHint }}</small>
      </article>
    </el-scrollbar>
  </aside>
</template>
