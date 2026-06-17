import type {FastifyInstance} from "fastify";
import {randomUUID} from "node:crypto";

import type {
    AgentSubConversationDetail,
    ClientType,
    PendingEditDiff,
    PendingEditRecord,
    ProjectRecord,
    WebSocketEnvelope,
} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import type {CenterLogger} from "../logger.js";
import {
    broadcastEvents,
    isSyncClientAllowed,
    sendSocketEnvelope,
} from "../realtime.js";
import {
    createDataAccess,
} from "../data-access/index.js";
import {AgentEditRepository} from "../data-access/agent-edit-repository.js";
import {
    deleteProject,
    deleteSession,
    findProject,
    findSession,
    listProjects,
    listSessions,
    listEvents,
    listMessages,
    listTaskSteps,
    listTaskStepsByAgent,
    listTasks,
    listTasksByAgent,
    listTurns,
    submitGuidanceForActiveTask,
} from "../domain/session-domain.js";
import {
    cancelActiveConversationTurn,
} from "../domain/session-cancel-domain.js";
import {
    abortRunningTurnRuntime,
} from "../domain/turn-runtime-cancel-registry.js";
import {
    cancelRunningCommandsForTurn,
} from "../domain/turn-command-cancel-registry.js";
import {
    listProviderConfigs,
    listRegisteredModelProtocolPlugins,
    readProviderModelList,
} from "../domain/provider-domain.js";
import {
    listAgents,
} from "../domain/agent-domain.js";
import {
    countComposerContextTokens,
} from "../domain/tokenizer-domain.js";
import {
    sendSessionMessageThroughCenter,
    type SessionMessageRouteContext,
} from "./session-message-route.js";
import {
    appendPendingEditEvent,
    createUnifiedDiff,
    findPendingEditRecord,
    insertAgentSubConversationMessage,
    listAgentSubConversationMessages,
    listPendingEditRecords,
    revertPendingEdit,
    updatePendingEditStatus,
    validateAgentSubConversationInput,
} from "./agent-edit-routes.js";
import {
    commitAttachment,
    createTemporaryAttachment,
} from "../domain/usage-domain.js";
import type {
    MemoryQueueState,
    RealtimeClientConnection,
    SessionDetailResponse,
} from "../types.js";

export interface CenterSyncRouteContext {
    /** app: Fastify 实例，负责挂载 WebSocket 路由。 */
    app: FastifyInstance;
    /** database: 中心服务数据库事实源，用于校验同步客户端范围。 */
    database: CenterDatabase;
    /** events: 中心服务事件事实源，用于 WebSocket 发送动作复用对话执行链路。 */
    events: CenterEventStore;
    /** logger: 中心服务文件日志，用于 WebSocket 发送动作审计。 */
    logger: CenterLogger;
    /** realtimeClients: 当前在线同步客户端表，连接关闭时必须清理。 */
    realtimeClients: Map<string, RealtimeClientConnection>;
    /** centerDirectory: 中心目录绝对路径，用于后台轮次执行和记忆写入。 */
    centerDirectory: string;
    /** memoryQueues: 智能体记忆写入队列，按 agentId 隔离串行写入。 */
    memoryQueues: Map<string, MemoryQueueState>;
}

/**
 * registerCenterSyncRoute：注册中心服务实时同步 WebSocket 路由。
 *
 * @param context WebSocket 路由依赖上下文。
 * @returns 注册完成后没有返回值。
 */
export function registerCenterSyncRoute(context: CenterSyncRouteContext): void {
    const {
        app,
        database,
        events,
        logger,
        realtimeClients,
        centerDirectory,
        memoryQueues,
    } = context;

    app.get("/api/sync", {
        websocket: true,
    }, (socket) => {
        // activeClientId: 当前 WebSocket 连接握手成功后的客户端 ID，用于关闭时清理。
        let activeClientId: string | null = null;

        socket.on("message", (rawMessage: Buffer | ArrayBuffer | Buffer[]) => {
            const envelope = parseRealtimeEnvelope(rawMessage);
            if (!envelope) {
                sendRealtimeError(
                    socket,
                    undefined,
                    "INVALID_ENVELOPE",
                    "实时同步消息格式无效。",
                );
                return;
            }

            if (envelope.type !== "client.hello") {
                handleRealtimeRequest({
                    socket,
                    database,
                    events,
                    logger,
                    realtimeClients,
                    centerDirectory,
                    memoryQueues,
                    envelope,
                    activeClientId,
                });
                return;
            }

            const clientId = envelope.payload.clientId;
            const clientType = envelope.payload.clientType;

            if (!clientId || !clientType || !isSyncClientAllowed(database, clientId, clientType, envelope.payload.projectId ?? null)) {
                sendSocketEnvelope(socket, {
                    type: "connection.state",
                    payload: {
                        status: "rejected",
                    },
                });
                socket.close();
                return;
            }

            realtimeClients.set(clientId, {
                clientId,
                clientType,
                projectId: envelope.payload.projectId ?? null,
                send: (message) => {
                    sendSocketEnvelope(socket, message);
                },
            });
            activeClientId = clientId;

            sendSocketEnvelope(socket, {
                type: "server.ready",
                payload: {
                    clientId,
                    clientType,
                },
            });
        });

        socket.on("close", () => {
            if (activeClientId) {
                realtimeClients.delete(activeClientId);
            }
        });
    });
}

