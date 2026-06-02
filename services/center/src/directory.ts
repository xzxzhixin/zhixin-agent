import {existsSync, mkdirSync} from "node:fs";
import {rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {CENTER_DIRECTORY_LAYOUT, type CenterServiceConfig} from "./types.js";

export class CenterDirectory {
    /**
     * config: 中心服务启动配置。
     */
    private readonly config: CenterServiceConfig;

    /**
     * constructor：保存中心服务配置。
     *
     * @param config 中心服务启动配置。
     */
    constructor(config: CenterServiceConfig) {
        this.config = config;
    }

    /**
     * initialize：创建中心目录和固定子目录。
     *
     * @returns 初始化完成后没有返回值。
     */
    async initialize(): Promise<void> {
        // mkdirSync: 先创建中心根目录，后续相对目录才有明确边界。
        mkdirSync(this.config.centerDirectory, {
            recursive: true,
        });

        for (const directory of CENTER_DIRECTORY_LAYOUT) {
            // directoryPath: 每个相对目录都限定在 center-data 下。
            const directoryPath = join(this.config.centerDirectory, directory.relativePath);
            mkdirSync(directoryPath, {
                recursive: true,
            });
        }

        await this.cleanTempDirectory();
        await this.ensureJsonFile(
            join(this.config.centerDirectory, "config", "center.json"),
            {
                port: this.config.port,
                centerDirectory: this.config.centerDirectory,
                updatedAt: new Date().toISOString(),
            },
        );
        await this.ensureJsonFile(
            join(this.config.centerDirectory, "config", "access.json"),
            {
                webAccountConfigured: false,
                updatedAt: new Date().toISOString(),
            },
        );
        await this.ensureJsonFile(
            join(this.config.centerDirectory, "config", "notification.json"),
            {
                systemPermission: "unknown",
                updatedAt: new Date().toISOString(),
            },
        );
        await this.ensureTextFile(
            join(this.config.centerDirectory, "memory", "user.md"),
            "",
        );
    }

    /**
     * close：停止阶段清理临时目录。
     *
     * @returns 清理完成后没有返回值。
     */
    async close(): Promise<void> {
        await this.cleanTempDirectory();
    }

    /**
     * cleanTempDirectory：清理未绑定正式消息的临时附件目录。
     *
     * @returns 清理完成后没有返回值。
     */
    private async cleanTempDirectory(): Promise<void> {
        // tempDirectory: temp 不属于迁移事实源，启动和停止时清理。
        const tempDirectory = join(this.config.centerDirectory, "temp");
        await rm(tempDirectory, {
            force: true,
            recursive: true,
        });
        mkdirSync(tempDirectory, {
            recursive: true,
        });
    }

    /**
     * ensureJsonFile：缺失时创建 JSON 文件。
     *
     * @param filePath 目标文件绝对路径。
     * @param value 初始 JSON 值。
     * @returns 文件存在或创建完成后没有返回值。
     */
    private async ensureJsonFile(filePath: string, value: Record<string, unknown>): Promise<void> {
        if (existsSync(filePath)) {
            return;
        }

        mkdirSync(dirname(filePath), {
            recursive: true,
        });
        await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    }

    /**
     * ensureTextFile：缺失时创建文本文件。
     *
     * @param filePath 目标文件绝对路径。
     * @param value 初始文本内容。
     * @returns 文件存在或创建完成后没有返回值。
     */
    private async ensureTextFile(filePath: string, value: string): Promise<void> {
        if (existsSync(filePath)) {
            return;
        }

        mkdirSync(dirname(filePath), {
            recursive: true,
        });
        await writeFile(filePath, value, "utf-8");
    }
}
