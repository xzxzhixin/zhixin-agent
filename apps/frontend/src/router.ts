import {
  createRouter,
  createWebHashHistory,
} from "vue-router";

// mainViewRoute: 主工作台页面路由组件。
// 这里必须使用动态导入，避免 workspace 页面代码进入主入口文件。
const mainViewRoute = () => import("./views/MainView.vue");

// loginViewRoute: 远程 Web 登录页面路由组件。
// 登录页同样懒加载，保证非登录场景不把登录页代码塞进首屏主文件。
const loginViewRoute = () => import("./views/LoginView.vue");

/**
 * router：统一前端路由。
 *
 * 用途：主入口、远程登录和插件入口共用同一个路由实例。
 * 关键逻辑：布局差异由运行时 entryMode 控制，不拆多个业务应用。
 */
export const router = createRouter({
  // history：桌面壳会通过 file:// 打开 index.html，IDE 插件也会直接进入 plugin.html。
  // 使用 hash 路由可以让这些入口都落到同一套前端路由根路径，避免 router-view 空白。
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      component: mainViewRoute,
    },
    {
      path: "/login",
      component: loginViewRoute,
    },
  ],
});
