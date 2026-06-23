import {randomUUID} from "node:crypto";
import {
    existsSync,
    readFileSync,
    readdirSync,
    rmSync,
} from "node:fs";
import {join} from "node:path";

import {writeJsonFile} from "../helpers.js";
import type {
    NetworkProxyConfigFile,
    RuntimeConfigRecord,
} from "../types.js";

/**
 * SecretConfigFile：中心服务私有敏感信息文件结构。
 *
 * 来源：中心目录 `config/secrets.json`。
 * 含义：保存中心服务后续调用供应商或代理所需明文，客户端列表只拿引用状态。
 * 格式：按 secretRef 索引的 JSON 对象。
 * 默认值：文件不存在时 secrets 为空对象。
 * 约束：该文件只能由中心服务本机使用，任何 list 接口都不能返回 value。
 */
interface SecretConfigFile {
    /**
     * secrets: secretRef 到敏感值记录的映射。
     */
    secrets: Record<string, {
        /**
         * secretKind: 敏感信息类型，用于区分供应商 API Key 和代理密码。
         */
        secretKind: "provider-api-key" | "proxy-password";

        /**
         * ownerId: 关联实体 ID，例如 providerId 或 proxyId。
         */
        ownerId: string;

        /**
         * value: 中心服务调用外部供应商或代理时使用的明文值。
         */
        value: string;

        /**
         * updatedAt: 更新时间，ISO 字符串。
         */
        updatedAt: string;
    }>;
}

/**
 * saveSecretValue：保存中心服务私有敏感信息并返回引用。
 *
 * @param centerDirectory 中心目录。
 * @param secretKind 敏感信息类型。
 * @param ownerId 关联实体 ID。
 * @param value 本次提交的敏感明文。
 * @param existingSecretRef 既有 secret 引用，存在时覆盖原记录。
 * @returns secret 引用；空值表示未配置敏感信息。
 */
function saveSecretValue(
    centerDirectory: string,
    secretKind: "provider-api-key" | "proxy-password",
    ownerId: string,
    value: string,
    existingSecretRef: string | null,
): string | null {
    if (value.length === 0) {
        return existingSecretRef;
    }

    // secretsPath: 所有低频敏感配置统一放在 config 下，符合中心服务本地 JSON 边界。
    const secretsPath = join(centerDirectory, "config", "secrets.json");
    const config = readJsonFileIfExists<SecretConfigFile>(secretsPath) ?? {
        secrets: {},
    };
    const secretRef = existingSecretRef ?? `${secretKind}:${ownerId}`;
    config.secrets[secretRef] = {
        secretKind,
        ownerId,
        value,
        updatedAt: new Date().toISOString(),
    };
    writeJsonFile(secretsPath, config);
    return secretRef;
}

/**
 * saveProxyConfig：保存代理配置，敏感密码只写入中心服务私有 secrets。
 *
 * @param centerDirectory 中心目录。
 * @param input 代理配置表单。
 * @returns 代理 ID 和认证状态。
 */
export function saveProxyConfig(
    centerDirectory: string,
    input: {
        proxyId?: string;
        proxyName?: string;
        protocol?: string;
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        clearAuth?: boolean;
        enabled?: boolean;
        note?: string;
    },
): {
    proxyId: string;
    hasAuth: boolean;
} {
    // proxyId: 修改时沿用既有 ID，新增时由中心服务生成，避免前端猜测实体身份。
    const proxyId = input.proxyId ?? randomUUID();
    // existing: 修改代理且密码为空时保留既有 secret 引用，因为空值在 UI 中表示“不修改已保存密码”。
    const existing = readJsonFileIfExists<NetworkProxyConfigFile>(join(centerDirectory, "config", `proxy-${proxyId}.json`));
    if (input.clearAuth && existing?.passwordSecretRef) {
        removeSecretValue(
            centerDirectory,
            existing.passwordSecretRef,
        );
    }
    // normalizedUsername: 空字符串是无认证代理的明确协议值，不通过候选字段猜测认证状态。
    const normalizedUsername = input.username?.trim() ?? "";
    // existingSecretRef: 只有用户明确清除认证时才移除既有 secret，避免脱敏编辑误删密码。
    const existingSecretRef = input.clearAuth
        ? null
        : existing?.passwordSecretRef ?? null;
    // passwordSecretRef: 只有用户提交非空密码时才更新中心服务私有明文；客户端永不回显引用或明文。
    const passwordSecretRef = saveSecretValue(
        centerDirectory,
        "proxy-password",
        proxyId,
        input.password ?? "",
        existingSecretRef,
    );
    writeJsonFile(join(centerDirectory, "config", `proxy-${proxyId}.json`), {
        proxyId,
        proxyName: input.proxyName,
        protocol: input.protocol,
        host: input.host,
        port: input.port,
        username: normalizedUsername,
        passwordSecretRef,
        enabled: input.enabled ?? true,
        note: input.note ?? "",
        updatedAt: new Date().toISOString(),
    });
    return {
        proxyId,
        hasAuth: Boolean(normalizedUsername || passwordSecretRef),
    };
}

