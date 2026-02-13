/**
 * 学生管理系统 - 后端逻辑（代码中 hw/homework 前缀均指本模块）
 * 包含：表自动创建、学生管理、AI处理、预入库队列
 */

import { getDb } from "./db";
import { hwStudents, hwEntries } from "../drizzle/schema";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { invokeWhatAIStream } from "./whatai";
import { getConfigValue } from "./core/aiClient";
import { getBeijingTimeContext } from "./utils";

// ============= 表自动创建 =============

let tableEnsured = false;

export async function ensureHwTables(): Promise<void> {
  if (tableEnsured) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS \`hw_students\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`name\` varchar(64) NOT NULL,
      \`plan_type\` varchar(10) NOT NULL DEFAULT 'weekly',
      \`next_class_date\` varchar(20),
      \`exam_target\` varchar(255),
      \`exam_date\` varchar(20),
      \`status\` varchar(10) NOT NULL DEFAULT 'active',
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`hw_students_name_unique\` (\`name\`)
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS \`hw_entries\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`student_name\` varchar(64) NOT NULL,
      \`raw_input\` text NOT NULL,
      \`parsed_content\` mediumtext,
      \`ai_model\` varchar(128),
      \`entry_status\` varchar(20) NOT NULL DEFAULT 'pending',
      \`error_message\` text,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`)
    )`);
    // 安全添加新列（已有表可能没有）
    const safeAddColumn = async (table: string, col: string, def: string) => {
      try {
        await db.execute(sql.raw(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`));
      } catch (e: any) {
        if (!e?.message?.includes("Duplicate column")) {
          console.warn(`[学生管理] ALTER TABLE ${table} 警告:`, e?.message);
        }
      }
    };
    await safeAddColumn("hw_students", "current_status", "MEDIUMTEXT");
    await safeAddColumn("hw_entries", "streaming_chars", "INT DEFAULT 0");
    await safeAddColumn("hw_entries", "started_at", "TIMESTAMP NULL");
    await safeAddColumn("hw_entries", "completed_at", "TIMESTAMP NULL");
    tableEnsured = true;
    console.log("[学生管理] 表已就绪");
    // 恢复卡死的条目：服务器重启后 processing/pending 状态的条目不会继续处理
    try {
      const stuck = await db.update(hwEntries)
        .set({ entryStatus: "failed", errorMessage: "服务器重启，处理中断，请重试" })
        .where(inArray(hwEntries.entryStatus, ["processing", "pending"]));
      // MySQL returns affected rows info
      const affectedRows = (stuck as any)[0]?.affectedRows ?? 0;
      if (affectedRows > 0) {
        console.log(`[学生管理] 恢复 ${affectedRows} 条卡死条目为失败状态`);
      }
    } catch (recoverErr: any) {
      console.warn("[学生管理] 恢复卡死条目失败:", recoverErr?.message);
    }
  } catch (err: any) {
    console.error("[学生管理] 建表失败:", err?.message || err);
  }
}

// ============= 学生管理 =============

export async function listStudents(statusFilter?: string) {
  await ensureHwTables();
  const db = await getDb();
  if (!db) return [];
  const condition = statusFilter ? eq(hwStudents.status, statusFilter) : undefined;
  const rows = condition
    ? await db.select().from(hwStudents).where(condition).orderBy(hwStudents.name)
    : await db.select().from(hwStudents).orderBy(hwStudents.name);
  return rows;
}

export async function addStudent(name: string, planType: string = "weekly") {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  // 检查是否存在同名的 inactive 学生，有则重新激活
  const existing = await db.select().from(hwStudents)
    .where(eq(hwStudents.name, name.trim()))
    .limit(1);
  if (existing.length > 0) {
    if (existing[0].status === "inactive") {
      await db.update(hwStudents)
        .set({ status: "active", planType })
        .where(eq(hwStudents.id, existing[0].id));
      console.log(`[学生管理] 重新激活学生: ${name}`);
      return { success: true };
    }
    throw new Error(`学生「${name.trim()}」已存在`);
  }
  await db.insert(hwStudents).values({ name: name.trim(), planType });
  return { success: true };
}

