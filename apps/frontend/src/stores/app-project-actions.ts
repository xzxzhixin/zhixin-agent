import type {
    ProjectRecord,
} from "@zhixin/shared";

declare global {
    interface Window {
        /** showDirectoryPicker: Chrome File System Access API，用于浏览器端选择项目文件夹。 */
        showDirectoryPicker?: (options?: {
            /** mode: 目录访问模式；本项目新增项目对话只需要读取目录名。 */
            mode?: "read" | "readwrite";
        }) => Promise<FileSystemDirectoryHandle>;
    }
}
/**
 * isDirectoryPickerAbortError：识别用户主动取消目录选择。
 *
 * @param error 浏览器目录选择抛出的错误。
 * @returns 用户取消时返回 true。
 */
function isDirectoryPickerAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

/**
 * createProjectActions：创建项目选择和项目对话草稿相关动作。
 *
 * 用途：把浏览器选择文件夹、登记项目和进入项目对话草稿的逻辑从主 store 拆出，避免主 store 超过单文件行数限制。
 * 关键逻辑：新增项目对话必须先选择文件夹并登记项目；已有项目行新增对话仍复用该项目事实记录。
 * @returns 可被 Pinia actions 展开的项目动作集合。
 */
export function createProjectActions() {
    return {
        /**
         * registerProjectFromDirectorySelection：把浏览器选择到的文件夹登记为项目。
         *
         * @param directoryHandle 浏览器 File System Access API 返回的目录句柄。
         * @returns 中心服务项目记录。
         */
        async registerProjectFromDirectorySelection(directoryHandle: FileSystemDirectoryHandle): Promise<ProjectRecord> {
            // displayName: 浏览器目录选择只能稳定拿到目录名，不能伪造本机绝对路径。
            const displayName = directoryHandle.name.trim();
            if (displayName.length === 0) {
                throw new Error("项目文件夹名称为空，无法创建项目对话。");
            }

            // projectId: 浏览器端没有项目身份文件写入权限时，按选择到的目录名生成稳定会话项目 ID；后续桌面端目录桥接可替换为真实 致心项目ID.md。
            const projectId = `browser-folder-${displayName}`;
            const project = await this.api().registerProject({
                projectId,
                displayName,
                latestPath: displayName,
            });
            await this.loadProjects();
            return project;
        },

        /**
         * createProjectConversationFromDirectorySelection：选择文件夹后进入项目对话草稿。
         *
         * @returns 完成选择和登记后没有返回值。
         */
        async createProjectConversationFromDirectorySelection(): Promise<void> {
            if (typeof window.showDirectoryPicker !== "function") {
                this.lastError = "当前浏览器不支持选择文件夹，请使用 Chrome 或通过桌面端打开。";
                return;
            }

            try {
                const directoryHandle = await window.showDirectoryPicker({
                    mode: "read",
                });
                const project = await this.registerProjectFromDirectorySelection(directoryHandle);
                this.startProjectConversationDraft(project);
            } catch (error) {
                if (isDirectoryPickerAbortError(error)) {
                    return;
                }
                this.lastError = error instanceof Error
                    ? error.message
                    : "选择项目文件夹失败。";
            }
        },
    };
}
