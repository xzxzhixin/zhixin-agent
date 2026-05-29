<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { saveCenterConfig } from "../api";
import { useAppStore } from "../stores/app";

// appStore：读取中心服务健康状态、本机配置和业务统计。
const appStore = useAppStore();
// centerServiceRunning：主进程记录的中心服务进程是否运行。
const centerServiceRunning = ref(false);
// centerServiceSwitching：中心服务启动、停止或重启操作是否正在进行。
const centerServiceSwitching = ref(false);
// configSaving：中心服务本机配置保存状态。
const configSaving = ref(false);
// centerDirectoryInput：用户配置的中心目录绝对路径，保存后重启中心服务生效。
const centerDirectoryInput = ref("");
// webAccountInput：Web端非本机访问账号，由桌面端集中配置。
const webAccountInput = ref("");
// webPasswordInput：Web端非本机访问新密码，只用于本次保存，不回显已有明文。
const webPasswordInput = ref("");

// centerSwitchText：中心服务启停按钮文本。
const centerSwitchText = computed(() => (centerServiceRunning.value ? "停止中心服务" : "启动中心服务"));

// loadCenterServiceStatus：从 Electron 主进程读取中心服务进程状态。
async function loadCenterServiceStatus(): Promise<void> {
  // bridge：中心服务进程只能由桌面端主进程管理，Web端没有该桥接。
  const bridge = window.zhixinDesktop;
  // missing：浏览器预览没有桥接时，只能按 HTTP 健康状态展示近似状态。
  if (!bridge?.getCenterServiceStatus) {
    centerServiceRunning.value = Boolean(appStore.health);
    return;
  }
  // status：主进程状态用于区分进程是否由桌面端持有。
  const status = await bridge.getCenterServiceStatus();
  // centerServiceRunning：驱动启停按钮文本和颜色。
  centerServiceRunning.value = status.running;
}

// refreshCenterState：刷新进程状态和中心服务业务状态。
async function refreshCenterState(): Promise<void> {
  // loadCenterServiceStatus：先刷新进程状态，避免按钮状态滞后。
  await loadCenterServiceStatus();
  // loadCenterState：再读取健康检查、配置、任务和统计等业务状态。
  await appStore.loadCenterState();
  // syncConfigInputs：刷新后同步表单，避免用户看到旧配置。
  syncConfigInputs();
}

// syncConfigInputs：把中心服务当前配置同步到桌面端配置表单。
function syncConfigInputs(): void {
  // config：中心服务未连接时不覆盖用户正在输入的内容。
  const config = appStore.centerConfig;
  if (!config) {
    return;
  }
  // centerDirectoryInput：中心目录必须使用中心服务返回的绝对路径。
  centerDirectoryInput.value = config.centerDirectory;
  // webAccountInput：账号可以回显，便于用户确认和修改。
  webAccountInput.value = config.webAccount;
  // webPasswordInput：密码明文不回显，空值表示保持现有密码摘要。
  webPasswordInput.value = "";
}

// saveLocalConfig：保存中心目录和 Web 访问账号密码配置。
async function saveLocalConfig(): Promise<void> {
  // config：保存配置必须基于中心服务当前配置，避免丢失端口和通知权限。
  const config = appStore.centerConfig;
  if (!config) {
    ElMessage.error("中心服务未连接，不能保存配置。");
    return;
  }
  // configSaving：防止重复点击造成并发保存。
  configSaving.value = true;
  try {
    // next：只提交本页面负责的字段，密码为空时不覆盖已有密码摘要。
    const next = await saveCenterConfig({
      port: config.port,
      centerDirectory: centerDirectoryInput.value,
      webAccount: webAccountInput.value,
      webPassword: webPasswordInput.value,
      systemNotificationPermission: config.systemNotificationPermission,
    });
    // centerConfig：保存中心服务返回的最新配置。
    appStore.centerConfig = next;
    // bridge：同步主进程启动参数，确保点击重启后使用刚保存的中心目录。
    const bridge = window.zhixinDesktop;
    if (bridge?.updateCenterServiceLaunchConfig) {
      await bridge.updateCenterServiceLaunchConfig({
        port: next.port,
        centerDirectory: next.centerDirectory,
      });
    }
    // syncConfigInputs：清空密码输入并同步规范化后的中心目录。
    syncConfigInputs();
    // success：配置已保存但中心目录和端口要重启后生效。
    ElMessage.success("中心服务配置已保存，重启中心服务后生效。");
  } finally {
    // configSaving：保存结束后恢复按钮。
    configSaving.value = false;
  }
}

