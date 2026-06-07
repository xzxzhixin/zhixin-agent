<script setup lang="ts">
import {
  computed,
  onMounted,
  reactive,
  ref,
} from "vue";
import {
  use,
} from "echarts/core";

import {
  useAppStore,
} from "@stores/app";
import {
  createMcpDraft,
} from "@stores/app-helpers";
import type {
  McpConfigView,
  McpToolView,
} from "@api";

// appStore：页面宿主复用现有 Pinia 状态和 API 行为，不新建协议适配层。
const appStore = useAppStore();

// usageChartModulesRegistered：用量统计图形化展示依赖 ECharts 模块注册；真实图表实例后续按数据接入。
const usageChartModulesRegistered = use;

// currentWorkspacePage：当前页面协议值，来源于当前 views 目录对应路由。
const currentWorkspacePage = "mcp";
// mcpDialogVisible: MCP 配置弹框显隐。
const mcpDialogVisible = ref(false);
// managementError：当前页面接口错误摘要，来源于 store 层捕获结果。
const managementError = computed(() => appStore.managementErrors.mcp ?? "");
// mcpToolsByRowKey：按全局配置文件和 Server ID 缓存用户点击后异步加载的工具列表。
const mcpToolsByRowKey = reactive<Record<string, McpToolView[]>>({});
// loadingMcpToolRows：按全局配置文件和 Server ID 标记工具按钮 loading 状态。
const loadingMcpToolRows = reactive<Record<string, boolean>>({});

/**
 * openMcpConfigDialog：打开 MCP 配置弹框。
 *
 * @returns 没有返回值。
 */
function openMcpConfigDialog(): void {
  appStore.mcpDraft = createMcpDraft();
  mcpDialogVisible.value = true;
}

/**
 * editMcpConfigRow：编辑当前 Server 的完整 MCP JSON 片段。
 *
 * @param config MCP Server 行配置。
 * @returns 没有返回值。
 */
function editMcpConfigRow(config: McpConfigView): void {
  appStore.editMcpConfig(config);
  mcpDialogVisible.value = true;
}

/**
 * createMcpServerRowKey：生成 MCP Server 行唯一 key。
 *
 * @param config MCP Server 行配置。
 * @returns 全局配置文件相对路径和 Server ID 组成的稳定 key。
 */
function createMcpServerRowKey(config: McpConfigView): string {
  return `${config.relativePath}::${config.serverId}`;
}

/**
 * loadMcpToolsForRow：按当前 MCP Server 行异步加载工具。
 *
 * @param config MCP Server 行配置。
 * @returns 加载完成后没有返回值。
 */
async function loadMcpToolsForRow(config: McpConfigView): Promise<void> {
  if (!config.serverId) {
    return;
  }

  const rowKey = createMcpServerRowKey(config);
  if (mcpToolsByRowKey[rowKey]) {
    // 二次点击用于收起当前行工具列表，不重复请求 MCP Server。
    delete mcpToolsByRowKey[rowKey];
    return;
  }

  loadingMcpToolRows[rowKey] = true;
  try {
    mcpToolsByRowKey[rowKey] = await appStore.loadMcpServerTools({
      relativePath: config.relativePath,
      serverId: config.serverId,
    });
  } finally {
    loadingMcpToolRows[rowKey] = false;
  }
}

/**
 * saveMcpDialog：保存 MCP 配置并在成功后关闭弹框。
 *
 * @returns 保存完成后没有返回值。
 */
async function saveMcpDialog(): Promise<void> {
  const saved = await appStore.saveMcpConfig();
  if (saved) {
    mcpDialogVisible.value = false;
  }
}

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
 * formatUsageRecordForDisplay：递归格式化用量记录中的时间字段。
 *
 * @param value 中心服务返回的用量记录或聚合记录。
 * @returns 时间字段已转为 `YYYY-MM-DD HH:mm:ss` 的展示副本。
 */
function formatUsageRecordForDisplay(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => formatUsageRecordForDisplay(item));
  }

  if (value !== null && typeof value === "object") {
    const formatted: Record<string, unknown> = {};
    for (const [
      fieldName,
      fieldValue,
    ] of Object.entries(value)) {
      // fieldName: 服务端用量、事件和配置协议中的时间字段统一以后缀 At 或 Date 表达，展示前必须格式化。
      if (typeof fieldValue === "string" && isDisplayTimeField(fieldName, fieldValue)) {
        formatted[fieldName] = formatDisplayTime(fieldValue);
      } else {
        formatted[fieldName] = formatUsageRecordForDisplay(fieldValue);
      }
    }
    return formatted;
  }

  return value;
}

/**
 * formatUsageJson：把用量记录展示副本格式化为 JSON。
 *
 * @param value 中心服务返回的用量记录或聚合记录。
 * @returns 不含 ISO 时间直出的 JSON 字符串。
 */
function formatUsageJson(value: unknown): string {
  return JSON.stringify(formatUsageRecordForDisplay(value), null, 2);
}

/**
 * isDisplayTimeField：判断字段是否需要按 UI 时间格式展示。
 *
 * @param fieldName 字段名。
 * @param value 字段值。
 * @returns 属于时间字段且可解析为时间时返回 true。
 */
