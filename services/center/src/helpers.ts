import {appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";

import type {ApiError, ApiResponse} from "@zhixin/shared";
import type {FastifyReply} from "fastify";

import type {AccessConfigFile, CenterServiceConfig, HealthResponse} from "./types.js";

export async function isHealthyCenterServiceAlreadyListening(config: CenterServiceConfig): Promise<boolean> {
    try {
        // response: 只探测本机端口的健康接口，避免把远程服务误判为可复用中心。
        const response = await fetch(`http://127.0.0.1:${config.port}/api/health`);
        if (!response.ok) {
            return false;
        }

        const result = await response.json() as ApiResponse<HealthResponse>;
        return result.success
            && result.data?.port === config.port
            && resolve(result.data.centerDirectory) === resolve(config.centerDirectory);
    } catch {
        // 网络失败说明端口无健康中心服务，后续仍按启动锁逻辑处理。
        return false;
    }
}

/**
 * isRequestFromLocalHost：根据服务端收到的来源 IP 判断是否本机访问。
 *
 * @param ip Fastify 根据连接和代理头识别出的客户端 IP。
 * @returns 来源属于本机地址时返回 true。
 */
export function isRequestFromLocalHost(ip: string): boolean {
    // normalizedIp: IPv6 映射地址统一转成可比较文本。
    const normalizedIp = ip.trim().toLowerCase();
    return normalizedIp === "127.0.0.1"
        || normalizedIp === "::1"
        || normalizedIp === "::ffff:127.0.0.1"
        || normalizedIp === "localhost";
}

/**
 * resolveAllowedLocalDevCorsOrigin：解析允许跨端口访问中心服务的本机开发来源。
 *
 * @param origin 浏览器 Origin 请求头。
 * @returns 允许时返回需要回显的来源；不允许时返回 null。
 */
export function resolveAllowedLocalDevCorsOrigin(origin: string | string[] | undefined): string | null {
    if (typeof origin !== "string") {
        return null;
    }

    // allowedOrigins: 仅包含本机 Vite 开发来源；生产 Web 由中心服务同源托管，不需要 CORS。
    const allowedOrigins = new Set([
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]);

    return allowedOrigins.has(origin)
        ? origin
        : null;
}

/**
 * applyLocalDevCorsHeaders：为本机开发来源写入 CORS 响应头。
 *
 * @param reply Fastify 响应对象。
 * @param origin 已通过白名单校验的本机开发来源。
 * @returns 没有返回值。
 */
export function applyLocalDevCorsHeaders(reply: FastifyReply, origin: string): void {
    // Access-Control-Allow-Origin 必须回显明确本机来源，不能使用 `*`，否则会破坏 Cookie 登录态边界。
    reply.header("access-control-allow-origin", origin);
    // Access-Control-Allow-Credentials 允许本机开发前端携带远程 Web Cookie 登录态。
    reply.header("access-control-allow-credentials", "true");
    // Access-Control-Allow-Methods 与架构约定保持一致，只允许 GET、POST 和浏览器预检 OPTIONS。
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    // Access-Control-Allow-Headers 只允许管理页当前需要的 JSON Content-Type 请求头。
    reply.header("access-control-allow-headers", "content-type");
    // Vary: Origin 避免代理或浏览器缓存把某个本机来源的 CORS 头复用到其他来源。
    reply.header("vary", "Origin");
}

/**
 * readAccessConfig：读取桌面壳写入的远程 Web 访问配置。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 访问配置文件内容。
 */
export async function readAccessConfig(centerDirectory: string): Promise<AccessConfigFile> {
    // accessConfigPath: 访问控制配置只由中心服务读取，桌面壳负责写入。
    const accessConfigPath = join(centerDirectory, "config", "access.json");
    // rawContent: 配置文件缺失时返回未配置状态，便于首次启动。
    const rawContent = await readFile(accessConfigPath, "utf-8").catch(() => "");

    if (!rawContent) {
        return {
            webAccountConfigured: false,
        };
    }

    return JSON.parse(rawContent) as AccessConfigFile;
}

/**
 * buildSessionCookie：构造远程 Web 登录态 Cookie。
 *
 * @param sessionToken 中心服务生成的登录态令牌。
 * @param isLocalRequest 当前登录请求是否来自本机。
 * @returns Set-Cookie 响应头内容。
 */
export function buildSessionCookie(sessionToken: string, isLocalRequest: boolean): string {
    // secureFlag: 本机开发 HTTP 不加 Secure，远程部署若使用 HTTPS 则加 Secure 约束浏览器传输。
    const secureFlag = isLocalRequest ? "" : "; Secure";
    return `zhixin_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureFlag}`;
}

/**
 * upsertSyncClient：登记或刷新同步客户端在线记录。
 *
 * @param database 中心服务数据库。
 * @param input 客户端登记参数。
 * @returns 客户端 ID。
 */
export function writeJsonFile(filePath: string, value: Record<string, unknown>): void {
    mkdirSync(dirname(filePath), {recursive: true});
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function writeFileSyncUtf8IfMissing(filePath: string, value: string): void {
    if (existsSync(filePath)) {
        return;
    }
    appendFileSync(filePath, value, "utf-8");
}

/**
 * writeFileSyncUtf8：覆盖写入 UTF-8 文本文件。
 *
 * @param filePath 文件绝对路径。
 * @param value 文件内容。
 * @returns 没有返回值。
 */
export function writeFileSyncUtf8(filePath: string, value: string): void {
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    if (existsSync(filePath)) {
        rmSync(filePath);
    }
    writeFileSync(filePath, value, "utf-8");
}

/**
 * deriveProjectDisplayNameFromPath：从项目最近路径派生项目显示名。
 *
 * @param latestPath 项目登记传入的当前项目根目录路径。
 * @returns 路径最后一级目录名；路径为空、只有分隔符或无法派生时返回空字符串。
 */
export function deriveProjectDisplayNameFromPath(latestPath: string): string {
    // normalizedPath: 去掉首尾空白和末尾路径分隔符，确保 `C:\项目\对话测试\` 能派生出 `对话测试`。
    const normalizedPath = latestPath.trim().replace(/[\\/]+$/u, "");
    if (normalizedPath.length === 0) {
        return "";
    }

    // pathParts: 同时支持 Windows 反斜杠和 POSIX 正斜杠；只取最后一级目录满足项目文件夹名需求。
    const pathParts = normalizedPath.split(/[\\/]/u);
    return pathParts[pathParts.length - 1]?.trim() ?? "";
}

/**
 * createSuccessResponse：创建统一成功响应包。
 *
 * @param data 成功业务数据。
 * @returns API 统一响应包。
 */
export function createSuccessResponse<TData>(data: TData): ApiResponse<TData> {
    return {
        success: true,
        data,
        error: null,
    };
}

/**
 * createErrorResponse：创建统一错误响应包。
 *
 * @param code 机器可读错误码。
 * @param message 开发排查消息。
 * @param displayMessage 用户可展示消息。
 * @param traceId 可选排查 ID，未传入时自动生成。
 * @returns API 统一错误响应包。
 */
export function createErrorResponse(
    code: string,
    message: string,
    displayMessage: string,
    traceId = randomUUID(),
): ApiResponse<null> {
    const error: ApiError = {
        code,
        message,
        displayMessage,
        traceId,
    };

    return {
        success: false,
        data: null,
        error,
    };
}
