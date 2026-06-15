/**
 * isRecord：判断未知值是否为普通对象。
 *
 * @param value 待判断值。
 * @returns 是普通对象时返回 true。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
