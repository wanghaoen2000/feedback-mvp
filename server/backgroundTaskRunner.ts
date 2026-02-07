/**
 * 后台任务运行器
 * 在服务器端执行完整的5步生成流程，断网也不影响
 */

import { getDb } from "./db";
import { backgroundTasks } from "../drizzle/schema";
import { eq, lt, and, sql } from "drizzle-orm";
import { getConfigValue as getConfig } from "./core/aiClient";
import { DEFAULT_CONFIG } from "./core/aiClient";
import {
  generateFeedbackContent,
  generateReviewContent,
  generateTestContent,
  generateExtractionContent,
  generateBubbleChart,
  FeedbackInput,
  ClassFeedbackInput,
  generateClassFeedbackContent,
  generateClassReviewContent,
  generateClassTestContent,
  generateClassExtractionContent,
  generateClassBubbleChartSVG,
} from "./feedbackGenerator";
import {
  uploadToGoogleDrive,
  uploadBinaryToGoogleDrive,
} from "./gdrive";

/**
 * 给日期字符串添加星期信息（与 classStreamRoutes.ts 保持一致）
 */
function addWeekdayToDate(dateStr: string): string {
  if (!dateStr) return dateStr;
  if (dateStr.includes('周') || dateStr.includes('星期')) return dateStr;
  try {
    const match = dateStr.match(/(\d{4})年?(\d{1,2})月(\d{1,2})日?/);
    if (!match) {
      const shortMatch = dateStr.match(/(\d{1,2})月(\d{1,2})日?/);
      if (!shortMatch) return dateStr;
      const year = new Date().getFullYear();
      const date = new Date(year, parseInt(shortMatch[1], 10) - 1, parseInt(shortMatch[2], 10));
      const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
      return `${dateStr}（周${weekday}）`;
    }
    const date = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    return `${dateStr}（周${weekday}）`;
  } catch {
    return dateStr;
  }
}

// 步骤结果类型
interface StepResult {
  status: "pending" | "running" | "completed" | "failed";
  fileName?: string;
  url?: string;
  path?: string;
  folderUrl?: string;
  chars?: number;
  error?: string;
}

interface StepResults {
  feedback?: StepResult;
  review?: StepResult;
  test?: StepResult;
  extraction?: StepResult;
  bubbleChart?: StepResult;
}

// 一对一输入参数（字段可选性与 bgTask.submit schema 一致）
export interface OneToOneTaskParams {
  courseType: "one-to-one";
  studentName: string;
  lessonNumber?: string;
  lessonDate?: string;
  currentYear?: string;
  lastFeedback?: string;
  currentNotes: string;
  transcript: string;
  isFirstLesson?: boolean;
  specialRequirements?: string;
  // 配置快照
  apiModel?: string;
  apiKey?: string;
  apiUrl?: string;
  roadmap?: string;
  driveBasePath?: string;
}

// 小班课输入参数
export interface ClassTaskParams {
  courseType: "class";
  classNumber: string;
  lessonNumber?: string;
  lessonDate?: string;
  currentYear?: string;
  attendanceStudents: string[];
  lastFeedback?: string;
  currentNotes: string;
  transcript: string;
  specialRequirements?: string;
  // 配置快照
  apiModel?: string;
  apiKey?: string;
  apiUrl?: string;
  roadmapClass?: string;
  driveBasePath?: string;
  classStoragePath?: string;
}

export type TaskParams = OneToOneTaskParams | ClassTaskParams;

// 更新任务进度（带错误保护，DB故障不中断生成流程）
async function updateTask(taskId: string, updates: Record<string, any>) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.update(backgroundTasks).set(updates).where(eq(backgroundTasks.id, taskId));
  } catch (err: any) {
    console.error(`[后台任务] ${taskId} 更新DB失败:`, err?.message || err);
  }
}

// 更新步骤结果
async function updateStepResults(taskId: string, stepResults: StepResults, currentStep: number) {
  await updateTask(taskId, {
    stepResults: JSON.stringify(stepResults),
    currentStep,
  });
}

/**
 * 启动后台任务（fire-and-forget）
 */
export function startBackgroundTask(taskId: string) {
  // 不 await，让它在后台运行
  runTask(taskId).catch((err) => {
    console.error(`[后台任务] ${taskId} 顶层异常:`, err);
    updateTask(taskId, {
      status: "failed",
      errorMessage: `顶层异常: ${err?.message || String(err)}`,
    }).catch(() => {});
  });
}

