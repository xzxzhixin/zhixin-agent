import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
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

// mainWindow：桌面端主窗口引用，避免被垃圾回收。
let mainWindow: BrowserWindow | null = null;
// tray：系统托盘引用，避免被垃圾回收。
let tray: Tray | null = null;
// centerProcess：随桌面端启动和管理的中心服务进程。
let centerProcess: ChildProcessWithoutNullStreams | null = null;
// lastCenterError：中心服务启动或运行失败原因，设置页重启按钮会展示。
let lastCenterError = "";

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
  // command：开发期用 pnpm tsx 运行源码，生产期用 node 运行构建产物。
  const command = isDev ? "pnpm" : process.execPath;
  // args：开发期通过 pnpm exec tsx 启动中心服务。
  const args = isDev ? ["exec", "tsx", centerEntry] : [centerEntry];
  // env：桌面端负责配置中心服务端口，首版使用默认端口。
  const env = {
    ...process.env,
    ZHIXIN_CENTER_PORT: String(DEFAULT_CENTER_PORT),
  };
  // centerProcess：保留进程引用，退出桌面端时停止中心服务。
  centerProcess = spawn(command, args, {
    env,
    cwd: app.getAppPath(),
    stdio: "pipe",
    windowsHide: true,
  });
  // stderr：记录中心服务启动失败原因，避免设置页只能看到连接失败。
  centerProcess.stderr.on("data", (chunk) => {
    // lastCenterError：只保存最近一次错误摘要。
    lastCenterError = Buffer.from(chunk).toString("utf-8");
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
  // kill：桌面端退出时结束随包中心服务。
  centerProcess.kill();
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
      preload: join(__dirname, "preload.js"),
      sandbox: true,
    },
  });
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