function isDisplayTimeField(fieldName: string, value: string): boolean {
  const normalizedName = fieldName.toLowerCase();
  const isTimeName = normalizedName.endsWith("at")
    || normalizedName.endsWith("date")
    || normalizedName.includes("time");
  if (!isTimeName) {
    return false;
  }

  return !Number.isNaN(new Date(value).getTime());
}

// selectedProviderModelOptions：供应商默认模型下拉候选，来源于已保存或刷新后的模型列表。
const selectedProviderModelOptions = computed(() => {
  const providerId = appStore.providerDraft.providerId;
  if (!providerId) {
    return [];
  }

  return appStore.providerModelOptions[providerId]?.models ?? [];
});

// providerModelSourceText：默认模型候选来源说明。
const providerModelSourceText = computed(() => {
  if (!appStore.providerDraft.providerId) {
    return "模型列表来源：新增供应商保存后，可通过刷新模型列表获得下拉选项。";
  }

  if (selectedProviderModelOptions.value.length > 0) {
    return "模型列表来源：中心服务已保存或刚刷新得到的供应商模型列表。";
  }

  return "模型列表来源：该供应商未提供模型列表接口或当前刷新失败，模型名称由用户手动维护。";
});

/**
 * onMounted：当前页面挂载时加载中心服务事实数据。
 *
 * @returns 没有返回值。
 */
onMounted(() => {
  void appStore.loadMcpConfigs();
});

</script>

<template>
      <section
      class="page-panel"
  >
    <header class="page-header">
      <div>
        <h1>MCP</h1>
        <p>全局扩展能力管理：每个 MCP Server 独立编辑和保存。</p>
      </div>
      <el-button @click="appStore.loadMcpConfigs">
        刷新列表
      </el-button>
      <el-button
          type="primary"
          @click="openMcpConfigDialog"
      >
        新增配置
      </el-button>
    </header>
    <section class="page-scroll">
      <el-dialog
          v-model="mcpDialogVisible"
          append-to-body
          class="management-config-dialog mcp-config-dialog"
          title="MCP 配置"
          width="80vw"
          destroy-on-close
      >
        <el-form
          class="management-form"
          label-position="top"
        >
        <p class="field-helper">
          根字段为 mcpServers，本弹框一次只保存一个服务；保存时只更新该服务，不覆盖其他服务。项目级配置由打开项目目录扫描，只在项目对话的项目能力详情中展示。
        </p>
        <el-form-item label="MCP 配置 JSON">
          <el-input
              v-model="appStore.mcpDraft.configJson"
              type="textarea"
              :rows="14"
              placeholder="{\n  &quot;mcpServers&quot;: {\n    &quot;idea&quot;: {\n      &quot;type&quot;: &quot;http&quot;,\n      &quot;url&quot;: &quot;http://127.0.0.1:64342/stream&quot;\n    }\n  }\n}"
          />
        </el-form-item>
        <div class="management-actions">
          <el-button
              type="primary"
              @click="saveMcpDialog"
          >
            保存 MCP 配置
          </el-button>
        </div>
        </el-form>
      </el-dialog>
      <el-table
          :data="appStore.globalMcpConfigs"
          class="management-table"
          empty-text="暂无全局 MCP 配置"
      >
        <el-table-column
            label="服务"
            min-width="180"
        >
          <template #default="{ row: config }">
            <strong>{{ config.serverId || "未配置服务" }}</strong>
          </template>
        </el-table-column>
        <el-table-column
            label="协议"
            width="110"
        >
          <template #default="{ row: config }">
            {{ config.transportType }}
          </template>
        </el-table-column>
        <el-table-column
            label="工具"
            min-width="320"
        >
          <template #default="{ row: config }">
            <div class="mcp-tool-actions">
              <el-button
                  :loading="loadingMcpToolRows[createMcpServerRowKey(config)]"
                  :disabled="!config.serverId"
                  @click="loadMcpToolsForRow(config)"
              >
                查看工具
              </el-button>
            </div>
            <div
                v-if="mcpToolsByRowKey[createMcpServerRowKey(config)]"
                class="mcp-tool-list"
            >
              <el-tag
                  v-for="tool in mcpToolsByRowKey[createMcpServerRowKey(config)]"
                  :key="`${tool.serverId}-${tool.toolName || tool.errorMessage}`"
                  :type="tool.errorMessage ? 'danger' : 'success'"
                  effect="plain"
              >
                {{ tool.transportType }} · {{ tool.serverId }}{{ tool.toolName ? ` · ${tool.toolName}` : "" }}
              </el-tag>
              <small v-if="mcpToolsByRowKey[createMcpServerRowKey(config)].length === 0">
                暂未发现工具；请确认 MCP Server 可连接后重试。
              </small>
            </div>
          </template>
        </el-table-column>
        <el-table-column
            label="更新时间"
            min-width="180"
        >
          <template #default="{ row: config }">
            {{ formatDisplayTime(config.updatedAt) }}
          </template>
        </el-table-column>
        <el-table-column
            fixed="right"
            label="操作"
            width="110"
        >
          <template #default="{ row: config }">
            <el-button @click="editMcpConfigRow(config)">
              编辑
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </section>
</template>

<style scoped>
.mcp-tool-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.mcp-tool-actions {
  display: flex;
  align-items: center;
}
</style>
