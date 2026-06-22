import type {
    CenterLogConfigView,
    CenterLogLevel,
} from "./app-types";

/**
 * postCenterApi：发送中心服务 POST 请求并解析统一响应包。
 *
 * @param baseUrl 中心服务 HTTP 根地址。
 * @param path API 路径。
 * @param payload 请求体。
 * @returns 成功响应 data。
 */
async function postCenterApi<TData>(
    baseUrl: string,
    path: string,
    payload: unknown,
): Promise<TData> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    const result = await response.json() as {
        /** success: 中心服务统一响应成功标记。 */
        success: boolean;
        /** data: 中心服务统一响应数据。 */
        data: TData | null;
        /** error: 中心服务统一错误对象。 */
        error?: {
            /** displayMessage: 可展示错误文案。 */
            displayMessage?: string;
            /** code: 错误码。 */
            code?: string;
        } | null;
    };

    if (!result.success || result.data === null) {
        throw new Error(result.error?.displayMessage ?? "中心服务请求失败。");
    }

    return result.data;
}

/**
 * getCenterApi：发送中心服务 GET 请求并解析统一响应包。
 *
 * @param baseUrl 中心服务 HTTP 根地址。
 * @param path API 路径。
 * @returns 成功响应 data。
 */
async function getCenterApi<TData>(
    baseUrl: string,
    path: string,
): Promise<TData> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        credentials: "include",
    });
    const result = await response.json() as {
        /** success: 中心服务统一响应成功标记。 */
        success: boolean;
        /** data: 中心服务统一响应数据。 */
        data: TData | null;
        /** error: 中心服务统一错误对象。 */
        error?: {
            /** displayMessage: 可展示错误文案。 */
            displayMessage?: string;
            /** code: 错误码。 */
            code?: string;
        } | null;
    };

    if (!result.success || result.data === null) {
        throw new Error(result.error?.displayMessage ?? "中心服务请求失败。");
    }

    return result.data;
}

/**
 * createDesktopActions：创建桌面壳中心服务管理动作。
 *
 * 用途：把中心服务状态同步、配置保存、目录选择和远程访问保存从主 store 拆出，避免主 store 超过单文件行数限制。
 * @returns 可被 Pinia actions 展开的桌面壳动作集合。
 */
export function createDesktopActions() {
    return {
        /**
         * syncDesktopStatus：同步桌面壳中心服务状态。
         *
         * @returns 同步完成后没有返回值。
         */
        async syncDesktopStatus(): Promise<void> {
            if (!window.zhixinDesktop) {
                return;
            }

            this.desktopStatus = await window.zhixinDesktop.getCenterStatus();
            this.desktopConfigDraft = {
                port: this.desktopStatus.port,
                centerDirectory: this.desktopStatus.centerDirectory,
            };
            this.restartRequired = false;
            const permission = await window.zhixinDesktop.getNotificationPermission();
            this.notificationPermission = `${permission.permission} · ${permission.checkedAt}`;
            await this.api().saveNotificationConfig({
                clientType: "desktop-shell",
                enabled: true,
                notifyOnFailure: true,
                notifyOnWaitingUser: true,
                systemPermission: permission.permission,
            });
        },

        /**
         * loadCenterLogConfig：加载中心服务日志配置。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadCenterLogConfig(): Promise<void> {
            try {
                const config = await getCenterApi<CenterLogConfigView>(
                    this.runtime.centerBaseUrl,
                    "/api/center/log-config",
                );
                this.centerLogConfig = config;
                this.centerLogConfigDraft = {
                    configuredLevel: config.configuredLevel ?? "",
                };
                this.managementErrors.center = "";
            } catch (error) {
                // 错误需要进入中心服务页面可见状态，避免用户保存日志配置时误判已生效。
                this.recordCenterLogConfigError(error);
            }
        },

        /**
         * saveCenterLogConfig：保存中心服务日志配置。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveCenterLogConfig(): Promise<void> {
            try {
                // configuredLevel: 表单空字符串代表恢复环境默认，提交给中心服务时必须转换为 null。
                const configuredLevel = this.centerLogConfigDraft.configuredLevel === ""
                    ? null
                    : this.centerLogConfigDraft.configuredLevel as CenterLogLevel;
                const config = await postCenterApi<CenterLogConfigView>(
                    this.runtime.centerBaseUrl,
                    "/api/center/log-config",
                    {
                        configuredLevel,
                    },
                );
                this.centerLogConfig = config;
                this.centerLogConfigDraft = {
                    configuredLevel: config.configuredLevel ?? "",
                };
                this.managementErrors.center = "";
            } catch (error) {
                // 保存失败必须保留用户草稿，只更新错误状态。
                this.recordCenterLogConfigError(error);
            }
        },

        /**
         * recordCenterLogConfigError：记录中心服务日志配置错误。
         *
         * @param error 接口异常或业务异常。
         * @returns 没有返回值。
         */
        recordCenterLogConfigError(error: unknown): void {
            // rawMessage: 网络层 Failed to fetch 统一转成中文，避免中心服务页面展示浏览器英文错误。
            const rawMessage = error instanceof Error
                ? error.message
                : String(error);
            const message = rawMessage === "Failed to fetch"
                ? "无法连接中心服务，请确认中心服务已启动后重试。"
                : rawMessage;
            this.managementErrors.center = message;
            this.lastError = message;
            // 控制台保留原始错误对象，方便排查日志配置接口路径、CORS 或中心服务业务错误。
            console.error("中心服务日志配置请求失败", {
                error,
                message,
            });
        },

        /**
         * saveDesktopConfig：保存桌面壳中心服务配置。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveDesktopConfig(): Promise<void> {
            if (!window.zhixinDesktop) {
                return;
            }

            const result = await window.zhixinDesktop.updateCenterConfig({
                port: this.desktopConfigDraft.port,
                centerDirectory: this.desktopConfigDraft.centerDirectory,
            });
            this.desktopStatus = result;
            this.desktopConfigDraft = {
                port: result.port,
                centerDirectory: result.centerDirectory,
            };
            this.restartRequired = result.ok;
            this.lastError = result.errorMessage;
        },

        /**
         * selectCenterDirectory：使用桌面壳原生能力选择中心目录。
         *
         * @returns 选择完成后没有返回值。
         */
        async selectCenterDirectory(): Promise<void> {
            if (!window.zhixinDesktop) {
                return;
            }

            const selectedDirectory = await window.zhixinDesktop.selectCenterDirectory();
            if (!selectedDirectory) {
                return;
            }

            this.desktopConfigDraft.centerDirectory = selectedDirectory;
        },

        /**
         * saveRemoteAccessAccount：保存远程 Web 访问账号密码。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveRemoteAccessAccount(): Promise<void> {
            if (!window.zhixinDesktop) {
                return;
            }

            const result = await window.zhixinDesktop.saveAccessAccount({
                account: this.remoteAccessDraft.account,
                password: this.remoteAccessDraft.password,
            });
            this.lastError = result.errorMessage;
            if (result.ok) {
                this.remoteAccessDraft.password = "";
            }
        },
    };
}
