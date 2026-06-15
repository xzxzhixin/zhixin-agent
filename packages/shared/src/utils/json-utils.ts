import { isRecord } from "./record-utils";

/**
 * tryParseRecord：尝试把 JSON 字符串解析成对象。
 *
 * @param text JSON 字符串。
 * @returns 对象；解析失败或不是对象时返回 null。
 */
export function tryParseRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