export async function updateStudent(id: number, data: {
  name?: string;
  planType?: string;
  nextClassDate?: string | null;
  examTarget?: string | null;
  examDate?: string | null;
  status?: string;
}) {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const updateObj: Record<string, any> = {};
  if (data.name !== undefined) updateObj.name = data.name.trim();
  if (data.planType !== undefined) updateObj.planType = data.planType;
  if (data.nextClassDate !== undefined) updateObj.nextClassDate = data.nextClassDate;
  if (data.examTarget !== undefined) updateObj.examTarget = data.examTarget;
  if (data.examDate !== undefined) updateObj.examDate = data.examDate;
  if (data.status !== undefined) updateObj.status = data.status;
  if (Object.keys(updateObj).length === 0) return { success: true };
  await db.update(hwStudents).set(updateObj).where(eq(hwStudents.id, id));
  return { success: true };
}

export async function removeStudent(id: number) {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  await db.update(hwStudents).set({ status: "inactive" }).where(eq(hwStudents.id, id));
  return { success: true };
}

// ============= AI 处理 =============

// 默认系统提示词（用户未配置自定义提示词时的兜底）
const HW_DEFAULT_SYSTEM_PROMPT = `你是一个教学助手的学生管理助手。你的任务是将教师的语音转文字记录整理为结构化的学生管理数据。

输出格式要求（严格遵守，所有字段必须填写）：

【学生姓名】（使用我提供的姓名，不要用语音中的）
【记录类型】作业完成登记 / 作业布置更新 / 课后提醒 / 状态更新 / 其他（选择最合适的一个）
【日期】从内容推断具体日期，无法推断则填"无信息"
【详细内容】
- 逐条列出具体信息，每条一行
- 如果涉及作业完成情况，标明：已完成 / 未完成 / 部分完成
- 如果涉及作业布置，列出具体任务和截止时间
【备注】额外说明，没有则填"无信息"

重要规则：
1. 所有字段都必须填写，没有信息的填"无信息"，绝对不要留空
2. 内容为语音转文字，可能有错别字或不通顺的地方，请智能理解
3. 学生姓名以我提供的为准，语音中可能识别错误
4. 只输出上述格式的结构化数据，不要添加任何额外解释或问候语`;

// 系统提示词（固定部分，不管有没有自定义提示词都会发送）
function buildSystemContext(studentName: string): string {
  return `${getBeijingTimeContext()}\n当前学生姓名：${studentName}\n⚠️ 学生姓名以此处系统提供的「${studentName}」为唯一标准。语音转文字中出现的姓名可能识别错误，一律以此为准，不要被带跑。`;
}

/**
 * 获取学生的最新状态文档（优先取预入库中最新的，否则取正式状态）
 */
export async function getStudentLatestStatus(studentName: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  // 先查预入库队列中该学生最新的 pre_staged 条目
  const latestPreStaged = await db.select({ parsedContent: hwEntries.parsedContent })
    .from(hwEntries)
    .where(and(
      eq(hwEntries.studentName, studentName),
      eq(hwEntries.entryStatus, "pre_staged"),
    ))
    .orderBy(desc(hwEntries.createdAt))
    .limit(1);

  if (latestPreStaged.length > 0 && latestPreStaged[0].parsedContent) {
    return latestPreStaged[0].parsedContent;
  }

  // 没有预入库的就取正式状态
  const student = await db.select({ currentStatus: hwStudents.currentStatus })
    .from(hwStudents)
    .where(eq(hwStudents.name, studentName))
    .limit(1);

  return student[0]?.currentStatus || null;
}

