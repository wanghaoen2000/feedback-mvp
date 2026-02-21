/**
 * 作业提醒系统 - 一键催作业
 * 模式：提交 → 汇总学生数据（排除数字开头的小班课学生） → AI生成催作业话术 → 按学生拆分展示
 * 留存30天，自动清理过期记录
 *
 * AI 响应格式约定（前端解析依赖此格式）：
 *   ---STUDENT[学生姓名]---
 *   催作业话术内容（纯文本）
 *   ---END---
 *
 * 前端通过正则 /---STUDENT\[(.+?)\]---\n([\s\S]*?)---END---/g 拆分结果。
 * 用户编写提示词时，需在末尾或关键位置告知 AI 严格按此格式输出。
 */

import { getDb } from "./db";
import { reminderTasks, hwStudents } from "../drizzle/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { invokeWhatAIStream } from "./whatai";
import { getConfigValue } from "./core/aiClient";
import { ensureHwTables } from "./homeworkManager";
import { getBeijingTimeContext } from "./utils";

// ============= 表自动创建 =============

let tableEnsured = false;

export async function ensureReminderTable(): Promise<void> {
  if (tableEnsured) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS \`reminder_tasks\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`user_id\` int NOT NULL,
      \`reminder_prompt\` mediumtext NOT NULL,
      \`student_count\` int DEFAULT 0,
      \`student_data\` mediumtext,
      \`system_prompt\` mediumtext,
      \`result\` mediumtext,
      \`ai_model\` varchar(128),
      \`task_status\` varchar(20) NOT NULL DEFAULT 'pending',
      \`error_message\` text,
      \`streaming_chars\` int DEFAULT 0,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`completed_at\` timestamp NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_reminder_userId\` (\`user_id\`)
    )`);

    tableEnsured = true;
    console.log("[作业提醒] 表已就绪");

    // 启动时清理超过30天的旧任务
    cleanupOldReminderTasks();
  } catch (err: any) {
    console.error("[作业提醒] 建表失败:", err?.message);
  }
}

// 清理超过30天的旧记录
async function cleanupOldReminderTasks(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await db.delete(reminderTasks)
      .where(sql`${reminderTasks.createdAt} < ${cutoff}`);
    const deleted = (result as any)[0]?.affectedRows || 0;
    if (deleted > 0) {
      console.log(`[作业提醒] 已清理 ${deleted} 条超过30天的旧记录`);
    }
  } catch (err: any) {
    console.error("[作业提醒] 清理旧记录失败:", err?.message);
  }
}

// ============= 格式说明（写在系统提示词末尾） =============

/**
 * 告知 AI 必须按此格式返回，前端硬代码依赖此格式拆分。
 * 用户的自定义提示词在前面，这个格式约束追加在最后面。
 */
const FORMAT_INSTRUCTION = `

【输出格式要求 —— 极其重要，必须严格遵守】
你的回复必须严格按照以下格式，每个需要提醒的学生单独一个区块：

---STUDENT[学生真实姓名]---
（这里写给该学生的催作业/提醒话术，纯文本，可以多行）
---END---

规则：
1. "学生真实姓名"必须与提供数据中的姓名完全一致，一个字都不能改
2. 每个学生一个区块，区块之间可以有空行
3. 不要在 ---STUDENT 和 ---END 标记之外写任何内容（不要写开头问候、结尾总结等）
4. 如果某学生不需要提醒（例如作业都已完成），直接跳过，不要输出该学生的区块`;

// ============= 汇总学生数据（排除数字开头的小班课学生） =============

