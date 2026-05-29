import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// __filename：源码启动壳文件路径，用于定位桌面端工程根目录。
const __filename = fileURLToPath(import.meta.url);
// __dirname：源码启动壳所在 scripts 目录。
const __dirname = dirname(__filename);
// desktopRoot：桌面端工程根目录，Electron 的 app.getAppPath() 也会指向这里。
const desktopRoot = resolve(__dirname, "..");
// mainSourceUrl：Electron 主进程 TypeScript 源码入口。
const mainSourceUrl = pathToFileURL(resolve(desktopRoot, "src", "main", "index.ts"));

// register：tsx 运行时转译 TypeScript，避免开发和预览依赖预编译输出文件。
await import("tsx/esm");
// import：加载真实主进程源码，后续生命周期仍由 src/main/index.ts 管理。
await import(mainSourceUrl.href);
