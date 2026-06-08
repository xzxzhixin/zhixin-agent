import {existsSync} from "node:fs";
import {readFile, stat} from "node:fs/promises";
import {extname, join, resolve} from "node:path";

import {CENTER_DATA_DIR_NAME, DEFAULT_CENTER_PORT} from "@zhixin/shared";

import type {CenterServiceConfig, CenterServiceConfigInput, FrontendAsset} from "./types.js";

export function readCenterServiceConfig(input: CenterServiceConfigInput = {}): CenterServiceConfig {
    // env: 默认读取进程环境变量，桌面壳后续可传入隔离环境。
    const env = input.env ?? process.env;
    // cwd: 默认读取进程当前目录，开发期 center-data 以这里为基准。
    const cwd = input.cwd ?? process.cwd();
    // rawPort: 桌面壳传入的端口文本。
    const rawPort = env.ZHIXIN_CENTER_PORT;
    // parsedPort: 端口必须是有限数字，否则回到架构默认值。
    const parsedPort = rawPort ? Number.parseInt(rawPort, 10) : DEFAULT_CENTER_PORT;
    // port: 只接受合法 TCP 用户端口，避免启动失败后难以排查。
    const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
        ? parsedPort
        : DEFAULT_CENTER_PORT;
    // rawCenterDirectory: 桌面壳可传入用户选择的中心目录。
    const rawCenterDirectory = env.ZHIXIN_CENTER_DIR;
    // centerDirectory: 未传入时按新版架构使用 cwd/center-data。
    const centerDirectory = rawCenterDirectory
        ? resolve(rawCenterDirectory)
        : resolve(cwd, CENTER_DATA_DIR_NAME);
    // rawFrontendDistDirectory: 桌面壳或开发脚本传入的前端构建产物目录。
    const rawFrontendDistDirectory = input.frontendDistDirectory ?? env.ZHIXIN_FRONTEND_DIST;
    // frontendDevServerUrl: 桌面壳开发期传入 Vite 服务地址，让 8866 页面请求复用 HMR 而不是旧 dist。
    const frontendDevServerUrl = normalizeFrontendDevServerUrl(env.ZHIXIN_FRONTEND_DEV_URL);
    // defaultFrontendDistDirectory: 开发期中心服务从仓库根目录启动时使用 apps/frontend/dist。
    const defaultFrontendDistDirectory = resolve(cwd, "apps", "frontend", "dist");
    // frontendDistDirectory: 存在入口文件时才启用静态资源托管，避免 API 检查脚本误依赖前端构建。
    const frontendDistDirectory = rawFrontendDistDirectory
        ? resolve(rawFrontendDistDirectory)
        : existsSync(join(defaultFrontendDistDirectory, "index.html"))
            ? defaultFrontendDistDirectory
            : null;
    // builtinPluginsDirectory: 开发期默认同步到中心目录 plugins，绿色版由桌面壳传入 resources/plugins。
    const builtinPluginsDirectory = env.ZHIXIN_BUILTIN_PLUGINS_DIR
        ? resolve(env.ZHIXIN_BUILTIN_PLUGINS_DIR)
        : resolve(centerDirectory, "plugins");

    return {
        port,
        centerDirectory,
        frontendDistDirectory,
        frontendDevServerUrl,
        builtinPluginsDirectory,
    };
}

/**
 * normalizeFrontendDevServerUrl：归一化开发期前端 dev server 地址。
 *
 * @param rawUrl 桌面壳传入的 ZHIXIN_FRONTEND_DEV_URL。
 * @returns 合法本机 Vite 地址；未传入或非法时返回 null。
 */
export function normalizeFrontendDevServerUrl(rawUrl: string | undefined): string | null {
    if (!rawUrl) {
        return null;
    }

    try {
        // parsedUrl: 使用 URL 标准解析，避免字符串拼接接受畸形地址。
        const parsedUrl = new URL(rawUrl);
        // isAllowedHost: 开发期只允许本机地址，不能让中心服务跳转到外部页面。
        const isAllowedHost = parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost";
        // isAllowedPort: 当前前端开发端口由 Vite strictPort 固定为 5173。
        const isAllowedPort = parsedUrl.port === "5173";
        // isHttp: Vite 开发服务当前使用普通 HTTP，同源 API 仍由中心服务处理。
        const isHttp = parsedUrl.protocol === "http:";

        if (!isAllowedHost || !isAllowedPort || !isHttp) {
            return null;
        }

        // pathname/search/hash: 传入值只作为服务根地址，避免环境变量自带路由污染后续请求映射。
        parsedUrl.pathname = "/";
        parsedUrl.search = "";
        parsedUrl.hash = "";
        return parsedUrl.toString().replace(/\/$/u, "");
    } catch {
        // 无法解析时回退静态资源托管，不因开发变量错误导致中心服务启动失败。
        return null;
    }
}

/**
 * resolveFrontendAssetPath：把请求路径映射到前端构建产物文件。
 *
 * @param frontendDistDirectory 前端构建产物目录。
 * @param requestPath HTTP 请求路径。
 * @returns 位于前端产物目录内的文件路径；不应托管时返回 null。
 */