/**
 * 执行后台任务
 */
async function runTask(taskId: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 读取任务
  const tasks = await db.select().from(backgroundTasks).where(eq(backgroundTasks.id, taskId)).limit(1);
  if (tasks.length === 0) throw new Error(`任务不存在: ${taskId}`);

  const task = tasks[0];
  const params: TaskParams = JSON.parse(task.inputParams);

  // 更新状态为运行中
  await updateTask(taskId, { status: "running", currentStep: 0 });

  if (params.courseType === "one-to-one") {
    await runOneToOneTask(taskId, params);
  } else {
    await runClassTask(taskId, params);
  }
}

/**
 * 一对一任务
 */
async function runOneToOneTask(taskId: string, params: OneToOneTaskParams) {
  const stepResults: StepResults = {};
  let feedbackContent = "";
  let dateStr = "";
  let failedSteps = 0;

  // 获取配置
  const apiModel = params.apiModel || (await getConfig("apiModel")) || DEFAULT_CONFIG.apiModel;
  const apiKey = params.apiKey || (await getConfig("apiKey")) || DEFAULT_CONFIG.apiKey;
  const apiUrl = params.apiUrl || (await getConfig("apiUrl")) || DEFAULT_CONFIG.apiUrl;
  const roadmap = params.roadmap !== undefined ? params.roadmap : ((await getConfig("roadmap")) || DEFAULT_CONFIG.roadmap);
  const driveBasePath = params.driveBasePath || (await getConfig("driveBasePath")) || DEFAULT_CONFIG.driveBasePath;
  const currentYear = params.currentYear || (await getConfig("currentYear")) || DEFAULT_CONFIG.currentYear;
  const config = { apiModel, apiKey, apiUrl, roadmap };

  // ===== 步骤 1: 学情反馈 =====
  stepResults.feedback = { status: "running" };
  await updateStepResults(taskId, stepResults, 1);

  try {
    const lessonDate = params.lessonDate ? addWeekdayToDate(params.lessonDate.includes('年') ? params.lessonDate : `${currentYear}年${params.lessonDate}`) : "";
    const feedbackInput: FeedbackInput = {
      studentName: params.studentName,
      lessonNumber: params.lessonNumber || "",
      lessonDate,
      nextLessonDate: "",
      lastFeedback: params.lastFeedback || "",
      currentNotes: params.currentNotes,
      transcript: params.transcript,
      isFirstLesson: params.isFirstLesson ?? false,
      specialRequirements: params.specialRequirements || "",
    };

    feedbackContent = await generateFeedbackContent(feedbackInput, config);
    if (!feedbackContent || !feedbackContent.trim()) {
      throw new Error("AI 返回内容为空");
    }

    // 提取日期
    dateStr = params.lessonDate || "";
    if (!dateStr) {
      const dateMatch = feedbackContent.match(/(\d{1,2}月\d{1,2}日)/);
      dateStr = dateMatch ? dateMatch[1] : new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }).replace("/", "月") + "日";
    }

    // 上传
    const basePath = `${driveBasePath}/${params.studentName}`;
    const fileName = `${params.studentName}${params.lessonNumber || ""}.md`;
    const folderPath = `${basePath}/学情反馈`;
    const uploadResult = await uploadToGoogleDrive(feedbackContent, fileName, folderPath);

    stepResults.feedback = {
      status: "completed",
      fileName,
      url: uploadResult.url || "",
      path: uploadResult.path || "",
      folderUrl: uploadResult.folderUrl || "",
      chars: feedbackContent.length,
    };
    console.log(`[后台任务] ${taskId} 步骤1完成: ${fileName}`);
  } catch (err: any) {
    stepResults.feedback = { status: "failed", error: err?.message || String(err) };
    failedSteps++;
    console.error(`[后台任务] ${taskId} 步骤1失败:`, err);
  }
  await updateStepResults(taskId, stepResults, 1);

  // 如果步骤1失败，后续步骤无法执行
  if (!feedbackContent) {
    await updateTask(taskId, {
      status: "failed",
      stepResults: JSON.stringify(stepResults),
      errorMessage: "学情反馈生成失败，后续步骤无法执行",
      completedAt: new Date(),
    });
    return;
  }

  // ===== 步骤 2-5: 并行执行 =====
  stepResults.review = { status: "running" };
  stepResults.test = { status: "running" };
  stepResults.extraction = { status: "running" };
  stepResults.bubbleChart = { status: "running" };
  await updateStepResults(taskId, stepResults, 2);

  const parallelResults = await Promise.allSettled([
    // 步骤2: 复习文档
    (async () => {
      const reviewDocx = await generateReviewContent(feedbackContent, params.studentName, dateStr, config);
      if (!reviewDocx || reviewDocx.length === 0) throw new Error("复习文档生成为空");
      const basePath = `${driveBasePath}/${params.studentName}`;
      const fileName = `${params.studentName}${params.lessonNumber || ""}复习文档.docx`;
      const folderPath = `${basePath}/复习文档`;
      const uploadResult = await uploadBinaryToGoogleDrive(reviewDocx, fileName, folderPath);
      return { step: "review" as const, fileName, uploadResult, chars: reviewDocx.length };
    })(),

    // 步骤3: 测试本
    (async () => {
      const testDocx = await generateTestContent(feedbackContent, params.studentName, dateStr, config);
      if (!testDocx || testDocx.length === 0) throw new Error("测试本生成为空");
      const basePath = `${driveBasePath}/${params.studentName}`;
      const fileName = `${params.studentName}${params.lessonNumber || ""}测试文档.docx`;
      const folderPath = `${basePath}/复习文档`;
      const uploadResult = await uploadBinaryToGoogleDrive(testDocx, fileName, folderPath);
      return { step: "test" as const, fileName, uploadResult, chars: testDocx.length };
    })(),

    // 步骤4: 课后信息提取
    (async () => {
      const extractionContent = await generateExtractionContent(params.studentName, "", feedbackContent, config);
      if (!extractionContent || !extractionContent.trim()) throw new Error("课后信息提取生成为空");
      const basePath = `${driveBasePath}/${params.studentName}`;
      const fileName = `${params.studentName}${params.lessonNumber || ""}课后信息提取.md`;
      const folderPath = `${basePath}/课后信息`;
      const uploadResult = await uploadToGoogleDrive(extractionContent, fileName, folderPath);
      return { step: "extraction" as const, fileName, uploadResult, chars: extractionContent.length };
    })(),

    // 步骤5: 气泡图
    (async () => {
      const pngBuffer = await generateBubbleChart(feedbackContent, params.studentName, dateStr, params.lessonNumber || "", config);
      if (!pngBuffer || pngBuffer.length === 0) throw new Error("气泡图生成为空");
      const basePath = `${driveBasePath}/${params.studentName}`;
      const fileName = `${params.studentName}${params.lessonNumber || ""}气泡图.png`;
      const folderPath = `${basePath}/气泡图`;
      const uploadResult = await uploadBinaryToGoogleDrive(pngBuffer, fileName, folderPath);
      return { step: "bubbleChart" as const, fileName, uploadResult, chars: pngBuffer.length };
    })(),
  ]);

  // 处理并行结果
  let completedSteps = 1; // 步骤1已完成
  for (const result of parallelResults) {
    if (result.status === "fulfilled") {
      const { step, fileName, uploadResult, chars } = result.value;
      stepResults[step] = {
        status: "completed",
        fileName,
        url: uploadResult.url || "",
        path: uploadResult.path || "",
        folderUrl: uploadResult.folderUrl || "",
        chars,
      };
      completedSteps++;
      console.log(`[后台任务] ${taskId} ${step} 完成: ${fileName}`);
    } else {
      const errMsg = result.reason?.message || String(result.reason);
      // 判断是哪个步骤失败
      const stepName = errMsg.includes("复习") ? "review" :
                       errMsg.includes("测试") ? "test" :
                       errMsg.includes("信息") ? "extraction" : "bubbleChart";
      // 因为 Promise.allSettled 不保证顺序映射到步骤名，用索引
      failedSteps++;
    }
  }

  // 用索引映射来更准确地设置失败步骤
  const stepNames: ("review" | "test" | "extraction" | "bubbleChart")[] = ["review", "test", "extraction", "bubbleChart"];
  for (let i = 0; i < parallelResults.length; i++) {
    const result = parallelResults[i];
    if (result.status === "rejected") {
      stepResults[stepNames[i]] = {
        status: "failed",
        error: result.reason?.message || String(result.reason),
      };
      console.error(`[后台任务] ${taskId} ${stepNames[i]} 失败:`, result.reason);
    }
  }

  // 确定最终状态
  const allCompleted = failedSteps === 0;
  const finalStatus = allCompleted ? "completed" : completedSteps > 1 ? "partial" : "failed";

  await updateTask(taskId, {
    status: finalStatus,
    currentStep: 5,
    stepResults: JSON.stringify(stepResults),
    errorMessage: allCompleted ? null : `${failedSteps} 个步骤失败`,
    completedAt: new Date(),
  });

  console.log(`[后台任务] ${taskId} 完成，状态: ${finalStatus} (${completedSteps}/5 成功)`);
}

