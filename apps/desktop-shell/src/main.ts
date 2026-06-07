import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  app,
  BrowserWindow,
  dialog,
  Notification,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from "electron";
import {
  type ChildProcessWithoutNullStreams,
  spawn,
  spawnSync,
} from "node:child_process";
import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import {
  dirname,
  join,
  resolve,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  APP_NAME,
  CENTER_DATA_DIR_NAME,
  DEFAULT_CENTER_PORT,
} from "@zhixin/shared";

/**
 * CenterLaunchConfig：桌面壳启动中心服务所需配置。
 *
 * 来源：桌面端本机配置和架构默认值。
 * 含义：决定中心服务端口、中心目录和前端资源路径。
 * 格式：运行期对象。
 * 默认值：端口 8866，中心目录为应用启动目录下 center-data。
 * 约束：Web 和 IDEA 插件不能修改中心服务生命周期。
 */
interface CenterLaunchConfig {
  /**
   * port: 中心服务监听端口。
   */
  port: number;

  /**
   * centerDirectory: 中心目录绝对路径。
   */
  centerDirectory: string;
}

/**
 * CenterCommandResolution：中心服务启动命令解析结果。
 *
 * 来源：桌面壳开发期和绿色版运行期的启动环境。
 * 含义：记录可执行命令、参数、工作目录和诊断信息。
 * 格式：运行期对象。
 * 默认值：无；解析失败时由调用方展示错误。
 * 约束：开发期只能通过桌面壳拉起中心服务，不能由启动脚本直接运行中心服务。
 */
interface CenterCommandResolution {
  /**
   * command: spawn 使用的可执行命令绝对路径或 Node/Electron 运行时路径。
   */
  command: string;

  /**
   * args: 传给中心服务命令的参数列表。
   */
  args: string[];

  /**
   * cwd: 中心服务进程工作目录。
   */
  cwd: string;

  /**
   * diagnostics: 启动失败时用于排查的命令解析摘要。
   */
  diagnostics: string;
}

/**
 * CloseActionPreference：桌面端关闭按钮行为偏好。
 *
 * 来源：用户首次点击窗口关闭按钮时的选择。
 * 含义：决定后续点击关闭按钮时是继续询问、直接退出还是隐藏到托盘。
 * 格式：固定字符串枚举。
 * 默认值：ask，避免替用户擅自决定退出或驻留托盘。
 * 约束：只影响桌面壳本机窗口行为，不进入中心服务事实源。
 */
type CloseActionPreference = "ask" | "quit" | "hide-to-tray";

// isDev: 未打包时按源码路径启动中心服务和前端构建产物。
const isDev = !app.isPackaged;
// appRoot: Electron 应用根目录。
const appRoot = app.getAppPath();
// repoRoot: 开发期仓库根目录。
const repoRoot = resolve(appRoot, "..", "..");
// iconPath: 应用图标固定使用 assets/app-icon/图标.png。
const iconPath = isDev
  ? join(repoRoot, "assets", "app-icon", "图标.png")
  : join(process.resourcesPath, "assets", "app-icon", "图标.png");
// preloadPath: Electron preload 运行在独立上下文，必须指向可直接执行的 CommonJS 文件，不能依赖 tsx 转译。
const preloadPath = fileURLToPath(new URL("./preload.cjs", import.meta.url));
// frontendDistPath: 中心服务托管的统一前端构建产物目录。
const frontendDistPath = isDev
  ? join(repoRoot, "apps", "frontend", "dist")
  : join(process.resourcesPath, "frontend");
// frontendDevUrl: 开发期前端 dev server 地址，由根开发脚本注入以获得热更新体验。
const frontendDevUrl = process.env.ZHIXIN_FRONTEND_DEV_URL;
// centerEntryPath: 开发期直接运行中心服务 TS 入口，绿色版运行随包中心服务入口。
const centerEntryPath = isDev
  ? join(repoRoot, "services", "center", "src", "index.ts")
  : join(process.resourcesPath, "center", "index.js");
