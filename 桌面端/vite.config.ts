import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// defineConfig：桌面端渲染层使用 Vite + Vue，Electron 主进程单独由 tsc 编译。
export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      // @：桌面端渲染层源码别名。
      "@": fileURLToPath(new URL("./src/renderer", import.meta.url)),
      // @zhixin/shared：开发期直接使用共享源码。
      "@zhixin/shared": fileURLToPath(new URL("../共享/src/index.ts", import.meta.url)),
    },
  },
});
