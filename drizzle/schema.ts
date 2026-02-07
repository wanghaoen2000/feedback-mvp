import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// 系统配置表
export const systemConfig = mysqlTable("system_config", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SystemConfig = typeof systemConfig.$inferSelect;
export type InsertSystemConfig = typeof systemConfig.$inferInsert;

// Google Drive OAuth Token表
export const googleTokens = mysqlTable("google_tokens", {
  id: int("id").autoincrement().primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export type GoogleToken = typeof googleTokens.$inferSelect;
export type InsertGoogleToken = typeof googleTokens.$inferInsert;

// 后台任务表 - 支持服务器端离线生成
export const backgroundTasks = mysqlTable("background_tasks", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  courseType: varchar("course_type", { length: 20 }).notNull(), // 'one-to-one' | 'class'
  displayName: varchar("display_name", { length: 200 }).notNull(), // "孙浩然 第12次" 等
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | running | completed | failed | partial
  currentStep: int("current_step").notNull().default(0),
  totalSteps: int("total_steps").notNull().default(5),
  inputParams: text("input_params").notNull(), // JSON: 所有生成参数
  stepResults: text("step_results"), // JSON: 每步结果
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type BackgroundTask = typeof backgroundTasks.$inferSelect;
export type InsertBackgroundTask = typeof backgroundTasks.$inferInsert;
