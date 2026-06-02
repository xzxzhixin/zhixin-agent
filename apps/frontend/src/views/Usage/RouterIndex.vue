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

interface UsageSummaryView {
  /**
   * summaryType: 服务端聚合类型，用于区分总量、供应商、项目和明细。
   */
  summaryType: string;

  /**
   * providerId: 供应商 ID；总量或项目维度没有指定供应商时为 null。
   */
  providerId: string | null;

  /**
   * model: 模型名称；非明细维度为 null。
   */
  model: string | null;

  /**
   * projectId: 项目 ID；普通会话全局统计为 null。
   */
  projectId: string | null;

  /**
   * inputTokens: 输入 token 汇总。
   */
  inputTokens: number;

  /**
   * outputTokens: 输出 token 汇总。
   */
  outputTokens: number;

  /**
   * totalTokens: 输入和输出 token 汇总。
   */
  totalTokens: number;

  /**
   * cacheHitTokens: 缓存命中 token 汇总；供应商未提供时服务端按统计口径只在原始记录保留 null。
   */
  cacheHitTokens: number;

  /**
   * cacheMissTokens: 缓存未命中 token 汇总；供应商未提供时服务端按统计口径只在原始记录保留 null。
   */
  cacheMissTokens: number;

  /**
   * callCount: 调用次数。
   */
  callCount: number;

  /**
   * successCount: 成功调用次数。
   */
  successCount: number;

  /**
   * failureCount: 失败调用次数。
   */
  failureCount: number;
}

/**
 * toNumber：把服务端 SQLite 聚合返回值转为数字。
 *
 * @param value 服务端聚合字段。
 * @returns 数字值；空统计按 0 展示，因为聚合行代表无记录时的图表基线。
 */
function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

/**
 * toNullableString：把服务端聚合维度字段转为可展示字符串。
 *
 * @param value 服务端聚合字段。
 * @returns 字符串或 null。
 */
function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * readUsageSummary：读取服务端聚合记录并转成页面展示结构。
 *
 * @param value 中心服务聚合记录。
 * @returns 可展示聚合结构；无 summaryType 时返回 null。
 */
function readUsageSummary(value: unknown): UsageSummaryView | null {
  if (value === null || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const summaryType = toNullableString(record.summaryType);
  if (!summaryType) {
    return null;
  }

  return {
    summaryType,
    providerId: toNullableString(record.providerId),
    model: toNullableString(record.model),
    projectId: toNullableString(record.projectId),
    inputTokens: toNumber(record.inputTokens),
    outputTokens: toNumber(record.outputTokens),
    totalTokens: toNumber(record.totalTokens),
    cacheHitTokens: toNumber(record.cacheHitTokens),
    cacheMissTokens: toNumber(record.cacheMissTokens),
    callCount: toNumber(record.callCount),
    successCount: toNumber(record.successCount),
    failureCount: toNumber(record.failureCount),
  };
}

// usageSummaries：聚合接口返回的真实统计结构，不从原始记录二次猜测维度。
const usageSummaries = computed(() => {
  return appStore.usageAggregate
      .map((record) => readUsageSummary(record))
      .filter((record): record is UsageSummaryView => record !== null);
});

// totalUsageSummary：总量概览，来源于服务端 total-summary 聚合行。
const totalUsageSummary = computed(() => {
  return usageSummaries.value.find((record) => record.summaryType === "total-summary") ?? null;
});

// providerUsageSummaries：供应商维度图表数据，来源于服务端 provider-summary 聚合行。
const providerUsageSummaries = computed(() => {
  return usageSummaries.value.filter((record) => record.summaryType === "provider-summary");
});

// projectUsageSummaries：项目维度图表数据，来源于服务端 project-summary 聚合行。
const projectUsageSummaries = computed(() => {
  return usageSummaries.value.filter((record) => record.summaryType === "project-summary");
});

// usageHasRealData：判断当前筛选下是否存在真实用量记录。
const usageHasRealData = computed(() => {
  return totalUsageSummary.value !== null && totalUsageSummary.value.callCount > 0;
});

/**
 * formatTokenCount：格式化 token 数量。
 *
 * @param value token 数。
 * @returns 用于图表文字的数字。
 */
function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/**
 * usageBarWidth：按当前维度最大 token 量计算条形宽度。
 *
 * @param value 当前行 token 总量。
 * @param rows 当前维度全部统计行。
 * @returns CSS 百分比宽度。
 */
function usageBarWidth(value: number, rows: UsageSummaryView[]): string {
  const maxTokens = Math.max(...rows.map((row) => row.totalTokens), 1);
  const percent = Math.max(4, Math.round((value / maxTokens) * 100));
  return `${percent}%`;
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
            <div
                v-if="usageHasRealData && totalUsageSummary"
                class="usage-total-grid"
            >
              <span>
                <strong>{{ formatTokenCount(totalUsageSummary.totalTokens) }}</strong>
                总 token
              </span>
              <span>
                <strong>{{ formatTokenCount(totalUsageSummary.inputTokens) }}</strong>
                输入 token
              </span>
              <span>
                <strong>{{ formatTokenCount(totalUsageSummary.outputTokens) }}</strong>
                输出 token
              </span>
              <span>
                <strong>{{ formatTokenCount(totalUsageSummary.callCount) }}</strong>
                调用次数
              </span>
            </div>
            <span
                v-else
                class="usage-empty-state"
            >当前筛选下暂无真实模型调用用量。</span>
          </div>
        </article>
        <article class="usage-chart-card">
          <h2>供应商维度</h2>
          <div
              id="usage-provider-chart"
              class="usage-chart"
          >
            <div
                v-if="providerUsageSummaries.length > 0"
                class="usage-bar-list"
            >
              <div
                  v-for="(summary, index) in providerUsageSummaries"
                  :key="`provider-summary-${summary.providerId ?? 'unknown'}-${index}`"
                  class="usage-bar-row"
              >
                <span>{{ summary.providerId ?? "未标记供应商" }}</span>
                <div class="usage-bar-track">
                  <div
                      class="usage-bar-fill"
                      :style="{ width: usageBarWidth(summary.totalTokens, providerUsageSummaries) }"
                  />
                </div>
                <strong>{{ formatTokenCount(summary.totalTokens) }}</strong>
              </div>
            </div>
            <span
                v-else
                class="usage-empty-state"
            >暂无供应商维度用量。</span>
          </div>
        </article>
        <article class="usage-chart-card">
          <h2>项目维度</h2>
          <div
              id="usage-project-chart"
              class="usage-chart"
          >
            <div
                v-if="projectUsageSummaries.length > 0"
                class="usage-bar-list"
            >
              <div
                  v-for="(summary, index) in projectUsageSummaries"
                  :key="`project-summary-${summary.projectId ?? 'global'}-${index}`"
                  class="usage-bar-row"
              >
                <span>{{ summary.projectId ?? "全局普通会话" }}</span>
                <div class="usage-bar-track">
                  <div
                      class="usage-bar-fill"
                      :style="{ width: usageBarWidth(summary.totalTokens, projectUsageSummaries) }"
                  />
                </div>
                <strong>{{ formatTokenCount(summary.totalTokens) }}</strong>
              </div>
            </div>
            <span
                v-else
                class="usage-empty-state"
            >暂无项目维度用量。</span>
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