export async function processEntry(
  studentName: string,
  rawInput: string,
  aiModel?: string,
  onProgress?: (chars: number) => void,
): Promise<{ parsedContent: string; model: string }> {
  // Build API config
  const apiKey = await getConfigValue("apiKey");
  const apiUrl = await getConfigValue("apiUrl");
  const modelToUse = aiModel || await getConfigValue("apiModel") || "claude-sonnet-4-5-20250929";

  // 读取用户自定义提示词
  const hwPromptTemplate = await getConfigValue("hwPromptTemplate");

  // 构建系统提示词：时间戳+学生姓名（固定）+ 自定义提示词或默认提示词
  let systemPrompt: string;
  if (hwPromptTemplate && hwPromptTemplate.trim()) {
    systemPrompt = `${buildSystemContext(studentName)}\n\n${hwPromptTemplate.trim()}`;
  } else {
    systemPrompt = `${buildSystemContext(studentName)}\n\n${HW_DEFAULT_SYSTEM_PROMPT}`;
  }

  // 获取学生的当前状态文档（用于迭代更新）
  const existingStatus = await getStudentLatestStatus(studentName);

  let userPrompt: string;
  if (existingStatus) {
    // 迭代模式：有现有状态，让AI在此基础上更新
    userPrompt = `【该学生当前的状态文档】\n${existingStatus}\n\n【本次新增信息（语音转文字原文）】\n${rawInput}\n\n请根据本次新增信息，更新上述状态文档，输出更新后的完整状态文档。只输出更新后的文档内容，不要加任何额外说明。`;
  } else {
    // 全新模式：没有现有状态，从零开始
    userPrompt = `【语音转文字原文】\n${rawInput}\n\n请按照系统提示中的格式要求，整理输出。`;
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  // 流式进度回调：每秒上报字符数
  let charCount = 0;
  let lastProgressTime = 0;
  const chunkCallback = onProgress ? (chunk: string) => {
    charCount += chunk.length;
    const now = Date.now();
    if (now - lastProgressTime >= 1000) {
      onProgress(charCount);
      lastProgressTime = now;
    }
  } : undefined;

  // 使用流式调用，避免大输入时中间层超时
  const content = await invokeWhatAIStream(messages, {
    max_tokens: 4000,
    temperature: 0.3,
    retries: 1,
  }, {
    apiModel: modelToUse,
    apiKey,
    apiUrl,
  }, chunkCallback);

  if (!content) {
    throw new Error("AI 返回空内容");
  }

  // 最终上报确保字符数准确
  if (onProgress) onProgress(content.length);

  return { parsedContent: content.trim(), model: modelToUse };
}

// ============= 条目管理（预入库队列） =============

export async function createEntry(studentName: string, rawInput: string, aiModel?: string) {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const result = await db.insert(hwEntries).values({
    studentName: studentName.trim(),
    rawInput: rawInput.trim(),
    aiModel: aiModel || null,
    entryStatus: "pending",
  });
  // MySQL insert returns insertId
  const insertId = (result as any)[0]?.insertId;
  if (!insertId || typeof insertId !== "number") {
    throw new Error("创建条目失败：无法获取条目ID");
  }
  return { id: insertId };
}

export async function submitAndProcessEntry(
  studentName: string,
  rawInput: string,
  aiModel?: string,
): Promise<{ id: number; status: string }> {
  // Create entry first
  const { id } = await createEntry(studentName, rawInput, aiModel);

  // 后台异步处理 — 立即返回，不阻塞用户继续提交其他条目
  // 前端通过 5 秒轮询 listPendingEntries 获取最新状态
  processEntryInBackground(id, studentName, rawInput, aiModel);

  return { id, status: "pending" };
}

/** 后台处理单个条目（不阻塞调用方） */
async function processEntryInBackground(
  id: number,
  studentName: string,
  rawInput: string,
  aiModel?: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Update status to processing, record start time
  await db.update(hwEntries)
    .set({ entryStatus: "processing", startedAt: new Date(), streamingChars: 0 })
    .where(eq(hwEntries.id, id));

  try {
    // 流式进度回调：每秒更新 streaming_chars
    const onProgress = (chars: number) => {
      db.update(hwEntries)
        .set({ streamingChars: chars })
        .where(eq(hwEntries.id, id))
        .catch(() => {}); // 进度更新失败不影响主流程
    };

    // Process with AI
    const { parsedContent, model } = await processEntry(studentName, rawInput, aiModel, onProgress);

    // Validate: check for empty fields
    const hasEmptyFields = parsedContent.includes("【】") || /【[^】]+】\s*\n\s*\n/.test(parsedContent);
    if (hasEmptyFields) {
      console.warn(`[学生管理] 条目 ${id} 解析结果有空字段`);
    }

    // Update entry with parsed content
    await db.update(hwEntries)
      .set({
        parsedContent,
        entryStatus: "pre_staged",
        errorMessage: null,
        aiModel: model,
        streamingChars: parsedContent.length,
        completedAt: new Date(),
      })
      .where(eq(hwEntries.id, id));

    console.log(`[学生管理] 条目 ${id} 处理完成, ${parsedContent.length}字`);
  } catch (err: any) {
    const errorMsg = err?.message || "AI处理失败";
    console.error(`[学生管理] 条目 ${id} 处理失败:`, errorMsg);

    await db.update(hwEntries)
      .set({
        entryStatus: "failed",
        errorMessage: errorMsg,
        completedAt: new Date(),
      })
      .where(eq(hwEntries.id, id));
  }
}

export async function listEntries(statusFilter?: string) {
  await ensureHwTables();
  const db = await getDb();
  if (!db) return [];
  const condition = statusFilter
    ? eq(hwEntries.entryStatus, statusFilter)
    : undefined;
  const rows = condition
    ? await db.select().from(hwEntries).where(condition).orderBy(desc(hwEntries.createdAt))
    : await db.select().from(hwEntries).orderBy(desc(hwEntries.createdAt));
  return rows;
}

export async function listPendingEntries() {
  await ensureHwTables();
  const db = await getDb();
  if (!db) return [];
  return db.select().from(hwEntries)
    .where(
      inArray(hwEntries.entryStatus, ["pending", "processing", "pre_staged", "failed"])
    )
    .orderBy(desc(hwEntries.createdAt));
}

/** 查询某学生的已入库记录（confirmed），支持分页 */
export async function listStudentEntries(studentName: string, limit: number = 50, offset: number = 0) {
  await ensureHwTables();
  const db = await getDb();
  if (!db) return { entries: [], total: 0 };

  const condition = and(
    eq(hwEntries.studentName, studentName),
    eq(hwEntries.entryStatus, "confirmed")
  );

  const [rows, countResult] = await Promise.all([
    db.select().from(hwEntries)
      .where(condition)
      .orderBy(desc(hwEntries.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`COUNT(*)` }).from(hwEntries)
      .where(condition),
  ]);

  return { entries: rows, total: Number(countResult[0]?.count ?? 0) };
}

export async function retryEntry(id: number) {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const rows = await db.select().from(hwEntries).where(eq(hwEntries.id, id)).limit(1);
  if (rows.length === 0) throw new Error("条目不存在");
  const entry = rows[0];
  if (entry.entryStatus !== "failed" && entry.entryStatus !== "pre_staged") {
    throw new Error(`条目当前状态为「${entry.entryStatus}」，只能重试失败或待入库的条目`);
  }

  // Reset to processing, clear old progress data
  await db.update(hwEntries)
    .set({ entryStatus: "processing", errorMessage: null, streamingChars: 0, startedAt: new Date(), completedAt: null })
    .where(eq(hwEntries.id, id));

  try {
    // 流式进度回调（与 processEntryInBackground 一致）
    const onProgress = (chars: number) => {
      db.update(hwEntries)
        .set({ streamingChars: chars })
        .where(eq(hwEntries.id, id))
        .catch(() => {});
    };

    const { parsedContent, model } = await processEntry(
      entry.studentName,
      entry.rawInput,
      entry.aiModel || undefined,
      onProgress,
    );

    await db.update(hwEntries)
      .set({
        parsedContent,
        entryStatus: "pre_staged",
        errorMessage: null,
        aiModel: model,
        streamingChars: parsedContent.length,
        completedAt: new Date(),
      })
      .where(eq(hwEntries.id, id));

    return { id, status: "pre_staged", parsedContent };
  } catch (err: any) {
    const errorMsg = err?.message || "AI处理失败";
    await db.update(hwEntries)
      .set({ entryStatus: "failed", errorMessage: errorMsg, completedAt: new Date() })
      .where(eq(hwEntries.id, id));
    return { id, status: "failed", error: errorMsg };
  }
}

export async function deleteEntry(id: number) {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  await db.delete(hwEntries).where(eq(hwEntries.id, id));
  return { success: true };
}

export async function confirmEntries(ids: number[]) {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  if (ids.length === 0) return { count: 0 };

  // 获取指定的 pre_staged 条目
  const entries = await db.select().from(hwEntries)
    .where(and(inArray(hwEntries.id, ids), eq(hwEntries.entryStatus, "pre_staged")))
    .orderBy(desc(hwEntries.createdAt));

  if (entries.length === 0) return { count: 0 };

  // 按学生分组，每个学生取最新一条的 parsedContent 存入 current_status
  const studentLatest = new Map<string, string>();
  for (const entry of entries) {
    if (!studentLatest.has(entry.studentName) && entry.parsedContent) {
      studentLatest.set(entry.studentName, entry.parsedContent);
    }
  }

  const studentNames = Array.from(studentLatest.keys());
  for (const name of studentNames) {
    await db.update(hwStudents)
      .set({ currentStatus: studentLatest.get(name)! })
      .where(eq(hwStudents.name, name));
  }

  // 删除这些条目
  await db.delete(hwEntries).where(inArray(hwEntries.id, ids));

  return { count: entries.length };
}

export async function confirmAllPreStaged() {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 1. 获取所有 pre_staged 条目
  const preStagedEntries = await db.select().from(hwEntries)
    .where(eq(hwEntries.entryStatus, "pre_staged"))
    .orderBy(desc(hwEntries.createdAt));

  if (preStagedEntries.length === 0) return { success: true, updatedStudents: [] };

  // 2. 按学生分组，每个学生取最新一条的 parsedContent 存入 current_status
  const studentLatest = new Map<string, string>();
  for (const entry of preStagedEntries) {
    if (!studentLatest.has(entry.studentName) && entry.parsedContent) {
      studentLatest.set(entry.studentName, entry.parsedContent);
    }
  }

  // 3. 更新每个学生的 current_status
  const updatedStudents: string[] = Array.from(studentLatest.keys());
  for (const name of updatedStudents) {
    await db.update(hwStudents)
      .set({ currentStatus: studentLatest.get(name)! })
      .where(eq(hwStudents.name, name));
    console.log(`[学生管理] 入库: ${name} 的状态已更新`);
  }

  // 4. 删除所有 pre_staged 条目（旧记录不保留）
  const entryIds = preStagedEntries.map(e => e.id);
  await db.delete(hwEntries).where(inArray(hwEntries.id, entryIds));
  console.log(`[学生管理] 入库完成: 已删除 ${entryIds.length} 条预入库记录`);

  return { success: true, updatedStudents };
}

// ============= 从课后信息提取一键导入 =============

export async function importFromExtraction(
  studentName: string,
  extractionContent: string,
): Promise<{ id: number; studentCreated: boolean }> {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 自动创建学生（如不存在）或重新激活（如已删除）
  let studentCreated = false;
  const existing = await db.select().from(hwStudents)
    .where(eq(hwStudents.name, studentName.trim()))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(hwStudents).values({
      name: studentName.trim(),
      planType: "weekly",
      status: "active",
    });
    studentCreated = true;
    console.log(`[学生管理] 自动创建学生: ${studentName}`);
  } else if (existing[0].status === "inactive") {
    // 学生曾被删除，重新激活
    await db.update(hwStudents).set({ status: "active" }).where(eq(hwStudents.id, existing[0].id));
    studentCreated = true;
    console.log(`[学生管理] 重新激活学生: ${studentName}`);
  }

  // 创建 pending 条目，走 AI 处理流程（课后信息提取内容格式与学生管理格式不同，需要 AI 转换）
  const rawInput = `[从课后信息提取导入]\n${extractionContent.trim()}`;
  const { id } = await createEntry(studentName, rawInput);
  console.log(`[学生管理] 从课后信息提取导入: ${studentName}, 条目ID: ${id}, 将进行AI处理`);

  // 后台异步 AI 处理（不阻塞返回）
  processEntryInBackground(id, studentName, rawInput);

  return { id, studentCreated };
}

