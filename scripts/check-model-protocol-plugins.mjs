import {
  existsSync,
  readFileSync,
} from "node:fs";

/**
 * assertIncludes：检查文件中必须包含指定片段。
 *
 * @param filePath 仓库相对路径。
 * @param needle 必须出现的源码或文档片段。
 * @param message 失败时展示的业务原因。
 * @returns 没有返回值。
 */
function assertIncludes(filePath, needle, message) {
  const content = readFileSync(filePath, "utf-8");
  if (!content.includes(needle)) {
    throw new Error(`${message}：${filePath} 缺少 ${needle}`);
  }
}

/**
 * assertNotIncludes：检查文件中不能包含指定片段。
 *
 * @param filePath 仓库相对路径。
 * @param needle 禁止出现的源码或文档片段。
 * @param message 失败时展示的业务原因。
 * @returns 没有返回值。
 */
function assertNotIncludes(filePath, needle, message) {
  const content = readFileSync(filePath, "utf-8");
  if (content.includes(needle)) {
    throw new Error(`${message}：${filePath} 仍包含 ${needle}`);
  }
}

if (existsSync("plugins/builtin-model-openai-compatible")) {
  throw new Error("OpenAI 内置已经是中心服务固定适配器，不允许继续保留 plugins/builtin-model-openai-compatible 包。");
}

assertIncludes(
  "services/center/src/domain/provider-domain.ts",
  "OPENAI_LANGCHAIN_PROTOCOL_PROVIDER",
  "中心服务必须提供 OpenAI LangChain 内联协议提供方",
);
assertIncludes(
  "services/center/src/domain/provider-domain.ts",
  "ANTHROPIC_LANGCHAIN_PROTOCOL_PROVIDER",
  "中心服务必须提供 Anthropic LangChain 内联协议提供方",
);
assertNotIncludes(
  "services/center/src/domain/provider-domain.ts",
  "listBuiltinModelAdapterPlugins",
  "当前阶段不允许继续从 plugins/builtin-model-* 动态扫描协议适配器",
);
assertNotIncludes(
  "services/center/src/domain/provider-domain.ts",
  "model-adapter.json",
  "当前阶段不允许继续读取模型适配器插件声明",
);
assertNotIncludes(
  "scripts/dev-desktop-shell.mjs",
  "buildBuiltinPlugins",
  "dev:desktop-shell 当前阶段不应构建内置插件",
);
assertNotIncludes(
  "scripts/dev-desktop-shell.mjs",
  "syncBuiltinPluginsToCenterDirectory",
  "dev:desktop-shell 当前阶段不应同步内置插件到中心目录",
);
assertIncludes(
  "apps/frontend/src/views/Providers/RouterIndex.vue",
  "LangChain",
  "供应商页面必须说明 OpenAI 和 Anthropic 直接使用 LangChain",
);
assertNotIncludes(
  "apps/frontend/src/views/Providers/RouterIndex.vue",
  "协议插件",
  "供应商页面不能继续显示旧字段名协议插件",
);
assertIncludes(
  "apps/frontend/src/stores/app-helpers.ts",
  "openai-langchain",
  "前端新增供应商默认必须使用 OpenAI LangChain 内联提供方",
);

console.log("模型协议 LangChain 内联静态检查通过。");
