<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";

// appStore：网络代理列表来自中心服务唯一事实源。
const appStore = useAppStore();

// defaultProxyName：当前全局默认代理名称。
const defaultProxyName = computed(() => {
  // proxy：只把启用且 default 为 true 的代理视为全局默认代理。
  const proxy = appStore.proxies.find((item) => item.enabled && item.default);
  // return：未配置时明确展示未设置。
  return proxy?.name ?? "未设置";
});
</script>

<template>
  <section class="page-panel">
    <header class="page-header">
      <div>
        <h1>网络代理</h1>
        <p>Web端可管理代理配置，但不会读取认证明文。</p>
      </div>
      <el-button type="primary">
        新增代理
      </el-button>
    </header>

    <p class="page-inline-tip">
      全局默认代理：{{ defaultProxyName }}
    </p>

    <section class="page-scroll">
      <el-empty
        v-if="appStore.proxies.length === 0"
        description="暂无网络代理"
      />
      <el-table
        v-else
        :data="appStore.proxies"
        border
      >
        <el-table-column
          prop="name"
          label="名称"
        />
        <el-table-column
          prop="protocol"
          label="协议"
          width="110"
        />
        <el-table-column
          prop="host"
          label="主机"
        />
        <el-table-column
          prop="port"
          label="端口"
          width="100"
        />
        <el-table-column
          prop="default"
          label="默认"
          width="90"
        />
        <el-table-column
          prop="enabled"
          label="启用"
          width="90"
        />
      </el-table>
    </section>
  </section>
</template>
