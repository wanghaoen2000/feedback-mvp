import { int, mediumtext, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, index, varchar } from "drizzle-orm/mysql-core";

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
  /**
   * Email is the **business unique identifier** for a user.
   * Used to match pre-created (manual) users with real OAuth logins.
   * Must be unique when non-null — two records with the same email are
   * treated as the same person and will be merged on OAuth login.
   */
  email: varchar("email", { length: 320 }).unique(),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** 用户状态: active=正常使用, suspended=暂停(数据保留但不能登录) */
  accountStatus: varchar("account_status", { length: 20 }).notNull().default("active"),
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

// 用户级配置表（per-user overrides for systemConfig）
export const userConfig = mysqlTable("user_config", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  key: varchar("key", { length: 64 }).notNull(),
  value: mediumtext("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("idx_user_key").on(table.userId, table.key),
  index("idx_userId").on(table.userId),
]);

export type UserConfig = typeof userConfig.$inferSelect;
export type InsertUserConfig = typeof userConfig.$inferInsert;

// Google Drive OAuth Token表（每用户独立 OAuth 凭证）
export const googleTokens = mysqlTable("google_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(), // 所属用户
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (table) => [
  uniqueIndex("idx_google_tokens_user").on(table.userId),
]);

export type GoogleToken = typeof googleTokens.$inferSelect;
export type InsertGoogleToken = typeof googleTokens.$inferInsert;

// 后台任务表 - 支持服务器端离线生成
export const backgroundTasks = mysqlTable("background_tasks", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  userId: int("user_id").notNull(), // 所属用户
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
}, (table) => [
  index("idx_background_tasks_user_id").on(table.userId),
]);

export type BackgroundTask = typeof backgroundTasks.$inferSelect;
export type InsertBackgroundTask = typeof backgroundTasks.$inferInsert;

// 学生管理系统 - 学生名册
export const hwStudents = mysqlTable("hw_students", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(), // 所属用户
  name: varchar("name", { length: 64 }).notNull(),
  planType: varchar("plan_type", { length: 10 }).notNull().default("weekly"), // 'daily' | 'weekly'
  currentStatus: mediumtext("current_status"), // 学生当前正式状态文档（迭代更新）
  status: varchar("status", { length: 10 }).notNull().default("active"), // 'active' | 'inactive'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("idx_hw_user_name").on(table.userId, table.name),
  index("idx_hw_userId").on(table.userId),
]);

export type HwStudent = typeof hwStudents.$inferSelect;
export type InsertHwStudent = typeof hwStudents.$inferInsert;

// 学生管理系统 - 语音输入条目（预入库队列）
export const hwEntries = mysqlTable("hw_entries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(), // 所属用户
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
}, (table) => [
  index("idx_entry_userId").on(table.userId),
]);

export type HwEntry = typeof hwEntries.$inferSelect;
export type InsertHwEntry = typeof hwEntries.$inferInsert;

// 批量任务表（服务器端后台执行）
export const batchTasks = mysqlTable("batch_tasks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("user_id").notNull(), // 所属用户
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
}, (table) => [
  index("idx_batch_userId").on(table.userId),
]);

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
}, (table) => [
  index("idx_batch_id").on(table.batchId),
]);

export type BatchTaskItem = typeof batchTaskItems.$inferSelect;
export type InsertBatchTaskItem = typeof batchTaskItems.$inferInsert;

// 作业批改任务表
export const correctionTasks = mysqlTable("correction_tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(), // 所属用户
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
}, (table) => [
  index("idx_corr_userId").on(table.userId),
]);

export type CorrectionTask = typeof correctionTasks.$inferSelect;
export type InsertCorrectionTask = typeof correctionTasks.$inferInsert;

// 一键打分任务表（后台执行，180天留存）
export const gradingTasks = mysqlTable("grading_tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  startDate: varchar("start_date", { length: 10 }).notNull(), // YYYY-MM-DD
  endDate: varchar("end_date", { length: 10 }).notNull(),
  gradingPrompt: mediumtext("grading_prompt").notNull(),
  userNotes: text("user_notes"),
  studentCount: int("student_count").default(0),
  systemPrompt: mediumtext("system_prompt"),          // 完整系统提示词快照
  result: mediumtext("result"),                       // AI打分结果
  editedResult: mediumtext("edited_result"),           // 教师编辑后的打分结果
  aiModel: varchar("ai_model", { length: 128 }),
  taskStatus: varchar("task_status", { length: 20 }).notNull().default("pending"), // pending | processing | completed | failed
  errorMessage: text("error_message"),
  streamingChars: int("streaming_chars").default(0),
  // 同步到学生状态相关字段
  syncStatus: varchar("sync_status", { length: 20 }),  // null | syncing | completed | failed
  syncTotal: int("sync_total").default(0),
  syncCompleted: int("sync_completed").default(0),
  syncFailed: int("sync_failed").default(0),
  syncError: text("sync_error"),
  syncSystemPrompt: mediumtext("sync_system_prompt"),   // 同步使用的系统提示词
  syncConcurrency: int("sync_concurrency").default(20), // 同步并发数
  syncImported: varchar("sync_imported", { length: 20 }), // null | 'imported'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_grading_userId").on(table.userId),
]);

export type GradingTask = typeof gradingTasks.$inferSelect;
export type InsertGradingTask = typeof gradingTasks.$inferInsert;

// 打分同步子任务表（每个学生一条记录）
export const gradingSyncItems = mysqlTable("grading_sync_items", {
  id: int("id").autoincrement().primaryKey(),
  gradingTaskId: int("grading_task_id").notNull(),
  studentId: int("student_id").notNull(),
  studentName: varchar("student_name", { length: 64 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | running | completed | failed
  chars: int("chars").default(0),           // 流式接收字符数
  result: mediumtext("result"),             // AI生成的更新后状态文档
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_sync_grading_id").on(table.gradingTaskId),
]);

export type GradingSyncItem = typeof gradingSyncItems.$inferSelect;
export type InsertGradingSyncItem = typeof gradingSyncItems.$inferInsert;

// 作业提醒任务表（一键催作业，30天留存）
export const reminderTasks = mysqlTable("reminder_tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  reminderPrompt: mediumtext("reminder_prompt").notNull(),
  studentCount: int("student_count").default(0),
  studentData: mediumtext("student_data"),            // 发送给AI的学生数据快照
  systemPrompt: mediumtext("system_prompt"),           // 完整系统提示词快照
  result: mediumtext("result"),                        // AI生成的催作业结果
  aiModel: varchar("ai_model", { length: 128 }),
  taskStatus: varchar("task_status", { length: 20 }).notNull().default("pending"), // pending | processing | completed | failed
  errorMessage: text("error_message"),
  streamingChars: int("streaming_chars").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_reminder_userId").on(table.userId),
]);

export type ReminderTask = typeof reminderTasks.$inferSelect;
export type InsertReminderTask = typeof reminderTasks.$inferInsert;
