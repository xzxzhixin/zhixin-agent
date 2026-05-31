/**
 * 阶段 3 和阶段 6 中心服务访问控制、会话与事件检查。
 *
 * 用途：验证中心服务已经具备本机访问识别、远程登录、Cookie 登录态、会话、消息、轮次、任务和事件补齐能力。
 * 关键逻辑：使用 Fastify inject 直接调用接口，避免检查脚本占用真实端口。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CENTER_DATA_DIR_NAME,
  DEFAULT_CENTER_PORT,
  type ApiResponse,
} from "@zhixin/shared";

import {
  type CenterService,
  createCenterService,
  readCenterServiceConfig,
} from "../services/center/src/index";

/**
 * assert：用统一错误格式表达检查失败原因。
 *
 * @param condition 需要满足的布尔条件。
 * @param message 条件不满足时抛出的中文错误。
 * @returns 条件满足时没有返回值。
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * main：执行阶段 3 和阶段 6 中心服务检查。
 *
 * @returns 检查完成时没有返回值。
 */
async function main(): Promise<void> {
  // tempRoot: 本次检查的临时根目录，避免污染项目真实 center-data。
  const tempRoot = await mkdtemp(join(tmpdir(), "zhixin-center-access-"));
  // centerDirectory: 临时中心目录仍使用架构约定名称。
  const centerDirectory = join(tempRoot, CENTER_DATA_DIR_NAME);
  // service: 保存中心服务实例，确保断言失败时也能先释放 SQLite 连接。
  let service: CenterService | null = null;

  try {
    // config: 访问控制检查使用固定端口和临时中心目录。
    const config = readCenterServiceConfig({
      cwd: tempRoot,
      env: {
        ZHIXIN_CENTER_PORT: String(DEFAULT_CENTER_PORT),
        ZHIXIN_CENTER_DIR: centerDirectory,
      },
    });
    // service: 使用中心服务工厂直接注入请求。
    service = await createCenterService(config);
    await service.initialize();
    await writeFile(
      join(centerDirectory, "config", "access.json"),
      `${JSON.stringify({
        webAccountConfigured: true,
        account: "zhixin",
        passwordSha256: createHash("sha256").update("zhixin").digest("hex"),
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf-8",
    );

    const localAccessResponse = await service.app.inject({
      method: "POST",
      url: "/api/access/authorize-local",
      headers: {
        "x-forwarded-for": "127.0.0.1",
      },
      payload: {
        clientType: "web-local",
      },
    });
    const localAccess = localAccessResponse.json<ApiResponse<{
      clientId: string;
      accessKind: string;
    }>>();
    assert(localAccess.success, "本机访问授权接口没有成功");
    assert(localAccess.data?.accessKind === "local", "本机访问授权没有识别为 local");

    const remoteDeniedResponse = await service.app.inject({
      method: "POST",
      url: "/api/access/authorize-local",
      headers: {
        "x-forwarded-for": "203.0.113.10",
      },
      payload: {
        clientType: "web-remote",
      },
    });
    const remoteDenied = remoteDeniedResponse.json<ApiResponse<null>>();
    assert(remoteDenied.success === false, "远程来源不应通过本机授权");
    assert(remoteDenied.error?.code === "LOCAL_ACCESS_REQUIRED", "远程来源本机授权错误码不正确");

    const loginResponse = await service.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: {
        "x-forwarded-for": "203.0.113.10",
      },
      payload: {
        account: "zhixin",
        password: "zhixin",
      },
    });
    const login = loginResponse.json<ApiResponse<{
      clientId: string;
      accessKind: string;
    }>>();
    assert(login.success, "远程 Web 登录没有成功");
    assert(login.data?.accessKind === "remote-web", "远程 Web 登录访问类型不正确");
    assert(
      String(loginResponse.headers["set-cookie"]).includes("zhixin_session="),
      "远程 Web 登录没有设置 Cookie 登录态",
    );

    const projectResponse = await service.app.inject({
      method: "POST",
      url: "/api/project/register",
      payload: {
        projectId: "project-check",
        displayName: "检查项目",
        latestPath: "C:/CODE/project-check",
      },
    });
    const project = projectResponse.json<ApiResponse<{
      projectId: string;
    }>>();
    assert(project.success, "项目登记接口没有成功");
    assert(project.data?.projectId === "project-check", "项目登记返回项目 ID 错误");

    const sessionResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionType: "project",
        projectId: "project-check",
        title: "检查会话",
      },
    });
    const session = sessionResponse.json<ApiResponse<{
      sessionId: string;
    }>>();
    assert(session.success, "项目会话创建接口没有成功");
    assert(Boolean(session.data?.sessionId), "项目会话创建没有返回会话 ID");

    const sendResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/message/send",
      payload: {
        sessionId: session.data?.sessionId,
        contentMarkdown: "检查消息",
      },
    });
    const sent = sendResponse.json<ApiResponse<{
      messageId: string;
      turnId: string;
      taskId: string;
    }>>();
    assert(sent.success, "消息发送接口没有成功");
    assert(Boolean(sent.data?.messageId), "消息发送没有返回消息 ID");
    assert(Boolean(sent.data?.turnId), "消息发送没有返回轮次 ID");
    assert(Boolean(sent.data?.taskId), "消息发送没有返回任务 ID");

    const eventListResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/event/list",
      payload: {
        sessionId: session.data?.sessionId,
        turnId: sent.data?.turnId,
        afterSequence: 0,
      },
    });
    const eventList = eventListResponse.json<ApiResponse<{
      events: Array<{
        eventType: string;
        sequence: number;
      }>;
    }>>();
    assert(eventList.success, "事件补齐接口没有成功");
    assert(
      eventList.data?.events.some((event) => event.eventType === "turn.started") === true,
      "事件补齐缺少轮次开始事件",
    );
    assert(
      eventList.data?.events.some((event) => event.eventType === "message.created") === true,
      "事件补齐缺少消息创建事件",
    );

    const detailResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/detail",
      payload: {
        sessionId: session.data?.sessionId,
      },
    });
    const detail = detailResponse.json<ApiResponse<{
      messages: Array<{
        contentMarkdown: string;
      }>;
      turns: Array<{
        turnId: string;
      }>;
      tasks: Array<{
        taskId: string;
      }>;
    }>>();
    assert(detail.success, "会话详情接口没有成功");
    assert(detail.data?.messages[0]?.contentMarkdown === "检查消息", "会话详情未返回已发送消息");
    assert(detail.data?.turns[0]?.turnId === sent.data?.turnId, "会话详情未返回已创建轮次");
    assert(detail.data?.tasks[0]?.taskId === sent.data?.taskId, "会话详情未返回已创建任务");

  } finally {
    // close: Windows 删除临时 SQLite 文件前必须先关闭 better-sqlite3 连接。
    await service?.close().catch(() => {
      // ignore: 检查脚本失败时仍继续清理临时目录，原始失败由前面的断言暴露。
    });
    // cleanup: 检查结束后删除临时中心目录，避免留下测试数据。
    await rm(tempRoot, {
      force: true,
      recursive: true,
    });
  }
}

void main().catch((error) => {
  // catch: 检查失败时输出原始错误，便于定位阶段 3 或阶段 6 缺失能力。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态，作为质量门槛。
  process.exitCode = 1;
});
