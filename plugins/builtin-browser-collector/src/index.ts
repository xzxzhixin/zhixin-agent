import type { PluginManifest } from "@zhixin/plugin-sdk";

/**
 * builtinBrowserCollectorManifest：内置浏览器采集插件清单。
 *
 * 来源：个人事务浏览器信息收集能力。
 * 含义：声明网页资料采集和网络访问能力。
 * 格式：插件清单对象。
 * 默认值：系统内置、全局可用。
 * 约束：网络请求必须经中心服务审计。
 */
export const builtinBrowserCollectorManifest: PluginManifest = {
  id: "builtin-browser-collector",
  name: "内置浏览器采集",
  version: "0.1.0",
  source: "system-builtin",
  scope: "global",
  permissions: [
    "network.request",
    "personal.knowledge",
    "plugin.call",
  ],
};
