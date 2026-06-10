import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {
    listInstalledSkills,
    saveSkillContent,
} from "../domain/extension-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerSkillRoutes：注册 skill 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerSkillRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
    } = context;

    app.post("/api/skill/install", async (request) => {
            const body = request.body as {
                skillName?: string;
                content?: string;
                projectId?: string | null;
            };
    
            if (!body.skillName || !body.content) {
                return createErrorResponse("SKILL_INSTALL_INVALID", "skill 安装缺少必要字段", "skill 信息不完整。");
            }
    
            return createSuccessResponse(saveSkillContent(config.centerDirectory, body.skillName, body.content, body.projectId ?? null));
        });

    app.post("/api/skill/list", async () => createSuccessResponse({
            skills: listInstalledSkills(config.centerDirectory),
        }));
}
