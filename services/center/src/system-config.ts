import {
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import {dirname, join} from "node:path";

import type {Level} from "pino";

import {formatCenterLocalDateTime} from "./time.js";

/** CenterLogLevel：中心服务日志等级，直接复用 pino 的标准等级类型。 */
export type CenterLogLevel = Level;

/** CenterRuntimeEnvironment：中心服务日志默认等级使用的运行环境分类。 */
export type CenterRuntimeEnvironment = "development" | "production";

/**
 * CenterLogConfigView：中心服务日志配置展示模型。
 *
 * 来源：中心服务系统配置文件与进程环境变量。
 * 含义：前端管理页读取和保存日志等级时使用的稳定协议。
 * 约束：configuredLevel 为 null 表示使用当前环境默认值或环境变量覆盖值。
 */
export interface CenterLogConfigView {
    /** configuredLevel: 用户在配置文件中显式保存的日志等级；null 表示默认。 */
    configuredLevel: CenterLogLevel | null;
    /** effectiveLevel: 当前进程实际生效的日志等级。 */
    effectiveLevel: CenterLogLevel;
    /** environmentDefaultLevel: 当前运行环境未显式配置时使用的默认等级。 */
    environmentDefaultLevel: CenterLogLevel;
    /** runtimeEnvironment: 当前运行环境分类。 */
    runtimeEnvironment: CenterRuntimeEnvironment;
    /** updatedAt: 配置文件最后一次由中心服务保存的本机时间。 */
    updatedAt: string | null;
}

/**
 * CenterSystemConfigFile：中心服务系统配置文件结构。
 *
 * 来源：`center-data/config/system-config.json`。
 * 含义：保存中心服务自身运行配置，不放桌面壳本机配置。
 * 约束：这里只保存可迁移的中心服务配置，不保存 API Key 等敏感明文。
 */
interface CenterSystemConfigFile {
    /** logLevel: 用户显式日志等级；null 表示使用环境默认值。 */
    logLevel?: CenterLogLevel | null;
    /** updatedAt: 最近一次配置保存时间，使用中心服务本机时间。 */
    updatedAt?: string | null;
}

/** CENTER_LOG_LEVELS：pino 标准日志等级白名单，避免配置文件异常值进入运行链路。 */
const CENTER_LOG_LEVELS: CenterLogLevel[] = [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
];

/**
 * readCenterLogConfig：读取当前中心服务日志配置视图。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param env 进程环境变量，测试或调用方可传入隔离对象。
 * @returns 日志配置视图。
 */
export function readCenterLogConfig(
    centerDirectory: string,
    env: NodeJS.ProcessEnv = process.env,
): CenterLogConfigView {
    const runtimeEnvironment = resolveCenterRuntimeEnvironment(env);
    const environmentDefaultLevel = resolveEnvironmentDefaultLogLevel(runtimeEnvironment);
    const systemConfig = readCenterSystemConfig(centerDirectory);
    const configuredLevel = isCenterLogLevel(systemConfig.logLevel)
        ? systemConfig.logLevel
        : null;
    const environmentLevel = isCenterLogLevel(env.ZHIXIN_LOG_LEVEL)
        ? env.ZHIXIN_LOG_LEVEL
        : null;
    const effectiveLevel = environmentLevel ?? configuredLevel ?? environmentDefaultLevel;

    return {
        configuredLevel,
        effectiveLevel,
        environmentDefaultLevel,
        runtimeEnvironment,
        updatedAt: typeof systemConfig.updatedAt === "string"
            ? systemConfig.updatedAt
            : null,
    };
}

/**
 * saveCenterLogConfig：保存中心服务日志配置。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param configuredLevel 用户显式日志等级；null 表示恢复默认。
 * @returns 保存后的日志配置视图。
 */
export function saveCenterLogConfig(
    centerDirectory: string,
    configuredLevel: CenterLogLevel | null,
): CenterLogConfigView {
    if (configuredLevel !== null && !isCenterLogLevel(configuredLevel)) {
        throw new Error("CENTER_LOG_LEVEL_INVALID");
    }

    const existingConfig = readCenterSystemConfig(centerDirectory);
    const nextConfig: CenterSystemConfigFile = {
        ...existingConfig,
        logLevel: configuredLevel,
        updatedAt: formatCenterLocalDateTime(),
    };
    writeCenterSystemConfig(
        centerDirectory,
        nextConfig,
    );
    return readCenterLogConfig(centerDirectory);
}

/**
 * isCenterLogLevel：判断输入是否为日志等级协议值。
 *
 * @param value 待判断值。
 * @returns 属于日志等级白名单时返回 true。
 */
export function isCenterLogLevel(value: unknown): value is CenterLogLevel {
    return typeof value === "string" && CENTER_LOG_LEVELS.includes(value as CenterLogLevel);
}

/**
 * resolveCenterSystemConfigPath：解析中心服务系统配置文件路径。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns system-config.json 绝对路径。
 */
export function resolveCenterSystemConfigPath(centerDirectory: string): string {
    return join(
        centerDirectory,
        "config",
        "system-config.json",
    );
}

/**
 * readCenterSystemConfig：读取系统配置文件。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns 配置文件对象；缺失或损坏时返回空对象，避免阻断中心服务启动。
 */
function readCenterSystemConfig(centerDirectory: string): CenterSystemConfigFile {
    try {
        const rawContent = readFileSync(
            resolveCenterSystemConfigPath(centerDirectory),
            "utf-8",
        );
        const parsed = JSON.parse(rawContent) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        return parsed as CenterSystemConfigFile;
    } catch {
        return {};
    }
}

/**
 * writeCenterSystemConfig：覆盖写入系统配置文件。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param config 配置文件对象。
 * @returns 没有返回值。
 */
function writeCenterSystemConfig(
    centerDirectory: string,
    config: CenterSystemConfigFile,
): void {
    const configPath = resolveCenterSystemConfigPath(centerDirectory);
    mkdirSync(dirname(configPath), {
        recursive: true,
    });
    writeFileSync(
        configPath,
        `${JSON.stringify(config, null, 2)}\n`,
        "utf-8",
    );
}

/**
 * resolveCenterRuntimeEnvironment：解析中心服务运行环境。
 *
 * @param env 进程环境变量。
 * @returns production 或 development。
 */
function resolveCenterRuntimeEnvironment(env: NodeJS.ProcessEnv): CenterRuntimeEnvironment {
    return env.NODE_ENV === "production"
        ? "production"
        : "development";
}

/**
 * resolveEnvironmentDefaultLogLevel：解析环境默认日志等级。
 *
 * @param runtimeEnvironment 中心服务运行环境。
 * @returns 开发环境 debug，生产环境 info。
 */
function resolveEnvironmentDefaultLogLevel(runtimeEnvironment: CenterRuntimeEnvironment): CenterLogLevel {
    return runtimeEnvironment === "production"
        ? "info"
        : "debug";
}
