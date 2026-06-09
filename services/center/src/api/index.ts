/**
 * 中心服务对外 API 目录入口。
 *
 * 用途：集中承载 REST 与 WebSocket 请求处理文件，根目录同名文件仅保留兼容导出。
 * 关键逻辑：新增对外接口必须进入本目录，避免路由处理继续散落在中心服务根目录。
 */
export const CENTER_API_DIRECTORY_BOUNDARY = "services/center/src/api";
