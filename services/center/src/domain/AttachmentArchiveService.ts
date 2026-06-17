import {
    existsSync,
    mkdirSync,
    renameSync,
} from "node:fs";
import {
    basename,
    dirname,
    join,
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
     * @param temporaryRelativePath 临时附件相对中心目录路径。
     * @param attachmentId 正式附件 ID。
     * @param originalFileName 用户原始文件名。
     * @returns 归档附件结果。
     */
    moveTemporaryToArchive(
        temporaryRelativePath: string,
        attachmentId: string,
        originalFileName: string,
    ): AttachmentArchiveResult {
        const temporaryPath = join(
            this.centerDirectory,
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
        const absoluteArchivePath = join(
            this.centerDirectory,
            archivePath,
        );
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
