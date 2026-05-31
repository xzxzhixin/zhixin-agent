/**
 * 阶段 3 领域专项实时推送检查。
 *
 * 用途：验证任务、智能体状态和通知不仅写入 event.appended，也会按专项协议推送。
 * 关键逻辑：建立真实 WebSocket 连接后触发对应 REST 接口，等待 task.updated、agent.state.changed 和 notification.created。
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
    // timer: 超时代表专项推送缺失，避免检查脚本无限等待。
    const timer = setTimeout(() => {
      reject(new Error("等待领域专项 WebSocket 消息超时"));
    }, 5000);

    socket.on("message", (data) => {
      // message: 中心服务实时协议包，来源于 WebSocket JSON 字符串。
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
 * main：执行领域专项推送检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  // tempRoot: 本次检查使用的临时目录，避免污染真实中心目录。
  const tempRoot = await mkdtemp(join(tmpdir(), "zhixin-center-domain-push-"));
  // centerDirectory: 临时中心目录，按架构默认 center-data 命名。
  const centerDirectory = join(tempRoot, CENTER_DATA_DIR_NAME);
  // service: 中心服务实例，finally 中统一释放端口和 SQLite。
  let service: CenterService | null = null;
  // socket: WebSocket 客户端，finally 中统一关闭。
  let socket: WebSocket | null = null;

  try {
    // config: 使用随机端口和临时中心目录运行检查。
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
    // baseUrl: WebSocket 地址由 Fastify 监听地址转换而来。
    const baseUrl = address.replace("http://", "ws://");

    const accessResponse = await service.app.inject({
      method: "POST",
      url: "/api/access/authorize-local",
      headers: {
        "x-forwarded-for": "127.0.0.1",
      },
      payload: {
        clientType: "web-local",
      },
    });
    const access = accessResponse.json<ApiResponse<{
      clientId: string;
    }>>();
    assert(access.success, "领域推送检查前本机授权失败");

    const sessionResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionType: "normal",
        projectId: null,
        title: "领域推送检查会话",
      },
    });
    const session = sessionResponse.json<ApiResponse<{
      sessionId: string;
    }>>();
    assert(session.success, "领域推送检查前会话创建失败");

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
        clientId: access.data?.clientId,
        clientType: "web-local",
      },
    }));
    await readyPromise;

    const taskPromise = waitForMessage<{
      type: string;
      payload: {
        taskId: string;
      };
    }>(socket, (message) => message.type === "task.updated");

    const sendResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/message/send",
      payload: {
        sessionId: session.data?.sessionId,
        contentMarkdown: "触发任务专项推送",
      },
    });
    const sent = sendResponse.json<ApiResponse<{
      taskId: string;
    }>>();
    assert(sent.success, "领域推送检查消息发送失败");
    const taskMessage = await taskPromise;
    assert(taskMessage.payload.taskId === sent.data?.taskId, "task.updated 没有携带任务 ID");

    const agentPromise = waitForMessage<{
      type: string;
      payload: {
        agentId: string;
        status: string;
      };
    }>(socket, (message) => message.type === "agent.state.changed");
    await service.app.inject({
      method: "POST",
      url: "/api/agent/runtime-state/set",
      payload: {
        agentId: "main",
        status: "working",
        currentTaskId: sent.data?.taskId,
      },
    });
    const agentMessage = await agentPromise;
    assert(agentMessage.payload.agentId === "main", "agent.state.changed 没有携带智能体 ID");
    assert(agentMessage.payload.status === "working", "agent.state.changed 没有携带智能体状态");

    const notificationPromise = waitForMessage<{
      type: string;
      payload: {
        notificationId: string;
      };
    }>(socket, (message) => message.type === "notification.created");
    await service.app.inject({
      method: "POST",
      url: "/api/notification/create",
      payload: {
        targetClientType: "web-local",
        title: "领域推送通知",
        summary: "通知专项推送检查",
        requiresUserAction: false,
      },
    });
    const notificationMessage = await notificationPromise;
    assert(Boolean(notificationMessage.payload.notificationId), "notification.created 没有携带通知 ID");
  } finally {
    socket?.close();
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
  // catch: 输出原始错误，方便定位专项实时推送缺口。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态。
  process.exitCode = 1;
});
