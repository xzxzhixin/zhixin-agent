import type { InternalFileLink } from "./index.js";

// INTERNAL_FILE_LINK_PROTOCOL：内部文件定位链接协议前缀，和 http/https 外部链接区分。
export const INTERNAL_FILE_LINK_PROTOCOL = "zhixin-file:";

// encodeInternalFileLink：把结构化文件定位信息编码成内部链接。
export function encodeInternalFileLink(link: InternalFileLink): string {
  // payload：必须保留完整定位结构，不能只保存展示文本。
  const payload = JSON.stringify(link);
  // encodeURIComponent：避免路径、中文和行号信息破坏 URL 结构。
  return `${INTERNAL_FILE_LINK_PROTOCOL}${encodeURIComponent(payload)}`;
}

// decodeInternalFileLink：解析内部文件定位链接。
export function decodeInternalFileLink(value: string): InternalFileLink | null {
  // startsWith：外部链接不进入内部定位解析。
  if (!value.startsWith(INTERNAL_FILE_LINK_PROTOCOL)) {
    return null;
  }
  try {
    // payload：去掉协议前缀后恢复 JSON。
    const payload = value.slice(INTERNAL_FILE_LINK_PROTOCOL.length);
    // JSON.parse：返回结构化定位信息，交给 IDE 插件或客户端内部跳转。
    return JSON.parse(decodeURIComponent(payload)) as InternalFileLink;
  } catch {
    // null：解析失败时让调用方按无效内部链接处理。
    return null;
  }
}
