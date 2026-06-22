import type {CenterLogger} from "./logger.js";
import {isProcessAlive} from "./startup-lock.js";

// DESKTOP_MANAGED_MODE: 桌面壳托管中心服务的生命周期模式环境变量值。
const DESKTOP_MANAGED_MODE = "desktop-managed";
// DEFAULT_MANAGER_CHECK_INTERVAL_MS: 管理者进程默认判活间隔，单位毫秒。
const DEFAULT_MANAGER_CHECK_INTERVAL_MS = 1000;
// MIN_MANAGER_CHECK_INTERVAL_MS: 防止外部配置过小导致中心服务频繁轮询。
const MIN_MANAGER_CHECK_INTERVAL_MS = 300;

/**
 * DesktopManagedLifecycleWatchOptions：桌面托管生命周期监护参数。
 *
 * 来源：中心服务 CLI 启动入口。
 * 含义：提供日志和统一关闭函数。
 * 约束：关闭函数必须负责释放中心服务资源并退出进程。
 */
export interface DesktopManagedLifecycleWatchOptions {
    /**
     * logger: 中心服务文件日志实例，用于记录管理者消失和关闭失败。
     */
    logger: CenterLogger;

    /**
     * closeService: 统一关闭函数，来源于当前 CLI 启动的中心服务关闭流程。
     */
    closeService: () => Promise<void>;
}

/**
 * DesktopManagedLifecycleWatchRegistration：桌面托管生命周期注册参数。
 *
 * 来源：桌面壳启动或复用中心服务后调用的本机生命周期接口。
 * 含义：允许已运行中心服务更新当前桌面壳管理者 PID。
 */
export interface DesktopManagedLifecycleWatchRegistration {
    /**
     * lifecycleMode: 生命周期模式，必须为 desktop-managed。
     */
    lifecycleMode: string;

    /**
     * managerPid: 桌面壳主进程 PID。
     */
    managerPid: number;

    /**
     * checkIntervalMs: 可选管理者判活检查间隔，单位毫秒。
     */
    checkIntervalMs?: number;
}

/**
 * DesktopManagedLifecycleWatchHandle：桌面托管生命周期监护句柄。
 *
 * 来源：安装监护后的返回值。
 * 含义：允许正常退出路径停止监护定时器。
 */
export interface DesktopManagedLifecycleWatchHandle {
    /**
     * registerManager: 更新当前桌面壳管理者 PID，覆盖复用遗留中心服务的场景。
     */
    registerManager: (registration: DesktopManagedLifecycleWatchRegistration) => boolean;

    /**
     * stop: 停止管理者监护定时器。
     */
    stop: () => void;
}

/**
 * DesktopManagedLifecycleConfig：桌面托管生命周期运行配置。
 *
 * 来源：桌面壳启动中心服务时写入的环境变量。
 * 含义：约束中心服务监护哪个桌面壳进程以及检查频率。
 */
interface DesktopManagedLifecycleConfig {
    /**
     * managerPid: 桌面壳主进程 PID，来源于 ZHIXIN_CENTER_MANAGER_PID。
     */
    managerPid: number;

    /**
     * checkIntervalMs: 管理者判活检查间隔，单位毫秒。
     */
    checkIntervalMs: number;
}

// activeLifecycleWatch: 当前 CLI 进程安装的桌面托管监护句柄，供核心本机路由登记复用服务的桌面壳 PID。
let activeLifecycleWatch: DesktopManagedLifecycleWatchHandle | null = null;

/**
 * installDesktopManagedLifecycleWatch：安装桌面壳管理者进程监护。
 *
 * @param options 日志实例和统一关闭函数。
 * @returns 监护句柄；非桌面托管模式下等待后续本机注册接口登记管理者 PID。
 */
