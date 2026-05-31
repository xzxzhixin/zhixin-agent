<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";

import { useAppStore } from "./stores/app";

// appStore：统一前端状态入口。
const appStore = useAppStore();
// router：远程 Web 未登录时进入登录页。
const router = useRouter();

/**
 * onMounted：启动前端时判断是否需要远程登录。
 */
onMounted(async () => {
  appStore.applyTheme();

  if (appStore.runtime.capabilities.canUseRemoteLogin) {
    await router.push("/login");
    return;
  }

  await appStore.bootstrap();
});
</script>

<template>
  <router-view />
</template>
