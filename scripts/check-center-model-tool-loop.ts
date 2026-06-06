/**
 * 模型工具调用闭环检查。
 *
 * 用途：验证工具调用由模型响应中的结构化工具请求触发，而不是由用户文本硬编码匹配触发。
 * 关键逻辑：使用临时中心目录和本地假模型服务，驱动中心服务完成“模型请求工具 -> 中心服务执行 -> 工具结果回填模型 -> 最终回复”。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {
  CENTER_DATA_DIR_NAME,
  type ApiResponse,
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
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * startFakeModelServer：启动支持工具调用两步返回的本地假模型服务。
 *
 * @returns 服务地址、请求体列表和关闭函数。
 */
async function startFakeModelServer(): Promise<{
  baseUrl: string;
  readRequests: () => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
}> {
  const serverScript = [
    "const { createServer } = require('node:http');",
    "const requests = [];",
    "function readBody(request) {",
    "  return new Promise((resolve, reject) => {",
    "    let body = '';",
    "    request.setEncoding('utf-8');",
    "    request.on('data', (chunk) => { body += chunk; });",
    "    request.on('end', () => resolve(body));",
    "    request.on('error', reject);",
    "  });",
    "}",
    "function writeJson(response, payload) {",
    "  response.writeHead(200, { 'content-type': 'application/json' });",
    "  response.end(JSON.stringify(payload));",
    "}",
    "const server = createServer(async (request, response) => {",
    "  if (request.url === '/__requests') {",
    "    writeJson(response, { requests });",
    "    return;",
    "  }",
    "  const body = JSON.parse(await readBody(request));",
    "  requests.push(body);",
    "  const messages = Array.isArray(body.messages) ? body.messages : [];",
    "  const hasToolResult = messages.some((message) => message && typeof message === 'object' && message.role === 'tool');",
    "  if (hasToolResult) {",
    "    const toolMessage = messages.find((message) => message && typeof message === 'object' && message.role === 'tool');",
    "    if (!toolMessage.tool_call_id) {",
    "      response.writeHead(400, { 'content-type': 'application/json' });",
    "      response.end(JSON.stringify({ error: { message: \"Missing required parameter: 'messages[].tool_call_id'.\" } }));",
    "      return;",
    "    }",
    "    writeJson(response, { choices: [{ message: { role: 'assistant', content: '已根据工具结果完成最终回复。' } }], usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 } });",
    "    return;",
    "  }",
    "  const tools = Array.isArray(body.tools) ? body.tools : [];",
    "  const firstTool = tools[0] && typeof tools[0] === 'object' ? tools[0] : {};",
    "  const firstFunction = firstTool.function && typeof firstTool.function === 'object' ? firstTool.function : {};",
    "  const toolName = typeof firstFunction.name === 'string' ? firstFunction.name : '';",
    "  writeJson(response, { choices: [{ message: { role: 'assistant', content: JSON.stringify({ toolCall: { toolCallId: 'tool-call-node-version', name: toolName, argumentsJson: { executablePath: process.execPath, args: ['-v'], inputSummary: '由模型请求读取 Node.js 版本。' } } }) } }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } });",
    "});",
    "server.listen(0, '127.0.0.1', () => {",
    "  const address = server.address();",
    "  process.stdout.write(JSON.stringify({ port: address.port }) + '\\n');",
    "});",
  ].join("\n");
  const child = spawn(
    process.execPath,
    [
      "-e",
      serverScript,
    ],
    {
      windowsHide: true,
    },
  );
  const port = await readFakeServerPort(child);
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    readRequests: async () => {
      const response = await fetch(`${baseUrl}/__requests`);
      const body = await response.json() as {
        requests: Record<string, unknown>[];
      };
      return body.requests;
    },
    close: () => {
      return new Promise((resolve, reject) => {
        child.once("exit", () => {
          resolve();
        });
        child.kill();
        setTimeout(() => {
          reject(new Error("FAKE_MODEL_SERVER_CLOSE_TIMEOUT"));
        }, 2000).unref();
      });
    },
  };
}

/**
 * readFakeServerPort：读取假模型子进程启动端口。
 *
 * @param child 假模型服务子进程。
 * @returns 监听端口。
 */
function readFakeServerPort(child: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const line = stdout.split("\n")[0];
      if (!line) {
        return;
      }
      try {
        const parsed = JSON.parse(line) as {
          port?: unknown;
        };
        if (typeof parsed.port === "number") {
          resolve(parsed.port);
        }
      } catch (error) {
        reject(error);
      }
    });
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk) => {
      reject(new Error(String(chunk)));
    });
    child.on("error", reject);
  });
}

/**
 * writeEnabledProvider：写入启用的 OpenAI 兼容供应商配置。
 *
 * @param centerDirectory 中心目录。
 * @param baseUrl 假模型服务地址。
 * @returns 没有返回值。
 */
