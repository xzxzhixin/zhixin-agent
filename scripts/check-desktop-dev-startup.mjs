/**
 * 桌面端开发启动链路检查。
 *
 * 用途：锁定 dev:frontend 独立启动前端，dev:desktop-shell 只启动桌面壳并由桌面壳生命周期拉起中心服务。
 * 关键逻辑：只做静态检查，不直接启动中心服务或 Electron。
 * 参数：无。
 * 返回值：检查通过退出 0，发现启动链路绕过桌面壳退出 1。
 */
import {
  existsSync,
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
// frontendViteConfigPath: 前端 Vite 配置路径，用于检查开发期端口不能自动退避。
const frontendViteConfigPath = join(
  root,
  "apps",
  "frontend",
  "vite.config.ts",
);
// centerNativeBindingPath: 中心服务 better-sqlite3 原生绑定路径，桌面壳拉起中心服务前必须存在。
const centerNativeBindingPath = join(
  root,
  "services",
  "center",
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
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
// frontendViteConfig: 前端 Vite 配置文本。
const frontendViteConfig = readFileSync(
  frontendViteConfigPath,
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
  fail("根 dev:desktop-shell 必须保持用户启动命令简洁，并通过 scripts/dev-desktop-shell.mjs 统一编排。");
}

if (packageJson.scripts?.["dev:frontend"] !== "pnpm --filter @zhixin/frontend dev") {
  fail("根 dev:frontend 必须作为唯一前端开发服务器启动入口。");
}

assertNotIncludes(
  devScript,
  "@zhixin/frontend",
  "桌面开发脚本不能启动前端 dev server；前端必须通过 dev:frontend 独立启动。",
);
assertIncludes(
  devScript,
  "isFrontendAlreadyAvailable",
  "桌面开发脚本必须只检查前端 dev server 是否已由 dev:frontend 拉起。",
);
assertIncludes(
  devScript,
  "@zhixin/desktop-shell",
  "桌面开发脚本必须启动 desktop-shell 包，而不是直接启动中心服务。",
);
assertIncludes(
  devScript,
  "ZHIXIN_FRONTEND_DEV_URL",
  "桌面开发脚本必须把独立前端 dev server 地址注入桌面壳。",
);
assertIncludes(
  devScript,
  "delete childEnv.ELECTRON_RUN_AS_NODE",
  "桌面开发脚本启动 Electron 前必须清理 ELECTRON_RUN_AS_NODE，避免 Electron 被当成 Node 运行。",
);
assertNotIncludes(
  devScript,
  "chcp 65001",
  "桌面开发脚本不能把代码页切换命令作为用户启动链路的一部分；中文输出必须在脚本内部接管并转发。",
);
assertIncludes(
  devScript,
  "forwardChildOutputChunk",
  "桌面开发脚本必须接管 Electron stdout/stderr，再按当前控制台输出文本，避免 VS Code 中文乱码。",
);
assertIncludes(
  devScript,
  "TextDecoder",
  "桌面开发脚本必须显式解码子进程输出，避免 UTF-8 字节被终端按错误编码显示。",
);
assertIncludes(
  devScript,
  "\"pipe\"",
  "桌面开发脚本必须使用 pipe 接管子进程输出，不能让中心服务直接继承终端导致中文乱码。",
);
assertNotIncludes(
  desktopMain,
  "desktop-center-runtime.log",
  "桌面壳不能写 desktop-center-runtime.log；中心服务日志必须统一进入 center_YYYY_MM_DD_HH_mm_ss.log 轮转文件。",
);
assertNotIncludes(
  desktopMain,
  "writeCenterRuntimeLog",
  "桌面壳不能维护固定运行日志函数，避免绕过中心服务统一日志设计。",
);
assertIncludes(
  devScript,
  "waitForFrontend()",
  "桌面开发脚本必须等待独立前端 URL 可访问后再启动 Electron。",
);
assertIncludes(
  frontendViteConfig,
  "port: 5173",
  "前端 Vite 配置必须固定开发端口 5173，避免测试 URL 与桌面加载 URL 不一致。",
);
assertIncludes(
  frontendViteConfig,
  "strictPort: true",
  "前端 Vite 配置必须启用 strictPort，端口被占用时应失败而不是退避。",
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
  "centerNativeBindingPath",
  "桌面壳开发期必须在拉起中心服务前检查 better-sqlite3 原生绑定。",
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
assertIncludes(
  desktopMain,
  "resolveCenterProcessPath",
  "桌面壳启动中心服务时必须把中心服务 Node 可执行文件目录放到 PATH 前面，避免 tsx.CMD 误用其他 Node 版本。",
);
assertIncludes(
  desktopMain,
  "mainWindow.webContents.session.clearCache()",
  "桌面壳开发期加载 Vite 前端前必须清理 Electron 会话缓存，避免旧前端模块导致路由主体残留。",
);
if (!existsSync(centerNativeBindingPath)) {
  fail(`中心服务缺少 better-sqlite3 原生绑定，请先执行 pnpm rebuild better-sqlite3 --filter @zhixin/center：${centerNativeBindingPath}`);
}
