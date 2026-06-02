<script setup lang="ts">
import {
  computed,
  onMounted,
} from "vue";
import {
  ElMessageBox,
} from "element-plus";

import {
  useAppStore,
} from "@stores/app";
import type {
  AgentConfigView,
} from "@zhixin/api-client";

// appStore：页面宿主复用现有 Pinia 状态和 API 行为，不新建协议适配层。
const appStore = useAppStore();

// currentWorkspacePage：当前页面协议值，来源于当前 views 目录对应路由。
const currentWorkspacePage = "agent-management";
// managementError：当前页面接口错误摘要，来源于 store 层捕获结果。
const managementError = computed(() => appStore.managementErrors.agents ?? "");
// mainAgent：主智能体来自中心服务固化列表；缺失时页面显示明确空态，不伪造删除能力。
const mainAgent = computed(() => appStore.agents.find((agent) => {
  return agent.agentId === "main";
}) ?? null);
// longTermAgents：长期智能体列表只排除主智能体，子智能体仍由运行期状态弹框展示。
const longTermAgents = computed(() => appStore.agents.filter((agent) => {
  return agent.agentId !== "main";
}));
// agentFormTitle：根据草稿是否有 ID 决定表单标题。
const agentFormTitle = computed(() => {
  return appStore.agentDraft.agentId
    ? "修改长期智能体"
    : "创建长期智能体";
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

  const pad = (part: number) => String(part).padStart(2, "0");
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

/**
 * onMounted：当前页面挂载时加载中心服务事实数据。
 *
 * @returns 没有返回值。
 */
onMounted(() => {
  void appStore.loadAgents();
  void appStore.loadProviders();
});

</script>

<template>
      <section
      class="page-panel"
      :data-workspace-page="currentWorkspacePage"
  >
    <header class="page-header">
      <div>
        <h1>智能体管理</h1>
        <p>展示主智能体和长期智能体的管理入口；主智能体不可删除，长期智能体用于跨会话持续协作。</p>
      </div>
      <el-button @click="appStore.loadAgents">
        刷新智能体
      </el-button>
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
        <h2>主智能体</h2>
        <article
            v-if="mainAgent"
            class="management-item agent-management-card"
        >
          <div>
            <strong>{{ mainAgent.name }}</strong>
            <span>{{ mainAgent.roleDescription }}</span>
            <small>{{ mainAgent.capabilityBoundary }}</small>
            <small>{{ formatAgentDefaultModel(mainAgent) }}</small>
            <small>记忆索引：{{ mainAgent.memoryIndexPath || "未返回记忆索引" }}</small>
            <small>{{ formatAgentSource(mainAgent) }}</small>
            <small>更新时间：{{ formatDisplayTime(mainAgent.updatedAt) }}</small>
          </div>
          <div class="management-actions">
            <el-tag type="success">
              系统内置
            </el-tag>
            <el-tag :type="mainAgent.enabled ? 'success' : 'info'">
              {{ mainAgent.enabled ? "启用" : "停用" }}
            </el-tag>
            <el-button disabled>
              不可删除
            </el-button>
          </div>
        </article>
        <el-empty
            v-else
            description="中心服务暂未返回主智能体定义"
        />
      </section>
      <section class="management-section">
        <h2>长期智能体</h2>
        <el-form
            class="management-form agent-management-form"
            label-position="top"
            @submit.prevent
        >
          <h3>{{ agentFormTitle }}</h3>
          <div class="management-form-grid">
            <el-form-item label="智能体名称">
              <el-input
                  v-model="appStore.agentDraft.name"
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
          <el-form-item label="角色说明">
            <el-input
                v-model="appStore.agentDraft.roleDescription"
                :rows="3"
                type="textarea"
                placeholder="说明该长期智能体负责什么。"
            />
          </el-form-item>
          <el-form-item label="能力边界">
            <el-input
                v-model="appStore.agentDraft.capabilityBoundary"
                :rows="3"
                type="textarea"
                placeholder="说明该智能体不能越过的任务、权限和上下文边界。"
            />
          </el-form-item>
          <el-form-item label="删除记忆处理">
            <el-switch
                v-model="appStore.agentDraft.archiveMemoryOnDelete"
                active-text="删除时归档专属记忆"
                inactive-text="删除时移除专属记忆"
            />
          </el-form-item>
          <div class="management-actions">
            <el-button
                type="primary"
                @click="appStore.saveAgent"
            >
              {{ appStore.agentDraft.agentId ? "保存修改" : "创建智能体" }}
            </el-button>
            <el-button @click="appStore.resetAgentDraft">
              清空表单
            </el-button>
          </div>
        </el-form>
        <el-empty
            v-if="longTermAgents.length === 0"
            description="暂无长期智能体"
        />
        <div
            v-else
            class="management-list"
        >
          <article
              v-for="agent in longTermAgents"
              :key="agent.agentId"
              class="management-item agent-management-card"
          >
            <div>
              <strong>{{ agent.name }}</strong>
              <span>{{ agent.roleDescription }}</span>
              <small>{{ agent.capabilityBoundary }}</small>
              <small>{{ formatAgentDefaultModel(agent) }}</small>
              <small>记忆索引：{{ agent.memoryIndexPath || "未返回记忆索引" }}</small>
              <small>{{ formatAgentSource(agent) }}</small>
              <small>更新时间：{{ formatDisplayTime(agent.updatedAt) }}</small>
            </div>
            <div class="management-actions">
              <el-tag :type="agent.enabled ? 'success' : 'info'">
                {{ agent.enabled ? "启用" : "停用" }}
              </el-tag>
              <el-button @click="appStore.editAgent(agent)">
                修改
              </el-button>
              <el-button
                  :disabled="!agent.enabled"
                  @click="confirmDisableAgent(agent)"
              >
                停用
              </el-button>
              <el-button
                  type="danger"
                  plain
                  @click="confirmDeleteAgent(agent)"
              >
                删除
              </el-button>
            </div>
          </article>
        </div>
      </section>
      <section class="management-section">
        <h2>删除影响提示</h2>
        <article class="management-item">
          <div>
            <strong>删除前必须由中心服务确认影响</strong>
            <span>删除长期智能体会影响专属记忆、后续任务调度入口和正在使用该智能体的会话入口。</span>
            <small>历史对话按会话记录保留；删除时可选择归档专属记忆或移除专属记忆，停用不处理记忆。</small>
          </div>
        </article>
      </section>
    </section>
      </section>
</template>

<style scoped>
.agent-management-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--panel-bg);
}

.agent-management-form h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.management-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.agent-management-card {
  align-items: flex-start;
}

.management-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 760px) {
  .management-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>

