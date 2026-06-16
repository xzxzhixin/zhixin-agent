/**
 * 中心服务源码组织与会话 team 工具回归检查。
 *
 * 用途：作为本轮 TDD 红灯，证明中心服务 API、domain、tools 边界和
 * 主智能体会话级 team 工具已经按确认口径落地。
 * 关键逻辑：只扫描源码结构和关键实现信号，不调用 TypeScript 编译器。
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  join,
  relative,
} from "node:path";

// root: 仓库根目录，来源于当前脚本执行目录。
const root = process.cwd();
// failures: 汇总所有失败，便于一次红灯暴露完整缺口。
const failures = [];

/**
 * readText：读取 UTF-8 文本文件。
 *
 * @param {string} relativePath 仓库相对路径。
 * @returns {string} 文件内容；文件缺失时返回空字符串并记录失败。
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
 * listFiles：递归列出目录下所有文件。
 *
 * @param {string} relativeDirectory 仓库相对目录。
 * @returns {string[]} 仓库相对文件路径列表。
 */
function listFiles(relativeDirectory) {
  const absoluteDirectory = join(
    root,
    relativeDirectory,
  );
  if (!existsSync(absoluteDirectory)) {
    failures.push(`${relativeDirectory}: 目录不存在。`);
    return [];
  }
  return readdirSync(absoluteDirectory).flatMap((name) => {
    const absolutePath = join(
      absoluteDirectory,
      name,
    );
    const relativePath = join(
      relativeDirectory,
      name,
    );
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      return listFiles(relativePath);
    }
    return [
      relative(
        root,
        absolutePath,
      ),
    ];
  });
}

/**
 * assertExists：断言文件或目录存在。
 *
 * @param {string} relativePath 仓库相对路径。
 * @param {string} message 失败说明。
 */
function assertExists(
  relativePath,
  message,
) {
  if (!existsSync(join(
    root,
    relativePath,
  ))) {
    failures.push(message);
  }
}

/**
 * assertNotExists：断言文件或目录不存在。
 *
 * @param {string} relativePath 仓库相对路径。
 * @param {string} message 失败说明。
 */
function assertNotExists(
  relativePath,
  message,
) {
  if (existsSync(join(
    root,
    relativePath,
  ))) {
    failures.push(message);
  }
}

/**
 * assertIncludes：断言文本包含指定片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 必须存在的片段。
 * @param {string} message 失败说明。
 */
function assertIncludes(
  source,
  fragment,
  message,
) {
  if (!source.includes(fragment)) {
    failures.push(message);
  }
}

/**
 * assertNotRegex：断言文本不匹配指定正则。
 *
 * @param {string} source 源码文本。
 * @param {RegExp} pattern 禁止出现的模式。
 * @param {string} message 失败说明。
 */
function assertNotRegex(
  source,
  pattern,
  message,
) {
  if (pattern.test(source)) {
    failures.push(message);
  }
}

assertExists(
  "services/center/src/domain",
  "services/center/src/domain: 必须集中承载领域模块。",
);
assertExists(
  "services/center/src/domain/index.ts",
  "services/center/src/domain/index.ts: 必须提供领域模块聚合出口。",
);

[
  "agent-domain.ts",
  "provider-domain.ts",
  "session-domain.ts",
  "session-guidance-domain.ts",
  "session-query-domain.ts",
  "session-turn-effects.ts",
  "tokenizer-domain.ts",
  "usage-domain.ts",
  "workflow-domain.ts",
  "extension-domain.ts",
  "turn-graph-domain.ts",
].forEach((fileName) => {
  assertNotExists(
    `services/center/src/${fileName}`,
    `services/center/src/${fileName}: 领域实现不能继续散落在根目录。`,
  );
});

[
  "tool-runtime.ts",
  "tool-runtime-command.ts",
  "tool-runtime-mcp.ts",
].forEach((fileName) => {
  assertNotExists(
    `services/center/src/${fileName}`,
    `services/center/src/${fileName}: 工具运行时必须迁入 services/center/src/StructuredTool。`,
  );
});

