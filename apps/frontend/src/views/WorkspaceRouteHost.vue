<script setup lang="ts">
import {
  computed,
} from "vue";
import {
  RouterView,
  useRoute,
} from "vue-router";

// route：当前 Vue Router 路由对象，是工作台主体页面的唯一事实源。
const route = useRoute();
// routeHostKey：二级主体重建 key，直接绑定完整路由，避免桌面端 hash 已变但旧页面实例残留。
const routeHostKey = computed(() => route.fullPath);
// activePageName：当前工作台页面名称，只用于测试和桌面可观测属性，不参与业务协议。
const activePageName = computed(() => {
  const pagePath = route.path.replace(/^\/+/u, "");
  return pagePath.length > 0 ? pagePath : "chat";
});
</script>

<template>
  <RouterView v-slot="{ Component, route: matchedRoute }">
    <section
        class="workspace-route-host"
        :key="routeHostKey"
        :data-active-page="activePageName"
        :data-route-path="matchedRoute.fullPath"
    >
      <!-- routeHostKey：完整路由变化时强制重建命中页面，防止 Electron WebContents 复用旧主体。 -->
      <component
          :is="Component"
          v-if="Component"
          :key="routeHostKey"
      />
    </section>
  </RouterView>
</template>

<style scoped>
.workspace-route-host {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
</style>
