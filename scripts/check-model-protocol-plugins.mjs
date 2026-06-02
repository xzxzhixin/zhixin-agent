import {readFileSync} from "node:fs";

const requiredFiles = [
  "plugins/builtin-model-openai-compatible/src/index.ts",
  "plugins/builtin-model-anthropic-messages/src/index.ts",
  "services/center/src/provider-domain.ts",
  "services/center/src/api-routes.ts",
  "packages/api-client/src/index.ts",
  "apps/frontend/src/stores/app.ts",
  "apps/frontend/src/stores/app-management-actions.ts",
  "apps/frontend/src/views/Providers/RouterIndex.vue",
];

const files = new Map(requiredFiles.map((filePath) => {
  return [
    filePath,
    readFileSync(filePath, "utf-8"),
  ];
}));

function assertIncludes(filePath, needle, message) {
  const content = files.get(filePath);
  if (!content.includes(needle)) {
    throw new Error(`${message}：${filePath} 缺少 ${needle}`);
  }
}

assertIncludes(
  "plugins/builtin-model-openai-compatible/src/index.ts",
  "openAiCompatibleModelProtocolPlugin",
  "OpenAI 兼容插件必须导出协议插件脚手架",
);
assertIncludes(
  "plugins/builtin-model-anthropic-messages/src/index.ts",
  "anthropicMessagesModelProtocolPlugin",
  "Anthropic Messages 插件必须导出协议插件脚手架",
);
assertIncludes(
  "services/center/src/provider-domain.ts",
  "listRegisteredModelProtocolPlugins",
  "中心服务必须提供已注册模型协议插件列表",
);
assertIncludes(
  "services/center/src/api-routes.ts",
  "/api/provider/protocol-plugin/list",
  "中心服务必须暴露供应商协议插件列表接口",
);
assertIncludes(
  "packages/api-client/src/index.ts",
  "listProviderProtocolPlugins",
  "API 客户端必须接入供应商协议插件列表接口",
);
assertIncludes(
  "apps/frontend/src/stores/app.ts",
  "providerProtocolPlugins",
  "前端状态必须保存中心服务返回的协议插件列表",
);
assertIncludes(
  "apps/frontend/src/stores/app-management-actions.ts",
  "loadProviderProtocolPlugins",
  "前端必须加载中心服务注册的协议插件列表",
);
assertIncludes(
  "apps/frontend/src/views/Providers/RouterIndex.vue",
  "providerProtocolPlugins",
  "供应商页协议插件下拉必须来自中心服务注册列表",
);

console.log("模型协议插件注册静态检查通过。");
