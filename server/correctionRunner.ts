/**
 * 作业批改系统 - 后端逻辑
 * 包含：表自动创建、任务提交、AI批改处理、结果解析、自动推送到学生管理
 */

import { getDb } from "./db";
import { correctionTasks } from "../drizzle/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { invokeAIStream, getConfigValue, FileInfo, getAPIConfig } from "./core/aiClient";
import { getStudentLatestStatus, importFromExtraction } from "./homeworkManager";
import { getBeijingTimeContext } from "./utils";
import { storagePut, storageGet } from "./storage";

// ============= 图片存储引用 =============

interface StoredImageRef {
  key: string;
  mimeType: string;
}

/**
 * 计算 base64 DataURI 数组的总字节大小（粗略估算）
 * base64 编码后大小约为原始数据的 4/3
 */
function estimateBase64TotalBytes(dataUris: string[]): number {
  let total = 0;
  for (const uri of dataUris) {
    // data:image/jpeg;base64, 前缀之后的部分
    const commaIdx = uri.indexOf(",");
    if (commaIdx >= 0) {
      const base64Part = uri.slice(commaIdx + 1);
      total += Math.ceil(base64Part.length * 3 / 4);
    } else {
      total += uri.length;
    }
  }
  return total;
}

/**
 * 将 base64 图片上传到外部存储，返回存储引用 JSON 字符串
 * 若存储不可用或上传失败，回退到内联存储（带大小限制）
 */
async function uploadImagesToStorage(userId: number, images: string[]): Promise<string> {
  const refs: StoredImageRef[] = [];

  for (let i = 0; i < images.length; i++) {
    const dataUri = images[i];
    // 解析 data URI: data:image/jpeg;base64,xxxxx
    const match = dataUri.match(/^data:(image\/[^;]+);base64,([\s\S]+)$/);
    if (!match) {
      console.warn(`[作业批改] 图片 ${i} 格式无效，跳过`);
      continue;
    }
    const mimeType = match[1];
    const base64Data = match[2];
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const key = `corrections/${userId}/${Date.now()}-${i}.${ext}`;

    const buffer = Buffer.from(base64Data, "base64");
    console.log(`[作业批改] 上传图片 ${i}: ${(buffer.length / 1024).toFixed(0)}KB → ${key}`);
    await storagePut(key, buffer, mimeType);
    refs.push({ key, mimeType });
  }

  if (refs.length === 0) {
    throw new Error("没有有效的图片可以上传");
  }

  console.log(`[作业批改] ${refs.length} 张图片已上传到存储`);
  return JSON.stringify(refs);
}

/**
 * 从存储加载图片，转为 AI 可用的 FileInfo 数组
 * 兼容两种格式：
 *   - 旧格式：string[]（base64 DataURI 数组，直接内联在 DB 中）
 *   - 新格式：StoredImageRef[]（存储引用，需要下载）
 */
