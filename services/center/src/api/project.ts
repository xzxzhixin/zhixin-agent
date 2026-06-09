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
 * registerProjectRoutes：注册 project 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerProjectRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        database,
        events,
    } = context;

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
            const project = createDataAccess(database).sessions.upsertProject({
                projectId: body.projectId,
                displayName,
                latestPath,
                now,
            });
    
            return createSuccessResponse<ProjectRecord>({
                ...project,
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

    app.post("/api/project/delete", async (request) => {
            const body = request.body as {
                projectId?: string;
            };
    
            if (!body.projectId) {
                return createErrorResponse(
                    "PROJECT_DELETE_INVALID",
                    "删除项目缺少 projectId",
                    "请选择要删除的项目。",
                );
            }
    
            const project = findProject(database, body.projectId);
    
            if (!project) {
                return createErrorResponse(
                    "PROJECT_NOT_FOUND",
                    "删除项目时项目不存在",
                    "没有找到要删除的项目。",
                );
            }
    
            return createSuccessResponse(deleteProject(
                database,
                events,
                project,
            ));
        });
}
