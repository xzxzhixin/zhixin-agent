/**
 * 前端入口路由检查。
 *
 * 用途：验证统一前端在 index.html、plugin.html 和 file:// 桌面壳入口下都能命中根路由。
 * 关键逻辑：createWebHistory 会把 /plugin.html 或 file 路径当作业务路由，导致 router-view 为空白。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// routerPath: 统一前端路由源码。
const routerPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "router.ts",
);
// routerSource: 路由源码文本，仅检查明确的历史模式选择。
const routerSource = readFileSync(
  routerPath,
  "utf-8",
);

if (!routerSource.includes("createWebHashHistory")) {
  console.error("前端路由必须使用 createWebHashHistory，确保 file://、index.html 和 plugin.html 入口都能命中根路由。");
  process.exitCode = 1;
}

if (routerSource.includes("createWebHistory")) {
  console.error("前端路由不能使用 createWebHistory，否则 /plugin.html 和 file:// 入口会出现空白页面。");
  process.exitCode = 1;
}
