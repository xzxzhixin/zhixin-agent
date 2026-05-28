<script setup lang="ts">
import { useAppStore } from "../stores/app";

// appStore：供应商列表来自中心服务唯一事实源。
const appStore = useAppStore();
</script>

<template>
  <section class="page-panel">
    <header class="page-header">
      <div>
        <h1>供应商</h1>
        <p>API Key 只保存在中心电脑，客户端只展示是否已保存。</p>
      </div>
      <el-button type="primary">
        新增供应商
      </el-button>
    </header>

    <el-empty
      v-if="appStore.providers.length === 0"
      description="暂无供应商"
    />
    <el-table
      v-else
      :data="appStore.providers"
      border
    >
      <el-table-column
        prop="name"
        label="名称"
      />
      <el-table-column
        prop="type"
        label="类型"
      />
      <el-table-column
        prop="baseUrl"
        label="接口地址"
      />
      <el-table-column
        prop="defaultModel"
        label="默认模型"
      />
      <el-table-column
        prop="defaultReasoningDepth"
        label="默认推理深度"
      />
      <el-table-column
        prop="proxyMode"
        label="代理策略"
        width="120"
      />
      <el-table-column
        prop="apiKeyStored"
        label="密钥已保存"
        width="120"
      />
      <el-table-column
        prop="enabled"
        label="启用"
        width="90"
      />
    </el-table>
  </section>
</template>
