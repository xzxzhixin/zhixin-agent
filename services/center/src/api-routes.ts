import {createHash, randomUUID} from "node:crypto";
import type {FastifyInstance} from "fastify";

import {
    APP_NAME,
    type ClientType,
    type ConversationSession,
    type ProjectRecord,
} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import {
    buildSessionCookie,
    createErrorResponse,
    createSuccessResponse,
    isRequestFromLocalHost,
    readAccessConfig,
} from "./helpers.js";
import {broadcastEvents} from "./realtime.js";
import {registerCenterSyncRoute} from "./sync-route.js";
import {
    CORE_SQLITE_TABLES,
    type AccessAuthorizeResponse,
    type BootstrapStateResponse,
    type CenterServiceConfig,
    type HealthResponse,
    type MemoryQueueState,
    type RealtimeClientConnection,
    type SendMessageResponse,
    type SessionDetailResponse,
    type SubAgentRuntimeRecord,
} from "./types.js";
import {
    completeCreatedTurn,
    createMessageTurnAndTask,
    createTaskStep,
    deleteSession,
    findProject,
    findSession,
    listEvents,
    listMessages,
    listPendingMessages,
    listProjects,
    listSessions,
    listTasks,
    listTaskSteps,
    listTurns,
    savePendingMessage,
    updateTaskStep,
    updateTurnStatus,
    upsertSyncClient,
} from "./session-domain.js";
import {
    createAgent,
    deleteAgent,
    disableAgent,
    ensureMainAgent,
    listAgents,
    readMemoryQueueState,
    updateAgent,
    writeAgentMemory,
} from "./agent-domain.js";
import {
    classifyModelGatewayError,
    createProvider,
    deleteProxyConfig,
    deleteRuntimeConfig,
    listProviderConfigs,
    listProxyConfigs,
    listRegisteredModelProtocolPlugins,
    listRuntimeConfigs,
    prepareModelGatewayRequest,
    readGlobalDefaultProxyId,
    readProviderModelList,
    refreshProviderModels,
    saveProxyConfig,
    saveRuntimeConfig,
    setGlobalDefaultProxy,
    updateProviderConfig,
} from "./provider-domain.js";
import {
    configurePlugin,
    deletePlugin,
    installPlugin,
    listInstalledSkills,
    listMcpConfigs,
    listPlugins,
    recordExtensionCall,
    saveExtensionJson,
    saveSkillContent,
    setPluginEnabled,
} from "./extension-domain.js";
import {
    buildWorkerContext,
    cancelWorkerTask,
    createCalendarEvent,
    createKnowledgeItem,
    createNotification,
    createSubAgentRuntime,
    createTodo,
    evaluateApprovalPolicy,
    handleWorkerMessage,
    markWorkerTaskFailed,
    queryAuditEvents,
    recordAgentCollaborationEvent,
    recordUsage,
    runTurnEngine,
    saveExecutionMode,
    setAgentRuntimeState,
    startWorkerTask,
} from "./workflow-domain.js";
import {
    aggregateUsageRecords,
    commitAttachment,
    createTemporaryAttachment,
    queryUsageRecords,
    refreshUsageDailyStats,
    saveNotificationConfig,
} from "./usage-domain.js";

export interface CenterApiRouteContext {
    /** config: 中心服务启动配置，API 路由读取端口、目录和前端资源边界。 */ config: CenterServiceConfig;
    /** app: Fastify 实例，路由注册唯一入口。 */ app: FastifyInstance;
    /** database: 中心服务数据库事实源。 */ database: CenterDatabase;
    /** events: 中心服务事件事实源。 */ events: CenterEventStore;
    /** realtimeClients: WebSocket 在线客户端表，只保存运行期连接。 */ realtimeClients: Map<string, RealtimeClientConnection>;
    /** memoryQueues: 智能体记忆写入队列，按 agentId 隔离串行写入。 */ memoryQueues: Map<string, MemoryQueueState>;
    /** subAgents: 当前进程的一次性子智能体运行记录。 */ subAgents: Map<string, SubAgentRuntimeRecord>;
    /** isInitialized: 读取启动初始化状态，避免路由模块持有可变布尔副本。 */ isInitialized: () => boolean;
}