async function loadImagesForAI(imagesJson: string): Promise<FileInfo[]> {
  const parsed = JSON.parse(imagesJson);
  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  const fileInfos: FileInfo[] = [];

  // 判断格式：旧格式是 string[]，新格式是 {key, mimeType}[]
  if (typeof parsed[0] === "string") {
    // 旧格式：直接使用 base64 DataURI（向后兼容）
    for (const img of parsed as string[]) {
      fileInfos.push({
        type: "image",
        base64DataUri: img,
        mimeType: img.startsWith("data:image/png") ? "image/png" : "image/jpeg",
      });
    }
    console.log(`[作业批改] 使用旧格式内联图片: ${fileInfos.length} 张`);
  } else {
    // 新格式：从存储下载
    const refs = parsed as StoredImageRef[];
    for (const ref of refs) {
      try {
        const { url } = await storageGet(ref.key);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const base64 = buffer.toString("base64");
        const dataUri = `data:${ref.mimeType};base64,${base64}`;
        fileInfos.push({
          type: "image",
          base64DataUri: dataUri,
          mimeType: ref.mimeType,
        });
        console.log(`[作业批改] 从存储加载图片: ${ref.key} (${(buffer.length / 1024).toFixed(0)}KB)`);
      } catch (err: any) {
        console.error(`[作业批改] 图片下载失败: ${ref.key}`, err?.message);
        // 单张失败不影响其他图片
      }
    }
    console.log(`[作业批改] 从存储加载了 ${fileInfos.length}/${refs.length} 张图片`);
  }

  return fileInfos;
}

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
      \`user_id\` int NOT NULL DEFAULT 0,
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
      \`streaming_chars\` int DEFAULT 0,
      \`auto_imported\` int DEFAULT 0,
      \`import_entry_id\` int,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`completed_at\` timestamp NULL,
      PRIMARY KEY (\`id\`)
    )`);
    // 安全添加新列（兼容从旧版迁移创建的表）
    try { await db.execute(sql`ALTER TABLE \`correction_tasks\` ADD COLUMN \`streaming_chars\` INT DEFAULT 0`); } catch (e: any) { if (!e?.message?.includes("Duplicate column")) console.warn("[作业批改] ALTER TABLE 警告:", e?.message); }
    try { await db.execute(sql`ALTER TABLE \`correction_tasks\` ADD COLUMN \`user_id\` INT NOT NULL DEFAULT 0`); } catch (e: any) { if (!e?.message?.includes("Duplicate column")) console.warn("[作业批改] ALTER TABLE 警告:", e?.message); }
    try { await db.execute(sql.raw(`ALTER TABLE \`correction_tasks\` ADD INDEX \`idx_corr_userId\` (\`user_id\`)`)); } catch { /* 索引可能已存在 */ }
    // 修复 completed_at 列：确保在所有 MySQL 配置下都是 nullable
    try { await db.execute(sql.raw(`ALTER TABLE \`correction_tasks\` MODIFY COLUMN \`completed_at\` TIMESTAMP NULL`)); } catch { /* 可能无需修改 */ }
    // V189: 多轮对话重试支持
    try { await db.execute(sql`ALTER TABLE \`correction_tasks\` ADD COLUMN \`retry_count\` INT DEFAULT 0`); } catch {}
    try { await db.execute(sql`ALTER TABLE \`correction_tasks\` ADD COLUMN \`conversation_history\` MEDIUMTEXT DEFAULT NULL`); } catch {}
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

export async function getCorrectionTypes(userId?: number): Promise<CorrectionType[]> {
  const stored = await getConfigValue("correctionTypes", userId);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      console.warn("[作业批改] correctionTypes 配置解析失败，使用默认值");
    }
  }
  return DEFAULT_CORRECTION_TYPES;
}

/**
 * 预览批改的系统提示词（不调用AI）
 */
export async function previewCorrectionPrompt(userId: number, studentName: string, correctionTypeId: string): Promise<{
  systemPrompt: string;
  studentStatus: string | null;
}> {
  const correctionTypes = await getCorrectionTypes(userId);
  const typeConfig = correctionTypes.find(t => t.id === correctionTypeId);
  const typeName = typeConfig?.name || correctionTypeId;
  const typePrompt = typeConfig?.prompt || '(未知类型)';
  const generalPrompt = await getCorrectionPrompt(userId);
  const timeContext = getBeijingTimeContext();
  const systemPrompt = `${timeContext}\n\n学生姓名：${studentName}\n批改类型：${typeName}\n\n${generalPrompt}\n\n【本次批改类型说明】\n${typePrompt}`;
  const { getStudentLatestStatus } = await import("./homeworkManager");
  const existingStatus = await getStudentLatestStatus(userId, studentName);
  return { systemPrompt, studentStatus: existingStatus };
}

