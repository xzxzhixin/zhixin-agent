/**
 * 桌面端开发启动链路检查。
 *
 * 用途：锁定 dev:desktop-shell 必须启动桌面壳，并由桌面壳生命周期拉起中心服务。
 * 关键逻辑：只做静态检查，不直接启动中心服务或 Electron。
 * 参数：无。
 * 返回值：检查通过退出 0，发现启动链路绕过桌面壳退出 1。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// root: 当前仓库根目录。
const root = process.cwd();
// packageJsonPath: 根脚本声明路径。
const packageJsonPath = join(
  root,
  "package.json",
);
// devScriptPath: 桌面端开发编排脚本路径。
const devScriptPath = join(
  root,
  "scripts",
  "dev-desktop-shell.mjs",
);
// desktopMainPath: 桌面壳主进程路径。
const desktopMainPath = join(
  root,
  "apps",
  "desktop-shell",
  "src",
  "main.ts",
);

// packageJson: 根 package.json 文本，用于检查脚本入口。
const packageJson = JSON.parse(readFileSync(
  packageJsonPath,
  "utf-8",
));
// devScript: 开发编排脚本文本。
const devScript = readFileSync(
  devScriptPath,
  "utf-8",
);
// desktopMain: 桌面壳主进程文本。
const desktopMain = readFileSync(
  desktopMainPath,
  "utf-8",
);

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
 * assertIncludes：检查源码必须包含指定文本。
 *
 * @param source 源码文本。
 * @param pattern 必须存在的文本。
 * @param message 缺失时的失败说明。
 * @returns 没有返回值。
 */
function assertIncludes(
  source,
  pattern,
  message,
) {
  if (!source.includes(pattern)) {
    fail(message);
  }
}

/**
 * assertNotIncludes：检查源码不能包含指定文本。
 *
 * @param source 源码文本。
 * @param pattern 禁止存在的文本。
 * @param message 存在时的失败说明。
 * @returns 没有返回值。
 */
function assertNotIncludes(
  source,
  pattern,
  message,
) {
  if (source.includes(pattern)) {
    fail(message);
  }
}

if (packageJson.scripts?.["dev:desktop-shell"] !== "node scripts/dev-desktop-shell.mjs") {
  fail("根 dev:desktop-shell 必须通过 scripts/dev-desktop-shell.mjs 统一编排。");
}

assertIncludes(
  devScript,
  "@zhixin/frontend",
  "桌面开发脚本必须先启动前端 dev server。",
);
assertIncludes(
  devScript,
  "@zhixin/desktop-shell",
  "桌面开发脚本必须启动 desktop-shell 包，而不是直接启动中心服务。",
);
assertIncludes(
  devScript,
  "ZHIXIN_FRONTEND_DEV_URL",
  "桌面开发脚本必须把前端 dev server 地址注入桌面壳。",
);
assertNotIncludes(
  devScript,
  "@zhixin/center",
  "桌面开发脚本不能直接启动中心服务包；中心服务必须由桌面壳拉起。",
);
assertNotIncludes(
  devScript,
  "services/center/src/index.ts",
  "桌面开发脚本不能直接运行中心服务入口。",
);
assertIncludes(
  desktopMain,
  "function startCenterService",
  "桌面壳主进程必须保留中心服务启动函数。",
);
assertIncludes(
  desktopMain,
  "function resolveCenterCommand",
  "桌面壳开发期必须解析实际存在的中心服务启动命令，不能硬编码单一路径。",
);
assertIncludes(
  desktopMain,
  "startCenterService();",
  "桌面壳 ready 后必须调用 startCenterService 拉起中心服务。",
);
assertIncludes(
  desktopMain,
  "services\", \"center\", \"src\", \"index.ts\"",
  "桌面壳开发期必须指向当前 services/center/src/index.ts。",
);
assertIncludes(
  desktopMain,
  "centerPackageDirectory",
  "桌面壳开发期必须优先查找 services/center/node_modules/.bin 下的 tsx 命令。",
);
assertIncludes(
  desktopMain,
  "desktopPackageDirectory",
  "桌面壳开发期必须提供 desktop-shell/node_modules/.bin 下的 tsx 命令兜底。",
);
assertNotIncludes(
  desktopMain,
  "join(repoRoot, \"node_modules\", \".bin\", tsxCommand)",
  "桌面壳开发期不能只固定使用仓库根 node_modules/.bin/tsx。",
);
assertIncludes(
  desktopMain,
  "ZHIXIN_CENTER_PORT",
  "桌面壳启动中心服务时必须传入端口环境变量。",
);
assertIncludes(
  desktopMain,
  "ZHIXIN_CENTER_DIR",
  "桌面壳启动中心服务时必须传入中心目录环境变量。",
);
assertIncludes(
  desktopMain,
  "ZHIXIN_FRONTEND_DIST",
  "桌面壳启动中心服务时必须传入前端资源目录。",
);
