/**
 * 绿色版目录内容检查。
 *
 * 用途：验证桌面壳绿色版目录包含前端资源、中心服务入口、内置插件、应用图标和界面图标。
 * 关键逻辑：只读取 apps/desktop-shell/dist，不创建、不删除、不修改产物。
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  join,
  relative,
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

/**
 * collectFiles：递归收集目录中的文件路径。
 *
 * @param {string} directoryPath 需要扫描的目录绝对路径。
 * @returns {string[]} 目录内全部文件的绝对路径。
 */
function collectFiles(directoryPath) {
  // files: 当前目录递归得到的文件绝对路径列表。
  const files = [];
  for (const entryName of readdirSync(directoryPath)) {
    // entryPath: 当前子项绝对路径，来源于绿色版产物目录。
    const entryPath = join(directoryPath, entryName);
    // entryStat: 当前子项文件状态，用于区分目录和普通文件。
    const entryStat = statSync(entryPath);
    if (entryStat.isDirectory()) {
      files.push(...collectFiles(entryPath));
      continue;
    }
    if (entryStat.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

/**
 * assertDirectoryHasNoSignals：断言目录中不包含指定路径或文本信号。
 *
 * @param {string} directoryPath 被扫描目录绝对路径。
 * @param {{ signal: string; description: string }[]} forbiddenSignals 禁用信号列表。
 * @returns {void}
 */
function assertDirectoryHasNoSignals(directoryPath, forbiddenSignals) {
  for (const filePath of collectFiles(directoryPath)) {
    // relativeFilePath: 相对被扫描目录的路径，用于错误信息定位。
    const relativeFilePath = relative(directoryPath, filePath).replaceAll("\\", "/");
    // fileText: 文本读取失败时按空文本处理，因为二进制资源只需要参与路径信号检查。
    let fileText = "";
    try {
      fileText = readFileSync(filePath, "utf-8");
    } catch {
      fileText = "";
    }
    for (const forbiddenSignal of forbiddenSignals) {
      // signal: 明确禁止出现在 Web 端资源包内的中心服务信号。
      const signal = forbiddenSignal.signal;
      if (relativeFilePath.includes(signal) || fileText.includes(signal)) {
        throw new Error(`前端资源包含中心服务信号：${forbiddenSignal.description}，文件：${relativeFilePath}。`);
      }
    }
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
assertExists(join(resourcesRoot, "center", "src", "index.ts"), "绿色版缺少随包中心服务源码入口。");
assertExists(join(resourcesRoot, "center", "package.json"), "绿色版缺少随包中心服务包描述。");
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

assertDirectoryHasNoSignals(
  join(resourcesRoot, "frontend"),
  [
    {
      // signal: 禁止 Web 端资源包夹带中心服务入口文件。
      signal: "center/index.js",
      // description: 错误提示中展示的中心服务信号含义。
      description: "中心服务入口 center/index.js",
    },
    {
      // signal: 禁止 Web 端资源包夹带中心服务原生数据库依赖。
      signal: "better-sqlite3",
      // description: 错误提示中展示的中心服务信号含义。
      description: "中心服务数据库依赖 better-sqlite3",
    },
    {
      // signal: 禁止 Web 端资源包夹带仓库中心服务源码路径。
      signal: "services/center",
      // description: 错误提示中展示的中心服务信号含义。
      description: "仓库中心服务源码路径 services/center",
    },
  ],
);

// centerEntryText: 随包中心服务入口内容，必须只引用 resources/center 内部文件。
const centerEntryText = readFileSync(join(resourcesRoot, "center", "index.js"), "utf-8");
if (centerEntryText.includes("services/center/src/index.ts")) {
  throw new Error("绿色版中心服务入口仍然指向仓库 services/center/src/index.ts。");
}

// zipPath: 有 tar 的 Windows 环境会生成 zip；没有 zip 时目录仍可作为保底产物。
const zipPath = join(root, "apps", "desktop-shell", "dist", "zhixin-agent-portable.zip");
if (existsSync(zipPath) && statSync(zipPath).size === 0) {
  throw new Error("绿色版 zip 文件为空。");
}

// emittedEntries: 输出目录项，方便最终报告快速定位。
const emittedEntries = readdirSync(resourcesRoot).sort();
console.log(`绿色版资源目录检查通过：${emittedEntries.join(", ")}`);
