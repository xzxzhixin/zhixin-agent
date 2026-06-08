<script setup lang="ts">
import {
  computed,
  onMounted,
  ref,
} from "vue";
import {
  ElMessageBox,
} from "element-plus";

import {
  useAppStore,
} from "@stores/app";
import ManagementDialogShell from "@components/ManagementDialogShell.vue";
import type {
  AgentConfigView,
} from "@zhixin/api-client";

// appStore: 页面宿主复用现有 Pinia 状态和 API 行为，不新建协议适配层。
const appStore = useAppStore();
// currentWorkspacePage: 当前页面协议值，来源于当前 views 目录对应路由。
const currentWorkspacePage = "agent-management";
// agentDialogVisible: 新增和编辑智能体弹框显隐。
const agentDialogVisible = ref(false);
// managementError: 当前页面接口错误摘要，来源于 store 层捕获结果。
const managementError = computed(() => appStore.managementErrors.agents ?? "");
// mainAgent: 主智能体来自中心服务固化列表；缺失时页面显示明确空态，不伪造删除能力。
const mainAgent = computed(() => appStore.agents.find((agent) => {
  return agent.agentId === "main";
}) ?? null);
// longTermAgents: 长期智能体列表只排除主智能体，子智能体仍由运行期状态弹框展示。
const longTermAgents = computed(() => appStore.agents.filter((agent) => {
  return agent.agentId !== "main";
}));
// agentRows: 外层表格同时展示主智能体和长期智能体，管理动作按行区分。
const agentRows = computed(() => appStore.agents);
// agentDialogTitle: 根据草稿是否有 ID 决定弹框标题。
const agentDialogTitle = computed(() => {
  if (appStore.agentDraft.agentId === "main") {
    return "编辑主智能体";
  }

  return appStore.agentDraft.agentId
    ? "编辑长期智能体"
    : "新增长期智能体";
});

/**
 * formatDisplayTime：统一格式化前端展示时间。
 *
 * @param value ISO 时间、空值或服务端时间字符串。
 * @returns `YYYY-MM-DD HH:mm:ss`，无值时返回“未保存”。
 */
