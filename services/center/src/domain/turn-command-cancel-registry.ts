/**
 * RunningCommandCancelHandler：当前轮次命令取消回调。
 *
 * @param reason 用户或系统触发取消时的可审计原因。
 * @returns 没有返回值。
 */
type RunningCommandCancelHandler = (reason: string) => void;

// runningCommandCancelHandlers: 进程内命令取消表，只保存当前运行中的子进程取消入口，不进入数据库事实源。
const runningCommandCancelHandlers = new Map<string, Set<RunningCommandCancelHandler>>();

/**
 * registerRunningCommandForTurn：注册当前轮次正在运行的命令取消入口。
 *
 * @param turnId 当前轮次 ID。
 * @param handler 命令取消回调，负责终止子进程并写入命令取消事件。
 * @returns 注销函数，用于命令自然完成或失败时清理注册。
 */
export function registerRunningCommandForTurn(
    turnId: string,
    handler: RunningCommandCancelHandler,
): () => void {
    const handlers = runningCommandCancelHandlers.get(turnId) ?? new Set<RunningCommandCancelHandler>();
    handlers.add(handler);
    runningCommandCancelHandlers.set(
        turnId,
        handlers,
    );

    return () => {
        unregisterRunningCommandForTurn(
            turnId,
            handler,
        );
    };
}

/**
 * cancelRunningCommandsForTurn：取消当前轮次所有正在运行的命令。
 *
 * @param turnId 当前轮次 ID。
 * @param reason 用户或系统触发取消时的可审计原因。
 * @returns 已尝试取消的命令数量。
 */
export function cancelRunningCommandsForTurn(
    turnId: string,
    reason: string,
): number {
    const handlers = runningCommandCancelHandlers.get(turnId);
    if (!handlers || handlers.size === 0) {
        return 0;
    }

    const handlersSnapshot = Array.from(handlers);
    runningCommandCancelHandlers.delete(turnId);
    for (const handler of handlersSnapshot) {
        try {
            handler(reason);
        } catch {
            // catch: 取消链路不能让单个命令清理异常逃逸到 WebSocket 请求栈，避免中心服务退出。
        }
    }
    return handlersSnapshot.length;
}

/**
 * unregisterRunningCommandForTurn：注销当前轮次中的一个命令取消入口。
 *
 * @param turnId 当前轮次 ID。
 * @param handler 命令取消回调。
 * @returns 没有返回值。
 */
function unregisterRunningCommandForTurn(
    turnId: string,
    handler: RunningCommandCancelHandler,
): void {
    const handlers = runningCommandCancelHandlers.get(turnId);
    if (!handlers) {
        return;
    }
    handlers.delete(handler);
    if (handlers.size === 0) {
        runningCommandCancelHandlers.delete(turnId);
    }
}
