import type {
    ProjectRecord,
} from "@zhixin/shared";
import {
    CenterApiError,
} from "@zhixin/api-client";
import {
    ElMessageBox,
} from "element-plus";

// PROJECT_ID_FILE_NAME：项目根目录身份文件固定名称，来源于项目文件与资源规则。
const PROJECT_ID_FILE_NAME = "致心项目ID.md";
// PROJECT_ID_PATTERN：项目身份必须是标准 UUID，避免目录名或损坏内容进入中心服务。
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

declare global {
    interface Window {
        /** showDirectoryPicker: Chrome File System Access API，用于浏览器端选择项目文件夹。 */
        showDirectoryPicker?: (options?: {
            /** mode: 目录访问模式；新增项目对话需要 readwrite 以读写身份文件。 */
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
 * assertProjectId：校验项目身份文件内容必须是 UUID。
 *
 * @param projectId 从桌面桥接或浏览器身份文件读取到的项目 ID。
 * @returns 去除首尾空白后的 UUID。
 */
function assertProjectId(projectId: string): string {
    // normalizedProjectId: 文件允许末尾换行，但业务身份不能包含额外内容。
    const normalizedProjectId = projectId.trim();
    if (!PROJECT_ID_PATTERN.test(normalizedProjectId)) {
        throw new Error(`${PROJECT_ID_FILE_NAME} 内容不是合法 UUID，已停止登记项目。`);
    }
    return normalizedProjectId;
}

/**
 * readTextFromFileHandle：读取 File System Access 文件内容。
 *
 * @param fileHandle 浏览器文件句柄。
 * @returns UTF-8 文本内容。
 */
async function readTextFromFileHandle(fileHandle: FileSystemFileHandle): Promise<string> {
    // file: 浏览器 API 以 File 对象暴露内容，text() 按 UTF-8 读取。
    const file = await fileHandle.getFile();
    return file.text();
}

/**
 * writeTextToFileHandle：向 File System Access 文件写入文本。
 *
 * @param fileHandle 浏览器文件句柄。
 * @param content 要写入的 UTF-8 文本。
 * @returns 写入完成后没有返回值。
 */
async function writeTextToFileHandle(
    fileHandle: FileSystemFileHandle,
    content: string,
): Promise<void> {
    // writable: 身份文件缺失时必须真实写入项目根目录，不能用目录名伪造项目 ID。
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
}

/**
 * ensureBrowserProjectIdentity：读取或创建浏览器选择目录中的项目身份文件。
 *
 * @param directoryHandle 浏览器选择到的项目目录句柄。
 * @returns 项目 UUID。
 */
async function ensureBrowserProjectIdentity(directoryHandle: FileSystemDirectoryHandle): Promise<string> {
    try {
        // existingFileHandle: 已存在身份文件时只读取并校验，非法内容直接报错阻断登记。
        const existingFileHandle = await directoryHandle.getFileHandle(PROJECT_ID_FILE_NAME);
        return assertProjectId(await readTextFromFileHandle(existingFileHandle));
    } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "NotFoundError") {
            throw error;
        }

        // createdProjectId: 身份文件缺失才生成 UUID，并按“UUID 加换行”写入项目根目录。
        const createdProjectId = crypto.randomUUID();
        const createdFileHandle = await directoryHandle.getFileHandle(PROJECT_ID_FILE_NAME, {
            create: true,
        });
        await writeTextToFileHandle(
            createdFileHandle,
            `${createdProjectId}\n`,
        );
        return createdProjectId;
    }
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
         * removeDeletedProjectFromLocalState：清理已删除项目在当前客户端残留的导航、详情和草稿状态。
         *
         * @param projectId 被删除项目的 UUID，来源于中心服务删除请求或 PROJECT_NOT_FOUND 错误。
         * @returns 删除项目是否命中了当前打开会话或本地草稿。
         */
        removeDeletedProjectFromLocalState(projectId: string): boolean {
            const deletingActiveProject = this.sessionDetail?.session.projectId === projectId
                || this.pendingSessionDraft?.projectId === projectId;

            // projects/sessions: 中心服务已确认或提示项目不存在时，本地必须立即移除残留，避免左侧继续展示幽灵项目。
            this.projects = this.projects.filter((project) => {
                return project.projectId !== projectId;
            });
            this.sessions = this.sessions.filter((session) => {
                return session.projectId !== projectId;
            });
            this.expandedProjectIds = this.expandedProjectIds.filter((item) => {
                return item !== projectId;
            });

            if (deletingActiveProject) {
                // 当前项目已经不可继续使用，清理所有依赖当前项目身份的前端状态。
                this.activeSessionId = null;
                this.sessionDetail = null;
                this.events = [];
                this.pendingSessionDraft = null;
                this.composerEditFiles = [];
            }

            return deletingActiveProject;
        },

        /**
         * deleteProject：删除中心服务中的项目索引和项目会话事实。
         *
         * @param projectId 项目 UUID。
         * @returns 删除和刷新完成后没有返回值。
         */
        async deleteProject(projectId: string): Promise<void> {
            let deletingActiveProject = false;
            try {
                await this.api().deleteProject({
                    projectId,
                });
                deletingActiveProject = this.removeDeletedProjectFromLocalState(projectId);
                await this.loadNavigationData();
                if (this.activeSessionId) {
                    await this.loadActiveSessionDetail();
                    this.lastError = "";
                    return;
                }
                await this.ensureSession();
                this.lastError = "";
            } catch (error) {
                if (error instanceof CenterApiError && error.code === "PROJECT_NOT_FOUND") {
                    // 后端已删除但前端中途异常或多端并发删除时，PROJECT_NOT_FOUND 仍应视为本地清理信号。
                    deletingActiveProject = this.removeDeletedProjectFromLocalState(projectId);
                    await this.loadNavigationData();
                    if (this.activeSessionId) {
                        await this.loadActiveSessionDetail();
                    } else if (deletingActiveProject) {
                        await this.ensureSession();
                    }
                    this.lastError = "";
                    return;
                }

                // 删除项目失败必须进入可见错误状态，避免用户误以为项目和会话已清理。
                this.lastError = error instanceof Error
                    ? error.message
                    : "删除项目失败，请稍后重试。";
                console.error("删除项目失败", error);
            }
        },

        /**
         * requestDeleteProject：弹出项目删除确认后删除项目。
         *
         * @param project 项目记录。
         * @returns 确认删除、取消或失败处理完成后没有返回值。
         */
        async requestDeleteProject(project: ProjectRecord): Promise<void> {
            try {
                await ElMessageBox.confirm(
                    `确认删除项目“${project.displayName}”？将删除中心服务中的项目索引及该项目下的对话、消息、轮次和任务记录；不会删除项目目录和 致心项目ID.md。`,
                    "项目删除",
                    {
                        confirmButtonText: "确认删除",
                        cancelButtonText: "取消",
                        type: "warning",
                    },
                );
                await this.deleteProject(project.projectId);
            } catch {
                // 用户取消删除时不写错误，避免取消路径被误判为删除失败。
            }
        },

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

            // projectId: 来自项目根目录 致心项目ID.md；文件缺失时创建 UUID，禁止使用目录名伪造身份。
            const projectId = await ensureBrowserProjectIdentity(directoryHandle);
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
            try {
                // desktopBridge: app-types 中桌面桥接声明可能落后于 preload，本地收窄只使用本动作需要的项目身份能力。
                const desktopBridge = window.zhixinDesktop as {
                    /** selectProjectDirectoryAndEnsureIdentity: 桌面端选择项目目录并确保身份文件存在。 */
                    selectProjectDirectoryAndEnsureIdentity?: () => Promise<{
                        /** projectId: 项目 UUID，来源于 致心项目ID.md。 */
                        projectId: string;
                        /** displayName: 项目文件夹名。 */
                        displayName: string;
                        /** latestPath: 项目根目录绝对路径。 */
                        latestPath: string;
                    } | null>;
                } | undefined;

                if (desktopBridge?.selectProjectDirectoryAndEnsureIdentity) {
                    // desktopProject: 桌面端拥有原生目录路径和文件系统权限，优先通过白名单桥接确保身份文件。
                    const desktopProject = await desktopBridge.selectProjectDirectoryAndEnsureIdentity();
                    if (!desktopProject) {
                        return;
                    }
                    const project = await this.api().registerProject({
                        projectId: assertProjectId(desktopProject.projectId),
                        displayName: desktopProject.displayName,
                        latestPath: desktopProject.latestPath,
                    });
                    await this.loadProjects();
                    this.startProjectConversationDraft(project);
                    return;
                }

                if (typeof window.showDirectoryPicker !== "function") {
                    this.lastError = "当前环境不支持选择项目文件夹，无法创建项目对话。";
                    return;
                }

                const directoryHandle = await window.showDirectoryPicker({
                    mode: "readwrite",
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
