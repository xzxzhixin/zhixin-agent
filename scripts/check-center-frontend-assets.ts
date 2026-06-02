/**
 * 中心服务前端资源托管检查。
 *
 * 用途：验证中心服务能够通过 HTTP 提供 index.html、plugin.html 和 Vite 拆包 assets。
 * 关键逻辑：桌面壳生产期不再使用 file:// 加载前端，必须由中心服务托管分包产物。
 */
import {
  readdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import {
  join,
} from "node:path";
import {
  tmpdir,
} from "node:os";
import {
  createServer,
} from "node:net";
import {
  createCenterService,
  readCenterServiceConfig,
} from "../services/center/src/index";

/**
 * assert：检查条件，不满足时抛出中文错误。
 *
 * @param condition 待检查条件。
 * @param message 失败时输出的错误信息。
 * @returns 条件成立时没有返回值。
 */
function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * fetchText：读取 HTTP 文本响应。
 *
 * @param url 请求地址。
 * @returns 响应文本。
 */
async function fetchText(url: string): Promise<string> {
  // response: Node 内置 fetch 响应对象。
  const response = await fetch(url);
  assert(response.ok, `请求失败：${url}`);
  return response.text();
}

/**
 * findFreePort：向系统申请一个空闲本机端口。
 *
 * @returns 可用于本次检查的端口号。
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    // server: 临时 TCP 服务，只用于让系统分配空闲端口。
    const server = createServer();
    server.listen(
      0,
      "127.0.0.1",
      () => {
        // address: Node 返回的监听地址，端口来自系统分配。
        const address = server.address();
        if (address === null || typeof address === "string") {
          rejectPort(new Error("无法获取临时端口。"));
          return;
        }

        server.close(() => resolvePort(address.port));
      },
    );
    server.on("error", rejectPort);
  });
}

/**
 * main：执行中心服务前端资源托管检查。
 *
 * @returns 检查通过时正常结束。
 */
async function main(): Promise<void> {
  // root: 检查脚本固定从仓库根目录运行。
  const root = process.cwd();
  // frontendDistDirectory: 前端构建产物目录，必须先运行 build:frontend。
  const frontendDistDirectory = join(
    root,
    "apps",
    "frontend",
    "dist",
  );
  // assetsDirectory: Vite 拆包资源目录。
  const assetsDirectory = join(
    frontendDistDirectory,
    "assets",
  );
  // assetNames: 用于挑选一个真实 JS chunk 验证静态资源托管。
  const assetNames = await readdir(assetsDirectory);
  // mainAssetName: 主入口 JS chunk，验证中心服务可以提供拆包资源。
  const mainAssetName = assetNames.find((assetName) => assetName.startsWith("main-") && assetName.endsWith(".js"));

  assert(mainAssetName, "前端 dist/assets 缺少 main JS chunk，请先运行 pnpm build:frontend。");

  // centerDirectory: 临时中心目录，避免检查污染真实 center-data。
  const centerDirectory = await mkdtemp(join(
    tmpdir(),
    "zhixin-center-frontend-",
  ));
  // port: 检查使用系统分配的空闲端口，避免影响默认 8866 或本机已有服务。
  const port = await findFreePort();
  // config: 中心服务检查配置，显式传入前端 dist 目录。
  const config = readCenterServiceConfig({
    cwd: root,
    frontendDistDirectory,
    env: {
      ZHIXIN_CENTER_PORT: String(port),
      ZHIXIN_CENTER_DIR: centerDirectory,
    },
  });
  // service: 中心服务实例，托管前端资源并暴露 API。
  const service = await createCenterService(config);

  try {
    await service.listen();

    const baseUrl = `http://127.0.0.1:${port}`;
    const indexHtml = await fetchText(`${baseUrl}/`);
    const pluginHtml = await fetchText(`${baseUrl}/plugin.html`);
    const mainJs = await fetchText(`${baseUrl}/assets/${mainAssetName}`);

    assert(indexHtml.includes("致心智能体") && indexHtml.includes("id=\"app\""), "中心服务 / 未返回前端 index.html。");
    assert(pluginHtml.includes("<title>致心</title>") && pluginHtml.includes("id=\"app\""), "中心服务 /plugin.html 未返回插件入口。");
    assert(mainJs.length > 1000, "中心服务未正确返回前端 main JS chunk。");

    // devRedirectConfig: 开发期带前端 dev server 时，页面请求应清晰复用 5173 HMR。
    const devRedirectConfig = readCenterServiceConfig({
      cwd: root,
      frontendDistDirectory,
      env: {
        ZHIXIN_CENTER_PORT: String(port),
        ZHIXIN_CENTER_DIR: centerDirectory,
        ZHIXIN_FRONTEND_DEV_URL: "http://127.0.0.1:5173",
      },
    });
    // devRedirectService: 同进程注入验证跳转响应，不需要真实启动 Vite。
    const devRedirectService = await createCenterService(devRedirectConfig);
    const redirectResponse = await devRedirectService.app.inject({
      method: "GET",
      url: "/chat",
    });
    const assetResponse = await devRedirectService.app.inject({
      method: "GET",
      url: `/assets/${mainAssetName}`,
    });
    await devRedirectService.close();

    assert(redirectResponse.statusCode === 302, "开发期中心服务 /chat 应跳转到前端 Vite dev server。");
    assert(redirectResponse.headers.location === `http://127.0.0.1:5173/chat?port=${port}`, "开发期中心服务跳转地址没有携带中心服务端口。");
    assert(assetResponse.statusCode === 200 && assetResponse.body.length > 1000, "开发期 /assets/* 请求仍应能读取 dist 静态资源。");
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
