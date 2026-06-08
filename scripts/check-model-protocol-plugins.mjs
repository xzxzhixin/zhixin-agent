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
  "plugins/builtin-model-anthropic-messages/src/index.ts",
  "Anthropic 适配器",
  "Anthropic 模型适配器插件必须使用确认后的展示名",
);
assertIncludes(
  "services/center/src/provider-domain.ts",
  "OPENAI_BUILTIN_PROTOCOL_ADAPTER",
  "中心服务必须提供 OpenAI 内置固定协议适配器",
);
assertIncludes(
  "services/center/src/provider-domain.ts",
  "listModelProtocolAdapters",
  "中心服务必须从内置固定项和模型插件来源生成协议适配器列表",
);
assertIncludes(
  "services/center/src/provider-domain.ts",
  "builtin-model-",
  "协议适配器动态扫描范围必须限制为 plugins/builtin-model-*",
);
assertIncludes(
  "scripts/dev-desktop-shell.mjs",
  "buildBuiltinPlugins",
  "dev:desktop-shell 启动前必须构建内置插件",
);
assertIncludes(
  "scripts/dev-desktop-shell.mjs",
  "syncBuiltinPluginsToCenterDirectory",
  "dev:desktop-shell 启动前必须同步内置插件到中心目录 plugins",
);
assertIncludes(
  "apps/frontend/src/views/Providers/RouterIndex.vue",
  "协议适配器",
  "供应商页面字段必须改名为协议适配器",
);
assertNotIncludes(
  "apps/frontend/src/views/Providers/RouterIndex.vue",
  "协议插件",
  "供应商页面不能继续显示旧字段名协议插件",
);
assertIncludes(
  "apps/frontend/src/stores/app-helpers.ts",
  "openai-builtin",
  "前端新增供应商默认必须使用 OpenAI 内置固定项",
);

console.log("模型协议适配器静态检查通过。");
