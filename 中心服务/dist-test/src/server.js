import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join } from "node:path";
import { ZHIXIN_APP_NAME, } from "@zhixin/shared";
import { CenterLogger } from "./logger.js";
import { createApiKeyMarker, createSecretMarker, hashSecret, WebSessionManager } from "./security.js";
// WEB_SESSION_COOKIE_NAME：Web端 Cookie 登录态名称，由中心服务统一设置和读取。
const WEB_SESSION_COOKIE_NAME = "zhixin_web_session";
// CenterHttpServer：中心服务 HTTP API，所有客户端都通过这里访问中心事实源。
export class CenterHttpServer {
    // config：中心服务运行配置。
    config;
    // storage：中心目录文件存储能力。
    storage;
    // logger：中心服务日志写入能力。
    logger;
    // routes：固定路由表，避免请求处理中散落大量分支。
    routes;
    // webSessions：Web端非本机访问登录态管理。
    webSessions;
    // lockFilePath：中心服务启动锁路径，按中心目录隔离。
    lockFilePath;
    // constructor：注入配置和存储依赖。
    constructor(config, storage) {
        // config：路由需要读取端口和版本信息。
        this.config = config;
        // storage：路由统一通过中心服务访问固化数据。
        this.storage = storage;
        // logger：日志目录来自中心目录映射。
        this.logger = new CenterLogger(this.storage.getDirectoryMap()["日志"], this.storage.getRepository());
        // webSessions：首版登录态存内存，服务重启后需要重新登录。
        this.webSessions = new WebSessionManager();
        // lockFilePath：锁文件放在中心目录根部，避免多个桌面端管理同一中心目录。
        this.lockFilePath = join(this.config.centerDirectory, ".zhixin-center.lock");
        // routes：把路径映射成处理函数，保持 API 边界清楚。
        this.routes = new Map([
            ["GET /health", this.handleHealth.bind(this)],
            ["GET /directories", this.handleDirectories.bind(this)],
            ["GET /config", this.handleConfig.bind(this)],
            ["PUT /config", this.handleUpdateConfig.bind(this)],
            ["GET /auth/status", this.handleAuthStatus.bind(this)],
            ["POST /auth/login", this.handleLogin.bind(this)],
            ["GET /providers", this.handleProviders.bind(this)],
            ["POST /providers", this.handleSaveProvider.bind(this)],
            ["DELETE /providers", this.handleDeleteProvider.bind(this)],
            ["POST /providers/refresh", this.handleRefreshProvider.bind(this)],
            ["GET /proxies", this.handleProxies.bind(this)],
            ["POST /proxies", this.handleSaveProxy.bind(this)],
            ["DELETE /proxies", this.handleDeleteProxy.bind(this)],
            ["GET /proxies/default", this.handleDefaultProxy.bind(this)],
            ["GET /runtimes", this.handleRuntimes.bind(this)],
            ["POST /runtimes", this.handleSaveRuntime.bind(this)],
            ["DELETE /runtimes", this.handleDeleteRuntime.bind(this)],
            ["GET /client-preferences", this.handleClientPreferences.bind(this)],
            ["POST /client-preferences", this.handleSaveClientPreference.bind(this)],
            ["GET /projects", this.handleProjects.bind(this)],
            ["POST /projects", this.handleRegisterProject.bind(this)],
            ["GET /sessions", this.handleSessions.bind(this)],
            ["POST /sessions", this.handleCreateSession.bind(this)],
            ["GET /messages", this.handleMessages.bind(this)],
            ["POST /messages", this.handleAppendMessage.bind(this)],
            ["GET /agents", this.handleAgents.bind(this)],
            ["POST /agents", this.handleSaveAgent.bind(this)],
            ["DELETE /agents", this.handleDeleteAgent.bind(this)],
            ["GET /tasks", this.handleTasks.bind(this)],
            ["GET /extensions", this.handleExtensions.bind(this)],
            ["GET /mcp", this.handleMcpConfig.bind(this)],
            ["POST /mcp", this.handleSaveMcpConfig.bind(this)],
            ["GET /notifications", this.handleNotifications.bind(this)],
            ["POST /attachments", this.handleUploadAttachment.bind(this)],
            ["GET /attachments", this.handleReadAttachment.bind(this)],
            ["GET /sync", this.handleRealtimeSync.bind(this)],
            ["GET /pending-messages", this.handlePendingMessages.bind(this)],
            ["POST /pending-messages", this.handleSavePendingMessage.bind(this)],
            ["GET /collaborations", this.handleCollaborations.bind(this)],
            ["POST /collaborations", this.handleSaveCollaboration.bind(this)],
            ["GET /memories", this.handleMemories.bind(this)],
            ["POST /memories", this.handleAppendMemory.bind(this)],
            ["POST /memories/user", this.handleAppendUserMemory.bind(this)],
            ["POST /runtime-selection", this.handleRuntimeSelection.bind(this)],
            ["GET /usage", this.handleUsageSummary.bind(this)],
            ["POST /usage", this.handleAppendUsage.bind(this)],
            ["POST /extensions", this.handleSaveExtension.bind(this)],
            ["DELETE /extensions", this.handleDeleteExtension.bind(this)],
            ["POST /extensions/calls", this.handleAppendExtensionCall.bind(this)],
            ["GET /extensions/calls", this.handleExtensionCalls.bind(this)],
            ["GET /plugin.html", this.handlePluginHtml.bind(this)],
        ]);
    }
    // listen：初始化中心目录并启动 HTTP 服务。
    async listen() {
        // acquireStartupLock：先拿启动锁，避免多个桌面端重复启动同一个中心目录服务。
        await this.acquireStartupLock();
        // initialize：启动前确保中心目录结构完整。
        await this.storage.initialize();
        // logger：记录中心服务启动事件。
        await this.logger.info("中心服务启动", {
            port: this.config.port,
            centerDirectory: this.config.centerDirectory,
        });
        // server：Node 原生 HTTP 服务，减少框架依赖。
        const server = createServer((request, response) => {
            // dispatch：异步路由错误统一返回 JSON 错误。
            void this.dispatch(request, response);
        });
        // listen：只监听本机，符合中心服务默认本机端口访问要求。
        server.listen(this.config.port, "127.0.0.1");
        // cleanup：进程退出时释放启动锁。
        process.once("exit", () => {
            void rm(this.lockFilePath, {
                force: true,
            });
        });
    }
    // dispatch：根据方法和路径分派请求。
    async dispatch(request, response) {
        // method：没有方法时按 GET 处理，便于健康检查。
        const method = request.method ?? "GET";
        // url：用本机基准 URL 解析 path，避免直接字符串截断 query。
        const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.config.port}`);
        // routeKey：路由表 key 同时包含方法和路径。
        const routeKey = `${method} ${url.pathname}`;
        // handler：未匹配时返回 404。
        const handler = this.routes.get(routeKey);
        // origin：浏览器跨端口开发调试时携带，中心服务需要回显才能使用 Cookie。
        const origin = request.headers.origin;
        // setHeader：所有 API 都返回 JSON，允许 Web 端本机调试访问。
        response.setHeader("content-type", url.pathname === "/plugin.html" ? "text/html; charset=utf-8" : "application/json; charset=utf-8");
        // setHeader：携带 Cookie 时不能使用通配 origin，有来源则回显来源。
        response.setHeader("access-control-allow-origin", typeof origin === "string" ? origin : "*");
        // setHeader：提示浏览器按不同来源缓存预检结果。
        response.setHeader("vary", "origin");
        // setHeader：允许 Web端通过 Cookie 携带登录态。
        response.setHeader("access-control-allow-credentials", "true");
        // setHeader：允许 Web 端提交 JSON 请求头。
        response.setHeader("access-control-allow-headers", "content-type");
        // setHeader：首版支持常用 JSON API 方法。
        response.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
        // options：浏览器预检请求直接返回。
        if (method === "OPTIONS") {
            this.writeJson(response, 204, {});
            return;
        }
        // notFound：未知 API 给出统一错误码。
        if (!handler) {
            this.writeError(response, 404, "NOT_FOUND", "接口不存在", `未找到接口：${url.pathname}`);
            return;
        }
        // unauthorized：非本机访问除公开接口外都必须带有效 Cookie，避免前端自行判定访问来源。
        if (!this.isPublicRoute(url.pathname) && !(await this.isAuthorizedRequest(request))) {
            this.writeError(response, 401, "WEB_AUTH_REQUIRED", "需要登录", "非本机 Web 访问需要先登录");
            return;
        }
        // try：路由异常统一封装，避免服务进程崩溃。
        try {
            await handler(request, response);
        }
        catch (error) {
            // message：仅返回错误摘要，详细内容进入日志目录。
            const message = error instanceof Error ? error.message : "未知错误";
            // traceId：错误响应和日志关联的排查 ID。
            const traceId = randomUUID();
            // logger：异常进入日志目录，便于排查。
            await this.logger.error("中心服务接口异常", {
                traceId,
                routeKey,
                message,
            });
            // writeError：客户端得到统一错误格式。
            this.writeError(response, 500, "INTERNAL_ERROR", message, "中心服务处理请求失败", traceId);
        }
    }
    // handleHealth：返回中心服务健康状态。
    async handleHealth(_request, response) {
        // health：客户端连接中心服务后首先读取的基础信息。
        const health = {
            appName: ZHIXIN_APP_NAME,
            version: "0.1.0",
            port: this.config.port,
            centerDirectory: this.storage.getCenterDirectory(),
            now: new Date().toISOString(),
        };
        // writeJson：HTTP 200 表示中心服务可用。
        this.writeJson(response, 200, health);
    }
    // handleDirectories：返回中心目录结构。
    async handleDirectories(_request, response) {
        // directories：供桌面端设置页和迁移功能展示。
        const directories = this.storage.getDirectoryMap();
        // writeJson：保持中文目录名作为 key，和需求文档一致。
        this.writeJson(response, 200, directories);
    }
    // handleConfig：返回中心服务本机配置。
    async handleConfig(_request, response) {
        // config：包含端口、中心目录、Web 账号和通知权限状态。
        const config = await this.storage.readLocalConfig();
        // writeJson：密码只返回摘要，不返回明文。
        this.writeJson(response, 200, config);
    }
    // handleAuthStatus：返回 Web端访问控制状态。
    async handleAuthStatus(request, response) {
        // status：本机访问判定和 Cookie 校验都在中心服务端完成，前端只消费结果。
        const status = await this.createAuthStatus(request);
        // writeJson：登录页和路由守卫都使用该状态决定跳转。
        this.writeJson(response, 200, status);
    }
    // handleUpdateConfig：保存中心服务本机配置。
    async handleUpdateConfig(request, response) {
        // body：桌面端设置页提交的本机配置。
        const body = await this.readJsonBody(request);
        // current：未传字段沿用当前配置，避免只更新单项时丢失其他配置。
        const current = await this.storage.readLocalConfig();
        // next：端口修改后需要重启生效，配置中仍先保存目标值。
        const next = {
            ...current,
            port: body.port ?? current.port,
            centerDirectory: body.centerDirectory ?? current.centerDirectory,
            webAccount: body.webAccount ?? current.webAccount,
            webPasswordHash: body.webPassword ? hashSecret(body.webPassword) : current.webPasswordHash,
            systemNotificationPermission: body.systemNotificationPermission ?? current.systemNotificationPermission,
            updatedAt: new Date().toISOString(),
        };
        // saveLocalConfig：统一由中心服务写入 config.json。
        await this.storage.saveLocalConfig(next);
        // logger：配置变化进入日志。
        await this.logger.info("中心服务本机配置已更新", {
            port: next.port,
            centerDirectory: next.centerDirectory,
            webAccountConfigured: Boolean(next.webAccount),
            passwordConfigured: Boolean(next.webPasswordHash),
        });
        // writeJson：返回最新配置，密码仍不含明文。
        this.writeJson(response, 200, next);
    }
    // handleLogin：Web端非本机访问账号密码登录。
    async handleLogin(request, response) {
        // body：登录请求包含账号和密码明文，只用于本次校验。
        const body = await this.readJsonBody(request);
        // config：账号密码由桌面端配置并保存在中心服务本机配置。
        const config = await this.storage.readLocalConfig();
        // accountMatched：账号必须和本机配置一致。
        const accountMatched = Boolean(config.webAccount) && body.account === config.webAccount;
        // passwordMatched：密码摘要必须和配置中保存的摘要一致。
        const passwordMatched = Boolean(config.webPasswordHash) && hashSecret(body.password) === config.webPasswordHash;
        // unauthorized：失败时返回可展示原因。
        if (!accountMatched || !passwordMatched) {
            this.writeError(response, 401, "LOGIN_FAILED", "账号或密码错误", "账号或密码错误");
            return;
        }
        // login：校验通过后签发登录态。
        const login = this.webSessions.issue();
        // setHeader：真实登录令牌只写入 HttpOnly Cookie，前端不能用 sessionStorage 保存。
        response.setHeader("set-cookie", this.createWebSessionCookie(request, login.token, login.maxAgeSeconds));
        // logger：记录登录成功，不记录密码。
        await this.logger.info("Web端登录成功", {
            account: body.account,
            expiresAt: login.expiresAt,
        });
        // status：登录成功后返回认证摘要，不返回 token 明文。
        const status = {
            localAccess: this.isLocalRequest(request),
            requiresLogin: false,
            authenticated: true,
            webAccountConfigured: true,
            expiresAt: login.expiresAt,
        };
        // writeJson：返回 Cookie 登录态摘要。
        this.writeJson(response, 200, status);
    }
    // handleProviders：返回供应商配置列表。
    async handleProviders(_request, response) {
        // providers：API Key 不会以明文出现在该响应中。
        const providers = await this.storage.readProviders();
        // writeJson：桌面端和 Web端共用这份结构。
        this.writeJson(response, 200, providers);
    }
    // handleSaveProvider：新增或修改供应商配置。
    async handleSaveProvider(request, response) {
        // body：供应商配置写入请求，API Key 只在本次请求中出现。
        const body = await this.readJsonBody(request);
        // providers：读取现有供应商列表。
        const providers = await this.storage.readProviders();
        // now：更新时间使用 ISO 8601。
        const now = new Date().toISOString();
        // existing：修改时按 id 查找已有配置。
        const existing = body.id ? providers.find((provider) => provider.id === body.id) : undefined;
        // saved：客户端可见配置不包含 API Key 明文。
        const initial = {
            id: existing?.id ?? randomUUID(),
            name: body.name,
            type: body.type,
            baseUrl: body.baseUrl,
            apiKeyStored: Boolean(body.apiKey) || Boolean(existing?.apiKeyStored),
            models: body.models,
            defaultModel: body.defaultModel,
            reasoningDepths: body.reasoningDepths,
            defaultReasoningDepth: body.defaultReasoningDepth,
            supportsImageInput: body.supportsImageInput ?? existing?.supportsImageInput ?? false,
            enabled: body.enabled,
            proxyMode: body.proxyMode,
            proxyId: body.proxyId,
            lastRefreshError: existing?.lastRefreshError,
            updatedAt: now,
        };
        // saved：创建或修改后自动执行刷新逻辑；未配置接口时保留手动模型并记录失败原因。
        const saved = await this.refreshProviderCapabilities(initial);
        // marker：当前骨架保存摘要标记，不把明文回传给任何客户端。
        if (body.apiKey) {
            await this.storage.getRepository().writeText(this.providerSecretPath(saved.id), `${createApiKeyMarker(body.apiKey)}\n`, "config-write");
        }
        // next：替换已有供应商或追加新供应商。
        const nextProviders = await this.applyEnabledProviderDefaults(existing
            ? providers.map((provider) => (provider.id === saved.id ? saved : provider))
            : [...providers, saved]);
        // saveProviders：由中心服务统一持久化。
        await this.storage.saveProviders(nextProviders.providers);
        // saveAgents：供应商默认变化只影响后续智能体选择，不回改历史会话或任务。
        if (nextProviders.agents) {
            await this.storage.saveAgents(nextProviders.agents);
        }
        // logger：记录供应商配置变化，不记录 API Key。
        await this.logger.info("供应商配置已保存", {
            providerId: saved.id,
            name: saved.name,
            apiKeyStored: saved.apiKeyStored,
        });
        // writeJson：返回保存后的可见配置。
        this.writeJson(response, 200, saved);
    }
    // handleDeleteProvider：删除供应商配置。
    async handleDeleteProvider(request, response) {
        // id：DELETE 请求通过 query 传入供应商 ID。
        const id = this.getQueryParam(request, "id");
        // providers：过滤掉目标供应商。
        const providers = await this.storage.readProviders();
        // next：删除只影响后续选择，历史记录不回改。
        const next = providers.filter((provider) => provider.id !== id);
        // saveProviders：保存新列表。
        const normalized = await this.applyEnabledProviderDefaults(next);
        await this.storage.saveProviders(normalized.providers);
        if (normalized.agents) {
            await this.storage.saveAgents(normalized.agents);
        }
        // logger：记录删除事件。
        await this.logger.info("供应商配置已删除", {
            providerId: id,
        });
        // writeJson：返回剩余列表。
        this.writeJson(response, 200, next);
    }
    // handleProxies：返回网络代理配置列表。
    async handleProxies(_request, response) {
        // proxies：用户名和密码明文不会出现在该响应中。
        const proxies = await this.storage.readProxies();
        // writeJson：桌面端和 Web端共用这份结构。
        this.writeJson(response, 200, proxies);
    }
    // handleSaveProxy：新增或修改网络代理配置。
    async handleSaveProxy(request, response) {
        // body：代理配置写入请求，用户名和密码允许为空。
        const body = await this.readJsonBody(request);
        // proxies：读取现有代理配置。
        const proxies = await this.storage.readProxies();
        // existing：修改时按 id 查找已有代理。
        const existing = body.id ? proxies.find((proxy) => proxy.id === body.id) : undefined;
        // saved：客户端可见配置不包含用户名和密码明文。
        const saved = {
            id: existing?.id ?? randomUUID(),
            name: body.name,
            protocol: body.protocol,
            host: body.host,
            port: body.port,
            usernameStored: body.username !== "" || Boolean(existing?.usernameStored),
            passwordStored: body.password !== "" || Boolean(existing?.passwordStored),
            enabled: body.enabled,
            default: body.default,
            remark: body.remark,
            lastError: existing?.lastError,
            updatedAt: new Date().toISOString(),
        };
        // secret：空用户名和空密码是合法无认证配置，也写入空摘要标记以表达“无认证”。
        await this.storage.getRepository().writeText(this.proxySecretPath(saved.id), JSON.stringify({
            username: createSecretMarker(body.username),
            password: createSecretMarker(body.password),
        }, null, 2) + "\n", "config-write");
        // normalized：全局默认代理只能有一个，避免供应商 global 策略歧义。
        const normalized = proxies.map((proxy) => {
            if (proxy.id === saved.id) {
                return saved;
            }
            if (saved.default) {
                return {
                    ...proxy,
                    default: false,
                };
            }
            return proxy;
        });
        // next：新增时追加。
        const next = existing ? normalized : [...normalized, saved];
        // saveProxies：由中心服务统一持久化。
        await this.storage.saveProxies(next);
        // logger：记录代理配置变化，不记录用户名和密码。
        await this.logger.info("网络代理配置已保存", {
            proxyId: saved.id,
            name: saved.name,
            protocol: saved.protocol,
            host: saved.host,
            port: saved.port,
            default: saved.default,
        });
        // writeJson：返回保存后的可见配置。
        this.writeJson(response, 200, saved);
    }
    // handleDeleteProxy：删除网络代理配置。
    async handleDeleteProxy(request, response) {
        // id：DELETE 请求通过 query 传入代理 ID。
        const id = this.getQueryParam(request, "id");
        // proxies：过滤掉目标代理。
        const proxies = await this.storage.readProxies();
        // next：删除只影响后续供应商访问，不回改历史记录。
        const next = proxies.filter((proxy) => proxy.id !== id);
        // saveProxies：保存剩余代理。
        await this.storage.saveProxies(next);
        // logger：记录删除事件。
        await this.logger.info("网络代理配置已删除", {
            proxyId: id,
        });
        // writeJson：返回剩余列表。
        this.writeJson(response, 200, next);
    }
    // handleDefaultProxy：返回全局默认代理配置。
    async handleDefaultProxy(_request, response) {
        // proxies：全局默认代理从启用且 default 为 true 的配置中选择。
        const proxies = await this.storage.readProxies();
        // defaultProxy：没有默认代理时返回 null，让供应商 global 策略能明确提示未配置。
        const defaultProxy = proxies.find((proxy) => proxy.enabled && proxy.default) ?? null;
        // writeJson：返回默认代理或 null。
        this.writeJson(response, 200, defaultProxy);
    }
    // handleRefreshProvider：刷新供应商模型和推理深度列表的占位入口。
    async handleRefreshProvider(request, response) {
        // id：按供应商 ID 刷新。
        const id = this.getQueryParam(request, "id");
        // providers：当前骨架未接入各供应商真实模型接口。
        const providers = await this.storage.readProviders();
        // next：按供应商类型自动刷新模型和推理深度，失败时保存可展示原因。
        const next = await Promise.all(providers.map(async (provider) => {
            if (provider.id !== id) {
                return provider;
            }
            return this.refreshProviderCapabilities(provider);
        }));
        // saveProviders：失败原因同样持久化。
        await this.storage.saveProviders(next);
        // writeJson：返回更新后的供应商列表。
        this.writeJson(response, 200, next);
    }
    // handleRuntimes：返回运行环境配置列表。
    async handleRuntimes(_request, response) {
        // runtimes：包含 Node.js、Python、Java、Maven、Git 模板。
        const runtimes = await this.storage.readRuntimes();
        // writeJson：用于 UI 管理运行环境。
        this.writeJson(response, 200, runtimes);
    }
    // handleSaveRuntime：新增或修改运行环境配置。
    async handleSaveRuntime(request, response) {
        // body：运行环境配置请求。
        const body = await this.readJsonBody(request);
        // runtimes：读取现有运行环境配置。
        const runtimes = await this.storage.readRuntimes();
        // existing：修改时按 id 匹配。
        const existing = body.id ? runtimes.find((runtime) => runtime.id === body.id) : undefined;
        // saved：中心服务使用的运行环境结构。
        const saved = {
            id: existing?.id ?? randomUUID(),
            name: body.name,
            type: body.type,
            executablePath: body.executablePath,
            rootPath: body.rootPath,
            version: body.version,
            env: body.env,
            pathEntries: body.pathEntries,
            default: body.default,
            enabled: body.enabled,
            remark: body.remark,
        };
        // normalized：同类型默认环境只能有一个，避免任务选择歧义。
        const normalized = runtimes.map((runtime) => {
            if (runtime.id === saved.id) {
                return saved;
            }
            if (saved.default && runtime.type === saved.type) {
                return {
                    ...runtime,
                    default: false,
                };
            }
            return runtime;
        });
        // next：新增时追加。
        const next = existing ? normalized : [...normalized, saved];
        // saveRuntimes：保存运行环境配置。
        await this.storage.saveRuntimes(next);
        // writeJson：返回保存后的环境。
        this.writeJson(response, 200, saved);
    }
    // handleDeleteRuntime：删除运行环境配置。
    async handleDeleteRuntime(request, response) {
        // id：运行环境 ID 来自 query。
        const id = this.getQueryParam(request, "id");
        // runtimes：过滤目标环境。
        const runtimes = await this.storage.readRuntimes();
        // next：删除只影响后续任务，不回改历史任务快照。
        const next = runtimes.filter((runtime) => runtime.id !== id);
        // saveRuntimes：保存剩余环境。
        await this.storage.saveRuntimes(next);
        // writeJson：返回剩余列表。
        this.writeJson(response, 200, next);
    }
    // handleClientPreferences：读取客户端执行模式和通知配置。
    async handleClientPreferences(_request, response) {
        // preferences：按 desktop、web、idea 分别保存。
        const preferences = await this.storage.readClientPreferences();
        // writeJson：不同客户端类型之间不强制同步。
        this.writeJson(response, 200, preferences);
    }
    // handleSaveClientPreference：保存单个客户端类型偏好。
    async handleSaveClientPreference(request, response) {
        // body：单个客户端类型偏好配置。
        const body = await this.readJsonBody(request);
        // preferences：读取现有偏好。
        const preferences = await this.storage.readClientPreferences();
        // next：按 clientType 替换。
        const next = preferences.map((preference) => (preference.clientType === body.clientType ? body : preference));
        // saveClientPreferences：保存新偏好。
        await this.storage.saveClientPreferences(next);
        // writeJson：返回完整偏好列表。
        this.writeJson(response, 200, next);
    }
    // handleProjects：读取项目列表。
    async handleProjects(_request, response) {
        // projects：中心服务登记的项目 ID、显示名、路径和别名。
        const projects = await this.storage.readProjects();
        // writeJson：供桌面端、Web端和 IDEA 插件展示。
        this.writeJson(response, 200, projects);
    }
    // handleRegisterProject：登记或更新项目身份。
    async handleRegisterProject(request, response) {
        // body：IDE 插件或 UI 端上报的项目身份。
        const body = await this.readJsonBody(request);
        // projects：读取现有项目。
        const projects = await this.storage.readProjects();
        // nextProject：项目文件夹名变化时 displayName 可跟随更新，alias 保留用户设置。
        const nextProject = {
            ...body,
            lastSeenAt: new Date().toISOString(),
        };
        // existing：按项目 UUID 匹配，而不是按路径。
        const existing = projects.find((project) => project.projectId === body.projectId);
        // next：替换或追加项目。
        const next = existing
            ? projects.map((project) => (project.projectId === body.projectId ? nextProject : project))
            : [...projects, nextProject];
        // saveProjects：项目归属于会话目录。
        await this.storage.saveProjects(next);
        // writeJson：返回登记后的项目。
        this.writeJson(response, 200, nextProject);
    }
    // handleSessions：读取会话列表。
    async handleSessions(request, response) {
        // sessions：普通会话、项目会话和团队智能体会话。
        const sessions = await this.storage.readSessions();
        // projectId：IDEA 插件传入当前项目 ID 时只返回该项目会话。
        const projectId = this.getOptionalQueryParam(request, "projectId");
        // visibleSessions：有项目筛选时不展示其他项目数据。
        const visibleSessions = projectId ? sessions.filter((session) => session.projectId === projectId) : sessions;
        // writeJson：客户端按类型和项目分组展示。
        this.writeJson(response, 200, visibleSessions);
    }
    // handleCreateSession：创建会话。
    async handleCreateSession(request, response) {
        // body：会话创建请求，允许客户端指定类型、项目和标题。
        const body = await this.readJsonBody(request);
        // now：会话创建与更新时间。
        const now = new Date().toISOString();
        // session：默认主智能体处理，普通会话标题可后续修改。
        const defaultAgent = await this.resolveDefaultAgent(body.agentId);
        const session = {
            id: body.id ?? randomUUID(),
            type: body.type ?? "normal",
            title: body.title ?? "新的对话",
            projectId: body.projectId,
            agentId: defaultAgent.id,
            clientType: body.clientType ?? "desktop",
            status: "idle",
            createdAt: now,
            updatedAt: now,
        };
        // sessions：追加新会话。
        const sessions = await this.storage.readSessions();
        // saveSessions：中心服务统一持久化。
        await this.storage.saveSessions([...sessions, session]);
        // writeJson：返回创建结果。
        this.writeJson(response, 200, session);
    }
    // handleMessages：读取指定会话消息。
    async handleMessages(request, response) {
        // sessionId：会话 ID 来自 query。
        const sessionId = this.getQueryParam(request, "sessionId");
        // messages：读取该会话消息。
        const messages = await this.storage.readMessages(sessionId);
        // writeJson：返回消息列表。
        this.writeJson(response, 200, messages);
    }
    // handleAppendMessage：追加会话消息。
    async handleAppendMessage(request, response) {
        // body：消息内容、附件和上下文引用。
        const body = await this.readJsonBody(request);
        // message：补齐中心服务统一字段。
        const message = {
            id: body.id ?? randomUUID(),
            sessionId: body.sessionId,
            role: body.role ?? "user",
            content: body.content ?? "",
            attachments: body.attachments ?? [],
            references: body.references ?? [],
            createdAt: body.createdAt ?? new Date().toISOString(),
        };
        // messages：追加到指定会话消息文件。
        const messages = await this.storage.readMessages(body.sessionId);
        // saveMessages：保存消息。
        await this.storage.saveMessages(body.sessionId, [...messages, message]);
        // sessions：已发送到中心服务的消息由中心服务继续维护会话状态。
        const sessions = await this.storage.readSessions();
        // nextSessions：更新会话时间和状态，不处理未成功发送的本地排队消息。
        const nextSessions = sessions.map((session) => (session.id === body.sessionId
            ? {
                ...session,
                status: message.role === "user" ? "working" : session.status,
                updatedAt: message.createdAt,
            }
            : session));
        // saveSessions：写回会话索引。
        await this.storage.saveSessions(nextSessions);
        // writeJson：返回本次追加消息。
        this.writeJson(response, 200, message);
    }
    // handleAgents：读取智能体定义。
    async handleAgents(_request, response) {
        // agents：主智能体、团队智能体和子智能体结构化定义。
        const agents = await this.storage.readAgents();
        // writeJson：供 UI 展示状态和管理入口。
        this.writeJson(response, 200, agents);
    }
    // handleSaveAgent：新增或修改团队智能体。
    async handleSaveAgent(request, response) {
        // body：智能体定义。
        const body = await this.readJsonBody(request);
        // agents：读取现有智能体。
        const agents = await this.storage.readAgents();
        // existing：按 ID 匹配已有定义。
        const existing = body.id ? agents.find((agent) => agent.id === body.id) : undefined;
        // agent：主智能体不可通过该接口变成可删除。
        const agent = {
            id: existing?.id ?? randomUUID(),
            name: body.name ?? "团队智能体",
            kind: body.kind ?? "team",
            status: body.status ?? "idle",
            providerId: body.providerId,
            model: body.model,
            reasoningDepth: body.reasoningDepth,
            removable: body.kind === "primary" ? false : body.removable ?? true,
            description: body.description ?? "",
            updatedAt: new Date().toISOString(),
        };
        // next：替换或追加智能体。
        const next = existing ? agents.map((item) => (item.id === agent.id ? agent : item)) : [...agents, agent];
        // saveAgents：保存结构化定义。
        await this.storage.saveAgents(next);
        // persistAgentMarkdown：团队智能体使用 Markdown 固化定义，便于迁移和人工审查。
        await this.persistAgentMarkdown(agent);
        // writeJson：返回保存结果。
        this.writeJson(response, 200, agent);
    }
    // handleDeleteAgent：删除团队智能体。
    async handleDeleteAgent(request, response) {
        // id：智能体 ID 来自 query。
        const id = this.getQueryParam(request, "id");
        // agents：读取现有智能体。
        const agents = await this.storage.readAgents();
        // target：主智能体不可删除。
        const target = agents.find((agent) => agent.id === id);
        // forbidden：不可删除时返回明确错误。
        if (!target?.removable) {
            this.writeError(response, 400, "AGENT_NOT_REMOVABLE", "智能体不可删除", "主智能体不可删除");
            return;
        }
        // next：移除团队智能体，历史会话内容保留在会话记录中。
        const next = agents.filter((agent) => agent.id !== id);
        // saveAgents：保存剩余智能体。
        await this.storage.saveAgents(next);
        // writeJson：返回剩余列表。
        this.writeJson(response, 200, next);
    }
    // handleTasks：读取任务记录。
    async handleTasks(_request, response) {
        // tasks：包含任务状态和运行环境快照。
        const tasks = await this.storage.readTasks();
        // writeJson：供多端同步任务状态。
        this.writeJson(response, 200, tasks);
    }
    // handleExtensions：读取扩展能力清单。
    async handleExtensions(_request, response) {
        // extensions：插件、MCP 和 skill 的统一索引，项目级能力会按项目优先合并。
        const extensions = await this.readExtensionsWithProjectScope();
        // writeJson：项目级与全局级优先级由后续服务层按 scope/projectId 处理。
        this.writeJson(response, 200, extensions);
    }
    // handleMcpConfig：读取全局 MCP 配置。
    async handleMcpConfig(request, response) {
        // config：根字段固定为 mcpServers。
        const config = await this.storage.readMcpConfig();
        // projectId：IDEA 插件项目聊天只能读取当前项目允许的 MCP 能力。
        const projectId = this.getOptionalQueryParam(request, "projectId");
        // projectConfig：有项目 ID 时合并项目级 .agents/mcp 配置，项目级同名优先。
        const projectConfig = projectId ? await this.readProjectMcpConfig(projectId) : {
            mcpServers: {},
        };
        // merged：项目级同名 MCP 覆盖全局。
        const merged = {
            mcpServers: {
                ...config.mcpServers,
                ...projectConfig.mcpServers,
            },
        };
        // writeJson：支持 HTTP 与 stdio 配置结构。
        this.writeJson(response, 200, merged);
    }
    // handleSaveMcpConfig：保存全局 MCP 配置。
    async handleSaveMcpConfig(request, response) {
        // body：MCP 配置文件结构。
        const body = await this.readJsonBody(request);
        // saveMcpConfig：中心服务统一写入 MCP 目录。
        await this.storage.saveMcpConfig(body);
        // writeJson：返回保存后的配置。
        this.writeJson(response, 200, body);
    }
    // handleNotifications：读取通知事件。
    async handleNotifications(_request, response) {
        // events：中心服务生成并同步的通知事件。
        const events = await this.storage.readNotifications();
        // writeJson：客户端用于未读状态和跳转定位。
        this.writeJson(response, 200, events);
    }
    // handleUploadAttachment：保存会话附件原始文件。
    async handleUploadAttachment(request, response) {
        // body：图片附件通过 base64 提交，由中心服务写入会话附件目录。
        const body = await this.readJsonBody(request);
        // attachment：返回中心服务生成的附件记录。
        const attachment = await this.storage.saveAttachment(body);
        // writeJson：客户端把附件记录加入待发送消息。
        this.writeJson(response, 200, attachment);
    }
    // handleReadAttachment：受控读取本地附件图片。
    async handleReadAttachment(request, response) {
        // id：附件 ID 来自 query，不允许前端传任意文件路径。
        const id = this.getQueryParam(request, "id");
        // content：中心服务根据消息附件索引定位文件。
        const content = await this.storage.readAttachmentContent(id);
        // missing：没有找到附件时返回统一错误。
        if (!content) {
            this.writeError(response, 404, "ATTACHMENT_NOT_FOUND", "附件不存在", "附件不存在或未进入会话记录");
            return;
        }
        // content-type：附件读取接口返回二进制，不使用 JSON。
        response.setHeader("content-type", "application/octet-stream");
        // end：写出附件原始内容。
        response.end(content);
    }
    // handleRealtimeSync：返回多端实时同步快照。
    async handleRealtimeSync(_request, response) {
        // snapshot：首版使用轮询快照，覆盖项目、聊天、消息状态、智能体、任务、供应商和扩展能力。
        const snapshot = {
            projects: await this.storage.readProjects(),
            sessions: await this.storage.readSessions(),
            agents: await this.storage.readAgents(),
            tasks: await this.storage.readTasks(),
            providers: await this.storage.readProviders(),
            extensions: await this.readExtensionsWithProjectScope(),
            notifications: await this.storage.readNotifications(),
            pendingMessages: await this.storage.readPendingMessages(),
            syncedAt: new Date().toISOString(),
        };
        // writeJson：客户端可按固定间隔同步业务状态，本地 UI 状态不包含在内。
        this.writeJson(response, 200, snapshot);
    }
    // handlePendingMessages：读取待用户确认的本地排队消息。
    async handlePendingMessages(_request, response) {
        // messages：恢复连接后客户端展示这些消息，不自动发送。
        const messages = await this.storage.readPendingMessages();
        // writeJson：返回排队消息。
        this.writeJson(response, 200, messages);
    }
    // handleSavePendingMessage：保存未成功发送的本地排队消息。
    async handleSavePendingMessage(request, response) {
        // body：客户端断线时保存的待确认消息。
        const body = await this.readJsonBody(request);
        // messages：读取已有排队消息。
        const messages = await this.storage.readPendingMessages();
        // message：状态固定为待用户确认，避免恢复连接后静默发送。
        const message = {
            id: body.id ?? randomUUID(),
            clientType: body.clientType ?? "desktop",
            sessionId: body.sessionId,
            content: body.content,
            attachments: body.attachments ?? [],
            references: body.references ?? [],
            status: "waiting-user-confirmation",
            createdAt: body.createdAt ?? new Date().toISOString(),
        };
        // savePendingMessages：写入中心服务会话状态。
        await this.storage.savePendingMessages([...messages, message]);
        // writeJson：返回本次保存结果。
        this.writeJson(response, 200, message);
    }
    // handleCollaborations：读取智能体协作记录。
    async handleCollaborations(_request, response) {
        // records：包含管线通话和群聊讨论状态。
        const records = await this.storage.readCollaborations();
        // writeJson：UI 展示参与智能体、消息流向和最终结果。
        this.writeJson(response, 200, records);
    }
    // handleSaveCollaboration：保存智能体协作记录。
    async handleSaveCollaboration(request, response) {
        // body：协作记录请求。
        const body = await this.readJsonBody(request);
        // records：读取已有协作。
        const records = await this.storage.readCollaborations();
        // now：创建和更新时间。
        const now = new Date().toISOString();
        // record：管线或群聊协作记录。
        const record = {
            id: body.id ?? randomUUID(),
            type: body.type ?? "pipeline",
            sessionId: body.sessionId,
            participantAgentIds: body.participantAgentIds ?? [],
            status: body.status ?? "queued",
            summary: body.summary ?? "",
            createdAt: body.createdAt ?? now,
            updatedAt: now,
        };
        // next：替换或追加协作记录。
        const next = records.some((item) => item.id === record.id)
            ? records.map((item) => (item.id === record.id ? record : item))
            : [...records, record];
        // saveCollaborations：保存协作记录。
        await this.storage.saveCollaborations(next);
        // writeJson：返回本次记录。
        this.writeJson(response, 200, record);
    }
    // handleMemories：快速查看记忆内容。
    async handleMemories(_request, response) {
        // memories：记忆读取可以并发执行。
        const memories = await this.storage.readMemories();
        // writeJson：UI 展示 Markdown 内容。
        this.writeJson(response, 200, memories);
    }
    // handleAppendMemory：按一轮完整对话追加永久记忆。
    async handleAppendMemory(request, response) {
        // body：调用方必须提交完整一轮对话摘要，中心服务不把工具调用拆成多段记忆。
        const body = await this.readJsonBody(request);
        // appendMemory：按智能体和日期追加写入。
        await this.storage.appendMemory(body);
        // writeJson：返回写入摘要。
        this.writeJson(response, 200, {
            saved: true,
        });
    }
    // handleAppendUserMemory：追加用户记忆。
    async handleAppendUserMemory(request, response) {
        // body：用户记忆文本。
        const body = await this.readJsonBody(request);
        // appendUserMemory：用户记忆保存在“记忆/user.md”。
        await this.storage.appendUserMemory(body.content);
        // writeJson：返回写入摘要。
        this.writeJson(response, 200, {
            saved: true,
        });
    }
    // handleRuntimeSelection：为任务选择运行环境并返回快照。
    async handleRuntimeSelection(request, response) {
        // body：运行环境类型和可选 ID。
        const body = await this.readJsonBody(request);
        // selection：未指定时使用同类型默认启用环境。
        const selection = await this.storage.resolveRuntimeSelection(body.runtimeType, body.runtimeId);
        // writeJson：任务记录可保存 runtime 快照。
        this.writeJson(response, 200, selection);
    }
    // handleUsageSummary：读取模型调用用量聚合。
    async handleUsageSummary(request, response) {
        // filters：筛选字段全部来自 query，普通非项目会话 projectId 为空。
        const filters = {
            providerId: this.getOptionalQueryParam(request, "providerId"),
            model: this.getOptionalQueryParam(request, "model"),
            projectId: this.getOptionalQueryParam(request, "projectId"),
            startAt: this.getOptionalQueryParam(request, "startAt"),
            endAt: this.getOptionalQueryParam(request, "endAt"),
        };
        // summary：按供应商、模型、项目和时间范围聚合。
        const summary = await this.storage.summarizeUsage(filters);
        // writeJson：返回聚合统计。
        this.writeJson(response, 200, summary);
    }
    // handleAppendUsage：追加模型调用用量记录。
    async handleAppendUsage(request, response) {
        // body：用量记录必须携带调用时供应商、模型和项目快照。
        const body = await this.readJsonBody(request);
        // record：补齐 ID，不回改历史记录。
        const record = {
            ...body,
            id: body.id || randomUUID(),
        };
        // appendUsageRecord：追加保存。
        await this.storage.appendUsageRecord(record);
        // writeJson：返回本次记录。
        this.writeJson(response, 200, record);
    }
    // handleSaveExtension：安装或更新扩展能力。
    async handleSaveExtension(request, response) {
        // body：插件、MCP 或 skill 清单。
        const body = await this.readJsonBody(request);
        // extensions：读取已有扩展索引。
        const extensions = await this.storage.readExtensions();
        // existing：按 ID 修改已有扩展。
        const existing = body.id ? extensions.find((extension) => extension.id === body.id) : undefined;
        // extension：权限必须显式声明，默认空权限表示不申请敏感能力。
        const extension = {
            id: existing?.id ?? randomUUID(),
            type: body.type,
            scope: body.scope ?? "global",
            projectId: body.projectId,
            name: body.name,
            version: body.version ?? "0.1.0",
            entry: body.entry ?? "",
            capabilities: body.capabilities ?? [],
            permissions: body.permissions ?? [],
            enabled: body.enabled ?? true,
            description: body.description ?? "",
            callRecords: existing?.callRecords ?? [],
            updatedAt: new Date().toISOString(),
        };
        // next：替换或追加扩展。
        const next = existing
            ? extensions.map((item) => (item.id === extension.id ? extension : item))
            : [...extensions, extension];
        // saveExtensions：扩展不能绕过中心服务，统一写入索引。
        await this.storage.saveExtensions(next);
        // writeJson：返回保存结果。
        this.writeJson(response, 200, extension);
    }
    // handleDeleteExtension：删除扩展能力。
    async handleDeleteExtension(request, response) {
        // id：扩展 ID 来自 query。
        const id = this.getQueryParam(request, "id");
        // extensions：读取索引。
        const extensions = await this.storage.readExtensions();
        // next：删除只移除中心服务索引，不删除项目目录文件。
        const next = extensions.filter((extension) => extension.id !== id);
        // saveExtensions：保存剩余扩展。
        await this.storage.saveExtensions(next);
        // writeJson：返回剩余列表。
        this.writeJson(response, 200, next);
    }
    // handleAppendExtensionCall：追加扩展能力调用记录。
    async handleAppendExtensionCall(request, response) {
        // body：调用记录。
        const body = await this.readJsonBody(request);
        // record：补齐 ID 和时间。
        const record = {
            ...body,
            id: body.id || randomUUID(),
            calledAt: body.calledAt || new Date().toISOString(),
        };
        // appendExtensionCall：调用记录进入审计文件。
        await this.storage.appendExtensionCall(record);
        // writeJson：返回记录。
        this.writeJson(response, 200, record);
    }
    // handleExtensionCalls：读取扩展能力调用记录。
    async handleExtensionCalls(_request, response) {
        // calls：插件、MCP 和 skill 调用审计。
        const calls = await this.storage.readExtensionCalls();
        // writeJson：返回审计记录。
        this.writeJson(response, 200, calls);
    }
    // handlePluginHtml：提供多 IDE WebView 共用插件页面入口。
    async handlePluginHtml(_request, response) {
        // html：插件页面基座，具体 IDE 能力通过宿主桥接对象提供。
        const html = [
            "<!doctype html>",
            "<html lang=\"zh-CN\">",
            "<head>",
            "<meta charset=\"UTF-8\" />",
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
            "<title>致心智能体插件</title>",
            "</head>",
            "<body>",
            "<main id=\"app\">致心智能体插件页面已连接中心服务。</main>",
            "</body>",
            "</html>",
        ].join("");
        // end：返回 HTML 字符串。
        response.end(html);
    }
    // readJsonBody：读取并解析 JSON 请求体。
    async readJsonBody(request) {
        // chunks：请求体分片缓冲。
        const chunks = [];
        // await：逐块读取请求体，避免依赖额外框架。
        for await (const chunk of request) {
            // Buffer.from：chunk 可能是字符串或 Buffer，统一转换。
            chunks.push(Buffer.from(chunk));
        }
        // content：空请求体按空对象处理。
        const content = Buffer.concat(chunks).toString("utf-8");
        // parse：调用方通过泛型获得明确结构。
        return (content ? JSON.parse(content) : {});
    }
    // getQueryParam：读取 query 参数。
    getQueryParam(request, name) {
        // url：用本机基准 URL 解析 query。
        const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.config.port}`);
        // value：缺失时返回空字符串，调用方可决定是否报错。
        return url.searchParams.get(name) ?? "";
    }
    // getOptionalQueryParam：读取可选 query 参数，空字符串按未提供处理。
    getOptionalQueryParam(request, name) {
        // value：复用固定 query 解析。
        const value = this.getQueryParam(request, name);
        // return：空字符串表示未筛选。
        return value === "" ? undefined : value;
    }
    // isPublicRoute：判断无需 Cookie 的公开接口。
    isPublicRoute(pathname) {
        // publicRoutes：健康检查、登录状态和登录接口必须在未登录时可访问。
        const publicRoutes = new Set([
            "/health",
            "/auth/status",
            "/auth/login",
            "/plugin.html",
        ]);
        // has：公开路由之外的接口统一走服务端访问控制。
        return publicRoutes.has(pathname);
    }
    // isAuthorizedRequest：判断请求是否具备访问中心服务 API 的权限。
    async isAuthorizedRequest(request) {
        // local：本机访问直接授权，非本机必须走 Cookie 登录态。
        if (this.isLocalRequest(request)) {
            return true;
        }
        // token：从 Cookie 中读取中心服务签发的登录态。
        const token = this.readCookie(request, WEB_SESSION_COOKIE_NAME);
        // missing：没有 Cookie 时未授权。
        if (!token) {
            return false;
        }
        // verify：登录态校验由中心服务内存会话管理器完成。
        return this.webSessions.verify(token).valid;
    }
    // createAuthStatus：构建 Web端认证状态响应。
    async createAuthStatus(request) {
        // config：用于判断桌面端是否已经配置 Web 访问账号。
        const config = await this.storage.readLocalConfig();
        // localAccess：只能根据连接来源判断，前端 hostname 不参与授权。
        const localAccess = this.isLocalRequest(request);
        // token：非本机访问时尝试读取 Cookie 登录态。
        const token = this.readCookie(request, WEB_SESSION_COOKIE_NAME);
        // validation：本机访问不需要 Cookie；非本机访问时校验 Cookie。
        const validation = token ? this.webSessions.verify(token) : { valid: false };
        // authenticated：本机访问或 Cookie 有效都视为已授权。
        const authenticated = localAccess || validation.valid;
        // status：统一返回路由守卫需要的全部状态。
        return {
            localAccess,
            requiresLogin: !authenticated,
            authenticated,
            webAccountConfigured: Boolean(config.webAccount && config.webPasswordHash),
            expiresAt: validation.expiresAt,
        };
    }
    // isLocalRequest：根据连接来源判断是否本机访问。
    isLocalRequest(request) {
        // remoteAddress：Node 从 TCP 连接读取的真实远端地址，比前端 hostname 更可靠。
        const remoteAddress = request.socket.remoteAddress ?? "";
        // normalized：IPv6 映射 IPv4 地址统一转成 IPv4，便于比较。
        const normalized = remoteAddress.startsWith("::ffff:")
            ? remoteAddress.slice("::ffff:".length)
            : remoteAddress;
        // return：只把 loopback 地址视为本机访问。
        return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
    }
    // readCookie：从 Cookie 请求头读取指定名称的值。
    readCookie(request, name) {
        // header：浏览器会把 HttpOnly Cookie 放在 cookie 请求头中。
        const header = request.headers.cookie;
        // missing：没有 Cookie 请求头时返回空字符串。
        if (!header) {
            return "";
        }
        // cookies：按分号拆分 Cookie 对，避免猜测其他认证字段。
        const cookies = header.split(";").map((item) => item.trim());
        // pair：按明确 Cookie 名称查找中心服务登录态。
        const pair = cookies.find((item) => item.startsWith(`${name}=`));
        // value：Cookie 值使用 decodeURIComponent 还原。
        return pair ? decodeURIComponent(pair.slice(name.length + 1)) : "";
    }
    // createWebSessionCookie：生成 Web 登录态 Set-Cookie 响应头。
    createWebSessionCookie(request, token, maxAgeSeconds) {
        // origin：HTTPS 访问时 Cookie 增加 Secure，HTTP 本机开发则不加，避免浏览器拒收。
        const origin = request.headers.origin;
        // forwardedProto：反向代理场景下由代理传入的原始协议。
        const forwardedProto = request.headers["x-forwarded-proto"];
        // secure：需求要求按访问方式配置 Secure，首版根据请求来源协议判断。
        const secure = (typeof origin === "string" && origin.startsWith("https://")) || forwardedProto === "https";
        // parts：Cookie 固定使用 HttpOnly 和 SameSite=Lax，避免前端脚本读取登录令牌。
        const parts = [
            `${WEB_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
            "HttpOnly",
            "SameSite=Lax",
            "Path=/",
            `Max-Age=${maxAgeSeconds}`,
        ];
        // push：HTTPS 场景增加 Secure 属性。
        if (secure) {
            parts.push("Secure");
        }
        // join：Node set-cookie 头需要单条字符串。
        return parts.join("; ");
    }
    // providerSecretPath：返回供应商 API Key 摘要标记文件路径。
    providerSecretPath(providerId) {
        // directories：敏感标记保存在供应商目录，客户端不直接读取。
        const directories = this.storage.getDirectoryMap();
        // path：每个供应商独立 secret 文件，便于删除和迁移。
        return `${directories["供应商"]}/${providerId}.secret`;
    }
    // proxySecretPath：返回代理认证摘要标记文件路径。
    proxySecretPath(proxyId) {
        // directories：敏感标记保存在供应商目录，客户端不直接读取。
        const directories = this.storage.getDirectoryMap();
        // path：每个代理独立 secret 文件，便于删除和迁移。
        return `${directories["供应商"]}/${proxyId}.proxy-secret`;
    }
    // acquireStartupLock：创建中心目录启动锁。
    async acquireStartupLock() {
        // mkdir：确保中心目录存在后再创建锁。
        await mkdir(this.config.centerDirectory, {
            recursive: true,
        });
        try {
            // handle：wx 表示仅当文件不存在时创建，避免两个进程同时启动。
            const handle = await open(this.lockFilePath, "wx");
            // writeFile：写入当前进程信息，方便排查重复启动。
            await handle.writeFile(JSON.stringify({
                pid: process.pid,
                port: this.config.port,
                startedAt: new Date().toISOString(),
            }, null, 2));
            // close：关闭锁文件句柄，保留文件作为锁标记。
            await handle.close();
        }
        catch {
            // error：启动锁存在时明确失败，桌面端展示原因。
            throw new Error(`中心目录已有中心服务启动锁：${this.lockFilePath}`);
        }
    }
    // refreshProviderCapabilities：刷新供应商模型和推理深度列表。
    async refreshProviderCapabilities(provider) {
        // now：刷新更新时间。
        const now = new Date().toISOString();
        // local：本地供应商不需要网络刷新，保留手动模型和推理深度。
        if (provider.type === "local") {
            return {
                ...provider,
                lastRefreshError: undefined,
                updatedAt: now,
            };
        }
        // missingBaseUrl：无接口地址时不能猜测供应商协议，保存明确失败原因。
        if (!provider.baseUrl) {
            return {
                ...provider,
                lastRefreshError: "供应商接口地址为空，请手动维护模型和推理深度。",
                updatedAt: now,
            };
        }
        // proxyFailure：当前无代理 agent 依赖时只做策略校验和失败分类，不伪装已真实代理转发。
        const proxyFailure = await this.classifyProxyReadiness(provider);
        if (proxyFailure) {
            return {
                ...provider,
                lastRefreshError: proxyFailure,
                updatedAt: now,
            };
        }
        // openaiCompatible：兼容 OpenAI 的供应商尝试读取 /models。
        if (provider.type === "openai-compatible") {
            try {
                // url：模型列表接口使用 OpenAI 兼容协议路径。
                const url = new URL("/v1/models", provider.baseUrl);
                // response：首版只在无代理或已无需代理时直连刷新。
                const response = await fetch(url);
                // apiFailed：供应商接口返回非成功状态。
                if (!response.ok) {
                    return {
                        ...provider,
                        lastRefreshError: this.formatProviderFailure("provider-api-failed", `供应商接口返回失败：${response.status}`),
                        updatedAt: now,
                    };
                }
                // payload：OpenAI 兼容模型列表通常位于 data[].id。
                const payload = await response.json();
                // refreshedModels：只使用明确 id 字段，不猜测候选名称。
                const refreshedModels = payload.data?.map((item) => item.id).filter((id) => Boolean(id)) ?? [];
                // models：接口没有模型时保留用户手动列表。
                const models = refreshedModels.length > 0 ? refreshedModels : provider.models;
                // reasoningDepths：OpenAI 兼容接口未提供统一推理深度列表，保留手动配置。
                return {
                    ...provider,
                    models,
                    defaultModel: provider.defaultModel || models[0] || "",
                    reasoningDepths: provider.reasoningDepths,
                    defaultReasoningDepth: provider.defaultReasoningDepth,
                    lastRefreshError: refreshedModels.length > 0 ? undefined : "供应商未返回模型列表，请手动维护模型名称。",
                    updatedAt: now,
                };
            }
            catch (error) {
                // message：直连失败归类为供应商连接失败。
                const message = error instanceof Error ? error.message : "未知连接错误";
                return {
                    ...provider,
                    lastRefreshError: this.formatProviderFailure("provider-connect-failed", message),
                    updatedAt: now,
                };
            }
        }
        // custom：自定义供应商没有统一刷新协议，保留手动维护结果。
        return {
            ...provider,
            lastRefreshError: "自定义供应商未声明模型和推理深度刷新协议，请手动维护。",
            updatedAt: now,
        };
    }
    // classifyProxyReadiness：校验供应商代理策略并返回可展示失败分类。
    async classifyProxyReadiness(provider) {
        // none：不使用代理时可以直接访问供应商。
        if (provider.proxyMode === "none") {
            return undefined;
        }
        // proxies：读取中心服务代理配置。
        const proxies = await this.storage.readProxies();
        // proxy：按策略选择代理。
        const proxy = provider.proxyMode === "global"
            ? proxies.find((item) => item.enabled && item.default)
            : proxies.find((item) => item.enabled && item.id === provider.proxyId);
        // missing：代理策略要求代理但未找到可用代理。
        if (!proxy) {
            return this.formatProviderFailure("proxy-connect-failed", "代理策略要求使用代理，但没有可用代理配置。");
        }
        // supported：当前运行依赖没有代理 agent，先明确记录未接入真实转发。
        return this.formatProviderFailure("proxy-connect-failed", `代理 ${proxy.name} 已配置，但真实网络请求代理适配器尚未接入。`);
    }
    // formatProviderFailure：生成供应商访问失败可展示分类。
    formatProviderFailure(kind, message) {
        // labels：按需求区分代理连接、代理认证、供应商连接和供应商接口失败。
        const labels = {
            "proxy-connect-failed": "代理连接失败",
            "proxy-auth-failed": "代理认证失败",
            "provider-connect-failed": "供应商连接失败",
            "provider-api-failed": "供应商接口返回失败",
        };
        // return：分类和详细原因同时保存到 lastRefreshError。
        return `${labels[kind]}：${message}`;
    }
    // applyEnabledProviderDefaults：启用供应商变化后同步智能体默认模型选择。
    async applyEnabledProviderDefaults(providers) {
        // enabled：只统计启用供应商。
        const enabled = providers.filter((provider) => provider.enabled);
        // agents：智能体定义是后续对话默认选择，不影响历史记录。
        const agents = await this.storage.readAgents();
        // single：只有一个启用供应商时，未配置承载供应商的智能体默认使用它。
        if (enabled.length === 1) {
            const only = enabled[0];
            return {
                providers,
                agents: agents.map((agent) => ({
                    ...agent,
                    providerId: agent.providerId ?? only.id,
                    model: agent.model ?? only.defaultModel,
                    reasoningDepth: agent.reasoningDepth ?? only.defaultReasoningDepth,
                    updatedAt: new Date().toISOString(),
                })),
            };
        }
        // multiple：多个启用供应商时保留每个智能体自己的选择，UI 可通过 /agents 管理。
        return {
            providers,
        };
    }
    // resolveDefaultAgent：创建会话时确定默认智能体。
    async resolveDefaultAgent(agentId) {
        // agents：读取智能体定义。
        const agents = await this.storage.readAgents();
        // explicit：调用方指定智能体时按 ID 选择。
        const explicit = agentId ? agents.find((agent) => agent.id === agentId) : undefined;
        // primary：默认使用主智能体。
        return explicit ?? agents.find((agent) => agent.kind === "primary") ?? agents[0];
    }
    // persistAgentMarkdown：把团队智能体定义固化为 Markdown。
    async persistAgentMarkdown(agent) {
        // directories：智能体 Markdown 位于中心目录“智能体”。
        const directories = this.storage.getDirectoryMap();
        // fileName：用智能体名称作为 Markdown 文件名，替换路径分隔符避免越界。
        const fileName = `${agent.name.replace(/[\\/]/g, "_")}.md`;
        // filePath：Markdown 固化路径。
        const filePath = join(directories["智能体"], fileName);
        // content：包含供应商、模型、推理深度和职责说明。
        const content = [
            `# ${agent.name}`,
            "",
            "## 类型",
            "",
            agent.kind,
            "",
            "## 供应商",
            "",
            agent.providerId ?? "",
            "",
            "## 模型",
            "",
            agent.model ?? "",
            "",
            "## 推理深度",
            "",
            agent.reasoningDepth ?? "",
            "",
            "## 职责说明",
            "",
            agent.description,
            "",
        ].join("\n");
        // writeText：智能体定义允许用户修改时整体覆盖最新结构化定义。
        await this.storage.getRepository().writeText(filePath, content, "config-write");
    }
    // readExtensionsWithProjectScope：读取全局和项目级扩展能力，并按项目优先去重。
    async readExtensionsWithProjectScope() {
        // globalExtensions：中心目录保存的全局能力和已登记项目能力。
        const globalExtensions = await this.storage.readExtensions();
        // projectExtensions：扫描项目级 .agents 能力目录。
        const projectExtensions = await this.scanProjectExtensions();
        // merged：同名同类型能力项目级优先。
        const merged = new Map();
        // addGlobal：先放全局。
        globalExtensions.forEach((extension) => {
            merged.set(`${extension.type}|${extension.name}`, extension);
        });
        // addProject：项目级覆盖全局同名能力。
        projectExtensions.forEach((extension) => {
            merged.set(`${extension.type}|${extension.name}`, extension);
        });
        // values：返回合并结果。
        return [...merged.values()];
    }
    // scanProjectExtensions：扫描项目级 .agents 目录。
    async scanProjectExtensions() {
        // projects：项目根目录来自中心服务登记，不猜测本机路径。
        const projects = await this.storage.readProjects();
        // result：扫描得到的项目级能力。
        const result = [];
        // for：逐项目扫描 rules、skills、plugins、mcp。
        for (const project of projects) {
            // base：项目级能力根目录。
            const base = join(project.rootPath, ".agents");
            // directories：需求规定的项目级能力目录。
            const directories = [
                {
                    type: "skill",
                    path: join(base, "rules"),
                },
                {
                    type: "skill",
                    path: join(base, "skills"),
                },
                {
                    type: "plugin",
                    path: join(base, "plugins"),
                },
                {
                    type: "mcp",
                    path: join(base, "mcp"),
                },
            ];
            // inner：扫描每个目录的一层文件或子目录名。
            for (const directory of directories) {
                // entries：不存在时返回空列表。
                const entries = await this.storage.getRepository().listDirectory(directory.path);
                // map：每个条目登记为项目级扩展清单。
                entries.forEach((entry) => {
                    result.push({
                        id: `${project.projectId}:${directory.type}:${entry}`,
                        type: directory.type,
                        scope: "project",
                        projectId: project.projectId,
                        name: basename(entry).replace(/\.[^.]+$/, ""),
                        version: "0.1.0",
                        entry: join(directory.path, entry),
                        capabilities: [],
                        permissions: [],
                        enabled: true,
                        description: "项目级扩展能力，来源于项目 .agents 目录扫描。",
                        callRecords: [],
                        updatedAt: new Date().toISOString(),
                    });
                });
            }
        }
        // result：返回扫描结果。
        return result;
    }
    // readProjectMcpConfig：读取项目级 .agents/mcp 配置。
    async readProjectMcpConfig(projectId) {
        // projects：项目根路径来自中心服务登记。
        const projects = await this.storage.readProjects();
        // project：按项目 UUID 查找。
        const project = projects.find((item) => item.projectId === projectId);
        // missing：项目不存在时返回空配置。
        if (!project) {
            return {
                mcpServers: {},
            };
        }
        // mcpDirectory：项目级 MCP 配置目录。
        const mcpDirectory = join(project.rootPath, ".agents", "mcp");
        // entries：读取目录下 JSON 配置文件。
        const entries = await this.storage.getRepository().listDirectory(mcpDirectory);
        // configs：逐个读取根字段为 mcpServers 的配置。
        const configs = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map((entry) => {
            // filePath：项目级 MCP 文件路径。
            const filePath = join(mcpDirectory, entry);
            // readJson：解析失败时按空配置处理。
            return this.storage.getRepository().readJson(filePath, {
                mcpServers: {},
            });
        }));
        // merged：同一个项目目录中后读取的同名配置覆盖前者。
        return configs.reduce((current, item) => ({
            mcpServers: {
                ...current.mcpServers,
                ...item.mcpServers,
            },
        }), {
            mcpServers: {},
        });
    }
    // writeJson：统一写出 JSON 响应。
    writeJson(response, statusCode, body) {
        // statusCode：调用方明确传入业务状态码。
        response.statusCode = statusCode;
        // end：JSON.stringify 保持客户端可直接解析。
        response.end(JSON.stringify(body));
    }
    // writeError：统一写出 API 错误响应。
    writeError(response, statusCode, code, message, displayReason, traceId = randomUUID()) {
        // body：所有错误都包含错误码、消息、展示原因和排查 ID。
        const body = {
            code,
            message,
            displayReason,
            traceId,
        };
        // writeJson：错误响应也保持 JSON 格式。
        this.writeJson(response, statusCode, body);
    }
}