export async function getCorrectionPrompt(userId?: number): Promise<string> {
  const stored = await getConfigValue("correctionPrompt", userId);
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

export async function submitCorrection(userId: number, params: SubmitCorrectionParams): Promise<{ id: number }> {
  await ensureCorrectionTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const studentStatus = await getStudentLatestStatus(userId, params.studentName);

  // 处理文件：提取文本
  const processedFiles: Array<{ name: string; extractedText: string }> = [];
  if (params.files && params.files.length > 0) {
    for (const file of params.files) {
      const text = await extractTextFromFile(file.name, file.content, file.mimeType);
      processedFiles.push({ name: file.name, extractedText: text });
    }
  }

  // 处理图片：上传到外部存储，避免 base64 数据塞入 SQL 导致超过 max_allowed_packet
  let imagesJson: string | null = null;
  if (params.images && params.images.length > 0) {
    const totalBytes = estimateBase64TotalBytes(params.images);
    console.log(`[作业批改] 收到 ${params.images.length} 张图片，总大小约 ${(totalBytes / 1024 / 1024).toFixed(2)}MB`);

    try {
      imagesJson = await uploadImagesToStorage(userId, params.images);
    } catch (storageErr: any) {
      console.error(`[作业批改] 存储上传失败，检查图片大小:`, storageErr?.message);
      // 存储不可用时，如果图片总大小 < 2MB 可回退到内联存储
      if (totalBytes < 2 * 1024 * 1024) {
        console.warn(`[作业批改] 回退到内联存储 (${(totalBytes / 1024).toFixed(0)}KB)`);
        imagesJson = JSON.stringify(params.images);
      } else {
        throw new Error(`图片太大 (${(totalBytes / 1024 / 1024).toFixed(1)}MB)，存储服务暂不可用，请稍后重试或压缩图片后再提交`);
      }
    }
  }

  const result = await db.insert(correctionTasks).values({
    userId,
    studentName: params.studentName.trim(),
    correctionType: params.correctionType,
    rawText: params.rawText || null,
    images: imagesJson,
    files: processedFiles.length > 0 ? JSON.stringify(processedFiles) : null,
    studentStatus: studentStatus || null,
    aiModel: params.aiModel || null,
    taskStatus: "pending",
  });

  const taskId = Number((result as any)[0]?.insertId || (result as any).insertId);
  console.log(`[作业批改] 任务已创建: ID=${taskId}, 学生=${params.studentName}, 类型=${params.correctionType}, 图片=${params.images?.length || 0}张`);

  processCorrectionInBackground(userId, taskId);

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

async function processCorrectionInBackground(userId: number, taskId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 读取任务数据
    const tasks = await db.select().from(correctionTasks)
      .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)))
      .limit(1);
    if (tasks.length === 0) throw new Error("任务不存在");
    const task = tasks[0];

    // 在处理前先解析实际使用的模型，写入DB让前端可以立刻显示
    const apiConfig = await getAPIConfig(userId);
    if (task.aiModel) {
      apiConfig.apiModel = task.aiModel;
    }
    const resolvedModel = apiConfig.apiModel;

    // 更新状态为 processing，重置进度字段，同时写入模型
    await db.update(correctionTasks)
      .set({ taskStatus: "processing", streamingChars: 0, aiModel: resolvedModel })
      .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)));

    const correctionTypes = await getCorrectionTypes(userId);
    const typeConfig = correctionTypes.find(t => t.id === task.correctionType);
    if (!typeConfig) throw new Error(`未知的批改类型: ${task.correctionType}`);

    const generalPrompt = await getCorrectionPrompt(userId);
    const timeContext = getBeijingTimeContext();
    const systemPrompt = `${timeContext}\n\n学生姓名：${task.studentName}\n批改类型：${typeConfig.name}\n\n${generalPrompt}\n\n【本次批改类型说明】\n${typeConfig.prompt}`;

    // 保存使用的系统提示词
    await db.update(correctionTasks)
      .set({ systemPrompt })
      .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)));

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

    // 构建图片 FileInfo（兼容旧格式内联 base64 和新格式存储引用）
    const fileInfos: FileInfo[] = [];
    if (task.images) {
      try {
        const loaded = await loadImagesForAI(task.images);
        fileInfos.push(...loaded);
      } catch (imgErr: any) {
        console.error(`[作业批改] 加载图片失败:`, imgErr?.message);
        // 图片加载失败不应阻止整个批改流程（可能只有文字内容）
      }
    }

    // 调用 AI（带流式进度上报），使用前面已解析的 apiConfig
    console.log(`[作业批改] 开始AI批改: 任务${taskId}, 图片${fileInfos.length}张, 模型 ${resolvedModel}`);
    let lastProgressTime = 0;
    const onProgress = (chars: number) => {
      const now = Date.now();
      if (now - lastProgressTime >= 1000) {
        db.update(correctionTasks)
          .set({ streamingChars: chars })
          .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)))
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
      .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)));

    console.log(`[作业批改] 任务${taskId}完成, 批改${correction.length}字, 状态更新${statusUpdate.length}字`);

    // 自动推送到学生管理系统（始终尝试，即使AI未按格式分割）
    try {
      const importContent = statusUpdate.trim()
        ? statusUpdate
        : `作业批改完成摘要：\n批改时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n\n${correction}`;
      const importResult = await importFromExtraction(
        userId,
        task.studentName,
        importContent,
        `[从作业批改导入]\n批改类型：${typeConfig.name}`,
      );
      await db.update(correctionTasks)
        .set({
          autoImported: 1,
          importEntryId: importResult.id,
        })
        .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)));
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
        .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)));
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

