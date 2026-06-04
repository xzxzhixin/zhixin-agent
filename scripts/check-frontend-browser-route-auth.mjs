/**
 * 浏览器授权与直达路由回归检查。
 *
 * 用途：覆盖本机已授权时直接访问 /login 或 /chat 后，URL 与主体页面必须一致。
 * 关键逻辑：只检查前端入口、路由和登录页的结构约定，不运行 TypeScript 编译器。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * readProjectFile：读取仓库内文件。
 *
 * @param relativePath 仓库根目录下的相对路径。
 * @returns 文件 UTF-8 文本。
 */
function readProjectFile(relativePath) {
  return readFileSync(
    join(
      process.cwd(),
      relativePath,
    ),
    "utf-8",
  );
}

// appSource：前端根组件源码，负责按运行时授权入口决定初始跳转。
const appSource = readProjectFile("apps/frontend/src/App.vue");
// mainSource：前端挂载入口源码，负责等待 Vue Router 完成初始 hash 同步后再挂载。
const mainSource = readProjectFile("apps/frontend/src/main.ts");
// routerSource：前端路由源码，负责 hash URL 与工作台主体匹配。
const routerSource = readProjectFile("apps/frontend/src/router.ts");
// loginSource：登录页源码，本机直达登录页时必须能主动回到工作台。
const loginSource = readProjectFile("apps/frontend/src/views/Login/RouterIndex.vue");
// centerSource：中心服务页面源码，桌面状态读取失败会打断旧主体卸载和新主体挂载。
const centerSource = readProjectFile("apps/frontend/src/views/Center/RouterIndex.vue");
// storeSource：统一前端状态源码，中心服务页只能调用这里真实存在的 action。
const storeSource = readProjectFile("apps/frontend/src/stores/app.ts");

if (!appSource.includes("route.path === \"/login\"")
    || !appSource.includes("await router.replace(\"/chat\")")) {
  console.error("本机已授权入口直接访问 /login 时，App 必须把 URL 和主体一起替换到 /chat。");
  process.exitCode = 1;
}

if (appSource.includes("await router.push(\"/login\")")) {
  console.error("远程未登录入口跳转登录页必须使用 replace，避免登录页和工作台历史栈造成 URL 与主体不同步。");
  process.exitCode = 1;
}

if (!appSource.includes("useRoute")) {
  console.error("App 必须读取当前 route.path，按直达 URL 决定授权后的落点。");
  process.exitCode = 1;
}

if (!(appSource.includes("<router-view") || appSource.includes("<RouterView"))
    || !appSource.includes("v-slot=\"{ Component, route: matchedRoute }\"")
    || !appSource.includes(":is=\"Component\"")
    || !appSource.includes("`${matchedRoute.fullPath}:${routeRenderVersion}`")) {
  console.error("App 顶层 router-view 必须 key 到当前命中组件的 fullPath 和渲染版本，避免 hash 已变化但旧顶层主体残留。");
  process.exitCode = 1;
}

if (!appSource.includes("routeRenderVersion")
    || !appSource.includes("hashchange")) {
  console.error("App 顶层 router-view 必须使用 routeRenderVersion 监听原生 hashchange，避免 RouterView 渲染层停留在旧主体。");
  process.exitCode = 1;
}

if (!appSource.includes("watch(")
    || !appSource.includes("route.fullPath")
    || !appSource.includes("appStore.runtime.capabilities.canUseRemoteLogin")) {
  console.error("App 授权入口同步不能只在 mounted 执行，必须 watch 当前路由和远程登录能力变化。");
  process.exitCode = 1;
}

if (!appSource.includes("hashchange")
    || !appSource.includes("routeRenderVersion")
    || !appSource.includes("onBeforeUnmount")) {
  console.error("App 必须监听原生 hashchange 并更新本地渲染版本，覆盖外部修改 hash 时 URL 已变但 Vue 主体未重绘的场景。");
  process.exitCode = 1;
}

if (!mainSource.includes("await router.isReady()")
    || mainSource.indexOf("await router.isReady()") > mainSource.indexOf("app.mount(\"#app\")")) {
  console.error("前端挂载前必须等待 router.isReady()，确保初始 hash 与顶层 router-view 同步后再渲染主体。");
  process.exitCode = 1;
}

if (!loginSource.includes("if (!appStore.runtime.capabilities.canUseRemoteLogin)")
    || !loginSource.includes("router.replace(\"/chat\")")) {
  console.error("Login 页面自身必须阻止本机授权状态显示登录主体，避免直接打开 /login 时看到错误页面。");
  process.exitCode = 1;
}

