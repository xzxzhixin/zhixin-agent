import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// root：桌面端工程根目录。
const root = process.cwd();
// mainFile：Electron 主进程源码路径。
const mainFile = join(root, "src", "main", "index.ts");
// packageFile：桌面端 package.json 路径。
const packageFile = join(root, "package.json");
// devScriptFile：桌面端开发启动器路径。
const devScriptFile = join(root, "scripts", "dev.mjs");
// preloadFile：桌面端预加载桥接文件路径。
const preloadFile = join(root, "src", "main", "preload.ts");
// appFile：桌面端应用壳路径。
const appFile = join(root, "src", "renderer", "App.vue");
// homeFile：桌面端对话页路径。
const homeFile = join(root, "src", "renderer", "views", "HomeView.vue");
// electronTsconfigFile：Electron 主进程 IDE 识别配置路径。
const electronTsconfigFile = join(root, "tsconfig.electron.json");
// mainContent：读取主进程源码。
const mainContent = await readFile(mainFile, "utf-8");
// devScriptContent：读取开发启动器源码。
const devScriptContent = await readFile(devScriptFile, "utf-8");
// preloadContent：读取预加载桥接源码。
const preloadContent = await readFile(preloadFile, "utf-8");
// appContent：读取桌面端应用壳源码。
const appContent = await readFile(appFile, "utf-8");
// homeContent：读取桌面端对话页源码。
const homeContent = await readFile(homeFile, "utf-8");
// electronTsconfigContent：读取 Electron 主进程 IDE 识别配置。
const electronTsconfigContent = await readFile(electronTsconfigFile, "utf-8");
// packageContent：读取 package.json。
const packageContent = JSON.parse(await readFile(packageFile, "utf-8"));
// scriptText：桌面端所有脚本拼接文本，用于禁止重新引入 TypeScript 命令行编译。
const scriptText = Object.values(packageContent.scripts).join("\n");

// assert：主进程必须拉起中心服务。
assert.ok(mainContent.includes("startCenterService"));
// assert：主进程必须在退出时停止中心服务。
assert.ok(mainContent.includes("stopCenterService"));
// assert：主进程必须提供重启 IPC。
assert.ok(mainContent.includes("restart-center-service"));
// assert：主进程必须隐藏 Electron 原生菜单栏，桌面端只使用应用内头部菜单。
assert.ok(mainContent.includes("setMenuBarVisibility(false)"));
// assert：主进程必须提供中心服务启动 IPC，头部开关需要直接启动中心服务。
assert.ok(mainContent.includes("start-center-service"));
// assert：主进程必须提供中心服务停止 IPC，头部开关需要直接停止中心服务。
assert.ok(mainContent.includes("stop-center-service"));
// assert：预加载桥接必须暴露中心服务启动能力。
assert.ok(preloadContent.includes("startCenterService"));
// assert：预加载桥接必须暴露中心服务停止能力。
assert.ok(preloadContent.includes("stopCenterService"));
// assert：桌面端应用壳必须使用顶部菜单切换主页面。
assert.ok(appContent.includes("top-menu"));
// assert：桌面端应用壳不能再渲染旧侧边栏菜单。
assert.equal(appContent.includes("nav-menu"), false);
// assert：对话页必须有独立对话侧栏，避免把主菜单混入对话列表。
assert.ok(homeContent.includes("conversation-sidebar"));
// assert：打包资源必须包含中心服务构建产物。
assert.ok(JSON.stringify(packageContent.build.extraResources).includes("../中心服务/dist"));
// assert：窗口和安装包图标必须使用固定图标文件。
assert.equal(packageContent.build.win.icon, "图标.png");
// assert：桌面端开发入口必须交给专用启动器，避免只启动渲染层或只启动 Electron。
assert.equal(packageContent.scripts.dev, "node scripts/dev.mjs");
// assert：桌面端运行入口必须是源码启动壳，不再依赖 tsc 输出的 dist/main/index.js。
assert.equal(packageContent.main, "scripts/electron-main.mjs");
// assert：源码启动壳依赖 tsx 做运行时转译，桌面端必须显式声明依赖。
assert.equal(packageContent.devDependencies.tsx, "4.19.2");
// assert：命令行脚本禁止使用 tsc 或 vue-tsc，TypeScript 诊断交给 IDE，运行时由 Vite/tsx 处理。
assert.equal(/\b(?:vue-tsc|tsc)\b/.test(scriptText), false);
// assert：开发启动器不能再编译主进程，避免 Electron 运行依赖 tsc 产物。
assert.equal(devScriptContent.includes("dev:main"), false);
// assert：Electron TS 配置只服务 IDE 识别，不能再声明 tsc 输出目录。
assert.equal(electronTsconfigContent.includes("outDir"), false);
// assert：Electron TS 配置不能再指向旧的 dist/main 产物。
assert.equal(electronTsconfigContent.includes("dist/main"), false);
// assert：开发启动器必须启动 Vite 渲染层，否则主窗口没有开发页面可加载。
assert.ok(devScriptContent.includes("dev:renderer"));
// assert：开发启动器必须等待主进程硬编码的 5173 地址可访问后再拉起 Electron。
assert.ok(devScriptContent.includes("http://127.0.0.1:5173"));
// assert：开发启动器必须拉起 Electron 主进程，形成真实桌面端开发环境。
assert.match(devScriptContent, /electron/);
// assert：start 仅用于构建后产物预览，避免被误认为开发环境入口。
assert.equal(packageContent.scripts.start, "pnpm run preview");
// assert：preview 明确启动源码启动壳，避免预览依赖 tsc 输出文件。
assert.equal(packageContent.scripts.preview, "electron .");

// console：检查通过时输出摘要。
console.log("桌面端中心服务生命周期集成检查通过");
