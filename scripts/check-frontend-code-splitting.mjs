/**
 * 前端代码分包检查。
 *
 * 用途：固定页面路由懒加载和第三方依赖独立拆包的架构约束。
 * 关键逻辑：静态扫描 router.ts 与 vite.config.ts，避免主入口重新引入页面组件或把 vendor 混进主文件。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// routerPath: 统一前端路由源码路径，来源于架构中唯一业务前端目录。
const routerPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "router.ts",
);
// viteConfigPath: 前端 Vite 构建配置路径，来源于 apps/frontend 包边界。
const viteConfigPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "vite.config.ts",
);
// routerSource: 路由源码文本，用于检查页面组件是否仍被静态导入。
const routerSource = readFileSync(
  routerPath,
  "utf-8",
);
// viteConfigSource: Vite 配置源码文本，用于检查 Rollup 分包策略是否存在。
const viteConfigSource = readFileSync(
  viteConfigPath,
  "utf-8",
);

// staticViewImportPattern: 页面组件静态导入会进入主入口，因此禁止出现在路由文件。
const staticViewImportPattern = /import\s+\w+\s+from\s+["']\.\/views\/[^"']+\.vue["'];/;
// lazyMainViewPattern: 主工作台必须通过动态 import 形成独立页面 chunk。
const lazyMainViewPattern = /\(\)\s*=>\s*import\(\s*"[^"]*\.\/views\/MainView\.vue"\s*\)/;
// lazyLoginViewPattern: 登录页必须通过动态 import 形成独立页面 chunk。
const lazyLoginViewPattern = /\(\)\s*=>\s*import\(\s*"[^"]*\.\/views\/LoginView\.vue"\s*\)/;

if (staticViewImportPattern.test(routerSource)) {
  console.error("前端页面路由必须懒加载，router.ts 不能静态导入 views 下的页面组件。");
  process.exitCode = 1;
}

if (!lazyMainViewPattern.test(routerSource)) {
  console.error("MainView 路由必须使用 () => import(...) 懒加载。");
  process.exitCode = 1;
}

if (!lazyLoginViewPattern.test(routerSource)) {
  console.error("LoginView 路由必须使用 () => import(...) 懒加载。");
  process.exitCode = 1;
}

if (!viteConfigSource.includes("manualChunks")) {
  console.error("前端 Vite 构建必须配置 manualChunks，把第三方依赖从主入口拆出。");
  process.exitCode = 1;
}

for (const chunkName of [
  "vendor-vue",
  "vendor-element-plus",
  "vendor-vant",
  "vendor-markdown",
]) {
  if (!viteConfigSource.includes(chunkName)) {
    console.error(`前端 Vite manualChunks 缺少 ${chunkName} 第三方分包。`);
    process.exitCode = 1;
  }
}