// centerNativeBindingPath: better-sqlite3 原生绑定文件路径，开发期用于提前诊断中心服务无法监听的根因。
const centerNativeBindingPath = join(
  repoRoot,
  "services",
  "center",
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
);
// centerNodeExecutable: 开发期由启动编排显式传入的 Node 可执行文件，避免 PATH 里混入错误版本。
const centerNodeExecutable = process.env.ZHIXIN_CENTER_NODE_EXECUTABLE || process.execPath;
// desktopConfigPath: 桌面壳本机配置文件，保存中心服务端口和中心目录。
const desktopConfigPath = join(app.getPath("userData"), "desktop-config.json");
// DEFAULT_CLOSE_ACTION_PREFERENCE: 首次关闭窗口时必须询问用户，符合常见桌面应用关闭习惯。
const DEFAULT_CLOSE_ACTION_PREFERENCE: CloseActionPreference = "ask";
// PROJECT_ID_FILE_NAME：项目根目录中的固定项目身份文件名。
const PROJECT_ID_FILE_NAME = "致心项目ID.md";
// PROJECT_ID_PATTERN：项目身份必须为 UUID，避免损坏文件或目录名伪身份进入中心服务。
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// mainWindow: 主窗口引用，避免被垃圾回收。
let mainWindow: BrowserWindow | null = null;
// tray: 系统托盘引用。
let tray: Tray | null = null;
// centerProcess: 桌面壳管理的中心服务进程。
let centerProcess: ChildProcessWithoutNullStreams | null = null;
// lastCenterError: 最近一次中心服务启动或运行错误。
let lastCenterError = "";
// isAppQuitting: 区分用户点击关闭按钮和应用真正退出，避免退出流程被隐藏托盘逻辑拦截。
let isAppQuitting = false;
// centerLaunchConfig: 当前中心服务启动参数。
const centerLaunchConfig: CenterLaunchConfig = {
  port: DEFAULT_CENTER_PORT,
  centerDirectory: isDev
    ? join(repoRoot, CENTER_DATA_DIR_NAME)
    : join(process.cwd(), CENTER_DATA_DIR_NAME),
};

/**
 * DesktopConfigFile：桌面壳本机配置文件结构。
 *
 * 来源：桌面端中心服务管理页面。
 * 含义：保存端口和中心目录，供下次启动中心服务使用。
 * 格式：JSON 对象。
 * 默认值：端口 8866，中心目录按开发期或绿色版默认位置。
 * 约束：该文件只保存本机启动配置，不保存会话、供应商或记忆事实。
 */
interface DesktopConfigFile {
  /**
   * port: 中心服务监听端口。
   */
  port: number;

  /**
   * centerDirectory: 中心目录绝对路径。
   */
  centerDirectory: string;

  /**
   * closeActionPreference: 窗口关闭按钮行为偏好。
   */
  closeActionPreference: CloseActionPreference;
}

/**
 * DesktopProjectIdentity：桌面端项目目录身份结果。
 *
 * 来源：用户选择的项目根目录和根目录内 `致心项目ID.md`。
 * 含义：传给渲染进程登记中心服务项目索引。
 * 格式：JSON 对象。
 * 默认值：用户取消目录选择时由调用方返回 null。
 * 约束：projectId 必须是 UUID，latestPath 必须是目录路径。
 */
interface DesktopProjectIdentity {
  /**
   * projectId: 项目 UUID，来源于项目身份文件。
   */
  projectId: string;

  /**
   * displayName: 项目文件夹名。
   */
  displayName: string;

  /**
   * latestPath: 当前选择的项目根目录绝对路径。
   */
  latestPath: string;
}

/**
 * normalizeCloseActionPreference：把配置文件中的关闭偏好约束为支持值。
 *
 * @param preference 配置文件或运行期传入的关闭偏好。
 * @returns 合法关闭偏好；非法时返回 ask，确保首次关闭仍由用户决定。
 */
