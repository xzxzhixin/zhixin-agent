<script setup lang="ts">
import { ref } from "vue";
import { useAppStore } from "../stores/app";

// appStore：手机浏览器读取同一份中心服务状态。
const appStore = useAppStore();
// inputText：手机端对话输入文本。
const inputText = ref("");
</script>

<template>
  <main class="mobile-shell">
    <van-nav-bar
      title="致心智能体"
      :border="false"
    />

    <van-cell-group inset>
      <van-cell
        title="中心服务"
        :value="appStore.health ? '已连接' : '未连接'"
      />
      <van-cell
        title="执行模式"
        :value="appStore.executionMode"
      />
      <van-cell
        title="启用供应商"
        :value="`${appStore.enabledProviderCount} 个`"
      />
      <van-cell
        title="网络代理"
        :value="`${appStore.proxies.length} 个`"
      />
    </van-cell-group>

    <section class="mobile-message-list">
      <van-cell
        title="致心"
        label="手机浏览器使用 Vant 组件适配小屏交互。"
      />
      <van-empty
        v-if="appStore.sessions.length === 0"
        description="暂无会话"
      />
      <van-cell
        v-for="session in appStore.sessions"
        :key="session.id"
        :title="session.title"
        :label="session.type"
      />
    </section>

    <footer class="mobile-composer">
      <van-field
        v-model="inputText"
        rows="2"
        autosize
        type="textarea"
        placeholder="输入消息"
      />
      <van-button
        type="primary"
        block
      >
        发送
      </van-button>
    </footer>
  </main>
</template>
