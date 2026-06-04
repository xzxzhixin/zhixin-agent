<script setup lang="ts">
import {
  computed,
  onMounted,
  ref,
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
const currentWorkspacePage = "skills";
// skillDialogVisible: skill 安装弹框显隐。
const skillDialogVisible = ref(false);
// managementError：当前页面接口错误摘要，来源于 store 层捕获结果。
const managementError = computed(() => appStore.managementErrors.skills ?? "");

/**
 * saveSkillDialog：安装 skill 并在成功后关闭弹框。
 *
 * @returns 安装完成后没有返回值。
 */
async function saveSkillDialog(): Promise<void> {
  await appStore.installSkill();
  if (!appStore.managementErrors.skills) {
    skillDialogVisible.value = false;
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
  void appStore.loadSkills();
});

</script>

<template>
      <section
      class="page-panel"
  >
    <header class="page-header">
      <div>
        <h1>skill</h1>
        <p>全局扩展能力管理：安装全局 skill，内容保存到中心目录 skills。</p>
      </div>
      <el-button @click="appStore.loadSkills">
        刷新列表
      </el-button>
      <el-button
          type="primary"
          @click="skillDialogVisible = true"
      >
        安装 skill
      </el-button>
    </header>
    <section class="page-scroll">
      <el-dialog
          v-model="skillDialogVisible"
          append-to-body
          class="management-config-dialog skill-config-dialog"
          title="安装 skill"
          width="80vw"
          destroy-on-close
      >
        <el-form
          class="management-form"
          label-position="top"
        >
        <p class="field-helper">
          全局 skill 管理页只展示 appStore.globalSkills；项目级 skill 由打开项目目录扫描，只在项目对话的项目能力详情中展示。
        </p>
        <el-form-item label="skill 名称">
          <el-input v-model="appStore.skillDraft.skillName"/>
        </el-form-item>
        <el-form-item label="skill 内容">
          <el-input
              v-model="appStore.skillDraft.content"
              type="textarea"
              :rows="10"
          />
        </el-form-item>
        <div class="management-actions">
          <el-button
              type="primary"
              @click="saveSkillDialog"
          >
            安装 skill
          </el-button>
        </div>
        </el-form>
      </el-dialog>
      <el-table
          :data="appStore.globalSkills"
          class="management-table"
          empty-text="暂无全局 skill"
      >
        <el-table-column
            label="skill"
            min-width="180"
        >
          <template #default="{ row: skill }">
            <strong>{{ skill.skillName }}</strong>
            <small>项目级 skill 只在项目能力详情中展示。</small>
          </template>
        </el-table-column>
        <el-table-column
            label="作用域"
            width="110"
            prop="scope"
        />
        <el-table-column
            label="文件路径"
            min-width="260"
            prop="relativePath"
        />
        <el-table-column
            label="内容摘要"
            min-width="260"
        >
          <template #default="{ row: skill }">
            {{ skill.content.slice(0, 80) }}
          </template>
        </el-table-column>
      </el-table>
    </section>
  </section>
</template>