function normalizeCloseActionPreference(preference: unknown): CloseActionPreference {
  return preference === "quit" || preference === "hide-to-tray"
    ? preference
    : DEFAULT_CLOSE_ACTION_PREFERENCE;
}

/**
 * isExternalCenterDirectory：判断中心目录是否为用户外部目录。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 是外部中心目录时返回 true。
 */
function isExternalCenterDirectory(centerDirectory: string): boolean {
  // defaultDirectory: 当前运行形态下的默认中心目录，绿色版默认随解压目录删除。
  const defaultDirectory = isDev
    ? join(repoRoot, CENTER_DATA_DIR_NAME)
    : join(process.cwd(), CENTER_DATA_DIR_NAME);
  return resolve(centerDirectory) !== resolve(defaultDirectory);
}

/**
 * readDesktopConfig：读取桌面壳本机配置。
 *
 * @returns 合并默认值后的桌面配置。
 */
function readDesktopConfig(): DesktopConfigFile {
  if (!existsSync(desktopConfigPath)) {
    return {
      port: centerLaunchConfig.port,
      centerDirectory: centerLaunchConfig.centerDirectory,
      closeActionPreference: DEFAULT_CLOSE_ACTION_PREFERENCE,
    };
  }

  try {
    // parsed: 本机配置来自用户目录，解析失败时回退默认值避免桌面壳无法启动。
    const parsed = JSON.parse(readFileSync(desktopConfigPath, "utf-8")) as Partial<DesktopConfigFile>;
    return {
      port: normalizePort(parsed.port),
      centerDirectory: parsed.centerDirectory
        ? resolve(parsed.centerDirectory)
        : centerLaunchConfig.centerDirectory,
      closeActionPreference: normalizeCloseActionPreference(parsed.closeActionPreference),
    };
  } catch (error) {
    lastCenterError = error instanceof Error ? error.message : "桌面配置读取失败";
    return {
      port: centerLaunchConfig.port,
      centerDirectory: centerLaunchConfig.centerDirectory,
      closeActionPreference: DEFAULT_CLOSE_ACTION_PREFERENCE,
    };
  }
}

/**
 * writeDesktopConfig：保存桌面壳本机配置。
 *
 * @param config 桌面壳本机配置。
 * @returns 没有返回值。
 */
