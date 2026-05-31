import type { PluginManifest } from "@zhixin/plugin-sdk";

/**
 * builtinOfficeIntegrationManifest：内置办公集成插件清单。
 *
 * 来源：个人事务办公系统集成能力。
 * 含义：声明办公资料读取、整理和网络集成权限。
 * 格式：插件清单对象。
 * 默认值：系统内置、全局可用。
 * 约束：敏感授权凭据只能保存在中心电脑。
 */
export const builtinOfficeIntegrationManifest: PluginManifest = {
  id: "builtin-office-integration",
  name: "内置办公集成",
  version: "0.1.0",
  source: "system-builtin",
  scope: "global",
  permissions: [
    "file.read",
    "network.request",
    "plugin.call",
  ],
};
