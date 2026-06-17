import {
    existsSync,
    mkdirSync,
    renameSync,
} from "node:fs";
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
} from "node:path";

import {
    formatLocalDateParts,
} from "../time.js";

/**
 * AttachmentArchiveResult：正式归档附件结果。
 *
 * 来源：输入框临时附件提交。
 * 含义：描述归档附件在中心目录中的唯一文件位置。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：archivePath 必须是相对中心目录路径，供会话和记忆共同引用。
 */
export interface AttachmentArchiveResult {
    /** attachmentId: 正式附件 ID。 */
    attachmentId: string;
    /** archivePath: 正式归档附件相对中心目录路径。 */
    archivePath: string;
    /** originalFileName: 用户原始文件名归一化后的文件名。 */
    originalFileName: string;
}

/**
 * AttachmentArchiveService：归档输入框正式附件。
 */
export class AttachmentArchiveService {
    /**
     * constructor：保存中心目录。
     *
     * @param centerDirectory 中心目录绝对路径。
     */
    constructor(private readonly centerDirectory: string) {}

    /**
     * moveTemporaryToArchive：把临时附件移动为唯一归档附件。
     *
     * @param temporaryAttachmentId 临时附件 ID，用于限定 temp 子目录边界。
     * @param temporaryRelativePath 临时附件相对中心目录路径。
     * @param attachmentId 正式附件 ID。
     * @param originalFileName 用户原始文件名。
     * @returns 归档附件结果。
     */
    moveTemporaryToArchive(
        temporaryAttachmentId: string,
        temporaryRelativePath: string,
        attachmentId: string,
        originalFileName: string,
    ): AttachmentArchiveResult {
        const temporaryPath = this.resolveTemporaryPath(
            temporaryAttachmentId,
            temporaryRelativePath,
        );
        if (!existsSync(temporaryPath)) {
            throw new Error("TEMP_ATTACHMENT_NOT_FOUND");
        }
        const dateParts = formatLocalDateParts();
        const safeFileName = this.normalizeFileName(originalFileName);
        const archivePath = join(
            "memory",
            "attachments",
            dateParts.year,
            dateParts.month,
            dateParts.day,
            attachmentId,
            safeFileName,
        ).replace(/\\/gu, "/");
        const absoluteArchivePath = resolve(
            this.resolveCenterDirectory(),
            archivePath,
        );
        const archiveRoot = resolve(
            this.resolveCenterDirectory(),
            "memory",
            "attachments",
        );
        if (!this.isPathInside(archiveRoot, absoluteArchivePath)) {
            throw new Error("TEMP_ATTACHMENT_PATH_OUT_OF_SCOPE");
        }
        mkdirSync(dirname(absoluteArchivePath), {
            recursive: true,
        });
        renameSync(
            temporaryPath,
            absoluteArchivePath,
        );
        return {
            attachmentId,
            archivePath,
            originalFileName: safeFileName,
        };
    }

    /**
     * resolveTemporaryPath：校验并解析临时附件源路径。
     *
     * @param temporaryAttachmentId 临时附件 ID。
     * @param temporaryRelativePath 客户端提交的相对中心目录路径。
     * @returns 已确认位于 temp/{temporaryAttachmentId}/ 内的绝对路径。
     */
    private resolveTemporaryPath(
        temporaryAttachmentId: string,
        temporaryRelativePath: string,
    ): string {
        if (
            temporaryAttachmentId.trim().length === 0
            || temporaryRelativePath.trim().length === 0
            || isAbsolute(temporaryRelativePath)
        ) {
            throw new Error("TEMP_ATTACHMENT_PATH_OUT_OF_SCOPE");
        }
        const centerDirectory = this.resolveCenterDirectory();
        const tempRoot = resolve(
            centerDirectory,
            "temp",
            temporaryAttachmentId,
        );
        const tempDirectory = resolve(
            centerDirectory,
            "temp",
        );
        const temporaryPath = resolve(
            centerDirectory,
            temporaryRelativePath,
        );
        // 先确认临时附件 ID 自身没有把 temp/{id} 解析到 temp 目录之外。
        if (!this.isPathInside(tempDirectory, tempRoot)) {
            throw new Error("TEMP_ATTACHMENT_PATH_OUT_OF_SCOPE");
        }
        // 再确认客户端提交的源文件路径仍位于该临时附件专属目录内。
        if (!this.isPathInside(tempRoot, temporaryPath)) {
            throw new Error("TEMP_ATTACHMENT_PATH_OUT_OF_SCOPE");
        }
        return temporaryPath;
    }

    /**
     * resolveCenterDirectory：归一化中心目录绝对路径。
     *
     * @returns 中心目录绝对路径。
     */
    private resolveCenterDirectory(): string {
        return resolve(this.centerDirectory);
    }

    /**
     * isPathInside：判断目标路径是否位于指定根目录内部。
     *
     * @param rootDirectory 允许访问的根目录。
     * @param targetPath 待校验的目标路径。
     * @returns true 表示目标路径没有越过根目录。
     */
    private isPathInside(
        rootDirectory: string,
        targetPath: string,
    ): boolean {
        const relativePath = relative(
            rootDirectory,
            targetPath,
        );
        return relativePath.length > 0
            && !relativePath.startsWith("..")
            && !isAbsolute(relativePath);
    }

    /**
     * normalizeFileName：保留文件名并移除路径片段。
     *
     * @param fileName 用户传入文件名。
     * @returns 可写入归档目录的文件名。
     */
    private normalizeFileName(fileName: string): string {
        const normalized = basename(fileName).trim();
        if (normalized.length > 0) {
            return normalized;
        }
        // attachment.bin 是没有可用原始文件名时的固定安全文件名，避免写入空路径。
        return "attachment.bin";
    }
}
