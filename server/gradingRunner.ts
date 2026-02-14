/**
 * 一键打分系统 - 后台任务模式
 * 模式：提交 → 入库 → 后台AI处理 → 轮询查看结果
 * 留存180天，自动清理过期记录
 */

import { getDb } from "./db";
import { gradingTasks } from "../drizzle/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { invokeWhatAIStream } from "./whatai";
import { getConfigValue } from "./core/aiClient";
import { exportStudentBackup, ensureHwTables } from "./homeworkManager";

// ============= 表自动创建 =============

let tableEnsured = false;

export async function ensureGradingTable(): Promise<void> {
  if (tableEnsured) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS \`grading_tasks\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`user_id\` int NOT NULL,
      \`start_date\` varchar(10) NOT NULL,
      \`end_date\` varchar(10) NOT NULL,
      \`grading_prompt\` mediumtext NOT NULL,
      \`user_notes\` text,
      \`student_count\` int DEFAULT 0,
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
      INDEX \`idx_grading_userId\` (\`user_id\`)
    )`);
    tableEnsured = true;
    console.log("[一键打分] 表已就绪");

    // 启动时清理超过180天的旧任务
    cleanupOldGradingTasks();
  } catch (err: any) {
    console.error("[一键打分] 建表失败:", err?.message);
  }
}

// 清理超过180天的旧打分记录
async function cleanupOldGradingTasks(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const result = await db.delete(gradingTasks)
      .where(sql`${gradingTasks.createdAt} < ${cutoff}`);
    const deleted = (result as any)[0]?.affectedRows || 0;
    if (deleted > 0) {
      console.log(`[一键打分] 已清理 ${deleted} 条超过180天的旧记录`);
    }
  } catch (err: any) {
    console.error("[一键打分] 清理旧记录失败:", err?.message);
  }
}

// ============= 星期计算 =============

function getDayOfWeek(dateStr: string): string {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return days[date.getDay()];
}

// ============= 任务提交 =============

export interface SubmitGradingParams {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  gradingPrompt: string;
  userNotes?: string;
}

export async function submitGrading(userId: number, params: SubmitGradingParams): Promise<{ id: number }> {
  await ensureGradingTable();
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const result = await db.insert(gradingTasks).values({
    userId,
    startDate: params.startDate,
    endDate: params.endDate,
    gradingPrompt: params.gradingPrompt,
    userNotes: params.userNotes || null,
    taskStatus: "pending",
  });

  const taskId = Number((result as any)[0]?.insertId || (result as any).insertId);
  console.log(`[一键打分] 任务已创建: ID=${taskId}, 日期范围 ${params.startDate}~${params.endDate}`);

  // 后台处理（fire-and-forget）
  processGradingInBackground(userId, taskId);

  return { id: taskId };
}

// ============= 后台处理 =============

async function processGradingInBackground(userId: number, taskId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 更新状态为 processing
    await db.update(gradingTasks)
      .set({ taskStatus: "processing", streamingChars: 0 })
      .where(eq(gradingTasks.id, taskId));

    // 读取任务数据
    const tasks = await db.select().from(gradingTasks)
      .where(eq(gradingTasks.id, taskId))
      .limit(1);
    if (tasks.length === 0) throw new Error("任务不存在");
    const task = tasks[0];

    // 获取所有学生数据
    const backup = await exportStudentBackup(userId);
    if (backup.studentCount === 0) {
      throw new Error("没有找到任何活跃学生数据");
    }

    // 计算星期
    const startDow = getDayOfWeek(task.startDate);
    const endDow = getDayOfWeek(task.endDate);

    // 构建系统提示词
    const systemParts: string[] = [
      `评分时间段：${task.startDate}（${startDow}）至 ${task.endDate}（${endDow}）`,
      '',
      '<打分要求>',
      task.gradingPrompt.trim(),
      '</打分要求>',
    ];
    if (task.userNotes && task.userNotes.trim()) {
      systemParts.push('', '<额外说明>', task.userNotes.trim(), '</额外说明>');
    }
    const systemPrompt = systemParts.join('\n');

    // 保存系统提示词和学生数
    await db.update(gradingTasks)
      .set({ systemPrompt, studentCount: backup.studentCount })
      .where(eq(gradingTasks.id, taskId));

    // 用户消息 = 所有学生数据
    const userMessage = backup.content;

    // 获取API配置
    const apiKey = await getConfigValue("apiKey", userId);
    const apiUrl = await getConfigValue("apiUrl", userId);
    const modelToUse = await getConfigValue("hwAiModel", userId)
      || await getConfigValue("apiModel", userId)
      || "claude-sonnet-4-5-20250929";

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userMessage },
    ];

    console.log(`[一键打分] 开始AI打分: 任务${taskId}, ${backup.studentCount}个学生, 模型 ${modelToUse}`);

    // 流式进度上报
    let lastProgressTime = 0;
    const chunkCallback = (chunk: string) => {
      // 累计字符数由 invokeWhatAIStream 内部处理
    };

    // 用于追踪总字符数
    let totalChars = 0;
    const onChunk = (chunk: string) => {
      totalChars += chunk.length;
      const now = Date.now();
      if (now - lastProgressTime >= 1000) {
        db.update(gradingTasks)
          .set({ streamingChars: totalChars })
          .where(eq(gradingTasks.id, taskId))
          .catch(() => {});
        lastProgressTime = now;
      }
    };

    const content = await invokeWhatAIStream(messages, {
      max_tokens: 16000,
      temperature: 0.3,
      retries: 1,
    }, {
      apiModel: modelToUse,
      apiKey,
      apiUrl,
    }, onChunk);

    if (!content || !content.trim()) {
      throw new Error("AI 返回空内容");
    }

    // 保存结果
    await db.update(gradingTasks)
      .set({
        result: content,
        aiModel: modelToUse,
        taskStatus: "completed",
        streamingChars: content.length,
        completedAt: new Date(),
      })
      .where(eq(gradingTasks.id, taskId));

    console.log(`[一键打分] 任务${taskId}完成, ${content.length}字, ${backup.studentCount}个学生`);

    // 自动上传到 Google Drive
    try {
      await uploadGradingToGDrive(userId, task.startDate, task.endDate, content);
    } catch (uploadErr: any) {
      console.warn(`[一键打分] 上传Google Drive失败:`, uploadErr?.message);
    }
  } catch (err: any) {
    console.error(`[一键打分] 任务${taskId}失败:`, err?.message);
    try {
      await db.update(gradingTasks)
        .set({
          taskStatus: "failed",
          errorMessage: err?.message || "未知错误",
        })
        .where(eq(gradingTasks.id, taskId));
    } catch {}
  }
}

