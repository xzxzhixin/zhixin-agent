import { contextBridge, ipcRenderer } from "electron";

// DesktopBridge：渲染层允许调用的桌面端主进程能力。
export interface DesktopBridge {
  // getCenterServiceStatus：读取桌面端管理的中心服务进程状态。
  getCenterServiceStatus: () => Promise<{
    // running：主进程是否持有中心服务进程。
    running: boolean;
    // errorMessage：最近一次中心服务启动或运行错误。
    errorMessage: string;
  }>;
  // startCenterService：启动桌面端管理的中心服务。
  startCenterService: () => Promise<{
    // ok：主进程是否未捕获到启动错误。
    ok: boolean;
    // errorMessage：中心服务 stderr 或退出码摘要。
    errorMessage: string;
  }>;
  // stopCenterService：停止桌面端管理的中心服务。
  stopCenterService: () => Promise<{
    // ok：停止请求是否已被主进程处理。
    ok: boolean;
    // errorMessage：停止失败原因，当前为空字符串。
    errorMessage: string;
  }>;
  // restartCenterService：重启桌面端管理的中心服务并返回失败原因。
  restartCenterService: () => Promise<{
    // ok：主进程是否未捕获到启动错误。
    ok: boolean;
    // errorMessage：中心服务 stderr 或退出码摘要。
    errorMessage: string;
  }>;
  // updateCenterServiceLaunchConfig：同步下次启动中心服务使用的本机配置。
  updateCenterServiceLaunchConfig: (config: {
    // port：中心服务监听端口。
    port?: number;
    // centerDirectory：中心目录绝对路径。
    centerDirectory?: string;
  }) => Promise<{
    // ok：主进程是否接受配置。
    ok: boolean;
    // errorMessage：同步失败原因，当前为空字符串。
    errorMessage: string;
  }>;
}

// bridge：通过 contextBridge 暴露最小能力，避免渲染层直接访问 Node.js。
const bridge: DesktopBridge = {
  // getCenterServiceStatus：头部中心服务开关读取主进程管理状态。
  getCenterServiceStatus: () => ipcRenderer.invoke("get-center-service-status") as Promise<{
    running: boolean;
    errorMessage: string;
  }>,
  // startCenterService：头部中心服务开关启动中心服务。
  startCenterService: () => ipcRenderer.invoke("start-center-service") as Promise<{
    ok: boolean;
    errorMessage: string;
  }>,
  // stopCenterService：头部中心服务开关停止中心服务。
  stopCenterService: () => ipcRenderer.invoke("stop-center-service") as Promise<{
    ok: boolean;
    errorMessage: string;
  }>,
  // restartCenterService：设置页“重启中心服务”按钮调用。
  restartCenterService: () => ipcRenderer.invoke("restart-center-service") as Promise<{
    ok: boolean;
    errorMessage: string;
  }>,
  // updateCenterServiceLaunchConfig：中心服务页保存配置后通知主进程更新启动参数。
  updateCenterServiceLaunchConfig: (config) => ipcRenderer.invoke("update-center-service-launch-config", config) as Promise<{
    ok: boolean;
    errorMessage: string;
  }>,
};

// exposeInMainWorld：挂载到 window.zhixinDesktop。
contextBridge.exposeInMainWorld("zhixinDesktop", bridge);
