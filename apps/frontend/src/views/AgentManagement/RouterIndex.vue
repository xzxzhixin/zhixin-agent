<script setup lang="ts">
import {
  computed,
  onMounted,
} from "vue";

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
 * onMounted：当前页面挂载时加载中心服务事实数据。
 *
 * @returns 没有返回值。
 */
onMounted(() => {
  void appStore.loadAgents();
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
        <el-alert
            class="management-error"
            type="info"
            :closable="false"
            title="长期智能体的创建、修改、停用和删除需要中心服务提供对应接口；当前页面只展示已固化定义，不伪造破坏性操作。"
        />
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
              <el-button disabled>
                修改
              </el-button>
              <el-button disabled>
                {{ agent.enabled ? "停用" : "启用" }}
              </el-button>
              <el-button
                  disabled
                  type="danger"
                  plain
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
            <small>历史对话按会话记录保留；没有删除接口前，前端只展示说明，不在本地模拟删除。</small>
          </div>
        </article>
      </section>
    </section>
      </section>
</template>



