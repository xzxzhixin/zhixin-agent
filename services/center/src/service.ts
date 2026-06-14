import {randomUUID} from "node:crypto";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    rmSync,
} from "node:fs";
import {
    join,
    resolve,
} from "node:path";
import websocket from "@fastify/websocket";
import Fastify, {type FastifyInstance} from "fastify";

import {CenterDatabase} from "./database.js";
import {CenterDirectory} from "./directory.js";
import {CenterEventStore} from "./events.js";
import {
    applyLocalDevCorsHeaders,
    createErrorResponse,
    isHealthyCenterServiceAlreadyListening,
    resolveAllowedLocalDevCorsOrigin,
} from "./helpers.js";
import {CenterLogger} from "./logger.js";
import {CenterStartupLock} from "./startup-lock.js";
import {readFrontendAsset, resolveFrontendDevServerRedirectUrl} from "./config.js";
import type {
    CenterServiceConfig,
    MemoryQueueState,
    RealtimeClientConnection,
    SubAgentRuntimeRecord,
} from "./types.js";
import {registerCenterApiRoutes} from "./api/api-routes.js";
import {finalizeDanglingConversationTurns} from "./domain/session-recovery-domain.js";
import {formatCenterLocalDateTime} from "./time.js";

export interface CenterService {
    /**
     * config: 当前中心服务启动配置。
     */
    config: CenterServiceConfig;

    /**
     * app: Fastify 应用实例，检查脚本使用 inject 验证 API。
     */
    app: FastifyInstance;

    /**
     * directory: 中心目录初始化器。
     */
    directory: CenterDirectory;

    /**
     * database: SQLite 数据库封装。
     */
    database: CenterDatabase;

    /**
     * events: 事件日志封装。
     */
    events: CenterEventStore;

    /**
     * startupLock: 启动锁封装。
     */
    startupLock: CenterStartupLock;

    /**
     * initialize: 执行中心目录、数据库和日志初始化。
     */
    initialize: () => Promise<void>;

    /**
     * listen: 获取启动锁后监听端口。
     */
    listen: () => Promise<CenterListenResult>;

    /**
     * close: 释放资源并清理临时目录。
     */
    close: () => Promise<void>;
}

/**
 * CenterListenResult：中心服务监听结果。
 *
 * 来源：桌面壳和命令行启动流程。
 * 含义：区分本进程真实监听和复用同中心目录的既有健康实例。
 * 格式：JSON 对象。
 * 默认值：reusedExisting 为 false 表示本进程持有启动锁和端口。
 * 约束：复用既有实例时不能释放对方启动锁。
 */
export interface CenterListenResult {
    /**
     * reusedExisting: 是否复用同端口同中心目录的既有健康中心服务。
     */
    reusedExisting: boolean;

    /**
     * port: 中心服务端口。
     */
    port: number;

    /**
     * centerDirectory: 中心目录绝对路径。
     */
    centerDirectory: string;
}

/**
 * createCenterService：创建中心服务实例。
 *
 * @param config 中心服务启动配置。
 * @returns 中心服务模块化实例。
 */