/**
 * 小班课任务
 */
async function runClassTask(taskId: string, params: ClassTaskParams) {
  const stepResults: StepResults = {};
  let feedbackContent = "";
  let dateStr = "";
  let failedSteps = 0;

  // 获取配置
  const apiModel = params.apiModel || (await getConfig("apiModel")) || DEFAULT_CONFIG.apiModel;
  const apiKey = params.apiKey || (await getConfig("apiKey")) || DEFAULT_CONFIG.apiKey;
  const apiUrl = params.apiUrl || (await getConfig("apiUrl")) || DEFAULT_CONFIG.apiUrl;
  const roadmapClass = params.roadmapClass !== undefined ? params.roadmapClass : ((await getConfig("roadmapClass")) || "");
  // 小班课优先使用 classStoragePath（与 uploadClassFile 保持一致）
  const classStoragePath = params.classStoragePath || (await getConfig("classStoragePath"));
  const driveBasePath = classStoragePath || params.driveBasePath || (await getConfig("driveBasePath")) || DEFAULT_CONFIG.driveBasePath;
  const currentYear = params.currentYear || (await getConfig("currentYear")) || DEFAULT_CONFIG.currentYear;
  const apiConfig = { apiModel, apiKey, apiUrl };

  const folderName = `${params.classNumber}班`;
  const basePath = `${driveBasePath}/${folderName}`;

  const classInput: ClassFeedbackInput = {
    classNumber: params.classNumber,
    lessonNumber: params.lessonNumber || "",
    lessonDate: params.lessonDate ? addWeekdayToDate(params.lessonDate.includes('年') ? params.lessonDate : `${currentYear}年${params.lessonDate}`) : "",
    nextLessonDate: "",
    attendanceStudents: params.attendanceStudents,
    lastFeedback: params.lastFeedback || "",
    currentNotes: params.currentNotes,
    transcript: params.transcript,
    specialRequirements: params.specialRequirements || "",
  };

  // ===== 步骤 1: 学情反馈 =====
  stepResults.feedback = { status: "running" };
  await updateStepResults(taskId, stepResults, 1);

  try {
    feedbackContent = await generateClassFeedbackContent(classInput, roadmapClass, apiConfig);
    if (!feedbackContent || !feedbackContent.trim()) throw new Error("AI 返回内容为空");

    dateStr = params.lessonDate || "";
    if (!dateStr) {
      const dateMatch = feedbackContent.match(/(\d{1,2}月\d{1,2}日)/);
      dateStr = dateMatch ? dateMatch[1] : new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }).replace("/", "月") + "日";
    }

    const fileName = `${folderName}${params.lessonNumber || ""}.md`;
    const folderPath = `${basePath}/学情反馈`;
    const uploadResult = await uploadToGoogleDrive(feedbackContent, fileName, folderPath);

    stepResults.feedback = {
      status: "completed",
      fileName,
      url: uploadResult.url || "",
      path: uploadResult.path || "",
      chars: feedbackContent.length,
    };
    console.log(`[后台任务] ${taskId} 班课步骤1完成: ${fileName}`);
  } catch (err: any) {
    stepResults.feedback = { status: "failed", error: err?.message || String(err) };
    failedSteps++;
    console.error(`[后台任务] ${taskId} 班课步骤1失败:`, err);
  }
  await updateStepResults(taskId, stepResults, 1);

  if (!feedbackContent) {
    await updateTask(taskId, {
      status: "failed",
      stepResults: JSON.stringify(stepResults),
      errorMessage: "学情反馈生成失败，后续步骤无法执行",
      completedAt: new Date(),
    });
    return;
  }

  // ===== 步骤 2-5: 并行执行 =====
  stepResults.review = { status: "running" };
  stepResults.test = { status: "running" };
  stepResults.extraction = { status: "running" };
  stepResults.bubbleChart = { status: "running" };
  await updateStepResults(taskId, stepResults, 2);

  const parallelResults = await Promise.allSettled([
    // 步骤2: 复习文档
    (async () => {
      const reviewDocx = await generateClassReviewContent(classInput, feedbackContent, roadmapClass, apiConfig);
      if (!reviewDocx || reviewDocx.length === 0) throw new Error("复习文档生成为空");
      const fileName = `${folderName}${params.lessonNumber || ""}复习文档.docx`;
      const folderPath = `${basePath}/复习文档`;
      const uploadResult = await uploadBinaryToGoogleDrive(reviewDocx, fileName, folderPath);
      return { fileName, uploadResult, chars: reviewDocx.length };
    })(),

    // 步骤3: 测试本
    (async () => {
      const testDocx = await generateClassTestContent(classInput, feedbackContent, roadmapClass, apiConfig);
      if (!testDocx || testDocx.length === 0) throw new Error("测试本生成为空");
      const fileName = `${folderName}${params.lessonNumber || ""}测试文档.docx`;
      const folderPath = `${basePath}/复习文档`;
      const uploadResult = await uploadBinaryToGoogleDrive(testDocx, fileName, folderPath);
      return { fileName, uploadResult, chars: testDocx.length };
    })(),

    // 步骤4: 课后信息提取
    (async () => {
      const extractionContent = await generateClassExtractionContent(classInput, feedbackContent, roadmapClass, apiConfig);
      if (!extractionContent || !extractionContent.trim()) throw new Error("课后信息提取为空");
      const fileName = `${folderName}${params.lessonNumber || ""}课后信息提取.md`;
      const folderPath = `${basePath}/课后信息`;
      const uploadResult = await uploadToGoogleDrive(extractionContent, fileName, folderPath);
      return { fileName, uploadResult, chars: extractionContent.length };
    })(),

    // 步骤5: 气泡图（每个学生一张）
    (async () => {
      const students = params.attendanceStudents.filter((s) => s.trim());
      let successCount = 0;
      for (const studentName of students) {
        try {
          const svgContent = await generateClassBubbleChartSVG(
            feedbackContent,
            studentName,
            params.classNumber,
            dateStr,
            params.lessonNumber || "",
            { ...apiConfig, roadmapClass }
          );
          // SVG → PNG
          const sharp = (await import("sharp")).default;
          const pngBuffer = await sharp(Buffer.from(svgContent)).png().toBuffer();
          const fileName = `${studentName}${params.lessonNumber || ""}气泡图.png`;
          const folderPath = `${basePath}/气泡图`;
          await uploadBinaryToGoogleDrive(pngBuffer, fileName, folderPath);
          successCount++;
        } catch (err: any) {
          console.error(`[后台任务] ${taskId} 气泡图 ${studentName} 失败:`, err?.message || err);
        }
      }
      if (successCount === 0 && students.length > 0) {
        throw new Error(`全部${students.length}个学生气泡图生成失败`);
      }
      return { fileName: `气泡图(${successCount}/${students.length}成功)`, uploadResult: { url: "", path: "" }, chars: successCount };
    })(),
  ]);

  // 处理并行结果
  let completedSteps = 1;
  const stepNames: ("review" | "test" | "extraction" | "bubbleChart")[] = ["review", "test", "extraction", "bubbleChart"];
  for (let i = 0; i < parallelResults.length; i++) {
    const result = parallelResults[i];
    if (result.status === "fulfilled") {
      const { fileName, uploadResult, chars } = result.value;
      stepResults[stepNames[i]] = {
        status: "completed",
        fileName,
        url: uploadResult.url || "",
        path: uploadResult.path || "",
        chars,
      };
      completedSteps++;
    } else {
      stepResults[stepNames[i]] = {
        status: "failed",
        error: result.reason?.message || String(result.reason),
      };
      failedSteps++;
    }
  }

  const allCompleted = failedSteps === 0;
  const finalStatus = allCompleted ? "completed" : completedSteps > 1 ? "partial" : "failed";

  await updateTask(taskId, {
    status: finalStatus,
    currentStep: 5,
    stepResults: JSON.stringify(stepResults),
    errorMessage: allCompleted ? null : `${failedSteps} 个步骤失败`,
    completedAt: new Date(),
  });

  console.log(`[后台任务] ${taskId} 班课完成，状态: ${finalStatus} (${completedSteps}/5 成功)`);
}