/**
 * parseRealtimeEnvelope：解析 WebSocket 实时同步消息包。
 *
 * @param rawMessage WebSocket 原始消息。
 * @returns 解析成功时返回共享协议包；格式错误时返回 null。
 */
function parseRealtimeEnvelope(rawMessage: Buffer | ArrayBuffer | Buffer[]): WebSocketEnvelope<{
    /** clientId: 客户端握手 ID。 */
    clientId?: string;
    /** clientType: 客户端类型。 */
    clientType?: ClientType;
    /** projectId: 客户端绑定的项目 ID。 */
    projectId?: string | null;
}> | null {
    try {
        // envelope: WebSocket 消息必须使用共享协议包，解析失败时不能让事件回调异常退出中心服务。
        const envelope = JSON.parse(rawMessage.toString()) as WebSocketEnvelope<{
            clientId?: string;
            clientType?: ClientType;
            projectId?: string | null;
        }>;
        if (!envelope || typeof envelope !== "object" || typeof envelope.type !== "string") {
            return null;
        }
        return envelope;
    } catch {
        // catch: 畸形 WebSocket 文本属于客户端输入错误，必须转成协议错误响应。
        return null;
    }
}

/**
 * handleRealtimeRequest：处理对话页 WebSocket 请求/响应动作。
 *
 * @param input 请求处理上下文。
 * @returns 没有返回值。
 */