// toggleCenterService：启动或停止桌面端管理的中心服务。
async function toggleCenterService(): Promise<void> {
  // bridge：启停能力只在桌面端主进程存在。
  const bridge = window.zhixinDesktop;
  // missing：没有主进程桥接时提示用户当前环境不能启停。
  if (!bridge) {
    ElMessage.error("当前环境没有桌面端主进程桥接能力。");
    return;
  }
  // centerServiceSwitching：防止连续点击造成进程状态交错。
  centerServiceSwitching.value = true;
  try {
    // result：按当前进程状态选择启动或停止。
    const result = centerServiceRunning.value
      ? await bridge.stopCenterService()
      : await bridge.startCenterService();
    // failed：主进程返回失败信息时直接展示。
    if (!result.ok) {
      ElMessage.error(result.errorMessage || "中心服务操作失败");
      return;
    }
    // refreshCenterState：操作完成后同步进程状态和业务状态。
    await refreshCenterState();
  } finally {
    // centerServiceSwitching：无论成功失败都解除按钮 loading。
    centerServiceSwitching.value = false;
  }
}

// restartCenterService：重启中心服务，用于端口、目录等本机配置修改后生效。
async function restartCenterService(): Promise<void> {
  // bridge：重启能力只由桌面端主进程提供。
  const bridge = window.zhixinDesktop;
  // missing：浏览器预览不能重启中心服务。
  if (!bridge) {
    ElMessage.error("当前环境没有桌面端主进程桥接能力。");
    return;
  }
  // centerServiceSwitching：重启期间禁用启停按钮。
  centerServiceSwitching.value = true;
  try {
    // result：主进程负责停止旧进程并启动新进程。
    const result = await bridge.restartCenterService();
    // failed：展示启动失败原因，避免静默失败。
    if (!result.ok) {
      ElMessage.error(result.errorMessage || "中心服务重启失败");
      return;
    }
    // refreshCenterState：重启后重新读取状态。
    await refreshCenterState();
    // success：明确告知重启完成。
    ElMessage.success("中心服务已重启");
  } finally {
    // centerServiceSwitching：重启结束后恢复操作。
    centerServiceSwitching.value = false;
  }
}

// onMounted：进入中心服务页面后读取最新进程和业务状态。
onMounted(() => {
  // refreshCenterState：页面打开时主动刷新，避免沿用顶部旧状态。
  void refreshCenterState();
});
</script>

<template>
  <section class="page-panel">
    <header class="page-header">
      <div>
        <h1>中心服务</h1>
        <p>桌面端本机中心服务进程、端口、目录和 Web 访问配置。</p>
      </div>
      <div class="page-header-actions">
        <el-button
          :loading="configSaving"
          @click="saveLocalConfig"
        >
          保存配置
        </el-button>
        <el-button
          :type="centerServiceRunning ? 'warning' : 'primary'"
          :loading="centerServiceSwitching"
          @click="toggleCenterService"
        >
          {{ centerSwitchText }}
        </el-button>
        <el-button
          :loading="centerServiceSwitching"
          @click="restartCenterService"
        >
          重启中心服务
        </el-button>
      </div>
    </header>

    <section class="page-scroll">
      <el-form
        class="center-service-form"
        label-position="top"
      >
        <el-form-item label="中心目录">
          <el-input
            v-model="centerDirectoryInput"
            placeholder="请输入中心目录绝对路径"
          />
        </el-form-item>
        <el-form-item label="Web访问账号">
          <el-input
            v-model="webAccountInput"
            placeholder="请输入 Web 访问账号"
          />
        </el-form-item>
        <el-form-item label="Web访问密码">
          <el-input
            v-model="webPasswordInput"
            placeholder="留空表示不修改已保存密码"
            show-password
            type="password"
          />
        </el-form-item>
      </el-form>

      <el-descriptions
        :column="1"
        border
      >
        <el-descriptions-item label="进程状态">
          {{ centerServiceRunning ? "运行中" : "未运行" }}
        </el-descriptions-item>
        <el-descriptions-item label="连接状态">
          {{ appStore.connectionText }}
        </el-descriptions-item>
        <el-descriptions-item label="中心服务端口">
          {{ appStore.centerConfig?.port || 8866 }}
        </el-descriptions-item>
        <el-descriptions-item label="中心目录">
          {{ appStore.centerConfig?.centerDirectory || appStore.health?.centerDirectory || "未连接" }}
        </el-descriptions-item>
        <el-descriptions-item label="Web访问账号">
          {{ appStore.centerConfig?.webAccount || "未配置" }}
        </el-descriptions-item>
        <el-descriptions-item label="Web访问密码">
          {{ appStore.centerConfig?.webPasswordHash ? "已保存摘要" : "未配置" }}
        </el-descriptions-item>
        <el-descriptions-item label="系统通知权限">
          {{ appStore.centerConfig?.systemNotificationPermission || "unknown" }}
        </el-descriptions-item>
        <el-descriptions-item label="启用供应商">
          {{ appStore.enabledProviderCount }} 个
        </el-descriptions-item>
        <el-descriptions-item label="项目数量">
          {{ appStore.projects.length }} 个
        </el-descriptions-item>
      </el-descriptions>
    </section>
  </section>
</template>
