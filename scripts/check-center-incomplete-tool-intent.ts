/**
 * 半截工具意图回复检查。
 *
 * 用途：验证模型给出“准备改用命令继续查询”这类非最终文本时，中心服务不能直接固化为完成助手回复。
 * 关键逻辑：使用临时中心目录和本地假模型服务，让模型只返回继续执行提示且不携带工具调用，检查轮次不会完成。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错。
 */
import {
  createServer,
  type Server,
} from "node:http";
import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  tmpdir,
} from "node:os";
import {
  join,
} from "node:path";

import {
  CENTER_DATA_DIR_NAME,
  type ApiResponse,
  type EventRecord,
} from "../packages/shared/src/index";

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
function assert(
  condition: boolean,
  message: string,
): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * startIncompleteModelServer：启动只返回半截继续执行话术的 OpenAI 兼容假模型。
 *
 * @returns 服务地址和关闭函数。
 */
async function startIncompleteModelServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer(async (
    request,
    response,
  ) => {
    if (request.method !== "POST") {
      response.writeHead(404);
      response.end();
      return;
    }

    // 模型故意不返回 tool_calls，用来复现“半截话被当成最终回复”的缺陷。
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: "刚才检测到当前环境使用的是 Windows PowerShell，我改用 PowerShell 命令重新查询。",
          },
        },
      ],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 12,
        total_tokens: 20,
      },
    }));
  });

  const port = await listenOnRandomPort(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

/**
 * listenOnRandomPort：让本地假模型监听随机端口。
 *
 * @param server HTTP 服务实例。
 * @returns 随机监听端口。
 */
function listenOnRandomPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(
      0,
      "127.0.0.1",
      () => {
        const address = server.address();
        if (typeof address === "object" && address !== null) {
          resolve(address.port);
          return;
        }
        reject(new Error("FAKE_MODEL_PORT_UNAVAILABLE"));
      },
    );
  });
}

/**
 * writeEnabledProvider：写入启用的假模型供应商配置。
 *
 * @param centerDirectory 临时中心目录。
 * @param baseUrl 假模型服务地址。
 * @returns 没有返回值。
 */
