/**
 * 桌面端开发运行时检查。
 *
 * 用途：防止桌面端开发脚本退回先构建前端的慢路径，并避免本机入口误判为远程 Web。
 * 关键逻辑：开发期应先启动 Vite 前端服务器再开 Electron 壳；历史 file:// 入口也不是远程 Web。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// rootPackagePath: 根工作区脚本来源。
const rootPackagePath = join(
  process.cwd(),
  "package.json",
);
// runtimePath: 前端运行时识别源码。
const runtimePath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "runtime.ts",
);
// desktopMainPath: 桌面壳主进程源码，用于检查生产入口是否走中心服务 HTTP。
const desktopMainPath = join(
  process.cwd(),
  "apps",
  "desktop-shell",
  "src",
  "main.ts",
);
// desktopPreloadPath: 桌面壳 preload 源码路径，必须存在并暴露桌面桥接。
const desktopPreloadPath = join(
  process.cwd(),
  "apps",
  "desktop-shell",
  "src",
  "preload.cjs",
);
// rootPackage: 根 package.json 用结构化解析，避免脚本顺序检查受缩进影响。
const rootPackage = JSON.parse(readFileSync(
  rootPackagePath,
  "utf-8",
));
// desktopDevScript: 桌面壳开发脚本，必须走开发服务器而不是先构建前端。
const desktopDevScript = rootPackage.scripts?.["dev:desktop-shell"] ?? "";
// runtimeSource: 运行时识别源码文本，用于检查本机入口和桌面桥接保护。
const runtimeSource = readFileSync(
  runtimePath,
  "utf-8",
);
// desktopMainSource: 桌面壳主进程源码文本。
const desktopMainSource = readFileSync(
  desktopMainPath,
  "utf-8",
);
// desktopPreloadSource: Electron 可直接加载的 CommonJS preload 源码文本。
const desktopPreloadSource = readFileSync(
  desktopPreloadPath,
  "utf-8",
);

if (desktopDevScript.includes("build:frontend")) {
  console.error("dev:desktop-shell 不能先执行 build:frontend，开发期应启动前端 dev server 后再开 Electron 壳。");
  process.exitCode = 1;
}

if (!desktopDevScript.includes("dev-desktop-shell")) {
  console.error("dev:desktop-shell 应使用桌面端开发编排脚本统一启动前端 dev server 和 Electron 壳。");
  process.exitCode = 1;
}

if (!runtimeSource.includes("window.location.protocol === \"file:\"")) {
  console.error("前端运行时必须把 file:// 入口识别为本机入口，不能进入远程 Web 登录。");
  process.exitCode = 1;
}

if (!runtimeSource.includes("!hasDesktopBridge")) {
  console.error("前端运行时判断远程 Web 时必须排除桌面壳桥接入口。");
  process.exitCode = 1;
}

if (runtimeSource.includes("Electron loadFile 使用 file 协议")) {
  console.error("前端运行时注释不能继续把桌面端生产入口描述为 Electron loadFile。");
  process.exitCode = 1;
}

if (desktopMainSource.includes("loadFile(")) {
  console.error("桌面壳生产入口不能使用 loadFile 加载前端，Vite 分包后的 ES module 应由中心服务 HTTP 托管。");
  process.exitCode = 1;
}

if (!desktopMainSource.includes("ZHIXIN_FRONTEND_DIST")) {
  console.error("桌面壳启动中心服务时必须传入 ZHIXIN_FRONTEND_DIST，让中心服务托管前端资源。");
  process.exitCode = 1;
}

if (desktopMainSource.includes("preload.ts")) {
  console.error("桌面壳 preload 不能指向 TypeScript 源码，Electron preload 必须加载可直接执行的 JS/CJS 文件。");
  process.exitCode = 1;
}

if (!desktopMainSource.includes("preload.cjs")) {
  console.error("桌面壳主进程必须加载 preload.cjs，确保桌面桥接能在 Electron 中注入。");
  process.exitCode = 1;
}

if (!desktopPreloadSource.includes("contextBridge.exposeInMainWorld")
    || !desktopPreloadSource.includes("\"zhixinDesktop\"")) {
  console.error("桌面壳 preload.cjs 必须暴露 zhixinDesktop 桥接，否则前端会误判为 web-local。");
  process.exitCode = 1;
}
