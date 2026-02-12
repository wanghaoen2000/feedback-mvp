/**
 * 作业批改系统 - 后端逻辑
 * 包含：表自动创建、任务提交、AI批改处理、结果解析、自动推送到学生管理
 */

import { getDb } from "./db";
import { correctionTasks } from "../drizzle/schema";
import { eq, desc, sql } from "drizzle-orm";
import { invokeAIStream, getConfigValue, FileInfo, getAPIConfig } from "./core/aiClient";
import { getStudentLatestStatus, importFromExtraction } from "./homeworkManager";
import { getBeijingTimeContext } from "./utils";

// ============= 批改类型接口 =============

export interface CorrectionType {
  id: string;
  name: string;
  prompt: string;
}

// 默认批改类型
const DEFAULT_CORRECTION_TYPES: CorrectionType[] = [
  {
    id: "translation",
    name: "豆包翻译",
    prompt: "这是一份翻译练习作业。请检查翻译的准确性、流畅性和用词是否恰当。指出翻译错误并给出正确翻译，同时点评翻译技巧。",
  },
  {
    id: "academic",
    name: "学术文章",
    prompt: "这是一篇学术写作文章。请从论点逻辑、论据充分性、学术用语规范性、语法准确性等方面进行批改。",
  },
  {
    id: "daily",
    name: "日常文章",
    prompt: "这是一篇日常话题文章。请检查语法、用词、表达是否地道，指出需要改进的地方并给出建议。",
  },
  {
    id: "vocabulary",
    name: "词汇填空",
    prompt: "这是一份词汇填空练习。请检查每个填空的答案是否正确，解释错误选项的原因，并巩固相关词汇知识点。",
  },
];

// 通用批改系统提示词
const DEFAULT_CORRECTION_PROMPT = `你是一位经验丰富的英语教师，正在批改学生的作业。

【回复要求】
1. 直接以教师口吻回复学生，不要说"我已收到"、"好的"等开场白
2. 不要使用markdown格式标记
3. 回复分为两个明确的部分，用分隔线隔开

【输出格式】
===批改内容===
（这里写给学生看的批改反馈，包括：逐条批改、错误纠正、改进建议、鼓励点评等）

===状态更新===
（这里写给系统记录的摘要，格式如下：
- 作业类型：xxx
- 完成日期：xxx
- 主要问题：xxx
- 掌握程度：优/良/中/差
- 后续建议：xxx
）`;

// ============= 表自动创建 =============

let tableEnsured = false;

export async function ensureCorrectionTable(): Promise<void> {
  if (tableEnsured) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS \`correction_tasks\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`student_name\` varchar(64) NOT NULL,
      \`correction_type\` varchar(64) NOT NULL,
      \`raw_text\` mediumtext,
      \`images\` mediumtext,
      \`files\` mediumtext,
      \`student_status\` mediumtext,
      \`system_prompt\` mediumtext,
      \`result_correction\` mediumtext,
      \`result_status_update\` mediumtext,
      \`ai_model\` varchar(128),
      \`task_status\` varchar(20) NOT NULL DEFAULT 'pending',
      \`error_message\` text,
      \`auto_imported\` int DEFAULT 0,
      \`import_entry_id\` int,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`completed_at\` timestamp,
      PRIMARY KEY (\`id\`)
    )`);
    // 安全添加新列
    try {
      await db.execute(sql`ALTER TABLE \`correction_tasks\` ADD COLUMN \`streaming_chars\` INT DEFAULT 0`);
    } catch (e: any) {
      if (!e?.message?.includes("Duplicate column")) console.warn("[作业批改] ALTER TABLE 警告:", e?.message);
    }
    tableEnsured = true;
    console.log("[作业批改] 表已就绪");

    // 启动时清理超过3天的旧任务
    cleanupOldTasks();
  } catch (err: any) {
    console.error("[作业批改] 建表失败:", err?.message);
  }
}