async function collectStudentData(userId: number): Promise<{
  content: string;
  studentCount: number;
  studentNames: string[];
}> {
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const students = await db.select().from(hwStudents)
    .where(and(eq(hwStudents.userId, userId), eq(hwStudents.status, "active")))
    .orderBy(hwStudents.name);

  // 排除姓名以阿拉伯数字开头的学生（小班课学生）
  const filtered = students.filter(s => !/^\d/.test(s.name));

  if (filtered.length === 0) {
    throw new Error("没有找到任何需要提醒的学生（已排除小班课学生）");
  }

  const lines: string[] = [];
  const names: string[] = [];

  for (const student of filtered) {
    names.push(student.name);
    lines.push(`## ===== 学生: ${student.name} =====`);
    lines.push("");
    lines.push("计划类型");
    lines.push(student.planType || "weekly");
    lines.push("");
    lines.push("状态文档");
    lines.push(student.currentStatus || "(无状态记录)");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return {
    content: lines.join("\n"),
    studentCount: filtered.length,
    studentNames: names,
  };
}

// ============= 预览发送给AI的内容 =============

export async function previewReminderPrompt(userId: number, reminderPrompt: string): Promise<{
  systemPrompt: string;
  studentData: string;
  studentCount: number;
}> {
  const { content, studentCount } = await collectStudentData(userId);
  const timeContext = getBeijingTimeContext();
  const systemPrompt = buildReminderSystemPrompt(timeContext, reminderPrompt);
  return { systemPrompt, studentData: content, studentCount };
}

function buildReminderSystemPrompt(timeContext: string, userPrompt: string): string {
  const parts: string[] = [
    timeContext,
    "",
    "<用户指令>",
    userPrompt.trim(),
    "</用户指令>",
    FORMAT_INSTRUCTION,
  ];
  return parts.join("\n");
}

// ============= 任务提交 =============

export interface SubmitReminderParams {
  reminderPrompt: string;
  aiModel?: string; // 前端选择的模型（可选，优先级最高）
}

export async function submitReminder(userId: number, params: SubmitReminderParams): Promise<{ id: number }> {
  await ensureReminderTable();
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const result = await db.insert(reminderTasks).values({
    userId,
    reminderPrompt: params.reminderPrompt,
    taskStatus: "pending",
  });

  const taskId = Number((result as any)[0]?.insertId || (result as any).insertId);
  console.log(`[作业提醒] 任务已创建: ID=${taskId}`);

  // 后台处理（fire-and-forget）
  processReminderInBackground(userId, taskId);

  return { id: taskId };
}

// ============= 后台处理 =============

async function processReminderInBackground(userId: number, taskId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 更新状态为 processing
    await db.update(reminderTasks)
      .set({ taskStatus: "processing", streamingChars: 0 })
      .where(eq(reminderTasks.id, taskId));

    // 读取任务数据
    const tasks = await db.select().from(reminderTasks)
      .where(eq(reminderTasks.id, taskId))
      .limit(1);
    if (tasks.length === 0) throw new Error("任务不存在");
    const task = tasks[0];

    // 收集学生数据（排除小班课）
    const { content: studentData, studentCount } = await collectStudentData(userId);
    if (studentCount === 0) {
      throw new Error("没有找到任何需要提醒的学生");
    }

    // 构建系统提示词
    const timeContext = getBeijingTimeContext();
    const systemPrompt = buildReminderSystemPrompt(timeContext, task.reminderPrompt);

    // 保存系统提示词、学生数据和学生数
    await db.update(reminderTasks)
      .set({ systemPrompt, studentData, studentCount })
      .where(eq(reminderTasks.id, taskId));

    // 用户消息 = 所有学生数据
    const userMessage = studentData;

    // 获取API配置
    const apiKey = await getConfigValue("apiKey", userId);
    const apiUrl = await getConfigValue("apiUrl", userId);
    const maxTokensStr = await getConfigValue("maxTokens", userId);
    const maxTokens = parseInt(maxTokensStr || "64000", 10);
    const modelToUse = await getConfigValue("reminderAiModel", userId)
      || await getConfigValue("apiModel", userId)
      || "claude-sonnet-4-5-20250929";

    // 处理开始时就写入模型，让前端立刻显示
    await db.update(reminderTasks)
      .set({ aiModel: modelToUse })
      .where(eq(reminderTasks.id, taskId));

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userMessage },
    ];

    console.log(`[作业提醒] 开始AI处理: 任务${taskId}, ${studentCount}个学生, 模型 ${modelToUse}`);

    // 用于追踪总字符数
    let totalChars = 0;
    let lastProgressTime = 0;
    const onChunk = (chunk: string) => {
      totalChars += chunk.length;
      const now = Date.now();
      if (now - lastProgressTime >= 1000) {
        db.update(reminderTasks)
          .set({ streamingChars: totalChars })
          .where(eq(reminderTasks.id, taskId))
          .catch(() => {});
        lastProgressTime = now;
      }
    };

    const content = await invokeWhatAIStream(messages, {
      temperature: 0.3,
      retries: 1,
    }, {
      apiModel: modelToUse,
      apiKey,
      maxTokens,
      apiUrl,
    }, onChunk);

    if (!content || !content.trim()) {
      throw new Error("AI 返回空内容");
    }

    // 保存结果
    await db.update(reminderTasks)
      .set({
        result: content,
        aiModel: modelToUse,
        taskStatus: "completed",
        streamingChars: content.length,
        completedAt: new Date(),
      })
      .where(eq(reminderTasks.id, taskId));

    console.log(`[作业提醒] 任务${taskId}完成, ${content.length}字, ${studentCount}个学生`);

  } catch (err: any) {
    console.error(`[作业提醒] 任务${taskId}失败:`, err?.message);
    try {
      await db.update(reminderTasks)
        .set({
          taskStatus: "failed",
          errorMessage: err?.message || "未知错误",
        })
        .where(eq(reminderTasks.id, taskId));
    } catch {}
  }
}

// ============= 查询任务 =============

export async function getReminderTask(userId: number, taskId: number) {
  await ensureReminderTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const tasks = await db.select().from(reminderTasks)
    .where(and(eq(reminderTasks.id, taskId), eq(reminderTasks.userId, userId)))
    .limit(1);

  if (tasks.length === 0) throw new Error("任务不存在");
  return tasks[0];
}

export async function listReminderTasks(userId: number) {
  await ensureReminderTable();
  const db = await getDb();
  if (!db) return [];

  return db.select().from(reminderTasks)
    .where(eq(reminderTasks.userId, userId))
    .orderBy(desc(reminderTasks.createdAt))
    .limit(20); // 只保留最近20条
}

// ============= 解析AI响应 =============

export interface ParsedStudentReminder {
  studentName: string;
  content: string;
}

/**
 * 解析AI返回的催作业结果，按学生拆分
 * 格式：---STUDENT[学生姓名]--- ... ---END---
 */
export function parseReminderResult(rawResult: string): ParsedStudentReminder[] {
  const results: ParsedStudentReminder[] = [];
  const regex = /---STUDENT\[(.+?)\]---\n([\s\S]*?)---END---/g;
  let match;
  while ((match = regex.exec(rawResult)) !== null) {
    results.push({
      studentName: match[1].trim(),
      content: match[2].trim(),
    });
  }
  return results;
}
