/**
 * 中心服务扩展配置、通知审批和用量聚合检查。
 *
 * 用途：验证供应商/代理/MCP/skill/插件状态、扩展调用记录、通知配置、审批事件和用量聚合接口。
 * 关键逻辑：通过中心服务接口写入配置和审计记录，再查询确认事实源存在。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CENTER_DATA_DIR_NAME, type ApiResponse } from "@zhixin/shared";
import {
  type CenterService,
  createCenterService,
  readCenterServiceConfig,
} from "../services/center/src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "zhixin-extensions-"));
  const centerDirectory = join(tempRoot, CENTER_DATA_DIR_NAME);
  let service: CenterService | null = null;

  try {
    service = await createCenterService(readCenterServiceConfig({
      cwd: tempRoot,
      env: {
        ZHIXIN_CENTER_DIR: centerDirectory,
      },
    }));
    await service.initialize();

    const provider = (await service.app.inject({
      method: "POST",
      url: "/api/model-provider/create",
      payload: {
        providerName: "聚合供应商",
        modelProtocol: "openai",
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        defaultModelName: "model-a",
      },
    })).json<ApiResponse<{
      provider: {
        providerId: string;
      };
    }>>();
    assert(provider.success, "供应商创建失败");

    const refresh = (await service.app.inject({
      method: "POST",
      url: "/api/model-provider/model/save",
      payload: {
        providerId: provider.data?.provider.providerId,
        defaultModelName: "model-a",
        models: [
          {
            modelName: "model-a",
            displayName: "model-a",
            contextWindowTokens: 1000000,
            enabled: true,
            sortOrder: 0,
          },
        ],
      },
    })).json<ApiResponse<unknown>>();
    assert(refresh.success, "模型列表刷新失败");

    const modelList = (await service.app.inject({
      method: "POST",
      url: "/api/model-provider/list",
      payload: {
        providerId: provider.data?.provider.providerId,
      },
    })).json<ApiResponse<{
      providers: Array<{
        providerId: string;
        models: Array<{
          modelName: string;
          contextWindowTokens: number;
        }>;
      }>;
    }>>();
    assert(modelList.success, "模型列表查询失败，当前 services/center 源码不应返回 API_NOT_FOUND");
    const savedProvider = modelList.data?.providers.find((item) => item.providerId === provider.data?.provider.providerId);
    assert(savedProvider?.models.some((item) => item.modelName === "model-a") === true, "模型列表查询没有返回刷新后的模型");
    assert(savedProvider?.models.some((item) => item.modelName === "model-a" && item.contextWindowTokens === 1000000) === true, "模型列表查询没有返回模型上下文窗口");

    const proxy = (await service.app.inject({
      method: "POST",
      url: "/api/proxy/save",
      payload: {
        proxyName: "无认证代理",
        protocol: "SOCKS5",
        host: "127.0.0.1",
        port: 1080,
        username: "",
        password: "",
        enabled: true,
      },
    })).json<ApiResponse<{ hasAuth: boolean }>>();
    assert(proxy.success, "代理保存失败");
    assert(proxy.data?.hasAuth === false, "空用户名密码代理应按无认证处理");

    const mcp = (await service.app.inject({
      method: "POST",
      url: "/api/mcp/save",
      payload: {
        mcpServers: {
          idea: {
            type: "http",
            url: "http://127.0.0.1:64342/stream",
          },
        },
      },
    })).json<ApiResponse<{ relativePath: string }>>();
    assert(mcp.success, "MCP 配置保存失败");
    await stat(join(centerDirectory, mcp.data?.relativePath ?? ""));

    const skill = (await service.app.inject({
      method: "POST",
      url: "/api/skill/install",
      payload: {
        skillName: "check-skill",
        content: "# Check Skill",
      },
    })).json<ApiResponse<{ relativePath: string }>>();
    assert(skill.success, "skill 安装失败");
    await stat(join(centerDirectory, skill.data?.relativePath ?? ""));

    const extensionCall = (await service.app.inject({
      method: "POST",
      url: "/api/extension/call-record",
      payload: {
        extensionId: "check-plugin",
        status: "completed",
        inputSummary: "调用输入",
        outputSummary: "调用输出",
      },
    })).json<ApiResponse<unknown>>();
    assert(extensionCall.success, "扩展调用记录失败");

    const usage = (await service.app.inject({
      method: "POST",
      url: "/api/usage/record",
      payload: {
        providerId: provider.data?.provider.providerId,
        model: "model-a",
        projectId: "project-a",
        inputTokens: 3,
        outputTokens: 4,
        cacheHitTokens: null,
        cacheMissTokens: null,
        status: "completed",
      },
    })).json<ApiResponse<unknown>>();
    assert(usage.success, "用量记录失败");

    const aggregate = (await service.app.inject({
      method: "POST",
      url: "/api/usage/aggregate",
      payload: {},
    })).json<ApiResponse<{ stats: Array<{summaryType?: string}> }>>();
    assert(aggregate.success, "用量聚合失败");
    const summaryTypes = new Set((aggregate.data?.stats ?? []).map((item) => item.summaryType));
    assert(summaryTypes.has("total-summary"), "用量聚合缺少总量统计");
    assert(summaryTypes.has("provider-summary"), "用量聚合缺少供应商维度统计");
    assert(summaryTypes.has("project-summary"), "用量聚合缺少项目维度统计");
    assert(summaryTypes.has("model-project-detail"), "用量聚合缺少模型项目明细统计");

    const notificationConfig = (await service.app.inject({
      method: "POST",
      url: "/api/notification/config/set",
      payload: {
        clientType: "web-local",
        enabled: true,
        notifyOnFailure: true,
        notifyOnWaitingUser: true,
      },
    })).json<ApiResponse<unknown>>();
    assert(notificationConfig.success, "通知配置保存失败");

    const approval = (await service.app.inject({
      method: "POST",
      url: "/api/approval/record",
      payload: {
        taskId: "task-check",
        approved: true,
        reason: "允许执行",
      },
    })).json<ApiResponse<unknown>>();
    assert(approval.success, "审批记录失败");

    const calls = (await service.app.inject({
      method: "POST",
      url: "/api/extension/call-list",
      payload: {},
    })).json<ApiResponse<{ records: unknown[] }>>();
    assert(calls.success, "扩展调用查询失败");
    assert(calls.data?.records.length === 1, "扩展调用查询数量错误");
  } finally {
    await service?.close().catch(() => {});
    await rm(tempRoot, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    }).catch(() => {
      // ignore: Windows 日志句柄释放可能晚于 service.close，清理失败不能覆盖业务断言。
    });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
