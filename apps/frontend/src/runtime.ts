import {
  DEFAULT_CENTER_PORT,
  type ClientType,
  type EntryMode,
} from "@zhixin/shared";

/**
 * ThemeMode：前端主题模式。
 *
 * 来源：需求中的暗黑和亮色主题。
 * 含义：控制统一前端根节点 data-theme 和 Element Plus 暗色类。
 * 格式：固定字符串枚举。
 * 默认值：由运行时根据宿主或系统偏好计算。
 */
export type ThemeMode = "light" | "dark";

/**
 * 客户端能力。
 *
 * 来源：架构中的前端能力适配层。
 * 含义：约束当前宿主可以展示和调用的能力。
 * 格式：JSON 对象。
 * 默认值：由运行时识别生成。
 * 约束：能力只控制 UI 和客户端入口，服务端授权仍由中心服务判断。
 */
export interface ClientCapabilities {
  /**
   * canManageCenterService: 是否能管理中心服务生命周期。
   */
  canManageCenterService: boolean;

  /**
   * canUseSystemNotification: 是否能使用系统通知能力。
   */
  canUseSystemNotification: boolean;

  /**
   * canOpenLocalFile: 是否能打开本地文件。
   */
  canOpenLocalFile: boolean;

  /**
   * canResolveProjectContext: 是否能解析当前项目上下文。
   */
  canResolveProjectContext: boolean;

  /**
   * canSendIdeContext: 是否能接收 IDE 右键上下文。
   */
  canSendIdeContext: boolean;

  /**
   * canUseRemoteLogin: 是否需要远程 Web 登录能力。
   */
  canUseRemoteLogin: boolean;

  /**
   * canManageAccessAccount: 是否能配置远程访问账号密码。
   */
  canManageAccessAccount: boolean;
}

/**
 * 运行时环境。
 *
 * 来源：统一前端入口识别。
 * 含义：描述当前 HTML 入口、客户端类型、布局模式和中心服务地址。
 * 格式：JSON 对象。
 * 默认值：桌面浏览器本机访问使用 8866。
 * 约束：IDE 插件连接地址固定为 127.0.0.1。
 */
export interface RuntimeEnvironment {
  /**
   * clientType: 当前客户端类型。
   */
  clientType: ClientType;

  /**
   * entryMode: 当前布局入口模式。
   */
  entryMode: EntryMode;

  /**
   * centerBaseUrl: 中心服务 HTTP 根地址。
   */
  centerBaseUrl: string;

  /**
   * capabilities: 当前宿主能力。
   */
  capabilities: ClientCapabilities;

  /**
   * projectContext: IDE 插件入口携带的当前项目上下文；非插件入口为 null。
   */
  projectContext: RuntimeProjectContext | null;

  /**
   * preferredTheme: 当前客户端环境推荐主题。
   */
  preferredTheme: ThemeMode;
}

/**
 * RuntimeProjectContext：运行时项目上下文。
 *
 * 来源：IDEA 插件加载 plugin.html 时追加的查询参数。
 * 含义：让插件紧凑模式只登记、加载和创建当前项目会话。
 * 格式：JSON 对象。
 * 默认值：非 IDE 插件入口为 null。
 * 约束：项目 ID 来自 `致心项目ID.md`，不能用路径替代。
 */
export interface RuntimeProjectContext {
  /**
   * projectId: 项目 UUID。
   */
  projectId: string;

  /**
   * displayName: 项目显示名。
   */
  displayName: string;

  /**
   * rootPath: 项目根目录绝对路径。
   */
  rootPath: string;
}

/**
 * detectRuntimeEnvironment：识别统一前端运行时。
 *
 * @returns 当前运行时环境。
 */
