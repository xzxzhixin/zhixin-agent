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
 * registerTaskRoutes：注册 task 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerTaskRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        database,
        events,
    } = context;

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
}
