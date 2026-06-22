import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {readCenterServiceConfig} from "./config.js";
import {CenterLogger} from "./logger.js";
import {installDesktopManagedLifecycleWatch} from "./manager-lifecycle-watch.js";
import {createCenterService} from "./service.js";

// PROCESS_PIPE_BROKEN_ERROR_CODE: IDEA 重启或父进程关闭管道后，Node 写 stdout/stderr 会抛出的错误码。
const PROCESS_PIPE_BROKEN_ERROR_CODE = "EPIPE";

// isFatalDiagnosticsWriting: 防止 uncaughtException/unhandledRejection 诊断自身再次抛错后进入递归日志风暴。
let isFatalDiagnosticsWriting = false;
// isProcessStderrBroken: stderr 断管后不再尝试写控制台，避免高 CPU 的 EPIPE 循环。
let isProcessStderrBroken = false;

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
        safeWriteProcessStdout(`中心服务已在运行，复用端口 ${config.port}。\n`);
        await service.close();
        return;
    }

    await logger.info("中心服务监听启动", {
        port: config.port,
    });

    // lifecycleWatch: 桌面托管模式下监护桌面壳主进程，正常关闭时需要先停掉定时器。
    let lifecycleWatch: {stop: () => void} | null = null;
    // isShuttingDown: 多个信号或管理者消失只能进入一次关闭流程。
    let isShuttingDown = false;

    const shutdown = async (exitCode = 0): Promise<void> => {
        if (isShuttingDown) {
            return;
        }
        isShuttingDown = true;
        lifecycleWatch?.stop();
        try {
            await service.close();
            process.exit(exitCode);
        } catch (error) {
            await logger.error("中心服务关闭失败", {
                errorMessage: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack ?? null : null,
            });
            process.exit(1);
        }
    };

    lifecycleWatch = installDesktopManagedLifecycleWatch({
        logger,
        closeService: () => shutdown(0),
    });

    process.once("SIGINT", () => {
        void shutdown(0);
    });
    process.once("SIGTERM", () => {
        void shutdown(0);
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
        const diagnosticPayload = {
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack ?? null,
        };
        writeFatalDiagnostics(
            logger,
            "中心进程未捕获异常",
            diagnosticPayload,
            diagnosticPayload.errorStack ?? diagnosticPayload.errorMessage,
        );
    });

    // unhandledRejection: 第三方流或工具 Promise 拒绝必须消费成日志，不能让 Node 默认策略退出服务。
    process.on("unhandledRejection", (reason: unknown) => {
        const normalizedReason = normalizeFatalReason(reason);
        writeFatalDiagnostics(
            logger,
            "中心进程未处理拒绝",
            normalizedReason,
            normalizedReason.errorStack ?? normalizedReason.errorMessage,
        );
    });
}

/**
 * writeFatalDiagnostics：安全写入进程级异常诊断。
 *
 * 关键逻辑：fatal 处理器自身不能因为日志或 stderr 断管再次抛错，否则会形成 EPIPE 递归和高 CPU。
 *
 * @param logger 中心服务日志实例。
 * @param event 日志事件名。
 * @param payload 结构化异常载荷。
 * @param stderrMessage stderr 兜底诊断文本。
 * @returns 没有返回值。
 */
function writeFatalDiagnostics(
    logger: CenterLogger,
    event: string,
    payload: Record<string, unknown>,
    stderrMessage: string,
): void {
    if (isFatalDiagnosticsWriting) {
        safeWriteProcessStderr(`${stderrMessage}\n`);
        return;
    }

    isFatalDiagnosticsWriting = true;
    void logger.error(
        event,
        payload,
    ).catch(() => {
        // catch: 进程级诊断不能因为日志写入失败再次抛错。
    }).finally(() => {
        isFatalDiagnosticsWriting = false;
    });
    safeWriteProcessStderr(`${stderrMessage}\n`);
}

/**
 * safeWriteProcessStdout：安全写 stdout。
 *
 * @param text 输出文本。
 * @returns 没有返回值。
 */
function safeWriteProcessStdout(text: string): void {
    try {
        process.stdout.write(text);
    } catch (error) {
        if (!isProcessPipeBrokenError(error)) {
            throw error;
        }
    }
}

/**
 * safeWriteProcessStderr：安全写 stderr。
 *
 * @param text 输出文本。
 * @returns 没有返回值。
 */
function safeWriteProcessStderr(text: string): void {
    if (isProcessStderrBroken) {
        return;
    }

    try {
        process.stderr.write(text);
    } catch (error) {
        if (isProcessPipeBrokenError(error)) {
            isProcessStderrBroken = true;
            return;
        }
        throw error;
    }
}

/**
 * isProcessPipeBrokenError：判断进程标准流是否已经断管。
 *
 * @param error 捕获到的未知异常。
 * @returns 命中 EPIPE 时返回 true。
 */
function isProcessPipeBrokenError(error: unknown): boolean {
    return error instanceof Error
        && "code" in error
        && (error as NodeJS.ErrnoException).code === PROCESS_PIPE_BROKEN_ERROR_CODE;
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
        safeWriteProcessStderr(`${error instanceof Error ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}
