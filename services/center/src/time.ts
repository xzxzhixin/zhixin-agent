import moment from "moment";

/** CENTER_LOCAL_TIME_FORMAT：中心服务统一本机时间格式。 */
const CENTER_LOCAL_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";

/**
 * formatCenterLocalDateTime：格式化中心服务本机时间。
 *
 * @param value 要格式化的 Date 对象；默认使用当前中心服务进程本机时间。
 * @returns `YYYY-MM-DD HH:mm:ss` 格式时间。
 */
export function formatCenterLocalDateTime(value: Date = new Date()): string {
    // 本项目所有展示和业务记录时间都以中心服务所在电脑本机时间为准，不能用 UTC ISO 字符串。
    return moment(value).format(CENTER_LOCAL_TIME_FORMAT);
}
