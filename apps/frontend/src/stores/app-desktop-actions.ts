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
