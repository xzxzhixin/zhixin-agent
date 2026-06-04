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
// routeRenderVersion：原生 hash 变化时递增，覆盖外部直接改 hash 后 Vue Router slot 复用旧主体的边界。
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

/**
 * refreshRouteRenderVersion：记录原生 hashchange 事件。
 *
 * @returns 更新渲染版本后没有返回值。
 */
function refreshRouteRenderVersion(): void {
  routeRenderVersion.value += 1;
}

onMounted(() => {
  window.addEventListener(
    "hashchange",
    refreshRouteRenderVersion,
  );
});

onBeforeUnmount(() => {
  window.removeEventListener(
    "hashchange",
    refreshRouteRenderVersion,
  );
});
</script>

<template>
  <RouterView
      v-slot="{ Component, route: matchedRoute }"
  >
    <section
        class="app-route-host"
        :key="`${matchedRoute.fullPath}:${routeRenderVersion}`"
        :data-route-path="matchedRoute.fullPath"
    >
      <!-- matchedRoute.fullPath：顶层主体重建事实源，由 Vue Router 单一路由状态驱动，避免原生地址监听额外残留实例。 -->
      <component
          :is="Component"
          v-if="Component"
          :key="`${matchedRoute.fullPath}:${routeRenderVersion}`"
      />
    </section>
  </RouterView>
</template>

<style scoped>
.app-route-host {
  display: contents;
}
</style>
