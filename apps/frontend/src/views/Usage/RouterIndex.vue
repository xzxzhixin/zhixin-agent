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
const currentWorkspacePage = "usage";
// managementError：当前页面接口错误摘要，来源于 store 层捕获结果。
const managementError = computed(() => appStore.managementErrors.usage ?? "");

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
 * onMounted：用量统计页加载中心服务统计数据。
 *
 * @returns 没有返回值。
 */
onMounted(() => {
  void appStore.loadUsageStatistics();
  // usageChartModulesRegistered: 这里显式触达 ECharts 注册入口，确保用量页保持图形化依赖边界。
  usageChartModulesRegistered([]);
});

</script>

<template>
      <section
      class="page-panel"
  >
    <header class="page-header">
      <div>
        <h1>用量统计</h1>
        <p>按供应商、模型和项目汇总模型调用 token、缓存和调用结果。</p>
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
      <div class="management-actions">
        <el-button
            type="primary"
            @click="appStore.loadUsageStatistics"
        >
          查询统计
        </el-button>
        <el-button @click="appStore.loadUsageAggregate">
          仅刷新聚合
        </el-button>
      </div>
      <section class="management-form usage-filter-panel">
        <span>筛选来源：providerId、model、projectId、sessionId、startedAt、endedAt 来自 appStore.usageFilters。</span>
        <span>当前筛选：{{ appStore.usageFilters.providerId || "全部供应商" }} / {{ appStore.usageFilters.model || "全部模型" }} / {{ appStore.usageFilters.projectId || "全部项目" }}</span>
      </section>
      <section class="usage-chart-grid">
        <article class="usage-chart-card">
          <h2>总量概览</h2>
          <div
              id="usage-total-chart"
              class="usage-chart"
          >
            <span>输入、输出和总 token 图形化概览</span>
          </div>
        </article>
        <article class="usage-chart-card">
          <h2>供应商维度</h2>
          <div
              id="usage-provider-chart"
              class="usage-chart"
          >
            <span>不同供应商调用量对比</span>
          </div>
        </article>
        <article class="usage-chart-card">
          <h2>项目维度</h2>
          <div
              id="usage-project-chart"
              class="usage-chart"
          >
            <span>项目用量分布</span>
          </div>
        </article>
      </section>
      <h2 class="section-title">
        聚合统计
      </h2>
      <el-scrollbar class="usage-list">
        <pre
            v-for="(record, index) in appStore.usageAggregate"
            :key="`aggregate-${index}`"
        >{{ formatUsageJson(record) }}</pre>
      </el-scrollbar>
      <h2 class="section-title">
        原始记录
      </h2>
      <el-scrollbar class="usage-list">
        <pre
            v-for="(record, index) in appStore.usageRecords"
            :key="`record-${index}`"
        >{{ formatUsageJson(record) }}</pre>
      </el-scrollbar>
    </section>
  </section>
</template>



