<script setup lang="ts">
import { Moon, Sunny } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "./stores/app";

// appStore：桌面端公共状态，来自 Pinia。
const appStore = useAppStore();
// router：页面跳转统一通过 Vue Router。
const router = useRouter();
// route：读取当前页面用于菜单高亮。
const route = useRoute();
// lastShownErrorMessage：记录已经弹出的错误，避免自动重连时重复刷屏。
const lastShownErrorMessage = ref("");

// menuItems：桌面端头部主菜单，替代 Electron 原生菜单栏和旧侧边栏菜单。
const menuItems = [
  {
    // path：对话页面路由。
    path: "/",
    // label：顶部菜单展示文本。
    label: "对话",
  },
  {
    // path：供应商管理页面路由。
    path: "/providers",
    // label：顶部菜单展示文本。
    label: "供应商",
  },
  {
    // path：网络代理管理页面路由。
    path: "/proxies",
    // label：顶部菜单展示文本。
    label: "网络代理",
  },
  {
    // path：运行环境管理页面路由。
    path: "/runtimes",
    // label：顶部菜单展示文本。
    label: "运行环境",
  },
  {
    // path：用量统计页面路由。
    path: "/usage",
    // label：顶部菜单展示文本。
    label: "用量统计",
  },
  {
    // path：桌面端中心服务专属页面路由。
    path: "/center-service",
    // label：顶部菜单展示文本。
    label: "中心服务",
  },
];

// navigate：统一处理侧边栏页面跳转。
function navigate(path: string): void {
  // push：桌面端所有页面都由路由模块管理。
  void router.push(path);
}

// onMounted：窗口打开后加载中心服务状态。
onMounted(() => {
  // loadCenterState：桌面端主进程会先尝试启动中心服务，这里同步 HTTP 业务状态。
  void appStore.loadCenterState();
});

// watch：中心服务连接错误不占用页面布局，统一通过 ElMessage 提示。
watch(
  () => appStore.errorMessage,
  (message) => {
    // missing：没有错误时不提示。
    if (!message) {
      return;
    }
    // duplicate：自动重连会重复产生同一错误，只提示一次。
    if (message === lastShownErrorMessage.value) {
      return;
    }
    // lastShownErrorMessage：记录本次已提示的错误。
    lastShownErrorMessage.value = message;
    // error：按用户要求使用 ElMessage，不使用 el-alert。
    ElMessage.error(message);
  },
);
</script>

<template>
  <main
    class="app-shell"
    :class="appStore.themeMode"
  >
    <section class="workspace">
      <header class="topbar">
        <nav class="top-menu">
          <el-button
            v-for="item in menuItems"
            :key="item.path"
            class="top-menu-item"
            :type="route.path === item.path ? 'primary' : 'default'"
            @click="navigate(item.path)"
          >
            <span>{{ item.label }}</span>
          </el-button>
        </nav>
        <el-tag
          :type="appStore.health ? 'success' : 'danger'"
          effect="plain"
        >
          {{ appStore.connectionText }}
        </el-tag>
        <div class="topbar-actions">
          <el-button
            :icon="appStore.themeMode === 'light' ? Moon : Sunny"
            circle
            :aria-label="appStore.themeMode === 'light' ? '切换到暗黑主题' : '切换到亮色主题'"
            @click="appStore.toggleTheme"
          />
        </div>
      </header>

      <router-view />
    </section>
  </main>
</template>