// 清理超过3天的旧批改任务
async function cleanupOldTasks(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const result = await db.delete(correctionTasks)
      .where(sql`${correctionTasks.createdAt} < ${threeDaysAgo}`);
    const deleted = (result as any)[0]?.affectedRows || 0;
    if (deleted > 0) {
      console.log(`[作业批改] 已清理 ${deleted} 条超过3天的旧任务`);
    }
  } catch (err: any) {
    console.error("[作业批改] 清理旧任务失败:", err?.message);
  }
}

// ============= 批改类型配置管理 =============

export async function getCorrectionTypes(): Promise<CorrectionType[]> {
  const stored = await getConfigValue("correctionTypes");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      console.warn("[作业批改] correctionTypes 配置解析失败，使用默认值");
    }
  }
  return DEFAULT_CORRECTION_TYPES;
}

export async function getCorrectionPrompt(): Promise<string> {
  const stored = await getConfigValue("correctionPrompt");
  return stored || DEFAULT_CORRECTION_PROMPT;
}

// ============= 任务提交 =============

export interface SubmitCorrectionParams {
  studentName: string;
  correctionType: string;
  rawText?: string;
  images?: string[];      // base64 data URI 数组
  files?: Array<{ name: string; content: string; mimeType: string }>;  // 文件内容
  aiModel?: string;
}

export async function submitCorrection(params: SubmitCorrectionParams): Promise<{ id: number }> {
  await ensureCorrectionTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 获取学生当前状态快照
  const studentStatus = await getStudentLatestStatus(params.studentName);

  // 处理文件：提取文本
  const processedFiles: Array<{ name: string; extractedText: string }> = [];
  if (params.files && params.files.length > 0) {
    for (const file of params.files) {
      const text = await extractTextFromFile(file.name, file.content, file.mimeType);
      processedFiles.push({ name: file.name, extractedText: text });
    }
  }

  const result = await db.insert(correctionTasks).values({
    studentName: params.studentName.trim(),
    correctionType: params.correctionType,
    rawText: params.rawText || null,
    images: params.images && params.images.length > 0 ? JSON.stringify(params.images) : null,
    files: processedFiles.length > 0 ? JSON.stringify(processedFiles) : null,
    studentStatus: studentStatus || null,
    aiModel: params.aiModel || null,
    taskStatus: "pending",
  });

  const taskId = Number((result as any)[0]?.insertId || (result as any).insertId);
  console.log(`[作业批改] 任务已创建: ID=${taskId}, 学生=${params.studentName}, 类型=${params.correctionType}`);

  // 后台异步处理
  processCorrectionInBackground(taskId);

  return { id: taskId };
}

// ============= 文件文本提取 =============

async function extractTextFromFile(name: string, base64Content: string, mimeType: string): Promise<string> {
  const ext = name.toLowerCase().split(".").pop() || "";
  const buffer = Buffer.from(base64Content, "base64");

  if (ext === "txt" || mimeType === "text/plain") {
    return buffer.toString("utf-8");
  }

  if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.default.extractRawText({ buffer });
      return result.value;
    } catch (err: any) {
      console.error(`[作业批改] docx提取失败: ${name}`, err?.message);
      return `[文档提取失败: ${name}]`;
    }
  }

  if (ext === "pdf" || mimeType === "application/pdf") {
    try {
      const pdfModule = await import("pdf-parse");
      const pdfParse = (pdfModule as any).default || pdfModule;
      const result = await pdfParse(buffer);
      return result.text;
    } catch (err: any) {
      console.error(`[作业批改] PDF提取失败: ${name}`, err?.message);
      return `[PDF提取失败: ${name}]`;
    }
  }

  return `[不支持的文件格式: ${ext}]`;
}

// ============= 后台处理 =============

