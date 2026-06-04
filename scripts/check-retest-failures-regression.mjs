/**
 * 复测失败项静态回归检查。
 *
 * 用途：覆盖 T01 的中心目录元信息初始化和 T10 的工作台重复挂载风险。
 * 关键逻辑：检查生产源码是否创建并写入 meta.centerDirectory，同时确保工作台子页面不再额外输出桌面端 main。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// databasePath: 中心服务 SQLite 初始化源码。
const databasePath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "database.ts",
);
// workflowDomainPath: 模型网关源码，当前仍通过 meta 读取中心目录。
const workflowDomainPath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "model-gateway-runtime.ts",
);
// chatPagePath: 对话页路由入口源码。
const chatPagePath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "Chat",
  "RouterIndex.vue",
);
// mainViewPath: 公共工作台壳源码。
const mainViewPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "MainView.vue",
);
// appPath: 前端顶层宿主源码。
const appPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "App.vue",
);
// frontendMainPath: 前端挂载入口源码。
const frontendMainPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "main.ts",
);

const databaseSource = readFileSync(
  databasePath,
  "utf-8",
);
const workflowDomainSource = readFileSync(
  workflowDomainPath,
  "utf-8",
);
const chatPageSource = readFileSync(
  chatPagePath,
  "utf-8",
);
const mainViewSource = readFileSync(
  mainViewPath,
  "utf-8",
);
const appSource = readFileSync(
  appPath,
  "utf-8",
);
const frontendMainSource = readFileSync(
  frontendMainPath,
  "utf-8",
);

if (!workflowDomainSource.includes("SELECT value FROM meta WHERE key = ?")) {
  console.error("模型网关当前中心目录读取协议已变化，请同步更新本检查。");
  process.exitCode = 1;
}

if (!databaseSource.includes("CREATE TABLE IF NOT EXISTS meta")) {
  console.error("数据库初始化必须创建 meta 表，避免真实模型调用读取中心目录时报 no such table: meta。");
  process.exitCode = 1;
}

if (!/INSERT\s+INTO\s+meta\s*\(\s*key\s*,\s*value\s*,\s*updated_at\s*\)/u.test(databaseSource)) {
  console.error("数据库初始化必须写入 meta.centerDirectory，供模型网关读取中心目录。");
  process.exitCode = 1;
}

if (!databaseSource.includes("this.config.centerDirectory")) {
  console.error("meta.centerDirectory 必须来自当前中心服务启动配置，不能写死或猜测路径。");
  process.exitCode = 1;
}

if (!mainViewSource.includes("<main class=\"app-shell workspace-shell\">")) {
  console.error("公共工作台壳必须保留唯一桌面 main 容器。");
  process.exitCode = 1;
}

if (/<main\b/u.test(chatPageSource)) {
  console.error("Chat/RouterIndex.vue 作为工作台子页面不能输出额外 main，避免 /chat 重复渲染两套工作区。");
  process.exitCode = 1;
}

if (!chatPageSource.includes("chat-page-host")) {
  console.error("Chat/RouterIndex.vue 必须保留 chat-page-host 子页面容器。");
  process.exitCode = 1;
}

if (!appSource.includes("class=\"app-route-host\"") || !appSource.includes("<RouterView")) {
  console.error("App.vue 必须保留 app-route-host 和 RouterView。");
  process.exitCode = 1;
}

if (appSource.includes("hashchange") || appSource.includes("routeRenderVersion")) {
  console.error("App.vue 不能再用原生 hashchange 双重重建 RouterView，避免旧工作台实例残留。");
  process.exitCode = 1;
}

if (!appSource.includes("v-slot=\"{ Component, route: matchedRoute }\"")) {
  console.error("App.vue 必须通过 RouterView 插槽渲染命中组件。");
  process.exitCode = 1;
}

if (appSource.includes("<RouterView\n      :key=\"route.fullPath\"") || appSource.includes("<RouterView :key=\"route.fullPath\"")) {
  console.error("RouterView 自身不能绑定 route.fullPath key，避免 hash 直改时主体空白或旧实例残留。");
  process.exitCode = 1;
}

if (frontendMainSource.includes("mountElement.replaceChildren()")) {
  console.error("main.ts 不能在挂载前清空 #app，否则可能导致路由主体空白。");
  process.exitCode = 1;
}