export async function getCorrectionTask(userId: number, taskId: number) {
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
    streamingChars: correctionTasks.streamingChars,
    retryCount: correctionTasks.retryCount,
    createdAt: correctionTasks.createdAt,
    completedAt: correctionTasks.completedAt,
  }).from(correctionTasks)
    .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)))
    .limit(1);

  return tasks[0] || null;
}

export async function listCorrectionTasks(userId: number, studentName?: string, limit: number = 20) {
  await ensureCorrectionTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const baseCondition = eq(correctionTasks.userId, userId);
  const condition = studentName
    ? and(baseCondition, eq(correctionTasks.studentName, studentName))
    : baseCondition;

  return db.select({
    id: correctionTasks.id,
    studentName: correctionTasks.studentName,
    correctionType: correctionTasks.correctionType,
    taskStatus: correctionTasks.taskStatus,
    aiModel: correctionTasks.aiModel,
    streamingChars: correctionTasks.streamingChars,
    autoImported: correctionTasks.autoImported,
    retryCount: correctionTasks.retryCount,
    errorMessage: correctionTasks.errorMessage,
    createdAt: correctionTasks.createdAt,
    completedAt: correctionTasks.completedAt,
  }).from(correctionTasks)
    .where(condition)
    .orderBy(desc(correctionTasks.createdAt))
    .limit(limit);
}

// ============= 多轮对话重试 =============

/**
 * 重试作业批改（多轮对话模式）
 * 将用户反馈追加到对话中，让AI重新生成批改结果
 */
export async function retryCorrectionTask(
  userId: number,
  taskId: number,
  userFeedback: string,
): Promise<void> {
  await ensureCorrectionTable();
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 读取原任务（需要完整数据）
  const tasks = await db.select().from(correctionTasks)
    .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)))
    .limit(1);
  if (tasks.length === 0) throw new Error("任务不存在");
  const task = tasks[0];

  if (task.taskStatus !== "completed" && task.taskStatus !== "failed") {
    throw new Error("只有已完成或失败的任务可以重试");
  }

  const currentRetry = (task.retryCount || 0) + 1;
  if (currentRetry > 5) throw new Error("已达到最大重试次数(5次)");

  // 更新状态为 processing
  const resolvedModel = task.aiModel || (await getAPIConfig(userId)).apiModel;
  await db.update(correctionTasks)
    .set({
      taskStatus: "processing",
      streamingChars: 0,
      aiModel: resolvedModel,
      errorMessage: null,
      retryCount: currentRetry,
    })
    .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)));

  // 异步处理
  processCorrectionRetryInBackground(userId, taskId, userFeedback, currentRetry).catch(err => {
    console.error(`[作业批改] 重试任务${taskId}异常:`, err?.message);
  });
}

