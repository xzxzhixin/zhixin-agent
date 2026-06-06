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
            this.sendHello();
        });
        this.socket.addEventListener("message", (event) => {
            this.options.onMessage(JSON.parse(String(event.data)) as WebSocketEnvelope);
        });
        this.socket.addEventListener("close", () => {
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
        this.socket?.close();
        this.options.onStateChange("stopped");
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
