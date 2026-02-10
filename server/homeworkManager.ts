/**
 * 作业管理系统 - 后端逻辑
 * 包含：表自动创建、学生管理、AI处理、预入库队列
 */

import { getDb } from "./db";
import { hwStudents, hwEntries } from "../drizzle/schema";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { invokeWhatAI } from "./whatai";
import { getConfigValue } from "./core/aiClient";

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
    tableEnsured = true;
    console.log("[作业管理] 表已就绪");
  } catch (err: any) {
    console.error("[作业管理] 建表失败:", err?.message || err);
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
  if (data.planType !== undefined) updateObj.plan_type = data.planType;
  if (data.nextClassDate !== undefined) updateObj.next_class_date = data.nextClassDate;
  if (data.examTarget !== undefined) updateObj.exam_target = data.examTarget;
  if (data.examDate !== undefined) updateObj.exam_date = data.examDate;
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

const HW_SYSTEM_PROMPT = `你是一个教学助手的作业管理助手。你的任务是将教师的语音转文字记录整理为结构化的作业管理数据。

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

export async function processEntry(
  studentName: string,
  rawInput: string,
  aiModel?: string,
  supplementaryNotes?: string
): Promise<{ parsedContent: string }> {
  // Build API config
  const apiKey = await getConfigValue("apiKey");
  const apiUrl = await getConfigValue("apiUrl");
  const modelToUse = aiModel || await getConfigValue("apiModel") || "claude-sonnet-4-5-20250929";

  let userPrompt = `当前学生姓名：${studentName}\n`;
  userPrompt += `\n⚠️ 重要：以下内容为语音转文字，学生姓名可能识别不准确，请以上方「${studentName}」为准。对于内容中看起来像学生姓名但与「${studentName}」对不上的文字，都应当理解为指代该学生。\n`;

  if (supplementaryNotes && supplementaryNotes.trim()) {
    userPrompt += `\n【补充说明】\n${supplementaryNotes.trim()}\n`;
  }

  userPrompt += `\n【语音转文字原文】\n${rawInput}\n`;
  userPrompt += `\n请按照系统提示中的格式要求，整理为结构化数据。`;

  const messages = [
    { role: "system" as const, content: HW_SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt },
  ];

  const response = await invokeWhatAI(messages, {
    max_tokens: 4000,
    temperature: 0.3,
    timeout: 120000,
    retries: 1,
  }, {
    apiModel: modelToUse,
    apiKey,
    apiUrl,
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI 返回空内容");
  }

  return { parsedContent: content.trim() };
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
  return { id: insertId };
}

export async function submitAndProcessEntry(
  studentName: string,
  rawInput: string,
  aiModel?: string,
  supplementaryNotes?: string
): Promise<{ id: number; status: string; parsedContent?: string; error?: string }> {
  // Create entry first
  const { id } = await createEntry(studentName, rawInput, aiModel);

  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // Update status to processing
  await db.update(hwEntries)
    .set({ entryStatus: "processing" })
    .where(eq(hwEntries.id, id));

  try {
    // Process with AI
    const { parsedContent } = await processEntry(studentName, rawInput, aiModel, supplementaryNotes);

    // Validate: check for empty fields
    const hasEmptyFields = parsedContent.includes("【】") || /【[^】]+】\s*\n\s*\n/.test(parsedContent);
    if (hasEmptyFields) {
      console.warn(`[作业管理] 条目 ${id} 解析结果有空字段`);
    }

    // Update entry with parsed content
    await db.update(hwEntries)
      .set({
        parsedContent,
        entryStatus: "pre_staged",
        errorMessage: null,
      })
      .where(eq(hwEntries.id, id));

    return { id, status: "pre_staged", parsedContent };
  } catch (err: any) {
    const errorMsg = err?.message || "AI处理失败";
    console.error(`[作业管理] 条目 ${id} 处理失败:`, errorMsg);

    await db.update(hwEntries)
      .set({
        entryStatus: "failed",
        errorMessage: errorMsg,
      })
      .where(eq(hwEntries.id, id));

    return { id, status: "failed", error: errorMsg };
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

export async function retryEntry(id: number, supplementaryNotes?: string) {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const rows = await db.select().from(hwEntries).where(eq(hwEntries.id, id)).limit(1);
  if (rows.length === 0) throw new Error("条目不存在");
  const entry = rows[0];

  // Reset to processing
  await db.update(hwEntries)
    .set({ entryStatus: "processing", errorMessage: null })
    .where(eq(hwEntries.id, id));

  try {
    const { parsedContent } = await processEntry(
      entry.studentName,
      entry.rawInput,
      entry.aiModel || undefined,
      supplementaryNotes
    );

    await db.update(hwEntries)
      .set({
        parsedContent,
        entryStatus: "pre_staged",
        errorMessage: null,
      })
      .where(eq(hwEntries.id, id));

    return { id, status: "pre_staged", parsedContent };
  } catch (err: any) {
    const errorMsg = err?.message || "AI处理失败";
    await db.update(hwEntries)
      .set({ entryStatus: "failed", errorMessage: errorMsg })
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
  await db.update(hwEntries)
    .set({ entryStatus: "confirmed" })
    .where(
      and(
        inArray(hwEntries.id, ids),
        eq(hwEntries.entryStatus, "pre_staged")
      )
    );
  return { count: ids.length };
}

export async function confirmAllPreStaged() {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const result = await db.update(hwEntries)
    .set({ entryStatus: "confirmed" })
    .where(eq(hwEntries.entryStatus, "pre_staged"));
  return { success: true };
}

// ============= 从课后信息提取一键导入 =============

export async function importFromExtraction(
  studentName: string,
  extractionContent: string,
): Promise<{ id: number; studentCreated: boolean }> {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 自动创建学生（如不存在）
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
    console.log(`[作业管理] 自动创建学生: ${studentName}`);
  }

  // 直接创建 pre_staged 条目（课后信息提取已是结构化内容，无需再过AI）
  const result = await db.insert(hwEntries).values({
    studentName: studentName.trim(),
    rawInput: `[从课后信息提取导入] ${studentName}`,
    parsedContent: extractionContent.trim(),
    aiModel: null,
    entryStatus: "pre_staged",
  });
  const insertId = (result as any)[0]?.insertId;
  console.log(`[作业管理] 从课后信息提取导入: ${studentName}, 条目ID: ${insertId}`);

  return { id: insertId, studentCreated };
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