async function processCorrectionRetryInBackground(
  userId: number,
  taskId: number,
  userFeedback: string,
  retryCount: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const tasks = await db.select().from(correctionTasks)
      .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)))
      .limit(1);
    if (tasks.length === 0) throw new Error("任务不存在");
    const task = tasks[0];

    // 恢复系统提示词
    const systemPrompt = task.systemPrompt || "";
    if (!systemPrompt) throw new Error("系统提示词丢失，无法重试");

    // 重构原始用户消息
    const userMessageParts: string[] = [];
    if (task.studentStatus) userMessageParts.push(`【学生当前状态信息】\n${task.studentStatus}`);
    if (task.rawText) userMessageParts.push(`【作业内容】\n${task.rawText}`);
    if (task.files) {
      try {
        const files = JSON.parse(task.files) as Array<{ name: string; extractedText: string }>;
        for (const f of files) userMessageParts.push(`【文件: ${f.name}】\n${f.extractedText}`);
      } catch {}
    }
    const originalUserMessage = userMessageParts.join("\n\n") || "（无文本内容，请查看图片）";

    // 构建图片（与原始处理相同）
    const fileInfos: FileInfo[] = [];
    if (task.images) {
      try {
        const loaded = await loadImagesForAI(task.images);
        fileInfos.push(...loaded);
      } catch (imgErr: any) {
        console.error(`[作业批改] 重试加载图片失败:`, imgErr?.message);
      }
    }

    // 解析历史对话
    let conversationHistory: Array<{ role: "assistant" | "user"; content: string }> = [];
    if (task.conversationHistory) {
      try { conversationHistory = JSON.parse(task.conversationHistory); } catch {}
    }

    // 构建多轮对话的 extraMessages
    const extraMessages: Array<{ role: "assistant" | "user"; content: string }> = [];

    if (userFeedback.trim()) {
      // 有用户反馈：构建多轮对话
      if (conversationHistory.length > 0) {
        // 已有历史对话，直接追加
        extraMessages.push(...conversationHistory);
      } else if (task.resultCorrection) {
        // 第一次重试：把原始AI回复作为 assistant 消息
        const aiReply = task.resultStatusUpdate
          ? `===批改内容===\n${task.resultCorrection}\n\n===状态更新===\n${task.resultStatusUpdate}`
          : task.resultCorrection;
        extraMessages.push({ role: "assistant", content: aiReply });
      }
      // 追加本次用户反馈
      extraMessages.push({ role: "user", content: `【教师反馈】\n${userFeedback}\n\n请根据以上反馈重新批改，输出格式与之前相同（===批改内容=== 和 ===状态更新=== 两个部分）。` });
    }
    // 无用户反馈时 extraMessages 为空，等于从头重新执行

    const apiConfig = await getAPIConfig(userId);
    if (task.aiModel) apiConfig.apiModel = task.aiModel;

    console.log(`[作业批改] 开始第${retryCount}次重试: 任务${taskId}, ${extraMessages.length}条对话, 模型 ${apiConfig.apiModel}`);

    let lastProgressTime = 0;
    const onProgress = (chars: number) => {
      const now = Date.now();
      if (now - lastProgressTime >= 1000) {
        db.update(correctionTasks)
          .set({ streamingChars: chars })
          .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)))
          .catch(() => {});
        lastProgressTime = now;
      }
    };

    const result = await invokeAIStream(systemPrompt, originalUserMessage, onProgress, {
      config: apiConfig,
      maxTokens: 8000,
      temperature: 0.5,
      timeout: 180000,
      retries: 1,
      fileInfos: fileInfos.length > 0 ? fileInfos : undefined,
      extraMessages,
    });

    if (!result.content || !result.content.trim()) {
      throw new Error("AI 返回空内容");
    }

    const { correction, statusUpdate } = parseAIResult(result.content);

    // 更新对话历史（保存完整的多轮记录）
    const newHistory = [...extraMessages, { role: "assistant" as const, content: result.content }];

    // 删除旧的自动导入条目（如果有）
    if (task.importEntryId) {
      try {
        const { deleteEntry } = await import("./homeworkManager");
        await deleteEntry(userId, task.importEntryId);
        console.log(`[作业批改] 已删除旧导入条目: ${task.importEntryId}`);
      } catch (delErr: any) {
        console.warn(`[作业批改] 删除旧导入条目失败:`, delErr?.message);
      }
    }

    // 保存结果
    await db.update(correctionTasks)
      .set({
        resultCorrection: correction,
        resultStatusUpdate: statusUpdate,
        taskStatus: "completed",
        streamingChars: result.content.length,
        completedAt: new Date(),
        conversationHistory: JSON.stringify(newHistory),
        autoImported: 0,
        importEntryId: null,
      })
      .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)));

    console.log(`[作业批改] 重试任务${taskId}完成, 批改${correction.length}字, 状态更新${statusUpdate.length}字`);

    // 重新自动推送到学生管理
    try {
      const correctionTypes = await getCorrectionTypes(userId);
      const typeConfig = correctionTypes.find(t => t.id === task.correctionType);
      const importContent = statusUpdate.trim()
        ? statusUpdate
        : `作业批改完成摘要：\n批改时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n\n${correction}`;
      const importResult = await importFromExtraction(
        userId,
        task.studentName,
        importContent,
        `[从作业批改导入(第${retryCount}次重试)]\n批改类型：${typeConfig?.name || task.correctionType}`,
      );
      await db.update(correctionTasks)
        .set({ autoImported: 1, importEntryId: importResult.id })
        .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)));
      console.log(`[作业批改] 重试后已自动推送到学生管理: 条目ID=${importResult.id}`);
    } catch (importErr: any) {
      console.error(`[作业批改] 重试后自动推送失败:`, importErr?.message);
    }

  } catch (err: any) {
    console.error(`[作业批改] 重试任务${taskId}失败:`, err?.message);
    try {
      await db.update(correctionTasks)
        .set({
          taskStatus: "failed",
          errorMessage: err?.message || "未知错误",
        })
        .where(and(eq(correctionTasks.id, taskId), eq(correctionTasks.userId, userId)));
    } catch {}
  }
}