export async function createCenterService(config: CenterServiceConfig): Promise<CenterService> {
    // app: logger=false 避免检查脚本输出噪音，日志统一写中心服务文件日志。
    const app = Fastify({
        logger: false,
        trustProxy: true,
    });
    // directory: 中心目录初始化职责。
    const directory = new CenterDirectory(config);
    // database: SQLite 连接封装。
    const database = new CenterDatabase(config);
    // events: 事件序号封装。
    const events = new CenterEventStore(database);
    // startupLock: 同目录多实例保护。
    const startupLock = new CenterStartupLock(config.centerDirectory);
    // logger: 追加式文件日志。
    const logger = new CenterLogger(config.centerDirectory);
    // realtimeClients: 运行期 WebSocket 客户端集合，事件事实仍以 SQLite 为准。
    const realtimeClients = new Map<string, RealtimeClientConnection>();
    // memoryQueues: 按智能体隔离的记忆单写队列状态，避免同一 Markdown 文件竞争写入。
    const memoryQueues = new Map<string, MemoryQueueState>();
    // subAgents: 当前中心服务运行期的一次性子智能体记录，不写长期智能体定义文件。
    const subAgents = new Map<string, SubAgentRuntimeRecord>();
    // initialized: 标记启动前初始化是否完成。
    let initialized = false;
    // processStartedAt: 当前中心服务进程启动时间，供健康检查和前端恢复边界判断使用。
    const processStartedAt = formatCenterLocalDateTime();
    // lockAcquired: 只在本进程持有启动锁时为 true，避免复用已有服务时误删对方锁文件。
    let lockAcquired = false;
    // appListening: 只在本 Fastify 实例真正监听端口时为 true，复用已有服务不关闭未监听实例。
    let appListening = false;

    await app.register(websocket);

    app.addHook("onRequest", async (request, reply) => {
        // corsOrigin: 浏览器跨端口开发请求会携带 Origin，同源或非浏览器请求通常没有该头。
        const corsOrigin = resolveAllowedLocalDevCorsOrigin(request.headers.origin);

        if (corsOrigin) {
            // CORS 只服务本机 Vite 开发前端，生产期由中心服务同源托管前端资源。
            applyLocalDevCorsHeaders(reply, corsOrigin);
        }

        if (request.method === "OPTIONS") {
            if (corsOrigin) {
                // OPTIONS 预检不进入业务路由，避免浏览器在真实 POST 前被统一 API 404 拦截。
                await reply
                    .code(204)
                    .send();
                return;
            }

            if (request.url.startsWith("/api/") && request.headers.origin) {
                // 未声明来源不返回 CORS 放行头，避免把中心服务暴露给任意公网页面调用。
                await reply
                    .code(403)
                    .send(createErrorResponse(
                        "CORS_ORIGIN_NOT_ALLOWED",
                        "当前跨源来源不允许访问中心服务",
                        "只允许本机开发前端来源跨端口访问中心服务。",
                    ));
                return;
            }
        }
    });

    /**
     * initialize：执行启动前初始化。
     *
     * @returns 初始化完成后没有返回值。
     */
    async function initialize(): Promise<void> {
        await directory.initialize();
        syncBuiltinPluginsToCenterDirectory(config);
        database.initialize();
        const startupRecovered = finalizeDanglingConversationTurns(
            database,
            events,
            {
                reason: "中心服务重新启动，已收尾上一进程遗留的运行中轮次。",
                source: "startup_recovery",
            },
        );
        await logger.info("center.bootstrap.initialized", {
            centerDirectory: config.centerDirectory,
            port: config.port,
            processStartedAt,
            startupRecovered,
        });
        initialized = true;
    }

    /**
     * close：关闭资源并释放锁。
     *
     * @returns 关闭完成后没有返回值。
     */
    async function close(): Promise<void> {
        if (initialized) {
            const shutdownRecovered = finalizeDanglingConversationTurns(
                database,
                events,
                {
                    reason: "中心服务关闭，已收尾当前进程未结束的运行中轮次。",
                    source: "shutdown_recovery",
                },
            );
            await logger.info("center.shutdown.finalized_running_turns", {
                centerDirectory: config.centerDirectory,
                processStartedAt,
                shutdownRecovered,
            });
            database.close();
            await directory.close();
            initialized = false;
        }
        if (lockAcquired) {
            await startupLock.release();
            lockAcquired = false;
        }
        if (appListening) {
            await app.close();
            appListening = false;
        }
    }

    app.addHook("onRequest", async (request, reply) => {
        // method: REST API 只允许 GET 和 POST，OPTIONS 留给浏览器预检。
        const method = request.method;
        if (method === "GET" || method === "POST" || method === "OPTIONS") {
            return;
        }

        await reply
            .code(405)
            .send(createErrorResponse(
                "METHOD_NOT_ALLOWED",
                "中心服务 REST API 只允许 GET 和 POST",
                "当前接口不支持该请求方法。",
            ));
    });

    app.setNotFoundHandler(async (request, reply) => {
        // frontendDevRedirectUrl: 开发期浏览器访问 8866 页面时跳到 Vite，避免长期读取旧 dist。
        const frontendDevRedirectUrl = resolveFrontendDevServerRedirectUrl(
            config.frontendDevServerUrl,
            config.port,
            request.url,
        );
        if (frontendDevRedirectUrl) {
            // Fastify 5 的 redirect 参数顺序以 URL 为先；状态码放第二位，避免把 URL 误判成非法状态码。
            await reply.redirect(frontendDevRedirectUrl, 302);
            return;
        }

        // frontendAsset: 非 API 请求优先按前端静态资源或 SPA 入口处理，中心服务负责提供 Web 页面资源。
        const frontendAsset = await readFrontendAsset(config.frontendDistDirectory, request.url);
        if (frontendAsset) {
            await reply
                .type(frontendAsset.contentType)
                .send(frontendAsset.content);
            return;
        }

        // notFound: API 路径不存在用统一响应包表达，不用 HTTP 404 表示业务实体缺失。
        await reply
            .code(200)
            .send(createErrorResponse(
                "API_NOT_FOUND",
                "接口不存在",
                "中心服务没有提供该接口。",
            ));
    });

    app.setErrorHandler(async (error: Error, _request, reply) => {
        // traceId: 错误响应和日志共同使用的排查编号。
        const traceId = randomUUID();
        // businessErrorCode: 领域函数可抛出固定业务错误码，由统一错误处理包装为业务失败响应。
        const businessErrorCode = error.message === "PROVIDER_NOT_FOUND"
            ? "PROVIDER_NOT_FOUND"
            : null;
        await logger.error("center.api.error", {
            traceId,
            message: error.message,
        });
        await reply
            .code(businessErrorCode === null ? 500 : 200)
            .send(createErrorResponse(
                businessErrorCode ?? "CENTER_INTERNAL_ERROR",
                error.message,
                businessErrorCode === "PROVIDER_NOT_FOUND"
                    ? "没有找到指定供应商。"
                    : "中心服务处理请求失败。",
                traceId,
            ));
    });
    registerCenterApiRoutes({
        app,
        config,
        database,
        events,
        realtimeClients,
        memoryQueues,
        subAgents,
        isInitialized: () => initialized,
        getProcessStartedAt: () => processStartedAt,
    });

    return {
        config,
        app,
        directory,
        database,
        events,
        startupLock,
        initialize,
        listen: async () => {
            if (await isHealthyCenterServiceAlreadyListening(config)) {
                return {
                    reusedExisting: true,
                    port: config.port,
                    centerDirectory: config.centerDirectory,
                };
            }

            await initialize();
            try {
                await startupLock.acquire();
                lockAcquired = true;
                await app.listen({
                    host: "127.0.0.1",
                    port: config.port,
                });
                appListening = true;
                return {
                    reusedExisting: false,
                    port: config.port,
                    centerDirectory: config.centerDirectory,
                };
            } catch (error) {
                if (await isHealthyCenterServiceAlreadyListening(config)) {
                    if (lockAcquired) {
                        await startupLock.release();
                        lockAcquired = false;
                    }
                    return {
                        reusedExisting: true,
                        port: config.port,
                        centerDirectory: config.centerDirectory,
                    };
                }

                if (lockAcquired) {
                    await startupLock.release();
                    lockAcquired = false;
                }
                throw error;
            }
        },
        close,
    };
}

