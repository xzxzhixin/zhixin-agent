import type {
    ClientType,
    WebSocketEnvelope,
} from "@zhixin/shared";

/**
 * ReconnectingWebSocketClient：中心服务 WebSocket 自动重连客户端。
 *
 * 用途：前端订阅实时事件，并在断线后按固定次数尝试重连。
 * 关键逻辑：重连次数和间隔显式配置，达到上限后进入停止状态，不无限静默重试。
 */
export class ReconnectingWebSocketClient {
    /** socket: 当前 WebSocket 连接。 */
    private socket: WebSocket | null = null;

    /** retryCount: 已重试次数。 */
    private retryCount = 0;

    /** openWaiters: 等待连接打开的回调列表。 */
    private readonly openWaiters: Array<{
        /** resolve: 连接打开时完成等待。 */
        resolve: () => void;
        /** reject: 连接关闭或超时时拒绝等待。 */
        reject: (error: Error) => void;
        /** timeoutId: 等待连接打开的超时定时器。 */
        timeoutId: number;
    }> = [];

    /** pendingRequests: WebSocket 请求响应等待表，键为 requestId。 */
    private readonly pendingRequests = new Map<string, {
        /** resolve: 请求成功时回传业务载荷。 */
        resolve: (payload: unknown) => void;
        /** reject: 请求失败或超时时返回错误。 */
        reject: (error: Error) => void;
        /** timeoutId: 请求超时定时器 ID。 */
        timeoutId: number;
    }>();

    /**
     * constructor：保存连接配置。
     *
     * @param options WebSocket 连接选项。
     */
    constructor(private readonly options: {
        /** url: WebSocket 连接地址。 */
        url: string;
        /** clientId: 中心服务同步客户端 ID。 */
        clientId: string;
        /** clientType: 客户端类型。 */
        clientType: ClientType;
        /** projectId: IDE 插件项目范围，非项目入口为 null。 */
        projectId: string | null;
        /** maxRetries: 最大重连次数。 */
        maxRetries: number;
        /** retryIntervalMs: 重连间隔毫秒数。 */
        retryIntervalMs: number;
        /** onMessage: 收到中心服务消息时的回调。 */
        onMessage: (message: WebSocketEnvelope) => void;
        /** onStateChange: 连接状态变化回调。 */
        onStateChange: (state: "connecting" | "open" | "retrying" | "stopped") => void;
    }) {}

    /**
     * connect：建立 WebSocket 连接。
     *
     * @returns 没有返回值。
     */
    connect(): void {
        this.options.onStateChange("connecting");
        this.socket = new WebSocket(this.options.url);
        this.socket.addEventListener("open", () => {
            this.retryCount = 0;
            this.options.onStateChange("open");
            this.resolveOpenWaiters();
            this.sendHello();
        });
        this.socket.addEventListener("message", (event) => {
            const message = JSON.parse(String(event.data)) as WebSocketEnvelope;
            if (this.resolvePendingRequest(message)) {
                return;
            }
            this.options.onMessage(message);
        });
        this.socket.addEventListener("close", () => {
            this.rejectOpenWaiters("WEBSOCKET_CLOSED");
            this.rejectPendingRequests("WEBSOCKET_CLOSED");
            this.scheduleReconnect();
        });
    }

    /**
     * close：主动关闭连接并停止重连。
     *
     * @returns 没有返回值。
     */
    close(): void {
        this.retryCount = this.options.maxRetries;
        this.rejectPendingRequests("WEBSOCKET_CLOSED");
        this.socket?.close();
        this.options.onStateChange("stopped");
    }

