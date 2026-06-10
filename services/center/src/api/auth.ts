import {createHash, randomUUID} from "node:crypto";
import {type ClientType} from "@zhixin/shared";
import {
    buildSessionCookie,
    createErrorResponse,
    createSuccessResponse,
    isRequestFromLocalHost,
    readAccessConfig,
} from "../helpers.js";
import {type AccessAuthorizeResponse} from "../types.js";
import {upsertSyncClient} from "../domain/session-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerAuthRoutes：注册 auth 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerAuthRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
        database,
    } = context;

    app.post("/api/access/authorize-local", async (request) => {
            // body: 本机授权只接受明确客户端类型，服务端再结合来源地址判断。
            const body = request.body as {
                clientType?: ClientType;
                projectId?: string | null;
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
                projectId: body.clientType === "ide-plugin"
                    ? body.projectId ?? null
                    : null,
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
}