if (!storeSource.includes("async syncDesktopStatus(): Promise<void>")) {
  console.error("App store 必须提供 syncDesktopStatus action，供桌面壳中心服务页同步本机状态。");
  process.exitCode = 1;
}

if (!centerSource.includes("appStore.syncDesktopStatus()")
    || centerSource.includes("appStore.loadDesktopStatus()")) {
  console.error("中心服务页必须调用现有 syncDesktopStatus action，不能调用不存在的 loadDesktopStatus 导致 mounted hook 抛错。");
  process.exitCode = 1;
}

const absoluteWorkspaceChildRoute = /children:\s*\[[\s\S]*path:\s*"\/(?:chat|agent-management|providers|proxies|runtimes|usage|plugins|mcp|skills|center)"/u;
if (absoluteWorkspaceChildRoute.test(routerSource)) {
  console.error("工作台 children 路由不能使用绝对子路径，否则直接导航时容易出现 URL 与父壳主体匹配不稳定。");
  process.exitCode = 1;
}

const rootRouteCount = Array.from(routerSource.matchAll(/path:\s*"\/"/gu)).length;
if (rootRouteCount !== 1 || !routerSource.includes("redirect: \"/chat\"")) {
  console.error("根路由只能保留一个 path 为 / 的工作台父记录，并在该记录上 redirect 到 /chat，避免重复根记录干扰 RouterView 深度。");
  process.exitCode = 1;
}

const requiredWorkspaceChildRoutes = [
  "chat",
  "agent-management",
  "providers",
  "proxies",
  "runtimes",
  "usage",
  "plugins",
  "mcp",
  "skills",
  "center",
];

for (const routePath of requiredWorkspaceChildRoutes) {
  if (!routerSource.includes(`path: "${routePath}"`)) {
    console.error(`工作台子路由 ${routePath} 必须使用相对子路径注册。`);
    process.exitCode = 1;
  }
}

// mainViewSource：公共工作台壳源码，必须把页面主体完全交给 Vue Router 的命中组件。
const mainViewSource = readProjectFile("apps/frontend/src/views/MainView.vue");
// routeHostSource：工作台二级路由出口源码，独立监听路由并渲染命中页面。
const routeHostSource = readProjectFile("apps/frontend/src/views/WorkspaceRouteHost.vue");

if (!mainViewSource.includes("import WorkspaceRouteHost from \"@views/WorkspaceRouteHost.vue\"")
    || !mainViewSource.includes("<WorkspaceRouteHost/>")) {
  console.error("MainView 只能挂载独立 WorkspaceRouteHost，不能把二级 router-view 和菜单状态混在同一个更新周期里。");
  process.exitCode = 1;
}

if (!mainViewSource.includes("appStore.runtime.capabilities.canManageCenterService")
    || !mainViewSource.includes("window.location.reload()")) {
  console.error("桌面壳菜单切换必须在 Electron 能力下提供轻量重载兜底，避免 hash 已变但二级主体残留。");
  process.exitCode = 1;
}

if (!routeHostSource.includes("<RouterView v-slot=\"{ Component, route: matchedRoute }\">")
    || !routeHostSource.includes(":key=\"routeHostKey\"")
    || !routeHostSource.includes(":data-active-page=\"activePageName\"")
    || !routeHostSource.includes(":data-route-path=\"matchedRoute.fullPath\"")
    || !routeHostSource.includes(":is=\"Component\"")) {
  console.error("WorkspaceRouteHost 必须独立使用 RouterView slot、routeHostKey 和可观测属性渲染命中页面。");
  process.exitCode = 1;
}

if (mainViewSource.includes("<router-view :key=\"route.fullPath\"/>")
    || mainViewSource.includes("<router-view :key=\"route.fullPath\" />")) {
  console.error("工作台主体不能只给 router-view 自身加 key；必须 key 到命中页面组件，确保 hash 直达和顶部菜单切换时主体跟随 route 重建。");
  process.exitCode = 1;
}

const workspaceSlotStart = mainViewSource.indexOf("<section class=\"workspace-slot\">");
const workspaceSlotEnd = mainViewSource.indexOf("</section>", workspaceSlotStart);
const workspaceSlotSource = workspaceSlotStart >= 0 && workspaceSlotEnd >= 0
  ? mainViewSource.slice(
    workspaceSlotStart,
    workspaceSlotEnd,
  )
  : "";
if (workspaceSlotSource.includes("activePage")
    || workspaceSlotSource.includes("currentWorkspacePage")
    || workspaceSlotSource.includes("initialPage")) {
  console.error("工作台主体区域不能读取本地页面状态，页面事实源只能是 Vue Router 当前命中的 route/router-view。");
  process.exitCode = 1;
}
