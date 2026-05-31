/**
 * Electron 主进程启动壳。
 *
 * 用途：开发期通过 tsx 直接加载 TypeScript 主进程源码。
 * 关键逻辑：Electron 读取 package.json main 时只能稳定加载 JavaScript 文件。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// __filename: 当前启动壳路径。
const __filename = fileURLToPath(import.meta.url);
// __dirname: scripts 目录。
const __dirname = dirname(__filename);
// desktopRoot: 桌面壳工程根目录。
const desktopRoot = resolve(__dirname, "..");
// mainSourceUrl: TypeScript 主进程源码入口。
const mainSourceUrl = pathToFileURL(resolve(desktopRoot, "src", "main.ts"));

await import("tsx/esm");
await import(mainSourceUrl.href);
