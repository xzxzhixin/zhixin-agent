import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// defineConfig：桌面端渲染层使用 Vite + Vue，Electron 主进程由 tsx 源码启动壳加载。
export default defineConfig({
  plugins: [
    vue(),
  ],
  server: {
    watch: {
      // ignored：中心目录是运行期数据目录，开发服务不能监听其中的会话、附件和日志变化。
      ignored: [
        "**/中心/**",
        "../中心/**",
      ],
    },
  },
  resolve: {
    alias: {
      // @：桌面端渲染层源码别名。
      "@": fileURLToPath(new URL("./src/renderer", import.meta.url)),
      // @zhixin/shared：开发期直接使用共享源码。
      "@zhixin/shared": fileURLToPath(new URL("../共享/src/index.ts", import.meta.url)),
    },
  },
});
