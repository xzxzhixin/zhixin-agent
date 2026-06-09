/**
 * 供应商删除和管理弹框布局回归检查。
 *
 * 用途：防止供应商删除退回“只停用不删除”，或管理弹框底部按钮被内容裁掉。
 * 关键逻辑：检查后端删除语义、前端删除后刷新、列表上方刷新入口和共享弹框外壳使用。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * assertIncludes：检查源码包含指定片段。
 *
 * @param source 源码文本。
 * @param fragment 必须存在的源码片段。
 * @param message 缺失时抛出的中文错误。
 * @returns 检查通过时没有返回值。
 */
function assertIncludes(
  source,
  fragment,
  message,
) {
  if (!source.includes(fragment)) {
    throw new Error(message);
  }
}

/**
 * assertNotIncludes：检查源码不包含指定片段。
 *
 * @param source 源码文本。
 * @param fragment 不允许存在的源码片段。
 * @param message 命中时抛出的中文错误。
 * @returns 检查通过时没有返回值。
 */
function assertNotIncludes(
  source,
  fragment,
  message,
) {
  if (source.includes(fragment)) {
    throw new Error(message);
  }
}

/**
 * readProjectFile：读取项目内 UTF-8 文本文件。
 *
 * @param pathParts 项目相对路径片段。
 * @returns 文件内容。
 */
function readProjectFile(...pathParts) {
  return readFileSync(
    join(
      process.cwd(),
      ...pathParts,
    ),
    "utf-8",
  );
}

// providerDomain: 供应商领域必须提供真实删除配置和模型列表的函数。
const providerDomain = readProjectFile(
  "services",
  "center",
  "src",
  "domain",
  "provider-domain.ts",
);
// providerRoutes: 删除接口必须调用真实删除函数，不能只停用。
const providerRoutes = readProjectFile(
  "services",
  "center",
  "src",
  "api",
  "provider-routes.ts",
);
// managementActions: 前端删除后仍要刷新中心服务事实列表。
const managementActions = readProjectFile(
  "apps",
  "frontend",
  "src",
  "stores",
  "app-management-actions.ts",
);
// providerPage: 供应商页必须把刷新按钮放到列表上方，并使用共享弹框外壳。
const providerPage = readProjectFile(
  "apps",
  "frontend",
  "src",
  "views",
  "Providers",
  "RouterIndex.vue",
);
// shell: 管理弹框共享外壳必须提供内容滚动和底部固定槽。
const shell = readProjectFile(
  "apps",
  "frontend",
  "src",
  "components",
  "ManagementDialogShell.vue",
);

assertIncludes(
  providerDomain,
  "export function deleteProviderConfig",
  "供应商领域缺少真实删除供应商配置函数。",
);
assertIncludes(
  providerDomain,
  "rmSync(providerPath",
  "供应商删除必须删除 provider JSON 配置文件。",
);
assertIncludes(
  providerDomain,
  "rmSync(modelListPath",
  "供应商删除必须同步清理模型列表文件。",
);
assertIncludes(
  providerDomain,
  "assertProviderIdSafeForFileOperation(",
  "供应商删除前必须校验 providerId 并限制文件操作目录。",
);
assertIncludes(
  providerDomain,
  "`provider-api-key:${providerId}`",
  "供应商删除必须同步清理对应 API Key secret。",
);
assertIncludes(
  providerRoutes,
  "deleteProviderConfig(",
  "供应商删除接口必须调用 deleteProviderConfig，不能只停用。",
);
assertNotIncludes(
  providerRoutes,
  "updateProviderConfig(config.centerDirectory, {\\n            providerId,\\n            enabled: false",
  "供应商删除接口不能继续只把供应商 enabled 置为 false。",
);
assertIncludes(
  managementActions,
  "await this.loadProviders();",
  "前端删除供应商后必须刷新供应商列表。",
);
assertIncludes(
  providerPage,
  "provider-list-toolbar",
  "供应商列表上方必须有刷新按钮工具区。",
);
assertIncludes(
  providerPage,
  "<ManagementDialogShell",
  "供应商配置弹框必须使用共享管理弹框外壳。",
);
assertIncludes(
  shell,
  "management-dialog-shell__body",
  "共享管理弹框外壳必须提供内容滚动区域。",
);
assertIncludes(
  shell,
  "management-dialog-shell__footer",
  "共享管理弹框外壳必须提供底部固定操作区。",
);
assertIncludes(
  shell,
  "overflow-y: auto",
  "共享管理弹框内容区必须允许纵向滚动。",
);
assertIncludes(
  shell,
  "flex-shrink: 0",
  "共享管理弹框底部操作区必须固定不被内容挤压。",
);

const managementDialogPages = [
  [
    "Providers",
    "RouterIndex.vue",
  ],
  [
    "Proxies",
    "RouterIndex.vue",
  ],
  [
    "Runtimes",
    "RouterIndex.vue",
  ],
  [
    "Plugins",
    "RouterIndex.vue",
  ],
  [
    "Mcp",
    "RouterIndex.vue",
  ],
  [
    "Skills",
    "RouterIndex.vue",
  ],
  [
    "AgentManagement",
    "RouterIndex.vue",
  ],
];

for (const [
  directory,
  fileName,
] of managementDialogPages) {
  const source = readProjectFile(
    "apps",
    "frontend",
    "src",
    "views",
    directory,
    fileName,
  );
  assertIncludes(
    source,
    "<ManagementDialogShell",
    `${directory}/${fileName} 管理弹框必须使用共享外壳。`,
  );
}

console.log("供应商删除和管理弹框布局回归检查通过。");
