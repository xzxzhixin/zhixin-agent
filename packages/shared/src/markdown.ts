import type { InternalFileLink } from "./index.js";

/**
 * 内部文件定位链接协议前缀。
 *
 * 来源：旧共享模块和新版架构中的内部文件定位链接协议。
 * 含义：区分项目文件定位链接和普通 http/https 外部链接。
 * 格式：固定字符串前缀。
 * 默认值：zhixin-file:。
 * 约束：只有此前缀的链接才交给 IDE 或客户端内部跳转处理。
 */
export const INTERNAL_FILE_LINK_PROTOCOL = "zhixin-file:";

/**
 * 编码内部文件定位链接。
 *
 * 用途：把结构化项目文件定位信息编码为 Markdown 可承载的链接字符串。
 * 关键逻辑：完整保留项目 ID、绝对路径、相对路径和行号信息，避免只保存展示文本导致无法跳转。
 * 参数：link 为中心服务和 IDE 插件约定的结构化文件定位信息。
 * 返回值：带 `zhixin-file:` 前缀的内部链接字符串。
 */
export function encodeInternalFileLink(link: InternalFileLink): string {
  // payload: 内部链接必须保留完整结构，迁移项目路径时仍可根据 projectId 和 relativePath 恢复。
  const payload = JSON.stringify(link);

  // encodeURIComponent: 文件路径和中文标签可能包含特殊字符，必须编码后再拼入链接。
  return `${INTERNAL_FILE_LINK_PROTOCOL}${encodeURIComponent(payload)}`;
}

/**
 * 解码内部文件定位链接。
 *
 * 用途：从 Markdown 链接或 UI 点击事件中恢复结构化文件定位信息。
 * 关键逻辑：仅解析 `zhixin-file:` 协议，普通外部链接直接返回 null。
 * 参数：value 为待解析的链接字符串。
 * 返回值：解析成功返回内部文件定位结构；非内部链接或解析失败返回 null。
 */
export function decodeInternalFileLink(value: string): InternalFileLink | null {
  // 外部链接不进入内部定位解析，避免错误拦截普通网页链接。
  if (!value.startsWith(INTERNAL_FILE_LINK_PROTOCOL)) {
    return null;
  }

  try {
    // payload: 去掉协议前缀后恢复 JSON 字符串。
    const payload = value.slice(INTERNAL_FILE_LINK_PROTOCOL.length);

    // JSON.parse: 这里只恢复结构，具体路径是否允许打开由客户端能力和权限判断。
    return JSON.parse(decodeURIComponent(payload)) as InternalFileLink;
  } catch {
    // 解析失败按无效内部链接处理，调用方可以展示错误或忽略。
    return null;
  }
}