    /**
     * waitUntilOpen：等待当前 WebSocket 连接进入 open 状态。
     *
     * @param timeoutMs 等待超时时间，单位毫秒。
     * @returns 连接打开后完成的 Promise。
     */
    waitUntilOpen(timeoutMs = 10000): Promise<void> {
        const socket = this.socket;
        if (socket?.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
            // timeoutId: 对话页 WebSocket-only 初始化需要可失败边界，避免页面永久等待。
            const timeoutId = window.setTimeout(() => {
                this.removeOpenWaiter(timeoutId);
                reject(new Error("WEBSOCKET_OPEN_TIMEOUT"));
            }, timeoutMs);
            this.openWaiters.push({
                resolve,
                reject,
                timeoutId,
            });
        });
    }

    /**
     * request：通过 WebSocket 发起请求并等待同 requestId 响应。
     *
     * @param type 请求类型，例如 session.snapshot。
     * @param payload 请求载荷。
     * @returns 服务端响应载荷。
     */
    request<TResponse>(type: string, payload: unknown): Promise<TResponse> {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error("WEBSOCKET_NOT_OPEN"));
        }
        const requestId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        return new Promise<TResponse>((resolve, reject) => {
            // timeoutId: WebSocket 请求必须有上限，避免服务端无响应时页面永久卡住。
            const timeoutId = window.setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error("WEBSOCKET_REQUEST_TIMEOUT"));
            }, 30000);
            this.pendingRequests.set(requestId, {
                resolve: (responsePayload) => {
                    resolve(responsePayload as TResponse);
                },
                reject,
                timeoutId,
            });
            socket.send(JSON.stringify({
                type,
                requestId,
                payload,
            } satisfies WebSocketEnvelope));
        });
    }

    /**
     * sendHello：连接建立后发送 client.hello。
     *
     * @returns 没有返回值。
     */
    private sendHello(): void {
        this.socket?.send(JSON.stringify({
            type: "client.hello",
            payload: {
                clientId: this.options.clientId,
                clientType: this.options.clientType,
                projectId: this.options.projectId,
            },
        } satisfies WebSocketEnvelope));
    }

    /**
     * resolvePendingRequest：处理服务端 WebSocket 请求响应。
     *
     * @param message 服务端消息包。
     * @returns 当前消息属于请求响应时返回 true。
     */
    private resolvePendingRequest(message: WebSocketEnvelope): boolean {
        if (!message.requestId) {
            return false;
        }
        const pending = this.pendingRequests.get(message.requestId);
        if (!pending) {
            return false;
        }
        this.pendingRequests.delete(message.requestId);
        window.clearTimeout(pending.timeoutId);
        if (message.type === "request.error") {
            const errorPayload = message.payload as {
                /** code: 服务端错误码。 */
                code?: string;
                /** message: 服务端错误消息。 */
                message?: string;
            };
            pending.reject(new Error(errorPayload.message ?? errorPayload.code ?? "WEBSOCKET_REQUEST_FAILED"));
            return true;
        }
        pending.resolve(message.payload);
        return true;
    }

    /**
     * rejectPendingRequests：连接关闭时拒绝所有等待中的请求。
     *
     * @param message 错误消息。
     * @returns 没有返回值。
     */
    private rejectPendingRequests(message: string): void {
        for (const pending of this.pendingRequests.values()) {
            window.clearTimeout(pending.timeoutId);
            pending.reject(new Error(message));
        }
        this.pendingRequests.clear();
    }

    /**
     * resolveOpenWaiters：连接打开后唤醒所有等待者。
     *
     * @returns 没有返回值。
     */
    private resolveOpenWaiters(): void {
        const waiters = this.openWaiters.splice(0);
        for (const waiter of waiters) {
            window.clearTimeout(waiter.timeoutId);
            waiter.resolve();
        }
    }

    /**
     * rejectOpenWaiters：连接失败时拒绝所有等待者。
     *
     * @param message 错误消息。
     * @returns 没有返回值。
     */
    private rejectOpenWaiters(message: string): void {
        const waiters = this.openWaiters.splice(0);
        for (const waiter of waiters) {
            window.clearTimeout(waiter.timeoutId);
            waiter.reject(new Error(message));
        }
    }

    /**
     * removeOpenWaiter：等待超时时移除对应等待者。
     *
     * @param timeoutId 超时定时器 ID。
     * @returns 没有返回值。
     */
    private removeOpenWaiter(timeoutId: number): void {
        const waiterIndex = this.openWaiters.findIndex((waiter) => waiter.timeoutId === timeoutId);
        if (waiterIndex >= 0) {
            this.openWaiters.splice(
                waiterIndex,
                1,
            );
        }
    }

    /**
     * scheduleReconnect：按固定次数和间隔重连。
     *
     * @returns 没有返回值。
     */
    private scheduleReconnect(): void {
        if (this.retryCount >= this.options.maxRetries) {
            this.options.onStateChange("stopped");
            return;
        }
        this.retryCount += 1;
        this.options.onStateChange("retrying");
        window.setTimeout(() => {
            this.connect();
        }, this.options.retryIntervalMs);
    }
}