/**
 * 从后台任务ID获取课后信息提取内容并导入
 */
export async function importFromTaskExtraction(
  taskId: string,
  studentName: string,
): Promise<{ id: number; studentCreated: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 从后台任务中获取课后信息提取内容
  const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
  const tasks = await db.select({ stepResults: bgTasksTable.stepResults })
    .from(bgTasksTable)
    .where(eq(bgTasksTable.id, taskId))
    .limit(1);

  if (tasks.length === 0) throw new Error("任务不存在");

  let stepResults: any = null;
  try {
    stepResults = tasks[0].stepResults ? JSON.parse(tasks[0].stepResults) : null;
  } catch {
    throw new Error("任务数据损坏");
  }

  const content = stepResults?.extraction?.content;
  if (!content) throw new Error("课后信息提取内容不可用（可能任务未完成或该步骤失败）");

  return importFromExtraction(studentName, content);
}

/**
 * 小班课一键导入：N+1 模式
 * 为班级整体 + 每个出勤学生各创建一条导入记录
 */
export async function importClassFromTaskExtraction(
  taskId: string,
  classNumber: string,
  attendanceStudents: string[],
): Promise<{
  total: number;
  className: string;
  results: Array<{ name: string; id: number; studentCreated: boolean }>;
}> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 从后台任务中获取课后信息提取内容
  const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
  const tasks = await db.select({ stepResults: bgTasksTable.stepResults })
    .from(bgTasksTable)
    .where(eq(bgTasksTable.id, taskId))
    .limit(1);

  if (tasks.length === 0) throw new Error("任务不存在");

  let stepResults: any = null;
  try {
    stepResults = tasks[0].stepResults ? JSON.parse(tasks[0].stepResults) : null;
  } catch {
    throw new Error("任务数据损坏");
  }

  const content = stepResults?.extraction?.content;
  if (!content) throw new Error("课后信息提取内容不可用（可能任务未完成或该步骤失败）");

  const className = `${classNumber.trim()}班`;
  const results: Array<{ name: string; id: number; studentCreated: boolean }> = [];

  // 1. 导入班级整体记录
  const classResult = await importFromExtraction(className, content);
  results.push({ name: className, ...classResult });
  console.log(`[学生管理] 小班课导入: 班级 ${className}, 条目ID: ${classResult.id}`);

  // 2. 逐个导入出勤学生（去重 + 容错：单个失败不影响其他）
  const validStudents = [...new Set(attendanceStudents.map(s => s.trim()).filter(Boolean))];
  let failCount = 0;
  for (const trimmed of validStudents) {
    try {
      const studentResult = await importFromExtraction(trimmed, content);
      results.push({ name: trimmed, ...studentResult });
      console.log(`[学生管理] 小班课导入: 学生 ${trimmed}, 条目ID: ${studentResult.id}`);
    } catch (err: any) {
      failCount++;
      console.error(`[学生管理] 小班课导入失败: 学生 ${trimmed}:`, err?.message);
    }
  }

  if (failCount > 0) {
    console.warn(`[学生管理] 小班课导入部分失败: ${failCount}/${validStudents.length} 个学生`);
  }
  console.log(`[学生管理] 小班课一键导入完成: ${className}, 共${results.length}条 (1班级 + ${results.length - 1}学生)`);
  return { total: results.length, className, results };
}