/**
 * syncBuiltinPluginsToCenterDirectory：把随包内置插件同步到中心目录 plugins。
 *
 * @param config 中心服务启动配置。
 * @returns 没有返回值。
 */
function syncBuiltinPluginsToCenterDirectory(config: CenterServiceConfig): void {
    const sourceDirectory = config.builtinPluginsDirectory;
    const targetDirectory = join(
        config.centerDirectory,
        "plugins",
    );
    if (resolve(sourceDirectory) === resolve(targetDirectory)) {
        mkdirSync(targetDirectory, {
            recursive: true,
        });
        return;
    }

    if (!existsSync(sourceDirectory)) {
        mkdirSync(targetDirectory, {
            recursive: true,
        });
        return;
    }

    mkdirSync(targetDirectory, {
        recursive: true,
    });

    for (const entry of readdirSync(sourceDirectory, {
        withFileTypes: true,
    })) {
        if (!entry.isDirectory() || !entry.name.startsWith("builtin-")) {
            continue;
        }

        const sourcePluginDirectory = join(
            sourceDirectory,
            entry.name,
        );
        const targetPluginDirectory = join(
            targetDirectory,
            entry.name,
        );
        rmSync(targetPluginDirectory, {
            force: true,
            recursive: true,
        });
        cpSync(
            sourcePluginDirectory,
            targetPluginDirectory,
            {
                recursive: true,
                filter: (sourcePath) => {
                    // node_modules: 中心目录保存插件清单和构建产物，不复制开发依赖缓存。
                    return !sourcePath.includes(`${entry.name}\\node_modules`)
                        && !sourcePath.includes(`${entry.name}/node_modules`);
                },
            },
        );
    }
}
