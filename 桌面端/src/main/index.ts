import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from "electron";
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CENTER_PORT, ZHIXIN_APP_NAME } from "@zhixin/shared";

// __filename：ESM 环境下获取当前文件路径。
const __filename = fileURLToPath(import.meta.url);
// __dirname：Electron 主进程编译后所在目录。
const __dirname = dirname(__filename);
// isDev：开发期由 Vite 提供页面，生产期加载 dist HTML。
const isDev = !app.isPackaged;
// iconPath：统一应用图标路径，用于窗口、托盘、任务栏和安装包配置。
const iconPath = join(app.getAppPath(), "图标.png");
// preloadPath：preload 运行在 Electron 独立上下文，使用运行时可直接解析的 CommonJS 文件。
const preloadPath = isDev
  ? resolve(__dirname, "preload.cjs")
  : join(__dirname, "preload.cjs");

// mainWindow：桌面端主窗口引用，避免被垃圾回收。
let mainWindow: BrowserWindow | null = null;
// tray：系统托盘引用，避免被垃圾回收。
let tray: Tray | null = null;
// centerProcess：随桌面端启动和管理的中心服务进程。
let centerProcess: ChildProcessWithoutNullStreams | null = null;
// lastCenterError：中心服务启动或运行失败原因，设置页重启按钮会展示。
let lastCenterError = "";
// centerLaunchConfig：桌面端主进程用于下次启动中心服务的端口和中心目录。
let centerLaunchConfig = {
  // port：中心服务默认端口，后续由中心服务页配置同步覆盖。
  port: DEFAULT_CENTER_PORT,
  // centerDirectory：开发期默认工程根目录/中心，生产期默认应用启动位置/中心。
  centerDirectory: isDev
    ? join(app.getAppPath(), "..", "中心")
    : join(process.cwd(), "中心"),
};

// readSavedCenterLaunchConfig：从中心目录配置文件读取上次保存的端口和目录。
function readSavedCenterLaunchConfig(): void {
  // configPath：只有当前启动目录下的中心配置能在中心服务启动前读取；用户迁移目录后由渲染层同步主进程。
  const configPath = join(centerLaunchConfig.centerDirectory, "config.json");
  if (!existsSync(configPath)) {
    return;
  }
  try {
    // saved：中心服务写入的本机配置，主进程只读取启动所需字段。
    const saved = JSON.parse(readFileSync(configPath, "utf-8")) as {
      // port：用户保存的中心服务端口。
      port?: number;
      // centerDirectory：用户保存的中心目录。
      centerDirectory?: string;
    };
    // port：只接受合法数字，避免配置损坏导致启动失败。
    if (typeof saved.port === "number" && Number.isFinite(saved.port)) {
      centerLaunchConfig.port = saved.port;
    }
    // centerDirectory：只接受非空字符串，避免把中心目录置空。
    if (typeof saved.centerDirectory === "string" && saved.centerDirectory.trim()) {
      centerLaunchConfig.centerDirectory = saved.centerDirectory;
    }
  } catch (error) {
    // lastCenterError：配置损坏不阻断默认启动，但要保留排查信息。
    lastCenterError = error instanceof Error ? error.message : "读取中心服务启动配置失败";
  }
}