async function processCorrectionInBackground(taskId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 更新状态为 processing
    await db.update(correctionTasks)
      .set({ taskStatus: "processing" })
      .where(eq(correctionTasks.id, taskId));

    // 读取任务数据
    const tasks = await db.select().from(correctionTasks)
      .where(eq(correctionTasks.id, taskId))
      .limit(1);
    if (tasks.length === 0) throw new Error("任务不存在");
    const task = tasks[0];

    // 获取批改类型配置
    const correctionTypes = await getCorrectionTypes();
    const typeConfig = correctionTypes.find(t => t.id === task.correctionType);
    if (!typeConfig) throw new Error(`未知的批改类型: ${task.correctionType}`);

    // 构建系统提示词
    const generalPrompt = await getCorrectionPrompt();
    const timeContext = getBeijingTimeContext();
    const systemPrompt = `${timeContext}\n\n学生姓名：${task.studentName}\n批改类型：${typeConfig.name}\n\n${generalPrompt}\n\n【本次批改类型说明】\n${typeConfig.prompt}`;

    // 保存使用的系统提示词
    await db.update(correctionTasks)
      .set({ systemPrompt })
      .where(eq(correctionTasks.id, taskId));

    // 构建用户消息
    const userMessageParts: string[] = [];

    // 添加学生状态
    if (task.studentStatus) {
      userMessageParts.push(`【学生当前状态信息】\n${task.studentStatus}`);
    }

    // 添加文本内容
    if (task.rawText) {
      userMessageParts.push(`【作业内容】\n${task.rawText}`);
    }

    // 添加文件提取文字
    if (task.files) {
      try {
        const files = JSON.parse(task.files) as Array<{ name: string; extractedText: string }>;
        for (const f of files) {
          userMessageParts.push(`【文件: ${f.name}】\n${f.extractedText}`);
        }
      } catch {}
    }

    const userMessage = userMessageParts.join("\n\n") || "（无文本内容，请查看图片）";

    // 构建图片 FileInfo
    const fileInfos: FileInfo[] = [];
    if (task.images) {
      try {
        const images = JSON.parse(task.images) as string[];
        for (const img of images) {
          fileInfos.push({
            type: "image",
            base64DataUri: img,
            mimeType: img.startsWith("data:image/png") ? "image/png" : "image/jpeg",
          });
        }
      } catch {}
    }

    // 获取 AI 配置
    const apiConfig = await getAPIConfig();
    if (task.aiModel) {
      apiConfig.apiModel = task.aiModel;
    }

    // 调用 AI（带流式进度上报）
    console.log(`[作业批改] 开始AI批改: 任务${taskId}, 图片${fileInfos.length}张`);
    let lastProgressTime = 0;
    const onProgress = (chars: number) => {
      const now = Date.now();
      if (now - lastProgressTime >= 1000) {
        db.update(correctionTasks)
          .set({ streamingChars: chars })
          .where(eq(correctionTasks.id, taskId))
          .catch(() => {}); // 进度更新失败不影响主流程
        lastProgressTime = now;
      }
    };
    const result = await invokeAIStream(systemPrompt, userMessage, onProgress, {
      config: apiConfig,
      maxTokens: 8000,
      temperature: 0.5,
      timeout: 180000,
      retries: 1,
      fileInfos: fileInfos.length > 0 ? fileInfos : undefined,
    });

    if (!result.content || !result.content.trim()) {
      throw new Error("AI 返回空内容");
    }

    // 解析结果：分离批改内容和状态更新
    const { correction, statusUpdate } = parseAIResult(result.content);

    // 保存结果
    await db.update(correctionTasks)
      .set({
        resultCorrection: correction,
        resultStatusUpdate: statusUpdate,
        taskStatus: "completed",
        streamingChars: result.content.length,
        completedAt: new Date(),
      })
      .where(eq(correctionTasks.id, taskId));

    console.log(`[作业批改] 任务${taskId}完成, 批改${correction.length}字, 状态更新${statusUpdate.length}字`);

    // 自动推送到学生管理系统（始终尝试，即使AI未按格式分割）
    try {
      const importContent = statusUpdate.trim()
        ? statusUpdate
        : `作业批改完成摘要：\n批改类型：${typeConfig.name}\n批改时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n\n${correction.slice(0, 500)}`;
      const importResult = await importFromExtraction(
        task.studentName,
        `[从作业批改导入]\n批改类型：${typeConfig.name}\n${importContent}`,
      );
      await db.update(correctionTasks)
        .set({
          autoImported: 1,
          importEntryId: importResult.id,
        })
        .where(eq(correctionTasks.id, taskId));
      console.log(`[作业批改] 已自动推送到学生管理: 条目ID=${importResult.id}`);
    } catch (importErr: any) {
      console.error(`[作业批改] 自动推送失败:`, importErr?.message);
      // 推送失败不影响批改结果
    }
  } catch (err: any) {
    console.error(`[作业批改] 任务${taskId}失败:`, err?.message);
    try {
      await db.update(correctionTasks)
        .set({
          taskStatus: "failed",
          errorMessage: err?.message || "未知错误",
        })
        .where(eq(correctionTasks.id, taskId));
    } catch {}
  }
}

