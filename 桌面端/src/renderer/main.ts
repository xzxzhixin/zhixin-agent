import "element-plus/dist/index.css";
import "github-markdown-css/github-markdown.css";
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

// app：桌面端渲染层 Vue 应用入口。
const app = createApp(App);
// pinia：桌面端公共状态容器。
const pinia = createPinia();

// use：注册 Pinia，保存主题、连接、会话、项目、通知和执行模式。
app.use(pinia);
// use：注册 Vue Router，统一管理多页面入口和跳转。
app.use(router);

// mount：挂载到 Electron BrowserWindow 加载的 HTML。
app.mount("#app");
