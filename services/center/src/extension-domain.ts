import {randomUUID} from "node:crypto";
import {appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {dirname, join} from "node:path";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import {createDataAccess} from "./data-access/index.js";
import {writeJsonFile} from "./helpers.js";

export function installPlugin(
    database: CenterDatabase,
    events: CenterEventStore,
    manifest: Record<string, unknown>,
): {
    pluginInstallId: string;
} {
    const pluginInstallId = String(manifest.id ?? randomUUID());
    createDataAccess(database).extensions.upsertPlugin({
        pluginInstallId,
        source: String(manifest.source),
        scope: String(manifest.scope),
        enabled: true,
        manifestJson: JSON.stringify(manifest),
        updatedAt: new Date().toISOString(),
    });
    events.append({
        eventType: "plugin.installed",
        scopeType: "plugin",
        scopeId: pluginInstallId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "插件安装",
        summary: String(manifest.name ?? pluginInstallId),
        payload: {
            pluginInstallId,
        },
    });

    return {
        pluginInstallId,
    };
}

export function setPluginEnabled(
    database: CenterDatabase,
    events: CenterEventStore,
    pluginId: string,
    enabled: boolean,
): {
    pluginId: string;
    enabled: boolean;
} {
    createDataAccess(database).extensions.setPluginEnabled(
        pluginId,
        enabled,
        new Date().toISOString(),
    );
    events.append({
        eventType: enabled ? "plugin.enabled" : "plugin.disabled",
        scopeType: "plugin",
        scopeId: pluginId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: enabled ? "插件启用" : "插件停用",
        summary: pluginId,
        payload: {
            pluginId,
        },
    });
    return {
        pluginId,
        enabled,
    };
}

export function configurePlugin(
    database: CenterDatabase,
    events: CenterEventStore,
    pluginId: string,
    config: Record<string, unknown>,
): {
    pluginId: string;
    configured: boolean;
} {
    const manifestJson = createDataAccess(database).extensions.findPluginManifestJson(pluginId);
    const manifest = manifestJson ? JSON.parse(manifestJson) as Record<string, unknown> : {};
    createDataAccess(database).extensions.updatePluginManifestJson(
        pluginId,
        JSON.stringify({
            ...manifest,
            config,
        }),
        new Date().toISOString(),
    );
    events.append({
        eventType: "plugin.configured",
        scopeType: "plugin",
        scopeId: pluginId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "插件配置",
        summary: pluginId,
        payload: {pluginId}
    });
    return {
        pluginId,
        configured: true,
    };
}

export function deletePlugin(
    database: CenterDatabase,
    events: CenterEventStore,
    pluginId: string,
): {
    pluginId: string;
    deleted: boolean;
} {
    const deleted = createDataAccess(database).extensions.deleteUserPlugin(pluginId);
    events.append({
        eventType: deleted ? "plugin.deleted" : "plugin.delete.skipped",
        scopeType: "plugin",
        scopeId: pluginId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: deleted ? "completed" : "cancelled",
        title: deleted ? "插件删除" : "插件删除跳过",
        summary: deleted ? pluginId : "系统内置插件不可卸载。",
        payload: {pluginId, deleted}
    });
    return {
        pluginId,
        deleted,
    };
}

export function listPlugins(database: CenterDatabase): unknown[] {
    const rows = createDataAccess(database).extensions.listPlugins();

    return rows.map((row) => {
        const manifest = JSON.parse(row.manifestJson) as {
            projectId?: unknown;
        };

        return {
            ...row,
            // projectId: 项目级插件归属只能来自插件清单中的明确 projectId；没有该字段时不能猜测归属到当前项目。
            projectId: typeof manifest.projectId === "string"
                ? manifest.projectId
                : null,
        };
    });
}

export function recordExtensionCall(
    database: CenterDatabase,
    events: CenterEventStore,
    input: {
        extensionId?: string;
        sessionId?: string | null;
        taskId?: string | null;
        status?: string;
        inputSummary?: string;
        outputSummary?: string | null;
    },
): {
    callId: string;
} {
    const callId = randomUUID();
    createDataAccess(database).extensions.insertExtensionCall({
        callId,
        extensionId: input.extensionId,
        sessionId: input.sessionId ?? null,
        taskId: input.taskId ?? null,
        status: input.status,
        inputSummary: input.inputSummary,
        outputSummary: input.outputSummary ?? null,
        createdAt: new Date().toISOString(),
    });
    events.append({
        eventType: "extension.called",
        scopeType: "extension",
        scopeId: input.extensionId ?? null,
        sessionId: input.sessionId ?? null,
        turnId: null,
        taskId: input.taskId ?? null,
        status: input.status ?? "completed",
        title: "扩展能力调用",
        summary: input.inputSummary ?? "",
        payload: {
            callId,
        },
    });
    return {
        callId,
    };
}

export function saveExtensionJson(
    centerDirectory: string,
    relativePath: string,
    value: Record<string, unknown>,
): {
    relativePath: string;
} {
    writeJsonFile(join(centerDirectory, relativePath), {
        ...value,
        updatedAt: new Date().toISOString(),
    });
    return {
        relativePath,
    };
}

/**
 * listMcpConfigs：扫描中心目录中的 MCP 配置。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 全局和项目级 MCP 配置列表。
 */
export function listMcpConfigs(centerDirectory: string): Array<{
    scope: "global" | "project";
    projectId: string | null;
    relativePath: string;
    mcpServers: Record<string, unknown>;
    updatedAt: string | null;
}> {
    const mcpDirectory = join(centerDirectory, "mcp");
    const configs: Array<{
        scope: "global" | "project";
        projectId: string | null;
        relativePath: string;
        mcpServers: Record<string, unknown>;
        updatedAt: string | null;
    }> = [];

    configs.push(readMcpConfigFile(centerDirectory, "mcp/global.json", "global", null));
    if (!existsSync(mcpDirectory)) {
        return configs;
    }

    for (const entry of readdirSync(mcpDirectory, {
        withFileTypes: true,
    })) {
        if (!entry.isFile() || !entry.name.startsWith("project-") || !entry.name.endsWith(".json")) {
            continue;
        }
        // projectId: 文件名协议来自 /api/mcp/save 的 project-{projectId}.json，反向列表时只按同一协议解析。
        const projectId = entry.name.slice("project-".length, -".json".length);
        configs.push(readMcpConfigFile(
            centerDirectory,
            `mcp/${entry.name}`,
            "project",
            projectId,
        ));
    }

    return configs;
}

/**
 * readMcpConfigFile：读取单个 MCP 配置文件。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param relativePath 配置文件相对路径。
 * @param scope 配置作用域。
 * @param projectId 项目 ID，全局配置为 null。
 * @returns MCP 配置展示对象。
 */
export function readMcpConfigFile(
    centerDirectory: string,
    relativePath: string,
    scope: "global" | "project",
    projectId: string | null,
): {
    scope: "global" | "project";
    projectId: string | null;
    relativePath: string;
    mcpServers: Record<string, unknown>;
    updatedAt: string | null;
} {
    const filePath = join(centerDirectory, relativePath);
    if (!existsSync(filePath)) {
        return {
            scope,
            projectId,
            relativePath,
            mcpServers: {},
            updatedAt: null,
        };
    }

    const value = JSON.parse(readFileSync(filePath, "utf-8")) as {
        mcpServers?: Record<string, unknown>;
        updatedAt?: string;
    };

    return {
        scope,
        projectId,
        relativePath,
        mcpServers: isRecord(value.mcpServers)
            ? value.mcpServers
            : {},
        updatedAt: typeof value.updatedAt === "string"
            ? value.updatedAt
            : null,
    };
}

/**
 * isRecord：判断未知值是否为普通对象。
 *
 * @param value 待判断值。
 * @returns 是普通对象时返回 true。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function saveSkillContent(
    centerDirectory: string,
    skillName: string,
    content: string,
    projectId: string | null,
): {
    relativePath: string;
} {
    const relativePath = projectId
        ? `skills/project-${projectId}/${skillName}/SKILL.md`
        : `skills/${skillName}/SKILL.md`;
    const filePath = join(centerDirectory, relativePath);
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    appendFileSync(filePath, content, "utf-8");
    return {
        relativePath,
    };
}

/**
 * listInstalledSkills：扫描中心目录中的 skill。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 已安装 skill 列表。
 */
export function listInstalledSkills(centerDirectory: string): Array<{
    skillName: string;
    scope: "global" | "project";
    projectId: string | null;
    relativePath: string;
    content: string;
}> {
    const skillsDirectory = join(centerDirectory, "skills");
    if (!existsSync(skillsDirectory)) {
        return [];
    }

    const skills: Array<{
        skillName: string;
        scope: "global" | "project";
        projectId: string | null;
        relativePath: string;
        content: string;
    }> = [];

    for (const entry of readdirSync(skillsDirectory, {
        withFileTypes: true,
    })) {
        if (!entry.isDirectory()) {
            continue;
        }
        if (entry.name.startsWith("project-")) {
            const projectId = entry.name.slice("project-".length);
            collectSkillDirectory(
                centerDirectory,
                join("skills", entry.name),
                "project",
                projectId,
                skills,
            );
            continue;
        }
        collectOneSkill(
            centerDirectory,
            join("skills", entry.name),
            entry.name,
            "global",
            null,
            skills,
        );
    }

    return skills;
}

/**
 * collectSkillDirectory：扫描项目级 skill 目录。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param baseRelativePath 项目级 skill 父目录相对路径。
 * @param scope skill 作用域。
 * @param projectId 项目 ID。
 * @param output 输出数组。
 * @returns 没有返回值。
 */
export function collectSkillDirectory(
    centerDirectory: string,
    baseRelativePath: string,
    scope: "project",
    projectId: string,
    output: Array<{
        skillName: string;
        scope: "global" | "project";
        projectId: string | null;
        relativePath: string;
        content: string;
    }>,
): void {
    const directoryPath = join(centerDirectory, baseRelativePath);
    for (const entry of readdirSync(directoryPath, {
        withFileTypes: true,
    })) {
        if (!entry.isDirectory()) {
            continue;
        }
        collectOneSkill(
            centerDirectory,
            join(baseRelativePath, entry.name),
            entry.name,
            scope,
            projectId,
            output,
        );
    }
}
