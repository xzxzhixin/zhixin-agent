import { contextBridge, ipcRenderer } from "electron";

// DesktopBridge：渲染层允许调用的桌面端主进程能力。
export interface DesktopBridge {
  // restartCenterService：重启桌面端管理的中心服务并返回失败原因。
  restartCenterService: () => Promise<{
    // ok：主进程是否未捕获到启动错误。
    ok: boolean;
    // errorMessage：中心服务 stderr 或退出码摘要。
    errorMessage: string;
  }>;
}

// bridge：通过 contextBridge 暴露最小能力，避免渲染层直接访问 Node.js。
const bridge: DesktopBridge = {
  // restartCenterService：设置页“重启中心服务”按钮调用。
  restartCenterService: () => ipcRenderer.invoke("restart-center-service") as Promise<{
    ok: boolean;
    errorMessage: string;
  }>,
};

// exposeInMainWorld：挂载到 window.zhixinDesktop。
contextBridge.exposeInMainWorld("zhixinDesktop", bridge);
