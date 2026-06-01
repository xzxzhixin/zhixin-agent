/**
 * Web 构建产物边界检查。
 *
 * 用途：确认 apps/frontend/dist 只包含浏览器静态资源，不夹带中心服务、SQLite 或 Electron 壳文件。
 * 关键逻辑：dist 存在时扫描产物文件名和文本内容；dist 不存在时只检查前端源码没有直接依赖禁用模块。
 * 参数：无。
 * 返回值：检查通过退出 0，发现边界污染退出 1。
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import {
  extname,
  join,
  relative,
} from "node:path";

// root: 当前仓库根目录，脚本必须从仓库根目录执行。
const root = process.cwd();
// frontendDistPath: Web 端构建产物目录；未构建时允许不存在，但会提示只做源码边界检查。
const frontendDistPath = join(
  root,
  "apps",
  "frontend",
  "dist",
);
// frontendSourceRoots: Web 前端源码边界，不能直接引用中心服务或桌面壳专属模块。
const frontendSourceRoots = [
  join(
    root,
    "apps",
    "frontend",
    "src",
  ),
];
// forbiddenSignals: Web 资源包和前端源码禁止出现的中心服务或桌面壳专属信号。
const forbiddenSignals = [
  {
    text: "services/center",
    reason: "仓库中心服务源码路径不能进入 Web 端资源。",
  },
  {
    text: "better-sqlite3",
    reason: "SQLite 原生驱动不能进入 Web 端资源。",
  },
  {
    text: "sqlite",
    reason: "Web 端资源不能包含 SQLite 数据库运行依赖信号。",
  },
  {
    text: "electron",
    reason: "Electron 桌面壳专属模块不能进入 Web 端资源。",
  },
  {
    text: "resources/center",
    reason: "桌面端中心服务装配目录不能进入 Web dist。",
  },
];
// forbiddenNames: Web dist 文件名禁止包含的服务端或桌面端信号。
const forbiddenNames = [
  "center",
  "sqlite",
  "better-sqlite3",
  "electron",
];
// textExtensions: 只读取文本类文件内容，避免误读二进制资源。
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
]);

/**
 * fail：记录检查失败。
 *
 * @param message 失败说明。
 * @returns 没有返回值。
 */
function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

/**
 * listFiles：递归列出目录下文件。
 *
 * @param directory 目标目录。
 * @returns 文件绝对路径数组。
 */
function listFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(
    directory,
    {
      withFileTypes: true,
    },
  ).flatMap((entry) => {
    const absolutePath = join(
      directory,
      entry.name,
    );
    if (entry.isDirectory()) {
      return listFiles(absolutePath);
    }
    return [
      absolutePath,
    ];
  });
}

/**
 * scanTextFile：扫描文本文件中的禁止信号。
 *
 * @param filePath 文件绝对路径。
 * @returns 没有返回值。
 */
function scanTextFile(filePath) {
  if (!textExtensions.has(extname(filePath))) {
    return;
  }

  const source = readFileSync(
    filePath,
    "utf-8",
  );
  const pathInProject = relative(
    root,
    filePath,
  );

  for (const signal of forbiddenSignals) {
    if (source.includes(signal.text)) {
      fail(`${pathInProject} 包含禁止信号 ${signal.text}：${signal.reason}`);
    }
  }
}

/**
 * scanDistFileName：扫描 Web dist 文件名。
 *
 * @param filePath 文件绝对路径。
 * @returns 没有返回值。
 */
function scanDistFileName(filePath) {
  const normalizedPath = relative(
    frontendDistPath,
    filePath,
  ).replace(/\\/gu, "/").toLowerCase();
  for (const nameSignal of forbiddenNames) {
    if (normalizedPath.includes(nameSignal)) {
      fail(`apps/frontend/dist/${normalizedPath} 文件名包含 ${nameSignal}，Web 端资源包边界疑似污染。`);
    }
  }
}

for (const sourceRoot of frontendSourceRoots) {
  for (const filePath of listFiles(sourceRoot)) {
    scanTextFile(filePath);
  }
}

if (!existsSync(frontendDistPath)) {
  console.warn("apps/frontend/dist 不存在，本次仅完成前端源码包边界静态检查；需要构建后才能扫描 Web dist。");
} else {
  for (const filePath of listFiles(frontendDistPath)) {
    scanDistFileName(filePath);
    scanTextFile(filePath);
  }
}
