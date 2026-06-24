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
const modelProviderRuntimeFactory = readProjectFile("services/center/src/model-provider/ModelProviderRuntimeFactory.ts");
const sessionDomain = readProjectFile("services/center/src/domain/session-domain.ts");
const chatRouter = readProjectFile("apps/frontend/src/views/Chat/RouterIndex.vue");
const appStore = readProjectFile("apps/frontend/src/stores/app.ts");
const appProjectActions = readProjectFile("apps/frontend/src/stores/app-project-actions.ts");
const agents = readProjectFile("AGENTS.md");
const architecture = readProjectFile("架构.md");
const requirement = readProjectFile("需求.md");

assertNotIncludes(
  packageJson,
  "\"dev:center:new\"",
  "根 package.json 不能继续暴露中心服务独立启动脚本 dev:center:new。",
);
assertNotIncludes(
  modelProviderRuntimeFactory,
  "stream: false",
  "LangChain 模型运行时不能关闭流式输出，真实供应商必须使用流式输出。",
);
assertNotIncludes(
  modelProviderRuntimeFactory,
  "spawnSync",
  "模型供应商运行时不能用同步子进程等待完整 HTTP 响应，否则 UI 会卡住。",
);
assertIncludes(
  modelProviderRuntimeFactory,
  "new ChatOpenAI",
  "OpenAI 协议必须直接创建 LangChain ChatOpenAI。",
);
assertIncludes(
  modelProviderRuntimeFactory,
  "new ChatAnthropic",
  "Anthropic 协议必须直接创建 LangChain ChatAnthropic。",
);
assertIncludes(
  modelProviderRuntimeFactory,
  "streaming: true",
  "LangChain 模型运行时必须显式启用流式输出。",
);
assertNotIncludes(
  modelProviderRuntimeFactory,
  "AiSdkChatModelAdapter",
  "模型供应商运行时不能继续引用旧 AI SDK 适配器。",
);
assertIncludes(
  sessionDomain,
  "runDeepAgentsAgentTurn",
  "会话执行链路必须进入 Deep Agents 原生入口，不能回到旧模型网关入口。",
);
assertNotIncludes(
  sessionDomain + modelProviderRuntimeFactory,
  "invokeProviderModelGateway",
  "旧 invokeProviderModelGateway 入口已无真实调用方，不能继续残留。",
);
assertNotIncludes(
  sessionDomain + modelProviderRuntimeFactory,
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
  "中心服务**不允许独立启动**",
  "AGENTS.md 必须写入中心服务只能由桌面端启停的协作规范。",
);
assertIncludes(
  agents,
  "项目对话测试",
  "AGENTS.md 必须写入项目对话测试目录规范。",
);
assertIncludes(
  requirement,
  "中心服务 API 必须有真实业务调用方",
  "需求.md 必须写入 API 真实调用方和旧兼容接口删除规则。",
);
assertIncludes(
  requirement,
  "模型调用必须直接使用 LangChain 已支持的 OpenAI 和 Anthropic 协议能力",
  "需求.md 必须写入模型供应商 LangChain 协议口径。",
);
assertIncludes(
  agents,
  "`dev:frontend` – 独立启动前端 Vite 服务",
  "AGENTS.md 必须写入 dev:frontend 独立拉起前端的规则。",
);
assertIncludes(
  agents,
  "`dev:desktop-shell` – 启动桌面壳并拉起中心服务",
  "AGENTS.md 必须写入 dev:desktop-shell 不拉起前端的规则。",
);
assertIncludes(
  architecture,
  "禁止使用 `dev:center:new`",
  "架构文档必须写入禁止独立启动中心服务的运行边界。",
);
assertIncludes(
  requirement,
  "model_protocol = openai",
  "需求必须同步当前供应商模型协议字段任务。",
);

if (existsSync(join(process.cwd(), "services/center/center-data"))) {
  throw new Error("services/center/center-data 已删除要求未满足。");
}

console.log("current streaming and project policy checks passed");