async function writeEnabledProvider(
  centerDirectory: string,
  baseUrl: string,
): Promise<void> {
  await writeFile(
    join(
      centerDirectory,
      "providers",
      "fake-incomplete-intent.json",
    ),
    JSON.stringify(
      {
        providerId: "fake-incomplete-intent",
        displayName: "半截意图假模型",
        baseUrl,
        protocolPluginId: "openai-builtin",
        protocolMode: "chat-completions",
        defaultModel: "fake-incomplete-model",
        defaultReasoningEffort: null,
        enabled: true,
        apiKeySecretRef: null,
        proxyStrategy: "none",
        capabilities: {
          supportsVision: false,
          supportsToolCalling: true,
          supportsJsonOutput: true,
          supportsReasoningEffort: false,
          supportsCacheUsage: false,
          supportsModelList: false,
          supportsStreaming: false,
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

/**
 * waitForTurnTerminalEvent：等待当前轮次写入完成、失败或等待用户事件。
 *
 * @param service 中心服务实例。
 * @param sessionId 会话 ID。
 * @param turnId 轮次 ID。
 * @returns 当前轮次事件数组。
 */
async function waitForTurnTerminalEvent(
  service: CenterService,
  sessionId: string,
  turnId: string,
): Promise<EventRecord[]> {
  const startedAt = Date.now();
  let latestEvents: EventRecord[] = [];

  while (Date.now() - startedAt < 5000) {
    const eventResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/event/list",
      payload: {
        sessionId,
        turnId,
        afterSequence: 0,
      },
    });
    const eventList = eventResponse.json<ApiResponse<{
      events: EventRecord[];
    }>>();
    assert(eventList.success, `事件读取失败：${JSON.stringify(eventList.error)}`);
    latestEvents = eventList.data?.events ?? [];

    const terminalEvent = latestEvents.find((event) => {
      return event.eventType === "turn.updated"
        || event.eventType === "message.turn.incomplete";
    });
    if (terminalEvent) {
      return latestEvents;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
  }

  return latestEvents;
}

/**
 * main：执行半截工具意图检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  const tempRoot = await mkdtemp(join(
    tmpdir(),
    "zhixin-center-incomplete-intent-",
  ));
  const centerDirectory = join(
    tempRoot,
    CENTER_DATA_DIR_NAME,
  );
  const fakeModelServer = await startIncompleteModelServer();
  let service: CenterService | null = null;

  try {
    const config = readCenterServiceConfig({
      cwd: tempRoot,
      env: {
        ZHIXIN_CENTER_DIR: centerDirectory,
      },
    });
    service = await createCenterService(config);
    await service.initialize();
    await writeEnabledProvider(
      centerDirectory,
      fakeModelServer.baseUrl,
    );

    const sessionResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionType: "normal",
        projectId: null,
        title: "半截工具意图检查",
      },
    });
    const session = sessionResponse.json<ApiResponse<{
      sessionId: string;
    }>>();
    assert(session.success, "半截工具意图检查会话创建失败");

    const sendResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/message/send",
      payload: {
        sessionId: session.data?.sessionId,
        contentMarkdown: "查看可用的 Node.js 和 Python 版本。",
      },
    });
    const sent = sendResponse.json<ApiResponse<{
      turnId: string;
    }>>();
    assert(sent.success, `消息发送失败：${JSON.stringify(sent.error)}`);

    const events = await waitForTurnTerminalEvent(
      service,
      session.data?.sessionId ?? "",
      sent.data?.turnId ?? "",
    );
    const eventTypes = events.map((event) => {
      return event.eventType;
    });
    const thinkingEvents = events.filter((event) => {
      return event.eventType.startsWith("thinking.");
    });
    const thinkingIds = new Set(thinkingEvents.map((event) => {
      const payload = typeof event.payload === "object" && event.payload !== null
        ? event.payload as {
          thinkingId?: unknown;
        }
        : {};
      return typeof payload.thinkingId === "string" ? payload.thinkingId : "";
    }));
    const detailResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/detail",
      payload: {
        sessionId: session.data?.sessionId,
      },
    });
    const detail = detailResponse.json<ApiResponse<{
      messages: Array<{
        role: string;
        contentMarkdown: string;
      }>;
      turns: Array<{
        turnId: string;
        status: string;
      }>;
    }>>();
    assert(detail.success, "会话详情读取失败");

    const turn = detail.data?.turns.find((item) => {
      return item.turnId === sent.data?.turnId;
    });
    const assistantMessages = detail.data?.messages.filter((message) => {
      return message.role === "assistant";
    }) ?? [];

    assert(
      thinkingEvents.length >= 2 && thinkingIds.size === 1 && !thinkingIds.has(""),
      "同一次思考的 delta 和 completed 事件必须携带同一个 thinkingId，避免前端拆成两张思考卡片。",
    );
    assert(
      eventTypes.includes("message.turn.incomplete"),
      "半截继续执行话术必须写入 message.turn.incomplete 事件，不能静默结束。",
    );
    assert(
      turn?.status !== "completed",
      `半截继续执行话术不能把轮次标记为 completed，当前状态为 ${turn?.status}`,
    );
    assert(
      assistantMessages.length === 0,
      "半截继续执行话术不能固化为最终助手消息。",
    );
  } finally {
    await service?.close().catch(() => {
      // ignore: 检查失败时继续清理临时中心服务。
    });
    await fakeModelServer.close().catch(() => {
      // ignore: 检查失败时继续清理假模型服务。
    });
    await rm(
      tempRoot,
      {
        force: true,
        recursive: true,
      },
    );
  }
}

void main().catch((error) => {
  // catch: 输出原始错误，方便定位半截回复闭环问题。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态。
  process.exitCode = 1;
});
