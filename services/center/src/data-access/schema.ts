import {
    integer,
    sqliteTable,
    text,
} from "drizzle-orm/sqlite-core";

/**
 * sessionsTable：会话表 Drizzle schema。
 *
 * 来源：SQLite `sessions` 表。
 * 含义：为独立持久层提供类型化表结构。
 * 约束：只描述现有表，不创建新的 SQLite 连接。
 */
export const sessionsTable = sqliteTable("sessions", {
    /** id: 会话 ID。 */
    id: text("id").primaryKey(),
    /** sessionType: 会话类型，normal 或 project。 */
    sessionType: text("session_type").notNull(),
    /** projectId: 项目会话绑定项目 ID，普通会话为空。 */
    projectId: text("project_id"),
    /** title: 会话标题。 */
    title: text("title").notNull(),
    /** createdAt: 创建时间 ISO 字符串。 */
    createdAt: text("created_at").notNull(),
    /** updatedAt: 更新时间 ISO 字符串。 */
    updatedAt: text("updated_at").notNull(),
});

/**
 * messagesTable：消息表 Drizzle schema。
 */
export const messagesTable = sqliteTable("messages", {
    /** id: 消息 ID。 */
    id: text("id").primaryKey(),
    /** sessionId: 所属会话 ID。 */
    sessionId: text("session_id").notNull(),
    /** turnId: 所属轮次 ID。 */
    turnId: text("turn_id"),
    /** role: 消息角色。 */
    role: text("role").notNull(),
    /** contentMarkdown: Markdown 内容。 */
    contentMarkdown: text("content_markdown").notNull(),
    /** createdAt: 创建时间 ISO 字符串。 */
    createdAt: text("created_at").notNull(),
});

/**
 * tasksTable：任务表 Drizzle schema。
 */
export const tasksTable = sqliteTable("tasks", {
    /** id: 任务 ID。 */
    id: text("id").primaryKey(),
    /** turnId: 所属轮次 ID。 */
    turnId: text("turn_id").notNull(),
    /** sessionId: 所属会话 ID。 */
    sessionId: text("session_id").notNull(),
    /** agentId: 所属智能体 ID，主智能体固定为 main。 */
    agentId: text("agent_id").notNull().default("main"),
    /** status: 任务状态。 */
    status: text("status").notNull(),
    /** title: 任务标题。 */
    title: text("title").notNull(),
    /** createdAt: 创建时间 ISO 字符串。 */
    createdAt: text("created_at").notNull(),
    /** updatedAt: 更新时间 ISO 字符串。 */
    updatedAt: text("updated_at").notNull(),
});

/**
 * eventsTable：事件表 Drizzle schema。
 */
export const eventsTable = sqliteTable("events", {
    /** id: 事件 ID。 */
    id: text("id").primaryKey(),
    /** eventType: 事件类型。 */
    eventType: text("event_type").notNull(),
    /** turnId: 所属轮次 ID。 */
    turnId: text("turn_id"),
    /** taskId: 所属任务 ID。 */
    taskId: text("task_id"),
    /** sequence: 同轮次递增序号。 */
    sequence: integer("sequence").notNull(),
    /** occurredAt: 发生时间 ISO 字符串。 */
    occurredAt: text("occurred_at").notNull(),
    /** summary: 事件摘要。 */
    summary: text("summary").notNull(),
    /** payloadJson: JSON 载荷。 */
    payloadJson: text("payload_json").notNull(),
    /** traceId: 排查 ID。 */
    traceId: text("trace_id").notNull(),
});