/**
 * 清理3天以上的旧任务 + 超时自愈（运行超过30分钟的任务标记为失败）
 */
export async function cleanupOldTasks(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // 1. 清理3天前的旧任务
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const result = await db.delete(backgroundTasks).where(lt(backgroundTasks.createdAt, threeDaysAgo));
  const count = (result as any)?.[0]?.affectedRows || 0;
  if (count > 0) {
    console.log(`[后台任务] 清理了 ${count} 条3天前的旧任务`);
  }

  // 2. 超时自愈：运行超过30分钟的任务标记为失败（防止卡死在running状态）
  try {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const staleResult = await db.update(backgroundTasks)
      .set({
        status: "failed",
        errorMessage: "任务超时（超过30分钟未完成）",
        completedAt: new Date(),
      })
      .where(and(
        eq(backgroundTasks.status, "running"),
        lt(backgroundTasks.createdAt, thirtyMinAgo)
      ));
    const staleCount = (staleResult as any)?.[0]?.affectedRows || 0;
    if (staleCount > 0) {
      console.log(`[后台任务] 超时自愈：标记 ${staleCount} 个卡死任务为失败`);
    }
  } catch (err: any) {
    console.error("[后台任务] 超时自愈失败:", err?.message || err);
  }

  return count;
}

/**
 * 确保 background_tasks 表存在（自动建表）
 */
