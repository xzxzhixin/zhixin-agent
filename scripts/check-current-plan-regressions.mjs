/**
 * 本轮 P01-P11 静态回归检查。
 *
 * 用途：约束固定命令接口、主对话引导、审计摘要、tokenizer、Drizzle 数据层和智能体树等本轮改动不回退。
 * 关键逻辑：只读取授权范围内文件，不执行 TypeScript 编译器检查。
 */
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";

/**
 * root: 项目根目录。
 */
const root = process.cwd();

/**
 * failures: 收集全部失败项，便于一次性反馈。
 */
const failures = [];

/**
 * readText：读取 UTF-8 文本。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件内容。
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
 * listFiles：递归列出目录中的目标文件。
 *
 * @param {string} relativeDirectory 项目相对目录。
 * @param {(path: string) => boolean} predicate 文件过滤函数。
 * @returns {string[]} 项目相对文件路径。
 */
function listFiles(
    relativeDirectory,
    predicate,
) {
  const absoluteDirectory = join(
    root,
    relativeDirectory,
  );
  return readdirSync(absoluteDirectory).flatMap((name) => {
    const relativePath = join(
      relativeDirectory,
      name,
    );
    const absolutePath = join(
      root,
      relativePath,
    );
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      if (name === "node_modules" || name === "dist") {
        return [];
      }
      return listFiles(
        relativePath,
        predicate,
      );
    }
    return predicate(relativePath)
      ? [
        relativePath,
      ]
      : [];
  });
}

/**
 * assertNotIncludes：断言文件不包含指定信号。
 *
 * @param {string} file 项目相对文件。
 * @param {string} signal 禁止出现的文本。
 * @param {string} message 失败说明。
 */
function assertNotIncludes(
    file,
    signal,
    message,
) {
  if (readText(file).includes(signal)) {
    failures.push(`${file}: ${message}`);
  }
}

/**
 * assertIncludes：断言文件包含指定信号。
 *
 * @param {string} file 项目相对文件。
 * @param {string} signal 必须出现的文本。
 * @param {string} message 失败说明。
 */
function assertIncludes(
    file,
    signal,
    message,
) {
  if (!readText(file).includes(signal)) {
    failures.push(`${file}: ${message}`);
  }
}

const frontendFiles = listFiles(
  "apps/frontend/src",
  (file) => file.endsWith(".ts") || file.endsWith(".vue"),
);
const centerFiles = listFiles(
  "services/center/src",
  (file) => file.endsWith(".ts"),
);
const packageFiles = [
  ...listFiles(
    "packages/shared/src",
    (file) => file.endsWith(".ts"),
  ),
  ...listFiles(
    "packages/api-client/src",
    (file) => file.endsWith(".ts"),
  ),
];

for (const file of [
  ...frontendFiles,
  ...centerFiles,
  ...packageFiles,
]) {
  assertNotIncludes(
    file,
    "node-version",
    "不得保留固定 Node 版本专用工具 API。",
  );
  assertNotIncludes(
    file,
    "Node 版本",
    "不得保留固定 Node 版本按钮或文案。",
  );
}

assertNotIncludes(
  "apps/frontend/src/views/Chat/RouterIndex.vue",
  "主对话引导",
  "不得保留独立主对话引导入口。",
);
assertNotIncludes(
  "apps/frontend/src/views/Chat/RouterIndex.vue",
  "审计摘要",
  "不得保留右侧审计摘要常驻模块。",
);
assertNotIncludes(
  "apps/frontend/src/stores/app-helpers.ts",
  "estimateComposerContextUsedTokens",
  "不得保留字符数临时 token 估算函数。",
);