/**
 * listProxyConfigs：读取代理配置列表并隐藏密码摘要。
 *
 * @param centerDirectory 中心目录。
 * @returns 可展示代理配置数组。
 */
export function listProxyConfigs(centerDirectory: string): Array<Omit<NetworkProxyConfigFile, "passwordSecretRef"> & {
    hasAuth: boolean;
}> {
    const configDirectory = join(centerDirectory, "config");
    if (!existsSync(configDirectory)) {
        return [];
    }

    return readdirSync(configDirectory)
        .filter((fileName) => {
            return fileName.startsWith("proxy-") && fileName.endsWith(".json");
        })
        .map((fileName) => readJsonFileIfExists<NetworkProxyConfigFile>(join(configDirectory, fileName)))
        .filter((proxy): proxy is NetworkProxyConfigFile => {
            return proxy !== null;
        })
        .map((proxy) => ({
            proxyId: proxy.proxyId,
            proxyName: proxy.proxyName,
            protocol: proxy.protocol,
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            enabled: proxy.enabled,
            note: proxy.note ?? "",
            updatedAt: proxy.updatedAt,
            hasAuth: Boolean(proxy.username || proxy.passwordSecretRef),
        }));
}

/**
 * removeSecretValue：删除中心服务私有敏感信息引用。
 *
 * @param centerDirectory 中心目录。
 * @param secretRef 需要删除的敏感信息引用。
 * @returns 没有返回值。
 */
function removeSecretValue(
    centerDirectory: string,
    secretRef: string,
): void {
    // secretsPath: 只处理中心服务私有 secrets.json，不触碰代理配置文件本身。
    const secretsPath = join(centerDirectory, "config", "secrets.json");
    const config = readJsonFileIfExists<SecretConfigFile>(secretsPath);
    if (!config) {
        return;
    }
    delete config.secrets[secretRef];
    writeJsonFile(secretsPath, config);
}

/**
 * readGlobalDefaultProxyId：读取全局默认代理 ID。
 *
 * @param centerDirectory 中心目录。
 * @returns 默认代理 ID；未设置时返回 null。
 */
export function readGlobalDefaultProxyId(centerDirectory: string): string | null {
    const config = readJsonFileIfExists<{
        defaultProxyId: string | null
    }>(join(centerDirectory, "config", "proxy-default.json"));
    return config?.defaultProxyId ?? null;
}

/**
 * setGlobalDefaultProxy：保存全局默认代理 ID。
 *
 * @param centerDirectory 中心目录。
 * @param proxyId 代理 ID，null 表示不使用全局默认代理。
 * @returns 保存后的默认代理 ID。
 */
export function setGlobalDefaultProxy(centerDirectory: string, proxyId: string | null): {
    defaultProxyId: string | null;
} {
    writeJsonFile(join(centerDirectory, "config", "proxy-default.json"), {
        defaultProxyId: proxyId,
        updatedAt: new Date().toISOString(),
    });
    return {
        defaultProxyId: proxyId,
    };
}

/**
 * deleteProxyConfig：删除代理配置文件并清理默认代理指向。
 *
 * @param centerDirectory 中心目录。
 * @param proxyId 代理 ID。
 * @returns 删除结果。
 */
export function deleteProxyConfig(centerDirectory: string, proxyId: string): {
    proxyId: string;
    deleted: boolean;
} {
    const proxyPath = join(centerDirectory, "config", `proxy-${proxyId}.json`);
    if (existsSync(proxyPath)) {
        rmSync(proxyPath, {
            force: true,
        });
    }
    if (readGlobalDefaultProxyId(centerDirectory) === proxyId) {
        setGlobalDefaultProxy(centerDirectory, null);
    }
    return {
        proxyId,
        deleted: true,
    };
}

