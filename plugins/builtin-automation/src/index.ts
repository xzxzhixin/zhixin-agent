import type { PluginManifest } from "@zhixin/plugin-sdk";

/**
 * builtinAutomationManifest：内置自动化插件清单。
 *
 * 来源：阶段 11 内置插件要求。
 * 含义：声明本地脚本、命令和自动化流程能力。
 * 格式：插件清单对象。
 * 默认值：系统内置、全局和项目均可用。
 * 约束：系统内置插件不可卸载。
 */
export const builtinAutomationManifest: PluginManifest = {
  id: "builtin-automation",
  name: "内置自动化",
  version: "0.1.0",
  source: "system-builtin",
  scope: "both",
  permissions: [
    "command.run",
    "file.read",
    "file.write",
    "plugin.call",
  ],
};
