import type { PluginManifest } from "@zhixin/plugin-sdk";

/**
 * builtinFileOrganizerManifest：内置资料整理插件清单。
 *
 * 来源：个人事务文件资料整理能力。
 * 含义：声明本地文件读取、写入和个人知识库写入权限。
 * 格式：插件清单对象。
 * 默认值：系统内置、全局和项目均可用。
 * 约束：文件副作用必须由中心服务审批和审计。
 */
export const builtinFileOrganizerManifest: PluginManifest = {
  id: "builtin-file-organizer",
  name: "内置资料整理",
  version: "0.1.0",
  source: "system-builtin",
  scope: "both",
  permissions: [
    "file.read",
    "file.write",
    "personal.knowledge",
    "plugin.call",
  ],
};
