/**
 * padLocalTimePart：把本机时间数字补齐为两位。
 *
 * @param value 年月日时分秒中的数字片段。
 * @returns 两位字符串。
 */
function padLocalTimePart(value: number): string {
    return String(value).padStart(
        2,
        "0",
    );
}

/**
 * formatCenterLocalDateTime：格式化中心服务本机时间。
 *
 * @param value 要格式化的 Date 对象；默认使用当前中心服务进程本机时间。
 * @returns `YYYY-MM-DD HH:mm:ss` 格式时间。
 */
export function formatCenterLocalDateTime(value: Date = new Date()): string {
    // 本项目所有展示和业务记录时间都以中心服务所在电脑本机时间为准，不能用 UTC ISO 字符串。
    const year = value.getFullYear();
    const month = padLocalTimePart(value.getMonth() + 1);
    const day = padLocalTimePart(value.getDate());
    const hours = padLocalTimePart(value.getHours());
    const minutes = padLocalTimePart(value.getMinutes());
    const seconds = padLocalTimePart(value.getSeconds());

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
