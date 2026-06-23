/**
 * 模型工具调用闭环检查。
 *
 * 用途：验证工具调用由模型响应中的结构化工具请求触发，而不是由用户文本硬编码匹配触发。
 * 关键逻辑：使用临时中心目录和本地假模型服务，驱动中心服务完成“模型请求工具 -> 中心服务执行 -> 工具结果回填模型 -> 最终回复”。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {mkdtemp, rm} from "node:fs/promises";
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
 * assertDeepAgentsRunnerWiring：检查中心服务主执行路径已经切换到 Deep Agents 原生 agent。
 *
 * 用途：防止迁移后继续通过中心服务自建执行图或旧手写 LangGraph runner 作为主路径执行。
 * 关键逻辑：检查 `deepagents-runner.ts` 和旧 `langgraph-runner.ts` 都已删除，会话域改为直接调用新入口。
 * 参数：无。
 * 返回值：检查通过时没有返回值；不满足迁移口径时抛错。
 */
function assertDeepAgentsRunnerWiring(): void {
  // deepagentsRunnerPath: 已废弃的中心服务执行图壳文件，迁移完成后不得继续存在。
  const deepagentsRunnerPath = join(
    process.cwd(),
    "services",
    "center",
    "src",
    "deepagents-runner.ts",
  );
  // legacyRunnerPath: 旧手写 LangGraph runner，迁移完成后不得再保留为主路径文件。
  const legacyRunnerPath = join(
    process.cwd(),
    "services",
    "center",
    "src",
    "langgraph-runner.ts",
  );
  // sessionDomainPath: 会话发送主路径，必须调用 Deep Agents 原生 agent 入口。
  const sessionDomainPath = join(
    process.cwd(),
    "services",
    "center",
    "src",
    "domain",
    "session-domain.ts",
  );
  assert(!existsSync(deepagentsRunnerPath), "deepagents-runner.ts 已废弃，必须删除");
  assert(!existsSync(legacyRunnerPath), "旧 langgraph-runner.ts 已无真实调用方，必须删除");
  const sessionDomainSource = readFileSync(
    sessionDomainPath,
    "utf-8",
  );
  assert(sessionDomainSource.includes("runDeepAgentsAgentTurn"), "session-domain 未切换到 Deep Agents 原生 agent");
  assert(!sessionDomainSource.includes("runDeepAgentsTurn"), "session-domain 仍引用旧 Deep Agents 执行图入口");
  assert(!sessionDomainSource.includes("runLangGraphTurn"), "session-domain 仍引用旧 LangGraph runner");
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
    "function writeSse(response, chunks) {",
    "  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });",
    "  for (const chunk of chunks) {",
    "    response.write(`data: ${JSON.stringify(chunk)}\\n\\n`);",
    "  }",
    "  response.write('data: [DONE]\\n\\n');",
    "  response.end();",
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
    "    const toolMessages = messages.filter((message) => message && typeof message === 'object' && message.role === 'tool');",
    "    if (toolMessages.length < 2) {",
    "      response.writeHead(400, { 'content-type': 'application/json' });",
    "      response.end(JSON.stringify({ error: { message: 'Expected two tool results for Node.js and Python version checks.' } }));",
    "      return;",
    "    }",
    "    writeSse(response, [{ id: 'fake-tool-loop-final', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fake-tool-model', choices: [{ index: 0, delta: { role: 'assistant', content: '已根据 Node.js 和 Python 工具结果完成最终回复。' }, finish_reason: null }] }, { id: 'fake-tool-loop-final', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fake-tool-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]);",
    "    return;",
    "  }",
    "  const tools = Array.isArray(body.tools) ? body.tools : [];",
    "  const commandTool = tools.find((tool) => tool && typeof tool === 'object' && tool.function && tool.function.name === 'builtin_command_run') || {};",
    "  const commandFunction = commandTool.function && typeof commandTool.function === 'object' ? commandTool.function : {};",
    "  const toolName = typeof commandFunction.name === 'string' ? commandFunction.name : '';",
    "  writeSse(response, [{ id: 'fake-tool-loop-tools', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fake-tool-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'tool-call-node-version', type: 'function', function: { name: toolName, arguments: JSON.stringify({ executablePath: process.execPath, args: ['-v'], inputSummary: '由模型请求读取 Node.js 版本。' }) } }, { index: 1, id: 'tool-call-python-version', type: 'function', function: { name: toolName, arguments: JSON.stringify({ executablePath: process.execPath, args: ['-v'], inputSummary: '由模型请求读取 Python 版本。' }) } }] }, finish_reason: null }] }, { id: 'fake-tool-loop-tools', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fake-tool-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }]);",
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
 * writeEnabledProvider：通过中心服务 API 写入启用的 OpenAI 兼容供应商配置。
 *
 * @param service 中心服务实例。
 * @param baseUrl 假模型服务地址。
 * @returns 没有返回值。
 */
async function writeEnabledProvider(service: CenterService, baseUrl: string): Promise<void> {
  const response = await service.app.inject({
    method: "POST",
    url: "/api/model-provider/create",
    payload: {
      providerName: "工具闭环假模型",
      providerSource: "openai-compatible-custom",
      apiBaseUrl: `${baseUrl}/v1`,
      apiKey: "fake-tool-loop-key",
      enabled: true,
      defaultModelName: "fake-tool-model",
      capabilities: {
        supportsVision: false,
        supportsToolCalling: true,
        supportsJsonOutput: true,
        supportsReasoningEffort: false,
        providesCacheUsage: false,
        supportsModelList: false,
        supportsStreaming: true,
      },
    },
  });
  const result = response.json<ApiResponse<unknown>>();
  assert(result.success, `模型工具闭环供应商创建失败：${JSON.stringify(result.error)}`);
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
  const events = await waitForTurnEvents(
    service,
    sessionId,
    sent.data?.turnId ?? "",
  );

  return {
    taskId: sent.data?.taskId ?? "",
    turnId: sent.data?.turnId ?? "",
    events,
  };
}

/**
 * waitForTurnEvents：轮询等待异步对话执行写入足够事件。
 *
 * @param service 中心服务实例。
 * @param sessionId 会话 ID。
 * @param turnId 轮次 ID。
 * @returns 当前轮次事件列表。
 */
async function waitForTurnEvents(
  service: CenterService,
  sessionId: string,
  turnId: string,
): Promise<Array<{
  eventType: string;
  payload: unknown;
  summary: string;
}>> {
  const startedAt = Date.now();
  let latestEvents: Array<{
    eventType: string;
    payload: unknown;
    summary: string;
  }> = [];

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
      events: Array<{
        eventType: string;
        payload: unknown;
        summary: string;
      }>;
    }>>();
    assert(eventList.success, `事件读取失败：${JSON.stringify(eventList.error)}`);
    latestEvents = eventList.data?.events ?? [];
    const eventTypes = latestEvents.map((event) => {
      return event.eventType;
    });
    if (eventTypes.includes("turn.updated")) {
      return latestEvents;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
  }

  return latestEvents;
}


