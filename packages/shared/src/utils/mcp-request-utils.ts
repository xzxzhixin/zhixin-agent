/**
 * randomMcpRequestId：为 MCP JSON-RPC 请求生成可读 ID。
 *
 * @param method MCP 方法名。
 * @returns 请求 ID。
 */
export function randomMcpRequestId(method: string): string {
  return `${method}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}
