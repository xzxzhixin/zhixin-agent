/**
 * 前端主题能力检查。
 *
 * 用途：固定主题自动匹配、手动切换和跨客户端入口参数的实现要求。
 * 关键逻辑：静态检查运行时、状态、样式和 IDEA 插件 URL，避免主题入口再次丢失。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * readProjectFile：读取项目内文本文件。
 *
 * @param {string} pathInProject 项目相对路径。
 * @returns {string} 文件内容。
 */
function readProjectFile(pathInProject) {
  return readFileSync(
    join(
      process.cwd(),
      pathInProject,
    ),
    "utf-8",
  );
}

// runtimeSource: 前端运行时识别源码。
const runtimeSource = readProjectFile("apps/frontend/src/runtime.ts");
// storeSource: Pinia 状态源码。
const storeSource = readProjectFile("apps/frontend/src/stores/app.ts");
// mainViewSource: 主工作台页面源码。
const mainViewSource = readProjectFile("apps/frontend/src/views/MainView.vue");
// loginViewSource: 远程 Web 登录页面源码。
const loginViewSource = readProjectFile("apps/frontend/src/views/LoginView.vue");
// appSource: Vue 根组件源码。
const appSource = readProjectFile("apps/frontend/src/App.vue");
// stylesSource: 全局样式源码。
const stylesSource = readProjectFile("apps/frontend/src/styles.css");
// ideaBridgeSource: IDEA 插件页面 URL 桥接源码。
const ideaBridgeSource = readProjectFile("plugins/idea/src/main/java/top/xzxsrq/agent/ZhixinPluginBridge.java");

if (!runtimeSource.includes("preferredTheme")) {
  console.error("运行时环境必须提供 preferredTheme，用于各客户端默认主题。");
  process.exitCode = 1;
}

if (!runtimeSource.includes("theme") || !runtimeSource.includes("prefers-color-scheme")) {
  console.error("运行时主题必须支持 IDE theme 参数和浏览器/桌面系统 prefers-color-scheme。");
  process.exitCode = 1;
}

if (!storeSource.includes("themeMode") || !storeSource.includes("applyTheme") || !storeSource.includes("toggleTheme")) {
  console.error("前端状态必须保存 themeMode，并提供 applyTheme 与 toggleTheme。");
  process.exitCode = 1;
}

if (!storeSource.includes("localStorage") || !storeSource.includes("zhixin.theme")) {
  console.error("用户手动主题选择必须按客户端保存在 localStorage 中。");
  process.exitCode = 1;
}

if (!appSource.includes("appStore.applyTheme()")) {
  console.error("应用启动时必须先应用主题，避免打开页面时主题闪烁或不匹配。");
  process.exitCode = 1;
}

if (
  !mainViewSource.includes("theme-toggle")
  || !mainViewSource.includes("mobile-theme-toggle")
  || !mainViewSource.includes("chat-theme-toggle")
  || !mainViewSource.includes("toggleTheme")
) {
  console.error("主工作台、移动入口和插件紧凑入口必须提供主题切换入口。");
  process.exitCode = 1;
}

if (!loginViewSource.includes("login-theme-toggle") || !loginViewSource.includes("toggleTheme")) {
  console.error("远程 Web 登录页必须提供主题切换入口。");
  process.exitCode = 1;
}

if (!stylesSource.includes("[data-theme=\"dark\"]") || !stylesSource.includes("[data-theme=\"light\"]")) {
  console.error("全局样式必须分别声明 light 和 dark 主题变量。");
  process.exitCode = 1;
}

if (!ideaBridgeSource.includes("theme=") || !ideaBridgeSource.includes("LafManager") || !ideaBridgeSource.includes("getMethod(\"isDark\")")) {
  console.error("IDEA 插件加载 plugin.html 时必须传入宿主主题参数。");
  process.exitCode = 1;
}
