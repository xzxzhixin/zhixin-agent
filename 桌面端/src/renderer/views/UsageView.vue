<script setup lang="ts">
import { onMounted } from "vue";
import { useAppStore } from "../stores/app";

// appStore：用量统计来自中心服务聚合结果。
const appStore = useAppStore();

// onMounted：进入用量统计页面时才读取聚合数据，避免每次全局状态刷新都解析完整用量文件。
onMounted(() => {
  // loadUsageSummary：统计数据按需加载，降低中心服务常驻内存压力。
  void appStore.loadUsageSummary().catch(() => {
    // ignore：中心服务未连接时由全局连接状态提示，这里不额外制造未处理异常。
  });
});
</script>

<template>
  <section class="page-panel">
    <header class="page-header">
      <div>
        <h1>用量统计</h1>
        <p>按供应商、模型和项目汇总模型调用 token、缓存和调用结果。</p>
      </div>
    </header>

    <section class="page-scroll">
      <el-empty
        v-if="appStore.usageSummary.length === 0"
        description="暂无用量统计"
      />
      <el-table
        v-else
        :data="appStore.usageSummary"
        border
      >
        <el-table-column
          prop="providerName"
          label="供应商"
        />
        <el-table-column
          prop="model"
          label="模型"
        />
        <el-table-column
          prop="projectId"
          label="项目"
        />
        <el-table-column
          prop="inputTokens"
          label="输入 Token"
          width="120"
        />
        <el-table-column
          prop="outputTokens"
          label="输出 Token"
          width="120"
        />
        <el-table-column
          prop="totalTokens"
          label="总 Token"
          width="110"
        />
        <el-table-column
          prop="successCount"
          label="成功"
          width="90"
        />
        <el-table-column
          prop="failureCount"
          label="失败"
          width="90"
        />
      </el-table>
    </section>
  </section>
</template>
