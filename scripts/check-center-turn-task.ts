/**
 * 阶段 6 轮次和任务状态流转检查。
 *
 * 用途：验证中心服务能更新轮次等待/完成/失败/取消状态，并记录任务步骤状态。
 * 关键逻辑：通过 REST 接口驱动状态变化，再读取会话详情确认事实源已更新。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CENTER_DATA_DIR_NAME,
  type ApiResponse,
} from "../packages/shared/src/index";

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
 * main：执行轮次和任务检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  // tempRoot: 临时根目录，避免污染真实中心目录。
  const tempRoot = await mkdtemp(join(tmpdir(), "zhixin-center-turn-task-"));
  // centerDirectory: 临时中心目录。
  const centerDirectory = join(tempRoot, CENTER_DATA_DIR_NAME);
  // service: 保存中心服务实例，失败时也释放数据库。
  let service: CenterService | null = null;

  try {
    const config = readCenterServiceConfig({
      cwd: tempRoot,
      env: {
        ZHIXIN_CENTER_DIR: centerDirectory,
      },
    });
    service = await createCenterService(config);
    await service.initialize();

    const sessionResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionType: "normal",
        projectId: null,
        title: "任务检查会话",
      },
    });
    const session = sessionResponse.json<ApiResponse<{
      sessionId: string;
    }>>();
    assert(session.success, "任务检查会话创建失败");

    const sendResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/message/send",
      payload: {
        sessionId: session.data?.sessionId,
        contentMarkdown: "执行任务",
      },
    });
    const sent = sendResponse.json<ApiResponse<{
      turnId: string;
      taskId: string;
    }>>();
    assert(sent.success, "任务检查消息发送失败");

    const stepCreateResponse = await service.app.inject({
      method: "POST",
      url: "/api/task/step/create",
      payload: {
        taskId: sent.data?.taskId,
        title: "读取上下文",
      },
    });
    const step = stepCreateResponse.json<ApiResponse<{
      stepId: string;
    }>>();
    assert(step.success, `任务步骤创建失败：${JSON.stringify(step.error)}`);

    const stepUpdateResponse = await service.app.inject({
      method: "POST",
      url: "/api/task/step/update",
      payload: {
        stepId: step.data?.stepId,
        status: "completed",
        summary: "上下文读取完成",
      },
    });
    assert(stepUpdateResponse.json<ApiResponse<unknown>>().success, "任务步骤更新失败");

    const waitingResponse = await service.app.inject({
      method: "POST",
      url: "/api/turn/update-status",
      payload: {
        turnId: sent.data?.turnId,
        status: "waiting_user",
      },
    });
    assert(waitingResponse.json<ApiResponse<unknown>>().success, "轮次等待用户状态更新失败");

    const completeResponse = await service.app.inject({
      method: "POST",
      url: "/api/turn/update-status",
      payload: {
        turnId: sent.data?.turnId,
        status: "completed",
      },
    });
    assert(completeResponse.json<ApiResponse<unknown>>().success, "轮次完成状态更新失败");

    const detailResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/detail",
      payload: {
        sessionId: session.data?.sessionId,
      },
    });
    const detail = detailResponse.json<ApiResponse<{
      turns: Array<{
        status: string;
        endedAt: string | null;
        durationMs: number | null;
      }>;
      tasks: Array<{
        status: string;
      }>;
      taskSteps: Array<{
        title: string;
        status: string;
        summary: string | null;
      }>;
    }>>();
    assert(detail.success, "任务检查会话详情读取失败");
    assert(detail.data?.turns[0]?.status === "completed", "轮次最终状态不是 completed");
    assert(typeof detail.data?.turns[0]?.endedAt === "string", "轮次完成后没有结束时间");
    assert(typeof detail.data?.turns[0]?.durationMs === "number", "轮次完成后没有持续时长");
    assert(detail.data?.tasks[0]?.status === "completed", "轮次完成后默认任务没有完成");
    const manualStep = detail.data?.taskSteps.find((currentStep) => {
      return currentStep.title === "读取上下文";
    });
    assert(manualStep?.status === "completed", "任务步骤最终状态不是 completed");
    assert(manualStep.summary === "上下文读取完成", "任务步骤摘要没有保存");

    const commandSessionResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionType: "normal",
        projectId: null,
        title: "命令工具检查会话",
      },
    });
    const commandSession = commandSessionResponse.json<ApiResponse<{
      sessionId: string;
    }>>();
    assert(commandSession.success, "命令工具检查会话创建失败");

    const commandSendResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/message/send",
      payload: {
        sessionId: commandSession.data?.sessionId,
        contentMarkdown: "请调用命令行查看 node 版本",
      },
    });
    const commandSent = commandSendResponse.json<ApiResponse<{
      turnId: string;
      taskId: string;
    }>>();
    assert(commandSent.success, "命令工具检查消息发送失败");

    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });

    const commandDetailResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/detail",
      payload: {
        sessionId: commandSession.data?.sessionId,
      },
    });
    const commandDetail = commandDetailResponse.json<ApiResponse<{
      tasks: Array<{
        status: string;
      }>;
      taskSteps: Array<{
        title: string;
        status: string;
        summary: string | null;
      }>;
    }>>();
    assert(commandDetail.success, "命令工具检查详情读取失败");
    assert(commandDetail.data?.tasks[0]?.status === "completed", "命令工具轮次任务没有完成");
    assert((commandDetail.data?.taskSteps ?? []).some((step) => {
      return step.title === "思考与上下文整理" && step.status === "completed";
    }), "命令工具轮次缺少真实思考任务步骤");
    assert((commandDetail.data?.taskSteps ?? []).some((step) => {
      return step.title === "命令工具执行" && step.status === "completed";
    }), "命令工具轮次缺少真实命令工具任务步骤");

    const commandEventResponse = await service.app.inject({
      method: "POST",
      url: "/api/session/event/list",
      payload: {
        sessionId: commandSession.data?.sessionId,
        turnId: commandSent.data?.turnId,
        afterSequence: 0,
      },
    });
    const commandEvents = commandEventResponse.json<ApiResponse<{
      events: Array<{
        eventType: string;
        taskId: string | null;
        summary: string;
        payload: unknown;
      }>;
    }>>();
    assert(commandEvents.success, "命令工具事件读取失败");
    const commandEventTypes = (commandEvents.data?.events ?? []).map((event) => {
      return event.eventType;
    });
    assert(commandEventTypes.includes("tool.plan.created"), "命令工具轮次缺少工具计划事件");
    assert(commandEventTypes.includes("tool.command.started"), "命令工具轮次缺少命令开始事件");
    assert(commandEventTypes.includes("tool.command.output"), "命令工具轮次缺少命令输出事件");
    assert(commandEventTypes.includes("tool.command.completed"), "命令工具轮次缺少命令完成事件");
    assert(commandEventTypes.includes("tool.plugin.unavailable"), "命令工具轮次缺少插件不可用事件");
    assert(commandEventTypes.includes("tool.mcp.unavailable"), "命令工具轮次缺少 MCP 不可用事件");
    assert(commandEventTypes.includes("tool.skill.unavailable"), "命令工具轮次缺少 skill 不可用事件");
  } finally {
    await service?.close().catch(() => {
      // ignore: 检查失败时仍继续清理临时目录。
    });
    await rm(tempRoot, {
      force: true,
      recursive: true,
    });
  }
}

void main().catch((error) => {
  // catch: 检查失败时输出原始错误，便于定位轮次和任务流转问题。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态。
  process.exitCode = 1;
});
