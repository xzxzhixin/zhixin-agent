/**
 * 阶段 8-14 中心服务领域能力检查。
 *
 * 用途：验证 Worker 管理、模型网关、智能体/记忆、插件/MCP/skill、个人事务、通知、执行模式、用量和审计查询具备中心服务入口。
 * 关键逻辑：通过 REST 接口写入和查询事实源，确认扩展能力不能绕过中心服务。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import {
  platform,
  release,
  tmpdir,
  type,
} from "node:os";
import { join } from "node:path";

import {
  CENTER_DATA_DIR_NAME,
  type ApiResponse,
} from "@zhixin/shared";

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
 * startMemoryFakeModelServer：启动用于记忆闭环的本地假模型服务。
 *
 * @returns 服务地址和关闭函数。
 */
async function startMemoryFakeModelServer(): Promise<{
  baseUrl: string;
  requests: () => Promise<unknown[]>;
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
    "const server = createServer(async (request, response) => {",
    "  if (request.url === '/__requests') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(requests)); return; }",
    "  if (request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return; }",
    "  const rawBody = await readBody(request);",
    "  requests.push(JSON.parse(rawBody));",
    "  response.writeHead(200, { 'content-type': 'application/json' });",
    "  response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '记忆闭环假模型回复。' } }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }));",
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
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests: async () => readFakeModelRequests(port),
    close: () => closeFakeServer(child),
  };
}

/**
 * readFakeModelRequests：读取假模型服务收到的模型请求。
 *
 * @param port 假模型服务端口。
 * @returns 请求体数组。
 */
async function readFakeModelRequests(port: number): Promise<unknown[]> {
  const response = await fetch(`http://127.0.0.1:${port}/__requests`);
  return await response.json() as unknown[];
}

/**
 * readFakeServerPort：读取假模型服务端口。
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
 * closeFakeServer：关闭假模型服务。
 *
 * @param child 假模型服务子进程。
 * @returns 子进程退出后完成。
 */
function closeFakeServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => {
      resolve();
    });
    child.kill();
  });
}

/**
 * writeMemoryFakeProvider：写入正常发送测试使用的启用供应商。
 *
 * @param centerDirectory 中心目录。
 * @param baseUrl 假模型服务地址。
 * @returns 写入完成后没有返回值。
 */
async function writeMemoryFakeProvider(
  service: CenterService,
  baseUrl: string,
): Promise<string> {
  const response = await service.app.inject({
    method: "POST",
    url: "/api/model-provider/create",
    payload: {
      providerName: "记忆闭环假模型",
      providerSource: "openai-compatible-custom",
      apiBaseUrl: `${baseUrl}/v1`,
      apiKey: "memory-fake-key",
      enabled: true,
      defaultModelName: "memory-fake-model",
      capabilities: {
        supportsVision: false,
        supportsToolCalling: false,
        supportsJsonOutput: false,
        supportsReasoningEffort: false,
        providesCacheUsage: false,
        supportsModelList: false,
        supportsStreaming: true,
      },
    },
  });
  const result = response.json<ApiResponse<{
    provider: {
      providerId: string;
    };
  }>>();
  assert(result.success, "数据库模型供应商创建失败");
  return result.data?.provider.providerId ?? "";
}

/**
 * waitForSessionEvent：轮询等待异步会话事件落库。
 *
 * @param service 中心服务实例。
 * @param sessionId 会话 ID。
 * @param turnId 轮次 ID。
 * @param eventType 目标事件类型。
 * @returns 目标事件出现后返回。
 */
async function waitForSessionEvent(
  service: CenterService,
  sessionId: string,
  turnId: string,
  eventType: string,
): Promise<void> {
  let observedEventTypes: string[] = [];
  let observedEventDetails: string[] = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await service.app.inject({
      method: "POST",
      url: "/api/session/event/list",
      payload: {
        sessionId,
        turnId,
        afterSequence: 0,
      },
    });
    const result = response.json<ApiResponse<{
      events: Array<{
        eventType: string;
        summary?: string | null;
        payload?: unknown;
      }>;
    }>>();
    observedEventTypes = result.data?.events.map((event) => event.eventType) ?? [];
    observedEventDetails = result.data?.events.map((event) => {
      return `${event.eventType}:${event.summary ?? ""}:${JSON.stringify(event.payload ?? {})}`;
    }) ?? [];
    if (observedEventTypes.some((observedEventType) => observedEventType === eventType)) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new Error(`等待事件超时：${eventType}；已观察事件：${observedEventTypes.join(", ")}；详情：${observedEventDetails.join(" | ")}`);
}

