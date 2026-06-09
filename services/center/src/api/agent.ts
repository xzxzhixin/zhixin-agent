import {createHash, randomUUID} from "node:crypto";
import type {FastifyInstance} from "fastify";
import {
    APP_NAME,
    type ClientType,
    type ConversationSession,
    type ProjectRecord,
} from "@zhixin/shared";
import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {
    buildSessionCookie,
    createErrorResponse,
    createSuccessResponse,
    isRequestFromLocalHost,
    readAccessConfig,
} from "../helpers.js";
import {broadcastEvents} from "../realtime.js";
import {registerSessionMessageRoute} from "./session-message-route.js";
import {registerAgentEditRoutes} from "./agent-edit-routes.js";
import {registerCenterSyncRoute} from "./sync-route.js";
import {registerProviderRoutes} from "./provider-routes.js";
import {createDataAccess} from "../data-access/index.js";
import {
    CORE_SQLITE_TABLES,
    type AccessAuthorizeResponse,
    type BootstrapStateResponse,
    type CenterServiceConfig,
    type HealthResponse,
    type MemoryQueueState,
    type RealtimeClientConnection,
    type SessionDetailResponse,
    type SubAgentRuntimeRecord,
} from "../types.js";
import {
    createTaskStep,
    deleteProject,
    deleteSession,
    findProject,
    findSession,
    findTask,
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
} from "../domain/session-domain.js";
import {
    createAgent,
    deleteAgent,
    disableAgent,
    ensureMainAgent,
    listAgents,
    readMemoryQueueState,
    updateAgent,
    writeAgentMemory,
} from "../domain/agent-domain.js";
import {
    configurePlugin,
    deletePlugin,
    installPlugin,
    isRecord,
    listInstalledSkills,
    listMcpConfigs,
    listPlugins,
    recordExtensionCall,
    saveExtensionJson,
    saveSkillContent,
    setPluginEnabled,
} from "../domain/extension-domain.js";
import {
    listUnifiedToolCapabilities,
    listMcpToolViewsForServerConfig,
} from "../tools/index.js";
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
} from "../domain/workflow-domain.js";
import {countComposerContextTokens} from "../domain/tokenizer-domain.js";
import {
    commitAttachment,
    createTemporaryAttachment,
    saveNotificationConfig,
} from "../domain/usage-domain.js";
import {registerUsageRoutes} from "./usage-routes.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerAgentRoutes：注册 agent 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerAgentRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
        database,
        events,
        realtimeClients,
        subAgents,
    } = context;

    registerAgentEditRoutes({
            app,
            database,
            events,
        });

    app.post("/api/agent/bootstrap-main", async () => {
            const agent = ensureMainAgent(database, events, config.centerDirectory);
            return createSuccessResponse(agent);
        });

    app.post("/api/agent/create", async (request) => {
            const body = request.body as {name?: string; roleDescription?: string; capabilityBoundary?: string; defaultProviderId?: string | null; defaultModel?: string | null; reasoningEffort?: string | null; createdBy?: string};
    
            if (!body.name || !body.roleDescription) {
                return createErrorResponse(
                    "AGENT_CREATE_INVALID",
                    "智能体创建缺少 name 或 roleDescription",
                    "智能体信息不完整。",
                );
            }
    
            return createSuccessResponse(createAgent(database, events, config.centerDirectory, body));
        });

    app.post("/api/agent/update", async (request) => {
            const body = request.body as {agentId?: string; name?: string; roleDescription?: string; capabilityBoundary?: string; defaultProviderId?: string | null; defaultModel?: string | null; reasoningEffort?: string | null};
    
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
    
            if (body.agentId === "main") {
                return createErrorResponse(
                    "MAIN_AGENT_DISABLE_FORBIDDEN",
                    "主智能体不可停用",
                    "主智能体“致心”是系统内置入口，只允许修改角色说明和默认模型。",
                );
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

    app.post("/api/sub-agent/create", async (request) => {
            const body = request.body as {
                parentAgentId?: string;
                taskId?: string;
                name?: string;
                parentProviderId?: string;
                parentModelId?: string;
                parentReasoningEffort?: string | null;
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
    
            return createSuccessResponse(createSubAgentRuntime(
                events,
                subAgents,
                body.parentAgentId,
                body.taskId,
                // API 管理入口没有模型调用上下文时使用显式占位；真实模型工具调用会传父级实际配置。
                body.parentProviderId ?? "main-agent-provider",
                body.parentModelId ?? "main-agent-model",
                body.parentReasoningEffort ?? null,
                body.name,
            ));
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
}
