import {
  createRouter,
  createWebHashHistory,
} from "vue-router";

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
      path: "/login",
      component: () => import("@views/Login/RouterIndex.vue"),
    },
    {
      path: "/",
      redirect: "/chat",
      component: () => import("@views/MainView.vue"),
      children: [
        {
          path: "chat",
          component: () => import("@views/Chat/RouterIndex.vue"),
        },
        {
          path: "agent-management",
          component: () => import("@views/AgentManagement/RouterIndex.vue"),
        },
        {
          path: "providers",
          component: () => import("@views/Providers/RouterIndex.vue"),
        },
        {
          path: "proxies",
          component: () => import("@views/Proxies/RouterIndex.vue"),
        },
        {
          path: "runtimes",
          component: () => import("@views/Runtimes/RouterIndex.vue"),
        },
        {
          path: "usage",
          component: () => import("@views/Usage/RouterIndex.vue"),
        },
        {
          path: "plugins",
          component: () => import("@views/Plugins/RouterIndex.vue"),
        },
        {
          path: "mcp",
          component: () => import("@views/Mcp/RouterIndex.vue"),
        },
        {
          path: "skills",
          component: () => import("@views/Skills/RouterIndex.vue"),
        },
        {
          path: "center",
          component: () => import("@views/Center/RouterIndex.vue"),
        },
      ],
    },
  ],
});
