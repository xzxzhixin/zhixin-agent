/**
 * Deep Agents、LangGraphJS、Mem0 和中心服务配置页回归检查。
 *
 * 用途：确保本轮新增的 Deep Agents 执行内核、底层执行图、语义记忆和中心目录迁移口径不会退化。
 * 关键逻辑：静态检查依赖、运行器、记忆适配层、中心服务页面内编辑面板和文档计划同步。
 */
import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

const root = process.cwd();
const failures = [];

/**
 * readText：读取仓库内文本文件。
 *
 * @param {string} pathInProject 仓库相对路径。
 * @returns {string} 文件内容。
 */
function readText(pathInProject) {
  return readFileSync(
    join(
      root,
      pathInProject,
    ),
    "utf-8",
  );
}

/**
 * assertIncludes：断言文本包含指定片段。
 *
 * @param {string} file 文件路径。
 * @param {string} source 文件内容。
 * @param {string} fragment 必须出现的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(
  file,
  source,
  fragment,
  message,
) {
  if (!source.includes(fragment)) {
    failures.push(`${file}: ${message}`);
  }
}

/**
 * assertNotIncludes：断言文本不包含指定片段。
 *
 * @param {string} file 文件路径。
 * @param {string} source 文件内容。
 * @param {string} fragment 禁止出现的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotIncludes(
  file,
  source,
  fragment,
  message,
) {
  if (source.includes(fragment)) {
    failures.push(`${file}: ${message}`);
  }
}

/**
 * assertFileExists：断言仓库内文件存在。
 *
 * @param {string} file 文件路径。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertFileExists(
  file,
  message,
) {
  if (!existsSync(join(root, file))) {
    failures.push(`${file}: ${message}`);
  }
}

const rootPackage = readText("package.json");
const centerPackage = readText("services/center/package.json");
const centerPage = readText("apps/frontend/src/views/Center/RouterIndex.vue");
const appStore = readText("apps/frontend/src/stores/app.ts");
const desktopMain = readText("apps/desktop-shell/src/main.ts");
const requirements = readText("需求.md");
const architecture = readText("架构.md");
const design = readText("设计.md");

assertIncludes(
  "services/center/package.json",
  centerPackage,
  "\"deepagents\"",
  "中心服务必须依赖 Deep Agents 作为主执行内核。",
);
assertIncludes(
  "services/center/package.json",
  centerPackage,
  "\"@langchain/langgraph\"",
  "中心服务必须依赖 LangGraphJS 作为 Deep Agents 底层执行图能力。",
);
assertIncludes(
  "services/center/package.json",
  centerPackage,
  "\"@langchain/langgraph-checkpoint-sqlite\"",
  "中心服务必须依赖 LangGraphJS SQLite checkpointer。",
);
assertIncludes(
  "services/center/package.json",
  centerPackage,
  "\"mem0ai\"",
  "中心服务必须依赖 Mem0 OSS 记忆引擎。",
);
assertNotIncludes(
  "package.json",
  rootPackage,
  "tsc --noEmit",
  "根脚本不得引入 TypeScript 编译器检查。",
);

assertFileExists(
  "services/center/src/deepagents-runner.ts",
  "必须建立 Deep Agents 主执行内核适配层。",
);
assertFileExists(
  "services/center/src/memory-engine.ts",
  "必须建立 Mem0 记忆引擎适配层。",
);

if (existsSync(join(root, "services/center/src/deepagents-runner.ts"))) {
  const deepAgentsRunner = readText("services/center/src/deepagents-runner.ts");
  for (const signal of [
    "createDeepAgent",
    "StateGraph",
    "START",
    "END",
    ".addNode(\"thinking.context\"",
    ".addNode(\"model.stream\"",
    ".addConditionalEdges(",
    "thread_id",
    "sessionId",
    "turnId",
  ]) {
    assertIncludes(
      "services/center/src/deepagents-runner.ts",
      deepAgentsRunner,
      signal,
      `Deep Agents runner 缺少核心信号：${signal}`,
    );
  }
}

if (existsSync(join(root, "services/center/src/domain/session-domain.ts"))) {
  const sessionDomain = readText("services/center/src/domain/session-domain.ts");
  for (const signal of [
    "export async function completeCreatedTurn",
    "runDeepAgentsTurn(",
    "payload: withTurnGraphCheckpoint",
  ]) {
    assertIncludes(
      "services/center/src/domain/session-domain.ts",
      sessionDomain,
      signal,
      `会话域缺少 Deep Agents 轮次闭环信号：${signal}`,
    );
  }
}

if (existsSync(join(root, "services/center/src/memory-engine.ts"))) {
  const memoryEngine = readText("services/center/src/memory-engine.ts");
  for (const signal of [
    "mem0ai/oss",
    "historyDbPath",
    "vectorStore",
    "dbPath",
    "memory/mem0",
    "sourceSessionId",
    "sourceTurnId",
    "sourceMemoryPath",
  ]) {
    assertIncludes(
      "services/center/src/memory-engine.ts",
      memoryEngine,
      signal,
      `Mem0 适配层缺少中心目录迁移或来源追溯信号：${signal}`,
    );
  }
}

assertNotIncludes(
  "apps/frontend/src/views/Center/RouterIndex.vue",
  centerPage,
  "<el-dialog",
  "中心服务配置页不得继续使用弹窗编辑。",
);
assertNotIncludes(
  "apps/frontend/src/views/Center/RouterIndex.vue",
  centerPage,
  "打开配置",
  "中心服务页面不得继续展示打开配置按钮。",
);
assertIncludes(
  "apps/frontend/src/views/Center/RouterIndex.vue",
  centerPage,
  "center-service-form",
  "中心服务页面必须直接展示配置表单。",
);
assertIncludes(
  "apps/frontend/src/views/Center/RouterIndex.vue",
  centerPage,
  "saveDesktopConfig",
  "中心服务页面必须提供保存桌面中心服务配置动作。",
);
assertIncludes(
  "apps/frontend/src/views/Center/RouterIndex.vue",
  centerPage,
  "saveRemoteAccessAccount",
  "中心服务页面必须提供保存远程访问账号动作。",
);
assertIncludes(
  "apps/frontend/src/views/Center/RouterIndex.vue",
  centerPage,
  "选择中心目录",
  "中心服务页面必须提供中心目录切换入口。",
);
assertIncludes(
  "apps/frontend/src/stores/app.ts",
  appStore,
  "restartRequired",
  "保存中心目录或端口后必须暴露重启或已重启状态。",
);
assertIncludes(
  "apps/desktop-shell/src/main.ts",
  desktopMain,
  "stopManagedCenterService",
  "桌面端切换中心目录前必须停止当前中心服务。",
);
assertIncludes(
  "apps/desktop-shell/src/main.ts",
  desktopMain,
  "initializeCenterDirectory",
  "桌面端必须校验或初始化新的中心目录。",
);

for (const [
  file,
  source,
] of [
  [
    "需求.md",
    requirements,
  ],
  [
    "架构.md",
    architecture,
  ],
  [
    "设计.md",
    design,
  ],
]) {
  assertIncludes(
    file,
    source,
    "Deep Agents",
    "文档和计划必须同步 Deep Agents 执行内核方案。",
  );
}

for (const [
  file,
  source,
] of [
  [
    "需求.md",
    requirements,
  ],
  [
    "架构.md",
    architecture,
  ],
]) {
  assertIncludes(
    file,
    source,
    "Mem0",
    "文档和计划必须同步 Mem0 语义记忆方案。",
  );
  assertIncludes(
    file,
    source,
    "LangGraph",
    "文档和计划必须同步 LangGraphJS 核心执行图方案。",
  );
}

if (failures.length > 0) {
  console.error("Deep Agents、LangGraphJS、Mem0 和中心服务配置页回归检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Deep Agents、LangGraphJS、Mem0 和中心服务配置页回归检查通过。");