export function detectRuntimeEnvironment(): RuntimeEnvironment {
  // pathName: plugin.html 固定进入 IDE 紧凑项目模式。
  const pathName = window.location.pathname;
  // searchParams: 桌面壳和 IDEA 插件可通过 query 传入端口。
  const searchParams = new URLSearchParams(window.location.search);
  // preferredTheme: IDE 插件优先使用宿主传入的主题，其他端使用系统主题。
  const preferredTheme = detectPreferredTheme(searchParams);
  // port: 未传入端口时使用架构默认端口。
  const port = Number.parseInt(searchParams.get("port") ?? String(DEFAULT_CENTER_PORT), 10);
  // projectContext: IDEA 插件会把项目身份作为 plugin.html 查询参数传入。
  const projectContext = readRuntimeProjectContext(searchParams);
  // isPluginEntry: 插件入口由 plugin.html 决定，不依赖用户代理。
  const isPluginEntry = pathName.endsWith("/plugin.html");
  // isMobileViewport: 手机浏览器入口按小屏宽度选择 mobile 布局。
  const isMobileViewport = window.matchMedia("(max-width: 720px)").matches;
  // hasDesktopBridge: Electron preload 存在时代表桌面壳入口，允许展示中心服务管理能力。
  const hasDesktopBridge = "zhixinDesktop" in window;
  // isFileEntry: 历史 file 协议入口或测试入口仍属于本机入口，不能误进远程登录页。
  const isFileEntry = window.location.protocol === "file:";
  // isRemoteHost: 非本机 host 走远程 Web 客户端类型；桌面桥接和 file 协议必须排除，避免本机桌面端进入登录页。
  const isRemoteHost = !hasDesktopBridge
    && !isFileEntry
    && window.location.hostname !== "127.0.0.1"
    && window.location.hostname !== "localhost";

  if (isPluginEntry) {
    return {
      clientType: "ide-plugin",
      entryMode: "plugin-compact",
      centerBaseUrl: `http://127.0.0.1:${port}`,
      projectContext,
      preferredTheme,
      capabilities: {
        canManageCenterService: false,
        canUseSystemNotification: false,
        canOpenLocalFile: true,
        canResolveProjectContext: true,
        canSendIdeContext: true,
        canUseRemoteLogin: false,
        canManageAccessAccount: false,
      },
    };
  }

  if (isMobileViewport) {
    return {
      clientType: "web-mobile",
      entryMode: "mobile",
      centerBaseUrl: `${window.location.protocol}//${window.location.host}`,
      projectContext: null,
      preferredTheme,
      capabilities: {
        canManageCenterService: false,
        canUseSystemNotification: false,
        canOpenLocalFile: false,
        canResolveProjectContext: false,
        canSendIdeContext: false,
        canUseRemoteLogin: isRemoteHost,
        canManageAccessAccount: false,
      },
    };
  }

  return {
    clientType: hasDesktopBridge ? "desktop-shell" : isRemoteHost ? "web-remote" : "web-local",
    entryMode: "workspace",
    centerBaseUrl: isRemoteHost
      ? `${window.location.protocol}//${window.location.host}`
      : `http://127.0.0.1:${port}`,
    projectContext: null,
    preferredTheme,
    capabilities: {
      canManageCenterService: hasDesktopBridge,
      canUseSystemNotification: hasDesktopBridge,
      canOpenLocalFile: hasDesktopBridge,
      canResolveProjectContext: false,
      canSendIdeContext: false,
      canUseRemoteLogin: isRemoteHost,
      canManageAccessAccount: hasDesktopBridge,
    },
  };
}

/**
 * detectPreferredTheme：识别当前客户端默认主题。
 *
 * @param searchParams 当前页面查询参数。
 * @returns light 或 dark 主题。
 */
function detectPreferredTheme(searchParams: URLSearchParams): ThemeMode {
  // hostTheme: IDE 插件通过 plugin.html 查询参数传入宿主主题。
  const hostTheme = searchParams.get("theme");

  if (hostTheme === "light" || hostTheme === "dark") {
    return hostTheme;
  }

  // prefersDark: 桌面端和 Web 端按浏览器暴露的系统主题偏好决定首次主题。
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

/**
 * readRuntimeProjectContext：从 URL 查询参数读取 IDE 项目上下文。
 *
 * @param searchParams 当前页面查询参数。
 * @returns 项目上下文；参数不完整时返回 null。
 */
function readRuntimeProjectContext(searchParams: URLSearchParams): RuntimeProjectContext | null {
  // projectId/displayName/rootPath: 三者都来自 IDEA 插件宿主能力。
  const projectId = searchParams.get("projectId");
  const displayName = searchParams.get("projectName");
  const rootPath = searchParams.get("projectPath");

  if (!projectId || !displayName || !rootPath) {
    return null;
  }

  return {
    projectId,
    displayName,
    rootPath,
  };
}
