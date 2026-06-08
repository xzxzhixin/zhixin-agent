/**
 * 阶段 1 协议导出检查脚本。
 *
 * 用途：验证共享协议、OpenAI 模型协议和插件 SDK 是否导出计划要求的关键类型和值。
 * 关键逻辑：直接读取源码入口并做导出声明静态匹配，避免把 tsc 作为语法检查或质量门槛。
 * 参数：无。
 * 返回值：检查通过时退出码为 0；缺少导出声明时退出码非 0。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * checks: 阶段 1 计划要求存在的关键导出。
 */
const checks = [
  {
    filePath: "packages/shared/src/index.ts",
    exports: [
      "APP_NAME",
      "DEFAULT_CENTER_PORT",
      "CENTER_DATA_DIR_NAME",
      "ApiResponse",
      "ApiError",
      "ClientType",
      "EntryMode",
      "TaskStatus",
      "AgentRuntimeStatus",
      "ExecutionMode",
      "ProjectRecord",
      "ConversationSession",
      "ConversationMessage",
      "ConversationTurn",
      "TaskRecord",
      "EventRecord",
      "AttachmentRecord",
      "NotificationEvent",
      "UsageRecord",
      "RuntimeConfig",
      "PersonalTodo",
      "CalendarEvent",
      "KnowledgeItem",
      "InternalFileLink",
      "WebSocketEnvelope",
      "INTERNAL_FILE_LINK_PROTOCOL",
      "encodeInternalFileLink",
      "decodeInternalFileLink",
    ],
  },
  {
    filePath: "services/center/src/openai-chat-protocol.ts",
    exports: [
      "OpenAiChatRequest",
      "OpenAiChatMessage",
      "OpenAiToolSpec",
      "OpenAiToolCall",
      "OpenAiUsage",
    ],
  },
  {
    filePath: "packages/plugin-sdk/src/index.ts",
    exports: [
      "PluginManifest",
      "PluginSource",
      "PluginScope",
      "PluginPermission",
      "PluginConfigSchema",
      "ExtensionCallRecord",
      "PluginApiDescriptor",
    ],
  },
];

/**
 * missingExports: 未找到的导出声明。
 */
const missingExports = [];

for (const check of checks) {
  // source: 当前入口源码文本，直接读取是为了检查协议导出清单是否稳定。
  const source = readFileSync(
    join(
      process.cwd(),
      check.filePath,
    ),
    "utf-8",
  );

  for (const exportName of check.exports) {
    // exportPattern: 只匹配显式 export 声明，避免普通注释或局部变量误判为协议导出。
    const exportPattern = new RegExp(
      `export\\s+(?:declare\\s+)?(?:type\\s+)?(?:interface|type|const|enum|function|class)\\s+${exportName}\\b`,
      "u",
    );
    // reExportPattern: 兼容入口文件底部集中 re-export 的既有协议组织方式。
    const reExportPattern = new RegExp(
      `export\\s*\\{[\\s\\S]*\\b${exportName}\\b[\\s\\S]*\\}`,
      "u",
    );

    if (!exportPattern.test(source) && !reExportPattern.test(source)) {
      missingExports.push(`${check.filePath} -> ${exportName}`);
    }
  }
}

if (missingExports.length > 0) {
  console.error("阶段 1 协议导出缺失：");
  for (const missingExport of missingExports) {
    console.error(`- ${missingExport}`);
  }
  process.exitCode = 1;
}
