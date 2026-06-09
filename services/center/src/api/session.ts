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
 * registerSessionRoutes：注册 session 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerSessionRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
        database,
        events,
        realtimeClients,
        memoryQueues,
    } = context;

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
            const session = createDataAccess(database).sessions.createSession({
                sessionId,
                sessionType: body.sessionType,
                projectId: body.projectId ?? null,
                title: body.title,
                now,
            });
    
            return createSuccessResponse<ConversationSession>({
                ...session,
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
    
            const messages = listMessages(database, session.sessionId);
            const lastAssistantMessage = [...messages].reverse().find((message) => {
                return message.role === "assistant";
            });
            return createSuccessResponse<SessionDetailResponse>({
                session,
                messages,
                turns: listTurns(database, session.sessionId),
                tasks: listTasks(database, session.sessionId),
                taskSteps: listTaskSteps(database, session.sessionId),
                tokenUsage: createDataAccess(database).tokenizer.findConversationTokenUsage(
                    session.sessionId,
                    "main",
                ),
                lastAssistantMessageCreatedAt: lastAssistantMessage?.createdAt ?? null,
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
    
            // deleteResult: 删除结果必须保留，随后用已落库的 session.deleted 事件广播给其他端。
            const deleteResult = deleteSession(
                database,
                events,
                session,
            );
            // deletedEvents: 删除接口不重造事件，直接查询中心服务事件事实源，保证广播内容和历史恢复来源一致。
            const deletedEvents = listEvents(
                database,
                {
                    sessionId: session.sessionId,
                    turnId: null,
                    afterSequence: -1,
                },
            ).filter((event) => {
                return event.eventType === "session.deleted";
            });
            broadcastEvents(
                realtimeClients,
                session,
                deletedEvents,
            );
    
            return createSuccessResponse({
                sessionId: deleteResult.sessionId,
                deleted: deleteResult.deleted,
            });
        });

    registerSessionMessageRoute({
            app,
            database,
            events,
            realtimeClients,
            centerDirectory: config.centerDirectory,
            memoryQueues,
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
}