function writeDesktopConfig(config: DesktopConfigFile): void {
  mkdirSync(dirname(desktopConfigPath), {
    recursive: true,
  });
  writeFileSync(desktopConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

// desktopConfig: 当前桌面壳本机配置缓存，中心服务配置和关闭按钮偏好共用同一个本机文件。
let desktopConfig = readDesktopConfig();

/**
 * writeCenterRuntimeLog：写入桌面壳管理中心服务的开发期运行日志。
 *
 * @param message 日志正文。
 * @returns 没有返回值。
 */
function writeCenterRuntimeLog(message: string): void {
  try {
    // logPath: 日志放在中心目录下，方便和中心服务自身日志一起排查启动链路。
    const logPath = join(
      centerLaunchConfig.centerDirectory,
      "logs",
      "desktop-center-runtime.log",
    );
    mkdirSync(dirname(logPath), {
      recursive: true,
    });
    appendFileSync(
      logPath,
      `[${new Date().toISOString()}] ${message}\n`,
      "utf-8",
    );
  } catch {
    // 日志写入失败不能阻断桌面壳启动；IPC 状态仍会返回 lastCenterError。
  }
}

/**
 * normalizePort：把用户输入端口约束为合法 TCP 端口。
 *
 * @param port 用户输入端口。
 * @returns 合法端口；非法时返回架构默认端口。
 */
function normalizePort(port: unknown): number {
  const parsedPort = typeof port === "number" ? port : Number.parseInt(String(port), 10);
  return Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
    ? parsedPort
    : DEFAULT_CENTER_PORT;
}

/**
 * assertProjectId：校验项目身份文件内容必须是 UUID。
 *
 * @param projectId 从身份文件读取或新生成的项目 ID。
 * @returns 去除首尾空白后的 UUID。
 */
function assertProjectId(projectId: string): string {
  // normalizedProjectId: 文件内容允许末尾换行，但不能包含非 UUID 文本。
  const normalizedProjectId = projectId.trim();
  if (!PROJECT_ID_PATTERN.test(normalizedProjectId)) {
    throw new Error(`${PROJECT_ID_FILE_NAME} 内容不是合法 UUID，已停止登记项目。`);
  }
  return normalizedProjectId;
}

/**
 * ensureProjectDirectoryIdentity：读取或创建项目根目录身份文件。
 *
 * @param projectDirectory 用户选择的项目根目录。
 * @returns 项目 UUID。
 */
function ensureProjectDirectoryIdentity(projectDirectory: string): string {
  // identityFilePath: 身份文件必须位于项目根目录，不能写入中心目录或其他位置。
  const identityFilePath = join(projectDirectory, PROJECT_ID_FILE_NAME);
  if (existsSync(identityFilePath)) {
    return assertProjectId(readFileSync(identityFilePath, "utf-8"));
  }

  // projectId: 文件缺失时生成新的 UUID，并写入“UUID 加换行”便于人工查看。
  const projectId = randomUUID();
  writeFileSync(
    identityFilePath,
    `${projectId}\n`,
    "utf-8",
  );
  return projectId;
}

/**
 * selectProjectDirectoryAndEnsureIdentity：通过桌面原生对话框选择项目目录并确保身份文件存在。
 *
 * @returns 用户取消时返回 null，否则返回项目身份、显示名和最新路径。
 */
async function selectProjectDirectoryAndEnsureIdentity(): Promise<DesktopProjectIdentity | null> {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: "选择项目文件夹",
    properties: [
      "openDirectory",
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  // latestPath: 原生目录选择只允许返回目录，但仍做一次目录校验，避免异常路径进入后续写入。
  const latestPath = resolve(result.filePaths[0]);
  if (!statSync(latestPath).isDirectory()) {
    throw new Error("选择的路径不是文件夹，无法创建项目对话。");
  }

  // displayName: 项目主名称使用文件夹名，根路径无文件名时回退完整路径避免空名称。
  const displayName = latestPath.split(/[\\/]/u).filter((part) => part.length > 0).pop() ?? latestPath;
  if (displayName.trim().length === 0) {
    throw new Error("项目文件夹名称为空，无法创建项目对话。");
  }

  return {
    projectId: ensureProjectDirectoryIdentity(latestPath),
    displayName,
    latestPath,
  };
}

/**
 * resolveCenterCommand：解析桌面壳管理的中心服务启动命令。
 *
 * @returns 成功时返回命令解析结果，失败时返回 null 并写入 lastCenterError。
 */
function resolveCenterCommand(): CenterCommandResolution | null {
  if (isDev && !existsSync(centerNativeBindingPath)) {
    lastCenterError = [
      "中心服务缺少 better-sqlite3 原生绑定，无法启动 SQLite 数据库。",
      `缺失文件：${centerNativeBindingPath}`,
      "请在仓库根目录执行：pnpm rebuild better-sqlite3 --filter @zhixin/center",
      `中心入口：${centerEntryPath}`,
      `中心目录：${centerLaunchConfig.centerDirectory}`,
      `端口：${centerLaunchConfig.port}`,
    ].join("\n");
    return null;
  }

  if (!isDev) {
    return {
      command: process.execPath,
      args: [
        centerEntryPath,
      ],
      cwd: process.resourcesPath,
      diagnostics: `command=${process.execPath}; entry=${centerEntryPath}; cwd=${process.resourcesPath}`,
    };
  }

  // tsxCommand: Windows 使用 .CMD 包装脚本，其他平台使用无后缀可执行文件。
  const tsxCommand = process.platform === "win32" ? "tsx.CMD" : "tsx";
  // centerPackageDirectory: 中心服务包目录，开发期应优先使用这里的 tsx，保证依赖解析与中心服务包一致。
  const centerPackageDirectory = join(
    repoRoot,
    "services",
    "center",
  );
  // desktopPackageDirectory: 桌面壳包目录，作为开发期兜底命令来源。
  const desktopPackageDirectory = join(
    repoRoot,
    "apps",
    "desktop-shell",
  );
  // candidateCommands: 按包职责顺序查找可执行 tsx，不依赖根 node_modules，避免 pnpm 安装布局下找错命令。
  const candidateCommands = [
    join(
      centerPackageDirectory,
      "node_modules",
      ".bin",
      tsxCommand,
    ),
    join(
      desktopPackageDirectory,
      "node_modules",
      ".bin",
      tsxCommand,
    ),
  ];
  // command: 第一个存在的 tsx 命令，缺失时返回明确诊断。
  const command = candidateCommands.find((candidateCommand) => existsSync(candidateCommand));

  if (!command) {
    lastCenterError = [
      "开发期中心服务启动命令不存在。",
      `已检查：${candidateCommands.join("；")}`,
      `中心入口：${centerEntryPath}`,
      `中心目录：${centerLaunchConfig.centerDirectory}`,
      `端口：${centerLaunchConfig.port}`,
    ].join("\n");
    return null;
  }

  return {
    command,
    args: [
      centerEntryPath,
    ],
    cwd: centerPackageDirectory,
    diagnostics: [
      `command=${command}`,
      `node=${centerNodeExecutable}`,
      `entry=${centerEntryPath}`,
      `cwd=${centerPackageDirectory}`,
      `port=${centerLaunchConfig.port}`,
      `centerDir=${centerLaunchConfig.centerDirectory}`,
    ].join("; "),
  };
}

/**
 * resolveCenterProcessPath：生成中心服务子进程 PATH。
 *
 * @param basePath 当前桌面壳进程 PATH。
 * @returns 把中心服务 Node 可执行文件目录放到最前面的 PATH。
 */
function resolveCenterProcessPath(basePath: string | undefined): string {
  // nodeDirectory: Windows 的 tsx.CMD 会按 PATH 查找 node，必须优先使用桌面壳显式传入的 Node 版本。
  const nodeDirectory = dirname(centerNodeExecutable);
  return [
    nodeDirectory,
    basePath ?? "",
  ].filter((part) => part.length > 0).join(process.platform === "win32" ? ";" : ":");
}

/**
 * applyDesktopConfig：把本机配置应用到中心服务启动参数。
 *
 * @param config 桌面壳本机配置。
 * @returns 没有返回值。
 */
function applyDesktopConfig(config: DesktopConfigFile): void {
  centerLaunchConfig.port = normalizePort(config.port);
  centerLaunchConfig.centerDirectory = resolve(config.centerDirectory);
}

/**
 * saveAccessAccountConfig：保存远程 Web 账号密码摘要到中心目录。
 *
 * @param account 远程 Web 访问账号。
 * @param password 远程 Web 访问密码明文，仅用于生成 SHA-256 摘要。
 * @returns 保存结果。
 */
function saveAccessAccountConfig(account: string, password: string): {
  ok: boolean;
  errorMessage: string;
} {
  if (!account || !password) {
    return {
      ok: false,
      errorMessage: "账号和密码不能为空。",
    };
  }

  // accessConfigPath: 中心服务读取的访问控制配置文件，属于中心目录可迁移配置。
  const accessConfigPath = join(centerLaunchConfig.centerDirectory, "config", "access.json");
  mkdirSync(dirname(accessConfigPath), {
    recursive: true,
  });
  writeFileSync(accessConfigPath, `${JSON.stringify({
    webAccountConfigured: true,
    account,
    passwordSha256: createHash("sha256").update(password).digest("hex"),
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf-8");

  return {
    ok: true,
    errorMessage: "",
  };
}

applyDesktopConfig(desktopConfig);

/**
 * persistDesktopConfig：保存并更新桌面壳本机配置缓存。
 *
 * @param nextConfig 下一份完整桌面壳本机配置。
 * @returns 没有返回值。
 */
function persistDesktopConfig(nextConfig: DesktopConfigFile): void {
  desktopConfig = nextConfig;
  writeDesktopConfig(desktopConfig);
}

/**
 * updateCloseActionPreference：保存关闭按钮行为偏好。
 *
 * @param preference 用户选择的关闭行为偏好。
 * @returns 没有返回值。
 */
function updateCloseActionPreference(preference: CloseActionPreference): void {
  persistDesktopConfig({
    ...desktopConfig,
    closeActionPreference: preference,
  });
}

/**
 * hideMainWindowToTray：隐藏主窗口到系统托盘。
 *
 * @returns 没有返回值。
 */
function hideMainWindowToTray(): void {
  // hide: 隐藏窗口但保留应用和中心服务运行，用户可从托盘恢复。
  mainWindow?.hide();
}

/**
 * requestApplicationQuit：进入真正退出流程。
 *
 * @returns 没有返回值。
 */
function requestApplicationQuit(): void {
  // isAppQuitting: 后续 close 事件不再弹出或隐藏，保证 app.quit 能继续完成。
  isAppQuitting = true;
  app.quit();
}

/**
 * handleMainWindowClose：处理用户点击窗口关闭按钮的行为。
 *
 * @param event Electron 窗口关闭事件。
 * @returns 异步处理完成后没有返回值。
 */
async function handleMainWindowClose(event: Electron.Event): Promise<void> {
  if (isAppQuitting) {
    return;
  }

  if (desktopConfig.closeActionPreference === "quit") {
    requestApplicationQuit();
    return;
  }

  if (desktopConfig.closeActionPreference === "hide-to-tray") {
    event.preventDefault();
    hideMainWindowToTray();
    return;
  }

  // preventDefault: 首次关闭需要等用户选择，不能让 Electron 先销毁窗口。
  event.preventDefault();

  const result = await dialog.showMessageBox(mainWindow!, {
    type: "question",
    title: "关闭致心智能体",
    message: "关闭窗口时要直接退出，还是隐藏到系统托盘继续运行？",
    detail: "隐藏到托盘后，中心服务会继续运行，可从托盘菜单重新打开窗口。",
    buttons: [
      "隐藏到托盘",
      "直接退出",
      "取消",
    ],
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: "记住我的选择",
    checkboxChecked: false,
    noLink: true,
  });

  if (result.response === 0) {
    if (result.checkboxChecked) {
      updateCloseActionPreference("hide-to-tray");
    }
    hideMainWindowToTray();
    return;
  }

  if (result.response === 1) {
    if (result.checkboxChecked) {
      updateCloseActionPreference("quit");
    }
    requestApplicationQuit();
  }
}

/**
 * startCenterService：启动桌面壳管理的中心服务。
 *
 * @returns 没有返回值。
 */
function startCenterService(): void {
  if (centerProcess) {
    return;
  }

  mkdirSync(centerLaunchConfig.centerDirectory, {
    recursive: true,
  });

  // resolvedCommand: 区分“命令已解析”和“中心服务实际监听”，避免命令缺失时静默显示运行中。
  const resolvedCommand = resolveCenterCommand();
  if (!resolvedCommand) {
    writeCenterRuntimeLog(lastCenterError);
    return;
  }

  writeCenterRuntimeLog(`start ${resolvedCommand.diagnostics}`);

  centerProcess = spawn(resolvedCommand.command, resolvedCommand.args, {
    cwd: resolvedCommand.cwd,
    env: {
      ...process.env,
      Path: resolveCenterProcessPath(process.env.Path),
      PATH: resolveCenterProcessPath(process.env.PATH),
      ZHIXIN_CENTER_PORT: String(centerLaunchConfig.port),
      ZHIXIN_CENTER_DIR: centerLaunchConfig.centerDirectory,
      ZHIXIN_FRONTEND_DIST: frontendDistPath,
      ZHIXIN_FRONTEND_DEV_URL: frontendDevUrl ?? "",
    },
    shell: isDev,
    stdio: "pipe",
    windowsHide: true,
  });

  centerProcess.on("error", (error) => {
    lastCenterError = `中心服务启动失败：${error.message}\n${resolvedCommand.diagnostics}`;
    writeCenterRuntimeLog(`error ${lastCenterError}`);
    centerProcess = null;
  });
  centerProcess.stderr.on("data", (chunk) => {
    lastCenterError = [
      Buffer.from(chunk).toString("utf-8"),
      resolvedCommand.diagnostics,
    ].join("\n");
    writeCenterRuntimeLog(`stderr ${lastCenterError}`);
    console.error(lastCenterError);
  });
  centerProcess.stdout.on("data", (chunk) => {
    const output = Buffer.from(chunk).toString("utf-8");
    writeCenterRuntimeLog(`stdout ${output}`);
    console.log(output);
  });
  centerProcess.on("exit", (code) => {
    if (code && !lastCenterError) {
      lastCenterError = `中心服务退出，退出码：${code}\n${resolvedCommand.diagnostics}`;
    }
    writeCenterRuntimeLog(`exit code=${code ?? "null"} error=${lastCenterError || ""}`);
    centerProcess = null;
  });
}

/**
 * stopCenterService：停止桌面壳管理的中心服务。
 *
 * @returns 没有返回值。
 */
function stopCenterService(): void {
  if (!centerProcess) {
    return;
  }

  const pid = centerProcess.pid;

  if (process.platform === "win32" && typeof pid === "number") {
    spawnSync(
      "taskkill",
      [
        "/pid",
        String(pid),
        "/t",
        "/f",
      ],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
  } else {
    centerProcess.kill();
  }

  centerProcess = null;
}

/**
 * resolveDesktopWindowUrl：规范桌面主窗口加载入口。
 *
 * @returns 指向中心服务托管入口的 URL。
 */
function resolveDesktopWindowUrl(): string {
  // targetUrl: 桌面壳始终从中心服务地址进入页面，开发期 HMR 由中心服务重定向处理，避免混出 /chat?port=8866#/chat。
  const targetUrl = new URL(`http://127.0.0.1:${centerLaunchConfig.port}/`);
  // port: 前端 API 客户端读取的中心服务端口，来源于桌面壳本机配置。
  targetUrl.searchParams.set(
    "port",
    String(centerLaunchConfig.port),
  );
  return targetUrl.toString();
}

/**
 * createWindow：创建桌面端主窗口。
 *
 * @returns 窗口加载完成后没有返回值。
 */
async function createWindow(): Promise<void> {
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.webContents.on("did-navigate", (_event, url) => {
    // url: Electron 实际加载地址，写入日志用于区分 Vite 开发页和中心服务托管页。
    writeCenterRuntimeLog(`window-did-navigate ${url}`);
  });
  mainWindow.webContents.on("did-navigate-in-page", (_event, url) => {
    // url: hash 路由页内导航地址，用于排查菜单点击后 URL 与主体是否同步。
    writeCenterRuntimeLog(`window-did-navigate-in-page ${url}`);
  });
  // maximize: 默认最大化必须显式调用；width/height 仅作为无法最大化环境下的回退窗口尺寸。
  mainWindow.maximize();
  mainWindow.on("close", (event) => {
    void handleMainWindowClose(event);
  });

  if (isDev) {
    // clearCache: 开发期必须优先使用 Vite 最新模块，避免 Electron 会话缓存旧 RouterView 产物。
    await mainWindow.webContents.session.clearCache();
  }

  // 生产期和无前端 dev server 的开发兜底都走中心服务 HTTP 页面。
  // Vite 拆包后的 ES module 不能可靠通过普通 file:// 页面加载，统一由中心服务托管静态资源。
  const targetUrl = resolveDesktopWindowUrl();
  writeCenterRuntimeLog(`window-load-url ${targetUrl}`);
  await mainWindow.loadURL(targetUrl);
}

/**
 * registerIpc：注册桌面壳白名单 IPC。
 *
 * @returns 没有返回值。
 */
function registerIpc(): void {
  ipcMain.handle("zhixin:center-status", () => ({
    running: Boolean(centerProcess),
    errorMessage: lastCenterError,
    port: centerLaunchConfig.port,
    centerDirectory: centerLaunchConfig.centerDirectory,
    isExternalCenterDirectory: isExternalCenterDirectory(centerLaunchConfig.centerDirectory),
  }));

  ipcMain.handle("zhixin:center-config-update", (_event, payload: {
    port?: number;
    centerDirectory?: string;
  }) => {
    lastCenterError = "";
    const nextConfig: DesktopConfigFile = {
      port: normalizePort(payload.port),
      centerDirectory: payload.centerDirectory
        ? resolve(payload.centerDirectory)
        : centerLaunchConfig.centerDirectory,
      closeActionPreference: desktopConfig.closeActionPreference,
    };
    applyDesktopConfig(nextConfig);
    persistDesktopConfig(nextConfig);
    stopCenterService();
    startCenterService();
    mainWindow?.webContents.send("zhixin:center-config-changed", {
      port: centerLaunchConfig.port,
      centerDirectory: centerLaunchConfig.centerDirectory,
    });

    return {
      ok: !lastCenterError,
      errorMessage: lastCenterError,
      port: centerLaunchConfig.port,
      centerDirectory: centerLaunchConfig.centerDirectory,
      isExternalCenterDirectory: isExternalCenterDirectory(centerLaunchConfig.centerDirectory),
    };
  });

  ipcMain.handle("zhixin:access-account-save", (_event, payload: {
    account?: string;
    password?: string;
  }) => saveAccessAccountConfig(payload.account ?? "", payload.password ?? ""));

  ipcMain.handle("zhixin:notification-permission", () => ({
    permission: Notification.isSupported() ? "supported" : "unsupported",
    checkedAt: new Date().toISOString(),
  }));

  ipcMain.handle("zhixin:project-directory-select", () => selectProjectDirectoryAndEnsureIdentity());

  ipcMain.handle("zhixin:center-start", () => {
    lastCenterError = "";
    startCenterService();
    return {
      ok: !lastCenterError,
      errorMessage: lastCenterError,
    };
  });

  ipcMain.handle("zhixin:center-stop", () => {
    lastCenterError = "";
    stopCenterService();
    return {
      ok: true,
      errorMessage: "",
    };
  });

  ipcMain.handle("zhixin:center-restart", () => {
    lastCenterError = "";
    stopCenterService();
    startCenterService();
    return {
      ok: !lastCenterError,
      errorMessage: lastCenterError,
    };
  });
}

/**
 * createTray：创建系统托盘。
 *
 * @returns 没有返回值。
 */
function createTray(): void {
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "显示致心智能体",
      click: () => mainWindow?.show(),
    },
    {
      label: "退出",
      click: () => requestApplicationQuit(),
    },
  ]));
}

void app.whenReady().then(async () => {
  registerIpc();
  startCenterService();
  await createWindow();
  createTray();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isAppQuitting) {
    app.quit();
  }
});

app.on("activate", () => {
  if (!mainWindow) {
    void createWindow();
  }
});

app.on("before-quit", () => {
  isAppQuitting = true;
  stopCenterService();
});