async function writeEnabledProvider(centerDirectory: string, baseUrl: string): Promise<void> {
  await writeFile(
    join(centerDirectory, "providers", "fake-tool-loop.json"),
    JSON.stringify(
      {
        providerId: "fake-tool-loop",
        displayName: "工具闭环假模型",
        baseUrl,
        protocolPluginId: "builtin-model-openai-compatible",
        protocolMode: "chat-completions",
        defaultModel: "fake-tool-model",
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
 * sendMessageAndReadEvents：发送消息并读取本轮事件。
 *
 * @param service 中心服务实例。
 * @param sessionId 会话 ID。
 * @param contentMarkdown 用户消息。
 * @returns 本轮任务和事件。
 */
async function sendMessageAndReadEvents(
  service: CenterService,
  sessionId: string,
  contentMarkdown: string,
): Promise<{
  taskId: string;
  turnId: string;
  events: Array<{
    eventType: string;
    payload: unknown;
    summary: string;
  }>;
}> {
  const sendResponse = await service.app.inject({
    method: "POST",
    url: "/api/session/message/send",
    payload: {
      sessionId,
      contentMarkdown,
    },
  });
  const sent = sendResponse.json<ApiResponse<{
    taskId: string;
    turnId: string;
  }>>();
  assert(sent.success, `消息发送失败：${JSON.stringify(sent.error)}`);
  await new Promise((resolve) => {
    setTimeout(resolve, 120);
  });

  const eventResponse = await service.app.inject({
    method: "POST",
    url: "/api/session/event/list",
    payload: {
      sessionId,
      turnId: sent.data?.turnId,
      afterSequence: 0,
    },
  });
  const eventList = eventResponse.json<ApiResponse<{
    events: Array<{
      eventType: string;
      payload: unknown;
      summary: string;
    }>;
  }>>();
  assert(eventList.success, `事件读取失败：${JSON.stringify(eventList.error)}`);

  return {
    taskId: sent.data?.taskId ?? "",
    turnId: sent.data?.turnId ?? "",
    events: eventList.data?.events ?? [],
  };
}

/**
 * main：执行工具调用闭环检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "zhixin-center-model-tool-loop-"));
  const centerDirectory = join(tempRoot, CENTER_DATA_DIR_NAME);
  const fakeModelServer = await startFakeModelServer();
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
    await writeEnabledProvider(centerDirectory, fakeModelServer.baseUrl);

    const sessionResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionType: "normal",
        projectId: null,
        title: "模型工具闭环检查",
      },
    });
    const session = sessionResponse.json<ApiResponse<{
      sessionId: string;
    }>>();
    assert(session.success, "工具闭环检查会话创建失败");
    const sessionId = session.data?.sessionId ?? "";

    const toolTurn = await sendMessageAndReadEvents(
      service,
      sessionId,
      "请根据可用工具读取当前 Node.js 版本。",
    );
    const toolRequests = await fakeModelServer.readRequests();
    const toolEventTypes = toolTurn.events.map((event) => {
      return event.eventType;
    });
    assert(toolRequests.length >= 2, "模型工具调用没有形成二次模型请求");
    assert(toolEventTypes.includes("model.tool.requested"), "缺少模型工具请求事件");
    assert(toolEventTypes.includes("tool.command.started"), "缺少命令工具开始事件");
    assert(toolEventTypes.includes("tool.command.completed"), "缺少命令工具完成事件");
    assert(toolEventTypes.includes("model.tool.result.appended"), "缺少工具结果回填模型事件");

    const firstRequest = toolRequests[0];
    const firstTools = Array.isArray(firstRequest.tools) ? firstRequest.tools : [];
    assert(firstTools.some((tool) => {
      return typeof tool === "object"
        && tool !== null
        && (tool as {function?: {name?: unknown}}).function?.name === "builtin_command_run";
    }), "首次模型请求没有携带协议安全的结构化命令工具定义");
    assert(firstTools.every((tool) => {
      const toolName = typeof tool === "object"
        && tool !== null
        && typeof (tool as {function?: {name?: unknown}}).function?.name === "string"
        ? (tool as {function: {name: string}}).function.name
        : "";
      return /^[a-zA-Z0-9_-]+$/u.test(toolName);
    }), "模型工具定义名称必须满足 OpenAI 兼容协议命名约束");

    const secondRequest = toolRequests[1];
    const secondMessages = Array.isArray(secondRequest.messages) ? secondRequest.messages : [];
    assert(secondMessages.some((message) => {
      const toolCalls = typeof message === "object"
        && message !== null
        && Array.isArray((message as {tool_calls?: unknown}).tool_calls)
        ? (message as {tool_calls: unknown[]}).tool_calls
        : [];
      return toolCalls.some((toolCall) => {
        return typeof toolCall === "object"
          && toolCall !== null
          && (toolCall as {id?: unknown}).id === "tool-call-node-version";
      });
    }), "二次模型请求没有携带 assistant tool_calls 调用记录");
    assert(secondMessages.some((message) => {
      return typeof message === "object"
        && message !== null
        && (message as {role?: unknown}).role === "tool"
        && (message as {tool_call_id?: unknown}).tool_call_id === "tool-call-node-version";
    }), "二次模型请求没有携带带 tool_call_id 的工具结果消息");

    const plainTurn = await sendMessageAndReadEvents(
      service,
      sessionId,
      "请直接告诉我 node 版本这个词是什么意思，不要调用工具。",
    );
    const plainEventTypes = plainTurn.events.map((event) => {
      return event.eventType;
    });
    const allRequestsAfterPlainTurn = await fakeModelServer.readRequests();
    assert(plainEventTypes.includes("model.tool.requested"), "普通文本应该仍由模型决定是否请求工具");
    assert(!plainEventTypes.includes("tool.command.started") || allRequestsAfterPlainTurn.length >= 4, "不允许通过用户文本硬编码直接触发命令工具");
  } finally {
    await service?.close().catch(() => {
      // ignore: 检查失败时继续清理临时资源。
    });
    await fakeModelServer.close().catch(() => {
      // ignore: 检查失败时继续清理临时资源。
    });
    await rm(tempRoot, {
      force: true,
      recursive: true,
    });
  }
}

void main().catch((error) => {
  // catch: 输出原始错误，便于定位工具调用闭环问题。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态。
  process.exitCode = 1;
});
