<script setup lang="ts">
import {
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  useRoute,
  useRouter,
} from "vue-router";

import { useAppStore } from "./stores/app";

// appStore：统一前端状态入口。
const appStore = useAppStore();
// route：读取直达 URL，避免本机授权后仍停留在登录页主体。
const route = useRoute();
// router：远程 Web 未登录时进入登录页。
const router = useRouter();
// bootstrapped：本机或桌面壳入口只初始化一次，避免每次 hash 切换都重复拉取中心服务数据。
const bootstrapped = ref(false);
// authorizationSyncing：授权路由同步互斥标记，避免快速 hash 切换时多个 replace 并发覆盖结果。
const authorizationSyncing = ref(false);
// routeRenderVersion：原生 hashchange 驱动的渲染版本，覆盖外部直接改 hash 时 Vue RouterView 不重绘的边界。
const routeRenderVersion = ref(0);

/**
 * syncAuthorizationRoute：同步当前授权模式和顶层路由主体。
 *
 * @returns 同步完成后没有返回值。
 */
async function syncAuthorizationRoute(): Promise<void> {
  if (authorizationSyncing.value) {
    return;
  }

  authorizationSyncing.value = true;
  appStore.applyTheme();

  try {
    if (appStore.runtime.capabilities.canUseRemoteLogin) {
      if (route.path !== "/login") {
        await router.replace("/login");
      }
      return;
    }

    if (!bootstrapped.value) {
      await appStore.bootstrap();
      bootstrapped.value = true;
    }

    if (route.path === "/login") {
      await router.replace("/chat");
    }
  } finally {
    authorizationSyncing.value = false;
  }
}

/**
 * handleNativeHashChange：桥接浏览器原生 hashchange 到顶层渲染 key。
 *
 * @returns 没有返回值。
 */
function handleNativeHashChange(): void {
  routeRenderVersion.value += 1;
}

watch(
  () => [
    route.fullPath,
    appStore.runtime.capabilities.canUseRemoteLogin,
  ],
  () => {
    void syncAuthorizationRoute();
  },
  {
    immediate: true,
  },
);

onMounted(() => {
  window.addEventListener(
    "hashchange",
    handleNativeHashChange,
  );
});

onBeforeUnmount(() => {
  window.removeEventListener(
    "hashchange",
    handleNativeHashChange,
  );
});
</script>

<template>
  <router-view
      :key="route.fullPath"
      v-slot="{ Component, route: matchedRoute }"
  >
    <section
        class="app-route-host"
        :key="`${matchedRoute.fullPath}:${routeRenderVersion}`"
        :data-route-path="matchedRoute.fullPath"
    >
      <!-- matchedRoute.fullPath：顶层主体重建事实源，防止 hash 已变但旧工作台或登录主体残留。 -->
      <component
          :is="Component"
          v-if="Component"
          :key="matchedRoute.fullPath"
      />
    </section>
  </router-view>
</template>

<style scoped>
.app-route-host {
  display: contents;
}
</style>
