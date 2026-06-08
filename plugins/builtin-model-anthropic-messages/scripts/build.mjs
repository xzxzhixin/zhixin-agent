import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  join,
  resolve,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";

// pluginRoot: 当前内置模型适配器插件根目录，构建产物必须留在本插件目录内。
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// modelAdapter: 供中心服务协议适配器下拉扫描的稳定描述，字段与中心服务 ModelProtocolPluginDescriptor 对齐。
const modelAdapter = {
  pluginId: "builtin-model-anthropic-messages",
  pluginName: "Anthropic 适配器",
  protocolModes: [
    {
      mode: "chat-completions",
      label: "Chat Completions",
      description: "中心内部使用 OpenAI Chat Completions，插件负责转换到 Anthropic 请求。",
    },
  ],
  defaultProtocolMode: "chat-completions",
  defaultCapabilities: {
    supportsVision: true,
    supportsToolCalling: true,
    supportsJsonOutput: true,
    supportsReasoningEffort: true,
    providesCacheUsage: true,
    supportsModelList: false,
    supportsStreaming: true,
  },
};

// manifest: 插件管理页和中心目录插件清单使用的系统内置插件身份。
const manifest = {
  id: "builtin-model-anthropic-messages",
  name: "Anthropic 适配器",
  version: "0.1.0",
  source: "system-builtin",
  scope: "global",
  permissions: [],
  category: "model",
  kind: "anthropic",
};

mkdirSync(pluginRoot, {
  recursive: true,
});
writeFileSync(
  join(pluginRoot, "model-adapter.json"),
  `${JSON.stringify(modelAdapter, null, 2)}\n`,
  "utf-8",
);
writeFileSync(
  join(pluginRoot, "plugin.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf-8",
);

console.log("plugins/builtin-model-anthropic-messages 已生成 model-adapter.json 和 plugin.json");
