import type Database from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";

import type {CenterDatabase} from "../database.js";
import * as schema from "./schema.js";

/**
 * CenterDrizzleDatabase：Drizzle 数据库类型。
 *
 * 来源：中心服务唯一 better-sqlite3 连接。
 * 含义：提供 Repository/Query 层类型化访问能力。
 */
export type CenterDrizzleDatabase = ReturnType<typeof drizzle<typeof schema>>;

/**
 * createDrizzleDatabase：从中心服务唯一连接创建 Drizzle 适配器。
 *
 * @param connection better-sqlite3 连接。
 * @returns Drizzle 数据库实例。
 */
export function createDrizzleDatabase(connection: Database.Database): CenterDrizzleDatabase {
    return drizzle(
        connection,
        {
            schema,
        },
    );
}

/**
 * getDrizzleDatabase：获取 CenterDatabase 绑定的 Drizzle 适配器。
 *
 * @param database 中心服务数据库包装。
 * @returns Drizzle 数据库实例。
 */
export function getDrizzleDatabase(database: CenterDatabase): CenterDrizzleDatabase {
    return database.drizzleConnection();
}
