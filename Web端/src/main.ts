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

// app：Web端 Vue 应用入口，手机浏览器和桌面浏览器共用。
const app = createApp(App);
// pinia：Web端公共状态容器。
const pinia = createPinia();

// use：注册 Pinia，保存主题、连接、会话、项目、登录态、通知和执行模式。
app.use(pinia);
// use：注册 Element Plus，桌面浏览器页面中的 el-* 组件依赖全局插件解析。
app.use(ElementPlus);
// use：注册 Vant，手机浏览器适配页面中的 van-* 组件依赖全局插件解析。
app.use(Vant);
// use：注册 Vue Router，统一管理多页面入口和跳转。
app.use(router);

// mount：挂载到 index.html 中的根节点。
app.mount("#app");
