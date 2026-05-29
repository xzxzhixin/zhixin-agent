<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed } from "vue";
import { useAppStore } from "../stores/app";

// appStore：设置页读取中心服务本机配置和通知权限状态。
const appStore = useAppStore();

// restartTip：端口或中心目录修改后需要重启中心服务才能生效。
const restartTip = computed(() => "端口和中心目录修改后需要重启中心服务生效。");

// restartCenterService：通过 Electron 主进程重启中心服务并展示失败原因。
async function restartCenterService(): Promise<void> {
  // bridge：只有桌面端环境存在主进程桥接能力。
  const bridge = window.zhixinDesktop;
  // missing：浏览器预览时无法重启中心服务。
  if (!bridge) {
    ElMessage.error("当前环境没有桌面端主进程桥接能力。");
    return;
  }
  // result：主进程返回启动状态和 stderr 摘要。
  const result = await bridge.restartCenterService();
  // failed：展示中心服务启动失败原因。
  if (!result.ok) {
    ElMessage.error(result.errorMessage || "中心服务重启失败");
    return;
  }
  // loadCenterState：重启后刷新连接状态。
  await appStore.loadCenterState();
  // success：给出明确反馈。
  ElMessage.success("中心服务已重启");
}
</script>

<template>
  <section class="page-panel">
    <header class="page-header">
      <div>
        <h1>设置</h1>
        <p>{{ restartTip }}</p>
      </div>
      <el-button
        type="primary"
        @click="restartCenterService"
      >
        重启中心服务
      </el-button>
    </header>

    <section class="page-scroll">
      <el-descriptions
        :column="1"
        border
      >
        <el-descriptions-item label="中心服务端口">
          {{ appStore.centerConfig?.port || 8866 }}
        </el-descriptions-item>
        <el-descriptions-item label="中心目录">
          {{ appStore.centerConfig?.centerDirectory || "未连接" }}
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
      </el-descriptions>
    </section>
  </section>
</template>
