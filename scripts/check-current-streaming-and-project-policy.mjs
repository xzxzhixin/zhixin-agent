import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * readProjectFile：读取项目内文本文件。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件内容。
 */
function readProjectFile(relativePath) {
  return readFileSync(
    join(
      process.cwd(),
      relativePath,
    ),
    "utf-8",
  );
}

/**
 * assertIncludes：检查文件内容包含必要信号。
 *
 * @param {string} content 文件内容。
 * @param {string} signal 必要信号。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(
  content,
  signal,
  message,
) {
  if (!content.includes(signal)) {
    throw new Error(message);
  }
}

/**
 * assertNotIncludes：检查文件内容不包含禁止信号。
 *
 * @param {string} content 文件内容。
 * @param {string} signal 禁止信号。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotIncludes(
  content,
  signal,
  message,
) {
  if (content.includes(signal)) {
    throw new Error(message);
  }
}

const packageJson = readProjectFile("package.json");
const modelGatewayRuntime = readProjectFile("services/center/src/model-gateway-runtime.ts");
const sessionDomain = readProjectFile("services/center/src/domain/session-domain.ts");
const chatRouter = readProjectFile("apps/frontend/src/views/Chat/RouterIndex.vue");
const appStore = readProjectFile("apps/frontend/src/stores/app.ts");
const appProjectActions = readProjectFile("apps/frontend/src/stores/app-project-actions.ts");
const agents = readProjectFile("AGENTS.md");
const architecture = readProjectFile("架构.md");
const plan = readProjectFile("计划.md");

assertNotIncludes(
  packageJson,
  "\"dev:center:new\"",
  "根 package.json 不能继续暴露中心服务独立启动脚本 dev:center:new。",
);
assertNotIncludes(
  modelGatewayRuntime,
  "stream: false",
  "模型网关请求不能关闭流式输出，真实供应商必须使用 stream: true。",
);
assertNotIncludes(
  modelGatewayRuntime,
  "spawnSync",
  "模型网关不能用同步子进程等待完整 HTTP 响应，否则 UI 会卡住。",
);
assertIncludes(
  modelGatewayRuntime,
  "for await",
  "模型网关必须使用 LangChain 流式迭代读取供应商输出。",
);
assertIncludes(
  modelGatewayRuntime,
  "appendProviderStreamDelta",
  "模型网关必须在收到 token/SSE delta 时立即追加 model.stream.delta 事件。",
);
assertIncludes(
  modelGatewayRuntime,
  "textDelta",
  "模型网关必须解析 OpenAI Chat Completions 的文本 delta 事件。",
);
assertIncludes(
  modelGatewayRuntime,
  "tool_calls",
  "模型网关必须解析 OpenAI Chat Completions 的结构化工具调用 delta。",
);
assertIncludes(
  sessionDomain,
  "runDeepAgentsAgentTurn",
  "会话执行链路必须进入 Deep Agents 原生入口，不能回到旧模型网关入口。",
);
assertNotIncludes(
  sessionDomain + modelGatewayRuntime,
  "invokeProviderModelGateway",
  "旧 invokeProviderModelGateway 入口已无真实调用方，不能继续残留。",
);
assertNotIncludes(
  sessionDomain + modelGatewayRuntime,
  "appendModelStreamEvent(events, sent.sessionId, sent.taskId, sent.turnId, modelResult)",
  "会话执行链路不能在完整响应后一次性追加流式片段。",
);
assertIncludes(
  appProjectActions,
  "showDirectoryPicker",
  "新增项目对话必须通过浏览器目录选择能力选择文件夹。",
);
assertIncludes(
  appProjectActions,
  "registerProjectFromDirectorySelection",
  "前端必须把选择到的文件夹登记为项目后再创建项目对话草稿。",
);
assertIncludes(
  appStore,
  "createProjectActions",
  "主 store 必须混入拆分后的项目动作，避免大文件继续膨胀。",
);
assertIncludes(
  chatRouter,
  "createProjectConversationFromDirectorySelection",
  "项目对话分组新增入口必须走选择文件夹流程。",
);
assertIncludes(
  chatRouter,
  "handleProjectGroupCreate",
  "项目对话分组新增入口必须由显式处理函数承载选择文件夹流程。",
);
assertIncludes(
  agents,
  "中心服务不允许独立启动",
  "AGENTS.md 必须写入中心服务只能由桌面端启停的协作规范。",
);
assertIncludes(
  agents,
  "项目对话测试",
  "AGENTS.md 必须写入项目对话测试目录规范。",
);
assertIncludes(
  agents,
  "用户后续提到的需求在 `需求.md` 中没有明确覆盖，必须先新增到 `需求.md`",
  "AGENTS.md 必须写入后续需求默认写入需求源的规则。",
);
assertIncludes(
  agents,
  "如果新需求与已有 `需求.md` 内容冲突，必须按 `需求.md` 的最新需求优先口径先修订 `需求.md`",
  "AGENTS.md 必须写入新需求优先于旧需求的规则。",
);
assertIncludes(
  agents,
  "`dev:frontend` 是前端 Vite 开发服务器的独立启动入口",
  "AGENTS.md 必须写入 dev:frontend 独立拉起前端的规则。",
);
assertIncludes(
  agents,
  "`dev:desktop-shell` 只启动桌面壳并由桌面壳拉起中心服务",
  "AGENTS.md 必须写入 dev:desktop-shell 不拉起前端的规则。",
);
assertIncludes(
  architecture,
  "禁止使用 `dev:center:new`",
  "架构文档必须写入禁止独立启动中心服务的运行边界。",
);
assertIncludes(
  plan,
  "真实供应商 token/SSE 级逐字模型回复",
  "计划必须同步本轮真实供应商流式回复任务。",
);

if (existsSync(join(process.cwd(), "services/center/center-data"))) {
  throw new Error("services/center/center-data 已删除要求未满足。");
}

console.log("current streaming and project policy checks passed");