/**
 * saveRuntimeConfig：保存运行环境配置，同类型默认环境保持唯一。
 *
 * @param centerDirectory 中心目录。
 * @param input 运行环境表单。
 * @returns 运行环境 ID 和默认状态。
 */
export function saveRuntimeConfig(
    centerDirectory: string,
    input: {
        runtimeId?: string;
        runtimeName?: string;
        runtimeType?: string;
        executablePath?: string;
        rootPath?: string;
        version?: string;
        environmentVariables?: Record<string, string>;
        pathEntries?: string[];
        isDefault?: boolean;
        enabled?: boolean;
        note?: string;
    },
): {
    runtimeId: string;
    isDefault: boolean;
} {
    const runtimeId = input.runtimeId ?? randomUUID();
    const runtimeDirectory = join(centerDirectory, "runtimes");
    if (input.isDefault && input.runtimeType) {
        clearDefaultRuntimeByType(runtimeDirectory, input.runtimeType, runtimeId);
    }
    writeJsonFile(join(runtimeDirectory, `${runtimeId}.json`), {
        runtimeId,
        runtimeName: input.runtimeName,
        runtimeType: input.runtimeType,
        executablePath: input.executablePath,
        rootPath: input.rootPath,
        version: input.version ?? "",
        environmentVariables: input.environmentVariables ?? {},
        pathEntries: input.pathEntries ?? [],
        isDefault: input.isDefault ?? false,
        enabled: input.enabled ?? true,
        note: input.note ?? "",
        updatedAt: new Date().toISOString(),
    });
    return {
        runtimeId,
        isDefault: input.isDefault ?? false,
    };
}

/**
 * listRuntimeConfigs：读取运行环境配置列表。
 *
 * @param centerDirectory 中心目录。
 * @returns 运行环境配置数组。
 */
export function listRuntimeConfigs(centerDirectory: string): RuntimeConfigRecord[] {
    const runtimeDirectory = join(centerDirectory, "runtimes");
    if (!existsSync(runtimeDirectory)) {
        return [];
    }

    return readdirSync(runtimeDirectory)
        .filter((fileName) => {
            return fileName.endsWith(".json");
        })
        .map((fileName) => readJsonFileIfExists<RuntimeConfigRecord>(join(runtimeDirectory, fileName)))
        .filter((runtime): runtime is RuntimeConfigRecord => {
            return runtime !== null;
        });
}

/**
 * deleteRuntimeConfig：删除运行环境配置。
 *
 * @param centerDirectory 中心目录。
 * @param runtimeId 运行环境 ID。
 * @returns 删除结果。
 */
export function deleteRuntimeConfig(centerDirectory: string, runtimeId: string): {
    runtimeId: string;
    deleted: boolean;
} {
    rmSync(join(centerDirectory, "runtimes", `${runtimeId}.json`), {
        force: true,
    });
    return {
        runtimeId,
        deleted: true,
    };
}

/**
 * readJsonFileIfExists：读取可选 JSON 文件。
 *
 * @param filePath JSON 文件绝对路径。
 * @returns 文件存在且可解析时返回对象；不存在时返回 null。
 */
function readJsonFileIfExists<TValue>(filePath: string): TValue | null {
    if (!existsSync(filePath)) {
        return null;
    }

    return JSON.parse(readFileSync(filePath, "utf-8")) as TValue;
}

/**
 * clearDefaultRuntimeByType：设置默认环境前清理同类型其他默认项。
 *
 * @param runtimeDirectory 运行环境目录。
 * @param runtimeType 运行环境类型。
 * @param keepRuntimeId 当前保存的运行环境 ID。
 * @returns 没有返回值。
 */
function clearDefaultRuntimeByType(
    runtimeDirectory: string,
    runtimeType: string,
    keepRuntimeId: string,
): void {
    if (!existsSync(runtimeDirectory)) {
        return;
    }

    for (const fileName of readdirSync(runtimeDirectory)) {
        const runtimePath = join(runtimeDirectory, fileName);
        const runtime = readJsonFileIfExists<RuntimeConfigRecord>(runtimePath);
        if (runtime?.runtimeType === runtimeType && runtime.runtimeId !== keepRuntimeId && runtime.isDefault) {
            writeJsonFile(runtimePath, {
                ...runtime,
                isDefault: false,
                updatedAt: new Date().toISOString(),
            });
        }
    }
}
