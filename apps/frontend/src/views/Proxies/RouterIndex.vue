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
const currentWorkspacePage = "proxies";
// proxyDialogVisible: 代理新增和编辑弹框显隐。
const proxyDialogVisible = ref(false);
// managementError：当前页面接口错误摘要，来源于 store 层捕获结果。
const managementError = computed(() => appStore.managementErrors.proxies ?? "");

/**
 * openCreateProxyDialog：打开新增代理弹框。
 *
 * @returns 没有返回值。
 */
function openCreateProxyDialog(): void {
  appStore.resetProxyDraft();
  proxyDialogVisible.value = true;
}

/**
 * openEditProxyDialog：打开编辑代理弹框。
 *
 * @param proxy 代理列表项。
 * @returns 没有返回值。
 */
function openEditProxyDialog(proxy: Parameters<typeof appStore.editProxy>[0]): void {
  appStore.editProxy(proxy);
  proxyDialogVisible.value = true;
}

/**
 * saveProxyDialog：保存代理配置并在成功后关闭弹框。
 *
 * @returns 保存完成后没有返回值。
 */
async function saveProxyDialog(): Promise<void> {
  await appStore.saveProxy();
  if (!appStore.managementErrors.proxies) {
    proxyDialogVisible.value = false;
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
  void appStore.loadProxies();
});

</script>

<template>
      <section
      class="page-panel"
  >
    <header class="page-header">
      <div>
        <h1>网络代理</h1>
        <p>代理账号和密码只保存在中心电脑，客户端不展示明文。</p>
      </div>
      <el-button
          type="primary"
          @click="openCreateProxyDialog"
      >
        新增代理
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
      <el-dialog
          v-model="proxyDialogVisible"
          append-to-body
          class="management-config-dialog proxy-config-dialog"
          title="网络代理配置"
          width="80vw"
          destroy-on-close
      >
        <el-form
          class="management-form"
          label-position="top"
        >
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="代理名称">
              <el-input v-model="appStore.proxyDraft.proxyName"/>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="协议">
              <el-select v-model="appStore.proxyDraft.protocol">
                <el-option
                    label="HTTP"
                    value="HTTP"
                />
                <el-option
                    label="HTTPS"
                    value="HTTPS"
                />
                <el-option
                    label="SOCKS4"
                    value="SOCKS4"
                />
                <el-option
                    label="SOCKS4a"
                    value="SOCKS4a"
                />
                <el-option
                    label="SOCKS5"
                    value="SOCKS5"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="主机">
              <el-input v-model="appStore.proxyDraft.host"/>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="端口">
              <el-input-number
                  v-model="appStore.proxyDraft.port"
                  :min="1"
                  :max="65535"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="用户名">
              <el-input
                  v-model="appStore.proxyDraft.username"
                  placeholder="留空表示无认证"
              />
              <small class="field-helper">用户名和密码都为空时，中心服务按无认证代理保存。</small>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="密码">
              <el-input
                  v-model="appStore.proxyDraft.password"
                  type="password"
                  show-password
                  placeholder="保存后不回显"
              />
              <small class="field-helper">留空表示不修改已保存密码；勾选清除认证后会删除已保存密码。</small>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="清除认证">
              <el-checkbox v-model="appStore.proxyDraft.clearAuth">
                清除用户名和已保存密码
              </el-checkbox>
              <small class="field-helper">用于把已有认证代理改回无认证代理。</small>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="备注">
              <el-input v-model="appStore.proxyDraft.note"/>
            </el-form-item>
          </el-col>
        </el-row>
        <div class="management-actions">
          <el-button
              type="primary"
              @click="saveProxyDialog"
          >
            保存代理
          </el-button>
          <el-button @click="appStore.loadProxies">
            刷新列表
          </el-button>
          <el-button @click="appStore.setGlobalDefaultProxy(null)">
            取消全局默认代理
          </el-button>
        </div>
        </el-form>
      </el-dialog>
      <section class="management-list">
        <article
            v-for="proxy in appStore.proxies"
            :key="proxy.proxyId"
            class="management-item"
        >
          <div>
            <strong>{{ proxy.proxyName }}</strong>
            <span>{{ proxy.protocol }} · {{ proxy.host }}:{{ proxy.port }}</span>
            <small>{{ proxy.hasAuth ? "已配置认证" : "无认证" }}</small>
            <small v-if="appStore.defaultProxyId === proxy.proxyId">全局默认代理</small>
            <small>更新时间：{{ formatDisplayTime(proxy.updatedAt) }}</small>
            <small v-if="proxy.note">备注：{{ proxy.note }}</small>
          </div>
          <div class="management-actions">
            <el-tag :type="proxy.enabled ? 'success' : 'info'">
              {{ proxy.enabled ? "启用" : "停用" }}
            </el-tag>
            <el-button @click="openEditProxyDialog(proxy)">
              修改
            </el-button>
            <el-button @click="appStore.toggleProxy(proxy)">
              {{ proxy.enabled ? "停用" : "启用" }}
            </el-button>
            <el-button @click="appStore.setGlobalDefaultProxy(proxy.proxyId)">
              设为全局默认
            </el-button>
            <el-button
                type="danger"
                plain
                @click="appStore.deleteProxy(proxy)"
            >
              删除
            </el-button>
          </div>
        </article>
      </section>
    </section>
  </section>
</template>