function handleRealtimeRequest(input: {
    /** socket: 当前 WebSocket 连接。 */
    socket: {
        /** send: WebSocket 发送函数。 */
        send: (data: string) => void;
    };
    /** database: 中心服务数据库事实源。 */
    database: CenterDatabase;
    /** events: 中心服务事件事实源。 */
    events: CenterEventStore;
    /** logger: 中心服务文件日志。 */
    logger: CenterLogger;
    /** realtimeClients: 当前在线同步客户端集合。 */
    realtimeClients: Map<string, RealtimeClientConnection>;
    /** centerDirectory: 中心目录绝对路径。 */
    centerDirectory: string;
    /** memoryQueues: 智能体记忆队列。 */
    memoryQueues: Map<string, MemoryQueueState>;
    /** envelope: 客户端请求包。 */
    envelope: WebSocketEnvelope;
    /** activeClientId: 已握手客户端 ID，未握手时为 null。 */
    activeClientId: string | null;
}): void {
    if (!input.activeClientId) {
        sendRealtimeError(
            input.socket,
            input.envelope.requestId,
            "CLIENT_HELLO_REQUIRED",
            "WebSocket 请求必须先完成 client.hello 握手。",
        );
        return;
    }
    try {
        if (input.envelope.type === "session.snapshot") {
            sendSocketEnvelope(input.socket, {
                type: "session.snapshot",
                requestId: input.envelope.requestId,
                payload: buildSessionSnapshot(
                    input.database,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "navigation.snapshot") {
            sendSocketEnvelope(input.socket, {
                type: "navigation.snapshot",
                requestId: input.envelope.requestId,
                payload: buildNavigationSnapshot(
                    input.database,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "chat.bootstrap.snapshot") {
            sendSocketEnvelope(input.socket, {
                type: "chat.bootstrap.snapshot",
                requestId: input.envelope.requestId,
                payload: buildChatBootstrapSnapshot(
                    input.centerDirectory,
                    input.database,
                ),
            });
            return;
        }
        if (input.envelope.type === "tokenizer.count") {
            const payload = input.envelope.payload as {
                /** windowKey: 前端当前对话窗口统计键，用于响应归属校验。 */
                windowKey?: string;
            };
            const tokenizerResult = countTokenizerFromRealtime(
                input.database,
                input.envelope.payload,
            );
            sendSocketEnvelope(input.socket, {
                type: "tokenizer.count",
                requestId: input.envelope.requestId,
                payload: {
                    ...tokenizerResult,
                    windowKey: payload.windowKey ?? "",
                },
            });
            return;
        }
        if (input.envelope.type === "project.register") {
            sendSocketEnvelope(input.socket, {
                type: "project.registered",
                requestId: input.envelope.requestId,
                payload: registerProjectFromRealtime(
                    input.database,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "project.delete") {
            sendSocketEnvelope(input.socket, {
                type: "project.deleted",
                requestId: input.envelope.requestId,
                payload: deleteProjectFromRealtime(
                    input.database,
                    input.events,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "session.create") {
            const payload = input.envelope.payload as {
                /** sessionType: 会话类型。 */
                sessionType?: "normal" | "project";
                /** projectId: 项目会话所属项目 ID。 */
                projectId?: string | null;
                /** title: 会话标题。 */
                title?: string;
            };
            sendSocketEnvelope(input.socket, {
                type: "session.created",
                requestId: input.envelope.requestId,
                payload: createDataAccess(input.database).sessions.createSession({
                    sessionId: randomUUID(),
                    sessionType: payload.sessionType ?? "normal",
                    projectId: payload.projectId ?? null,
                    title: payload.title ?? "新的对话",
                    now: new Date().toISOString(),
                }),
            });
            return;
        }
        if (input.envelope.type === "session.delete") {
            sendSocketEnvelope(input.socket, {
                type: "session.deleted",
                requestId: input.envelope.requestId,
                payload: deleteSessionFromRealtime(
                    input.database,
                    input.events,
                    input.realtimeClients,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "session.event.replay") {
            const payload = input.envelope.payload as {
                /** sessionId: 会话 ID。 */
                sessionId?: string | null;
                /** turnId: 轮次 ID。 */
                turnId?: string | null;
                /** afterSequence: 补齐起始事件序号。 */
                afterSequence?: number;
            };
            sendSocketEnvelope(input.socket, {
                type: "session.event.replay",
                requestId: input.envelope.requestId,
                payload: {
                    events: listEvents(input.database, {
                        sessionId: payload.sessionId ?? null,
                        turnId: payload.turnId ?? null,
                        afterSequence: typeof payload.afterSequence === "number"
                            ? payload.afterSequence
                            : 0,
                    }),
                },
            });
            return;
        }
        if (input.envelope.type === "session.message.send") {
            sendSocketEnvelope(input.socket, {
                type: "session.message.sent",
                requestId: input.envelope.requestId,
                payload: sendSessionMessageThroughCenter(
                    toSessionMessageContext(input),
                    input.envelope.payload as {
                        /** sessionId: 会话 ID。 */
                        sessionId?: string;
                        /** contentMarkdown: 用户消息 Markdown。 */
                        contentMarkdown?: string;
                    },
                ),
            });
            return;
        }
        if (input.envelope.type === "session.turn.cancel") {
            try {
                const payload = input.envelope.payload as {
                    /** sessionId: 当前会话 ID。 */
                    sessionId?: string;
                    /** reason: 用户点击停止时的可审计原因。 */
                    reason?: string;
                };
                const sessionId = payload.sessionId ?? "";
                const session = findSession(
                    input.database,
                    sessionId,
                );
                if (!session) {
                    sendRealtimeError(
                        input.socket,
                        input.envelope.requestId,
                        "SESSION_NOT_FOUND",
                        "未找到要停止的会话。",
                    );
                    return;
                }
                const beforeSequence = listEvents(input.database, {
                    sessionId,
                    turnId: null,
                    afterSequence: 0,
                }).at(-1)?.sequence ?? 0;
                const cancelled = cancelActiveConversationTurn(
                    input.database,
                    input.events,
                    {
                        sessionId,
                        reason: payload.reason ?? "用户点击停止当前执行。",
                    },
                );
                const appendedEvents = listEvents(input.database, {
                    sessionId,
                    turnId: cancelled?.turnId ?? null,
                    afterSequence: beforeSequence,
                });
                broadcastEvents(
                    input.realtimeClients,
                    session,
                    appendedEvents,
                );
                sendSocketEnvelope(input.socket, {
                    type: "session.turn.cancelled",
                    requestId: input.envelope.requestId,
                    payload: cancelled ?? {
                        sessionId,
                        turnId: null,
                        taskId: null,
                        status: "idle",
                        cancelledStepCount: 0,
                    },
                });
                if (cancelled) {
                    scheduleTurnRuntimeCancellation(
                        input.logger,
                        cancelled.turnId,
                        payload.reason ?? "用户点击停止当前执行。",
                    );
                }
                return;
            } catch (error) {
                const errorMessage = error instanceof Error
                    ? error.message
                    : "停止当前轮次失败。";
                void input.logger.error("center.turn_cancel.failed", {
                    requestId: input.envelope.requestId ?? null,
                    errorMessage,
                }).catch(() => {
                    // catch: 取消失败诊断日志不能反向影响错误响应。
                });
                sendRealtimeError(
                    input.socket,
                    input.envelope.requestId,
                    "TURN_CANCEL_FAILED",
                    errorMessage,
                );
                return;
            }
        }
        if (input.envelope.type === "session.guidance.submit") {
            const payload = input.envelope.payload as {
                /** sessionId: 会话 ID。 */
                sessionId?: string;
                /** contentMarkdown: 用户补充或修改的需求文本。 */
                contentMarkdown?: string;
            };
            const sessionId = payload.sessionId ?? "";
            const session = findSession(
                input.database,
                sessionId,
            );
            if (!session) {
                throw new Error("SESSION_NOT_FOUND");
            }
            const beforeSequence = input.events.lastSequenceForSession(sessionId);
            const merged = submitGuidanceForActiveTask(
                input.database,
                input.events,
                {
                    sessionId,
                    contentMarkdown: payload.contentMarkdown ?? "",
                },
            );
            const appendedEvents = listEvents(input.database, {
                sessionId,
                turnId: merged.turnId,
                afterSequence: beforeSequence,
            });
            broadcastEvents(
                input.realtimeClients,
                session,
                appendedEvents,
            );
            sendSocketEnvelope(input.socket, {
                type: "session.guidance.merged",
                requestId: input.envelope.requestId,
                payload: merged,
            });
            return;
        }
        if (input.envelope.type === "edit.pending.list") {
            sendSocketEnvelope(input.socket, {
                type: "edit.pending.list",
                requestId: input.envelope.requestId,
                payload: listPendingEditsFromRealtime(
                    input.database,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "edit.pending.save") {
            sendSocketEnvelope(input.socket, {
                type: "edit.pending.saved",
                requestId: input.envelope.requestId,
                payload: savePendingEditFromRealtime(
                    input.database,
                    input.events,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "edit.pending.save_all") {
            sendSocketEnvelope(input.socket, {
                type: "edit.pending.saved_all",
                requestId: input.envelope.requestId,
                payload: saveAllPendingEditsFromRealtime(
                    input.database,
                    input.events,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "edit.pending.revert") {
            sendSocketEnvelope(input.socket, {
                type: "edit.pending.reverted",
                requestId: input.envelope.requestId,
                payload: revertPendingEditFromRealtime(
                    input.database,
                    input.events,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "edit.pending.revert_all") {
            sendSocketEnvelope(input.socket, {
                type: "edit.pending.reverted_all",
                requestId: input.envelope.requestId,
                payload: revertAllPendingEditsFromRealtime(
                    input.database,
                    input.events,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "edit.pending.diff") {
            sendSocketEnvelope(input.socket, {
                type: "edit.pending.diff",
                requestId: input.envelope.requestId,
                payload: readPendingEditDiffFromRealtime(
                    input.database,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "agent.sub_conversation.detail") {
            sendSocketEnvelope(input.socket, {
                type: "agent.sub_conversation.detail",
                requestId: input.envelope.requestId,
                payload: readAgentSubConversationFromRealtime(
                    input.database,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "agent.sub_conversation.message.send") {
            sendSocketEnvelope(input.socket, {
                type: "agent.sub_conversation.message.sent",
                requestId: input.envelope.requestId,
                payload: sendAgentSubConversationFromRealtime(
                    input.database,
                    input.events,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "attachment.temporary.create") {
            sendSocketEnvelope(input.socket, {
                type: "attachment.temporary.created",
                requestId: input.envelope.requestId,
                payload: createTemporaryAttachmentFromRealtime(
                    input.centerDirectory,
                    input.envelope.payload,
                ),
            });
            return;
        }
        if (input.envelope.type === "attachment.commit") {
            sendSocketEnvelope(input.socket, {
                type: "attachment.committed",
                requestId: input.envelope.requestId,
                payload: commitAttachmentFromRealtime(
                    input.database,
                    input.events,
                    input.centerDirectory,
                    input.envelope.payload,
                ),
            });
            return;
        }
        sendRealtimeError(
            input.socket,
            input.envelope.requestId,
            "WEBSOCKET_REQUEST_UNKNOWN",
            `未知 WebSocket 请求：${input.envelope.type}`,
        );
    } catch (error) {
        const errorMessage = error instanceof Error
            ? error.message
            : "WebSocket 请求处理失败。";
        void input.logger.error("center.websocket.request_failed", {
            envelopeType: input.envelope.type,
            requestId: input.envelope.requestId ?? null,
            activeClientId: input.activeClientId,
            errorMessage,
        }).catch(() => {
            // catch: WebSocket 错误诊断日志不能反向影响实时请求错误响应。
        });
        sendRealtimeError(
            input.socket,
            input.envelope.requestId,
            errorMessage,
            errorMessage,
        );
    }
}

/**
 * scheduleTurnRuntimeCancellation：在停止响应完成后异步中止运行时和命令。
 *
 * @param logger 中心服务文件日志。
 * @param turnId 当前轮次 ID。
 * @param reason 用户或系统触发取消时的原因。
 * @returns 没有返回值。
 */
function scheduleTurnRuntimeCancellation(
    logger: CenterLogger,
    turnId: string,
    reason: string,
): void {
    setImmediate(() => {
        try {
            const commandCount = cancelRunningCommandsForTurn(
                turnId,
                reason,
            );
            const runtimeAborted = abortRunningTurnRuntime(
                turnId,
                reason,
            );
            void logger.info("center.turn_runtime.cancel_requested", {
                turnId,
                commandCount,
                runtimeAborted,
            }).catch(() => {
                // catch: 异步取消诊断日志不能反向影响停止动作。
            });
        } catch (error) {
            const errorMessage = error instanceof Error
                ? error.message
                : "运行时取消失败。";
            void logger.error("center.turn_runtime.cancel_failed", {
                turnId,
                errorMessage,
            }).catch(() => {
                // catch: 异步取消失败日志不能反向影响中心服务进程。
            });
        }
    });
}

/**
 * buildChatBootstrapSnapshot：构造对话页首屏所需的供应商、模型和智能体快照。
 *
 * @param centerDirectory 中心目录绝对路径，用于读取供应商 JSON 和模型缓存。
 * @param database 中心服务数据库事实源，用于读取智能体索引。
 * @returns 对话页输入区初始化快照。
 */
function buildChatBootstrapSnapshot(
    centerDirectory: string,
    database: CenterDatabase,
): {
    /** providers: 供应商配置列表，来源于中心服务供应商事实源。 */
    providers: ReturnType<typeof listProviderConfigs>;
    /** providerProtocolPlugins: 内联 LangChain 协议能力列表，兼容前端原字段命名。 */
    providerProtocolPlugins: ReturnType<typeof listRegisteredModelProtocolPlugins>;
    /** providerModelOptions: 供应商 ID 到已保存模型列表的映射。 */
    providerModelOptions: Record<string, ReturnType<typeof readProviderModelList>>;
    /** agents: 主智能体和长期智能体索引。 */
    agents: ReturnType<typeof listAgents>;
} {
    const providers = listProviderConfigs(centerDirectory);
    const providerModelOptions = Object.fromEntries(providers.map((provider) => {
        return [
            provider.providerId,
            readProviderModelList(
                centerDirectory,
                provider.providerId,
            ),
        ];
    }));

    return {
        providers,
        providerProtocolPlugins: listRegisteredModelProtocolPlugins(centerDirectory),
        providerModelOptions,
        agents: listAgents(database),
    };
}

/**
 * countTokenizerFromRealtime：通过 WebSocket 统计当前对话窗口上下文 token。
 *
 * @param database 中心服务数据库事实源。
 * @param payload 客户端 tokenizer 统计请求。
 * @returns token 统计响应。
 */
function countTokenizerFromRealtime(
    database: CenterDatabase,
    payload: unknown,
): ReturnType<typeof countComposerContextTokens> {
    const body = payload as {
        /** sessionId: 当前会话 ID；草稿未绑定会话时为 null。 */
        sessionId?: string | null;
        /** turnId: 当前统计关联轮次；没有轮次时为 null。 */
        turnId?: string | null;
        /** agentId: 当前统计所属智能体；主智能体固定为 main。 */
        agentId?: string;
        /** draftText: 当前草稿文本；执行期统计通常为空字符串。 */
        draftText?: string;
        /** referenceSummaries: 当前引用摘要。 */
        referenceSummaries?: string[];
        /** attachmentSummaries: 当前附件摘要。 */
        attachmentSummaries?: string[];
        /** modelId: 当前选中模型 ID。 */
        modelId?: string;
        /** windowLimitTokens: 当前模型窗口上限。 */
        windowLimitTokens?: number;
    };

    return countComposerContextTokens(
        database,
        {
            sessionId: body.sessionId ?? null,
            turnId: body.turnId ?? null,
            agentId: body.agentId ?? "main",
            draftText: body.draftText ?? "",
            referenceSummaries: Array.isArray(body.referenceSummaries)
                ? body.referenceSummaries
                : [],
            attachmentSummaries: Array.isArray(body.attachmentSummaries)
                ? body.attachmentSummaries
                : [],
            modelId: body.modelId ?? "",
            windowLimitTokens: typeof body.windowLimitTokens === "number"
                ? body.windowLimitTokens
                : 0,
        },
    );
}

/**
 * buildNavigationSnapshot：构造对话页导航需要的项目和会话快照。
 *
 * @param database 中心服务数据库事实源。
 * @param payload 客户端请求载荷。
 * @returns 会话和项目列表。
 */
function buildNavigationSnapshot(
    database: CenterDatabase,
    payload: unknown,
): {
    /** sessions: 会话列表。 */
    sessions: ReturnType<typeof listSessions>;
    /** projects: 项目列表。 */
    projects: ReturnType<typeof listProjects>;
} {
    const requestPayload = payload as {
        /** sessionType: 可选会话类型过滤。 */
        sessionType?: "normal" | "project";
        /** projectId: 可选项目过滤。 */
        projectId?: string | null;
    };
    return {
        sessions: listSessions(database, {
            sessionType: requestPayload.sessionType,
            projectId: requestPayload.projectId ?? null,
        }),
        projects: listProjects(database),
    };
}

/**
 * buildSessionSnapshot：构造对话页 WebSocket 首屏快照。
 *
 * @param database 中心服务数据库事实源。
 * @param payload 客户端请求载荷。
 * @returns 会话详情和事件列表。
 */
function buildSessionSnapshot(
    database: CenterDatabase,
    payload: unknown,
): {
    /** detail: 会话详情。 */
    detail: SessionDetailResponse;
    /** events: 当前会话事件列表。 */
    events: ReturnType<typeof listEvents>;
} {
    const requestPayload = payload as {
        /** sessionId: 会话 ID。 */
        sessionId?: string;
    };
    const session = findSession(database, requestPayload.sessionId ?? "");
    if (!session) {
        throw new Error("SESSION_NOT_FOUND");
    }
    const messages = listMessages(database, session.sessionId);
    const lastAssistantMessage = [...messages].reverse().find((message) => {
        return message.role === "assistant";
    });
    return {
        detail: {
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
        },
        events: listEvents(database, {
            sessionId: session.sessionId,
            turnId: null,
            afterSequence: 0,
        }),
    };
}

/**
 * toSessionMessageContext：把 WebSocket 上下文转换为发送消息共用上下文。
 *
 * @param input WebSocket 请求上下文。
 * @returns 会话消息发送上下文。
 */
function toSessionMessageContext(input: {
    database: CenterDatabase;
    events: CenterEventStore;
    logger: CenterLogger;
    realtimeClients: Map<string, RealtimeClientConnection>;
    centerDirectory: string;
    memoryQueues: Map<string, MemoryQueueState>;
}): SessionMessageRouteContext {
    return {
        app: null as never,
        database: input.database,
        events: input.events,
        logger: input.logger,
        realtimeClients: input.realtimeClients,
        centerDirectory: input.centerDirectory,
        memoryQueues: input.memoryQueues,
    };
}

/**
 * registerProjectFromRealtime：通过 WebSocket 登记或更新项目事实。
 *
 * @param database 中心服务数据库事实源。
 * @param payload 客户端项目登记请求。
 * @returns 项目记录。
 */
function registerProjectFromRealtime(
    database: CenterDatabase,
    payload: unknown,
): ProjectRecord {
    const body = payload as {
        /** projectId: 项目 UUID，来源于项目身份文件。 */
        projectId?: string;
        /** displayName: 项目文件夹主名称。 */
        displayName?: string;
        /** latestPath: 最近打开路径或浏览器目录名。 */
        latestPath?: string;
    };
    const latestPath = body.latestPath?.trim() ?? "";
    const displayName = body.displayName && body.displayName.trim().length > 0
        ? body.displayName.trim()
        : deriveProjectDisplayNameFromPath(latestPath);
    if (!body.projectId || !latestPath || !displayName) {
        throw new Error("PROJECT_REGISTER_INVALID");
    }
    return createDataAccess(database).sessions.upsertProject({
        projectId: body.projectId,
        displayName,
        latestPath,
        now: new Date().toISOString(),
    });
}

/**
 * deleteProjectFromRealtime：通过 WebSocket 删除项目索引和项目会话事实。
 *
 * @param database 中心服务数据库事实源。
 * @param events 中心服务事件事实源。
 * @param payload 删除项目请求。
 * @returns 项目删除结果。
 */
function deleteProjectFromRealtime(
    database: CenterDatabase,
    events: CenterEventStore,
    payload: unknown,
) {
    const body = payload as {
        /** projectId: 要删除的项目 ID。 */
        projectId?: string;
    };
    if (!body.projectId) {
        throw new Error("PROJECT_DELETE_INVALID");
    }
    const project = findProject(
        database,
        body.projectId,
    );
    if (!project) {
        throw new Error("PROJECT_NOT_FOUND");
    }
    return deleteProject(
        database,
        events,
        project,
    );
}

/**
 * deleteSessionFromRealtime：通过 WebSocket 删除会话并广播删除事件。
 *
 * @param database 中心服务数据库事实源。
 * @param events 中心服务事件事实源。
 * @param realtimeClients 当前在线客户端集合。
 * @param payload 删除会话请求。
 * @returns 会话删除结果。
 */
function deleteSessionFromRealtime(
    database: CenterDatabase,
    events: CenterEventStore,
    realtimeClients: Map<string, RealtimeClientConnection>,
    payload: unknown,
) {
    const body = payload as {
        /** sessionId: 要删除的会话 ID。 */
        sessionId?: string;
    };
    if (!body.sessionId) {
        throw new Error("SESSION_DELETE_INVALID");
    }
    const session = findSession(
        database,
        body.sessionId,
    );
    if (!session) {
        throw new Error("SESSION_NOT_FOUND");
    }
    const deleteResult = deleteSession(
        database,
        events,
        session,
    );
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
    return deleteResult;
}

/**
 * listPendingEditsFromRealtime：读取当前会话待确认编辑。
 *
 * @param database 中心服务数据库事实源。
 * @param payload 查询请求。
 * @returns 编辑列表响应。
 */
function listPendingEditsFromRealtime(
    database: CenterDatabase,
    payload: unknown,
): {
    /** edits: 待确认编辑列表。 */
    edits: PendingEditRecord[];
} {
    const body = payload as {
        /** sessionId: 当前会话 ID。 */
        sessionId?: string;
    };
    if (!body.sessionId || !findSession(database, body.sessionId)) {
        throw new Error("SESSION_NOT_FOUND");
    }
    return {
        edits: listPendingEditRecords(
            new AgentEditRepository(database),
            body.sessionId,
        ),
    };
}

/**
 * savePendingEditFromRealtime：确认保存单个待确认编辑。
 *
 * @param database 中心服务数据库事实源。
 * @param events 中心服务事件事实源。
 * @param payload 保存请求。
 * @returns 保存后的编辑记录。
 */
function savePendingEditFromRealtime(
    database: CenterDatabase,
    events: CenterEventStore,
    payload: unknown,
): {
    /** edit: 更新后的编辑记录。 */
    edit: PendingEditRecord;
} {
    const repository = new AgentEditRepository(database);
    const body = payload as {
        /** editId: 待确认编辑 ID。 */
        editId?: string;
    };
    const record = findPendingEditRecord(
        repository,
        body.editId ?? "",
    );
    if (!record) {
        throw new Error("PENDING_EDIT_NOT_FOUND");
    }
    const saved = updatePendingEditStatus(
        repository,
        record,
        "accepted",
    );
    appendPendingEditEvent(
        events,
        saved,
        "edit.pending.accepted",
        "编辑已保存",
    );
    return {
        edit: saved,
    };
}

/**
 * saveAllPendingEditsFromRealtime：确认保存当前会话全部待确认编辑。
 *
 * @param database 中心服务数据库事实源。
 * @param events 中心服务事件事实源。
 * @param payload 保存全部请求。
 * @returns 保存后的编辑列表。
 */
function saveAllPendingEditsFromRealtime(
    database: CenterDatabase,
    events: CenterEventStore,
    payload: unknown,
): {
    /** edits: 更新后的编辑列表。 */
    edits: PendingEditRecord[];
} {
    const repository = new AgentEditRepository(database);
    const body = payload as {
        /** sessionId: 当前会话 ID。 */
        sessionId?: string;
    };
    const records = listPendingEditRecords(
        repository,
        body.sessionId ?? "",
    ).filter((record) => {
        return record.status === "pending";
    });
    return {
        edits: records.map((record) => {
            const saved = updatePendingEditStatus(
                repository,
                record,
                "accepted",
            );
            appendPendingEditEvent(
                events,
                saved,
                "edit.pending.accepted",
                "编辑已保存",
            );
            return saved;
        }),
    };
}

/**
 * revertPendingEditFromRealtime：撤回单个待确认编辑。
 *
 * @param database 中心服务数据库事实源。
 * @param events 中心服务事件事实源。
 * @param payload 撤回请求。
 * @returns 撤回后的编辑记录。
 */
function revertPendingEditFromRealtime(
    database: CenterDatabase,
    events: CenterEventStore,
    payload: unknown,
): {
    /** edit: 撤回后的编辑记录。 */
    edit: PendingEditRecord;
} {
    const repository = new AgentEditRepository(database);
    const body = payload as {
        /** editId: 待确认编辑 ID。 */
        editId?: string;
    };
    const result = revertPendingEdit(
        repository,
        body.editId ?? "",
    );
    if (!result.ok) {
        throw new Error(result.code);
    }
    appendPendingEditEvent(
        events,
        result.edit,
        "edit.pending.reverted",
        "编辑已撤回",
    );
    return {
        edit: result.edit,
    };
}

/**
 * revertAllPendingEditsFromRealtime：撤回当前会话全部待确认编辑。
 *
 * @param database 中心服务数据库事实源。
 * @param events 中心服务事件事实源。
 * @param payload 撤回全部请求。
 * @returns 成功撤回的编辑列表。
 */
function revertAllPendingEditsFromRealtime(
    database: CenterDatabase,
    events: CenterEventStore,
    payload: unknown,
): {
    /** edits: 成功撤回的编辑列表。 */
    edits: PendingEditRecord[];
} {
    const repository = new AgentEditRepository(database);
    const body = payload as {
        /** sessionId: 当前会话 ID。 */
        sessionId?: string;
    };
    const records = listPendingEditRecords(
        repository,
        body.sessionId ?? "",
    ).filter((record) => {
        return record.status === "pending";
    });
    const edits: PendingEditRecord[] = [];
    for (const record of records) {
        const result = revertPendingEdit(
            repository,
            record.editId,
        );
        if (result.ok) {
            appendPendingEditEvent(
                events,
                result.edit,
                "edit.pending.reverted",
                "编辑已撤回",
            );
            edits.push(result.edit);
        }
    }
    return {
        edits,
    };
}

/**
 * readPendingEditDiffFromRealtime：读取待确认编辑 diff。
 *
 * @param database 中心服务数据库事实源。
 * @param payload diff 查询请求。
 * @returns 编辑 diff。
 */
function readPendingEditDiffFromRealtime(
    database: CenterDatabase,
    payload: unknown,
): PendingEditDiff {
    const repository = new AgentEditRepository(database);
    const body = payload as {
        /** editId: 待确认编辑 ID。 */
        editId?: string;
    };
    const record = findPendingEditRecord(
        repository,
        body.editId ?? "",
    );
    if (!record) {
        throw new Error("PENDING_EDIT_NOT_FOUND");
    }
    return {
        editId: record.editId,
        filePath: record.filePath,
        beforeContent: record.beforeContent,
        afterContent: record.afterContent,
        diffText: createUnifiedDiff(record),
    };
}

/**
 * readAgentSubConversationFromRealtime：读取智能体子对话。
 *
 * @param database 中心服务数据库事实源。
 * @param payload 子对话查询请求。
 * @returns 智能体子对话详情。
 */
function readAgentSubConversationFromRealtime(
    database: CenterDatabase,
    payload: unknown,
): AgentSubConversationDetail {
    const body = payload as {
        /** parentSessionId: 主会话 ID。 */
        parentSessionId?: string;
        /** agentId: 智能体 ID。 */
        agentId?: string;
        /** agentName: 智能体展示名。 */
        agentName?: string;
    };
    const validation = validateAgentSubConversationInput(
        database,
        body.parentSessionId,
        body.agentId,
    );
    if (validation) {
        throw new Error("AGENT_SUB_CONVERSATION_INVALID");
    }
    const parentSessionId = body.parentSessionId ?? "";
    const agentId = body.agentId ?? "";
    return {
        parentSessionId,
        agentId,
        agentName: body.agentName ?? agentId,
        messages: listAgentSubConversationMessages(
            new AgentEditRepository(database),
            parentSessionId,
            agentId,
        ),
        tasks: listTasksByAgent(
            database,
            parentSessionId,
            agentId,
        ),
        taskSteps: listTaskStepsByAgent(
            database,
            parentSessionId,
            agentId,
        ),
        events: listEvents(
            database,
            {
                sessionId: parentSessionId,
                turnId: null,
                agentId,
                afterSequence: 0,
            },
        ),
        tokenUsage: createDataAccess(database).tokenizer.findConversationTokenUsage(
            parentSessionId,
            agentId,
        ),
    };
}

/**
 * sendAgentSubConversationFromRealtime：发送智能体子对话消息。
 *
 * @param database 中心服务数据库事实源。
 * @param events 中心服务事件事实源。
 * @param payload 子对话发送请求。
 * @returns 更新后的子对话详情。
 */
function sendAgentSubConversationFromRealtime(
    database: CenterDatabase,
    events: CenterEventStore,
    payload: unknown,
): AgentSubConversationDetail {
    const repository = new AgentEditRepository(database);
    const body = payload as {
        /** parentSessionId: 主会话 ID。 */
        parentSessionId?: string;
        /** agentId: 智能体 ID。 */
        agentId?: string;
        /** agentName: 智能体展示名。 */
        agentName?: string;
        /** contentMarkdown: 用户消息正文。 */
        contentMarkdown?: string;
    };
    const validation = validateAgentSubConversationInput(
        database,
        body.parentSessionId,
        body.agentId,
    );
    if (validation) {
        throw new Error("AGENT_SUB_CONVERSATION_INVALID");
    }
    if (!body.contentMarkdown?.trim()) {
        throw new Error("AGENT_SUB_MESSAGE_REQUIRED");
    }
    const message = insertAgentSubConversationMessage(
        repository,
        {
            parentSessionId: body.parentSessionId ?? "",
            agentId: body.agentId ?? "",
            agentName: body.agentName ?? body.agentId ?? "",
            contentMarkdown: body.contentMarkdown,
        },
    );
    events.append({
        eventType: "agent.sub_conversation.message.created",
        scopeType: "agent",
        scopeId: message.agentId,
        sessionId: message.parentSessionId,
        turnId: null,
        taskId: null,
        agentId: message.agentId,
        projectId: null,
        status: "completed",
        title: "智能体子对话消息",
        summary: message.contentMarkdown.slice(
            0,
            120,
        ),
        payload: {
            messageId: message.messageId,
            parentSessionId: message.parentSessionId,
            agentId: message.agentId,
        },
    });
    return readAgentSubConversationFromRealtime(
        database,
        {
            parentSessionId: message.parentSessionId,
            agentId: message.agentId,
            agentName: body.agentName ?? message.agentId,
        },
    );
}

/**
 * createTemporaryAttachmentFromRealtime：创建输入框临时附件占位。
 *
 * @param centerDirectory 中心目录。
 * @param payload 临时附件请求。
 * @returns 临时附件元数据。
 */
function createTemporaryAttachmentFromRealtime(
    centerDirectory: string,
    payload: unknown,
) {
    const body = payload as {
        /** fileName: 原始文件名。 */
        fileName?: string;
        /** mimeType: MIME 类型。 */
        mimeType?: string;
        /** sizeBytes: 文件大小。 */
        sizeBytes?: number;
    };
    if (!body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
        throw new Error("TEMP_FILE_CREATE_INVALID");
    }
    return createTemporaryAttachment(
        centerDirectory,
        body.fileName,
        body.mimeType,
        body.sizeBytes,
    );
}

/**
 * commitAttachmentFromRealtime：把临时附件绑定到已发送消息。
 *
 * @param database 中心服务数据库事实源。
 * @param events 中心服务事件事实源。
 * @param centerDirectory 中心目录。
 * @param payload 附件提交请求。
 * @returns 正式附件元数据。
 */
function commitAttachmentFromRealtime(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    payload: unknown,
) {
    const body = payload as {
        /** sessionId: 会话 ID。 */
        sessionId?: string;
        /** messageId: 消息 ID。 */
        messageId?: string;
        /** temporaryAttachmentId: 临时附件 ID。 */
        temporaryAttachmentId?: string;
        /** temporaryRelativePath: 临时附件相对中心目录路径，来源于 attachment.temporary.create 返回值。 */
        temporaryRelativePath?: string;
        /** fileName: 原始文件名。 */
        fileName?: string;
        /** mimeType: MIME 类型。 */
        mimeType?: string;
        /** sizeBytes: 文件大小。 */
        sizeBytes?: number;
    };
    if (!body.sessionId || !body.messageId || !body.temporaryAttachmentId || !body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
        throw new Error("ATTACHMENT_COMMIT_INVALID");
    }
    return commitAttachment(
        database,
        events,
        centerDirectory,
        body,
    );
}

/**
 * deriveProjectDisplayNameFromPath：从路径派生项目主名称。
 *
 * @param latestPath 最近项目路径或目录名。
 * @returns 最后一级目录名。
 */
function deriveProjectDisplayNameFromPath(latestPath: string): string {
    return latestPath.split(/[\\/]/u).filter((part) => {
        return part.trim().length > 0;
    }).at(-1)?.trim() ?? "";
}

/**
 * sendRealtimeError：发送 WebSocket 请求错误响应。
 *
 * @param socket WebSocket 连接。
 * @param requestId 请求 ID。
 * @param code 错误码。
 * @param message 错误说明。
 * @returns 没有返回值。
 */
function sendRealtimeError(
    socket: {
        send: (data: string) => void;
    },
    requestId: string | undefined,
    code: string,
    message: string,
): void {
    try {
        sendSocketEnvelope(socket, {
            type: "request.error",
            requestId,
            payload: {
                code,
                message,
            },
        });
    } catch {
        // catch: 错误响应可能发生在客户端断开之后，不能让二次发送异常影响中心服务进程。
    }
}