// ============= 数据备份与恢复 =============

const BACKUP_SEPARATOR = "═══════════════════════════════════════";
const STUDENT_HEADER_RE = /^## ═+ 学生[:：]\s*(.+?)\s*═+$/;
const FIELD_PLAN_TYPE = "### 计划类型";
const FIELD_STATUS = "### 状态记录";

/**
 * 导出所有活跃学生数据为 Markdown 格式
 * 每个学生只存三项：姓名、计划类型、完整状态记录
 */
export async function exportStudentBackup(): Promise<{ content: string; studentCount: number; timestamp: string }> {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const students = await db.select().from(hwStudents)
    .where(eq(hwStudents.status, "active"))
    .orderBy(hwStudents.name);

  const now = new Date();
  const timestamp = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
    .replace(/\//g, "-");
  const fileTimestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);

  const lines: string[] = [];
  lines.push("# 学生管理数据备份");
  lines.push(`> 导出时间: ${timestamp}`);
  lines.push(`> 学生总数: ${students.length}`);
  lines.push("");

  for (const student of students) {
    lines.push(`## ${BACKUP_SEPARATOR} 学生: ${student.name} ${BACKUP_SEPARATOR}`);
    lines.push("");
    lines.push(FIELD_PLAN_TYPE);
    lines.push(student.planType || "weekly");
    lines.push("");
    lines.push(FIELD_STATUS);
    lines.push(student.currentStatus || "(无状态记录)");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return {
    content: lines.join("\n"),
    studentCount: students.length,
    timestamp: fileTimestamp,
  };
}

interface ParsedStudent {
  name: string;
  planType: string;
  currentStatus: string;
}

/**
 * 解析备份 Markdown 文件内容
 */
export function parseBackupContent(content: string): ParsedStudent[] {
  const students: ParsedStudent[] = [];
  const lines = content.split("\n");

  let current: ParsedStudent | null = null;
  let currentField = "";
  let fieldLines: string[] = [];

  const flushField = () => {
    if (!current || !currentField) return;
    const value = fieldLines.join("\n").trim();
    if (currentField === FIELD_PLAN_TYPE) current.planType = value === "daily" ? "daily" : "weekly";
    else if (currentField === FIELD_STATUS) current.currentStatus = value === "(无状态记录)" ? "" : value;
    currentField = "";
    fieldLines = [];
  };

  for (const line of lines) {
    const headerMatch = line.match(STUDENT_HEADER_RE);
    if (headerMatch) {
      if (current) {
        flushField();
        students.push(current);
      }
      current = { name: headerMatch[1].trim(), planType: "weekly", currentStatus: "" };
      currentField = "";
      fieldLines = [];
      continue;
    }

    if (!current) continue;

    if (line === "---") {
      flushField();
      students.push(current);
      current = null;
      continue;
    }

    if (line === FIELD_PLAN_TYPE || line === FIELD_STATUS) {
      flushField();
      currentField = line;
      fieldLines = [];
      continue;
    }

    if (currentField) {
      fieldLines.push(line);
    }
  }

  if (current) {
    flushField();
    students.push(current);
  }

  return students;
}

/**
 * 预览备份文件（返回首/中/尾学生信息用于确认）
 */
export function previewBackup(content: string): {
  total: number;
  samples: Array<{ name: string; planType: string; statusPreview: string }>;
  allNames: string[];
} {
  const students = parseBackupContent(content);
  if (students.length === 0) return { total: 0, samples: [], allNames: [] };

  const toSample = (s: ParsedStudent) => ({
    name: s.name,
    planType: s.planType,
    statusPreview: s.currentStatus ? s.currentStatus.slice(0, 200) + (s.currentStatus.length > 200 ? "..." : "") : "(无)",
  });

  const samples = [];
  samples.push(toSample(students[0]));
  if (students.length > 2) {
    samples.push(toSample(students[Math.floor(students.length / 2)]));
  }
  if (students.length > 1) {
    samples.push(toSample(students[students.length - 1]));
  }

  return {
    total: students.length,
    samples,
    allNames: students.map(s => s.name),
  };
}

/**
 * 从备份内容导入（覆盖/创建学生记录）
 */
export async function importStudentBackup(content: string): Promise<{
  imported: number;
  created: number;
  updated: number;
}> {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const students = parseBackupContent(content);
  if (students.length === 0) throw new Error("备份文件中未找到学生数据");

  let created = 0;
  let updated = 0;

  for (const s of students) {
    const existing = await db.select().from(hwStudents)
      .where(eq(hwStudents.name, s.name))
      .limit(1);

    if (existing.length > 0) {
      // 更新已有学生（只覆盖计划类型和状态记录）
      await db.update(hwStudents).set({
        planType: s.planType,
        currentStatus: s.currentStatus || null,
        status: "active",
      }).where(eq(hwStudents.id, existing[0].id));
      updated++;
    } else {
      // 创建新学生
      await db.insert(hwStudents).values({
        name: s.name,
        planType: s.planType,
        currentStatus: s.currentStatus || null,
      });
      created++;
    }
  }

  console.log(`[学生管理] 备份导入完成: 共${students.length}个学生 (新建${created}, 更新${updated})`);
  return { imported: students.length, created, updated };
}

/**
 * 自动备份到 Google Drive（fire-and-forget）
 */
export async function autoBackupToGDrive(): Promise<void> {
  try {
    const { content, studentCount, timestamp } = await exportStudentBackup();
    if (studentCount === 0) return;

    const { getConfigValue: getConfig } = await import("./core/aiClient");
    const { DEFAULT_CONFIG } = await import("./core/aiClient");
    const { uploadToGoogleDrive } = await import("./gdrive");

    const driveBasePath = await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
    const folderPath = `${driveBasePath}/学生管理信息备份`;
    const fileName = `学生管理备份_${timestamp}.md`;

    const result = await uploadToGoogleDrive(content, fileName, folderPath);
    if (result.status === "success") {
      console.log(`[学生管理] 自动备份成功: ${fileName} (${studentCount}个学生)`);
    } else {
      console.warn(`[学生管理] 自动备份上传失败: ${result.error || result.message}`);
    }
  } catch (err: any) {
    console.error(`[学生管理] 自动备份异常:`, err?.message);
  }
}