async function ensureTable(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS \`background_tasks\` (
      \`id\` varchar(36) NOT NULL,
      \`course_type\` varchar(20) NOT NULL,
      \`display_name\` varchar(200) NOT NULL,
      \`status\` varchar(20) NOT NULL DEFAULT 'pending',
      \`current_step\` int NOT NULL DEFAULT 0,
      \`total_steps\` int NOT NULL DEFAULT 5,
      \`input_params\` mediumtext NOT NULL,
      \`step_results\` mediumtext,
      \`error_message\` text,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`completed_at\` timestamp NULL,
      PRIMARY KEY (\`id\`)
    )`);
    // 兼容旧表：如果表已存在且 input_params/step_results 还是 text，升级为 mediumtext
    try {
      await db.execute(sql`ALTER TABLE \`background_tasks\` MODIFY COLUMN \`input_params\` mediumtext NOT NULL`);
      await db.execute(sql`ALTER TABLE \`background_tasks\` MODIFY COLUMN \`step_results\` mediumtext`);
    } catch { /* 已经是 mediumtext 则忽略 */ }
    console.log("[后台任务] 表已就绪");
  } catch (err: any) {
    console.error("[后台任务] 建表失败:", err?.message || err);
  }
}

/**
 * 恢复中断的任务（服务器重启后）
 * 将 running 状态的任务标记为 failed
 */
export async function recoverInterruptedTasks(): Promise<void> {
  // 确保表存在
  await ensureTable();

  const db = await getDb();
  if (!db) return;

  try {
    // 恢复 running 状态的任务
    const result = await db.update(backgroundTasks)
      .set({
        status: "failed",
        errorMessage: "服务器重启，任务被中断",
        completedAt: new Date(),
      })
      .where(eq(backgroundTasks.status, "running"));

    // 也恢复 pending 状态的任务（已创建但未开始执行就重启了）
    const result2 = await db.update(backgroundTasks)
      .set({
        status: "failed",
        errorMessage: "服务器重启，任务未能启动",
        completedAt: new Date(),
      })
      .where(eq(backgroundTasks.status, "pending"));

    const count = (result as any)?.[0]?.affectedRows || 0;
    const count2 = (result2 as any)?.[0]?.affectedRows || 0;
    if (count + count2 > 0) {
      console.log(`[后台任务] 恢复了 ${count} 个中断的任务, ${count2} 个未启动的任务`);
    }
  } catch (err: any) {
    console.error("[后台任务] 恢复中断任务失败:", err?.message || err);
  }
}
