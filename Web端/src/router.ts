import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";
import { useAppStore } from "./stores/app";

// isMobileBrowser：用视口宽度判断手机浏览器入口，避免把桌面复杂表格塞进小屏。
const isMobileBrowser = window.matchMedia("(max-width: 720px)").matches;

// routes：Web端页面级入口和权限边界声明。
const routes: RouteRecordRaw[] = [
  {
    // path：非本机访问登录页。
    path: "/login",
    // name：登录路由名。
    name: "login",
    // component：登录组件按路由懒加载。
    component: () => import("./views/LoginView.vue"),
    // meta：登录页不需要登录态。
    meta: {
      requiresAuth: false,
    },
  },
  {
    // path：网络代理管理页面。
    path: "/proxies",
    // name：网络代理路由名。
    name: "proxies",
    // component：桌面浏览器网络代理管理组件按路由懒加载。
    component: () => import("./views/ProxiesView.vue"),
    // meta：非本机访问需要登录态。
    meta: {
      requiresAuth: true,
    },
  },
  {
    // path：首页按设备选择桌面或手机页面组件。
    path: "/",
    // name：首页路由名。
    name: "home",
    // component：手机浏览器使用 Vant 适配页，桌面浏览器使用 Element Plus 页面，二者都按路由懒加载。
    component: () =>
      isMobileBrowser
        ? import("./views/MobileHomeView.vue")
        : import("./views/HomeView.vue"),
    // meta：非本机访问需要登录态。
    meta: {
      requiresAuth: true,
    },
  },
  {
    // path：供应商管理页面。
    path: "/providers",
    // name：供应商路由名。
    name: "providers",
    // component：桌面浏览器供应商管理组件按路由懒加载。
    component: () => import("./views/ProvidersView.vue"),
    // meta：非本机访问需要登录态。
    meta: {
      requiresAuth: true,
    },
  },
  {
    // path：运行环境管理页面。
    path: "/runtimes",
    // name：运行环境路由名。
    name: "runtimes",
    // component：运行环境管理组件按路由懒加载。
    component: () => import("./views/RuntimesView.vue"),
    // meta：非本机访问需要登录态。
    meta: {
      requiresAuth: true,
    },
  },
];

// router：Web端使用 hash 路由，兼容静态部署和中心服务承载。
export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// beforeEach：访问控制由中心服务判定，前端不通过 hostname 或 sessionStorage 自行授权。
router.beforeEach(async (to) => {
  // appStore：读取中心服务认证状态。
  const appStore = useAppStore();
  // loginRoute：登录页自身允许在中心服务不可用时展示错误信息。
  const loginRoute = to.name === "login";
  try {
    // authStatus：中心服务根据请求来源和 Cookie 返回认证结果。
    const authStatus = await appStore.refreshAuthStatus();
    // redirectHome：已经具备访问权限时不再停留登录页。
    if (loginRoute && authStatus.authenticated) {
      return "/";
    }
    // redirectLogin：需要认证的页面必须等待中心服务确认已授权。
    if (to.meta.requiresAuth && !authStatus.authenticated) {
      return "/login";
    }
  } catch (error) {
    // fallback：中心服务不可用时，受保护页面回到登录页展示连接失败。
    if (!loginRoute && to.meta.requiresAuth) {
      return "/login";
    }
  }
  // allow：公开页面或已授权页面正常进入。
  return true;
});
