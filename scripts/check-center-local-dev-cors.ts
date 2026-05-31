/**
 * 本机开发 CORS 检查。
 *
 * 用途：验证 Vite 开发前端从本机端口访问中心服务时不会被浏览器 CORS 拦截。
 * 关键逻辑：只允许明确的本机开发来源，不能把 Access-Control-Allow-Origin 放成公网通配。
 * 参数：无。
 * 返回值：检查通过正常退出；缺少本机开发 CORS 约定时抛出中文错误。
 */
import {
    mkdtemp,
    rm,
} from "node:fs/promises";
import {
    tmpdir,
} from "node:os";
import {
    join,
} from "node:path";

import {
    type ApiResponse,
} from "@zhixin/shared";

import {
    createCenterService,
    readCenterServiceConfig,
} from "../services/center/src/index";

/**
 * assert：检查条件，不满足时抛出明确中文错误。
 *
 * @param condition 待检查条件。
 * @param message 检查失败时的错误信息。
 * @returns 条件成立时没有返回值。
 */
function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

/**
 * main：执行本机开发 CORS 检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
    // centerDirectory：临时中心目录，避免检查污染真实 center-data。
    const centerDirectory = await mkdtemp(join(
        tmpdir(),
        "zhixin-center-cors-",
    ));
    // localDevOrigin：Vite 本机开发来源，来自本轮浏览器复现场景。
    const localDevOrigin = "http://127.0.0.1:8877";
    // config：使用随机之外的固定开发来源进行 CORS 注入检查，不监听真实端口。
    const config = readCenterServiceConfig({
        cwd: process.cwd(),
        env: {
            ZHIXIN_CENTER_DIR: centerDirectory,
            ZHIXIN_CENTER_PORT: "8866",
        },
    });
    // service：中心服务实例，使用 inject 模拟浏览器预检和管理页请求。
    const service = await createCenterService(config);

    try {
        await service.initialize();

        // preflightResponse：浏览器跨源 POST 前会先发 OPTIONS 预检。
        const preflightResponse = await service.app.inject({
            method: "OPTIONS",
            url: "/api/provider/list",
            headers: {
                origin: localDevOrigin,
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
            },
        });

        assert(preflightResponse.statusCode === 204, "本机开发 CORS 预检应返回 204。");
        assert(
            preflightResponse.headers["access-control-allow-origin"] === localDevOrigin,
            "本机开发 CORS 预检必须只回显允许的本机前端来源。",
        );
        assert(
            String(preflightResponse.headers["access-control-allow-credentials"]) === "true",
            "本机开发 CORS 必须允许 Cookie 登录态随请求发送。",
        );

        // postResponse：真实管理页接口响应也必须带 CORS 响应头。
        const postResponse = await service.app.inject({
            method: "POST",
            url: "/api/provider/list",
            headers: {
                origin: localDevOrigin,
                "content-type": "application/json",
            },
            payload: {},
        });
        const result = postResponse.json<ApiResponse<{
            providers: unknown[];
        }>>();

        assert(result.success, "供应商列表接口本身应保持成功响应。");
        assert(
            postResponse.headers["access-control-allow-origin"] === localDevOrigin,
            "本机开发管理页响应必须带允许来源响应头。",
        );

        // publicOriginResponse：公网来源不能被放行，避免开发便利破坏中心服务访问边界。
        const publicOriginResponse = await service.app.inject({
            method: "OPTIONS",
            url: "/api/provider/list",
            headers: {
                origin: "https://example.com",
                "access-control-request-method": "POST",
            },
        });

        assert(
            publicOriginResponse.headers["access-control-allow-origin"] !== "*",
            "中心服务不能把 CORS 来源放开为任意公网来源。",
        );
        assert(
            publicOriginResponse.headers["access-control-allow-origin"] !== "https://example.com",
            "中心服务不能允许未声明的公网来源。",
        );
    } finally {
        await service.close();
        await rm(
            centerDirectory,
            {
                force: true,
                recursive: true,
            },
        );
    }
}

void main();
