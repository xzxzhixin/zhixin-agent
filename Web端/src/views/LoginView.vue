<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app";

// appStore：登录成功后写入 Web 登录态。
const appStore = useAppStore();
// router：登录成功后进入主界面。
const router = useRouter();
// form：非本机访问时输入的账号密码。
const form = reactive({
  // account：桌面端配置的 Web 访问账号。
  account: "",
  // password：桌面端配置的 Web 访问密码。
  password: "",
});
// loading：登录请求状态。
const loading = ref(false);
// errorMessage：登录失败原因。
const errorMessage = ref("");

// submitRemoteLogin：提交非本机访问登录。
async function submitRemoteLogin(): Promise<void> {
  // loading：进入登录请求态。
  loading.value = true;
  // errorMessage：清理旧错误。
  errorMessage.value = "";
  try {
    // login：中心服务校验账号密码并签发登录态。
    await appStore.login({
      account: form.account,
      password: form.password,
    });
    // push：登录成功后进入 Web 主界面。
    await router.push("/");
  } catch (error) {
    // message：展示登录失败或中心服务不可用原因。
    errorMessage.value = error instanceof Error ? error.message : "登录失败";
  } finally {
    // loading：结束登录请求态。
    loading.value = false;
  }
}
</script>

<template>
  <main class="app-shell">
    <section class="login-panel">
      <img
        src="/图标.png"
        alt="致心智能体图标"
        class="login-icon"
      />
      <h1>致心智能体</h1>
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
      <el-alert
        v-if="errorMessage"
        type="warning"
        :title="errorMessage"
        show-icon
      />
    </section>
  </main>
</template>
