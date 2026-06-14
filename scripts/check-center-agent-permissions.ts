/**
 * 中心服务智能体权限与创建时间检查。
 *
 * 用途：验证智能体工具权限映射不再散落为硬编码分支，并验证智能体创建类时间使用中心服务本机时间格式。
 * 关键逻辑：直接调用 agents 类层级，并静态检查创建链路时间来源，避免加载 SQLite 原生模块。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import {readFile} from "node:fs/promises";

import {
  LongTermAgent,
  MainAgent,
  mapToolCapabilityToAgentToolName,
  SubAgent,
} from "../services/center/src/agents/index";
import {formatCenterLocalDateTime} from "../services/center/src/time";
import {listUnifiedToolCapabilities} from "../services/center/src/tools/tool-capability-registry";

/**
 * LOCAL_DATE_TIME_PATTERN：中心服务本机时间固定格式。
 */
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;

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
 * main：执行智能体权限和时间检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  const mainAgent = new MainAgent();
  const longTermAgent = new LongTermAgent({
    agentId: "agent-check-long-term",
    name: "检查长期智能体",
  });
  const subAgent = new SubAgent({
    agentId: "sub-agent-check",
    name: "检查子智能体",
  });

  assert(mainAgent.canUseToolCapability("builtin.agent.createLongTerm"), "主智能体必须可使用创建长期智能体工具");
  assert(mainAgent.canUseToolCapability("create-agent-team"), "主智能体必须可使用 team 管理工具");
  assert(!longTermAgent.canUseToolCapability("builtin.agent.createLongTerm"), "长期智能体不能创建长期智能体");
  assert(longTermAgent.canUseToolCapability("builtin.agent.createSubAgent"), "长期智能体必须可创建子智能体");
  assert(!longTermAgent.canUseToolCapability("create-agent-team"), "长期智能体不能管理 team");
  assert(!subAgent.canUseToolCapability("builtin.agent.createSubAgent"), "子智能体不能继续创建子智能体");
  assert(!mainAgent.getCreationTools().includes("todo-list"), "主智能体创建类工具不能包含 todoList");
  assert(!longTermAgent.getCreationTools().includes("todo-list"), "长期智能体创建类工具不能包含 todoList");
  assert(!subAgent.getCreationTools().includes("todo-list"), "todoList 不是创建类工具，不能出现在 getCreationTools 中");
  assert(subAgent.shouldCreateTodoListForTask({
    taskSummary: "需要多步骤处理的检查任务",
    plannedStepCount: 2,
  }), "子智能体仍可通过 Deep Agents 自带 todoList 维护自己的多步骤任务状态");
  assert(!subAgent.canUseToolCapability("builtin.deepagents.write_todos"), "中心服务不能再把 Deep Agents write_todos 包装成模型可见工具");
  assert(mapToolCapabilityToAgentToolName("mcp_global_files_read") === "mcp-call", "MCP 动态工具必须继承 MCP 权限边界");
  assert(!listUnifiedToolCapabilities().some((capability) => {
    return capability.toolId === "builtin.deepagents.write_todos";
  }), "统一工具注册表不能继续保留 builtin.deepagents.write_todos 包装工具");
  assert(!listUnifiedToolCapabilities().some((capability) => {
    return capability.toolId === "builtin.todo.list";
  }), "统一工具注册表不能继续保留旧 builtin.todo.list 能力");

  const formattedTime = formatCenterLocalDateTime(new Date(2026, 5, 11, 9, 8, 7));
  assert(formattedTime === "2026-06-11 09:08:07", `中心服务本机时间格式错误：${formattedTime}`);
  assert(LOCAL_DATE_TIME_PATTERN.test(formatCenterLocalDateTime()), "当前中心服务本机时间格式不符合 YYYY-MM-DD HH:mm:ss");

  await assertNoIsoTimeInTargetFile("services/center/src/domain/agent-domain.ts");
  await assertNoIsoTimeInTargetFile("services/center/src/domain/workflow-domain.ts");
  await assertNoIsoTimeInTargetFile("services/center/src/tools/CreateAgentTeamStructuredTool.ts");
  await assertNoIsoTimeInTargetFile("services/center/src/tools/AddAgentTeamMemberStructuredTool.ts");
  await assertNoIsoTimeInTargetFile("services/center/src/events.ts");
}

/**
 * assertNoIsoTimeInTargetFile：检查智能体创建链路不再直接写 UTC ISO 时间。
 *
 * @param pathInProject 项目相对路径。
 * @returns 检查完成后没有返回值。
 */
async function assertNoIsoTimeInTargetFile(pathInProject: string): Promise<void> {
  // source: 静态检查用于避开本机 better-sqlite3 原生模块版本差异，同时锁定创建链路的时间口径。
  const source = await readFile(
    pathInProject,
    "utf-8",
  );
  assert(!source.includes("toISOString()"), `${pathInProject} 仍直接使用 UTC ISO 时间`);
}

void main().catch((error) => {
  // catch: 输出原始错误，便于定位权限或时间格式问题。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态。
  process.exitCode = 1;
});
