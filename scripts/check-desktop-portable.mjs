/**
 * 绿色版目录内容检查。
 *
 * 用途：验证桌面壳绿色版目录包含前端资源、中心服务入口、内置插件、应用图标和界面图标。
 * 关键逻辑：只读取 apps/desktop-shell/dist，不创建、不删除、不修改产物。
 */
import {
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * assertExists：断言绿色版产物中存在指定文件或目录。
 *
 * @param {string} path 文件或目录绝对路径。
 * @param {string} message 缺失时输出的中文错误。
 * @returns {void}
 */
function assertExists(path, message) {
  if (!existsSync(path)) {
    throw new Error(message);
  }
}

// root: 检查脚本固定从仓库根目录运行。
const root = process.cwd();
// portableRoot: 桌面壳构建脚本生成的绿色版目录。
const portableRoot = join(root, "apps", "desktop-shell", "dist", "zhixin-agent-portable");
// resourcesRoot: Electron resources 等价目录。
const resourcesRoot = join(portableRoot, "resources");

assertExists(portableRoot, "绿色版目录不存在，请先运行桌面壳构建。");
assertExists(join(resourcesRoot, "frontend", "index.html"), "绿色版缺少前端 index.html。");
assertExists(join(resourcesRoot, "frontend", "plugin.html"), "绿色版缺少插件入口 plugin.html。");
assertExists(join(resourcesRoot, "center", "index.js"), "绿色版缺少中心服务入口。");
assertExists(join(resourcesRoot, "assets", "app-icon", "图标.png"), "绿色版缺少应用图标。");
assertExists(join(resourcesRoot, "assets", "ui-icons", "mcp-call.svg"), "绿色版缺少 MCP 调用界面图标。");
assertExists(join(resourcesRoot, "assets", "ui-icons", "file-read.svg"), "绿色版缺少读取文件界面图标。");
assertExists(join(resourcesRoot, "assets", "ui-icons", "file-write.svg"), "绿色版缺少写入文件界面图标。");
assertExists(join(resourcesRoot, "assets", "ui-icons", "file-delete.svg"), "绿色版缺少删除文件界面图标。");

// builtinPluginsRoot: 内置插件随包目录。
const builtinPluginsRoot = join(resourcesRoot, "plugins");
assertExists(builtinPluginsRoot, "绿色版缺少内置插件目录。");

// pluginNames: 架构规定必须随包交付的系统内置插件。
const pluginNames = [
  "builtin-model-openai-compatible",
  "builtin-model-anthropic-messages",
  "builtin-automation",
  "builtin-browser-collector",
  "builtin-office-integration",
  "builtin-file-organizer",
];

for (const pluginName of pluginNames) {
  // pluginPath: 每个内置插件需要作为独立目录随绿色版交付。
  const pluginPath = join(builtinPluginsRoot, pluginName);
  assertExists(pluginPath, `绿色版缺少内置插件：${pluginName}。`);
  if (!statSync(pluginPath).isDirectory()) {
    throw new Error(`内置插件不是目录：${pluginName}。`);
  }
}

// zipPath: 有 tar 的 Windows 环境会生成 zip；没有 zip 时目录仍可作为保底产物。
const zipPath = join(root, "apps", "desktop-shell", "dist", "zhixin-agent-portable.zip");
if (existsSync(zipPath) && statSync(zipPath).size === 0) {
  throw new Error("绿色版 zip 文件为空。");
}

// emittedEntries: 输出目录项，方便最终报告快速定位。
const emittedEntries = readdirSync(resourcesRoot).sort();
console.log(`绿色版资源目录检查通过：${emittedEntries.join(", ")}`);
