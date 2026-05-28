<script setup lang="ts">
import { ChatDotRound, Connection, Cpu, Key, Moon, Sunny } from "@element-plus/icons-vue";
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "./stores/app";

// appStore：Web端公共状态，来自 Pinia。
const appStore = useAppStore();
// router：页面跳转统一通过 Vue Router。
const router = useRouter();
// route：读取当前页面用于菜单高亮。
const route = useRoute();

// isLoginPage：登录页不展示主框架。
const isLoginPage = computed(() => route.path === "/login");

// navigate：统一处理侧边栏页面跳转。
function navigate(path: string): void {
  // push：Web端所有页面都由路由模块管理。
  void router.push(path);
}

// onMounted：页面加载后读取中心服务状态。
onMounted(() => {
  // login：登录页不主动请求中心业务状态。
  if (!isLoginPage.value) {
    void appStore.loadCenterState();
  }
});
</script>

<template>
  <router-view v-if="isLoginPage" />

  <main
    v-else
    class="app-shell"
    :class="appStore.themeMode"
  >
    <aside class="sidebar">
      <div class="brand-row">
        <img
          src="/图标.png"
          alt="致心智能体图标"
          class="brand-icon"
        />
        <div>
          <strong>致心智能体</strong>
          <span>Web端</span>
        </div>
      </div>

      <el-menu
        :default-active="route.path"
        class="nav-menu"
        @select="navigate"
      >
        <el-menu-item index="/">
          <el-icon><ChatDotRound /></el-icon>
          <span>对话</span>
        </el-menu-item>
        <el-menu-item index="/providers">
          <el-icon><Key /></el-icon>
          <span>供应商</span>
        </el-menu-item>
        <el-menu-item index="/proxies">
          <el-icon><Connection /></el-icon>
          <span>网络代理</span>
        </el-menu-item>
        <el-menu-item index="/runtimes">
          <el-icon><Cpu /></el-icon>
          <span>运行环境</span>
        </el-menu-item>
      </el-menu>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <el-tag
          :type="appStore.health ? 'success' : 'danger'"
          effect="plain"
        >
          {{ appStore.connectionText }}
        </el-tag>
        <div class="topbar-actions">
          <el-tag effect="plain">
            执行模式：{{ appStore.executionMode }}
          </el-tag>
          <el-button
            :icon="appStore.themeMode === 'light' ? Moon : Sunny"
            circle
            @click="appStore.toggleTheme"
          />
          <el-button
            type="primary"
            :loading="appStore.loading"
            @click="appStore.loadCenterState"
          >
            刷新
          </el-button>
        </div>
      </header>

      <el-alert
        v-if="appStore.errorMessage"
        type="error"
        :title="appStore.errorMessage"
        show-icon
      />

      <router-view />
    </section>
  </main>
</template>
