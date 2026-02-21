/**
 * 备课系统 - 后端逻辑
 * 包含：表自动创建、任务提交、AI备课生成、任务管理（列表/详情/重试/删除）
 */

import { getDb } from "./db";
import { lessonPrepTasks } from "../drizzle/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { invokeAIStream, getConfigValue, getAPIConfig } from "./core/aiClient";
import { getStudentLatestStatus } from "./homeworkManager";
import { getBeijingTimeContext } from "./utils";

// ============= 表自动创建 =============

let tableEnsured = false;

export async function ensureLessonPrepTable(): Promise<void> {
  if (tableEnsured) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS \`lesson_prep_tasks\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`user_id\` int NOT NULL,
      \`student_name\` varchar(64) NOT NULL,
      \`lesson_number\` varchar(20),
      \`is_new_student\` int DEFAULT 0,
      \`last_lesson_content\` mediumtext,
      \`student_status\` mediumtext,
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
      INDEX \`idx_prep_userId\` (\`user_id\`)
    )`);
    tableEnsured = true;
    console.log("[备课] 表已就绪");

    // 启动时清理超过3天的旧任务
    cleanupOldTasks();
  } catch (err: any) {
    console.error("[备课] 建表失败:", err?.message);
  }
}

// 清理超过3天的旧备课任务
async function cleanupOldTasks(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const result = await db.delete(lessonPrepTasks)
      .where(sql`${lessonPrepTasks.createdAt} < ${threeDaysAgo}`);
    const deleted = (result as any)[0]?.affectedRows || 0;
    if (deleted > 0) {
      console.log(`[备课] 已清理 ${deleted} 条超过3天的旧任务`);
    }
  } catch (err: any) {
    console.error("[备课] 清理旧任务失败:", err?.message);
  }
}

// ============= 提示词构建（共享逻辑）=============

interface BuiltPrompts {
  systemPrompt: string;
  userMessage: string;
  studentStatus: string | null;
}

async function buildLessonPrepPrompts(
  userId: number,
  studentName: string,
  lessonNumber: string | null | undefined,
  isNewStudent: boolean,
  lastLessonContent: string | null | undefined,
): Promise<BuiltPrompts> {
  const studentStatus = await getStudentLatestStatus(userId, studentName);
  const prepRoadmap = await getConfigValue("lessonPrepRoadmap", userId) || "";
  const timeContext = getBeijingTimeContext();

  // 构建系统提示词
  let systemPrompt = "";
  if (prepRoadmap.trim()) {
    systemPrompt = `${timeContext}\n\n学生姓名：${studentName}\n\n${prepRoadmap}`;
  } else {
    systemPrompt = `${timeContext}\n\n学生姓名：${studentName}\n\n你是一位经验丰富的教师，正在为下一节课做备课准备。请根据提供的信息，生成一份详细的备课方案。

【输出格式要求】
1. 不要使用任何markdown标记（不要用#、**、*、\`\`\`等）
2. 不要用表格格式
3. 用中括号【】标记章节标题
4. 可以用空行分隔段落
5. 直接输出纯文本

【备课方案应包含】
1. 本次课教学目标
2. 重点难点分析
3. 教学内容安排与时间分配
4. 课堂练习/活动设计
5. 课后作业布置建议`;
  }

  systemPrompt += `\n\n【重要】不要与用户互动，不要等待确认，不要询问任何问题。
不要输出任何前言、寒暄、自我描述或元评论。
直接输出备课方案正文内容。`;

  // 构建用户消息
  const userMessageParts: string[] = [];

  if (lessonNumber) {
    userMessageParts.push(`本次课次：第${lessonNumber}次课`);
  }

  if (studentStatus) {
    userMessageParts.push(`【以下是本学生在「学生情况」模块中记录的总体状态描述，包含已学知识点、薄弱环节、学习进度等】\n${studentStatus}`);
  }

  if (isNewStudent) {
    userMessageParts.push(`【注意】这是一位新生，首次上课。`);
    if (lastLessonContent) {
      userMessageParts.push(`【新生基本情况】\n${lastLessonContent}`);
    }
    userMessageParts.push(`请为这位新生设计首次课的备课方案，重点关注：
1. 摸底评估（了解学生当前水平）
2. 建立学习计划框架
3. 首次课内容设计（难度适中，让学生有获得感）`);
  } else {
    if (lastLessonContent) {
      userMessageParts.push(`【上次课内容/反馈】\n${lastLessonContent}`);
    }
    userMessageParts.push(`请根据以上信息，为下一节课生成备课方案。确保：
1. 与上次课内容衔接
2. 针对学生薄弱环节安排训练
3. 合理安排教学进度`);
  }

  const userMessage = userMessageParts.join("\n\n");

  return { systemPrompt, userMessage, studentStatus };
}