[
  "index.ts",
  "tool-capability-registry.ts",
  "tool-model-specs.ts",
  "tool-events.ts",
  "command-tool-executor.ts",
  "CenterStructuredToolBase.ts",
  "CommandStructuredTool.ts",
  "mcp-adapter-config.ts",
  "mcp-tool-specs.ts",
  "McpToolProvider.ts",
  "McpToolWrapperStructuredTool.ts",
  "McpToolResultNormalizer.ts",
  "StdioMcpSession.ts",
  "CreateLongTermAgentStructuredTool.ts",
  "CreateSubAgentStructuredTool.ts",
  "CreateAgentTeamStructuredTool.ts",
  "DisbandAgentTeamStructuredTool.ts",
  "AddAgentTeamMemberStructuredTool.ts",
  "RemoveAgentTeamMemberStructuredTool.ts",
].forEach((fileName) => {
  assertExists(
    `services/center/src/StructuredTool/${fileName}`,
    `services/center/src/StructuredTool/${fileName}: 工具目录缺少确认后的工具模块。`,
  );
});

[
  "mcp-tool-executor.ts",
  "DynamicMcpStructuredTool.ts",
].forEach((fileName) => {
  assertNotExists(
    `services/center/src/StructuredTool/${fileName}`,
    `services/center/src/StructuredTool/${fileName}: Deep Agents MCP 主路径必须使用官方 @langchain/mcp-adapters。`,
  );
});

[
  "core.ts",
  "auth.ts",
  "project.ts",
  "session.ts",
  "task.ts",
  "agent.ts",
  "memory.ts",
  "tokenizer.ts",
  "extension.ts",
  "mcp.ts",
  "skill.ts",
  "capability.ts",
  "personal.ts",
  "notification.ts",
  "execution-mode.ts",
  "worker.ts",
  "engine.ts",
  "approval.ts",
  "attachment.ts",
  "audit.ts",
].forEach((fileName) => {
  assertExists(
    `services/center/src/api/${fileName}`,
    `services/center/src/api/${fileName}: /api/{资源} 路由必须拆成独立文件。`,
  );
});

const apiRoutes = readText("services/center/src/api/api-routes.ts");
assertNotRegex(
  apiRoutes,
  /app\.(get|post)\(\s*["']\/api\//,
  "services/center/src/api/api-routes.ts: 聚合入口不能继续直接注册 /api 路由。",
);

const database = readText("services/center/src/database.ts");
assertIncludes(
  database,
  "CREATE TABLE IF NOT EXISTS agent_teams",
  "database.ts: 缺少会话级 agent_teams 表。",
);
assertIncludes(
  database,
  "CREATE TABLE IF NOT EXISTS agent_team_members",
  "database.ts: 缺少会话级 agent_team_members 表。",
);

const sessionRepository = readText("services/center/src/data-access/session-repository.ts");
assertIncludes(
  sessionRepository,
  "DELETE FROM agent_teams",
  "session-repository.ts: 会话删除必须物理删除该会话的 team 记录。",
);
assertIncludes(
  sessionRepository,
  "DELETE FROM agent_team_members",
  "session-repository.ts: 会话删除必须物理删除该会话的 team 成员关系。",
);

const toolSources = listFiles("services/center/src/StructuredTool")
  .filter((filePath) => filePath.endsWith(".ts"))
  .map((filePath) => readText(filePath))
  .join("\n");
[
  "create-agent-team",
  "disband-agent-team",
  "add-agent-team-member",
  "remove-agent-team-member",
].forEach((toolName) => {
  assertIncludes(
    toolSources,
    toolName,
    `tools: 缺少 ${toolName} 会话级 team 工具注册或实现。`,
  );
});
assertIncludes(
  toolSources,
  "main",
  "tools: team 工具必须限制主智能体作为创建者和协调者。",
);
assertIncludes(
  toolSources,
  "enabled",
  "tools: team 成员必须校验长期智能体启用状态。",
);

if (failures.length > 0) {
  console.error("中心服务源码组织与会话 team 工具检查失败：");
  failures.forEach((failure) => {
    console.error(`- ${failure}`);
  });
  process.exit(1);
}

console.log("中心服务源码组织与会话 team 工具检查通过。");

