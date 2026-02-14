/**
 * 一键打分系统 - 后台任务模式
 * 模式：提交 → 入库 → 后台AI处理 → 轮询查看结果
 * 留存180天，自动清理过期记录
 */

import { getDb } from "./db";
import { gradingTasks, hwStudents } from "../drizzle/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { invokeWhatAIStream } from "./whatai";
import { getConfigValue } from "./core/aiClient";
import { exportStudentBackup, ensureHwTables, getStudentLatestStatus } from "./homeworkManager";
import { ConcurrencyPool } from "./core/concurrencyPool";

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

    // 安全添加新列（已有表可能没有）
    const safeAddColumn = async (col: string, def: string) => {
      try {
        await db.execute(sql.raw(`ALTER TABLE \`grading_tasks\` ADD COLUMN \`${col}\` ${def}`));
      } catch (e: any) {
        if (!e?.message?.includes("Duplicate column")) {
          console.warn(`[一键打分] ALTER TABLE 警告:`, e?.message);
        }
      }
    };
    await safeAddColumn("edited_result", "MEDIUMTEXT");
    await safeAddColumn("sync_status", "VARCHAR(20)");
    await safeAddColumn("sync_total", "INT DEFAULT 0");
    await safeAddColumn("sync_completed", "INT DEFAULT 0");
    await safeAddColumn("sync_failed", "INT DEFAULT 0");
    await safeAddColumn("sync_error", "TEXT");

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
    editedResult: gradingTasks.editedResult,
    aiModel: gradingTasks.aiModel,
    taskStatus: gradingTasks.taskStatus,
    errorMessage: gradingTasks.errorMessage,
    streamingChars: gradingTasks.streamingChars,
    syncStatus: gradingTasks.syncStatus,
    syncTotal: gradingTasks.syncTotal,
    syncCompleted: gradingTasks.syncCompleted,
    syncFailed: gradingTasks.syncFailed,
    syncError: gradingTasks.syncError,
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
    syncStatus: gradingTasks.syncStatus,
    syncTotal: gradingTasks.syncTotal,
    syncCompleted: gradingTasks.syncCompleted,
    syncFailed: gradingTasks.syncFailed,
    createdAt: gradingTasks.createdAt,
    completedAt: gradingTasks.completedAt,
  }).from(gradingTasks)
    .where(eq(gradingTasks.userId, userId))
    .orderBy(desc(gradingTasks.createdAt))
    .limit(limit);
}

// ============= 保存编辑后的打分结果 =============

export async function updateGradingEditedResult(userId: number, taskId: number, editedResult: string): Promise<void> {
  await ensureGradingTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  await db.update(gradingTasks)
    .set({ editedResult })
    .where(and(eq(gradingTasks.id, taskId), eq(gradingTasks.userId, userId)));
}

// ============= 同步打分结果到所有学生状态 =============

/**
 * 判断学生名是否为班级（数字开头的是班级）
 */
function isClassName(name: string): boolean {
  return /^\d/.test(name.trim());
}

/**
 * 启动同步：将打分结果同步到所有学生状态的【作业完成评分记录】
 */
export async function syncGradingToStudents(userId: number, taskId: number): Promise<{ syncTotal: number }> {
  await ensureGradingTable();
  await ensureHwTables();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 读取任务数据
  const tasks = await db.select().from(gradingTasks)
    .where(and(eq(gradingTasks.id, taskId), eq(gradingTasks.userId, userId)))
    .limit(1);
  if (tasks.length === 0) throw new Error("任务不存在");
  const task = tasks[0];
  if (task.taskStatus !== "completed") throw new Error("打分任务尚未完成");

  // 使用编辑后的结果，如果没有编辑过则用原始结果
  const gradingResult = task.editedResult || task.result;
  if (!gradingResult) throw new Error("没有打分结果可同步");

  // 获取所有活跃学生，过滤掉班级（数字开头）
  const allStudents = await db.select({ id: hwStudents.id, name: hwStudents.name })
    .from(hwStudents)
    .where(and(eq(hwStudents.userId, userId), eq(hwStudents.status, "active")))
    .orderBy(hwStudents.name);

  const realStudents = allStudents.filter(s => !isClassName(s.name));
  if (realStudents.length === 0) throw new Error("没有找到需要同步的学生（已排除班级）");

  // 更新同步状态
  await db.update(gradingTasks)
    .set({
      syncStatus: "syncing",
      syncTotal: realStudents.length,
      syncCompleted: 0,
      syncFailed: 0,
      syncError: null,
    })
    .where(eq(gradingTasks.id, taskId));

  console.log(`[打分同步] 开始同步: 任务${taskId}, ${realStudents.length}个学生（已排除${allStudents.length - realStudents.length}个班级）`);

  // fire-and-forget 后台处理
  processGradingSyncInBackground(userId, taskId, realStudents, gradingResult, task.startDate, task.endDate);

  return { syncTotal: realStudents.length };
}