// ============= 结果解析 =============

function parseAIResult(content: string): { correction: string; statusUpdate: string } {
  // 尝试按分隔标记拆分
  const correctionMatch = content.match(/===\s*批改内容\s*===([\s\S]*?)(?:===\s*状态更新\s*===|$)/);
  const statusMatch = content.match(/===\s*状态更新\s*===([\s\S]*?)$/);

  if (correctionMatch && statusMatch) {
    return {
      correction: correctionMatch[1].trim(),
      statusUpdate: statusMatch[1].trim(),
    };
  }

  // 如果AI没有按格式返回，整体作为批改内容，状态更新为空
  console.warn("[作业批改] AI未按格式返回，尝试其他分隔方式");

  // 尝试其他常见分隔方式
  const altSplit = content.split(/---+\s*状态更新\s*---+/i);
  if (altSplit.length >= 2) {
    return {
      correction: altSplit[0].trim(),
      statusUpdate: altSplit.slice(1).join("\n").trim(),
    };
  }

  return {
    correction: content.trim(),
    statusUpdate: "",
  };
}

// ============= 查询接口 =============

export async function getCorrectionTask(taskId: number) {
  await ensureCorrectionTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const tasks = await db.select({
    id: correctionTasks.id,
    studentName: correctionTasks.studentName,
    correctionType: correctionTasks.correctionType,
    taskStatus: correctionTasks.taskStatus,
    resultCorrection: correctionTasks.resultCorrection,
    resultStatusUpdate: correctionTasks.resultStatusUpdate,
    errorMessage: correctionTasks.errorMessage,
    autoImported: correctionTasks.autoImported,
    aiModel: correctionTasks.aiModel,
    createdAt: correctionTasks.createdAt,
    completedAt: correctionTasks.completedAt,
  }).from(correctionTasks)
    .where(eq(correctionTasks.id, taskId))
    .limit(1);

  return tasks[0] || null;
}

export async function listCorrectionTasks(studentName?: string, limit: number = 20) {
  await ensureCorrectionTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const query = db.select({
    id: correctionTasks.id,
    studentName: correctionTasks.studentName,
    correctionType: correctionTasks.correctionType,
    taskStatus: correctionTasks.taskStatus,
    aiModel: correctionTasks.aiModel,
    streamingChars: correctionTasks.streamingChars,
    autoImported: correctionTasks.autoImported,
    errorMessage: correctionTasks.errorMessage,
    createdAt: correctionTasks.createdAt,
    completedAt: correctionTasks.completedAt,
  }).from(correctionTasks);

  if (studentName) {
    return query
      .where(eq(correctionTasks.studentName, studentName))
      .orderBy(desc(correctionTasks.createdAt))
      .limit(limit);
  }

  return query
    .orderBy(desc(correctionTasks.createdAt))
    .limit(limit);
}