/**
 * registerCenterApiRoutes：注册中心服务所有 REST 与 WebSocket API。
 *
 * @param context 中心服务路由注册上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerCenterApiRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
        database,
        events,
        realtimeClients,
        memoryQueues,
        subAgents,
        isInitialized,
    } = context;


    app.get("/api/health", async () => createSuccessResponse<HealthResponse>({
        appName: APP_NAME,
        version: "0.1.0",
        port: config.port,
        centerDirectory: config.centerDirectory,
        now: new Date().toISOString(),
    }));

    app.get("/api/bootstrap/state", async () => createSuccessResponse<BootstrapStateResponse>({
        ready: isInitialized(),
        centerDirectory: config.centerDirectory,
        coreTables: [...CORE_SQLITE_TABLES],
        appliedMigrations: database.listAppliedMigrations(),
    }));

    app.post("/api/access/authorize-local", async (request) => {
        // body: 本机授权只接受明确客户端类型，服务端再结合来源地址判断。
        const body = request.body as {
            clientType?: ClientType;
        };
        // isLocalRequest: 不能依赖前端 hostname，必须由服务端从连接来源判断。
        const isLocalRequest = isRequestFromLocalHost(request.ip);

        if (!isLocalRequest) {
            return createErrorResponse(
                "LOCAL_ACCESS_REQUIRED",
                "本机授权请求来源不是本机地址",
                "只有本机访问可以直接授权。",
            );
        }

        if (body.clientType === "ide-plugin" && !isLocalRequest) {
            return createErrorResponse(
                "IDE_PLUGIN_LOCAL_ONLY",
                "IDE 插件只能连接本机中心服务",
                "IDE 插件只允许连接 127.0.0.1。",
            );
        }

        if (!body.clientType) {
            return createErrorResponse(
                "CLIENT_TYPE_REQUIRED",
                "本机授权缺少 clientType",
                "客户端类型不能为空。",
            );
        }

        const clientId = upsertSyncClient(database, {
            clientType: body.clientType,
            projectId: null,
        });

        return createSuccessResponse<AccessAuthorizeResponse>({
            clientId,
            clientType: body.clientType,
            accessKind: "local",
            isLocalRequest,
        });
    });

    app.post("/api/auth/login", async (request, reply) => {
        // body: 远程 Web 登录账号和密码来自用户输入，中心服务只校验摘要。
        const body = request.body as {
            account?: string;
            password?: string;
        };
        // accessConfig: 桌面壳负责写入账号和密码摘要，中心服务负责校验。
        const accessConfig = await readAccessConfig(config.centerDirectory);

        if (!accessConfig.webAccountConfigured) {
            return createErrorResponse(
                "WEB_ACCOUNT_NOT_CONFIGURED",
                "远程 Web 账号尚未配置",
                "请先在桌面端配置远程访问账号和密码。",
            );
        }

        const passwordSha256 = createHash("sha256")
            .update(body.password ?? "")
            .digest("hex");

        if (body.account !== accessConfig.account || passwordSha256 !== accessConfig.passwordSha256) {
            return createErrorResponse(
                "WEB_LOGIN_FAILED",
                "远程 Web 登录账号或密码错误",
                "账号或密码不正确。",
            );
        }

        const clientId = upsertSyncClient(database, {
            clientType: "web-remote",
            projectId: null,
        });
        const sessionToken = randomUUID();

        await reply.header(
            "set-cookie",
            buildSessionCookie(sessionToken, isRequestFromLocalHost(request.ip)),
        );

        return createSuccessResponse<AccessAuthorizeResponse>({
            clientId,
            clientType: "web-remote",
            accessKind: "remote-web",
            isLocalRequest: isRequestFromLocalHost(request.ip),
        });
    });

    app.post("/api/project/register", async (request) => {
        const body = request.body as {
            projectId?: string;
            displayName?: string;
            latestPath?: string;
        };
        // latestPath: 项目登记仍要求客户端传入当前项目路径，中心服务用它记录最近位置并在缺少名称时派生文件夹名。
        const latestPath = body.latestPath?.trim() ?? "";
        // displayName: 项目主名称必须来自显式项目名或 latestPath 最后一级目录，不能使用项目 ID 兜底。
        const displayName = body.displayName && body.displayName.trim().length > 0
            ? body.displayName.trim()
            : deriveProjectDisplayNameFromPath(latestPath);

        if (!body.projectId || !latestPath || !displayName) {
            return createErrorResponse(
                "PROJECT_REGISTER_INVALID",
                "项目登记缺少 projectId、latestPath，或无法从 displayName/latestPath 得出项目名称",
                "项目登记信息不完整。",
            );
        }

        const now = new Date().toISOString();
        database.connection()
            .prepare(`
                INSERT INTO projects (id,
                                      display_name,
                                      alias,
                                      latest_path,
                                      created_at,
                                      updated_at)
                VALUES (?, ?, NULL, ?, ?, ?) ON CONFLICT(id) DO
                UPDATE SET
                    display_name = excluded.display_name,
                    latest_path = excluded.latest_path,
                    updated_at = excluded.updated_at
            `)
            .run(
                body.projectId,
                displayName,
                latestPath,
                now,
                now,
            );

        return createSuccessResponse<ProjectRecord>({
            projectId: body.projectId,
            displayName,
            alias: null,
            latestPath,
            createdAt: now,
            updatedAt: now,
        });
    });

    app.post("/api/project/detail", async (request) => {
        const body = request.body as {
            projectId?: string;
        };
        const project = findProject(database, body.projectId ?? "");

        if (!project) {
            return createErrorResponse(
                "PROJECT_NOT_FOUND",
                "项目不存在",
                "没有找到指定项目。",
            );
        }

        return createSuccessResponse(project);
    });

    app.post("/api/project/list", async () => {
        return createSuccessResponse({
            projects: listProjects(database),
        });
    });

    app.post("/api/session/create", async (request) => {
        const body = request.body as {
            sessionType?: SessionType;
            projectId?: string | null;
            title?: string;
        };

        if (!body.sessionType || !body.title) {
            return createErrorResponse(
                "SESSION_CREATE_INVALID",
                "会话创建缺少 sessionType 或 title",
                "会话创建信息不完整。",
            );
        }

        if (body.sessionType === "project" && !body.projectId) {
            return createErrorResponse(
                "PROJECT_SESSION_REQUIRES_PROJECT",
                "项目会话缺少 projectId",
                "项目会话必须绑定项目。",
            );
        }

        const sessionId = randomUUID();
        const now = new Date().toISOString();
        database.connection()
            .prepare(`
                INSERT INTO sessions (id,
                                      session_type,
                                      project_id,
                                      title,
                                      created_at,
                                      updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `)
            .run(
                sessionId,
                body.sessionType,
                body.projectId ?? null,
                body.title,
                now,
                now,
            );

        return createSuccessResponse<ConversationSession>({
            sessionId,
            sessionType: body.sessionType,
            projectId: body.projectId ?? null,
            title: body.title,
            createdAt: now,
            updatedAt: now,
            lastUserMessagePreview: null,
        });
    });

    app.post("/api/session/list", async (request) => {
        const body = request.body as {
            sessionType?: SessionType;
            projectId?: string | null;
        };
        const sessions = listSessions(database, body);

        return createSuccessResponse({
            sessions,
        });
    });

    app.post("/api/session/detail", async (request) => {
        const body = request.body as {
            sessionId?: string;
        };
        const session = findSession(database, body.sessionId ?? "");

        if (!session) {
            return createErrorResponse(
                "SESSION_NOT_FOUND",
                "会话不存在",
                "没有找到指定会话。",
            );
        }

        return createSuccessResponse<SessionDetailResponse>({
            session,
            messages: listMessages(database, session.sessionId),
            turns: listTurns(database, session.sessionId),
            tasks: listTasks(database, session.sessionId),
            taskSteps: listTaskSteps(database, session.sessionId),
        });
    });

    app.post("/api/session/delete", async (request) => {
        const body = request.body as {
            sessionId?: string;
        };

        if (!body.sessionId) {
            return createErrorResponse(
                "SESSION_DELETE_INVALID",
                "删除会话缺少 sessionId",
                "请选择要删除的会话。",
            );
        }

        const session = findSession(database, body.sessionId);

        if (!session) {
            return createErrorResponse(
                "SESSION_NOT_FOUND",
                "删除会话时会话不存在",
                "没有找到要删除的会话。",
            );
        }

        return createSuccessResponse(deleteSession(
            database,
            events,
            session,
        ));
    });

    app.post("/api/session/message/send", async (request) => {
        const body = request.body as {
            sessionId?: string;
            contentMarkdown?: string;
        };
        const session = findSession(database, body.sessionId ?? "");

        if (!session) {
            return createErrorResponse(
                "SESSION_NOT_FOUND",
                "发送消息时会话不存在",
                "没有找到要发送消息的会话。",
            );
        }

        if (!body.contentMarkdown) {
            return createErrorResponse(
                "MESSAGE_CONTENT_REQUIRED",
                "发送消息缺少 contentMarkdown",
                "消息内容不能为空。",
            );
        }

        const sent = createMessageTurnAndTask(database, events, session, body.contentMarkdown);
        completeCreatedTurn(database, events, sent, body.contentMarkdown);
        const eventRows = listEvents(database, {
            sessionId: session.sessionId,
            turnId: sent.turnId,
            afterSequence: 0,
        });
        broadcastEvents(realtimeClients, session, eventRows);

        return createSuccessResponse<SendMessageResponse>(sent);
    });

    app.post("/api/session/pending-message/save", async (request) => {
        const body = request.body as {
            sessionId?: string;
            clientId?: string | null;
            contentMarkdown?: string;
        };

        if (!body.sessionId || !body.contentMarkdown) {
            return createErrorResponse("PENDING_MESSAGE_INVALID", "待确认消息缺少必要字段", "待确认消息信息不完整。");
        }

        return createSuccessResponse(savePendingMessage(database, body.sessionId, body.clientId ?? null, body.contentMarkdown));
    });

    app.post("/api/session/pending-message/list", async (request) => {
        const body = request.body as {
            sessionId?: string;
        };

        if (!body.sessionId) {
            return createErrorResponse("SESSION_ID_REQUIRED", "查询待确认消息缺少 sessionId", "会话 ID 不能为空。");
        }

        return createSuccessResponse({
            pendingMessages: listPendingMessages(database, body.sessionId),
        });
    });

    app.post("/api/session/event/list", async (request) => {
        const body = request.body as {
            sessionId?: string;
            turnId?: string | null;
            afterSequence?: number;
        };
        const eventRows = listEvents(database, {
            sessionId: body.sessionId ?? null,
            turnId: body.turnId ?? null,
            afterSequence: body.afterSequence ?? 0,
        });

        return createSuccessResponse({
            events: eventRows,
        });
    });

    app.post("/api/task/step/create", async (request) => {
        const body = request.body as {
            taskId?: string;
            title?: string;
        };

        if (!body.taskId || !body.title) {
            return createErrorResponse(
                "TASK_STEP_CREATE_INVALID",
                "任务步骤创建缺少 taskId 或 title",
                "任务步骤创建信息不完整。",
            );
        }

        const task = findTask(database, body.taskId);

        if (!task) {
            return createErrorResponse(
                "TASK_NOT_FOUND",
                "任务步骤创建时任务不存在",
                "没有找到要创建步骤的任务。",
            );
        }

        const step = createTaskStep(database, events, task, body.title);
        return createSuccessResponse(step);
    });

    app.post("/api/task/step/update", async (request) => {
        const body = request.body as {
            stepId?: string;
            status?: TaskRecord["status"];
            summary?: string | null;
        };

        if (!body.stepId || !body.status) {
            return createErrorResponse(
                "TASK_STEP_UPDATE_INVALID",
                "任务步骤更新缺少 stepId 或 status",
                "任务步骤更新信息不完整。",
            );
        }

        const step = updateTaskStep(database, events, body.stepId, body.status, body.summary ?? null);

        if (!step) {
            return createErrorResponse(
                "TASK_STEP_NOT_FOUND",
                "任务步骤不存在",
                "没有找到要更新的任务步骤。",
            );
        }

        return createSuccessResponse(step);
    });

    app.post("/api/turn/update-status", async (request) => {
        const body = request.body as {
            turnId?: string;
            status?: "waiting_user" | "completed" | "failed" | "cancelled";
        };

        if (!body.turnId || !body.status) {
            return createErrorResponse(
                "TURN_UPDATE_INVALID",
                "轮次状态更新缺少 turnId 或 status",
                "轮次状态更新信息不完整。",
            );
        }

        const turn = updateTurnStatus(database, events, body.turnId, body.status);

        if (!turn) {
            return createErrorResponse(
                "TURN_NOT_FOUND",
                "轮次不存在",
                "没有找到要更新的轮次。",
            );
        }

        return createSuccessResponse(turn);
    });

    app.post("/api/agent/bootstrap-main", async () => {
        const agent = ensureMainAgent(database, events, config.centerDirectory);
        return createSuccessResponse(agent);
    });

    app.post("/api/agent/create", async (request) => {
        const body = request.body as {
            name?: string;
            roleDescription?: string;
            capabilityBoundary?: string;
            defaultProviderId?: string | null;
            defaultModel?: string | null;
            reasoningEffort?: string | null;
            createdBy?: string;
        };

        if (!body.name || !body.roleDescription || !body.capabilityBoundary) {
            return createErrorResponse(
                "AGENT_CREATE_INVALID",
                "智能体创建缺少 name、roleDescription 或 capabilityBoundary",
                "智能体信息不完整。",
            );
        }

        return createSuccessResponse(createAgent(database, events, config.centerDirectory, body));
    });

    app.post("/api/agent/update", async (request) => {
        const body = request.body as {
            agentId?: string;
            name?: string;
            roleDescription?: string;
            capabilityBoundary?: string;
            defaultProviderId?: string | null;
            defaultModel?: string | null;
            reasoningEffort?: string | null;
        };

        if (!body.agentId) {
            return createErrorResponse("AGENT_ID_REQUIRED", "智能体更新缺少 agentId", "智能体 ID 不能为空。");
        }

        return createSuccessResponse(updateAgent(database, events, config.centerDirectory, body));
    });

    app.post("/api/agent/disable", async (request) => {
        const body = request.body as {
            agentId?: string;
            archiveMemory?: boolean;
            impactAccepted?: boolean;
        };

        if (!body.agentId || body.impactAccepted !== true) {
            return createErrorResponse("AGENT_DISABLE_REQUIRES_CONFIRM", "停用智能体需要确认影响", "停用长期智能体前必须确认记忆、调度入口和历史会话影响。");
        }

        return createSuccessResponse(disableAgent(database, events, config.centerDirectory, body.agentId, Boolean(body.archiveMemory)));
    });

    app.post("/api/agent/delete", async (request) => {
        const body = request.body as {
            agentId?: string;
            archiveMemory?: boolean;
            impactAccepted?: boolean;
        };

        if (!body.agentId || body.impactAccepted !== true) {
            return createErrorResponse("AGENT_DELETE_REQUIRES_CONFIRM", "删除智能体需要确认影响", "删除长期智能体前必须确认记忆、调度入口和历史会话影响。");
        }

        if (body.agentId === "main") {
            return createErrorResponse("MAIN_AGENT_DELETE_FORBIDDEN", "主智能体不可删除", "主智能体“致心”是系统内置智能体，不可删除。");
        }

        const result = deleteAgent(database, events, config.centerDirectory, body.agentId, Boolean(body.archiveMemory));
        if (!result.deleted) {
            return createErrorResponse("AGENT_NOT_FOUND", "删除智能体时智能体不存在", "没有找到要删除的长期智能体。");
        }

        return createSuccessResponse(result);
    });

    app.post("/api/agent/list", async () => {
        // mainAgent: 智能体管理页必须总能看到系统内置主智能体；列表接口先恢复定义，再读取索引。
        ensureMainAgent(
            database,
            events,
            config.centerDirectory,
        );
        return createSuccessResponse({
            agents: listAgents(database),
        });
    });

    app.post("/api/agent/runtime-state/set", async (request) => {
        const body = request.body as {
            agentId?: string;
            status?: AgentRuntimeStatus;
            currentTaskId?: string | null;
        };

        if (!body.agentId || !body.status) {
            return createErrorResponse(
                "AGENT_RUNTIME_STATE_INVALID",
                "智能体运行状态缺少 agentId 或 status",
                "智能体运行状态信息不完整。",
            );
        }

        const runtimeState = setAgentRuntimeState(
            database,
            events,
            realtimeClients,
            body.agentId,
            body.status,
            body.currentTaskId ?? null,
        );

        return createSuccessResponse(runtimeState);
    });

    app.post("/api/memory/write", async (request) => {
        const body = request.body as {
            agentId?: string;
            keywords?: string;
            summary?: string;
            userText?: string;
            assistantText?: string;
        };

        if (!body.agentId || !body.keywords || !body.summary || !body.userText || !body.assistantText) {
            return createErrorResponse(
                "MEMORY_WRITE_INVALID",
                "记忆写入缺少必要字段",
                "记忆写入信息不完整。",
            );
        }

        return createSuccessResponse(writeAgentMemory(database, events, config.centerDirectory, memoryQueues, body));
    });

    app.post("/api/memory/queue-state", async (request) => {
        const body = request.body as {
            agentId?: string;
        };

        if (!body.agentId) {
            return createErrorResponse(
                "MEMORY_QUEUE_AGENT_REQUIRED",
                "查询记忆队列缺少 agentId",
                "智能体 ID 不能为空。",
            );
        }

        return createSuccessResponse(readMemoryQueueState(memoryQueues, body.agentId));
    });

    app.post("/api/sub-agent/create", async (request) => {
        const body = request.body as {
            parentAgentId?: string;
            taskId?: string;
            name?: string;
        };

        if (!body.parentAgentId || !body.taskId || !body.name) {
            return createErrorResponse(
                "SUB_AGENT_CREATE_INVALID",
                "创建子智能体缺少 parentAgentId、taskId 或 name",
                "子智能体信息不完整。",
            );
        }

        const parentIsSubAgent = subAgents.has(body.parentAgentId);
        if (parentIsSubAgent) {
            return createErrorResponse(
                "SUB_AGENT_NESTING_FORBIDDEN",
                "子智能体不能继续创建子智能体",
                "子智能体任务需要继续拆分时，必须回到创建它的长期智能体统一调度。",
            );
        }

        return createSuccessResponse(createSubAgentRuntime(events, subAgents, body.parentAgentId, body.taskId, body.name));
    });

    app.post("/api/agent/collaboration/event", async (request) => {
        const body = request.body as {
            taskId?: string;
            collaborationKind?: "pipeline" | "group-chat";
            title?: string;
            summary?: string;
        };

        if (!body.taskId || !body.collaborationKind || !body.title || !body.summary) {
            return createErrorResponse(
                "AGENT_COLLABORATION_EVENT_INVALID",
                "智能体协作事件缺少必要字段",
                "协作事件信息不完整。",
            );
        }

        return createSuccessResponse(recordAgentCollaborationEvent(events, body.taskId, body.collaborationKind, body.title, body.summary));
    });

    app.post("/api/provider/create", async (request) => {
        const body = request.body as {
            providerName?: string;
            protocolPluginId?: string;
            protocolMode?: string;
            baseUrl?: string;
            apiKey?: string;
            model?: string;
            enabled?: boolean;
            capabilities?: ProviderCapabilityDeclaration;
            proxyPolicy?: ProviderProxyPolicy;
        };

        if (!body.providerName || !body.protocolPluginId || !body.protocolMode || !body.baseUrl || !body.model) {
            return createErrorResponse(
                "PROVIDER_CREATE_INVALID",
                "供应商创建缺少必要字段",
                "供应商信息不完整。",
            );
        }

        return createSuccessResponse(createProvider(database, events, config.centerDirectory, body));
    });

    app.post("/api/provider/list", async () => createSuccessResponse({
        providers: listProviderConfigs(config.centerDirectory),
    }));

    app.post("/api/provider/protocol-plugin/list", async () => createSuccessResponse({
        // plugins: 供应商页协议插件唯一来源；中心服务只返回已注册内置协议，前端不再猜测协议 ID。
        plugins: listRegisteredModelProtocolPlugins(),
    }));

    app.post("/api/provider/update", async (request) => {
        const body = request.body as {
            providerId?: string;
            providerName?: string;
            protocolPluginId?: string;
            protocolMode?: string;
            baseUrl?: string;
            apiKey?: string;
            enabled?: boolean;
            defaultModel?: string;
            capabilities?: ProviderCapabilityDeclaration;
            proxyPolicy?: ProviderProxyPolicy;
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "供应商更新缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(updateProviderConfig(config.centerDirectory, body));
    });

    app.post("/api/provider/delete", async (request) => {
        const body = request.body as {
            providerId?: string;
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "供应商删除缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(updateProviderConfig(config.centerDirectory, {
            providerId: body.providerId,
            enabled: false,
        }));
    });

    app.post("/api/provider/model-refresh", async (request) => {
        const body = request.body as {
            providerId?: string;
            models?: string[];
            reasoningEfforts?: string[];
            contextWindows?: ProviderModelContextWindow[];
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "刷新模型列表缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(refreshProviderModels(
            config.centerDirectory,
            body.providerId,
            body.models ?? [],
            body.reasoningEfforts ?? [],
            body.contextWindows ?? [],
        ));
    });

    app.post("/api/provider/model-list", async (request) => {
        const body = request.body as {
            providerId?: string;
        };

        if (!body.providerId) {
            return createErrorResponse("PROVIDER_ID_REQUIRED", "查询模型列表缺少 providerId", "供应商 ID 不能为空。");
        }

        return createSuccessResponse(readProviderModelList(config.centerDirectory, body.providerId));
    });

    app.post("/api/proxy/save", async (request) => {
        const body = request.body as {
            proxyId?: string;
            proxyName?: string;
            protocol?: string;
            host?: string;
            port?: number;
            username?: string;
            password?: string;
            clearAuth?: boolean;
            enabled?: boolean;
            note?: string;
        };

        if (!body.proxyName || !body.protocol || !body.host || typeof body.port !== "number") {
            return createErrorResponse("PROXY_SAVE_INVALID", "代理配置缺少必要字段", "代理配置不完整。");
        }

        return createSuccessResponse(saveProxyConfig(config.centerDirectory, body));
    });

    app.post("/api/proxy/list", async () => createSuccessResponse({
        proxies: listProxyConfigs(config.centerDirectory),
        defaultProxyId: readGlobalDefaultProxyId(config.centerDirectory),
    }));

    app.post("/api/proxy/default/set", async (request) => {
        const body = request.body as {
            proxyId?: string | null;
        };

        return createSuccessResponse(setGlobalDefaultProxy(config.centerDirectory, body.proxyId ?? null));
    });

    app.post("/api/proxy/delete", async (request) => {
        const body = request.body as {
            proxyId?: string;
        };

        if (!body.proxyId) {
            return createErrorResponse("PROXY_ID_REQUIRED", "代理删除缺少 proxyId", "代理 ID 不能为空。");
        }

        return createSuccessResponse(deleteProxyConfig(config.centerDirectory, body.proxyId));
    });

    app.post("/api/runtime/save", async (request) => {
        const body = request.body as {
            runtimeId?: string;
            runtimeName?: string;
            runtimeType?: string;
            executablePath?: string;
            rootPath?: string;
            version?: string;
            environmentVariables?: Record<string, string>;
            pathEntries?: string[];
            isDefault?: boolean;
            enabled?: boolean;
            note?: string;
        };

        if (!body.runtimeName || !body.runtimeType || !body.executablePath || !body.rootPath) {
            return createErrorResponse("RUNTIME_SAVE_INVALID", "运行环境缺少必要字段", "运行环境信息不完整。");
        }

        return createSuccessResponse(saveRuntimeConfig(config.centerDirectory, body));
    });

    app.post("/api/runtime/list", async () => createSuccessResponse({
        runtimes: listRuntimeConfigs(config.centerDirectory),
    }));

    app.post("/api/runtime/delete", async (request) => {
        const body = request.body as {
            runtimeId?: string;
        };

        if (!body.runtimeId) {
            return createErrorResponse("RUNTIME_ID_REQUIRED", "运行环境删除缺少 runtimeId", "运行环境 ID 不能为空。");
        }

        return createSuccessResponse(deleteRuntimeConfig(config.centerDirectory, body.runtimeId));
    });

    app.post("/api/model-gateway/prepare", async (request) => {
        const body = request.body as {
            request?: unknown;
            protocolMode?: "responses" | "chat-completions" | "messages";
        };

        if (!body.request || !body.protocolMode) {
            return createErrorResponse("MODEL_GATEWAY_INVALID", "模型网关缺少 request 或 protocolMode", "模型请求不完整。");
        }

        return createSuccessResponse(prepareModelGatewayRequest(body.request, body.protocolMode));
    });

    app.post("/api/model-gateway/classify-error", async (request) => {
        const body = request.body as {
            failureStage?: string;
            statusCode?: number;
            message?: string;
        };

        if (!body.failureStage) {
            return createErrorResponse(
                "MODEL_GATEWAY_ERROR_STAGE_REQUIRED",
                "模型网关错误分类缺少 failureStage",
                "模型调用失败阶段不能为空。",
            );
        }

        return createSuccessResponse(classifyModelGatewayError(body.failureStage, body.statusCode ?? null, body.message ?? ""));
    });

    app.post("/api/plugin/install", async (request) => {
        const body = request.body as {
            manifest?: Record<string, unknown>;
        };

        if (!body.manifest) {
            return createErrorResponse(
                "PLUGIN_MANIFEST_REQUIRED",
                "插件安装缺少 manifest",
                "插件清单不能为空。",
            );
        }

        return createSuccessResponse(installPlugin(database, events, body.manifest));
    });

    app.post("/api/plugin/enable", async (request) => {
        const body = request.body as {
            pluginId?: string;
        };

        if (!body.pluginId) {
            return createErrorResponse("PLUGIN_ID_REQUIRED", "插件启用缺少 pluginId", "插件 ID 不能为空。");
        }

        return createSuccessResponse(setPluginEnabled(database, events, body.pluginId, true));
    });

    app.post("/api/plugin/disable", async (request) => {
        const body = request.body as {
            pluginId?: string;
        };

        if (!body.pluginId) {
            return createErrorResponse("PLUGIN_ID_REQUIRED", "插件停用缺少 pluginId", "插件 ID 不能为空。");
        }

        return createSuccessResponse(setPluginEnabled(database, events, body.pluginId, false));
    });

    app.post("/api/plugin/configure", async (request) => {
        const body = request.body as {
            pluginId?: string;
            config?: Record<string, unknown>;
        };

        if (!body.pluginId || !body.config) {
            return createErrorResponse("PLUGIN_CONFIG_INVALID", "插件配置缺少 pluginId 或 config", "插件配置信息不完整。");
        }

        return createSuccessResponse(configurePlugin(database, events, body.pluginId, body.config));
    });

    app.post("/api/plugin/delete", async (request) => {
        const body = request.body as {
            pluginId?: string;
        };

        if (!body.pluginId) {
            return createErrorResponse("PLUGIN_ID_REQUIRED", "插件删除缺少 pluginId", "插件 ID 不能为空。");
        }

        return createSuccessResponse(deletePlugin(database, events, body.pluginId));
    });

    app.post("/api/plugin/list", async () => createSuccessResponse({
        plugins: listPlugins(database),
    }));

    app.post("/api/extension/call-record", async (request) => {
        const body = request.body as {
            extensionId?: string;
            sessionId?: string | null;
            taskId?: string | null;
            status?: string;
            inputSummary?: string;
            outputSummary?: string | null;
        };

        if (!body.extensionId || !body.status || !body.inputSummary) {
            return createErrorResponse("EXTENSION_CALL_INVALID", "扩展调用记录缺少必要字段", "扩展调用记录不完整。");
        }

        return createSuccessResponse(recordExtensionCall(database, events, body));
    });

    app.post("/api/extension/call-list", async () => createSuccessResponse({
        records: database.connection().prepare("SELECT * FROM extension_call_records ORDER BY created_at ASC").all(),
    }));

    app.post("/api/mcp/save", async (request) => {
        const body = request.body as {
            mcpServers?: Record<string, unknown>;
            projectId?: string | null;
        };

        if (!body.mcpServers) {
            return createErrorResponse("MCP_CONFIG_INVALID", "MCP 配置缺少 mcpServers", "MCP 配置不完整。");
        }

        return createSuccessResponse(saveExtensionJson(config.centerDirectory, body.projectId ? `mcp/project-${body.projectId}.json` : "mcp/global.json", {
            mcpServers: body.mcpServers,
        }));
    });

    app.post("/api/mcp/list", async () => createSuccessResponse({
        configs: listMcpConfigs(config.centerDirectory),
    }));

    app.post("/api/skill/install", async (request) => {
        const body = request.body as {
            skillName?: string;
            content?: string;
            projectId?: string | null;
        };

        if (!body.skillName || !body.content) {
            return createErrorResponse("SKILL_INSTALL_INVALID", "skill 安装缺少必要字段", "skill 信息不完整。");
        }

        return createSuccessResponse(saveSkillContent(config.centerDirectory, body.skillName, body.content, body.projectId ?? null));
    });

    app.post("/api/skill/list", async () => createSuccessResponse({
        skills: listInstalledSkills(config.centerDirectory),
    }));

    app.post("/api/capability/resolve", async () => createSuccessResponse({
        priority: [
            "project-local",
            "user-installed",
            "system-builtin",
        ],
    }));

    app.post("/api/model/capability/check-image", async (request) => {
        const body = request.body as {
            supportsImage?: boolean;
        };

        return createSuccessResponse({
            canSendImage: Boolean(body.supportsImage),
        });
    });

    app.post("/api/personal/todo/create", async (request) => {
        const body = request.body as {
            title?: string;
            dueAt?: string | null;
        };

        if (!body.title) {
            return createErrorResponse("TODO_TITLE_REQUIRED", "待办缺少标题", "待办标题不能为空。");
        }

        return createSuccessResponse(createTodo(database, events, body.title, body.dueAt ?? null));
    });

    app.post("/api/personal/calendar/create", async (request) => {
        const body = request.body as {
            title?: string;
            startsAt?: string;
            endsAt?: string;
        };

        if (!body.title || !body.startsAt || !body.endsAt) {
            return createErrorResponse("CALENDAR_CREATE_INVALID", "日程缺少必要字段", "日程信息不完整。");
        }

        return createSuccessResponse(createCalendarEvent(database, events, body.title, body.startsAt, body.endsAt));
    });

    app.post("/api/personal/knowledge/create", async (request) => {
        const body = request.body as {
            title?: string;
            summary?: string;
            sourceRef?: string;
        };

        if (!body.title || !body.summary || !body.sourceRef) {
            return createErrorResponse("KNOWLEDGE_CREATE_INVALID", "知识条目缺少必要字段", "知识条目信息不完整。");
        }

        return createSuccessResponse(createKnowledgeItem(database, events, body.title, body.summary, body.sourceRef));
    });

    app.post("/api/notification/create", async (request) => {
        const body = request.body as {
            targetClientType?: ClientType;
            title?: string;
            summary?: string;
            requiresUserAction?: boolean;
        };

        if (!body.targetClientType || !body.title || !body.summary) {
            return createErrorResponse("NOTIFICATION_CREATE_INVALID", "通知缺少必要字段", "通知信息不完整。");
        }

        return createSuccessResponse(createNotification(database, events, realtimeClients, body.targetClientType, body.title, body.summary, Boolean(body.requiresUserAction)));
    });

    app.post("/api/execution-mode/set", async (request) => {
        const body = request.body as {
            clientType?: ClientType;
            executionMode?: ExecutionMode;
        };

        if (!body.clientType || !body.executionMode) {
            return createErrorResponse("EXECUTION_MODE_INVALID", "执行模式缺少必要字段", "执行模式信息不完整。");
        }

        return createSuccessResponse(saveExecutionMode(config.centerDirectory, body.clientType, body.executionMode));
    });

    app.post("/api/usage/record", async (request) => {
        const body = request.body as {
            providerId?: string;
            sessionId?: string | null;
            model?: string;
            projectId?: string | null;
            inputTokens?: number | null;
            outputTokens?: number | null;
            cacheHitTokens?: number | null;
            cacheMissTokens?: number | null;
            status?: string;
        };

        if (!body.providerId || !body.model || !body.status) {
            return createErrorResponse("USAGE_RECORD_INVALID", "用量记录缺少必要字段", "用量记录信息不完整。");
        }

        return createSuccessResponse(recordUsage(database, events, body));
    });

    app.post("/api/worker/task-failed", async (request) => {
        const body = request.body as {
            taskId?: string;
            reason?: string;
        };

        return createSuccessResponse(markWorkerTaskFailed(database, events, body.taskId ?? "", body.reason ?? "Worker 任务失败"));
    });

    app.post("/api/worker/handle", async (request) => {
        const body = request.body as {
            type?: string;
            taskId?: string;
            payload?: unknown;
        };

        if (!body.type) {
            return createErrorResponse("WORKER_MESSAGE_INVALID", "Worker 消息缺少 type", "Worker 消息不完整。");
        }

        return createSuccessResponse(handleWorkerMessage(database, events, body.type, body.taskId ?? null, body.payload ?? null));
    });

    app.post("/api/worker/start", async (request) => {
        const body = request.body as {
            taskId?: string;
        };

        if (!body.taskId) {
            return createErrorResponse("WORKER_TASK_ID_REQUIRED", "启动 Worker 缺少 taskId", "任务 ID 不能为空。");
        }

        return createSuccessResponse(startWorkerTask(database, events, body.taskId));
    });

    app.post("/api/worker/cancel", async (request) => {
        const body = request.body as {
            taskId?: string;
            reason?: string;
        };

        if (!body.taskId) {
            return createErrorResponse("WORKER_TASK_ID_REQUIRED", "取消 Worker 缺少 taskId", "任务 ID 不能为空。");
        }

        return createSuccessResponse(cancelWorkerTask(database, events, body.taskId, body.reason ?? "用户取消 Worker 任务"));
    });

    app.post("/api/worker/context-request", async (request) => {
        const body = request.body as {
            taskId?: string;
        };

        if (!body.taskId) {
            return createErrorResponse("WORKER_TASK_ID_REQUIRED", "上下文请求缺少 taskId", "任务 ID 不能为空。");
        }

        return createSuccessResponse(buildWorkerContext(database, body.taskId));
    });

    app.post("/api/engine/turn-runner/run", async (request) => {
        const body = request.body as {
            sessionId?: string;
            userText?: string;
        };

        if (!body.sessionId || !body.userText) {
            return createErrorResponse(
                "TURN_RUNNER_INVALID",
                "轮次执行编排缺少 sessionId 或 userText",
                "轮次执行信息不完整。",
            );
        }

        return createSuccessResponse(runTurnEngine(database, events, config.centerDirectory, memoryQueues, body.sessionId, body.userText));
    });

    app.post("/api/approval/evaluate", async (request) => {
        const body = request.body as {
            clientType?: ClientType;
            operationKind?: "read" | "write" | "delete" | "command" | "plugin" | "mcp" | "skill";
        };

        if (!body.clientType || !body.operationKind) {
            return createErrorResponse("APPROVAL_EVALUATE_INVALID", "审批判断缺少 clientType 或 operationKind", "审批判断信息不完整。");
        }

        return createSuccessResponse(evaluateApprovalPolicy(config.centerDirectory, body.clientType, body.operationKind));
    });

    app.post("/api/audit/events", async (request) => {
        const body = request.body as {
            eventType?: string | null;
        };

        return createSuccessResponse({
            events: queryAuditEvents(database, body.eventType ?? null),
        });
    });

    app.post("/api/usage/query", async (request) => {
        const body = request.body as {
            providerId?: string | null;
            model?: string | null;
            projectId?: string | null;
            sessionId?: string | null;
            startedAt?: string | null;
            endedAt?: string | null;
        };

        return createSuccessResponse({
            records: queryUsageRecords(database, {
                providerId: body.providerId ?? null,
                model: body.model ?? null,
                projectId: body.projectId ?? null,
                sessionId: body.sessionId ?? null,
                startedAt: body.startedAt ?? null,
                endedAt: body.endedAt ?? null,
            }),
        });
    });

    app.post("/api/usage/aggregate", async (request) => {
        const body = request.body as {
            providerId?: string | null;
            model?: string | null;
            projectId?: string | null;
            sessionId?: string | null;
            startedAt?: string | null;
            endedAt?: string | null;
        };

        return createSuccessResponse({
            stats: aggregateUsageRecords(database, {
                providerId: body.providerId ?? null,
                model: body.model ?? null,
                projectId: body.projectId ?? null,
                sessionId: body.sessionId ?? null,
                startedAt: body.startedAt ?? null,
                endedAt: body.endedAt ?? null,
            }),
            refreshedDailyStats: refreshUsageDailyStats(database),
        });
    });

    app.post("/api/audit/task-steps", async () => createSuccessResponse({
        taskSteps: database.connection().prepare("SELECT * FROM task_steps ORDER BY started_at ASC").all(),
    }));

    app.post("/api/notification/config/set", async (request) => {
        const body = request.body as {
            clientType?: ClientType;
            enabled?: boolean;
            notifyOnFailure?: boolean;
            notifyOnWaitingUser?: boolean;
            systemPermission?: string;
        };

        if (!body.clientType) {
            return createErrorResponse("NOTIFICATION_CONFIG_INVALID", "通知配置缺少 clientType", "通知配置不完整。");
        }

        return createSuccessResponse(saveNotificationConfig(config.centerDirectory, body));
    });

    app.post("/api/notification/should-send", async (request) => {
        const body = request.body as {
            enabled?: boolean;
            status?: string;
        };

        return createSuccessResponse({
            shouldSend: Boolean(body.enabled) && (body.status === "completed" || body.status === "failed" || body.status === "waiting_user"),
        });
    });

    app.post("/api/approval/record", async (request) => {
        const body = request.body as {
            taskId?: string;
            approved?: boolean;
            reason?: string;
        };

        return createSuccessResponse(events.append({
            eventType: "approval.recorded",
            scopeType: "approval",
            scopeId: body.taskId ?? null,
            sessionId: null,
            turnId: null,
            taskId: body.taskId ?? null,
            status: body.approved ? "completed" : "cancelled",
            title: "审批结果",
            summary: body.reason ?? "",
            payload: {
                approved: Boolean(body.approved),
            },
        }));
    });

    app.post("/api/file/temp/create", async (request) => {
        const body = request.body as {
            fileName?: string;
            mimeType?: string;
            sizeBytes?: number;
        };

        if (!body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
            return createErrorResponse("TEMP_FILE_CREATE_INVALID", "临时附件缺少必要字段", "临时附件信息不完整。");
        }

        return createSuccessResponse(createTemporaryAttachment(config.centerDirectory, body.fileName, body.mimeType, body.sizeBytes));
    });

    app.post("/api/session/attachment/commit", async (request) => {
        const body = request.body as {
            sessionId?: string;
            messageId?: string;
            temporaryAttachmentId?: string;
            fileName?: string;
            mimeType?: string;
            sizeBytes?: number;
        };

        if (!body.sessionId || !body.messageId || !body.temporaryAttachmentId || !body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
            return createErrorResponse("ATTACHMENT_COMMIT_INVALID", "正式附件保存缺少必要字段", "附件保存信息不完整。");
        }

        return createSuccessResponse(commitAttachment(database, events, config.centerDirectory, body));
    });

    registerCenterSyncRoute({
        app,
        database,
        realtimeClients,
    });
}
