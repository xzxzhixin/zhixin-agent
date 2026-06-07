import {
  contextBridge,
  ipcRenderer,
} from "electron";

/**
 * DesktopCenterStatus：桌面壳管理的中心服务状态。
 *
 * 来源：Electron 主进程。
 * 含义：渲染层展示中心服务生命周期状态。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：只表示桌面壳管理进程状态，健康检查仍由中心服务 API 确认。
 */
export interface DesktopCenterStatus {
  /**
   * running: 主进程是否持有中心服务进程。
   */
  running: boolean;

  /**
   * errorMessage: 最近一次中心服务错误摘要。
   */
  errorMessage: string;

  /**
   * port: 中心服务端口。
   */
  port: number;

  /**
   * centerDirectory: 中心目录绝对路径。
   */
  centerDirectory: string;

  /**
   * isExternalCenterDirectory: 是否为用户选择的外部中心目录。
   */
  isExternalCenterDirectory: boolean;
}

/**
 * DesktopOperationResult：桌面壳 IPC 操作结果。
 *
 * 来源：Electron 主进程白名单 IPC。
 * 含义：表达配置保存、启动、停止和重启是否成功。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：错误消息只用于展示，不作为业务协议判断。
 */
export interface DesktopOperationResult {
  /**
   * ok: 操作是否成功。
   */
  ok: boolean;

  /**
   * errorMessage: 失败原因摘要。
   */
  errorMessage: string;
}

/**
 * DesktopProjectIdentity：桌面端选择项目目录后的身份信息。
 *
 * 来源：Electron 主进程读取或创建项目根目录 `致心项目ID.md`。
 * 含义：前端登记项目时使用的真实项目身份和当前位置。
 * 格式：JSON 对象。
 * 默认值：用户取消选择时返回 null。
 * 约束：projectId 必须是 UUID，不能由目录名派生。
 */
export interface DesktopProjectIdentity {
  /**
   * projectId: 项目 UUID，来源于项目根目录身份文件。
   */
  projectId: string;

  /**
   * displayName: 项目文件夹名，用于项目导航主名称。
   */
  displayName: string;

  /**
   * latestPath: 用户本次选择的项目根目录绝对路径。
   */
  latestPath: string;
}

/**
 * DesktopBridge：渲染层允许调用的桌面端能力。
 */
export interface DesktopBridge {
  /**
   * getCenterStatus: 获取中心服务进程状态。
   */
  getCenterStatus: () => Promise<DesktopCenterStatus>;

  /**
   * startCenter: 启动中心服务。
   */
  startCenter: () => Promise<{
    ok: boolean;
    errorMessage: string;
  }>;

  /**
   * stopCenter: 停止中心服务。
   */
  stopCenter: () => Promise<{
    ok: boolean;
    errorMessage: string;
  }>;

  /**
   * restartCenter: 重启中心服务。
   */
  restartCenter: () => Promise<{
    ok: boolean;
    errorMessage: string;
  }>;

  /**
   * updateCenterConfig: 更新中心服务端口和中心目录。
   */
  updateCenterConfig: (payload: {
    port: number;
    centerDirectory: string;
  }) => Promise<DesktopCenterStatus & DesktopOperationResult>;

  /**
   * selectCenterDirectory: 选择中心目录位置。
   */
  selectCenterDirectory: () => Promise<string | null>;

  /**
   * saveAccessAccount: 保存远程 Web 访问账号和密码。
   */
  saveAccessAccount: (payload: {
    account: string;
    password: string;
  }) => Promise<DesktopOperationResult>;

  /**
   * getNotificationPermission: 检测系统通知权限支持状态。
   */
  getNotificationPermission: () => Promise<{
    permission: string;
    checkedAt: string;
  }>;

  /**
   * selectProjectDirectoryAndEnsureIdentity: 选择项目目录并确保身份文件存在。
   */
  selectProjectDirectoryAndEnsureIdentity: () => Promise<DesktopProjectIdentity | null>;
}

// bridge: 暴露给前端的最小桌面能力集合。
const bridge: DesktopBridge = {
  getCenterStatus: () => ipcRenderer.invoke("zhixin:center-status") as Promise<DesktopCenterStatus>,
  startCenter: () => ipcRenderer.invoke("zhixin:center-start") as Promise<{
    ok: boolean;
    errorMessage: string;
  }>,
  stopCenter: () => ipcRenderer.invoke("zhixin:center-stop") as Promise<{
    ok: boolean;
    errorMessage: string;
  }>,
  restartCenter: () => ipcRenderer.invoke("zhixin:center-restart") as Promise<{
    ok: boolean;
    errorMessage: string;
  }>,
  updateCenterConfig: (payload) => ipcRenderer.invoke("zhixin:center-config-update", payload) as Promise<DesktopCenterStatus & DesktopOperationResult>,
  selectCenterDirectory: () => ipcRenderer.invoke("zhixin:center-directory-select") as Promise<string | null>,
  saveAccessAccount: (payload) => ipcRenderer.invoke("zhixin:access-account-save", payload) as Promise<DesktopOperationResult>,
  getNotificationPermission: () => ipcRenderer.invoke("zhixin:notification-permission") as Promise<{
    permission: string;
    checkedAt: string;
  }>,
  selectProjectDirectoryAndEnsureIdentity: () => ipcRenderer.invoke("zhixin:project-directory-select") as Promise<DesktopProjectIdentity | null>,
};

contextBridge.exposeInMainWorld("zhixinDesktop", bridge);