// ============= 预览接口 =============

export interface PreviewLessonPrepParams {
  studentName: string;
  lessonNumber?: string;
  isNewStudent?: boolean;
  lastLessonContent?: string;
}

export async function previewLessonPrep(userId: number, params: PreviewLessonPrepParams): Promise<{
  systemPrompt: string;
  userMessage: string;
  studentStatus: string | null;
}> {
  const { systemPrompt, userMessage, studentStatus } = await buildLessonPrepPrompts(
    userId,
    params.studentName.trim(),
    params.lessonNumber || null,
    params.isNewStudent || false,
    params.lastLessonContent || null,
  );
  return { systemPrompt, userMessage, studentStatus };
}

// ============= 任务提交 =============

export interface SubmitLessonPrepParams {
  studentName: string;
  lessonNumber?: string;
  isNewStudent?: boolean;
  lastLessonContent?: string;     // 老生：上次课内容 / 新生：学生基本情况
  aiModel?: string;
}

export async function submitLessonPrep(userId: number, params: SubmitLessonPrepParams): Promise<{ id: number }> {
  await ensureLessonPrepTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 获取学生状态（从学生管理系统）
  const studentStatus = await getStudentLatestStatus(userId, params.studentName);

  const result = await db.insert(lessonPrepTasks).values({
    userId,
    studentName: params.studentName.trim(),
    lessonNumber: params.lessonNumber || null,
    isNewStudent: params.isNewStudent ? 1 : 0,
    lastLessonContent: params.lastLessonContent || null,
    studentStatus: studentStatus || null,
    aiModel: params.aiModel || null,
    taskStatus: "pending",
  });

  const taskId = Number((result as any)[0]?.insertId || (result as any).insertId);
  console.log(`[备课] 任务已创建: ID=${taskId}, 学生=${params.studentName}, 课次=${params.lessonNumber || '未指定'}, 新生=${params.isNewStudent ? '是' : '否'}`);

  processLessonPrepInBackground(userId, taskId);

  return { id: taskId };
}

// ============= 后台处理 =============

