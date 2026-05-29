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
        <p>Web端可管理供应商配置，但不会读取 API Key 明文。</p>
      </div>
      <el-button type="primary">
        新增供应商
      </el-button>
    </header>

    <section class="page-scroll">
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
          prop="enabled"
          label="启用"
          width="90"
        />
      </el-table>
    </section>
  </section>
</template>
