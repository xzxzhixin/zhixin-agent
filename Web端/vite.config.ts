import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// defineConfig：Web端只包含浏览器能力，不引入 Electron 专属代码。
export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      // @：Web端源码别名。
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // @zhixin/shared：开发期直接引用共享源码，pnpm 构建时仍由 workspace 管理。
      "@zhixin/shared": fileURLToPath(new URL("../共享/src/index.ts", import.meta.url)),
    },
  },
});
