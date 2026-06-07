/**
 * 桌面端开发运行时检查。
 *
 * 用途：防止桌面端开发脚本退回先构建前端的慢路径，并避免本机入口误判为远程 Web。
 * 关键逻辑：开发期前端由 dev:frontend 独立启动，dev:desktop-shell 只检查前端后启动 Electron 壳；历史 file:// 入口也不是远程 Web。
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
// desktopDevRuntimePath: 桌面壳开发编排脚本，只检查独立 Vite 服务是否已存在。
const desktopDevRuntimePath = join(
  process.cwd(),
  "scripts",
  "dev-desktop-shell.mjs",
);
// rootPackage: 根 package.json 用结构化解析，避免脚本顺序检查受缩进影响。
const rootPackage = JSON.parse(readFileSync(
  rootPackagePath,
  "utf-8",
));
// desktopDevScript: 桌面壳开发脚本，必须等待独立开发服务器而不是先构建前端。
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
// centerConfigPath: 中心服务配置读取源码，必须能识别开发期前端 dev server。
const centerConfigPath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "config.ts",
);
// centerServicePath: 中心服务 HTTP 托管源码，必须能把开发期页面请求导向 Vite。
const centerServicePath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "service.ts",
);
// centerTypesPath: 中心服务启动配置类型，必须注释开发期前端 dev server 字段。
const centerTypesPath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "types.ts",
);
// desktopPreloadSource: Electron 可直接加载的 CommonJS preload 源码文本。
const desktopPreloadSource = readFileSync(
  desktopPreloadPath,
  "utf-8",
);
// desktopDevRuntimeSource: 桌面壳开发编排脚本文本。
const desktopDevRuntimeSource = readFileSync(
  desktopDevRuntimePath,
  "utf-8",
);
// centerConfigSource: 中心服务配置读取源码文本。
const centerConfigSource = readFileSync(
  centerConfigPath,
  "utf-8",
);
// centerServiceSource: 中心服务 HTTP 托管源码文本。
const centerServiceSource = readFileSync(
  centerServicePath,
  "utf-8",
);
// centerTypesSource: 中心服务启动配置类型源码文本。
const centerTypesSource = readFileSync(
  centerTypesPath,
  "utf-8",
);

if (desktopDevScript.includes("build:frontend")) {
  console.error("dev:desktop-shell 不能先执行 build:frontend，开发期前端必须由 dev:frontend 独立启动。");
  process.exitCode = 1;
}

if (!desktopDevScript.includes("dev-desktop-shell")) {
  console.error("dev:desktop-shell 应使用桌面端开发编排脚本启动 Electron 壳并由桌面壳拉起中心服务。");
  process.exitCode = 1;
}

if (!desktopDevRuntimeSource.includes("isFrontendAlreadyAvailable")) {
  console.error("桌面端开发编排脚本必须先探测 5173 是否已有可访问前端。");
  process.exitCode = 1;
}

if (!desktopDevRuntimeSource.includes("请先运行 pnpm dev:frontend")) {
  console.error("桌面端开发编排脚本在 5173 未就绪时必须提示先运行 pnpm dev:frontend。");
  process.exitCode = 1;
}

if (!desktopDevRuntimeSource.includes("await isFrontendAlreadyAvailable()")) {
  console.error("桌面端开发编排脚本必须在启动 Electron 前执行前端可用性探测。");
  process.exitCode = 1;
}

if (desktopDevRuntimeSource.includes("@zhixin/frontend")) {
  console.error("桌面端开发编排脚本不能启动前端包，前端必须由 dev:frontend 独立管理。");
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

if (!desktopMainSource.includes("ZHIXIN_FRONTEND_DEV_URL: frontendDevUrl ?? \"\"")) {
  console.error("桌面壳开发期启动中心服务时必须继续传入 ZHIXIN_FRONTEND_DEV_URL，让 8866 页面清晰复用 5173 HMR。");
  process.exitCode = 1;
}

if (!centerTypesSource.includes("frontendDevServerUrl")) {
  console.error("中心服务启动配置必须声明 frontendDevServerUrl，说明开发期前端 dev server 来源和约束。");
  process.exitCode = 1;
}

if (!centerConfigSource.includes("ZHIXIN_FRONTEND_DEV_URL")) {
  console.error("中心服务配置读取必须支持 ZHIXIN_FRONTEND_DEV_URL。");
  process.exitCode = 1;
}

if (!centerConfigSource.includes("normalizeFrontendDevServerUrl")) {
  console.error("中心服务必须校验开发期前端 dev server URL，不能把任意外部地址当作跳转目标。");
  process.exitCode = 1;
}

if (!centerServiceSource.includes("frontendDevServerUrl")
    || !centerServiceSource.includes("reply.redirect")
    || !centerServiceSource.includes("resolveFrontendDevServerRedirectUrl")) {
  console.error("中心服务开发期非 API 页面请求必须重定向到 Vite dev server，避免 8866 长期托管旧 dist 页面。");
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