/**
 * main：执行领域能力检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  // tempRoot: 临时根目录，避免污染真实中心目录。
  const tempRoot = await mkdtemp(join(tmpdir(), "zhixin-center-domains-"));
  // centerDirectory: 临时中心目录。
  const centerDirectory = join(tempRoot, CENTER_DATA_DIR_NAME);
  // service: 保存中心服务实例，失败时也释放数据库。
  let service: CenterService | null = null;
  // fakeModelServer: 正常会话发送检查使用的本地模型服务。
  let fakeModelServer: Awaited<ReturnType<typeof startMemoryFakeModelServer>> | null = null;

  try {
    const config = readCenterServiceConfig({
      cwd: tempRoot,
      env: {
        ZHIXIN_CENTER_DIR: centerDirectory,
      },
    });
    service = await createCenterService(config);
    await service.initialize();
    fakeModelServer = await startMemoryFakeModelServer();
    const memoryProviderId = await writeMemoryFakeProvider(
      service,
      fakeModelServer.baseUrl,
    );

    const bootstrapState = await service.app.inject({
      method: "POST",
      url: "/api/agent/bootstrap-main",
      payload: {},
    });
    assert(bootstrapState.json<ApiResponse<unknown>>().success, "主智能体初始化失败");
    await stat(join(centerDirectory, "agents", "main.md"));

    const agentResponse = await service.app.inject({
      method: "POST",
      url: "/api/agent/create",
      payload: {
        name: "检查智能体",
        roleDescription: "用于领域检查",
      },
    });
    const agent = agentResponse.json<ApiResponse<{
      agentId: string;
    }>>();
    assert(agent.success, "长期智能体创建失败");
    await stat(join(centerDirectory, "agents", `${agent.data?.agentId}.md`));

    const agentDefinition = await readFile(join(centerDirectory, "agents", `${agent.data?.agentId}.md`), "utf-8");
    assert(agentDefinition.includes("roleDescription:"), "智能体定义缺少角色说明 frontmatter");
    assert(agentDefinition.includes("availablePlugins:"), "智能体定义必须保存可用插件范围字段。");
    assert(agentDefinition.includes("availableMcp:"), "智能体定义必须保存可用 MCP 范围字段。");
    assert(agentDefinition.includes("availableSkills:"), "智能体定义必须保存可用 skill 范围字段。");
    assert(agentDefinition.includes("memoryIndex:"), "智能体定义缺少记忆索引 frontmatter");

    const agentUpdateResponse = await service.app.inject({
      method: "POST",
      url: "/api/agent/update",
      payload: {
        agentId: agent.data?.agentId,
        name: "检查智能体已更新",
        defaultProviderId: "provider-check",
        defaultModel: "model-check",
        reasoningEffort: "medium",
      },
    });
    assert(agentUpdateResponse.json<ApiResponse<unknown>>().success, "长期智能体更新失败");

    const mainAgentUpdateResponse = await service.app.inject({
      method: "POST",
      url: "/api/agent/update",
      payload: {
        agentId: "main",
        roleDescription: "主智能体检查角色说明",
        defaultProviderId: memoryProviderId,
        defaultModel: "memory-fake-model",
        reasoningEffort: "high",
      },
    });
    assert(mainAgentUpdateResponse.json<ApiResponse<unknown>>().success, "主智能体应允许编辑角色说明和默认模型。");

    const mainAgentDisableResponse = await service.app.inject({
      method: "POST",
      url: "/api/agent/disable",
      payload: {
        agentId: "main",
        archiveMemory: false,
        impactAccepted: true,
      },
    });
    const mainAgentDisable = mainAgentDisableResponse.json<ApiResponse<unknown>>();
    assert(!mainAgentDisable.success, "主智能体不可停用，中心服务必须返回明确失败。");

    const memoryResponse = await service.app.inject({
      method: "POST",
      url: "/api/memory/write",
      payload: {
        agentId: agent.data?.agentId,
        keywords: "检查",
        summary: "记忆写入检查",
        userText: "用户内容",
        assistantText: "回答内容",
      },
    });
    const memoryResult = memoryResponse.json<ApiResponse<{
      relativePath: string;
    }>>();
    assert(memoryResult.success, "智能体记忆写入失败");

    const memoryIndexRows = service.database.connection()
      .prepare("SELECT agent_id AS agentId, keywords, summary, memory_path AS memoryPath FROM memory_index WHERE agent_id = ?")
      .all(agent.data?.agentId) as Array<{
        agentId: string;
        keywords: string;
        summary: string;
        memoryPath: string;
      }>;
    assert(memoryIndexRows.length === 1, "SQLite 没有保存智能体记忆索引");
    assert(memoryIndexRows[0]?.summary === "记忆写入检查", "记忆索引摘要错误");

    const memoryQueueResponse = await service.app.inject({
      method: "POST",
      url: "/api/memory/queue-state",
      payload: {
        agentId: agent.data?.agentId,
      },
    });
    const memoryQueue = memoryQueueResponse.json<ApiResponse<{
      agentId: string;
      queueMode: string;
      pendingWrites: number;
    }>>();
    assert(memoryQueue.success, "智能体记忆单写队列状态查询失败");
    assert(memoryQueue.data?.queueMode === "single-writer", "智能体记忆没有使用单写队列模式");

    const agentDisableResponse = await service.app.inject({
      method: "POST",
      url: "/api/agent/disable",
      payload: {
        agentId: agent.data?.agentId,
        archiveMemory: true,
        impactAccepted: true,
      },
    });
    assert(agentDisableResponse.json<ApiResponse<unknown>>().success, "长期智能体停用失败");

    const childAgentResponse = await service.app.inject({
      method: "POST",
      url: "/api/sub-agent/create",
      payload: {
        parentAgentId: "main",
        taskId: "task-check",
        name: "检查子智能体",
      },
    });
    const childAgent = childAgentResponse.json<ApiResponse<{
      subAgentId: string;
      persistent: boolean;
    }>>();
    assert(childAgent.success, "一次性子智能体创建失败");
    assert(childAgent.data?.persistent === false, "子智能体不应固化为长期智能体");

    const nestedChildResponse = await service.app.inject({
      method: "POST",
      url: "/api/sub-agent/create",
      payload: {
        parentAgentId: childAgent.data?.subAgentId,
        taskId: "task-check",
        name: "嵌套子智能体",
      },
    });
    const nestedChild = nestedChildResponse.json<ApiResponse<unknown>>();
    assert(!nestedChild.success, "子智能体不允许继续创建子智能体");

    const collaborationResponse = await service.app.inject({
      method: "POST",
      url: "/api/agent/collaboration/event",
      payload: {
        taskId: "task-check",
        collaborationKind: "pipeline",
        title: "检查协作",
        summary: "管线协作事件",
      },
    });
    assert(collaborationResponse.json<ApiResponse<unknown>>().success, "智能体协作事件写入失败");

    const providerResponse = await service.app.inject({
      method: "POST",
      url: "/api/model-provider/create",
      payload: {
        providerName: "检查供应商",
        providerSource: "openai-compatible-custom",
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        defaultModelName: "example-model",
        capabilities: {
          supportsVision: true,
          supportsToolCalling: true,
          supportsJsonOutput: true,
          supportsReasoningEffort: true,
          providesCacheUsage: false,
          supportsModelList: true,
          supportsStreaming: true,
        },
      },
    });
    const provider = providerResponse.json<ApiResponse<{
      provider: {
        providerId: string;
        hasApiKey: boolean;
        capabilities: {
          supportsVision: boolean;
          supportsStreaming: boolean;
        };
        proxyPolicy: {
          mode: string;
          proxyId: string | null;
        };
      };
    }>>();
    assert(provider.success, "供应商创建失败");
    assert(provider.data?.provider.hasApiKey === true, "供应商没有返回 hasApiKey");

    const providerListResponse = await service.app.inject({
      method: "POST",
      url: "/api/model-provider/list",
      payload: {},
    });
    const providerList = providerListResponse.json<ApiResponse<{
      providers: Array<{
        apiKeySha256?: string;
        capabilities: {
          supportsVision: boolean;
          supportsToolCalling: boolean;
          supportsJsonOutput: boolean;
          supportsReasoningEffort: boolean;
          providesCacheUsage: boolean;
          supportsModelList: boolean;
          supportsStreaming: boolean;
        };
        proxyPolicy: {
          mode: string;
          proxyId: string | null;
        };
      }>;
    }>>();
    assert(providerList.success, "供应商列表查询失败");
    assert(providerList.data?.providers[0]?.apiKeySha256 === undefined, "供应商列表泄露了 API Key 摘要字段");
    assert(providerList.data?.providers[0]?.capabilities.supportsVision === true, "供应商能力声明没有保存图片能力");
    assert(providerList.data?.providers[0]?.capabilities.supportsStreaming === true, "供应商能力声明没有保存流式能力");
    assert(providerList.data?.providers[0]?.proxyPolicy.mode === "use-global-default", "供应商代理策略没有保存全局默认策略");

    const providerUpdateResponse = await service.app.inject({
      method: "POST",
      url: "/api/model-provider/update",
      payload: {
        providerId: provider.data?.provider.providerId,
        enabled: false,
        defaultModelName: "updated-model",
        proxyMode: "none",
        proxyId: null,
      },
    });
    assert(providerUpdateResponse.json<ApiResponse<unknown>>().success, "供应商更新失败");

    const pluginResponse = await service.app.inject({
      method: "POST",
      url: "/api/plugin/install",
      payload: {
        manifest: {
          id: "check-plugin",
          name: "检查插件",
          version: "0.1.0",
          source: "user-installed",
          scope: "global",
          permissions: [
            "provider.call",
          ],
        },
      },
    });
    assert(pluginResponse.json<ApiResponse<unknown>>().success, "插件安装失败");
    assert((await service.app.inject({ method: "POST", url: "/api/plugin/disable", payload: { pluginId: "check-plugin" } })).json<ApiResponse<unknown>>().success, "插件停用失败");
    assert((await service.app.inject({ method: "POST", url: "/api/plugin/enable", payload: { pluginId: "check-plugin" } })).json<ApiResponse<unknown>>().success, "插件启用失败");
    assert((await service.app.inject({ method: "POST", url: "/api/plugin/configure", payload: { pluginId: "check-plugin", config: { sample: true } } })).json<ApiResponse<unknown>>().success, "插件配置失败");
    const pluginListResponse = await service.app.inject({ method: "POST", url: "/api/plugin/list", payload: {} });
    const pluginList = pluginListResponse.json<ApiResponse<{ plugins: unknown[] }>>();
    assert(pluginList.data?.plugins.length === 1, "插件列表查询失败");
    assert((await service.app.inject({ method: "POST", url: "/api/plugin/delete", payload: { pluginId: "check-plugin" } })).json<ApiResponse<unknown>>().success, "插件删除失败");

    const todoResponse = await service.app.inject({
      method: "POST",
      url: "/api/personal/todo/create",
      payload: {
        title: "检查待办",
        dueAt: null,
      },
    });
    assert(todoResponse.json<ApiResponse<unknown>>().success, "待办创建失败");

    const calendarResponse = await service.app.inject({
      method: "POST",
      url: "/api/personal/calendar/create",
      payload: {
        title: "检查日程",
        startsAt: "2026-05-30T10:00:00.000Z",
        endsAt: "2026-05-30T11:00:00.000Z",
      },
    });
    assert(calendarResponse.json<ApiResponse<unknown>>().success, "日程创建失败");

    const knowledgeResponse = await service.app.inject({
      method: "POST",
      url: "/api/personal/knowledge/create",
      payload: {
        title: "检查知识",
        summary: "检查摘要",
        sourceRef: "manual",
      },
    });
    assert(knowledgeResponse.json<ApiResponse<unknown>>().success, "知识库条目创建失败");

    const executionModeResponse = await service.app.inject({
      method: "POST",
      url: "/api/execution-mode/set",
      payload: {
        clientType: "web-local",
        executionMode: "suggest",
      },
    });
    assert(executionModeResponse.json<ApiResponse<unknown>>().success, "执行模式保存失败");

    const suggestApprovalResponse = await service.app.inject({
      method: "POST",
      url: "/api/approval/evaluate",
      payload: {
        clientType: "web-local",
        operationKind: "write",
      },
    });
    const suggestApproval = suggestApprovalResponse.json<ApiResponse<{
      requiresApproval: boolean;
    }>>();
    assert(suggestApproval.success, "建议模式审批判断失败");
    assert(suggestApproval.data?.requiresApproval === true, "建议模式下副作用步骤没有要求审批");

    await service.app.inject({
      method: "POST",
      url: "/api/execution-mode/set",
      payload: {
        clientType: "web-local",
        executionMode: "auto_edit",
      },
    });
    const autoEditReadResponse = await service.app.inject({
      method: "POST",
      url: "/api/approval/evaluate",
      payload: {
        clientType: "web-local",
        operationKind: "read",
      },
    });
    const autoEditRead = autoEditReadResponse.json<ApiResponse<{
      requiresApproval: boolean;
    }>>();
    assert(autoEditRead.data?.requiresApproval === false, "自动编辑模式低风险读操作不应审批");
    const autoEditCommandResponse = await service.app.inject({
      method: "POST",
      url: "/api/approval/evaluate",
      payload: {
        clientType: "web-local",
        operationKind: "command",
      },
    });
    const autoEditCommand = autoEditCommandResponse.json<ApiResponse<{
      requiresApproval: boolean;
    }>>();
    assert(autoEditCommand.data?.requiresApproval === true, "自动编辑模式高风险命令没有审批");

    await service.app.inject({
      method: "POST",
      url: "/api/execution-mode/set",
      payload: {
        clientType: "web-local",
        executionMode: "full_auto",
      },
    });
    const fullAutoResponse = await service.app.inject({
      method: "POST",
      url: "/api/approval/evaluate",
      payload: {
        clientType: "web-local",
        operationKind: "command",
      },
    });
    const fullAuto = fullAutoResponse.json<ApiResponse<{
      requiresApproval: boolean;
    }>>();
    assert(fullAuto.data?.requiresApproval === false, "全自动模式没有在权限范围内自动执行");

    const usageResponse = await service.app.inject({
      method: "POST",
      url: "/api/usage/record",
      payload: {
        providerId: provider.data?.provider.providerId,
        model: "example-model",
        projectId: null,
        inputTokens: 1,
        outputTokens: 2,
        cacheHitTokens: null,
        cacheMissTokens: null,
        status: "completed",
      },
    });
    assert(usageResponse.json<ApiResponse<unknown>>().success, "用量记录失败");

    const workerResponse = await service.app.inject({
      method: "POST",
      url: "/api/worker/task-failed",
      payload: {
        taskId: "missing-task",
        reason: "检查 Worker 失败收尾",
      },
    });
    assert(workerResponse.json<ApiResponse<unknown>>().success, "Worker 失败收尾接口失败");

    const workerSessionResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionType: "normal",
        projectId: null,
        title: "Worker 检查会话",
      },
    });
    const workerSession = workerSessionResponse.json<ApiResponse<{
      sessionId: string;
    }>>();
    const workerMessageResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/message/send",
      payload: {
        sessionId: workerSession.data?.sessionId,
        contentMarkdown: "Worker 生命周期检查",
      },
    });
    const workerMessage = workerMessageResponse.json<ApiResponse<{
      sessionId: string;
      messageId: string;
      turnId: string;
      taskId: string;
    }>>();
    assert(workerMessage.success, "Worker 检查会话发送失败");
    await waitForSessionEvent(
      service,
      workerSession.data?.sessionId ?? "",
      workerMessage.data?.turnId ?? "",
      "memory.write",
    );
    const workerStartResponse = await service.app.inject({
      method: "POST",
      url: "/api/worker/start",
      payload: {
        taskId: workerMessage.data?.taskId,
      },
    });
    assert(workerStartResponse.json<ApiResponse<unknown>>().success, "Worker 启动接口失败");
    const workerContextResponse = await service.app.inject({
      method: "POST",
      url: "/api/worker/context-request",
      payload: {
        taskId: workerMessage.data?.taskId,
      },
    });
    const workerContext = workerContextResponse.json<ApiResponse<{
      task: unknown;
      session: unknown;
      agents: unknown[];
      memoryIndex: unknown[];
      permissions: string[];
    }>>();
    assert(workerContext.success, "Worker 上下文请求失败");
    assert(workerContext.data?.agents.length !== 0, "Worker 上下文缺少智能体索引");
    assert(!workerContext.data?.permissions.includes("plugin.call"), "当前阶段 Worker 上下文不能继续暴露插件调用权限");
    assert(workerContext.data?.permissions.includes("mcp.call"), "Worker 上下文缺少 MCP 权限");
    assert(workerContext.data?.permissions.includes("skill.use"), "Worker 上下文缺少 skill 权限");
    const workerCancelResponse = await service.app.inject({
      method: "POST",
      url: "/api/worker/cancel",
      payload: {
        taskId: workerMessage.data?.taskId,
        reason: "检查取消",
      },
    });
    assert(workerCancelResponse.json<ApiResponse<unknown>>().success, "Worker 取消接口失败");

    const mainMemoryRows = service.database.connection()
      .prepare("SELECT agent_id AS agentId, source_session_id AS sourceSessionId, source_turn_id AS sourceTurnId, memory_path AS memoryPath FROM memory_index WHERE agent_id = ? AND source_session_id = ? AND source_turn_id = ?")
      .all("main", workerSession.data?.sessionId, workerMessage.data?.turnId) as Array<{
        agentId: string;
        sourceSessionId: string;
        sourceTurnId: string;
        memoryPath: string;
      }>;
    assert(mainMemoryRows.length === 1, "正常会话完成后没有为主智能体写入绑定本轮的长期记忆。");
    assert(mainMemoryRows[0]?.sourceSessionId === workerSession.data?.sessionId, "主智能体记忆索引没有绑定会话 ID。");
    assert(mainMemoryRows[0]?.sourceTurnId === workerMessage.data?.turnId, "主智能体记忆索引没有绑定轮次 ID。");
    const mainMemoryContent = await readFile(
      join(centerDirectory, mainMemoryRows[0]?.memoryPath ?? ""),
      "utf-8",
    );
    [
      "# ",
      "## 关键词",
      "## 总结",
      "## 使用的电脑",
      "## 用户说的",
      "## 回答的",
      "Worker 生命周期检查",
    ].forEach((fragment) => {
      assert(mainMemoryContent.includes(fragment), `主智能体长期记忆缺少片段：${fragment}`);
    });
    const memoryComputerSection = mainMemoryContent.match(/## 使用的电脑\n\n([^\n]+)/u)?.[1]?.trim() ?? "";
    assert(memoryComputerSection !== "center", "永久记忆的使用电脑不能写入固定 center，必须写入当前操作系统信息。");
    [
      type(),
      platform(),
      release(),
    ].forEach((fragment) => {
      assert(
        memoryComputerSection.includes(fragment),
        `永久记忆的使用电脑缺少当前操作系统信息片段：${fragment}`,
      );
    });
    const workerContextAfterMemoryResponse = await service.app.inject({
      method: "POST",
      url: "/api/worker/context-request",
      payload: {
        taskId: workerMessage.data?.taskId,
      },
    });
    const workerContextAfterMemory = workerContextAfterMemoryResponse.json<ApiResponse<{
      memoryIndex: Array<{
        agentId: string;
        summary: string;
      }>;
    }>>();
    assert(
      workerContextAfterMemory.data?.memoryIndex.some((row) => row.agentId === "main") === true,
      "Worker 上下文没有读取主智能体长期记忆索引。",
    );
    const memoryAwareMessageResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/message/send",
      payload: {
        sessionId: workerSession.data?.sessionId,
        contentMarkdown: "第二轮需要使用上一轮记忆",
        attachments: [],
      },
    });
    const memoryAwareMessage = memoryAwareMessageResponse.json<ApiResponse<{
      sessionId: string;
      messageId: string;
      turnId: string;
      taskId: string;
    }>>();
    assert(memoryAwareMessage.success, "记忆注入检查会话发送失败");
    await waitForSessionEvent(
      service,
      workerSession.data?.sessionId ?? "",
      memoryAwareMessage.data?.turnId ?? "",
      "memory.write",
    );
    const modelRequests = await fakeModelServer?.requests() ?? [];
    const serializedSecondRequest = JSON.stringify(modelRequests.at(-1) ?? {});
    assert(
      serializedSecondRequest.includes("主智能体长期记忆"),
      "第二轮普通模型请求没有注入主智能体长期记忆标题。",
    );
    assert(
      serializedSecondRequest.includes("Worker 生命周期检查"),
      "第二轮普通模型请求没有带入上一轮主智能体记忆内容。",
    );

    const engineSessionResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionType: "normal",
        projectId: null,
        title: "执行引擎检查会话",
      },
    });
    const engineSession = engineSessionResponse.json<ApiResponse<{
      sessionId: string;
    }>>();
    const engineRunResponse = await service.app.inject({
      method: "POST",
      url: "/api/engine/turn-runner/run",
      payload: {
        sessionId: engineSession.data?.sessionId,
        userText: "执行引擎检查",
      },
    });
    const engineRun = engineRunResponse.json<ApiResponse<{
      turnId: string;
      taskId: string;
      agentId: string;
      modelEventType: string;
      toolPlanId: string;
      collaborationEventTypes: string[];
      memoryRelativePath: string;
      usageId: string;
    }>>();
    assert(engineRun.success, "turn-runner 执行编排失败");
    assert(engineRun.data?.agentId === "main", "agent-router 没有选择主智能体");
    assert(engineRun.data?.modelEventType === "model.orchestrated", "model-orchestrator 没有写入模型编排事件");
    assert(engineRun.data?.toolPlanId.startsWith("tool-plan-"), "tool-planner 没有生成工具计划");
    assert(engineRun.data?.collaborationEventTypes.includes("agent.collaboration.pipeline"), "collaboration-engine 没有生成管线协作事件");
    assert(engineRun.data?.collaborationEventTypes.includes("agent.collaboration.group_chat"), "collaboration-engine 没有生成群聊协作事件");
    assert(engineRun.data?.memoryRelativePath.includes("memory/agents/main"), "memory-committer 没有写入主智能体记忆");
    assert(engineRun.data?.usageId.length !== 0, "usage-collector 没有写入用量记录");

    const auditResponse = await service.app.inject({
      method: "POST",
      url: "/api/audit/events",
      payload: {
        eventType: null,
      },
    });
    const audit = auditResponse.json<ApiResponse<{
      events: Array<{
        eventType: string;
      }>;
    }>>();
    assert(audit.success, "审计事件查询失败");
    assert(audit.data?.events.length !== 0, "审计事件为空");

    const usageQueryResponse = await service.app.inject({
      method: "POST",
      url: "/api/usage/query",
      payload: {
        providerId: provider.data?.provider.providerId,
      },
    });
    const usageQuery = usageQueryResponse.json<ApiResponse<{
      records: unknown[];
    }>>();
    assert(usageQuery.success, "用量查询失败");
    assert(usageQuery.data?.records.length === 1, "用量查询数量错误");

    const memoryContent = await readFile(
      join(centerDirectory, memoryResult.data?.relativePath ?? ""),
      "utf-8",
    );
    assert(memoryContent.includes("记忆写入检查"), "记忆 Markdown 未追加检查内容");
  } finally {
    await service?.close().catch(() => {
      // ignore: 检查失败时仍继续清理临时目录。
    });
    await fakeModelServer?.close().catch(() => {
      // ignore: 假模型服务退出失败不影响临时目录清理。
    });
    await rm(tempRoot, {
      force: true,
      recursive: true,
    });
  }
}

void main().catch((error) => {
  // catch: 检查失败时输出原始错误，便于定位领域接口问题。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态。
  process.exitCode = 1;
});