// ============= 查询接口 =============

export async function getGradingTask(userId: number, taskId: number) {
  await ensureGradingTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const tasks = await db.select({
    id: gradingTasks.id,
    startDate: gradingTasks.startDate,
    endDate: gradingTasks.endDate,
    studentCount: gradingTasks.studentCount,
    result: gradingTasks.result,
    aiModel: gradingTasks.aiModel,
    taskStatus: gradingTasks.taskStatus,
    errorMessage: gradingTasks.errorMessage,
    streamingChars: gradingTasks.streamingChars,
    createdAt: gradingTasks.createdAt,
    completedAt: gradingTasks.completedAt,
  }).from(gradingTasks)
    .where(and(eq(gradingTasks.id, taskId), eq(gradingTasks.userId, userId)))
    .limit(1);

  return tasks[0] || null;
}

export async function listGradingTasks(userId: number, limit: number = 20) {
  await ensureGradingTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  return db.select({
    id: gradingTasks.id,
    startDate: gradingTasks.startDate,
    endDate: gradingTasks.endDate,
    studentCount: gradingTasks.studentCount,
    aiModel: gradingTasks.aiModel,
    taskStatus: gradingTasks.taskStatus,
    streamingChars: gradingTasks.streamingChars,
    errorMessage: gradingTasks.errorMessage,
    createdAt: gradingTasks.createdAt,
    completedAt: gradingTasks.completedAt,
  }).from(gradingTasks)
    .where(eq(gradingTasks.userId, userId))
    .orderBy(desc(gradingTasks.createdAt))
    .limit(limit);
}

// ============= 自动上传到 Google Drive =============

/**
 * 每次打分完成后，自动将结果上传到 Google Drive
 * 文件名：YYYYMMDD-YYYYMMDD_作业打分.md
 * 文件夹：可配置（gradingStoragePath），默认 {driveBasePath}/周打分记录
 */
async function uploadGradingToGDrive(userId: number, startDate: string, endDate: string, result: string): Promise<void> {
  const { getConfigValue: getConfig, DEFAULT_CONFIG } = await import("./core/aiClient");
  const { uploadToGoogleDrive } = await import("./gdrive");

  const gradingPath = await getConfig("gradingStoragePath", userId);
  const driveBasePath = await getConfig("driveBasePath", userId) || DEFAULT_CONFIG.driveBasePath;
  const folderPath = gradingPath || `${driveBasePath}/周打分记录`;

  // 文件名：20260202-20260209_作业打分.md
  const startCompact = startDate.replace(/-/g, '');
  const endCompact = endDate.replace(/-/g, '');
  const fileName = `${startCompact}-${endCompact}_作业打分.md`;

  const uploadResult = await uploadToGoogleDrive(result, fileName, folderPath);
  if (uploadResult.status === "success") {
    console.log(`[一键打分] 已上传到Google Drive: ${folderPath}/${fileName}`);
  } else {
    console.warn(`[一键打分] 上传失败: ${uploadResult.error || uploadResult.message}`);
  }
}