export function installDesktopManagedLifecycleWatch(
    options: DesktopManagedLifecycleWatchOptions,
): DesktopManagedLifecycleWatchHandle {
    // config: 当前生效的桌面壳管理者配置；非托管启动时保持 null，等待本机注册接口显式登记。
    let config = readDesktopManagedLifecycleConfig();
    // isClosing: 管理者消失后只允许触发一次关闭，避免定时器重复进入关闭流程。
    let isClosing = false;
    const timer = setInterval(() => {
        if (!config || isClosing || isProcessAlive(config.managerPid)) {
            return;
        }

        isClosing = true;
        clearInterval(timer);
        void closeServiceAfterManagerExit(
            options,
            config,
        );
    }, config.checkIntervalMs);

    const handle: DesktopManagedLifecycleWatchHandle = {
        registerManager: (registration) => {
            const nextConfig = normalizeDesktopManagedLifecycleConfig(registration);
            if (!nextConfig) {
                return false;
            }
            config = nextConfig;
            return true;
        },
        stop: () => {
            clearInterval(timer);
            if (activeLifecycleWatch === handle) {
                activeLifecycleWatch = null;
            }
        },
    };

    activeLifecycleWatch = handle;
    return handle;
}

/**
 * registerDesktopManagedLifecycleManager：登记当前桌面端管理者进程。
 *
 * @param registration 桌面壳通过本机 API 传入的生命周期注册参数。
 * @returns 登记成功时返回 true。
 */
export function registerDesktopManagedLifecycleManager(
    registration: DesktopManagedLifecycleWatchRegistration,
): boolean {
    return activeLifecycleWatch?.registerManager(registration) ?? false;
}

/**
 * closeServiceAfterManagerExit：管理者进程消失后关闭中心服务。
 *
 * 关键逻辑：退出日志只做尽力写入，不能影响 closeService 执行，避免控制台断管时中心服务残留。
 *
 * @param options 日志实例和统一关闭函数。
 * @param config 当前触发关闭的桌面壳管理者配置。
 * @returns 关闭流程结束后没有返回值；关闭失败时强制以错误码退出。
 */
async function closeServiceAfterManagerExit(
    options: DesktopManagedLifecycleWatchOptions,
    config: DesktopManagedLifecycleConfig,
): Promise<void> {
    try {
        await options.logger.info("桌面端管理者进程消失，中心服务自动退出", {
            managerPid: config.managerPid,
            checkIntervalMs: config.checkIntervalMs,
        });
    } catch {
        // catch: IDEA 强停或父进程管道断开时，控制台日志可能失败；关闭服务不能依赖日志成功。
    }

    try {
        await options.closeService();
    } catch (error) {
        try {
            await options.logger.error("桌面端管理者消失后中心服务关闭失败", {
                errorMessage: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack ?? null : null,
            });
        } catch {
            // catch: 关闭失败后的错误日志同样只做尽力写入，防止二次断管掩盖最终退出。
        }
        process.exit(1);
    }
}

/**
 * readDesktopManagedLifecycleConfig：读取桌面托管生命周期环境变量。
 *
 * @returns 配置完整合法时返回监护配置；否则返回 null。
 */
function readDesktopManagedLifecycleConfig(): DesktopManagedLifecycleConfig | null {
    return normalizeDesktopManagedLifecycleConfig({
        lifecycleMode: process.env.ZHIXIN_CENTER_LIFECYCLE_MODE ?? "",
        managerPid: Number.parseInt(
            process.env.ZHIXIN_CENTER_MANAGER_PID ?? "",
            10,
        ),
        checkIntervalMs: Number.parseInt(
            process.env.ZHIXIN_CENTER_MANAGER_CHECK_INTERVAL_MS ?? "",
            10,
        ),
    });
}

/**
 * normalizeDesktopManagedLifecycleConfig：校验并归一化桌面托管生命周期配置。
 *
 * @param registration 桌面壳注册或环境变量读取出的生命周期配置。
 * @returns 配置合法时返回运行配置；否则返回 null。
 */
function normalizeDesktopManagedLifecycleConfig(
    registration: DesktopManagedLifecycleWatchRegistration,
): DesktopManagedLifecycleConfig | null {
    if (registration.lifecycleMode !== DESKTOP_MANAGED_MODE) {
        return null;
    }

    const managerPid = registration.managerPid;
    if (!Number.isInteger(managerPid) || managerPid <= 0 || managerPid === process.pid) {
        return null;
    }

    const configuredInterval = registration.checkIntervalMs;
    const checkIntervalMs = Number.isInteger(configuredInterval)
        ? Math.max(
            configuredInterval,
            MIN_MANAGER_CHECK_INTERVAL_MS,
        )
        : DEFAULT_MANAGER_CHECK_INTERVAL_MS;

    return {
        managerPid,
        checkIntervalMs,
    };
}
