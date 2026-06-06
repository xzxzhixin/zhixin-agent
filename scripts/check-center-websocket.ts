/**
 * 阶段 3 WebSocket 同步通道检查。
 *
 * 用途：验证中心服务能完成 client.hello/server.ready 握手，并在消息发送后推送 event.appended。
 * 关键逻辑：使用随机端口启动临时中心服务，通过 Node WebSocket 客户端做真实连接。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CENTER_DATA_DIR_NAME,
  type ApiResponse,
} from "@zhixin/shared";
import WebSocket from "ws";

import {
  type CenterService,
  createCenterService,
  readCenterServiceConfig,
} from "../services/center/src/index";

/**
 * assert：用统一错误格式表达检查失败原因。
 *
 * @param condition 需要满足的布尔条件。
 * @param message 条件不满足时抛出的中文错误。
 * @returns 条件满足时没有返回值。
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * waitForMessage：等待 WebSocket 收到满足条件的消息。
 *
 * @param socket WebSocket 客户端。
 * @param predicate 消息筛选函数。
 * @returns 匹配到的消息对象。
 */
function waitForMessage<TMessage>(
  socket: WebSocket,
  predicate: (message: TMessage) => boolean,
): Promise<TMessage> {
  return new Promise((resolve, reject) => {
    // timer: 超时后失败，避免检查脚本无限等待。
    const timer = setTimeout(() => {
      reject(new Error("等待 WebSocket 消息超时"));
    }, 5000);

    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as TMessage;

      if (!predicate(message)) {
        return;
      }

      clearTimeout(timer);
      resolve(message);
    });
  });
}

/**
 * closeSocket：关闭 WebSocket 并等待 close 事件。
 *
 * @param socket WebSocket 客户端。
 * @returns 关闭完成后没有返回值。
 */
async function closeSocket(socket: WebSocket | null): Promise<void> {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    socket.once("close", () => {
      resolve();
    });
    socket.close();
    setTimeout(resolve, 500);
  });
}

/**
 * main：执行 WebSocket 检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  // tempRoot: 本次检查的临时根目录。
  const tempRoot = await mkdtemp(join(tmpdir(), "zhixin-center-websocket-"));
  // centerDirectory: 临时中心目录。
  const centerDirectory = join(tempRoot, CENTER_DATA_DIR_NAME);
  // service: 保存中心服务实例，确保失败时释放 SQLite 和端口。
  let service: CenterService | null = null;
  // socket: 保存 WebSocket 客户端，确保失败时关闭连接。
  let socket: WebSocket | null = null;

  try {
    // port: 使用 0 让系统选择空闲端口，避免占用默认 8866。
    const config = readCenterServiceConfig({
      cwd: tempRoot,
      env: {
        ZHIXIN_CENTER_PORT: "0",
        ZHIXIN_CENTER_DIR: centerDirectory,
      },
    });
    service = await createCenterService(config);
    await service.initialize();
    await service.startupLock.acquire();
    const address = await service.app.listen({
      host: "127.0.0.1",
      port: 0,
    });
    const baseUrl = address.replace("http://", "ws://");

    const localAccessResponse = await service.app.inject({
      method: "POST",
      url: "/api/access/authorize-local",
      headers: {
        "x-forwarded-for": "127.0.0.1",
      },
      payload: {
        clientType: "web-local",
      },
    });
    const localAccess = localAccessResponse.json<ApiResponse<{
      clientId: string;
    }>>();
    assert(localAccess.success, "WebSocket 检查前本机授权失败");

    const sessionResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionType: "normal",
        projectId: null,
        title: "WebSocket 检查会话",
      },
    });
    const session = sessionResponse.json<ApiResponse<{
      sessionId: string;
    }>>();
    assert(session.success, "WebSocket 检查前会话创建失败");

    socket = new WebSocket(`${baseUrl}/api/sync`);
    await new Promise<void>((resolve, reject) => {
      socket?.on("open", () => resolve());
      socket?.on("error", () => reject(new Error("WebSocket 连接失败")));
    });

    const readyPromise = waitForMessage<{
      type: string;
    }>(socket, (message) => message.type === "server.ready");
    socket.send(JSON.stringify({
      type: "client.hello",
      payload: {
        clientId: localAccess.data?.clientId,
        clientType: "web-local",
      },
    }));
    await readyPromise;

    const eventPromise = waitForMessage<{
      type: string;
      payload: {
        eventType: string;
        turnId: string | null;
      };
    }>(socket, (message) => {
      return message.type === "event.appended"
        && (
          message.payload.eventType === "model.failed"
          || message.payload.eventType === "turn.updated"
        );
    });

    const sendResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/message/send",
      payload: {
        sessionId: session.data?.sessionId,
        contentMarkdown: "WebSocket 检查消息",
      },
    });
    const sent = sendResponse.json<ApiResponse<{
      turnId: string;
    }>>();
    assert(sent.success, `WebSocket 检查发送消息失败：${JSON.stringify(sent.error)}`);

    const eventMessage = await eventPromise;
    assert(eventMessage.payload.turnId === sent.data?.turnId, "WebSocket 检查收到的终态事件不属于当前轮次");
  } finally {
    await closeSocket(socket);
    await service?.app.close().catch(() => {
      // ignore: 本检查直接调用 app.listen，必须显式关闭 Fastify 监听句柄。
    });
    await service?.close().catch(() => {
      // ignore: 检查失败时仍继续清理临时目录。
    });
    await rm(tempRoot, {
      force: true,
      recursive: true,
    });
  }
}

void main().catch((error) => {
  // catch: 检查失败时输出原始错误，便于定位 WebSocket 通道问题。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态。
  process.exitCode = 1;
});
