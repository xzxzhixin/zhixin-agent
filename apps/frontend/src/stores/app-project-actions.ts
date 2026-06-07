import type {
    ProjectRecord,
} from "@zhixin/shared";

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
