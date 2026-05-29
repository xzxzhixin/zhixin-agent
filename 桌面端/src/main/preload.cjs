const { contextBridge, ipcRenderer } = require("electron");

// bridge：通过 contextBridge 暴露最小桌面端能力，避免渲染层直接访问 Node.js。
const bridge = {
  // getCenterServiceStatus：读取桌面端管理的中心服务进程状态。
  getCenterServiceStatus: () => ipcRenderer.invoke("get-center-service-status"),
  // startCenterService：启动桌面端管理的中心服务。
  startCenterService: () => ipcRenderer.invoke("start-center-service"),
  // stopCenterService：停止桌面端管理的中心服务。
  stopCenterService: () => ipcRenderer.invoke("stop-center-service"),
  // restartCenterService：重启桌面端管理的中心服务。
  restartCenterService: () => ipcRenderer.invoke("restart-center-service"),
  // updateCenterServiceLaunchConfig：同步中心服务下次启动使用的端口和中心目录。
  updateCenterServiceLaunchConfig: (config) => ipcRenderer.invoke("update-center-service-launch-config", config),
};

// exposeInMainWorld：挂载到 window.zhixinDesktop，供桌面端页面调用。
contextBridge.exposeInMainWorld("zhixinDesktop", bridge);
