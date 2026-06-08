/**
 * TypeScript 编译器质量门槛检查。
 *
 * 用途：确认项目没有把 tsc、tsc --noEmit 或 vue-tsc 作为包脚本强制入口。
 * 关键逻辑：新版架构要求开发运行和打包由 Vite、tsx、Electron、Fastify 等工具处理，不能把 TypeScript 编译器作为质量门槛。
 * 参数：无。
 * 返回值：检查通过时正常退出；发现违规脚本时返回非零退出码。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * workspacePackages: 当前阶段纳入 pnpm workspace 的包目录。
 */
const workspacePackages = [
  ".",
  "apps/frontend",
  "apps/desktop-shell",
  "services/center",
  "packages/shared",
  "packages/api-client",
  "packages/ui",
  "packages/plugin-sdk",
  "plugins/builtin-model-anthropic-messages",
  "plugins/builtin-automation",
  "plugins/builtin-browser-collector",
  "plugins/builtin-office-integration",
  "plugins/builtin-file-organizer",
];

/**
 * violations: 发现的违规脚本说明。
 */
const violations = [];

for (const packageDirectory of workspacePackages) {
  // packageJsonPath: 逐个读取工作区 package.json，避免 glob 依赖。
  const packageJsonPath = join(process.cwd(), packageDirectory, "package.json");
  // packageJson: 包清单内容。
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  // scripts: 包脚本定义。
  const scripts = packageJson.scripts ?? {};

  for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
    // command: 脚本文本，必须按字符串检查。
    const command = String(scriptCommand);
    // usesTypeCompiler: 匹配独立 tsc 或 vue-tsc 命令，避免误伤普通文本。
    const usesTypeCompiler = /(^|\s)(vue-tsc|tsc)(\s|$)/u.test(command);

    if (usesTypeCompiler) {
      violations.push(`${packageDirectory} -> ${scriptName}: ${command}`);
    }
  }
}

if (violations.length > 0) {
  console.error("发现未允许的 TypeScript 编译器脚本：");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}