/**
 * removeDirectoryWithRetry：Windows 日志文件句柄释放可能略晚，删除临时目录时做短重试。
 *
 * @param directoryPath 要删除的临时目录路径。
 * @returns 删除完成后没有返回值。
 */
async function removeDirectoryWithRetry(directoryPath: string): Promise<void> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      });
      return;
    } catch (error) {
      if (attempt === 20) {
        throw error;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
    }
  }
}
/**
 * main：执行工具调用闭环检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  assertDeepAgentsRunnerWiring();

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
    await writeEnabledProvider(service, fakeModelServer.baseUrl);

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
    assert(
      toolRequests.length >= 2,
      `模型工具调用没有形成二次模型请求，请求摘要：${JSON.stringify({
        requestCount: toolRequests.length,
        firstRequestToolNames: Array.isArray(toolRequests[0]?.tools)
          ? (toolRequests[0]?.tools as Array<{
            function?: {
              name?: unknown;
            };
          }>).map((tool) => {
            return tool.function?.name;
          })
          : [],
        firstRequestToolChoice: toolRequests[0]?.tool_choice,
        firstRequestStream: toolRequests[0]?.stream,
        firstRequestModel: toolRequests[0]?.model,
      })}`,
    );
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
      const toolCalls = typeof message === "object"
        && message !== null
        && Array.isArray((message as {tool_calls?: unknown}).tool_calls)
        ? (message as {tool_calls: unknown[]}).tool_calls
        : [];
      return toolCalls.some((toolCall) => {
        return typeof toolCall === "object"
          && toolCall !== null
          && (toolCall as {id?: unknown}).id === "tool-call-python-version";
      });
    }), "二次模型请求没有携带 Python assistant tool_calls 调用记录");
    assert(secondMessages.some((message) => {
      return typeof message === "object"
        && message !== null
        && (message as {role?: unknown}).role === "tool"
        && (message as {tool_call_id?: unknown}).tool_call_id === "tool-call-node-version";
    }), "二次模型请求没有携带带 tool_call_id 的工具结果消息");
    assert(secondMessages.some((message) => {
      return typeof message === "object"
        && message !== null
        && (message as {role?: unknown}).role === "tool"
        && (message as {tool_call_id?: unknown}).tool_call_id === "tool-call-python-version";
    }), "二次模型请求没有携带 Python 工具结果消息");

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
    await removeDirectoryWithRetry(tempRoot).catch((error) => {
      // warning: Windows 上 pino 日志文件句柄释放可能滞后；临时目录清理失败不代表工具闭环失败。
      console.warn(`临时目录清理失败，已跳过：${String(error)}`);
    });
  }
}

void main().catch((error) => {
  // catch: 输出原始错误，便于定位工具调用闭环问题。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态。
  process.exitCode = 1;
});
