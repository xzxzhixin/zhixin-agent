<script setup lang="ts">
import {
  computed,
  onMounted,
} from "vue";
import {
  use,
} from "echarts/core";

import {
  useAppStore,
} from "@stores/app";

// appStore：页面宿主复用现有 Pinia 状态和 API 行为，不新建协议适配层。
const appStore = useAppStore();

// usageChartModulesRegistered：用量统计图形化展示依赖 ECharts 模块注册；真实图表实例后续按数据接入。
const usageChartModulesRegistered = use;

// currentWorkspacePage：当前页面协议值，来源于当前 views 目录对应路由。
const currentWorkspacePage = "runtimes";
// managementError：当前页面接口错误摘要，来源于 store 层捕获结果。
const managementError = computed(() => appStore.managementErrors.runtimes ?? "");

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
  void appStore.loadRuntimes();
});

</script>

<template>
      <section
      class="page-panel"
  >
    <header class="page-header">
      <div>
        <h1>运行环境</h1>
        <p>插件、MCP、skill 和命令任务按这里登记的环境执行。</p>
      </div>
      <el-button
          type="primary"
          @click="appStore.resetRuntimeDraft"
      >
        新增环境
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
      <el-form
          class="management-form"
          label-position="top"
      >
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="环境名称">
              <el-input v-model="appStore.runtimeDraft.runtimeName"/>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="环境类型">
              <el-input v-model="appStore.runtimeDraft.runtimeType"/>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="可执行文件">
              <el-input v-model="appStore.runtimeDraft.executablePath"/>
            </el-form-item>
          </el-col>
        </el-row>
        <div class="management-actions">
          <el-button
              type="primary"
              @click="appStore.saveRuntime"
          >
            保存环境
          </el-button>
          <el-button @click="appStore.loadRuntimes">
            刷新列表
          </el-button>
          <el-button @click="appStore.setDefaultRuntime">
            设置默认环境
          </el-button>
        </div>
      </el-form>
      <section class="management-list">
        <article
            v-for="runtime in appStore.runtimes"
            :key="runtime.runtimeId"
            class="management-item"
        >
          <div>
            <strong>{{ runtime.runtimeName }}</strong>
            <span>{{ runtime.runtimeType }} · {{ runtime.version }}</span>
            <small>{{ runtime.executablePath }}</small>
          </div>
        </article>
      </section>
    </section>
  </section>
</template>



