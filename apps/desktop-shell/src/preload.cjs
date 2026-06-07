/**
 * 桌面壳 preload 桥接。
 *
 * 用途：在 Electron contextIsolation 下向统一前端暴露桌面端白名单能力。
 * 关键逻辑：preload 必须是 Electron 可直接执行的 CommonJS 文件，避免开发期把 .ts 源码交给 Electron 后桥接失效。
 * 参数：无。
 * 返回值：无。
 */
const {
  contextBridge,
  ipcRenderer,
} = require("electron");

// bridge: 只暴露桌面端需要的中心服务生命周期、配置和通知权限能力，不开放任意 IPC。
const bridge = {
  /**
   * getCenterStatus：获取桌面壳管理的中心服务状态。
   *
   * @returns 中心服务运行状态、端口、中心目录和外部目录标记。
   */
  getCenterStatus: () => ipcRenderer.invoke("zhixin:center-status"),

  /**
   * startCenter：启动桌面壳管理的中心服务。
   *
   * @returns 操作结果。
   */
  startCenter: () => ipcRenderer.invoke("zhixin:center-start"),

  /**
   * stopCenter：停止桌面壳管理的中心服务。
   *
   * @returns 操作结果。
   */
  stopCenter: () => ipcRenderer.invoke("zhixin:center-stop"),

  /**
   * restartCenter：重启桌面壳管理的中心服务。
   *
   * @returns 操作结果。
   */
  restartCenter: () => ipcRenderer.invoke("zhixin:center-restart"),

  /**
   * updateCenterConfig：更新中心服务端口和中心目录。
   *
   * @param payload 桌面端中心服务配置表单。
   * @returns 保存后的中心服务状态。
   */
  updateCenterConfig: (payload) => ipcRenderer.invoke(
    "zhixin:center-config-update",
    payload,
  ),

  /**
   * selectCenterDirectory：选择中心目录位置。
   *
   * @returns 用户取消时返回 null，否则返回中心目录绝对路径。
   */
  selectCenterDirectory: () => ipcRenderer.invoke("zhixin:center-directory-select"),

  /**
   * saveAccessAccount：保存远程 Web 访问账号和密码。
   *
   * @param payload 远程访问账号密码。
   * @returns 操作结果。
   */
  saveAccessAccount: (payload) => ipcRenderer.invoke(
    "zhixin:access-account-save",
    payload,
  ),

  /**
   * getNotificationPermission：检测系统通知权限支持状态。
   *
   * @returns 通知权限和检测时间。
   */
  getNotificationPermission: () => ipcRenderer.invoke("zhixin:notification-permission"),

  /**
   * selectProjectDirectoryAndEnsureIdentity：选择项目目录并确保身份文件存在。
   *
   * @returns 项目 UUID、文件夹名和最新路径；用户取消选择时返回 null。
   */
  selectProjectDirectoryAndEnsureIdentity: () => ipcRenderer.invoke("zhixin:project-directory-select"),
};

contextBridge.exposeInMainWorld(
  "zhixinDesktop",
  bridge,
);
