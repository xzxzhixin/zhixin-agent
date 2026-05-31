import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import {
  defineConfig,
} from "vite";

/**
 * normalizeModuleId：统一 Rollup 模块路径分隔符。
 *
 * 用途：Windows 和类 Unix 路径分隔符不同，先统一成 `/` 后再解析包名。
 * 关键逻辑：只做路径文本规整，不改写真实文件路径。
 *
 * @param id Rollup 传入的模块绝对路径或虚拟模块标识。
 * @returns 使用 `/` 分隔的模块标识。
 */
function normalizeModuleId(id: string) {
  return id.replaceAll(
    "\\",
    "/",
  );
}

/**
 * resolveThirdPartyPackageName：从 node_modules 模块路径解析三方包名。
 *
 * 用途：按真实三方包维度分包，避免新依赖默认回到主入口文件。
 * 关键逻辑：取最后一个 node_modules 后的包名，兼容 pnpm 的 .pnpm 嵌套真实路径。
 *
 * @param id Rollup 传入的模块绝对路径或虚拟模块标识。
 * @returns 三方包名；非三方依赖返回 undefined。
 */
function resolveThirdPartyPackageName(id: string) {
  // normalizedId: 统一分隔符后的模块标识，用于稳定匹配 node_modules。
  const normalizedId = normalizeModuleId(id);
  // nodeModulesMarker: 三方依赖路径分界，pnpm 嵌套路径可能出现多次。
  const nodeModulesMarker = "/node_modules/";
  // nodeModulesIndex: 最后一个 node_modules 后才是真正被导入的包名。
  const nodeModulesIndex = normalizedId.lastIndexOf(nodeModulesMarker);

  if (nodeModulesIndex === -1) {
    return undefined;
  }

  // packagePath: 真正包名及其内部文件路径。
  const packagePath = normalizedId.slice(nodeModulesIndex + nodeModulesMarker.length);
  // packageParts: 用 `/` 拆分后的包名和内部文件路径。
  const packageParts = packagePath.split("/");

  if (packageParts[0] === ".pnpm") {
    return undefined;
  }

  if (packageParts[0]?.startsWith("@")) {
    return `${packageParts[0]}/${packageParts[1]}`;
  }

  return packageParts[0];
}

/**
 * createVendorChunkName：把三方包名映射成稳定 vendor chunk 名。
 *
 * 用途：把所有第三方包从主入口拆出，同时让核心大依赖有可读 chunk 名。
 * 关键逻辑：已知大类依赖按领域聚合，其他依赖按包名单独拆分，避免遗漏新三方包。
 *
 * @param packageName node_modules 中解析出的三方包名。
 * @returns Rollup manualChunks 使用的 chunk 名。
 */
function createVendorChunkName(packageName: string) {
  // vuePackages: Vue 运行时、路由、状态管理和组合式工具包，属于入口共享基础运行时。
  const vuePackages = new Set([
    "@vue/compiler-core",
    "@vue/compiler-dom",
    "@vue/compiler-sfc",
    "@vue/compiler-ssr",
    "@vue/devtools-api",
    "@vue/reactivity",
    "@vue/runtime-core",
    "@vue/runtime-dom",
    "@vue/server-renderer",
    "@vue/shared",
    "@vueuse/core",
    "@vueuse/metadata",
    "@vueuse/shared",
    "pinia",
    "vue",
    "vue-demi",
    "vue-router",
  ]);
  // elementPlusPackages: Element Plus 及图标包，体积较大，独立于业务主入口加载。
  const elementPlusPackages = new Set([
    "@element-plus/icons-vue",
    "element-plus",
    "lodash-unified",
  ]);
  // vantPackages: 移动端 UI 依赖，仅移动路由需要，独立拆分便于后续按需加载。
  const vantPackages = new Set([
    "@vant/icons",
    "@vant/popperjs",
    "@vant/use",
    "vant",
  ]);
  // markdownPackages: Markdown 渲染和 GitHub 样式依赖，只服务消息内容渲染。
  const markdownPackages = new Set([
    "github-markdown-css",
    "marked",
  ]);

  if (vuePackages.has(packageName)) {
    return "vendor-vue";
  }

  if (elementPlusPackages.has(packageName)) {
    return "vendor-element-plus";
  }

  if (vantPackages.has(packageName)) {
    return "vendor-vant";
  }

  if (markdownPackages.has(packageName)) {
    return "vendor-markdown";
  }

  // safePackageName: 其他三方包也按包名拆出；作用域包用中横线转成稳定文件名片段。
  const safePackageName = packageName.replaceAll(
    /[@/]/g,
    "-",
  );

  return `vendor-${safePackageName}`;
}

/**
 * resolveVendorChunk：把三方依赖拆成稳定 vendor chunk。
 *
 * 用途：防止任何 node_modules 三方依赖混入主入口文件。
 * 关键逻辑：业务源码交给路由懒加载和 Rollup 默认拆分，三方源码全部进入 vendor chunk。
 *
 * @param id Rollup 传入的模块绝对路径或虚拟模块标识。
 * @returns 命中的 vendor chunk 名；未命中时交给 Rollup 默认策略。
 */
function resolveVendorChunk(id: string) {
  // packageName: 当前模块归属的三方包名，非三方依赖不手动分包。
  const packageName = resolveThirdPartyPackageName(id);

  if (packageName === undefined) {
    return undefined;
  }

  return createVendorChunkName(packageName);
}

/**
 * defineConfig：统一前端构建配置。
 *
 * 用途：同时构建桌面/Web入口 index.html 和 IDE 插件入口 plugin.html。
 * 关键逻辑：开发期直接引用 monorepo 源码包，避免在阶段性开发中依赖预构建产物。
 */
export default defineConfig({
  // base：中心服务按 HTTP 托管前端 dist，IDE 插件也加载中心服务的 plugin.html。
  // 使用相对资源路径，保证前端资源在桌面绿色版 resources/frontend 内可整体迁移。
  base: "./",
  plugins: [
    vue(),
  ],
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        plugin: fileURLToPath(new URL("./plugin.html", import.meta.url)),
      },
      output: {
        manualChunks: resolveVendorChunk,
      },
    },
  },
  server: {
    watch: {
      ignored: [
        "**/center-data/**",
        "**/中心/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
