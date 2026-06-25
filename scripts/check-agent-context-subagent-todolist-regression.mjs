import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// root: 仓库根目录，来源于脚本执行目录。
const root = process.cwd();
// failures: 收集所有失败，便于一次性输出本轮智能体上下文边界缺口。
const failures = [];

/**
 * readText：读取项目内 UTF-8 文本。
 *
 * @param {string} relativePath 仓库相对路径。
 * @returns {string} 文件文本；文件缺失时返回空字符串。
 */
function readText(relativePath) {
  const absolutePath = join(
    root,
    relativePath,
  );
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: 文件不存在。`);
    return "";
  }
  return readFileSync(
    absolutePath,
    "utf-8",
  );
}

/**
 * assertIncludes：断言源码或文档必须包含指定片段。
 *
 * @param {string} source 被检查文本。
 * @param {string} fragment 必须存在的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(
  source,
  fragment,
  message,
) {
  if (!source.includes(fragment)) {
    failures.push(`${message}\n缺少片段：${fragment}`);
  }
}

/**
 * assertNotIncludes：断言源码不能包含指定片段。
 *
 * @param {string} source 被检查文本。
 * @param {string} fragment 禁止存在的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotIncludes(
  source,
  fragment,
  message,
) {
  if (source.includes(fragment)) {
    failures.push(`${message}\n禁止片段：${fragment}`);
  }
}

// requirementDoc: 产品需求事实源，必须记录本轮智能体上下文和 todoList 口径。
const requirementDoc = readText("需求.md");
// architectureDoc: 架构事实源，必须记录运行时 agentId 边界和 Deep Agents 原生子智能体规则。
const architectureDoc = readText("架构.md");
// planDoc: 计划事实源，必须记录本轮实现阶段。
const planDoc = readText("计划.md");
// appManagementActions: 前端 token 统计请求来源。
const appManagementActions = readText("apps/frontend/src/stores/app-management-actions.ts");
// appTypes: 前端状态类型来源。
const appTypes = readText("apps/frontend/src/stores/app-types.ts");
// centerTypes: 中心服务运行时类型来源。
const centerTypes = readText("services/center/src/types.ts");
// workflowDomain: 子智能体运行记录创建来源。
const workflowDomain = readText("services/center/src/domain/workflow-domain.ts");
// baseAgent: 智能体基类来源。
const baseAgent = readText("services/center/src/agents/base-agent.ts");
// toolRegistry: 中心服务模型工具注册表。
const toolRegistry = readText("services/center/src/StructuredTool/tool-capability-registry.ts");
// deepAgentsTypes: Deep Agents 包类型定义，用于确认原生 task 子智能体工具存在。
const deepAgentsTypes = readText("node_modules/deepagents/dist/index.d.ts");

assertIncludes(
  requirementDoc,
  "每个智能体都必须维护自己的上下文。",
  "需求.md 必须明确每个 agent 维护自己的上下文。",
);
assertIncludes(
  requirementDoc,
  "所有智能体都可以在长任务拆解或任务执行需要时维护自己的 todoList",
  "需求.md 必须明确所有智能体按权限维护自己的 todoList。",
);
assertIncludes(
  architectureDoc,
  "Deep Agents 原生 `task` 工具",
  "架构.md 必须明确短期子智能体委派由 Deep Agents 原生 task 工具承载。",
);
assertIncludes(
  planDoc,
  "## 本轮阶段：运行中回车排队与智能体上下文边界",
  "计划.md 必须记录本轮智能体上下文边界阶段。",
);

assertIncludes(
  appManagementActions,
  "agentId",
  "token 统计请求必须纳入当前 agentId。",
);
assertIncludes(
  appManagementActions,
  "agentId: this.activeConversationAgentId",
  "tokenizer.count 入参必须传递当前对话窗口 agentId。",
);
assertIncludes(
  appManagementActions,
  "agentId: this.activeConversationAgentId",
  "token 统计窗口 key 必须绑定当前 agentId，避免不同智能体上下文互相覆盖。",
);
assertIncludes(
  appTypes,
  "activeConversationAgentId",
  "前端状态必须保存当前对话窗口正在统计的 agentId。",
);

assertIncludes(
  centerTypes,
  "parentProviderId",
  "SubAgentRuntimeRecord 必须保存父级当前供应商 ID。",
);
assertIncludes(
  centerTypes,
  "parentModelId",
  "SubAgentRuntimeRecord 必须保存父级当前模型 ID。",
);
assertIncludes(
  centerTypes,
  "parentReasoningEffort",
  "SubAgentRuntimeRecord 必须保存父级决定的推理深度。",
);
assertIncludes(
  workflowDomain,
  "parentProviderId",
  "子智能体运行记录创建时必须写入父级当前供应商 ID。",
);
assertIncludes(
  deepAgentsTypes,
  "\"task\"",
  "Deep Agents 依赖必须提供原生 task 子智能体工具。",
);
assertIncludes(
  deepAgentsTypes,
  "createSubAgentMiddleware",
  "Deep Agents 依赖必须提供原生子智能体 middleware。",
);
assertNotIncludes(
  toolRegistry,
  "builtin.agent.createSubAgent",
  "中心服务统一工具注册表不能继续暴露创建子智能体工具。",
);

assertNotIncludes(
  baseAgent,
  "canUseTodoListTool",
  "旧 todoList 工具链已删除，智能体基类不能继续暴露 todoList 权限入口。",
);
assertNotIncludes(
  baseAgent,
  "shouldCreateTodoListForTask",
  "旧 todoList 创建判断已删除，长任务步骤只能由 Deep Agents 原生 write_todos 桥接。",
);
assertNotIncludes(
  baseAgent,
  "return true;",
  "todoList 不能无条件创建，简单任务不创建 todoList。",
);

if (failures.length > 0) {
  console.error("智能体上下文、子智能体继承和 todoList 边界检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("智能体上下文、子智能体继承和 todoList 边界检查通过。");

