/**
 * 前端入口资源路径检查。
 *
 * 用途：验证 Vite 构建后的 index.html 和 plugin.html 使用可迁移相对资源路径。
 * 关键逻辑：中心服务托管 resources/frontend 时，绝对 /assets 路径会脱离前端资源目录。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * htmlFiles: 统一前端必须产出的两个入口文件。
 */
const htmlFiles = [
  "index.html",
  "plugin.html",
];

/**
 * violations: 不兼容 file 协议加载的资源路径列表。
 */
const violations = [];

for (const htmlFile of htmlFiles) {
  // htmlPath: Vite 构建产物入口文件路径。
  const htmlPath = join(
    process.cwd(),
    "apps",
    "frontend",
    "dist",
    htmlFile,
  );
  // html: 入口文件内容，用正则只检查静态资源引用，避免误判正文文本。
  const html = readFileSync(
    htmlPath,
    "utf-8",
  );
  // absoluteAssetPattern: Vite 默认 base=/ 时会生成的绝对资源路径。
  const absoluteAssetPattern = /\b(?:src|href)="\/assets\//u;

  if (absoluteAssetPattern.test(html)) {
    violations.push(`${htmlFile} 包含 /assets 绝对资源路径`);
  }
}

if (violations.length > 0) {
  console.error("前端构建产物不能使用脱离资源目录的绝对路径：");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}
