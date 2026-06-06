<script setup lang="ts">
import type {
  AgentStatusTreeNode,
} from "@stores/app";

/**
 * AgentStatusTreeRow：智能体状态树扁平行。
 *
 * 来源：MainView 对两级树的展示转换。
 * 含义：保留节点和层级缩进，不改变中心服务智能体事实。
 */
interface AgentStatusTreeRow {
  /** node: 智能体状态树节点。 */
  node: AgentStatusTreeNode;
  /** level: 展示层级，长期智能体为 0，子智能体为 1。 */
  level: number;
}

const props = defineProps<{
  /** modelValue: 弹框显隐状态，由 MainView 控制。 */
  modelValue: boolean;
  /** rows: 当前窗口内长期智能体和其子智能体两级树行。 */
  rows: AgentStatusTreeRow[];
  /** selectedNode: 当前选中智能体节点。 */
  selectedNode: AgentStatusTreeNode | null;
}>();

const emit = defineEmits<{
  /** select-node: 用户点击智能体节点后通知 MainView 切换详情。 */
  "select-node": [
    node: AgentStatusTreeNode,
  ];
}>();

/**
 * treeProps：Element Plus 树字段映射。
 *
 * 来源：AgentStatusTreeNode 协议。
 * 含义：让 el-tree 按 name 和 children 渲染两级结构。
 */
const treeProps = {
  /** label: 节点显示名字段。 */
  label: "name",
  /** children: 子智能体节点字段。 */
  children: "children",
};

/**
 * defaultExpandedKeys：默认展开长期智能体节点。
 *
 * 来源：本轮验收要求“测试长期智能体”默认展开。
 */
const defaultExpandedKeys = props.rows.filter((row) => {
  return row.level === 0;
}).map((row) => {
  return row.node.agentId;
});

/**
 * treeNodes：从扁平行恢复树根节点。
 *
 * 来源：MainView 传入的长期智能体行。
 */
const treeNodes = props.rows.filter((row) => {
  return row.level === 0;
}).map((row) => {
  return row.node;
});
</script>

<template>
  <section
      v-if="props.modelValue"
      class="composer-mini-dialog agent-status-dialog"
  >
    <section class="composer-mini-dialog-body agent-status-dialog-grid">
      <aside class="agent-status-tree">
        <el-tree
            class="agent-status-el-tree"
            :data="treeNodes"
            node-key="agentId"
            :props="treeProps"
            :default-expanded-keys="defaultExpandedKeys"
            highlight-current
            @node-click="emit('select-node', $event)"
        >
          <template #default="{ data }">
            <span
                class="composer-agent-node"
                :class="{ active: props.selectedNode?.agentId === data.agentId }"
            >
              <strong>{{ data.name }}</strong>
              <span>{{ data.nodeKind }} · {{ data.status }}</span>
              <small>{{ data.taskSummary }}</small>
              <small>{{ data.conversationHint }}</small>
            </span>
          </template>
        </el-tree>
        <el-empty
            v-if="props.rows.length === 0"
            description="暂无智能体；主智能体、长期智能体和子智能体会按中心服务状态同步到这里。"
        />
      </aside>
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
  overflow: visible;
}

.agent-status-dialog-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: visible;
}

.agent-status-tree {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 6px;
  overflow: visible;
}

.agent-status-el-tree {
  --el-tree-node-hover-bg-color: var(--zhixin-hover-bg);
  overflow-y: visible;
}

.composer-agent-node {
  display: flex;
  width: 100%;
  min-height: 48px;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
  padding-top: 7px;
  padding-right: 10px;
  padding-bottom: 7px;
  border: 1px solid var(--zhixin-border);
  border-radius: 8px;
  background: var(--zhixin-soft-bg);
  color: var(--zhixin-text);
  text-align: left;
  cursor: pointer;
}

.composer-agent-node:hover {
  border-color: var(--zhixin-selected-border);
  background: var(--zhixin-hover-bg);
}

.composer-agent-node.active {
  border-color: var(--zhixin-selected-border);
  background: var(--zhixin-selected-bg);
}

.composer-agent-node span,
.composer-agent-node strong,
.composer-agent-node small {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-agent-node small {
  color: var(--zhixin-text-soft);
  font-size: 12px;
}

</style>
