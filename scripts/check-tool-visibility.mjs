import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();

/**
 * assertIncludes：断言目标文件包含指定文本。
 *
 * @param filePath 需要检查的文件绝对路径。
 * @param expectedText 必须存在的文本片段。
 * @param message 失败时输出的中文说明。
 */
function assertIncludes(filePath, expectedText, message) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.includes(expectedText)) {
    throw new Error(`${message}\n文件：${filePath}\n缺少：${expectedText}`);
  }
}

const mcpViewFilePath = path.join(
  workspaceRoot,
  "apps/frontend/src/views/Mcp/RouterIndex.vue",
);
const managementActionFilePath = path.join(
  workspaceRoot,
  "apps/frontend/src/stores/app-management-actions.ts",
);
const chatHelperFilePath = path.join(
  workspaceRoot,
  "apps/frontend/src/views/Chat/chat-view-helpers.ts",
);
const mcpToolSpecsFilePath = path.join(
  workspaceRoot,
  "services/center/src/tools/mcp-tool-specs.ts",
);
const mcpToolExecutorFilePath = path.join(
  workspaceRoot,
  "services/center/src/tools/mcp-tool-executor.ts",
);
const recordUtilsFilePath = path.join(
  workspaceRoot,
  "packages/shared/src/utils/record-utils.ts",
);
const jsonUtilsFilePath = path.join(
  workspaceRoot,
  "packages/shared/src/utils/json-utils.ts",
);
const mcpRequestUtilsFilePath = path.join(
  workspaceRoot,
  "packages/shared/src/utils/mcp-request-utils.ts",
);

assertIncludes(
  mcpViewFilePath,
  "formatMcpToolSchema(tool.inputSchema)",
  "MCP 管理页必须展示工具 inputSchema。",
);
assertIncludes(
  mcpViewFilePath,
  "tool.description",
  "MCP 管理页必须展示工具描述。",
);
assertIncludes(
  mcpViewFilePath,
  "tool.errorMessage",
  "MCP 管理页必须展示工具读取失败原因。",
);
assertIncludes(
  managementActionFilePath,
  "errorMessage: this.managementErrors.mcp || \"MCP 工具读取失败。\"",
  "MCP 工具读取失败时不能静默吞成空数组。",
);
assertIncludes(
  chatHelperFilePath,
  "hasVisibleRequestOrPlanEvent",
  "对话过程卡片必须保留仅有请求/计划阶段的工具过程。",
);
assertIncludes(
  jsonUtilsFilePath,
  "export function tryParseRecord(text: string): Record<string, unknown> | null",
  "JSON 工具模块必须导出 tryParseRecord。",
);
assertIncludes(
  recordUtilsFilePath,
  "export function isRecord(value: unknown): value is Record<string, unknown>",
  "Record 工具模块必须导出 isRecord。",
);
assertIncludes(
  mcpRequestUtilsFilePath,
  "export function randomMcpRequestId(method: string): string",
  "MCP 请求工具模块必须导出 randomMcpRequestId。",
);
assertIncludes(
  mcpToolSpecsFilePath,
  "from \"@zhixin/shared\"",
  "MCP tools/list 必须改为引用共享包。",
);
assertIncludes(
  mcpToolSpecsFilePath,
  "randomMcpRequestId",
  "MCP tools/list 必须从共享包读取 randomMcpRequestId。",
);
assertIncludes(
  mcpToolSpecsFilePath,
  "tryParseRecord",
  "MCP tools/list 必须从共享包读取 tryParseRecord。",
);
assertIncludes(
  mcpToolExecutorFilePath,
  "from \"@zhixin/shared\"",
  "MCP tools/call 必须改为引用共享包。",
);
assertIncludes(
  mcpToolExecutorFilePath,
  "randomMcpRequestId",
  "MCP tools/call 必须从共享包读取 randomMcpRequestId。",
);
assertIncludes(
  mcpToolExecutorFilePath,
  "tryParseRecord",
  "MCP tools/call 必须从共享包读取 tryParseRecord。",
);
assertIncludes(
  path.join(workspaceRoot, "services/center/src/tools/StdioMcpSession.ts"),
  "from \"@zhixin/shared\"",
  "StdioMcpSession 必须改为引用共享包。",
);
assertIncludes(
  path.join(workspaceRoot, "services/center/src/tools/StdioMcpSession.ts"),
  "randomMcpRequestId",
  "StdioMcpSession 必须从共享包读取 randomMcpRequestId。",
);
assertIncludes(
  path.join(workspaceRoot, "services/center/src/tools/StdioMcpSession.ts"),
  "tryParseRecord",
  "StdioMcpSession 必须从共享包读取 tryParseRecord。",
);
assertIncludes(
  mcpToolExecutorFilePath,
  "function stringifyMcpValue(value: unknown): string",
  "MCP tools/call 仍需保留本地输出摘要逻辑。",
);
assertIncludes(
  path.join(workspaceRoot, "services/center/src/domain/extension-domain.ts"),
  "import {isRecord} from \"@zhixin/shared\"",
  "中心服务 extension-domain 必须改为引用共享 isRecord。",
);
assertIncludes(
  path.join(workspaceRoot, "apps/frontend/src/stores/app-helpers.ts"),
  "isRecord,\n} from \"@zhixin/shared\"",
  "前端 app-helpers 必须改为引用共享 isRecord。",
);

console.log("check-tool-visibility: ok");
