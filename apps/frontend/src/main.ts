import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "github-markdown-css/github-markdown.css";
import "vant/lib/index.css";
import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import Vant from "vant";

import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

// app：统一前端 Vue 应用入口，index.html 和 plugin.html 共用。
const app = createApp(App);
// pinia：只保存客户端 UI 状态和订阅状态，不作为核心事实源。
const pinia = createPinia();

app.use(pinia);
app.use(ElementPlus);
app.use(Vant);
app.use(router);

/**
 * mountApplication：等待 Vue Router 完成初始 hash 解析后再挂载。
 *
 * @returns 挂载完成后没有返回值。
 */
async function mountApplication(): Promise<void> {
  await router.isReady();
  app.mount("#app");
}

void mountApplication();