export function resolveFrontendAssetPath(frontendDistDirectory: string | null, requestPath: string): string | null {
    if (frontendDistDirectory === null) {
        return null;
    }

    // pathname: 去掉查询参数后的 URL 路径，避免把 query 当作文件名。
    const pathname = requestPath.split("?")[0] ?? "/";

    if (pathname.startsWith("/api/")) {
        return null;
    }

    // relativeAssetPath: 前端资源相对路径，根路径和业务 hash 路由都回退到 index.html。
    const relativeAssetPath = pathname === "/" || pathname === "/index.html"
        ? "index.html"
        : pathname === "/plugin.html"
            ? "plugin.html"
            : pathname.startsWith("/assets/")
                ? pathname.slice(1)
                : "index.html";
    // assetPath: 规范化后的资源绝对路径。
    const assetPath = resolve(frontendDistDirectory, relativeAssetPath);
    // frontendRoot: 规范化后的前端产物根目录。
    const frontendRoot = resolve(frontendDistDirectory);

    if (assetPath !== frontendRoot && !assetPath.startsWith(`${frontendRoot}\\`) && !assetPath.startsWith(`${frontendRoot}/`)) {
        return null;
    }

    return assetPath;
}

/**
 * readFrontendAsset：读取前端静态资源。
 *
 * @param frontendDistDirectory 前端构建产物目录。
 * @param requestPath HTTP 请求路径。
 * @returns 前端资源内容和 MIME；缺失或越界时返回 null。
 */
export async function readFrontendAsset(frontendDistDirectory: string | null, requestPath: string): Promise<FrontendAsset | null> {
    // assetPath: 请求映射后的前端资源路径。
    const assetPath = resolveFrontendAssetPath(frontendDistDirectory, requestPath);

    if (assetPath === null || !existsSync(assetPath)) {
        return null;
    }

    // assetStat: 只允许返回文件，目录请求继续走入口回退。
    const assetStat = await stat(assetPath);
    if (!assetStat.isFile()) {
        return null;
    }

    return {
        content: await readFile(assetPath),
        contentType: resolveFrontendContentType(assetPath),
    };
}

/**
 * resolveFrontendContentType：根据扩展名返回前端资源 MIME。
 *
 * @param assetPath 前端资源文件路径。
 * @returns HTTP Content-Type。
 */
export function resolveFrontendContentType(assetPath: string): string {
    // extension: 文件扩展名，来自 Vite 构建产物。
    const extension = extname(assetPath).toLowerCase();

    if (extension === ".html") {
        return "text/html; charset=utf-8";
    }

    if (extension === ".js") {
        return "text/javascript; charset=utf-8";
    }

    if (extension === ".css") {
        return "text/css; charset=utf-8";
    }

    if (extension === ".svg") {
        return "image/svg+xml";
    }

    if (extension === ".png") {
        return "image/png";
    }

    if (extension === ".woff2") {
        return "font/woff2";
    }

    return "application/octet-stream";
}

/**
 * resolveFrontendDevServerRedirectUrl：把中心服务页面请求映射到 Vite dev server。
 *
 * @param frontendDevServerUrl 本机 Vite dev server 根地址。
 * @param centerPort 中心服务端口，用于继续传给前端 API 客户端。
 * @param requestPath 中心服务收到的原始请求路径。
 * @returns 需要跳转的 Vite 地址；API 和静态 assets 请求返回 null。
 */
export function resolveFrontendDevServerRedirectUrl(
    frontendDevServerUrl: string | null,
    centerPort: number,
    requestPath: string,
): string | null {
    if (frontendDevServerUrl === null) {
        return null;
    }

    // pathname: 去掉查询参数后的 URL 路径，判断是否属于 API 或构建静态资源。
    const pathname = requestPath.split("?")[0] ?? "/";
    if (pathname.startsWith("/api/") || pathname.startsWith("/assets/")) {
        return null;
    }

    // targetUrl: Vite dev server 只承载根入口；业务路径统一放入 hash，避免生成 /chat?port=8866#/chat。
    const targetUrl = new URL(
        normalizeFrontendDevRedirectPath(pathname),
        `${frontendDevServerUrl}/`,
    );
    targetUrl.searchParams.set("port", String(centerPort));
    return targetUrl.toString();
}

/**
 * normalizeFrontendDevRedirectPath：规范中心服务开发期跳转到 Vite 的入口路径。
 *
 * @param pathname 中心服务收到的不含查询参数路径。
 * @returns Vite dev server 可识别的规范路径。
 */
export function normalizeFrontendDevRedirectPath(pathname: string): string {
    if (pathname === "/" || pathname === "") {
        return "/";
    }

    if (pathname === "/plugin.html") {
        return "/plugin.html";
    }

    // hash: 前端使用 hash 路由；把浏览器直接访问的业务路径迁移到 hash，Vite pathname 始终保持根入口。
    return `/#${pathname}`;
}
