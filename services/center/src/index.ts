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
    const logger = new CenterLogger(config.centerDirectory);
    installProcessFatalDiagnostics(logger);
    const service = await createCenterService(config);
    const listenResult = await service.listen();
    if (listenResult.reusedExisting) {
        await logger.info("中心服务复用已有实例", {
            port: config.port,
            centerDirectory: config.centerDirectory,
        });
        process.stdout.write(`中心服务已在运行，复用端口 ${config.port}。\n`);
        await service.close();
        return;
    }

    await logger.info("中心服务监听启动", {
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

/**
 * installProcessFatalDiagnostics：记录运行期未捕获异常，避免异步取消链路直接沉默打掉中心服务。
 *
 * @param logger 中心服务文件日志。
 * @returns 没有返回值。
 */
function installProcessFatalDiagnostics(logger: CenterLogger): void {
    // uncaughtException: 运行期事件回调中的同步异常必须落日志，便于定位停止按钮等异步链路问题。
    process.on("uncaughtException", (error: Error) => {
        void logger.error("中心进程未捕获异常", {
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack ?? null,
        }).catch(() => {
            // catch: 进程级诊断不能因为日志写入失败再次抛错。
        });
        process.stderr.write(`${error.stack ?? error.message}\n`);
    });

    // unhandledRejection: 第三方流或工具 Promise 拒绝必须消费成日志，不能让 Node 默认策略退出服务。
    process.on("unhandledRejection", (reason: unknown) => {
        const normalizedReason = normalizeFatalReason(reason);
        void logger.error("中心进程未处理拒绝", normalizedReason).catch(() => {
            // catch: 进程级诊断不能因为日志写入失败再次抛错。
        });
        process.stderr.write(`${normalizedReason.errorStack ?? normalizedReason.errorMessage}\n`);
    });
}

/**
 * normalizeFatalReason：把进程级异常原因转成可写入 JSON 日志的结构。
 *
 * @param reason 未处理拒绝或异常原因。
 * @returns 标准化错误日志载荷。
 */
function normalizeFatalReason(reason: unknown): {
    /** errorName: 错误类型名。 */
    errorName: string;
    /** errorMessage: 错误说明。 */
    errorMessage: string;
    /** errorStack: 错误堆栈；非 Error 时为空。 */
    errorStack: string | null;
} {
    if (reason instanceof Error) {
        return {
            errorName: reason.name,
            errorMessage: reason.message,
            errorStack: reason.stack ?? null,
        };
    }
    return {
        errorName: "NonErrorRejection",
        errorMessage: String(reason),
        errorStack: null,
    };
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
