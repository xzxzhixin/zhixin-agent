import type {
    ConversationSession,
    ProjectRecord,
} from "@zhixin/shared";

import {
    formatDisplayTime,
} from "./chat-view-helpers";

/**
 * sessionTooltipContent：生成对话行 tooltip。
 *
 * @param session 会话记录。
 * @param userPreview 用户摘要。
 * @returns 完整标题和统一格式时间。
 */
export function sessionTooltipContent(
    session: ConversationSession,
    userPreview: string,
): string {
    return `${session.title}\n用户发出：${userPreview}\n${formatDisplayTime(session.updatedAt)}`;
}

/**
 * projectTooltipContent：生成项目行详情提示。
 *
 * @param project 项目记录。
 * @returns 项目文件夹名或未登记状态，以及项目 ID。
 */
export function projectTooltipContent(project: ProjectRecord): string {
    const nameLine = project.displayName === "未登记项目名称"
        ? "项目名称：未登记项目名称"
        : `项目文件夹名：${project.displayName}`;
    const aliasLine = project.alias
        ? `备注：${project.alias}`
        : "备注：无";
    return `${nameLine}\n项目 ID：${project.projectId}\n${aliasLine}`;
}
