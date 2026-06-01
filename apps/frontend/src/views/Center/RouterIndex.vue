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
const currentWorkspacePage = "center";
// managementError：当前页面接口错误摘要，来源于 store 层捕获结果。
const managementError = computed(() => appStore.managementErrors.center ?? "");

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
 * onMounted：中心服务页面读取桌面壳状态。
 *
 * @returns 没有返回值。
 */
onMounted(() => {
  void appStore.loadDesktopStatus();
});

</script>

<template>
      <section
      class="page-panel"
  >
    <header class="page-header">
      <div>
        <h1>中心服务</h1>
        <p>桌面壳本机中心服务进程、端口、目录和 Web 访问配置。</p>
      </div>
      <div
          v-if="appStore.runtime.capabilities.canManageCenterService"
          class="page-header-actions"
      >
        <el-button @click="appStore.saveDesktopConfig">
          保存配置
        </el-button>
      </div>
    </header>
    <section
        v-if="!appStore.runtime.capabilities.canManageCenterService"
        class="page-scroll"
    >
      <el-alert
          type="info"
          :closable="false"
          title="中心服务启停和本机配置只在桌面壳可用。"
      />
    </section>
    <section
        v-else
        class="page-scroll"
    >
      <el-form
          class="center-service-form"
          label-position="top"
      >
        <el-form-item label="端口">
          <el-input-number
              v-model="appStore.desktopConfigDraft.port"
              :min="1"
              :max="65535"
          />
        </el-form-item>
        <el-form-item label="中心目录">
          <el-input v-model="appStore.desktopConfigDraft.centerDirectory"/>
        </el-form-item>
        <el-alert
            v-if="appStore.desktopStatus?.isExternalCenterDirectory"
            type="warning"
            :closable="false"
            title="外部中心目录不会随程序目录删除"
        />
        <el-divider/>
        <el-form-item label="Web 远程访问账号">
          <el-input v-model="appStore.remoteAccessDraft.account"/>
        </el-form-item>
        <el-form-item label="Web 远程访问密码">
          <el-input
              v-model="appStore.remoteAccessDraft.password"
              type="password"
              show-password
          />
        </el-form-item>
        <el-button @click="appStore.saveRemoteAccessAccount">
          保存远程访问
        </el-button>
        <p class="panel-muted">
          系统通知：{{ appStore.notificationPermission || "未检测" }}
        </p>
      </el-form>
    </section>
  </section>
</template>



