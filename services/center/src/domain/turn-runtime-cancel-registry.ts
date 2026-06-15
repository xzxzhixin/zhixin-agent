/**
 * TurnRuntimeAbortError：当前轮次运行时取消异常。
 */
export class TurnRuntimeAbortError extends Error {
    /**
     * constructor：创建用户取消异常。
     *
     * @param reason 取消原因。
     */
    constructor(reason: string) {
        super(reason);
        this.name = "TurnRuntimeAbortError";
    }
}

interface RunningTurnRuntime {
    /** controller: 当前轮次真实执行的中止控制器。 */
    controller: AbortController;
    /** reason: 用户或系统触发取消时记录的原因。 */
    reason: string | null;
}

// runningTurnRuntimes: 进程内运行期表，只表达当前进程真实执行，不进入数据库事实源。
const runningTurnRuntimes = new Map<string, RunningTurnRuntime>();

/**
 * registerRunningTurnRuntime：注册当前轮次运行时取消信号。
 *
 * @param turnId 当前轮次 ID。
 * @returns 当前轮次 AbortController。
 */
export function registerRunningTurnRuntime(turnId: string): AbortController {
    const controller = new AbortController();
    runningTurnRuntimes.set(
        turnId,
        {
            controller,
            reason: null,
        },
    );
    return controller;
}

/**
 * unregisterRunningTurnRuntime：清理当前轮次运行时取消信号。
 *
 * @param turnId 当前轮次 ID。
 * @param controller 当前轮次控制器，用于避免迟到清理误删新运行时。
 * @returns 没有返回值。
 */
export function unregisterRunningTurnRuntime(
    turnId: string,
    controller: AbortController,
): void {
    const runtime = runningTurnRuntimes.get(turnId);
    if (runtime?.controller !== controller) {
        return;
    }
    runningTurnRuntimes.delete(turnId);
}

/**
 * abortRunningTurnRuntime：中止当前进程内正在执行的轮次。
 *
 * @param turnId 当前轮次 ID。
 * @param reason 取消原因。
 * @returns 找到并触发中止时返回 true。
 */
export function abortRunningTurnRuntime(
    turnId: string,
    reason: string,
): boolean {
    const runtime = runningTurnRuntimes.get(turnId);
    if (!runtime) {
        return false;
    }
    runtime.reason = reason;
    if (!runtime.controller.signal.aborted) {
        runtime.controller.abort(new TurnRuntimeAbortError(reason));
    }
    return true;
}

/**
 * throwIfTurnRuntimeAborted：在执行边界主动抛出当前轮次取消异常。
 *
 * @param signal 当前轮次运行时中止信号。
 * @returns 没有返回值。
 */
export function throwIfTurnRuntimeAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) {
        return;
    }
    const reason = signal.reason;
    if (reason instanceof TurnRuntimeAbortError) {
        throw reason;
    }
    throw new TurnRuntimeAbortError("当前轮次已取消。");
}

/**
 * isTurnRuntimeAbortError：判断异常是否来自用户取消轮次。
 *
 * @param error 待判断异常。
 * @returns 是取消异常时返回 true。
 */
export function isTurnRuntimeAbortError(error: unknown): boolean {
    if (error instanceof TurnRuntimeAbortError) {
        return true;
    }
    return error instanceof Error && error.name === "AbortError";
}
