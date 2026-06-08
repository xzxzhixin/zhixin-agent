/**
 * 中心服务数据访问层边界检查。
 *
 * 用途：阻止 SQL、表定义和 SQLite 持久化查询继续散落在路由、领域服务和 Worker 编排中。
 * 关键逻辑：只允许迁移文件、数据库初始化、Drizzle schema、数据库适配器和 data-access 目录承载 SQL。
 * 参数：无。
 * 返回值：检查通过时退出码为 0；发现越界 SQL 时退出码为 1。
 */
import {
  readdirSync,
  readFileSync,
} from "node:fs";
import {
  join,
  relative,
} from "node:path";

/**
 * walkFiles：递归收集指定目录下的 TypeScript 文件。
 *
 * @param {string} directory 需要扫描的目录。
 * @returns {string[]} 文件绝对路径数组。
 */
function walkFiles(directory) {
  const output = [];
  for (const entry of readdirSync(directory, {
    withFileTypes: true,
  })) {
    const fullPath = join(
      directory,
      entry.name,
    );
    if (entry.isDirectory()) {
      output.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      output.push(fullPath);
    }
  }
  return output;
}

/**
 * toPosixPath：把 Windows 路径转换为脚本内部统一路径。
 *
 * @param {string} path 文件路径。
 * @returns {string} 使用 / 分隔的路径。
 */
function toPosixPath(path) {
  return path.replace(/\\/gu, "/");
}

/**
 * isAllowedSqlFile：判断文件是否允许包含 SQL。
 *
 * @param {string} pathInProject 仓库相对路径。
 * @returns {boolean} 允许返回 true。
 */
function isAllowedSqlFile(pathInProject) {
  const normalized = toPosixPath(pathInProject);
  return normalized.startsWith("services/center/src/data-access/")
    || normalized === "services/center/src/database.ts";
}

/**
 * findSqlSignals：提取越界 SQL 信号。
 *
 * @param {string} source 文件源码。
 * @returns {string[]} 命中的信号名称。
 */
function findSqlSignals(source) {
  const signals = [];
  const checks = [
    [
      "prepare(",
      /\.prepare\s*\(/u,
    ],
    [
      "database.exec(",
      /\b(?:database|connection|sqlite|db)\.exec\s*\(/u,
    ],
    [
      "transaction(",
      /\.transaction\s*\(/u,
    ],
    [
      "SELECT",
      /\bSELECT\b/u,
    ],
    [
      "INSERT",
      /\bINSERT\s+(?:OR\s+REPLACE\s+)?INTO\b/u,
    ],
    [
      "UPDATE",
      /\bUPDATE\b/u,
    ],
    [
      "DELETE",
      /\bDELETE\s+FROM\b/u,
    ],
    [
      "CREATE TABLE",
      /\bCREATE\s+TABLE\b/u,
    ],
    [
      "ALTER TABLE",
      /\bALTER\s+TABLE\b/u,
    ],
    [
      "sqliteTable",
      /\bsqliteTable\s*\(/u,
    ],
    [
      "better-sqlite3",
      /better-sqlite3/u,
    ],
  ];

  for (const [
    label,
    pattern,
  ] of checks) {
    if (pattern.test(source)) {
      signals.push(label);
    }
  }

  return signals;
}

// sourceRoot: 中心服务源码根目录，只扫描当前服务实现。
const sourceRoot = join(
  process.cwd(),
  "services/center/src",
);
// violations: 越界 SQL 清单，用于给程序员收口迁移。
const violations = [];

for (const filePath of walkFiles(sourceRoot)) {
  const pathInProject = toPosixPath(relative(
    process.cwd(),
    filePath,
  ));
  const source = readFileSync(
    filePath,
    "utf-8",
  );
  const signals = findSqlSignals(source);
  if (signals.length === 0 || isAllowedSqlFile(pathInProject)) {
    continue;
  }
  violations.push({
    pathInProject,
    signals,
  });
}

if (violations.length > 0) {
  console.error("中心服务 SQL 只能出现在 database.ts 和 services/center/src/data-access 内。");
  for (const violation of violations) {
    console.error(`- ${violation.pathInProject}: ${violation.signals.join(", ")}`);
  }
  process.exitCode = 1;
}

// repositoryIndex: 数据访问层需要有统一出口，避免业务文件直接拼相对 repository 路径后继续失控。
const repositoryIndexPath = join(
  process.cwd(),
  "services/center/src/data-access/index.ts",
);
try {
  const repositoryIndex = readFileSync(
    repositoryIndexPath,
    "utf-8",
  );
  if (!repositoryIndex.includes("createDataAccess")) {
    console.error("数据访问层缺少 createDataAccess 统一工厂。");
    process.exitCode = 1;
  }
} catch {
  console.error("数据访问层缺少统一出口文件 services/center/src/data-access/index.ts。");
  process.exitCode = 1;
}
