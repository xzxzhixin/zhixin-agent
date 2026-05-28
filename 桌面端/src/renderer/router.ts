import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";

// routes：桌面端页面级入口和权限边界声明。
const routes: RouteRecordRaw[] = [
  {
    // path：首页承载普通对话和工程对话。
    path: "/",
    // name：路由名称用于导航定位。
    name: "home",
    // component：首页组件按路由懒加载。
    component: () => import("./views/HomeView.vue"),
    // meta：本地桌面端页面，不需要 Web 登录。
    meta: {
      requiresAuth: false,
    },
  },
  {
    // path：网络代理管理页面。
    path: "/proxies",
    // name：网络代理路由名。
    name: "proxies",
    // component：网络代理管理组件按路由懒加载。
    component: () => import("./views/ProxiesView.vue"),
    // meta：代理账号密码属于敏感信息，只能通过中心服务保存。
    meta: {
      requiresCenter: true,
    },
  },
  {
    // path：供应商管理页面。
    path: "/providers",
    // name：供应商管理路由名。
    name: "providers",
    // component：供应商管理组件按路由懒加载。
    component: () => import("./views/ProvidersView.vue"),
    // meta：供应商涉及 API Key 管理，只能通过中心服务保存敏感信息。
    meta: {
      requiresCenter: true,
    },
  },
  {
    // path：运行环境管理页面。
    path: "/runtimes",
    // name：运行环境路由名。
    name: "runtimes",
    // component：运行环境管理组件按路由懒加载。
    component: () => import("./views/RuntimesView.vue"),
    // meta：运行环境影响后续任务执行。
    meta: {
      requiresCenter: true,
    },
  },
  {
    // path：桌面端本机设置页面。
    path: "/settings",
    // name：设置路由名。
    name: "settings",
    // component：设置页面组件按路由懒加载。
    component: () => import("./views/SettingsView.vue"),
    // meta：设置页管理中心服务端口、目录、账号密码和通知权限。
    meta: {
      requiresCenter: true,
    },
  },
];

// router：桌面端使用 hash 路由，避免 Electron 刷新时需要服务端回退。
export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
