/**
 * 代码文件行数治理检查脚本。
 *
 * 用途：防止单个源码文件继续膨胀到难以维护。
 * 关键逻辑：只检查代码文件，文档、构建产物、依赖目录和运行期数据不纳入限制。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * maxCodeFileLines: 单个代码文件最大允许行数，来源于本轮 P01 治理要求。
 */
const maxCodeFileLines = 1500;

/**
 * checkedDirectories: 当前仓库需要治理的源码和脚本目录。
 */
const checkedDirectories = [
  "apps",
  "services",
  "packages",
  "plugins",
  "scripts",
];

/**
 * codeExtensions: 参与行数检查的代码文件扩展名。
 */
const codeExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
  ".vue",
]);

/**
 * ignoredDirectoryNames: 不纳入源码治理的依赖、构建产物和运行期目录。
 */
const ignoredDirectoryNames = new Set([
  ".gradle",
  ".idea",
  ".output",
  "build",
  "center-data",
  "dist",
  "node_modules",
  "out",
  "coverage",
]);

/**
 * collectCodeFiles：递归收集需要检查的代码文件。
 *
 * @param {string} directory 当前扫描目录。
 * @returns {string[]} 代码文件绝对路径列表。
 */
function collectCodeFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry)) {
        files.push(...collectCodeFiles(absolutePath));
      }
      continue;
    }

    const extension = entry.includes(".")
      ? `.${entry.split(".").pop()}`
      : "";
    if (codeExtensions.has(extension)) {
      files.push(absolutePath);
    }
  }
  return files;
}

/**
 * countLines：统计文件行数。
 *
 * @param {string} filePath 文件绝对路径。
 * @returns {number} 文件行数。
 */
function countLines(filePath) {
  const content = readFileSync(filePath, "utf8");
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r?\n/u).length;
}

/**
 * violations: 超出行数限制的代码文件。
 */
const violations = checkedDirectories.flatMap((directory) => {
  return collectCodeFiles(join(process.cwd(), directory));
}).map((filePath) => {
  return {
    filePath,
    lineCount: countLines(filePath),
  };
}).filter((item) => {
  return item.lineCount > maxCodeFileLines;
});

if (violations.length > 0) {
  console.error(`单个代码文件不得超过 ${maxCodeFileLines} 行：`);
  for (const violation of violations) {
    console.error(`- ${relative(process.cwd(), violation.filePath)}：${violation.lineCount} 行`);
  }
  process.exit(1);
}

console.log(`代码文件行数检查通过：单个代码文件均不超过 ${maxCodeFileLines} 行。`);
