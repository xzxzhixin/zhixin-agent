import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {readCenterServiceConfig} from "./config.js";
import {CenterLogger} from "./logger.js";
import {createCenterService} from "./service.js";

export {readCenterServiceConfig} from "./config.js";
export {createCenterService} from "./service.js";
export {
    CENTER_DIRECTORY_LAYOUT,
    CORE_SQLITE_TABLES,
} from "./types.js";
export {CenterStartupLock} from "./startup-lock.js";
export type {CenterService, CenterListenResult} from "./service.js";
export type {CenterServiceConfig, CenterServiceConfigInput} from "./types.js";

async function runFromCli(): Promise<void> {
    const config = readCenterServiceConfig();
    const service = await createCenterService(config);
    const listenResult = await service.listen();
    const logger = new CenterLogger(config.centerDirectory);
    if (listenResult.reusedExisting) {
        await logger.info("center.server.reused-existing", {
            port: config.port,
            centerDirectory: config.centerDirectory,
        });
        process.stdout.write(`中心服务已在运行，复用端口 ${config.port}。\n`);
        await service.close();
        return;
    }

    await logger.info("center.server.listening", {
        port: config.port,
    });

    const shutdown = async (): Promise<void> => {
        await service.close();
        process.exit(0);
    };

    process.once("SIGINT", () => {
        void shutdown();
    });
    process.once("SIGTERM", () => {
        void shutdown();
    });
}

// currentFilePath: 当前模块真实路径，用于判断是否由 tsx 直接执行。
const currentFilePath = fileURLToPath(import.meta.url);
// entryFilePath: 进程入口路径，可能不存在于测试注入场景。
const entryFilePath = process.argv[1] ? resolve(process.argv[1]) : "";

if (entryFilePath === currentFilePath) {
    void runFromCli().catch((error) => {
        // stderr: 直接写标准错误，避免中心服务启动早期日志依赖尚未准备好。
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}
