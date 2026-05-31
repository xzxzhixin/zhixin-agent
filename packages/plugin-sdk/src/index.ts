/**
 * 插件来源。
 *
 * 来源：扩展系统架构。
 * 含义：区分系统内置、用户安装和项目级插件。
 * 格式：固定字符串枚举。
 * 默认值：用户安装入口创建时为 user-installed。
 * 约束：system-builtin 插件不可卸载。
 */
export type PluginSource =
  | "system-builtin"
  | "user-installed"
  | "project-local";

/**
 * 插件适用范围。
 *
 * 来源：插件清单协议。
 * 含义：声明插件可用于全局、项目或二者。
 * 格式：固定字符串枚举。
 * 默认值：global。
 * 约束：项目级能力优先于同名全局能力。
 */
export type PluginScope =
  | "global"
  | "project"
  | "both";

/**
 * 插件权限。
 *
 * 来源：安全、权限与敏感信息架构。
 * 含义：声明插件执行敏感操作前必须具备的权限。
 * 格式：固定字符串枚举。
 * 默认值：无权限。
 * 约束：缺少权限声明时禁止执行敏感操作。
 */
export type PluginPermission =
  | "file.read"
  | "file.write"
  | "file.delete"
  | "command.run"
  | "network.request"
  | "memory.read"
  | "memory.write"
  | "project.read"
  | "project.write"
  | "provider.call"
  | "plugin.call"
  | "mcp.call"
  | "skill.use"
  | "personal.todo"
  | "personal.calendar"
  | "personal.knowledge"
  | "notification.send";

/**
 * 插件配置 schema。
 *
 * 来源：插件清单协议。
 * 含义：描述插件配置项的 JSON Schema。
 * 格式：JSON Schema 对象。
 * 默认值：无配置时为空对象。
 * 约束：敏感配置必须在字段 schema 中标记。
 */
export interface PluginConfigSchema {
  /**
   * type: JSON Schema 顶层类型。
   */
  type: "object";

  /**
   * properties: 配置字段定义。
   */
  properties: Record<string, unknown>;

  /**
   * required: 必填字段列表。
   */
  required?: string[];
}

/**
 * 插件清单。
 *
 * 来源：插件作为总扩展包的架构。
 * 含义：描述插件身份、来源、适用范围、权限和配置。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：id、name、version 必须稳定，不能用显示名作为身份。
 */
export interface PluginManifest {
  /**
   * id: 插件 ID，来源于插件包清单。
   */
  id: string;

  /**
   * name: 插件显示名称。
   */
  name: string;

  /**
   * version: 插件版本，使用精确版本号。
   */
  version: string;

  /**
   * source: 插件来源。
   */
  source: PluginSource;

  /**
   * scope: 插件适用范围。
   */
  scope: PluginScope;

  /**
   * permissions: 插件声明的权限列表。
   */
  permissions: PluginPermission[];

  /**
   * configSchema: 插件配置 schema；无配置时可省略。
   */
  configSchema?: PluginConfigSchema;
}

/**
 * 扩展调用记录。
 *
 * 来源：SQLite `extension_call_records` 表。
 * 含义：保存插件、MCP 和 skill 调用审计信息。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：所有扩展能力调用必须记录。
 */
export interface ExtensionCallRecord {
  /**
   * callId: 调用记录 ID。
   */
  callId: string;

  /**
   * extensionId: 插件、MCP 或 skill 的能力 ID。
   */
  extensionId: string;

  /**
   * extensionType: 扩展能力类型。
   */
  extensionType: "plugin" | "mcp" | "skill";

  /**
   * taskId: 关联任务 ID。
   */
  taskId: string;

  /**
   * startedAt: 开始时间，ISO 8601 字符串。
   */
  startedAt: string;

  /**
   * endedAt: 结束时间；未结束时为 null。
   */
  endedAt: string | null;

  /**
   * status: 调用状态。
   */
  status: "running" | "completed" | "failed";

  /**
   * traceId: 排查 ID。
   */
  traceId: string;
}

/**
 * 插件 API 描述。
 *
 * 来源：中心服务插件 SDK。
 * 含义：声明插件可通过中心服务访问的能力入口。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：插件只能调用已声明并授权的 API。
 */
export interface PluginApiDescriptor {
  /**
   * apiName: 插件 API 名称。
   */
  apiName: string;

  /**
   * requiredPermissions: 调用该 API 需要的权限。
   */
  requiredPermissions: PluginPermission[];

  /**
   * description: API 用途说明。
   */
  description: string;
}

/**
 * validatePluginManifest：校验插件清单必要字段。
 *
 * @param manifest 插件清单候选值。
 * @returns 校验通过的插件清单。
 */
export function validatePluginManifest(manifest: unknown): PluginManifest {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("插件清单必须是对象");
  }

  const candidate = manifest as Partial<PluginManifest>;

  if (!candidate.id || !candidate.name || !candidate.version || !candidate.source || !candidate.scope || !Array.isArray(candidate.permissions)) {
    throw new Error("插件清单缺少 id、name、version、source、scope 或 permissions");
  }

  return {
    id: candidate.id,
    name: candidate.name,
    version: candidate.version,
    source: candidate.source,
    scope: candidate.scope,
    permissions: candidate.permissions,
    configSchema: candidate.configSchema,
  };
}

/**
 * assertPluginPermission：校验插件是否声明指定权限。
 *
 * @param manifest 插件清单。
 * @param permission 需要的权限。
 * @returns 校验通过时没有返回值。
 */
export function assertPluginPermission(
  manifest: PluginManifest,
  permission: PluginPermission,
): void {
  if (!manifest.permissions.includes(permission)) {
    throw new Error(`插件 ${manifest.id} 缺少权限声明：${permission}`);
  }
}