/**
 * 后台并行处理：为每个学生调用AI更新状态
 */
async function processGradingSyncInBackground(
  userId: number,
  taskId: number,
  students: Array<{ id: number; name: string }>,
  gradingResult: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // 获取API配置
  const apiKey = await getConfigValue("apiKey", userId);
  const apiUrl = await getConfigValue("apiUrl", userId);
  const modelToUse = await getConfigValue("hwAiModel", userId)
    || await getConfigValue("apiModel", userId)
    || "claude-sonnet-4-5-20250929";

  let completedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  // 构建系统提示词（所有学生共用）
  const syncSystemPrompt = `你是一个教学助手。你的任务是根据周打分结论，更新一位学生的状态文档。

具体要求：
1. 我会提供该学生的周打分结论和当前状态文档
2. 请在状态文档的【作业完成评分记录】部分，新增一条本周的记录
3. 新增记录的格式：${startDate}周一到${endDate}周日，作业完成比例XX%，完成质量分数XX分
4. 注意：起始日期固定写"周一"，结束日期固定写"周日"，不要自己推算星期几
5. 完成比例和分数请从周打分结论中该学生的部分提取
6. 如果该学生在打分结论中找不到对应记录，则跳过不新增，原样返回
7. 状态文档的其他所有部分必须原封不动保留，只修改【作业完成评分记录】部分
8. 输出更新后的完整状态文档，不要加任何额外说明`;

  // 使用并发池并行处理
  const pool = new ConcurrencyPool(20);
  pool.addTasks(students.map((_, i) => i));

  await pool.execute(
    async (taskIndex: number) => {
      const student = students[taskIndex];
      try {
        // 获取学生当前状态
        const currentStatus = await getStudentLatestStatus(userId, student.name);
        if (!currentStatus) {
          console.warn(`[打分同步] 学生 ${student.name} 没有状态文档，跳过`);
          completedCount++;
          await db.update(gradingTasks)
            .set({ syncCompleted: completedCount })
            .where(eq(gradingTasks.id, taskId));
          return;
        }

        // 构建用户消息
        const userMessage = `【学生姓名】${student.name}

【周打分结论】
${gradingResult}

【该学生当前状态文档】
${currentStatus}

请根据上述周打分结论中"${student.name}"的部分，更新该学生状态文档的【作业完成评分记录】部分，输出完整的更新后状态文档。`;

        const messages = [
          { role: "system" as const, content: syncSystemPrompt },
          { role: "user" as const, content: userMessage },
        ];

        const content = await invokeWhatAIStream(messages, {
          max_tokens: 8000,
          temperature: 0.2,
          retries: 1,
        }, {
          apiModel: modelToUse,
          apiKey,
          apiUrl,
        });

        if (!content || !content.trim()) {
          throw new Error("AI 返回空内容");
        }

        // 更新学生状态到数据库
        await db.update(hwStudents)
          .set({ currentStatus: content.trim() })
          .where(and(eq(hwStudents.id, student.id), eq(hwStudents.userId, userId)));

        completedCount++;
        console.log(`[打分同步] ${student.name} 同步成功 (${completedCount}/${students.length})`);
      } catch (err: any) {
        failedCount++;
        const errMsg = `${student.name}: ${err?.message || "未知错误"}`;
        errors.push(errMsg);
        console.error(`[打分同步] ${student.name} 同步失败:`, err?.message);
      }

      // 更新进度
      await db.update(gradingTasks)
        .set({ syncCompleted: completedCount, syncFailed: failedCount })
        .where(eq(gradingTasks.id, taskId))
        .catch(() => {});
    },
  );

  // 最终状态更新
  const finalStatus = failedCount === 0 ? "completed" : (completedCount === 0 ? "failed" : "completed");
  await db.update(gradingTasks)
    .set({
      syncStatus: finalStatus,
      syncCompleted: completedCount,
      syncFailed: failedCount,
      syncError: errors.length > 0 ? errors.join("\n") : null,
    })
    .where(eq(gradingTasks.id, taskId));

  console.log(`[打分同步] 任务${taskId}同步完成: 成功${completedCount}, 失败${failedCount}, 共${students.length}个学生`);

  // 自动备份到 Google Drive
  try {
    const { autoBackupToGDrive } = await import("./homeworkManager");
    await autoBackupToGDrive(userId);
  } catch (backupErr: any) {
    console.warn(`[打分同步] 自动备份失败:`, backupErr?.message);
  }
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
