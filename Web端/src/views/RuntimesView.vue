<script setup lang="ts">
import { useAppStore } from "../stores/app";

// appStore：运行环境列表来自中心服务唯一事实源。
const appStore = useAppStore();
</script>

<template>
  <section class="page-panel">
    <header class="page-header">
      <div>
        <h1>运行环境</h1>
        <p>运行环境选择只影响后续插件、MCP、skill 和命令任务。</p>
      </div>
      <el-button type="primary">
        新增环境
      </el-button>
    </header>

    <section class="page-scroll">
      <el-table
        :data="appStore.runtimes"
        border
      >
        <el-table-column
          prop="name"
          label="名称"
        />
        <el-table-column
          prop="type"
          label="类型"
          width="110"
        />
        <el-table-column
          prop="executablePath"
          label="可执行文件"
        />
        <el-table-column
          prop="version"
          label="版本"
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