// startCenterService：启动随包携带或开发期源码中的中心服务。
function startCenterService(): void {
  // existing：已有进程时不重复启动，避免端口冲突。
  if (centerProcess) {
    return;
  }
  // centerEntry：生产期优先使用随桌面端打包的中心服务产物。
  const centerEntry = isDev
    ? join(app.getAppPath(), "..", "中心服务", "src", "index.ts")
    : join(process.resourcesPath, "中心服务", "dist", "index.js");
  // tsxCommand：开发期沿用中心服务自己的 tsx 启动方式，避免 Node 版本差异导致 .ts 入口无法加载。
  const tsxCommand = process.platform === "win32" ? "tsx.CMD" : "tsx";
  // command：开发期用 tsx CLI 运行中心服务源码，生产期运行打包后的 JS 文件。
  const command = isDev ? join(app.getAppPath(), "node_modules", ".bin", tsxCommand) : process.execPath;
  // args：开发期由 tsx 直接接管 TS 入口，生产期运行打包后的 JS 文件。
  const args = isDev ? [centerEntry] : [centerEntry];
  // env：桌面端负责配置中心服务端口。
  const env = {
    ...process.env,
    ZHIXIN_CENTER_PORT: String(centerLaunchConfig.port),
    // ZHIXIN_CENTER_DIR：由桌面端主进程统一传入，避免中心服务自行落到系统用户目录。
    ZHIXIN_CENTER_DIR: centerLaunchConfig.centerDirectory,
  };
  // centerProcess：保留进程引用，退出桌面端时停止中心服务。
  centerProcess = spawn(command, args, {
    env,
    cwd: app.getAppPath(),
    stdio: "pipe",
    shell: isDev,
    windowsHide: true,
  });
  // error：spawn 失败时必须记录而不是冒泡成 Electron 主进程未捕获异常弹窗。
  centerProcess.on("error", (error) => {
    // lastCenterError：展示真实启动失败原因，便于设置页和日志排查。
    lastCenterError = error.message;
    // centerProcess：启动失败后允许用户重新触发启动。
    centerProcess = null;
  });
  // stderr：记录中心服务启动失败原因，避免设置页只能看到连接失败。
  centerProcess.stderr.on("data", (chunk) => {
    // lastCenterError：只保存最近一次错误摘要。
    lastCenterError = Buffer.from(chunk).toString("utf-8");
    // console.error：开发期把中心服务失败原因输出到 IDEA Terminal，避免只在 UI 里看到未连接。
    console.error(lastCenterError);
  });
  // stdout：开发期保留中心服务启动日志，方便确认服务已经监听。
  centerProcess.stdout.on("data", (chunk) => {
    // message：中心服务日志是 UTF-8 文本。
    const message = Buffer.from(chunk).toString("utf-8");
    // console.log：输出到桌面端开发终端，不影响生产逻辑。
    console.log(message);
  });
  // on exit：中心服务退出后清空引用，后续可重启。
  centerProcess.on("exit", (code) => {
    // lastCenterError：非 0 退出时保留退出码，供 UI 展示。
    if (code && !lastCenterError) {
      lastCenterError = `中心服务退出，退出码：${code}`;
    }
    // centerProcess：进程结束后允许重启。
    centerProcess = null;
  });
}

// stopCenterService：停止桌面端管理的中心服务进程。
function stopCenterService(): void {
  // centerProcess：没有进程时无需处理。
  if (!centerProcess) {
    return;
  }
  // pid：开发期 Windows 会通过 shell 启动 tsx.CMD，必须按进程树结束，避免中心服务 Node 子进程残留。
  const pid = centerProcess.pid;
  // windows：taskkill /t 会结束 cmd、tsx 和中心服务 Node 子进程整棵树。
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
    // kill：非 Windows 平台没有 cmd 子进程树问题时使用默认信号结束中心服务。
    centerProcess.kill();
  }
  // centerProcess：立即清空引用，避免重复 kill。
  centerProcess = null;
}

// createWindow：创建桌面端主窗口。
async function createWindow(): Promise<void> {
  // icon：如果图标存在则作为窗口图标。
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;
  // mainWindow：主界面承载普通对话、工程对话和配置入口。
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: ZHIXIN_APP_NAME,
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
    },
  });
  // setMenuBarVisibility：桌面端使用应用内头部菜单，隐藏 Electron 原生菜单栏避免出现两套导航。
  mainWindow.setMenuBarVisibility(false);
  // setAutoHideMenuBar：Windows 下按 Alt 也不唤起原生菜单栏，保持应用内菜单为唯一入口。
  mainWindow.setAutoHideMenuBar(true);
  // loadURL：开发期连接 Vite 服务。
  if (isDev) {
    await mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    // loadFile：生产期加载构建后的渲染层入口。
    await mainWindow.loadFile(join(app.getAppPath(), "dist", "index.html"));
  }
}