function formatDisplayTime(value: string | null | undefined): string {
  if (!value) {
    return "未保存";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (part: number) => String(part).padStart(
    2,
    "0",
  );
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + " " + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(":");
}

/**
 * formatAgentDefaultModel：格式化智能体默认模型信息。
 *
 * @param agent 中心服务返回的智能体定义摘要。
 * @returns 默认供应商、模型和推理深度说明。
 */
function formatAgentDefaultModel(agent: AgentConfigView): string {
  const providerText = agent.defaultProviderId
    ? `供应商 ${agent.defaultProviderId}`
    : "未指定供应商";
  const modelText = agent.defaultModel
    ? `模型 ${agent.defaultModel}`
    : "未指定模型";
  return `${providerText} · ${modelText} · 推理深度 ${agent.reasoningEffort || "未配置"}`;
}

/**
 * formatAgentSource：格式化智能体来源。
 *
 * @param agent 中心服务返回的智能体定义摘要。
 * @returns 创建来源和定义文件位置。
 */
function formatAgentSource(agent: AgentConfigView): string {
  return `来源 ${agent.createdBy} · 定义 ${agent.definitionPath || "未返回定义路径"}`;
}

/**
 * openCreateAgentDialog：打开新增长期智能体弹框。
 *
 * @returns 没有返回值。
 */
function openCreateAgentDialog(): void {
  appStore.resetAgentDraft();
  agentDialogVisible.value = true;
}

/**
 * openEditAgentDialog：打开智能体编辑弹框。
 *
 * @param agent 中心服务返回的智能体摘要。
 * @returns 没有返回值。
 */
function openEditAgentDialog(agent: AgentConfigView): void {
  appStore.editAgent(agent);
  agentDialogVisible.value = true;
}

/**
 * saveAgentDialog：保存弹框中的智能体配置。
 *
 * @returns 保存完成后没有返回值。
 */
async function saveAgentDialog(): Promise<void> {
  await appStore.saveAgent();
  if (!appStore.managementErrors.agents) {
    agentDialogVisible.value = false;
  }
}

/**
 * confirmDisableAgent：确认停用长期智能体。
 *
 * @param agent 中心服务返回的长期智能体。
 * @returns 确认并提交后没有返回值。
 */
async function confirmDisableAgent(agent: AgentConfigView): Promise<void> {
  await ElMessageBox.confirm(
    `停用 ${agent.name} 会移除后续任务调度入口，历史会话仍保留。`,
    "确认停用长期智能体",
    {
      confirmButtonText: "确认停用",
      cancelButtonText: "取消",
      type: "warning",
    },
  );
  await appStore.disableAgent(agent);
}

/**
 * confirmDeleteAgent：确认删除长期智能体。
 *
 * @param agent 中心服务返回的长期智能体。
 * @returns 确认并提交后没有返回值。
 */
async function confirmDeleteAgent(agent: AgentConfigView): Promise<void> {
  await ElMessageBox.confirm(
    `删除 ${agent.name} 会处理专属记忆、移除后续任务调度入口和会话可选入口，历史对话内容按会话记录保留。`,
    "确认删除长期智能体",
    {
      confirmButtonText: "确认删除",
      cancelButtonText: "取消",
      type: "warning",
    },
  );
  await appStore.deleteAgent(agent);
}

onMounted(() => {
  void appStore.loadAgents();
  void appStore.loadProviders();
});
</script>

<template>
  <section
      class="page-panel agent-management-page"
      :data-workspace-page="currentWorkspacePage"
  >
    <header class="page-header">
      <div>
        <h1>智能体管理</h1>
        <p>主智能体可编辑角色说明和默认模型，主智能体不可删除；长期智能体通过列表进入弹窗新增、编辑、停用和删除。</p>
      </div>
      <div class="page-header-actions">
        <el-button @click="appStore.loadAgents">
          刷新智能体
        </el-button>
        <el-button
            type="primary"
            @click="openCreateAgentDialog"
        >
          新增长期智能体
        </el-button>
      </div>
    </header>

    <section class="page-scroll">
      <el-alert
          v-if="managementError"
          class="management-error"
          type="error"
          :closable="false"
          :title="managementError"
      />

      <section class="management-section">
        <h2>智能体列表</h2>
        <p class="management-hint">
          角色说明支持 Markdown；可用插件、MCP、skill 和工具权限由当前会话窗口动态决定，不在表单中单独维护权限范围字段。
        </p>
        <el-empty
            v-if="agentRows.length === 0"
            description="暂无智能体"
        />
        <el-table
            v-else
            class="management-table"
            :data="agentRows"
            row-key="agentId"
        >
          <el-table-column
              label="名称"
              min-width="180"
          >
            <template #default="{ row }">
              <strong>{{ row.name }}</strong>
              <small>{{ row.agentId === "main" ? "主智能体" : "长期智能体" }}</small>
            </template>
          </el-table-column>
          <el-table-column
              label="角色说明"
              min-width="260"
              prop="roleDescription"
          />
          <el-table-column
              label="默认模型"
              min-width="260"
          >
            <template #default="{ row }">
              {{ formatAgentDefaultModel(row) }}
            </template>
          </el-table-column>
          <el-table-column
              label="状态"
              width="110"
          >
            <template #default="{ row }">
              <el-tag :type="row.enabled ? 'success' : 'info'">
                {{ row.enabled ? "启用" : "停用" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
              label="更新时间"
              width="180"
          >
            <template #default="{ row }">
              {{ formatDisplayTime(row.updatedAt) }}
            </template>
          </el-table-column>
          <el-table-column
              label="操作"
              width="260"
              fixed="right"
          >
            <template #default="{ row }">
              <div class="management-actions">
                <el-button @click="openEditAgentDialog(row)">
                  编辑
                </el-button>
                <el-button
                    :disabled="row.agentId === 'main' || !row.enabled"
                    @click="confirmDisableAgent(row)"
                >
                  停用
                </el-button>
                <el-button
                    type="danger"
                    plain
                    :disabled="row.agentId === 'main'"
                    @click="confirmDeleteAgent(row)"
                >
                  删除
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section class="management-section">
        <h2>删除影响提示</h2>
        <article class="management-item">
          <div>
            <strong>删除前必须由中心服务确认影响</strong>
            <span>删除长期智能体会影响专属记忆、后续任务调度入口和正在使用该智能体的会话入口。</span>
            <small>历史对话按会话记录保留；删除时可选择归档专属记忆或移除专属记忆，停用不处理记忆。</small>
            <small v-if="mainAgent">主智能体：{{ formatAgentSource(mainAgent) }}</small>
            <small>长期智能体数量：{{ longTermAgents.length }}</small>
          </div>
        </article>
      </section>
    </section>

    <ManagementDialogShell
        v-model="agentDialogVisible"
        dialog-class="agent-management-dialog"
        :title="agentDialogTitle"
    >
      <el-form
          class="agent-management-form"
          label-position="top"
          @submit.prevent
      >
        <div class="management-form-grid">
          <el-form-item label="智能体名称">
            <el-input
                v-model="appStore.agentDraft.name"
                :disabled="appStore.agentDraft.agentId === 'main'"
                placeholder="例如：代码审查助手"
            />
          </el-form-item>
          <el-form-item label="推理深度">
            <el-select v-model="appStore.agentDraft.reasoningEffort">
              <el-option
                  label="低"
                  value="low"
              />
              <el-option
                  label="中"
                  value="medium"
              />
              <el-option
                  label="高"
                  value="high"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="默认供应商">
            <el-select
                v-model="appStore.agentDraft.defaultProviderId"
                clearable
                placeholder="不指定供应商"
            >
              <el-option
                  v-for="provider in appStore.providers"
                  :key="provider.providerId"
                  :label="provider.providerName"
                  :value="provider.providerId"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="默认模型">
            <el-input
                v-model="appStore.agentDraft.defaultModel"
                placeholder="例如 gpt-4o"
            />
          </el-form-item>
        </div>
        <el-form-item label="角色说明（Markdown）">
          <el-input
              v-model="appStore.agentDraft.roleDescription"
              :rows="8"
              type="textarea"
              placeholder="说明该智能体的角色、协作方式和输出偏好。"
          />
        </el-form-item>
        <el-form-item
            v-if="appStore.agentDraft.agentId !== 'main'"
            label="删除记忆处理"
        >
          <el-switch
              v-model="appStore.agentDraft.archiveMemoryOnDelete"
              active-text="删除时归档专属记忆"
              inactive-text="删除时移除专属记忆"
          />
        </el-form-item>
      </el-form>
      <template #footer>
          <el-button @click="agentDialogVisible = false">
            取消
          </el-button>
          <el-button
              type="primary"
              @click="saveAgentDialog"
          >
            保存
          </el-button>
      </template>
    </ManagementDialogShell>
  </section>
</template>

<style scoped>
.agent-management-page {
  min-width: 0;
}

.page-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.management-hint {
  margin: 0 0 12px;
  color: var(--text-secondary);
  font-size: 13px;
}

.management-table :deep(.cell) {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.management-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.management-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.agent-management-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

:deep(.agent-management-dialog .el-dialog__body) {
  max-height: 70vh;
  overflow: auto;
}

@media (max-width: 760px) {
  .management-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