assertIncludes(
  "packages/shared/src/index.ts",
  "TokenizerCountRequest",
  "必须定义 tokenizer 请求协议。",
);
assertIncludes(
  "packages/shared/src/index.ts",
  "TokenizerCountResponse",
  "必须定义 tokenizer 响应协议。",
);
assertIncludes(
  "services/center/src/tokenizer-domain.ts",
  "BuiltInTokenizerAdapter",
  "必须提供中心服务内置 tokenizer 适配器。",
);
assertIncludes(
  "apps/frontend/src/stores/app-management-actions.ts",
  "countComposerContextTokens",
  "输入区上下文统计必须调用中心服务 tokenizer。",
);
assertIncludes(
  "services/center/src/tool-runtime.ts",
  "runCommandTool",
  "通用命令工具必须使用统一运行入口。",
);
assertIncludes(
  "services/center/src/tool-runtime.ts",
  "UNIFIED_TOOL_CAPABILITY_REGISTRY",
  "必须建立统一工具能力注册表。",
);
assertIncludes(
  "services/center/src/tool-runtime.ts",
  "listAvailableModelToolSpecs",
  "Agent 编排必须把统一工具能力转换为模型工具定义。",
);
assertIncludes(
  "services/center/src/tool-runtime.ts",
  "buildUnifiedToolCallIntentFromModelCall",
  "Agent 编排必须从模型工具请求转换统一工具调用意图。",
);
assertIncludes(
  "services/center/src/session-domain.ts",
  "continueProviderModelGatewayWithToolResults",
  "命令工具真实执行结果必须回填模型后再生成助手最终回复。",
);
assertNotIncludes(
  "services/center/src/session-domain.ts",
  "export function planCommandToolForUserText",
  "session-domain 不得保留重复命令工具规划函数。",
);
assertIncludes(
  "services/center/src/data-access/schema.ts",
  "sqliteTable",
  "必须建立 Drizzle schema 文件。",
);
assertIncludes(
  "services/center/src/data-access/database-adapter.ts",
  "drizzle",
  "必须建立 Drizzle better-sqlite3 适配边界。",
);
assertIncludes(
  "apps/frontend/src/views/Chat/dialogs/AgentStatusDialog.vue",
  "el-tree",
  "智能体状态弹框必须使用可折叠树形结构。",
);
assertIncludes(
  "apps/frontend/src/views/Chat/dialogs/AgentConversationDialog.vue",
  "agent-dialog-entry-strip",
  "智能体对话区域必须复用完整输入框入口能力。",
);
assertIncludes(
  "apps/frontend/src/views/Chat/RouterIndex.vue",
  "submitGuidanceForQueuedMessage",
  "排队消息后方必须存在限定作用域的引导提交入口。",
);
assertIncludes(
  "apps/frontend/src/views/Chat/useMessageListAutoScroll.ts",
  "isMessageListPinnedToBottom",
  "消息列表必须维护用户是否在底部状态，支持历史查看时暂停自动贴底。",
);
assertIncludes(
  "apps/frontend/src/views/Chat/RouterIndex.vue",
  "data-auto-scroll=\"pinned-to-bottom\"",
  "消息列表必须声明贴底滚动容器，避免页面级滚动。",
);
assertIncludes(
  "apps/frontend/src/views/Usage/RouterIndex.vue",
  "providerName 来自供应商配置",
  "用量统计必须展示供应商名称筛选来源。",
);
assertIncludes(
  "services/center/src/data-access/usage-repository.ts",
  "projects.display_name = ?",
  "用量统计项目名称筛选必须使用 projects.display_name 单一来源。",
);
assertNotIncludes(
  "apps/frontend/src/views/Usage/RouterIndex.vue",
  "<h2 class=\"section-title\">\n        聚合统计",
  "用量统计页不得继续展示聚合统计 JSON 列表标题。",
);
assertNotIncludes(
  "apps/frontend/src/views/Usage/RouterIndex.vue",
  "<h2 class=\"section-title\">\n        原始记录",
  "用量统计页不得继续展示原始记录 JSON 列表标题。",
);

const scriptText = readText("scripts/check-no-type-compiler.mjs");
if (!scriptText.includes("tsc --noEmit") || !scriptText.includes("vue-tsc")) {
  failures.push("scripts/check-no-type-compiler.mjs: 必须继续覆盖禁止 TypeScript 编译器质量门槛。");
}

if (failures.length > 0) {
  console.error("本轮 P01-P11 静态回归检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("本轮 P01-P11 静态回归检查通过。");