// registerIpc：注册桌面端主进程能力，渲染层只能通过白名单 IPC 调用。
function registerIpc(): void {
  // get-center-service-status：返回桌面端管理的中心服务进程状态和最近错误。
  ipcMain.handle("get-center-service-status", () => {
    // running：只表示桌面端当前持有中心服务进程，不代表 HTTP 健康检查一定成功。
    const running = Boolean(centerProcess);
    // result：渲染层头部开关用该状态决定显示启动或停止。
    return {
      running,
      errorMessage: lastCenterError,
    };
  });
  // start-center-service：由头部开关触发启动中心服务。
  ipcMain.handle("start-center-service", async () => {
    // lastCenterError：启动前清理旧错误，避免旧错误影响本次结果。
    lastCenterError = "";
    // startCenterService：已有进程时内部会直接返回，避免端口冲突。
    startCenterService();
    // wait：给中心服务一个短暂启动窗口，错误会进入 stderr 监听。
    await new Promise((resolve) => {
      setTimeout(resolve, 800);
    });
    // result：渲染层根据 ok 展示连接状态。
    return {
      ok: !lastCenterError,
      errorMessage: lastCenterError,
    };
  });
  // stop-center-service：由头部开关触发停止中心服务。
  ipcMain.handle("stop-center-service", () => {
    // lastCenterError：用户主动停止不是错误。
    lastCenterError = "";
    // stopCenterService：停止桌面端管理的中心服务进程。
    stopCenterService();
    // result：返回固定成功结果，渲染层随后刷新健康状态。
    return {
      ok: true,
      errorMessage: "",
    };
  });
  // restart-center-service：停止并重新拉起中心服务，返回启动失败原因。
  ipcMain.handle("restart-center-service", async () => {
    // lastCenterError：每次重启前清理旧错误。
    lastCenterError = "";
    // stopCenterService：先停止桌面端管理的进程。
    stopCenterService();
    // startCenterService：再按当前桌面端配置启动。
    startCenterService();
    // wait：给中心服务一个短暂启动窗口，错误会进入 stderr 监听。
    await new Promise((resolve) => {
      setTimeout(resolve, 800);
    });
    // result：渲染层用于展示启动失败原因。
    return {
      ok: !lastCenterError,
      errorMessage: lastCenterError,
    };
  });
  // update-center-service-launch-config：保存配置后同步主进程，下一次启动或重启中心服务时生效。
  ipcMain.handle("update-center-service-launch-config", (_event, config: {
    // port：中心服务监听端口。
    port?: number;
    // centerDirectory：中心目录绝对路径。
    centerDirectory?: string;
  }) => {
    // port：只接受合法数字，防止渲染层异常值污染主进程启动配置。
    if (typeof config.port === "number" && Number.isFinite(config.port)) {
      centerLaunchConfig.port = config.port;
    }
    // centerDirectory：只接受非空字符串，避免启动目录变成空值。
    if (typeof config.centerDirectory === "string" && config.centerDirectory.trim()) {
      centerLaunchConfig.centerDirectory = config.centerDirectory;
    }
    return {
      ok: true,
      errorMessage: "",
    };
  });
}

// createTray：创建系统托盘入口。
function createTray(): void {
  // icon：托盘图标和应用图标使用同一个“图标.png”。
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  // tray：保留引用，系统托盘持续存在。
  tray = new Tray(icon);
  // setToolTip：托盘悬停展示应用名。
  tray.setToolTip(ZHIXIN_APP_NAME);
  // setContextMenu：提供显示窗口和退出入口。
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "显示致心智能体",
      click: () => mainWindow?.show(),
    },
    {
      label: "退出",
      click: () => app.quit(),
    },
  ]));
}

// whenReady：Electron 初始化完成后启动中心服务和窗口。
app.whenReady().then(async () => {
  // readSavedCenterLaunchConfig：启动中心服务前读取桌面端上次保存的本机配置。
  readSavedCenterLaunchConfig();
  // registerIpc：窗口创建前注册 IPC，避免按钮调用时找不到处理器。
  registerIpc();
  // startCenterService：桌面端负责启动中心服务。
  startCenterService();
  // createWindow：创建主窗口。
  await createWindow();
  // createTray：创建系统托盘。
  createTray();
});

// window-all-closed：Windows/Linux 下关闭全部窗口时退出应用。
app.on("window-all-closed", () => {
  // darwin：macOS 保留应用生命周期。
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// activate：macOS 点击 Dock 图标时恢复窗口。
app.on("activate", () => {
  // mainWindow：窗口不存在时重新创建。
  if (!mainWindow) {
    void createWindow();
  }
});

// before-quit：退出前停止中心服务。
app.on("before-quit", () => {
  // stopCenterService：避免中心服务脱离桌面端残留。
  stopCenterService();
});
