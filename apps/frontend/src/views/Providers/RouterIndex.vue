<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  ref,
} from "vue";
import {
  use,
} from "echarts/core";
import {
  ElMessage,
} from "element-plus";

import {
  useAppStore,
} from "@stores/app";

// appStore：页面宿主复用现有 Pinia 状态和 API 行为，不新建协议适配层。
const appStore = useAppStore();

// usageChartModulesRegistered：用量统计图形化展示依赖 ECharts 模块注册；真实图表实例后续按数据接入。
const usageChartModulesRegistered = use;

// currentWorkspacePage：当前页面协议值，来源于当前 views 目录对应路由。
const currentWorkspacePage = "providers";
// providerDialogVisible: 供应商新增和编辑弹框显隐。
const providerDialogVisible = ref(false);
// selectedProtocolPlugin：当前草稿选中的协议插件，来源于中心服务注册列表。
const selectedProtocolPlugin = computed(() => {
  return appStore.providerProtocolPlugins.find((plugin) => {
    return plugin.pluginId === appStore.providerDraft.protocolPluginId;
  }) ?? null;
});

// selectedProtocolModes：当前协议插件支持的协议模式列表，用于避免前端写死模式。
const selectedProtocolModes = computed(() => {
  return selectedProtocolPlugin.value?.protocolModes ?? [];
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

// defaultProviderProxyPolicy：旧供应商记录没有代理策略时使用全局默认代理，保持历史配置可编辑。
const defaultProviderProxyPolicy = {
  mode: "use-global-default" as const,
  proxyId: null,
};

// defaultProviderCapabilities：旧供应商能力字段缺失时使用全部 false，避免弹窗渲染时访问空对象。
const defaultProviderCapabilities = {
  supportsVision: false,
  supportsToolCalling: false,
  supportsJsonOutput: false,
  supportsReasoningEffort: false,
  providesCacheUsage: false,
  supportsModelList: false,
  supportsStreaming: false,
};

// selectedProviderModelOptions：供应商默认模型下拉候选，来源于已保存或刷新后的模型列表。
const selectedProviderModelOptions = computed(() => {
  const providerId = appStore.providerDraft.providerId;
  if (!providerId) {
    return [];
  }

  const savedModels = appStore.providerModelOptions[providerId]?.models;
  return Array.isArray(savedModels) ? savedModels : [];
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

// manualModelContextText：供应商手填模型的唯一输入口，页面层同步旧状态字段，避免继续显示两个文本域。
const manualModelContextText = computed({
  get() {
    return appStore.providerDraft.refreshModelContextWindowsText;
  },
  set(value: string) {
    appStore.providerDraft.refreshModelContextWindowsText = value;
    // refreshModelsText：模型刷新接口仍接收模型名数组，这里只从明确的 `模型名=上下文长度` 左侧解析，不做候选字段兜底。
    appStore.providerDraft.refreshModelsText = value.split(/\r?\n/u).map((line) => {
      const equalIndex = line.indexOf("=");
      return equalIndex > 0 ? line.slice(0, equalIndex).trim() : "";
    }).filter((model) => {
      return model.length > 0;
    }).join("\n");
  },
});

// manualReasoningEffortText：推理深度手填入口，来源于供应商模型刷新协议 reasoningEfforts。
const manualReasoningEffortText = computed({
  get() {
    return appStore.providerDraft.refreshReasoningText;
  },
  set(value: string) {
    appStore.providerDraft.refreshReasoningText = value;
  },
});

// manualModelContextError：手填模型格式错误提示，来源于当前唯一文本域。
const manualModelContextError = computed(() => {
  const invalidLine = manualModelContextText.value.split(/\r?\n/u).find((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      return false;
    }
    const equalIndex = trimmedLine.indexOf("=");
    const contextWindowK = Number(trimmedLine.slice(equalIndex + 1).replace(/K$/iu, "").trim());
    return equalIndex <= 0 || !Number.isFinite(contextWindowK) || contextWindowK <= 0;
  });
  return invalidLine ? "手填模型必须使用“模型名=上下文长度K”，例如 gpt-4o=128K。" : "";
});

/**
 * openCreateProviderDialog：打开新增供应商弹框。
 *
 * @returns 没有返回值。
 */
function openCreateProviderDialog(): void {
  appStore.resetProviderDraft();
  // enabled: 新增供应商默认保存为停用，避免只填 Base URL 和 API Key 的草稿触发启用完整性校验。
  appStore.providerDraft.enabled = false;
  providerDialogVisible.value = true;
}

/**
 * openEditProviderDialog：打开编辑供应商弹框。
 *
 * @param provider 供应商列表项。
 * @returns 没有返回值。
 */
function openEditProviderDialog(provider: Parameters<typeof appStore.editProvider>[0]): void {
  providerDialogVisible.value = true;
  const providerModelOptions = appStore.providerModelOptions[provider.providerId];
  const contextWindows = Array.isArray(providerModelOptions?.contextWindows)
    ? providerModelOptions.contextWindows
    : [];
  const reasoningEfforts = Array.isArray(providerModelOptions?.reasoningEfforts)
    ? providerModelOptions.reasoningEfforts
    : [];
  // 旧供应商配置可能缺少 proxyPolicy、capabilities 或模型列表，编辑草稿必须在页面入口补齐默认结构。
  appStore.providerDraft = {
    providerId: provider.providerId,
    providerName: provider.providerName,
    protocolPluginId: provider.protocolPluginId,
    protocolMode: provider.protocolMode,
    baseUrl: provider.baseUrl,
    apiKey: "",
    model: provider.defaultModel,
    enabled: provider.enabled,
    capabilities: {
      ...defaultProviderCapabilities,
      ...(provider.capabilities ?? {}),
    },
    proxyPolicy: {
      ...defaultProviderProxyPolicy,
      ...(provider.proxyPolicy ?? {}),
    },
    refreshModelsText: provider.defaultModel,
    refreshModelContextWindowsText: formatModelContextWindowsForDialog(contextWindows),
    refreshReasoningText: reasoningEfforts.join("\n"),
  };
  void appStore.loadProviderModelOptions(provider.providerId);
  void nextTick();
  providerDialogVisible.value = true;
}

/**
 * formatModelContextWindowsForDialog：把已保存模型窗口转为弹窗多行文本。
 *
 * @param contextWindows 中心服务返回的模型窗口配置数组。
 * @returns 供文本域展示的 `模型名=数字K` 多行文本。
 */
function formatModelContextWindowsForDialog(
  contextWindows: Array<{
    model: string;
    contextWindowTokens: number;
  }>,
): string {
  return contextWindows.map((item) => {
    const contextWindowK = Math.max(1, Math.round(item.contextWindowTokens / 1000));
    return `${item.model}=${contextWindowK}K`;
  }).join("\n");
}

/**
 * saveProviderDialog：保存供应商配置并在成功后关闭弹框。
 *
 * @returns 保存完成后没有返回值。
 */
async function saveProviderDialog(): Promise<void> {
  await runProviderMessageAction({
    action: () => appStore.saveProvider(),
    successMessage: "供应商已保存。",
    failureMessage: "供应商保存失败。",
    warningOnly: false,
  });
  if (!getProviderError()) {
    providerDialogVisible.value = false;
  }
}

/**
 * fetchProviderModelsForDialog：从当前供应商上游获取模型并同步弹框草稿。
 *
 * @returns 获取完成后没有返回值。
 */
async function fetchProviderModelsForDialog(): Promise<void> {
  await runProviderMessageAction({
    action: () => appStore.fetchProviderModels(),
    successMessage: "模型列表已获取。",
    failureMessage: "模型列表获取失败。",
    warningOnly: true,
  });
}

/**
 * refreshProvidersWithMessage：刷新供应商列表并使用全局消息提示结果。
 *
 * @returns 刷新完成后没有返回值。
 */
async function refreshProvidersWithMessage(): Promise<void> {
  await runProviderMessageAction({
    action: () => appStore.loadProviders(),
    successMessage: "供应商列表已刷新。",
    failureMessage: "供应商列表刷新失败。",
    warningOnly: true,
  });
}

/**
 * toggleProviderWithMessage：启用或停用供应商并显示全局消息。
 *
 * @param provider 供应商列表行。
 * @returns 操作完成后没有返回值。
 */
async function toggleProviderWithMessage(provider: Parameters<typeof appStore.toggleProvider>[0]): Promise<void> {
  await runProviderMessageAction({
    action: () => appStore.toggleProvider(provider),
    successMessage: provider.enabled ? "供应商已停用。" : "供应商已启用。",
    failureMessage: provider.enabled ? "供应商停用失败。" : "供应商启用失败。",
    warningOnly: false,
  });
}

/**
 * deleteProviderWithMessage：删除供应商入口沿用中心服务停用能力并显示全局消息。
 *
 * @param provider 供应商列表行。
 * @returns 操作完成后没有返回值。
 */
async function deleteProviderWithMessage(provider: Parameters<typeof appStore.deleteProvider>[0]): Promise<void> {
  await runProviderMessageAction({
    action: () => appStore.deleteProvider(provider),
    successMessage: "供应商已删除。",
    failureMessage: "供应商删除失败。",
    warningOnly: false,
  });
}

/**
 * refreshProviderModelsWithMessage：提交手动模型配置并显示全局消息。
 *
 * @param provider 供应商列表行。
 * @returns 操作完成后没有返回值。
 */
async function refreshProviderModelsWithMessage(provider: Parameters<typeof appStore.refreshProviderModels>[0]): Promise<void> {
  await runProviderMessageAction({
    action: () => appStore.refreshProviderModels(provider),
    successMessage: "模型和推理深度已保存。",
    failureMessage: "模型和推理深度保存失败。",
    warningOnly: true,
  });
}

/**
 * getProviderError：读取供应商管理错误。
 *
 * @returns 当前供应商错误文案。
 */
function getProviderError(): string {
  return appStore.managementErrors.providers ?? "";
}

/**
 * runProviderMessageAction：把供应商页操作结果统一转为 Element Plus 全局消息。
 *
 * @param options 操作函数、成功文案、失败文案和警告级别。
 * @returns 操作完成后没有返回值。
 */
async function runProviderMessageAction(options: {
  action: () => Promise<void>;
  successMessage: string;
  failureMessage: string;
  warningOnly: boolean;
}): Promise<void> {
  // managementErrors.providers: store 是供应商错误事实源；页面操作前清空旧错误，避免旧错误被误当成本次失败。
  appStore.managementErrors.providers = "";
  try {
    await options.action();
  } catch (error) {
    const message = error instanceof Error ? error.message : options.failureMessage;
    ElMessage.error(message);
    return;
  }

  const providerError = getProviderError();
  if (providerError) {
    if (providerError.includes("配置不完整，无法启用")) {
      ElMessage.error(providerError);
      return;
    }
    if (options.warningOnly) {
      ElMessage.warning(providerError);
    } else {
      ElMessage.error(providerError);
    }
    return;
  }

  ElMessage.success(options.successMessage);
}

/**
 * onMounted：当前页面挂载时加载中心服务事实数据。
 *
 * @returns 没有返回值。
 */
onMounted(() => {
  void appStore.loadProviders();
  void appStore.loadProxies();
});

</script>

<template>
      <section
      class="page-panel"
  >
    <header class="page-header">
      <div>
        <h1>供应商</h1>
        <p>API Key 只保存在中心电脑，客户端只展示是否已保存；默认模型优先从供应商模型列表选择。</p>
      </div>
      <el-button
          type="primary"
          @click="openCreateProviderDialog"
      >
        新增供应商
      </el-button>
    </header>
    <section class="page-scroll">
      <el-dialog
          v-model="providerDialogVisible"
          append-to-body
          class="management-config-dialog provider-config-dialog"
          title="供应商配置"
          width="80vw"
      >
        <el-form
          class="management-form"
          label-position="top"
        >
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="供应商名称">
              <el-input v-model="appStore.providerDraft.providerName"/>
              <small class="field-helper">用于在智能体、审计和用量统计中识别该模型提供方。</small>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="协议插件">
              <el-select
                  v-model="appStore.providerDraft.protocolPluginId"
                  @change="appStore.selectProviderProtocolPlugin"
              >
                <el-option
                    v-for="plugin in appStore.providerProtocolPlugins"
                    :key="plugin.pluginId"
                    :label="plugin.pluginName"
                    :value="plugin.pluginId"
                />
              </el-select>
              <small class="field-helper">协议插件来自中心服务已注册内置模型协议清单。</small>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="协议模式">
              <el-select v-model="appStore.providerDraft.protocolMode">
                <el-option
                    v-for="mode in selectedProtocolModes"
                    :key="mode.mode"
                    :label="mode.label"
                    :value="mode.mode"
                >
                  <span>{{ mode.label }}</span>
                  <small class="option-helper">{{ mode.description }}</small>
                </el-option>
              </el-select>
              <small class="field-helper">协议模式由当前模型协议插件声明，保存后进入中心服务供应商配置。</small>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="默认模型">
              <!-- 默认模型必须始终使用可创建下拉，避免无模型列表时退回普通输入框。 -->
              <el-select
                  v-model="appStore.providerDraft.model"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择或输入模型名称"
              >
                <el-option
                    v-for="model in selectedProviderModelOptions"
                    :key="model"
                    :label="model"
                    :value="model"
                />
              </el-select>
              <small class="field-helper">{{ providerModelSourceText }}</small>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item>
              <template #label>
                <div class="provider-field-title">
                  <span>手填模型与上下文</span>
                  <el-button
                      type="primary"
                      link
                      @click="fetchProviderModelsForDialog"
                  >
                    获取
                  </el-button>
                </div>
              </template>
              <el-input
                  v-model="manualModelContextText"
                  type="textarea"
                  :rows="4"
                  placeholder="gpt-4o=128K"
              />
              <small class="field-helper">一行一个 `模型名=上下文长度`，统一使用 K 作为输入单位；保存后会转换为 token 数值并进入默认模型下拉来源。</small>
              <small
                  v-if="manualModelContextError"
                  class="el-form-item__error"
              >
                {{ manualModelContextError }}
              </small>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="推理深度">
              <el-input
                  v-model="manualReasoningEffortText"
                  type="textarea"
                  :rows="4"
                  placeholder="low&#10;medium&#10;high"
              />
              <small class="field-helper">一行一个推理深度协议值；只有能力声明启用推理深度时，后续发送才会消费该列表。</small>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="能力声明">
              <div class="provider-capability-grid">
                <el-checkbox v-model="appStore.providerDraft.capabilities.supportsVision">
                  图片输入
                </el-checkbox>
                <el-checkbox v-model="appStore.providerDraft.capabilities.supportsToolCalling">
                  工具调用
                </el-checkbox>
                <el-checkbox v-model="appStore.providerDraft.capabilities.supportsJsonOutput">
                  JSON 输出
                </el-checkbox>
                <el-checkbox v-model="appStore.providerDraft.capabilities.supportsReasoningEffort">
                  推理深度
                </el-checkbox>
                <el-checkbox v-model="appStore.providerDraft.capabilities.supportsModelList">
                  模型列表
                </el-checkbox>
                <el-checkbox v-model="appStore.providerDraft.capabilities.supportsStreaming">
                  流式输出
                </el-checkbox>
                <el-checkbox v-model="appStore.providerDraft.capabilities.providesCacheUsage">
                  缓存用量
                </el-checkbox>
              </div>
              <small class="field-helper">能力声明保存到中心服务供应商配置，用于图片、工具、JSON、推理深度、模型列表、流式和缓存用量判断。</small>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="Base URL">
              <el-input v-model="appStore.providerDraft.baseUrl"/>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="API Key 新值">
              <el-input
                  v-model="appStore.providerDraft.apiKey"
                  type="password"
                  show-password
                  placeholder="保存后不回显"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="代理策略">
              <el-select v-model="appStore.providerDraft.proxyPolicy.mode">
                <el-option
                    label="不使用代理"
                    value="none"
                />
                <el-option
                    label="使用全局默认代理"
                    value="use-global-default"
                />
                <el-option
                    label="使用指定代理"
                    value="use-specified"
                />
              </el-select>
              <small class="field-helper">代理策略只影响后续供应商请求，不回改历史模型调用记录。</small>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="指定代理">
              <el-select
                  v-model="appStore.providerDraft.proxyPolicy.proxyId"
                  :disabled="appStore.providerDraft.proxyPolicy.mode !== 'use-specified'"
                  clearable
                  placeholder="选择网络代理"
              >
                <el-option
                    v-for="proxy in appStore.proxies"
                    :key="proxy.proxyId"
                    :label="`${proxy.proxyName} · ${proxy.protocol} · ${proxy.host}:${proxy.port}`"
                    :value="proxy.proxyId"
                />
              </el-select>
              <small class="field-helper">只有选择“使用指定代理”时，中心服务才会读取这里的代理 ID。</small>
            </el-form-item>
          </el-col>
        </el-row>
        <div class="management-actions">
          <el-button
              type="primary"
              @click="saveProviderDialog"
          >
            保存供应商
          </el-button>
          <el-button @click="refreshProvidersWithMessage">
            刷新列表
          </el-button>
        </div>
        </el-form>
      </el-dialog>
      <el-table
          :data="appStore.providers"
          class="management-table"
          empty-text="暂无供应商"
      >
        <el-table-column
            label="供应商"
            min-width="180"
        >
          <template #default="{ row: provider }">
            <strong>{{ provider.providerName }}</strong>
            <small>{{ provider.providerId }}</small>
          </template>
        </el-table-column>
        <el-table-column
            label="协议"
            min-width="220"
        >
          <template #default="{ row: provider }">
            <span>{{ provider.protocolPluginId }}</span>
            <small>{{ provider.protocolMode }}</small>
          </template>
        </el-table-column>
        <el-table-column
            label="接口与密钥"
            min-width="260"
        >
          <template #default="{ row: provider }">
            <span>{{ provider.baseUrl }}</span>
            <small>API Key：{{ provider.hasApiKey ? "已保存" : "未保存" }}</small>
          </template>
        </el-table-column>
        <el-table-column
            label="状态"
            width="110"
        >
          <template #default="{ row: provider }">
            <el-tag :type="provider.enabled ? 'success' : 'info'">
              {{ provider.enabled ? "启用" : "停用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
            fixed="right"
            label="操作"
            min-width="330"
        >
          <template #default="{ row: provider }">
            <div class="management-table-actions">
              <el-button @click="openEditProviderDialog(provider)">
                修改
              </el-button>
              <el-button @click="toggleProviderWithMessage(provider)">
                {{ provider.enabled ? "停用" : "启用" }}
              </el-button>
              <el-button @click="refreshProviderModelsWithMessage(provider)">
                刷新模型/推理深度
              </el-button>
              <el-button
                  type="danger"
                  plain
                  @click="deleteProviderWithMessage(provider)"
              >
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </section>
</template>

<style scoped>
.option-helper {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 18px;
}

.provider-capability-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.provider-field-title {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: flex-start;
}
</style>
