import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// root：桌面端工程根目录。
const root = process.cwd();
// mainFile：Electron 主进程源码路径。
const mainFile = join(root, "src", "main", "index.ts");
// packageFile：桌面端 package.json 路径。
const packageFile = join(root, "package.json");
// mainContent：读取主进程源码。
const mainContent = await readFile(mainFile, "utf-8");
// packageContent：读取 package.json。
const packageContent = JSON.parse(await readFile(packageFile, "utf-8"));

// assert：主进程必须拉起中心服务。
assert.ok(mainContent.includes("startCenterService"));
// assert：主进程必须在退出时停止中心服务。
assert.ok(mainContent.includes("stopCenterService"));
// assert：主进程必须提供重启 IPC。
assert.ok(mainContent.includes("restart-center-service"));
// assert：打包资源必须包含中心服务构建产物。
assert.ok(JSON.stringify(packageContent.build.extraResources).includes("../中心服务/dist"));
// assert：窗口和安装包图标必须使用固定图标文件。
assert.equal(packageContent.build.win.icon, "图标.png");

// console：检查通过时输出摘要。
console.log("桌面端中心服务生命周期集成检查通过");