async function processLessonPrepInBackground(userId: number, taskId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 更新状态为 processing
    await db.update(lessonPrepTasks)
      .set({ taskStatus: "processing", streamingChars: 0 })
      .where(and(eq(lessonPrepTasks.id, taskId), eq(lessonPrepTasks.userId, userId)));

    // 读取任务数据
    const tasks = await db.select().from(lessonPrepTasks)
      .where(and(eq(lessonPrepTasks.id, taskId), eq(lessonPrepTasks.userId, userId)))
      .limit(1);
    if (tasks.length === 0) throw new Error("任务不存在");
    const task = tasks[0];

    // 使用共享的提示词构建逻辑
    const { systemPrompt, userMessage } = await buildLessonPrepPrompts(
      userId,
      task.studentName,
      task.lessonNumber,
      !!task.isNewStudent,
      task.lastLessonContent,
    );

    // 保存系统提示词
    await db.update(lessonPrepTasks)
      .set({ systemPrompt })
      .where(and(eq(lessonPrepTasks.id, taskId), eq(lessonPrepTasks.userId, userId)));

    const apiConfig = await getAPIConfig(userId);
    if (task.aiModel) {
      apiConfig.apiModel = task.aiModel;
    }

    // 调用 AI
    console.log(`[备课] 开始AI备课: 任务${taskId}, 学生=${task.studentName}`);
    let lastProgressTime = 0;
    const onProgress = (chars: number) => {
      const now = Date.now();
      if (now - lastProgressTime >= 1000) {
        db.update(lessonPrepTasks)
          .set({ streamingChars: chars })
          .where(and(eq(lessonPrepTasks.id, taskId), eq(lessonPrepTasks.userId, userId)))
          .catch(() => {});
        lastProgressTime = now;
      }
    };

    const result = await invokeAIStream(systemPrompt, userMessage, onProgress, {
      config: apiConfig,
      temperature: 0.7,
      timeout: 300000,
      retries: 1,
    });

    if (!result.content || !result.content.trim()) {
      throw new Error("AI 返回空内容");
    }

    // 保存结果
    await db.update(lessonPrepTasks)
      .set({
        result: result.content,
        taskStatus: "completed",
        streamingChars: result.content.length,
        completedAt: new Date(),
      })
      .where(and(eq(lessonPrepTasks.id, taskId), eq(lessonPrepTasks.userId, userId)));

    console.log(`[备课] 任务${taskId}完成, ${result.content.length}字`);
  } catch (err: any) {
    console.error(`[备课] 任务${taskId}失败:`, err?.message);
    try {
      await db.update(lessonPrepTasks)
        .set({
          taskStatus: "failed",
          errorMessage: err?.message || "未知错误",
        })
        .where(and(eq(lessonPrepTasks.id, taskId), eq(lessonPrepTasks.userId, userId)));
    } catch {}
  }
}

// ============= 查询接口 =============

export async function getLessonPrepTask(userId: number, id: number) {
  await ensureLessonPrepTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const tasks = await db.select().from(lessonPrepTasks)
    .where(and(eq(lessonPrepTasks.id, id), eq(lessonPrepTasks.userId, userId)))
    .limit(1);
  if (tasks.length === 0) throw new Error("任务不存在");
  return tasks[0];
}

export async function listLessonPrepTasks(userId: number, limit: number = 20) {
  await ensureLessonPrepTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  return db.select({
    id: lessonPrepTasks.id,
    studentName: lessonPrepTasks.studentName,
    lessonNumber: lessonPrepTasks.lessonNumber,
    isNewStudent: lessonPrepTasks.isNewStudent,
    aiModel: lessonPrepTasks.aiModel,
    taskStatus: lessonPrepTasks.taskStatus,
    errorMessage: lessonPrepTasks.errorMessage,
    streamingChars: lessonPrepTasks.streamingChars,
    createdAt: lessonPrepTasks.createdAt,
    completedAt: lessonPrepTasks.completedAt,
  })
    .from(lessonPrepTasks)
    .where(eq(lessonPrepTasks.userId, userId))
    .orderBy(desc(lessonPrepTasks.createdAt))
    .limit(limit);
}

export async function retryLessonPrep(userId: number, id: number): Promise<{ success: boolean }> {
  await ensureLessonPrepTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const tasks = await db.select().from(lessonPrepTasks)
    .where(and(eq(lessonPrepTasks.id, id), eq(lessonPrepTasks.userId, userId)))
    .limit(1);
  if (tasks.length === 0) throw new Error("任务不存在");
  const task = tasks[0];
  if (task.taskStatus !== "failed" && task.taskStatus !== "completed") {
    throw new Error("只能重试失败或已完成的任务");
  }

  // 重置状态
  await db.update(lessonPrepTasks)
    .set({
      taskStatus: "pending",
      errorMessage: null,
      result: null,
      streamingChars: 0,
      completedAt: null,
    })
    .where(and(eq(lessonPrepTasks.id, id), eq(lessonPrepTasks.userId, userId)));

  processLessonPrepInBackground(userId, id);
  return { success: true };
}

export async function deleteLessonPrep(userId: number, id: number): Promise<{ success: boolean }> {
  await ensureLessonPrepTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const result = await db.delete(lessonPrepTasks)
    .where(and(eq(lessonPrepTasks.id, id), eq(lessonPrepTasks.userId, userId)));
  const deleted = (result as any)[0]?.affectedRows || 0;
  if (deleted === 0) throw new Error("任务不存在");

  return { success: true };
}
