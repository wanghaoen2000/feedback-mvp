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

// 任务进度表 - 用于断点续传
 export const taskProgress = mysqlTable("task_progress", {
  id: int("id").autoincrement().primaryKey(),
  // 任务唯一标识：学生名 + 日期
  taskKey: varchar("taskKey", { length: 128 }).notNull().unique(),
  studentName: varchar("studentName", { length: 64 }).notNull(),
  // 输入数据（JSON格式）
  inputData: text("inputData").notNull(),
  // 当前进度：0-5（0=未开始，1-5=已完成的步骤数）
  currentStep: int("currentStep").default(0).notNull(),
  // 各步骤结果（JSON格式）
  step1Result: text("step1Result"), // 学情反馈内容 + 上传结果
  step2Result: text("step2Result"), // 复习文档上传结果
  step3Result: text("step3Result"), // 测试本上传结果
  step4Result: text("step4Result"), // 课后信息上传结果
  step5Result: text("step5Result"), // 气泡图上传结果
  // 提取的日期字符串
  dateStr: varchar("dateStr", { length: 32 }),
  // 状态：pending/running/completed/failed
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"]).default("pending").notNull(),
  // 错误信息
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TaskProgress = typeof taskProgress.$inferSelect;
export type InsertTaskProgress = typeof taskProgress.$inferInsert;