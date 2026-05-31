<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

import { useAppStore } from "../stores/app";

// appStore：登录成功后保存中心服务授权结果。
const appStore = useAppStore();
// router：登录成功后回到主工作台。
const router = useRouter();
// form：远程 Web 登录表单。
const form = reactive({
  // account：桌面壳配置的远程访问账号。
  account: "",
  // password：桌面壳配置的远程访问密码。
  password: "",
});
// loading：登录请求状态。
const loading = ref(false);

/**
 * submitRemoteLogin：提交远程 Web 登录。
 *
 * @returns 登录完成后没有返回值。
 */
async function submitRemoteLogin(): Promise<void> {
  loading.value = true;
  try {
    await appStore.login({
      account: form.account,
      password: form.password,
    });
    await appStore.bootstrap();
    await router.push("/");
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : "登录失败");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-shell">
    <section class="login-panel">
      <header class="login-header">
        <h1>致心智能体</h1>
        <button
          class="theme-toggle login-theme-toggle"
          type="button"
          :title="appStore.themeMode === 'dark' ? '切换亮色主题' : '切换暗黑主题'"
          @click="appStore.toggleTheme"
        >
          {{ appStore.themeMode === "dark" ? "亮色" : "暗黑" }}
        </button>
      </header>
      <el-form
        label-position="top"
        @submit.prevent="submitRemoteLogin"
      >
        <el-form-item label="账号">
          <el-input
            v-model="form.account"
            autocomplete="username"
          />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            show-password
          />
        </el-form-item>
        <el-button
          type="primary"
          native-type="submit"
          :loading="loading"
        >
          登录
        </el-button>
      </el-form>
    </section>
  </main>
</template>
