/**
 * 阶段 8-14 中心服务领域能力检查。
 *
 * 用途：验证 Worker 管理、模型网关、智能体/记忆、插件/MCP/skill、个人事务、通知、执行模式、用量和审计查询具备中心服务入口。
 * 关键逻辑：通过 REST 接口写入和查询事实源，确认扩展能力不能绕过中心服务。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
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

  try {
    const config = readCenterServiceConfig({
      cwd: tempRoot,
      env: {
        ZHIXIN_CENTER_DIR: centerDirectory,
      },
    });
    service = await createCenterService(config);
    await service.initialize();

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
    assert(agentDefinition.includes("capabilityBoundary: 可用能力由当前会话、项目上下文、全局扩展和执行模式动态决定。"), "智能体定义必须使用动态能力兼容说明，前端不再提交能力边界。");
    assert(agentDefinition.includes("memoryIndex:"), "智能体定义缺少记忆索引 frontmatter");
    assert(!agentDefinition.includes("availablePlugins"), "智能体定义不应保存可用插件范围");
    assert(!agentDefinition.includes("availableMcp"), "智能体定义不应保存 MCP 范围");
    assert(!agentDefinition.includes("availableSkills"), "智能体定义不应保存 skill 范围");

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
        defaultModel: "main-check-model",
        reasoningEffort: "high",
      },
    });
    assert(mainAgentUpdateResponse.json<ApiResponse<unknown>>().success, "主智能体应允许编辑角色说明和默认模型。");

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
    assert(memoryResponse.json<ApiResponse<unknown>>().success, "智能体记忆写入失败");

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
      url: "/api/provider/create",
      payload: {
        providerName: "检查供应商",
        protocolPluginId: "builtin-model-openai-compatible",
        protocolMode: "responses",
        baseUrl: "https://api.example.com",
        apiKey: "secret",
        model: "example-model",
        capabilities: {
          supportsVision: true,
          supportsToolCalling: true,
          supportsJsonOutput: true,
          supportsReasoningEffort: true,
          providesCacheUsage: false,
          supportsModelList: true,
          supportsStreaming: true,
        },
        proxyPolicy: {
          mode: "use-global-default",
          proxyId: null,
        },
      },
    });
    const provider = providerResponse.json<ApiResponse<{
      providerId: string;
      hasApiKey: boolean;
    }>>();
    assert(provider.success, "供应商创建失败");
    assert(provider.data?.hasApiKey === true, "供应商没有返回 hasApiKey");

    const providerListResponse = await service.app.inject({
      method: "POST",
      url: "/api/provider/list",
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
      url: "/api/provider/update",
      payload: {
        providerId: provider.data?.providerId,
        enabled: false,
        defaultModel: "updated-model",
        proxyPolicy: {
          mode: "none",
          proxyId: null,
        },
      },
    });
    assert(providerUpdateResponse.json<ApiResponse<unknown>>().success, "供应商更新失败");

    const modelErrorResponse = await service.app.inject({
      method: "POST",
      url: "/api/model-gateway/classify-error",
      payload: {
        failureStage: "proxy-auth",
        statusCode: 407,
        message: "Proxy Authentication Required",
      },
    });
    const modelError = modelErrorResponse.json<ApiResponse<{
      errorKind: string;
      displayMessage: string;
    }>>();
    assert(modelError.success, "模型网关错误分类失败");
    assert(modelError.data?.errorKind === "proxy-auth-failed", "模型网关没有区分代理认证失败");

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
            "plugin.call",
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

    assert((await service.app.inject({
      method: "POST",
      url: "/api/plugin/install",
      payload: {
        manifest: {
          id: "builtin-model-openai-compatible",
          name: "OpenAI 兼容协议",
          version: "0.1.0",
          source: "system-builtin",
          scope: "global",
          permissions: [
            "provider.call",
          ],
        },
      },
    })).json<ApiResponse<unknown>>().success, "系统内置模型协议插件安装失败");
    const builtinDeleteResponse = await service.app.inject({
      method: "POST",
      url: "/api/plugin/delete",
      payload: {
        pluginId: "builtin-model-openai-compatible",
      },
    });
    const builtinDelete = builtinDeleteResponse.json<ApiResponse<{
      deleted: boolean;
    }>>();
    assert(!builtinDelete.data?.deleted, "系统内置模型协议插件不允许卸载");

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

    const notificationResponse = await service.app.inject({
      method: "POST",
      url: "/api/notification/create",
      payload: {
        targetClientType: "web-local",
        title: "检查通知",
        summary: "通知摘要",
        requiresUserAction: false,
      },
    });
    assert(notificationResponse.json<ApiResponse<unknown>>().success, "通知创建失败");

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
        providerId: provider.data?.providerId,
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
      taskId: string;
    }>>();
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
    assert(workerContext.data?.permissions.includes("plugin.call"), "Worker 上下文缺少插件权限");
    const workerCancelResponse = await service.app.inject({
      method: "POST",
      url: "/api/worker/cancel",
      payload: {
        taskId: workerMessage.data?.taskId,
        reason: "检查取消",
      },
    });
    assert(workerCancelResponse.json<ApiResponse<unknown>>().success, "Worker 取消接口失败");

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
        providerId: provider.data?.providerId,
      },
    });
    const usageQuery = usageQueryResponse.json<ApiResponse<{
      records: unknown[];
    }>>();
    assert(usageQuery.success, "用量查询失败");
    assert(usageQuery.data?.records.length === 1, "用量查询数量错误");

    const memoryContent = await readFile(
      join(centerDirectory, "memory", "agents", agent.data?.agentId ?? "", new Date().getUTCFullYear().toString(), String(new Date().getUTCMonth() + 1).padStart(2, "0"), `${String(new Date().getUTCDate()).padStart(2, "0")}.md`),
      "utf-8",
    );
    assert(memoryContent.includes("记忆写入检查"), "记忆 Markdown 未追加检查内容");
  } finally {
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
  // catch: 检查失败时输出原始错误，便于定位领域接口问题。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态。
  process.exitCode = 1;
});
