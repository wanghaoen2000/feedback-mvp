import { int, mediumtext, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
  value: mediumtext("value").notNull(),
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
  inputParams: mediumtext("input_params").notNull(), // JSON: 所有生成参数（可能很大，含完整笔记/转录文本）
  stepResults: mediumtext("step_results"), // JSON: 每步结果
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type BackgroundTask = typeof backgroundTasks.$inferSelect;
export type InsertBackgroundTask = typeof backgroundTasks.$inferInsert;

// 学生管理系统 - 学生名册
export const hwStudents = mysqlTable("hw_students", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  planType: varchar("plan_type", { length: 10 }).notNull().default("weekly"), // 'daily' | 'weekly'
  nextClassDate: varchar("next_class_date", { length: 20 }),
  examTarget: varchar("exam_target", { length: 255 }),
  examDate: varchar("exam_date", { length: 20 }),
  currentStatus: mediumtext("current_status"), // 学生当前正式状态文档（迭代更新）
  status: varchar("status", { length: 10 }).notNull().default("active"), // 'active' | 'inactive'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type HwStudent = typeof hwStudents.$inferSelect;
export type InsertHwStudent = typeof hwStudents.$inferInsert;

// 学生管理系统 - 语音输入条目（预入库队列）
export const hwEntries = mysqlTable("hw_entries", {
  id: int("id").autoincrement().primaryKey(),
  studentName: varchar("student_name", { length: 64 }).notNull(),
  rawInput: text("raw_input").notNull(),
  parsedContent: mediumtext("parsed_content"),
  aiModel: varchar("ai_model", { length: 128 }),
  entryStatus: varchar("entry_status", { length: 20 }).notNull().default("pending"), // pending | processing | pre_staged | confirmed | failed
  errorMessage: text("error_message"),
  streamingChars: int("streaming_chars").default(0),       // 流式接收字符数（实时更新）
  startedAt: timestamp("started_at"),                       // AI处理开始时间
  completedAt: timestamp("completed_at"),                   // AI处理完成时间
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type HwEntry = typeof hwEntries.$inferSelect;
export type InsertHwEntry = typeof hwEntries.$inferInsert;

// 批量任务表（服务器端后台执行）
export const batchTasks = mysqlTable("batch_tasks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  displayName: varchar("display_name", { length: 200 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | running | completed | failed | stopped | cancelled
  totalItems: int("total_items").notNull().default(0),
  completedItems: int("completed_items").notNull().default(0),
  failedItems: int("failed_items").notNull().default(0),
  inputParams: mediumtext("input_params").notNull(), // JSON: 路书、模板类型、文件信息等
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type BatchTask = typeof batchTasks.$inferSelect;
export type InsertBatchTask = typeof batchTasks.$inferInsert;

// 批量任务子项表
export const batchTaskItems = mysqlTable("batch_task_items", {
  id: int("id").autoincrement().primaryKey(),
  batchId: varchar("batch_id", { length: 36 }).notNull(),
  taskNumber: int("task_number").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | running | completed | failed
  chars: int("chars").default(0),
  filename: varchar("filename", { length: 500 }),
  url: text("url"),
  error: text("error"),
  truncated: int("truncated").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type BatchTaskItem = typeof batchTaskItems.$inferSelect;
export type InsertBatchTaskItem = typeof batchTaskItems.$inferInsert;

// 作业批改任务表
export const correctionTasks = mysqlTable("correction_tasks", {
  id: int("id").autoincrement().primaryKey(),
  studentName: varchar("student_name", { length: 64 }).notNull(),
  correctionType: varchar("correction_type", { length: 64 }).notNull(),
  rawText: mediumtext("raw_text"),                    // 用户输入的文本内容
  images: mediumtext("images"),                       // JSON: base64图片数组
  files: mediumtext("files"),                         // JSON: [{name, extractedText}]
  studentStatus: mediumtext("student_status"),        // 提交时的学生状态快照
  systemPrompt: mediumtext("system_prompt"),          // 使用的完整系统提示词
  resultCorrection: mediumtext("result_correction"),  // AI批改结果（给学生的）
  resultStatusUpdate: mediumtext("result_status_update"), // AI状态更新（给学生管理的）
  aiModel: varchar("ai_model", { length: 128 }),
  taskStatus: varchar("task_status", { length: 20 }).notNull().default("pending"), // pending | processing | completed | failed
  errorMessage: text("error_message"),
  streamingChars: int("streaming_chars").default(0),  // 流式接收字符数（实时更新）
  autoImported: int("auto_imported").default(0),      // 是否已自动推送到学生管理
  importEntryId: int("import_entry_id"),              // 推送后的条目ID
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type CorrectionTask = typeof correctionTasks.$inferSelect;
export type InsertCorrectionTask = typeof correctionTasks.$inferInsert;
