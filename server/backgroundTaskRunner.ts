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
  svgToPng,
  getResvgFontConfig,
  injectChineseFontIntoSVG,
  GenerationMeta,
} from "./feedbackGenerator";
import { addWeekdayToDate } from "./utils";
import {
  uploadToGoogleDrive,
  uploadBinaryToGoogleDrive,
  UploadStatus,
} from "./gdrive";
import {
  createLogSession,
  startStep,
  stepSuccess,
  stepFailed,
  endLogSession,
  logInfo,
  logError,
} from "./logger";
import { parseError } from "./errorHandler";

/** 上传后检查结果，失败则抛出错误（uploadToGoogleDrive 失败时返回 status:'error' 而不是 throw） */
function assertUploadSuccess(result: UploadStatus, context: string): void {
  if (result.status === 'error') {
    throw new Error(`${context}上传失败: ${result.error || '未知错误'}`);
  }
}

/** 并发任务控制：防止同时运行过多任务打爆 AI API 限速 */
const MAX_CONCURRENT_TASKS = 3;
let _runningTaskCount = 0;

/** 任务取消信号：taskId → AbortController */
const _cancelSignals = new Map<string, AbortController>();

/** 请求取消任务（外部调用） */
export function cancelBackgroundTask(taskId: string): boolean {
  const controller = _cancelSignals.get(taskId);
  if (controller) {
    console.log(`[后台任务] ${taskId} 收到取消请求`);
    controller.abort();
    return true;
  }
  return false;
}

type RetryableStep = "review" | "test" | "extraction" | "bubbleChart";

/**
 * 重试单个失败步骤（不重新生成学情反馈）
 * 依赖已完成的步骤1（feedbackContent 从 stepResults.feedback.content 读取）
 */
export async function retryTaskStep(taskId: string, stepName: RetryableStep, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const tasks = await db.select().from(backgroundTasks).where(eq(backgroundTasks.id, taskId)).limit(1);
  if (tasks.length === 0) throw new Error("任务不存在");
  const task = tasks[0];
  if (task.userId !== userId) throw new Error("无权操作此任务");

  let params: TaskParams;
  try { params = JSON.parse(task.inputParams); } catch { throw new Error("任务参数损坏"); }

  let stepResults: StepResults;
  try { stepResults = task.stepResults ? JSON.parse(task.stepResults) : {}; } catch { stepResults = {}; }

  // 步骤1必须已完成，否则无法重试后续步骤
  const feedbackContent = stepResults.feedback?.content;
  if (!feedbackContent) throw new Error("学情反馈未完成，无法重试后续步骤");

  // 要重试的步骤必须是失败状态
  const currentStatus = stepResults[stepName]?.status;
  if (currentStatus !== "failed" && currentStatus !== "truncated") {
    throw new Error(`步骤"${stepName}"当前状态为"${currentStatus}"，无需重试`);
  }

  // 提取日期
  const currentYear = params.currentYear || DEFAULT_CONFIG.currentYear;
  const dateStr = params.lessonDate || (() => {
    const dateMatch = feedbackContent.match(/(\d{1,2}月\d{1,2}日)/);
    return dateMatch ? dateMatch[1] : new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }).replace("/", "月") + "日";
  })();

  // 解析配置（使用当前配置）
  const apiModel = await getConfig("apiModel", userId) || DEFAULT_CONFIG.apiModel;
  const apiKey = params.apiKey || (await getConfig("apiKey", userId)) || DEFAULT_CONFIG.apiKey;
  const apiUrl = params.apiUrl || (await getConfig("apiUrl", userId)) || DEFAULT_CONFIG.apiUrl;

  // 标记步骤为重试中
  stepResults[stepName] = { status: "running" };
  await updateStepResults(taskId, stepResults);
  await updateTask(taskId, { status: "running" });

  console.log(`[后台任务] ${taskId} 重试步骤: ${stepName}`);

  try {
    if (params.courseType === "one-to-one") {
      const roadmap = params.roadmap !== undefined ? params.roadmap : ((await getConfig("roadmap", userId)) || DEFAULT_CONFIG.roadmap);
      const driveBasePath = params.driveBasePath || (await getConfig("driveBasePath", userId)) || DEFAULT_CONFIG.driveBasePath;
      const config = { apiModel, apiKey, apiUrl, roadmap };
      const lessonDate = params.lessonDate ? addWeekdayToDate(params.lessonDate.includes('年') ? params.lessonDate : `${currentYear}年${params.lessonDate}`) : "";
      const feedbackInput: FeedbackInput = {
        studentName: params.studentName, lessonNumber: params.lessonNumber || "", lessonDate,
        nextLessonDate: "", lastFeedback: params.lastFeedback || "", currentNotes: params.currentNotes,
        transcript: params.transcript, isFirstLesson: params.isFirstLesson ?? false,
        specialRequirements: params.specialRequirements || "",
      };
      const basePath = `${driveBasePath}/${params.studentName}`;

      const result = await runSingleStep(stepName, {
        taskId, stepResults, feedbackContent, dateStr, config, feedbackInput, basePath,
        studentName: params.studentName, lessonNumber: params.lessonNumber || "", userId,
        courseType: "one-to-one",
      });
      stepResults[stepName] = result;

    } else {
      // 小班课
      const roadmapClass = params.roadmapClass !== undefined ? params.roadmapClass : ((await getConfig("roadmapClass", userId)) || "");
      const classStoragePath = params.classStoragePath || (await getConfig("classStoragePath", userId));
      const driveBasePath = classStoragePath || params.driveBasePath || (await getConfig("driveBasePath", userId)) || DEFAULT_CONFIG.driveBasePath;
      const apiConfig = { apiModel, apiKey, apiUrl };
      const folderName = `${params.classNumber}班`;
      const basePath = `${driveBasePath}/${folderName}`;
      const classInput: ClassFeedbackInput = {
        classNumber: params.classNumber, lessonNumber: params.lessonNumber || "",
        lessonDate: params.lessonDate ? addWeekdayToDate(params.lessonDate.includes('年') ? params.lessonDate : `${currentYear}年${params.lessonDate}`) : "",
        nextLessonDate: "", attendanceStudents: params.attendanceStudents, lastFeedback: params.lastFeedback || "",
        currentNotes: params.currentNotes, transcript: params.transcript, specialRequirements: params.specialRequirements || "",
      };

      const result = await runSingleStep(stepName, {
        taskId, stepResults, feedbackContent, dateStr, config: apiConfig, basePath,
        studentName: folderName, lessonNumber: params.lessonNumber || "", userId,
        courseType: "class", classInput, roadmapClass, attendanceStudents: params.attendanceStudents,
        classNumber: params.classNumber,
      });
      stepResults[stepName] = result;
    }

    console.log(`[后台任务] ${taskId} 步骤 ${stepName} 重试成功`);
  } catch (err: any) {
    stepResults[stepName] = { status: "failed", error: err?.message || String(err) };
    console.error(`[后台任务] ${taskId} 步骤 ${stepName} 重试失败:`, err?.message || err);
  }

  // 重新计算最终状态
  const stepNames: (keyof StepResults)[] = ["feedback", "review", "test", "extraction", "bubbleChart"];
  const failCount = stepNames.filter(s => stepResults[s]?.status === "failed" || stepResults[s]?.status === "truncated").length;
  const completedCount = stepNames.filter(s => stepResults[s]?.status === "completed").length;
  const finalStatus = failCount === 0 ? "completed" : completedCount > 0 ? "partial" : "failed";

  await updateTask(taskId, {
    status: finalStatus,
    stepResults: JSON.stringify(stepResults),
    errorMessage: failCount > 0 ? `${failCount} 个步骤失败` : null,
  });
}

/** 执行单个步骤并返回 StepResult */
async function runSingleStep(
  stepName: RetryableStep,
  ctx: {
    taskId: string; stepResults: StepResults; feedbackContent: string; dateStr: string;
    config: any; basePath: string; studentName: string; lessonNumber: string; userId: number;
    courseType: "one-to-one" | "class";
    feedbackInput?: FeedbackInput; classInput?: ClassFeedbackInput;
    roadmapClass?: string; attendanceStudents?: string[]; classNumber?: string;
  },
): Promise<StepResult> {
  const t = Date.now();
  const { taskId, stepResults, feedbackContent, dateStr, config, basePath, userId } = ctx;

  const makeOnChunk = () => {
    let chars = 0, lastUpdate = 0;
    return (chunk: string) => {
      chars += chunk.length;
      const now = Date.now();
      if (now - lastUpdate >= 1000) {
        stepResults[stepName] = { ...stepResults[stepName]!, status: "running", chars };
        updateStepResults(taskId, stepResults).catch(() => {});
        lastUpdate = now;
      }
    };
  };

  if (stepName === "review") {
    const onChunk = makeOnChunk();
    const reviewResult = ctx.courseType === "one-to-one"
      ? await generateReviewContent('oneToOne', ctx.feedbackInput!, feedbackContent, dateStr, config, onChunk)
      : await generateClassReviewContent(ctx.classInput!, feedbackContent, ctx.roadmapClass || "", config, onChunk);
    if (!reviewResult.buffer || reviewResult.buffer.length === 0) throw new Error("复习文档生成为空");
    const fileName = `${ctx.studentName}${ctx.lessonNumber}复习文档.docx`;
    const folderPath = `${basePath}/复习文档`;
    const uploadResult = await uploadBinaryToGoogleDrive(userId, reviewResult.buffer, fileName, folderPath);
    assertUploadSuccess(uploadResult, "复习文档");
    return { status: "completed", fileName, url: uploadResult.url || "", path: uploadResult.path || "",
      ...(uploadResult.folderUrl ? { folderUrl: uploadResult.folderUrl } : {}),
      chars: reviewResult.textChars, duration: Math.round((Date.now() - t) / 1000) };
  }

  if (stepName === "test") {
    const onChunk = makeOnChunk();
    const testResult = ctx.courseType === "one-to-one"
      ? await generateTestContent('oneToOne', ctx.feedbackInput!, feedbackContent, dateStr, config, onChunk)
      : await generateClassTestContent(ctx.classInput!, feedbackContent, ctx.roadmapClass || "", config, onChunk);
    if (!testResult.buffer || testResult.buffer.length === 0) throw new Error("测试本生成为空");
    const fileName = `${ctx.studentName}${ctx.lessonNumber}测试文档.docx`;
    const folderPath = `${basePath}/复习文档`;
    const uploadResult = await uploadBinaryToGoogleDrive(userId, testResult.buffer, fileName, folderPath);
    assertUploadSuccess(uploadResult, "测试文档");
    return { status: "completed", fileName, url: uploadResult.url || "", path: uploadResult.path || "",
      ...(uploadResult.folderUrl ? { folderUrl: uploadResult.folderUrl } : {}),
      chars: testResult.textChars, duration: Math.round((Date.now() - t) / 1000) };
  }

  if (stepName === "extraction") {
    const onChunk = makeOnChunk();
    const extractionContent = ctx.courseType === "one-to-one"
      ? await generateExtractionContent('oneToOne', ctx.feedbackInput!, feedbackContent, config, onChunk)
      : await generateClassExtractionContent(ctx.classInput!, feedbackContent, ctx.roadmapClass || "", config, onChunk);
    if (!extractionContent || !extractionContent.trim()) throw new Error("课后信息提取生成为空");
    const fileName = `${ctx.studentName}${ctx.lessonNumber}课后信息提取.md`;
    const folderPath = `${basePath}/课后信息`;
    const uploadResult = await uploadToGoogleDrive(userId, extractionContent, fileName, folderPath);
    assertUploadSuccess(uploadResult, "课后信息提取");
    return { status: "completed", fileName, url: uploadResult.url || "", path: uploadResult.path || "",
      ...(uploadResult.folderUrl ? { folderUrl: uploadResult.folderUrl } : {}),
      chars: extractionContent.length, duration: Math.round((Date.now() - t) / 1000), content: extractionContent };
  }

  if (stepName === "bubbleChart") {
    if (ctx.courseType === "one-to-one") {
      // 一对一：单张气泡图
      const pngBuffer = await generateBubbleChart(feedbackContent, ctx.studentName, dateStr, ctx.lessonNumber, config);
      if (!pngBuffer || pngBuffer.length === 0) throw new Error("气泡图生成为空");
      const fileName = `${ctx.studentName}${ctx.lessonNumber}气泡图.png`;
      const folderPath = `${basePath}/气泡图`;
      const uploadResult = await uploadBinaryToGoogleDrive(userId, pngBuffer, fileName, folderPath);
      assertUploadSuccess(uploadResult, "气泡图");
      return { status: "completed", fileName, url: uploadResult.url || "", path: uploadResult.path || "",
        ...(uploadResult.folderUrl ? { folderUrl: uploadResult.folderUrl } : {}),
        chars: pngBuffer.length, duration: Math.round((Date.now() - t) / 1000) };
    } else {
      // 小班课：每个学生一张
      const students = (ctx.attendanceStudents || []).filter(s => s.trim());
      let successCount = 0;
      const perStudentFiles: { fileName: string; url: string; path: string }[] = [];
      for (const studentName of students) {
        try {
          const svgContent = await generateClassBubbleChartSVG(
            feedbackContent, studentName, ctx.classNumber!, dateStr, ctx.lessonNumber,
            { ...config, roadmapClass: ctx.roadmapClass },
          );
          const pngBuffer = await svgToPng(svgContent);
          const fileName = `${studentName}${ctx.lessonNumber}气泡图.png`;
          const folderPath = `${basePath}/气泡图`;
          const uploadResult = await uploadBinaryToGoogleDrive(userId, pngBuffer, fileName, folderPath);
          assertUploadSuccess(uploadResult, `气泡图(${studentName})`);
          perStudentFiles.push({ fileName, url: uploadResult.url || "", path: uploadResult.path || "" });
          successCount++;
        } catch (err: any) {
          console.error(`[后台任务] ${taskId} 重试气泡图 ${studentName} 失败:`, err?.message);
        }
      }
      if (successCount === 0 && students.length > 0) throw new Error(`全部${students.length}个学生气泡图重试失败`);
      const failedCount = students.length - successCount;
      if (failedCount > 0) throw new Error(`气泡图部分失败(${successCount}/${students.length}成功)`);
      return { status: "completed", fileName: `气泡图(${successCount}/${students.length}成功)`,
        url: "", path: "", chars: successCount, duration: Math.round((Date.now() - t) / 1000), files: perStudentFiles };
    }
  }

  throw new Error(`未知步骤: ${stepName}`);
}

/** 检查任务是否已被取消 */
function isCancelled(taskId: string): boolean {
  return _cancelSignals.get(taskId)?.signal.aborted ?? false;
}

/** 在关键步骤间检查取消，若已取消则更新DB并抛出 */
async function checkCancellation(taskId: string, stepResults: StepResults, currentStep: number): Promise<void> {
  if (isCancelled(taskId)) {
    await updateTask(taskId, {
      status: "cancelled",
      stepResults: JSON.stringify(stepResults),
      currentStep,
      errorMessage: "用户手动取消",
      completedAt: new Date(),
    });
    throw new Error(`任务 ${taskId} 已被用户取消`);
  }
}


// 步骤结果类型
interface StepResult {
  status: "pending" | "running" | "completed" | "truncated" | "failed";
  fileName?: string;
  url?: string;
  path?: string;
  folderUrl?: string;
  chars?: number;
  duration?: number; // 步骤耗时（秒）
  error?: string;
  content?: string; // 反馈全文（仅 feedback 步骤）
  rawContent?: string; // 原始AI输出（清洗前，用于诊断换行等问题）
  genInfo?: string;  // 生成诊断信息（模式、轮次、token用量）
  files?: { fileName: string; url: string; path: string }[]; // 多文件支持（班课气泡图等）
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
async function updateStepResults(taskId: string, stepResults: StepResults, currentStep?: number) {
  const updates: Record<string, any> = { stepResults: JSON.stringify(stepResults) };
  if (currentStep !== undefined) updates.currentStep = currentStep;
  await updateTask(taskId, updates);
}

/**
 * 启动后台任务（fire-and-forget）
 * 超过并发上限时立即标记失败，防止打爆 AI API
 */
export function startBackgroundTask(taskId: string) {
  if (_runningTaskCount >= MAX_CONCURRENT_TASKS) {
    console.warn(`[后台任务] ${taskId} 被拒绝：已有 ${_runningTaskCount} 个任务在运行（上限 ${MAX_CONCURRENT_TASKS}）`);
    updateTask(taskId, {
      status: "failed",
      errorMessage: `服务器繁忙，当前已有 ${_runningTaskCount} 个任务在运行（上限 ${MAX_CONCURRENT_TASKS}），请稍后重试`,
      completedAt: new Date(),
    }).catch(() => {});
    return;
  }

  _runningTaskCount++;
  _cancelSignals.set(taskId, new AbortController());
  console.log(`[后台任务] ${taskId} 开始（当前并发: ${_runningTaskCount}/${MAX_CONCURRENT_TASKS}）`);

  // 不 await，让它在后台运行
  runTask(taskId)
    .catch((err) => {
      // 用户取消不算异常
      if (isCancelled(taskId)) {
        console.log(`[后台任务] ${taskId} 已被用户取消`);
        return;
      }
      console.error(`[后台任务] ${taskId} 顶层异常:`, err);
      updateTask(taskId, {
        status: "failed",
        errorMessage: `顶层异常: ${err?.message || String(err)}`,
      }).catch(() => {});
    })
    .finally(() => {
      _cancelSignals.delete(taskId);
      _runningTaskCount--;
      console.log(`[后台任务] ${taskId} 结束（当前并发: ${_runningTaskCount}/${MAX_CONCURRENT_TASKS}）`);
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
  const userId = task.userId;
  let params: TaskParams;
  try {
    params = JSON.parse(task.inputParams);
  } catch (parseErr: any) {
    await updateTask(taskId, {
      status: "failed",
      errorMessage: `任务参数解析失败: ${parseErr?.message || '无效JSON'}`,
      completedAt: new Date(),
    });
    throw new Error(`任务 ${taskId} inputParams 解析失败: ${parseErr?.message}`);
  }

  // 在运行前先解析实际使用的模型，写入DB让前端立刻显示
  const resolvedModel = params.apiModel || (await getConfig("apiModel", userId)) || DEFAULT_CONFIG.apiModel;

  // 更新状态为运行中，同时写入模型
  await updateTask(taskId, { status: "running", currentStep: 0, model: resolvedModel });

  if (params.courseType === "one-to-one") {
    await runOneToOneTask(taskId, params, userId);
  } else {
    await runClassTask(taskId, params, userId);
  }
}

/**
 * 一对一任务
 */
async function runOneToOneTask(taskId: string, params: OneToOneTaskParams, userId: number) {
  const stepResults: StepResults = {};
  let feedbackContent = "";
  let dateStr = "";
  let failedSteps = 0;
  let feedbackInput: FeedbackInput | null = null;

  // 获取配置
  const apiModel = params.apiModel || (await getConfig("apiModel", userId)) || DEFAULT_CONFIG.apiModel;
  const apiKey = params.apiKey || (await getConfig("apiKey", userId)) || DEFAULT_CONFIG.apiKey;
  const apiUrl = params.apiUrl || (await getConfig("apiUrl", userId)) || DEFAULT_CONFIG.apiUrl;
  const roadmap = params.roadmap !== undefined ? params.roadmap : ((await getConfig("roadmap", userId)) || DEFAULT_CONFIG.roadmap);
  const driveBasePath = params.driveBasePath || (await getConfig("driveBasePath", userId)) || DEFAULT_CONFIG.driveBasePath;
  const currentYear = params.currentYear || (await getConfig("currentYear", userId)) || DEFAULT_CONFIG.currentYear;
  const config = { apiModel, apiKey, apiUrl, roadmap };
  const taskStartTime = Date.now();

  // 创建日志会话（按用户隔离）
  const log = createLogSession(
    params.studentName,
    { apiUrl, apiModel, maxTokens: 64000 },
    {
      notesLength: params.currentNotes?.length || 0,
      transcriptLength: params.transcript?.length || 0,
      lastFeedbackLength: params.lastFeedback?.length || 0,
    },
    params.lessonNumber,
    params.lessonDate,
    userId
  );
  logInfo(log, 'task', `后台任务 ${taskId}`);

  // ===== 步骤 1: 学情反馈 =====
  const step1Start = Date.now();
  stepResults.feedback = { status: "running" };
  await updateStepResults(taskId, stepResults, 1);
  startStep(log, 'feedback');

  try {
    const lessonDate = params.lessonDate ? addWeekdayToDate(params.lessonDate.includes('年') ? params.lessonDate : `${currentYear}年${params.lessonDate}`) : "";
    feedbackInput = {
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

    const feedbackResult = await generateFeedbackContent('oneToOne', feedbackInput, config, (chars) => {
      // 实时更新字符数到 DB（前端通过轮询获取）
      stepResults.feedback = { ...stepResults.feedback!, status: "running", chars };
      updateStepResults(taskId, stepResults, 1);
    });
    feedbackContent = feedbackResult.content;
    const feedbackMeta = feedbackResult.meta;
    const feedbackRawContent = feedbackResult.rawContent;
    if (!feedbackContent || !feedbackContent.trim()) {
      throw new Error("AI 返回内容为空");
    }
    // 记录原始AI输出长度差异，辅助排查换行等问题
    if (feedbackRawContent && feedbackRawContent.length !== feedbackContent.length) {
      console.log(`[后台任务] ${taskId} 原始AI输出${feedbackRawContent.length}字符 → 清洗后${feedbackContent.length}字符（差${feedbackRawContent.length - feedbackContent.length}字符）`);
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
    const uploadResult = await uploadToGoogleDrive(userId, feedbackContent, fileName, folderPath);
    assertUploadSuccess(uploadResult, "学情反馈");

    const step1Duration = Math.round((Date.now() - step1Start) / 1000);
    const isTruncated = feedbackMeta.finishReason === 'length' || feedbackMeta.finishReason === 'max_tokens';
    stepResults.feedback = {
      status: isTruncated ? "truncated" : "completed",
      fileName,
      url: uploadResult.url || "",
      path: uploadResult.path || "",
      folderUrl: uploadResult.folderUrl || "",
      chars: feedbackContent.length,
      duration: step1Duration,
      content: feedbackContent,
      rawContent: feedbackRawContent,  // 原始AI输出（清洗前），用于诊断换行等问题
      // 生成诊断信息：模式、轮次、token用量
      genInfo: feedbackMeta.totalPromptTokens > 0
        ? `${feedbackMeta.mode} · ${feedbackMeta.rounds}轮 · 输入${feedbackMeta.totalPromptTokens}t/输出${feedbackMeta.totalCompletionTokens}t · ${feedbackMeta.finishReason}`
        : `${feedbackMeta.mode} · ${feedbackMeta.rounds}轮 · ${feedbackContent.length}字 · ${feedbackMeta.finishReason}`,
      ...(isTruncated ? { error: `续写${feedbackMeta.rounds}轮后仍被截断（输出${feedbackMeta.totalCompletionTokens}token）` } : {}),
    };
    if (isTruncated) {
      failedSteps++;
      console.warn(`[后台任务] ${taskId} 步骤1截断: ${fileName} (${step1Duration}秒, ${feedbackContent.length}字) ⚠️ 内容不完整`);
    } else {
      stepSuccess(log, 'feedback', feedbackContent.length);
      console.log(`[后台任务] ${taskId} 步骤1完成: ${fileName} (${step1Duration}秒, ${feedbackContent.length}字, ${feedbackMeta.mode} ${feedbackMeta.rounds}轮)`);
    }
  } catch (err: any) {
    stepResults.feedback = { status: "failed", error: err?.message || String(err) };
    failedSteps++;
    stepFailed(log, 'feedback', parseError(err, 'feedback'));
    console.error(`[后台任务] ${taskId} 步骤1失败:`, err);
  }
  await updateStepResults(taskId, stepResults, 1);

  // 如果步骤1失败，后续步骤无法执行
  if (!feedbackContent) {
    endLogSession(log);
    await updateTask(taskId, {
      status: "failed",
      stepResults: JSON.stringify(stepResults),
      errorMessage: "学情反馈生成失败，后续步骤无法执行",
      completedAt: new Date(),
    });
    return;
  }

  // 取消检查点：步骤1完成后、步骤2-5开始前
  await checkCancellation(taskId, stepResults, 1);

  // ===== 步骤 2-5: 并行执行（每步完成立即更新DB，前端实时看到进度） =====
  let completedSteps = 1; // 步骤1已完成
  stepResults.review = { status: "running" };
  stepResults.test = { status: "running" };
  stepResults.extraction = { status: "running" };
  stepResults.bubbleChart = { status: "running" };
  await updateStepResults(taskId, stepResults, 2);

  // 每个步骤完成/失败后立即写DB，前端轮询即可看到最新进度（而非等全部完成才更新）
  const markDone = (name: "review" | "test" | "extraction" | "bubbleChart", r: any) => {
    const { fileName, uploadResult, chars, duration, content, files } = r;
    stepResults[name] = {
      status: "completed", fileName, url: uploadResult?.url || "", path: uploadResult?.path || "",
      ...(uploadResult?.folderUrl ? { folderUrl: uploadResult.folderUrl } : {}),
      chars, duration, ...(content ? { content } : {}), ...(files ? { files } : {}),
    };
    completedSteps++;
    console.log(`[后台任务] ${taskId} ${name} 完成: ${fileName} (${duration}秒) [${completedSteps}/5]`);
    updateStepResults(taskId, stepResults, completedSteps).catch(() => {});
  };
  const markFailed = (name: "review" | "test" | "extraction" | "bubbleChart", err: any) => {
    stepResults[name] = { status: "failed", error: err?.message || String(err) };
    failedSteps++;
    console.error(`[后台任务] ${taskId} ${name} 失败:`, err?.message || err);
    updateStepResults(taskId, stepResults, completedSteps).catch(() => {});
  };

  await Promise.allSettled([
    // 步骤2: 复习文档
    (async () => {
      const t = Date.now();
      let reviewChars = 0;
      let reviewLastUpdate = 0;
      const reviewResult = await generateReviewContent('oneToOne', feedbackInput!, feedbackContent, dateStr, config, (chunk) => {
        reviewChars += chunk.length;
        const now = Date.now();
        if (now - reviewLastUpdate >= 1000) {
          stepResults.review = { ...stepResults.review!, status: "running", chars: reviewChars };
          updateStepResults(taskId, stepResults, completedSteps).catch(() => {});
          reviewLastUpdate = now;
        }
      });
      if (!reviewResult.buffer || reviewResult.buffer.length === 0) throw new Error("复习文档生成为空");
      const basePath = `${driveBasePath}/${params.studentName}`;
      const fileName = `${params.studentName}${params.lessonNumber || ""}复习文档.docx`;
      const folderPath = `${basePath}/复习文档`;
      const uploadResult = await uploadBinaryToGoogleDrive(userId, reviewResult.buffer, fileName, folderPath);
      assertUploadSuccess(uploadResult, "复习文档");
      return { step: "review" as const, fileName, uploadResult, chars: reviewResult.textChars, duration: Math.round((Date.now() - t) / 1000) };
    })().then(r => { markDone("review", r); }, e => { markFailed("review", e); }),

    // 步骤3: 测试本
    (async () => {
      const t = Date.now();
      let testChars = 0;
      let testLastUpdate = 0;
      const testResult = await generateTestContent('oneToOne', feedbackInput!, feedbackContent, dateStr, config, (chunk) => {
        testChars += chunk.length;
        const now = Date.now();
        if (now - testLastUpdate >= 1000) {
          stepResults.test = { ...stepResults.test!, status: "running", chars: testChars };
          updateStepResults(taskId, stepResults, completedSteps).catch(() => {});
          testLastUpdate = now;
        }
      });
      if (!testResult.buffer || testResult.buffer.length === 0) throw new Error("测试本生成为空");
      const basePath = `${driveBasePath}/${params.studentName}`;
      const fileName = `${params.studentName}${params.lessonNumber || ""}测试文档.docx`;
      const folderPath = `${basePath}/复习文档`;
      const uploadResult = await uploadBinaryToGoogleDrive(userId, testResult.buffer, fileName, folderPath);
      assertUploadSuccess(uploadResult, "测试文档");
      return { step: "test" as const, fileName, uploadResult, chars: testResult.textChars, duration: Math.round((Date.now() - t) / 1000) };
    })().then(r => { markDone("test", r); }, e => { markFailed("test", e); }),

    // 步骤4: 课后信息提取
    (async () => {
      const t = Date.now();
      let extractChars = 0;
      let extractLastUpdate = 0;
      const extractionContent = await generateExtractionContent('oneToOne', feedbackInput!, feedbackContent, config, (chunk) => {
        extractChars += chunk.length;
        const now = Date.now();
        if (now - extractLastUpdate >= 1000) {
          stepResults.extraction = { ...stepResults.extraction!, status: "running", chars: extractChars };
          updateStepResults(taskId, stepResults, completedSteps).catch(() => {});
          extractLastUpdate = now;
        }
      });
      if (!extractionContent || !extractionContent.trim()) throw new Error("课后信息提取生成为空");
      const basePath = `${driveBasePath}/${params.studentName}`;
      const fileName = `${params.studentName}${params.lessonNumber || ""}课后信息提取.md`;
      const folderPath = `${basePath}/课后信息`;
      const uploadResult = await uploadToGoogleDrive(userId, extractionContent, fileName, folderPath);
      assertUploadSuccess(uploadResult, "课后信息提取");
      return { step: "extraction" as const, fileName, uploadResult, chars: extractionContent.length, duration: Math.round((Date.now() - t) / 1000), content: extractionContent };
    })().then(r => { markDone("extraction", r); }, e => { markFailed("extraction", e); }),

    // 步骤5: 气泡图
    (async () => {
      const t = Date.now();
      const pngBuffer = await generateBubbleChart(feedbackContent, params.studentName, dateStr, params.lessonNumber || "", config);
      if (!pngBuffer || pngBuffer.length === 0) throw new Error("气泡图生成为空");
      const basePath = `${driveBasePath}/${params.studentName}`;
      const fileName = `${params.studentName}${params.lessonNumber || ""}气泡图.png`;
      const folderPath = `${basePath}/气泡图`;
      const uploadResult = await uploadBinaryToGoogleDrive(userId, pngBuffer, fileName, folderPath);
      assertUploadSuccess(uploadResult, "气泡图");
      return { step: "bubbleChart" as const, fileName, uploadResult, chars: pngBuffer.length, duration: Math.round((Date.now() - t) / 1000) };
    })().then(r => { markDone("bubbleChart", r); }, e => { markFailed("bubbleChart", e); }),
  ]);

  // 并行步骤已在各自的 .then() 中即时更新了 stepResults 和 completedSteps

  // 确定最终状态
  const allCompleted = failedSteps === 0;
  const finalStatus = allCompleted ? "completed" : completedSteps > 1 ? "partial" : "failed";

  endLogSession(log);

  // 上传生成日志到课后信息文件夹
  const totalDuration = Math.round((Date.now() - taskStartTime) / 1000);
  try {
    const logLines: string[] = [
      `=== 生成日志 ===`,
      `学生: ${params.studentName}`,
      `课次: ${params.lessonNumber || "未指定"}`,
      `日期: ${params.lessonDate || "未指定"}`,
      `模型: ${config.apiModel}`,
      `状态: ${finalStatus} (${completedSteps}/5 步骤成功)`,
      `总耗时: ${totalDuration}秒`,
      ``,
      `--- 各步骤详情 ---`,
    ];
    const stepLabels: Record<string, string> = { feedback: "反馈", review: "复习", test: "测试", extraction: "提取", bubbleChart: "气泡图" };
    for (const [key, label] of Object.entries(stepLabels)) {
      const sr = stepResults[key as keyof StepResults];
      if (!sr) continue;
      if (sr.status === "completed" || sr.status === "truncated") {
        const charInfo = sr.chars ? `${sr.chars}字` : "";
        const durInfo = sr.duration != null ? `${sr.duration}秒` : "";
        const fileInfo = sr.fileName || "";
        logLines.push(`${label}: ${sr.status === "truncated" ? "截断" : "完成"} ${[durInfo, charInfo, fileInfo].filter(Boolean).join(" · ")}`);
      } else if (sr.status === "failed") {
        logLines.push(`${label}: 失败 - ${sr.error || "未知错误"}`);
      } else {
        logLines.push(`${label}: ${sr.status}`);
      }
    }
    if (stepResults.feedback?.genInfo) {
      logLines.push(``, `--- 反馈生成信息 ---`, stepResults.feedback.genInfo);
    }
    const logContent = logLines.join("\n");
    const logFileName = `${params.studentName}${params.lessonNumber || ""}生成日志.txt`;
    const logFolderPath = `${driveBasePath}/${params.studentName}/课后信息`;
    await uploadToGoogleDrive(userId, logContent, logFileName, logFolderPath);
    console.log(`[后台任务] ${taskId} 生成日志已上传: ${logFileName}`);
  } catch (logErr: any) {
    console.error(`[后台任务] ${taskId} 生成日志上传失败:`, logErr?.message);
  }

  await updateTask(taskId, {
    status: finalStatus,
    currentStep: completedSteps,
    stepResults: JSON.stringify(stepResults),
    errorMessage: allCompleted ? null : `${failedSteps} 个步骤失败`,
    completedAt: new Date(),
  });

  console.log(`[后台任务] ${taskId} 完成，状态: ${finalStatus} (${completedSteps}/5 成功)`);
}

/**
 * 小班课任务
 */
async function runClassTask(taskId: string, params: ClassTaskParams, userId: number) {
  const stepResults: StepResults = {};
  let feedbackContent = "";
  let dateStr = "";
  let failedSteps = 0;

  // 获取配置
  const apiModel = params.apiModel || (await getConfig("apiModel", userId)) || DEFAULT_CONFIG.apiModel;
  const apiKey = params.apiKey || (await getConfig("apiKey", userId)) || DEFAULT_CONFIG.apiKey;
  const apiUrl = params.apiUrl || (await getConfig("apiUrl", userId)) || DEFAULT_CONFIG.apiUrl;
  const roadmapClass = params.roadmapClass !== undefined ? params.roadmapClass : ((await getConfig("roadmapClass", userId)) || "");
  // 小班课优先使用 classStoragePath（与 uploadClassFile 保持一致）
  const classStoragePath = params.classStoragePath || (await getConfig("classStoragePath", userId));
  const driveBasePath = classStoragePath || params.driveBasePath || (await getConfig("driveBasePath", userId)) || DEFAULT_CONFIG.driveBasePath;
  const currentYear = params.currentYear || (await getConfig("currentYear", userId)) || DEFAULT_CONFIG.currentYear;
  const apiConfig = { apiModel, apiKey, apiUrl };

  const folderName = `${params.classNumber}班`;
  const basePath = `${driveBasePath}/${folderName}`;

  // 创建日志会话（按用户隔离）
  const log = createLogSession(
    `班级${params.classNumber}`,
    { apiUrl: apiConfig.apiUrl || '', apiModel: apiConfig.apiModel || '', maxTokens: 64000 },
    {
      notesLength: params.currentNotes?.length || 0,
      transcriptLength: params.transcript?.length || 0,
      lastFeedbackLength: params.lastFeedback?.length || 0,
    },
    params.lessonNumber,
    params.lessonDate,
    userId
  );
  logInfo(log, 'task', `后台任务 ${taskId}`);

  const taskStartTime = Date.now();
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
  const step1Start = Date.now();
  stepResults.feedback = { status: "running" };
  await updateStepResults(taskId, stepResults, 1);
  startStep(log, 'feedback');

  try {
    const classResult = await generateClassFeedbackContent(classInput, roadmapClass, apiConfig, (chars) => {
      // 实时更新字符数到 DB（前端通过轮询获取）
      stepResults.feedback = { ...stepResults.feedback!, status: "running", chars };
      updateStepResults(taskId, stepResults, 1);
    });
    feedbackContent = classResult.content;
    const classMeta = classResult.meta;
    const classRawContent = classResult.rawContent;
    if (!feedbackContent || !feedbackContent.trim()) throw new Error("AI 返回内容为空");
    if (classRawContent && classRawContent.length !== feedbackContent.length) {
      console.log(`[后台任务] ${taskId} 班课原始AI输出${classRawContent.length}字符 → 清洗后${feedbackContent.length}字符（差${classRawContent.length - feedbackContent.length}字符）`);
    }

    dateStr = params.lessonDate || "";
    if (!dateStr) {
      const dateMatch = feedbackContent.match(/(\d{1,2}月\d{1,2}日)/);
      dateStr = dateMatch ? dateMatch[1] : new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }).replace("/", "月") + "日";
    }

    const fileName = `${folderName}${params.lessonNumber || ""}.md`;
    const folderPath = `${basePath}/学情反馈`;
    const uploadResult = await uploadToGoogleDrive(userId, feedbackContent, fileName, folderPath);
    assertUploadSuccess(uploadResult, "班课学情反馈");

    const step1Duration = Math.round((Date.now() - step1Start) / 1000);
    const isTruncated = classMeta.finishReason === 'length' || classMeta.finishReason === 'max_tokens';
    stepResults.feedback = {
      status: isTruncated ? "truncated" : "completed",
      fileName,
      url: uploadResult.url || "",
      path: uploadResult.path || "",
      chars: feedbackContent.length,
      duration: step1Duration,
      content: feedbackContent,
      rawContent: classRawContent,  // 原始AI输出（清洗前），用于诊断换行等问题
      // 生成诊断信息：模式、轮次、token用量
      genInfo: classMeta.totalPromptTokens > 0
        ? `${classMeta.mode} · ${classMeta.rounds}轮 · 输入${classMeta.totalPromptTokens}t/输出${classMeta.totalCompletionTokens}t · ${classMeta.finishReason}`
        : `${classMeta.mode} · ${classMeta.rounds}轮 · ${feedbackContent.length}字 · ${classMeta.finishReason}`,
      ...(isTruncated ? { error: `续写${classMeta.rounds}轮后仍被截断（输出${classMeta.totalCompletionTokens}token）` } : {}),
    };
    if (isTruncated) {
      failedSteps++;
      console.warn(`[后台任务] ${taskId} 班课步骤1截断: ${fileName} (${step1Duration}秒, ${feedbackContent.length}字) ⚠️ 内容不完整`);
    } else {
      stepSuccess(log, 'feedback', feedbackContent.length);
      console.log(`[后台任务] ${taskId} 班课步骤1完成: ${fileName} (${step1Duration}秒, ${feedbackContent.length}字, ${classMeta.mode} ${classMeta.rounds}轮)`);
    }
  } catch (err: any) {
    stepResults.feedback = { status: "failed", error: err?.message || String(err) };
    failedSteps++;
    stepFailed(log, 'feedback', parseError(err, 'feedback'));
    console.error(`[后台任务] ${taskId} 班课步骤1失败:`, err);
  }
  await updateStepResults(taskId, stepResults, 1);

  if (!feedbackContent) {
    endLogSession(log);
    await updateTask(taskId, {
      status: "failed",
      stepResults: JSON.stringify(stepResults),
      errorMessage: "学情反馈生成失败，后续步骤无法执行",
      completedAt: new Date(),
    });
    return;
  }

  // 取消检查点：步骤1完成后、步骤2-5开始前
  await checkCancellation(taskId, stepResults, 1);

  // ===== 步骤 2-5: 并行执行（每步完成立即更新DB，前端实时看到进度） =====
  let completedSteps = 1; // 步骤1已完成
  stepResults.review = { status: "running" };
  stepResults.test = { status: "running" };
  stepResults.extraction = { status: "running" };
  stepResults.bubbleChart = { status: "running" };
  await updateStepResults(taskId, stepResults, 2);

  // 每个步骤完成/失败后立即写DB，前端轮询即可看到最新进度
  const markDone = (name: "review" | "test" | "extraction" | "bubbleChart", r: any) => {
    const { fileName, uploadResult, chars, duration, content, files } = r;
    stepResults[name] = {
      status: "completed", fileName, url: uploadResult?.url || "", path: uploadResult?.path || "",
      chars, duration, ...(content ? { content } : {}), ...(files ? { files } : {}),
    };
    completedSteps++;
    console.log(`[后台任务] ${taskId} ${name} 完成 [${completedSteps}/5]`);
    updateStepResults(taskId, stepResults, completedSteps).catch(() => {});
  };
  const markFailed = (name: "review" | "test" | "extraction" | "bubbleChart", err: any) => {
    stepResults[name] = { status: "failed", error: err?.message || String(err) };
    failedSteps++;
    console.error(`[后台任务] ${taskId} ${name} 失败:`, err?.message || err);
    updateStepResults(taskId, stepResults, completedSteps).catch(() => {});
  };

  await Promise.allSettled([
    // 步骤2: 复习文档
    (async () => {
      const t = Date.now();
      let reviewChars = 0;
      let reviewLastUpdate = 0;
      const reviewResult = await generateClassReviewContent(classInput, feedbackContent, roadmapClass, apiConfig, (chunk) => {
        reviewChars += chunk.length;
        const now = Date.now();
        if (now - reviewLastUpdate >= 1000) {
          stepResults.review = { ...stepResults.review!, status: "running", chars: reviewChars };
          updateStepResults(taskId, stepResults, completedSteps).catch(() => {});
          reviewLastUpdate = now;
        }
      });
      if (!reviewResult.buffer || reviewResult.buffer.length === 0) throw new Error("复习文档生成为空");
      const fileName = `${folderName}${params.lessonNumber || ""}复习文档.docx`;
      const folderPath = `${basePath}/复习文档`;
      const uploadResult = await uploadBinaryToGoogleDrive(userId, reviewResult.buffer, fileName, folderPath);
      assertUploadSuccess(uploadResult, "班课复习文档");
      return { fileName, uploadResult, chars: reviewResult.textChars, duration: Math.round((Date.now() - t) / 1000) };
    })().then(r => { markDone("review", r); }, e => { markFailed("review", e); }),

    // 步骤3: 测试本
    (async () => {
      const t = Date.now();
      let testChars = 0;
      let testLastUpdate = 0;
      const testResult = await generateClassTestContent(classInput, feedbackContent, roadmapClass, apiConfig, (chunk) => {
        testChars += chunk.length;
        const now = Date.now();
        if (now - testLastUpdate >= 1000) {
          stepResults.test = { ...stepResults.test!, status: "running", chars: testChars };
          updateStepResults(taskId, stepResults, completedSteps).catch(() => {});
          testLastUpdate = now;
        }
      });
      if (!testResult.buffer || testResult.buffer.length === 0) throw new Error("测试本生成为空");
      const fileName = `${folderName}${params.lessonNumber || ""}测试文档.docx`;
      const folderPath = `${basePath}/复习文档`;
      const uploadResult = await uploadBinaryToGoogleDrive(userId, testResult.buffer, fileName, folderPath);
      assertUploadSuccess(uploadResult, "班课测试文档");
      return { fileName, uploadResult, chars: testResult.textChars, duration: Math.round((Date.now() - t) / 1000) };
    })().then(r => { markDone("test", r); }, e => { markFailed("test", e); }),

    // 步骤4: 课后信息提取
    (async () => {
      const t = Date.now();
      let extractChars = 0;
      let extractLastUpdate = 0;
      const extractionContent = await generateClassExtractionContent(classInput, feedbackContent, roadmapClass, apiConfig, (chunk) => {
        extractChars += chunk.length;
        const now = Date.now();
        if (now - extractLastUpdate >= 1000) {
          stepResults.extraction = { ...stepResults.extraction!, status: "running", chars: extractChars };
          updateStepResults(taskId, stepResults, completedSteps).catch(() => {});
          extractLastUpdate = now;
        }
      });
      if (!extractionContent || !extractionContent.trim()) throw new Error("课后信息提取为空");
      const fileName = `${folderName}${params.lessonNumber || ""}课后信息提取.md`;
      const folderPath = `${basePath}/课后信息`;
      const uploadResult = await uploadToGoogleDrive(userId, extractionContent, fileName, folderPath);
      assertUploadSuccess(uploadResult, "班课课后信息提取");
      return { fileName, uploadResult, chars: extractionContent.length, duration: Math.round((Date.now() - t) / 1000), content: extractionContent };
    })().then(r => { markDone("extraction", r); }, e => { markFailed("extraction", e); }),

    // 步骤5: 气泡图（每个学生一张）
    (async () => {
      const t = Date.now();
      const students = params.attendanceStudents.filter((s) => s.trim());
      let successCount = 0;
      const perStudentFiles: { fileName: string; url: string; path: string }[] = [];
      // 收集调试信息（只记录第一个学生的完整SVG，其余只记录摘要）
      const fontConfig = getResvgFontConfig();
      const debugLines: string[] = [
        `=== 气泡图调试日志 ===`,
        `时间: ${new Date().toISOString()}`,
        `班号: ${params.classNumber}`,
        `课次: ${params.lessonNumber || "未指定"}`,
        `学生: ${students.join(", ")}`,
        `CJK字体文件: ${fontConfig.fontFiles.length > 0 ? fontConfig.fontFiles.join(', ') : '未找到任何CJK字体文件！'}`,
        `字体扫描目录: ${fontConfig.fontDirs.join(', ') || '无'}`,
        ``,
        ...fontConfig.diagLines,
        ``,
      ];
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
          // 调试：记录原始SVG信息
          const isFirst = debugLines.length < 20; // 只对第一个学生记录完整SVG
          debugLines.push(`--- ${studentName} ---`);
          debugLines.push(`原始SVG长度: ${svgContent.length}字符`);
          debugLines.push(`包含<text>: ${(svgContent.match(/<text[\s>]/g) || []).length}个`);
          debugLines.push(`包含<tspan>: ${(svgContent.match(/<tspan[\s>]/g) || []).length}个`);
          debugLines.push(`包含<foreignObject>: ${(svgContent.match(/<foreignObject[\s>]/g) || []).length}个`);
          debugLines.push(`包含<style>: ${(svgContent.match(/<style[\s>]/g) || []).length}个`);
          debugLines.push(`包含@font-face: ${(svgContent.match(/@font-face/gi) || []).length}个`);
          debugLines.push(`包含@import: ${(svgContent.match(/@import/gi) || []).length}个`);
          // 提取所有font-family声明
          const fontFamilies = svgContent.match(/font-family[=:][^;}"'\n]+/g) || [];
          debugLines.push(`font-family声明: ${fontFamilies.length}个`);
          fontFamilies.slice(0, 5).forEach(f => debugLines.push(`  ${f}`));
          if (fontFamilies.length > 5) debugLines.push(`  ...还有${fontFamilies.length - 5}个`);

          // 调试：记录注入后的SVG信息
          const injectedSvg = injectChineseFontIntoSVG(svgContent);
          debugLines.push(`注入后SVG长度: ${injectedSvg.length}字符`);
          debugLines.push(`注入后包含WenQuanYi: ${injectedSvg.includes("WenQuanYi Zen Hei") ? "是" : "否"}`);

          if (isFirst) {
            debugLines.push(``, `===== 第一个学生原始SVG完整内容 =====`);
            debugLines.push(svgContent);
            debugLines.push(`===== 原始SVG结束 =====`);
            debugLines.push(``, `===== 注入后SVG完整内容 =====`);
            debugLines.push(injectedSvg);
            debugLines.push(`===== 注入后SVG结束 =====`, ``);
          }

          // SVG → PNG（注入中文字体+resvg渲染）
          const pngBuffer = await svgToPng(svgContent);
          debugLines.push(`PNG大小: ${pngBuffer.length}字节`);
          debugLines.push(``);

          const fileName = `${studentName}${params.lessonNumber || ""}气泡图.png`;
          const folderPath = `${basePath}/气泡图`;
          const uploadResult = await uploadBinaryToGoogleDrive(userId, pngBuffer, fileName, folderPath);
          assertUploadSuccess(uploadResult, `气泡图(${studentName})`);
          perStudentFiles.push({ fileName, url: uploadResult.url || "", path: uploadResult.path || "" });
          successCount++;
        } catch (err: any) {
          debugLines.push(`错误: ${err?.message || err}`);
          debugLines.push(``);
          console.error(`[后台任务] ${taskId} 气泡图 ${studentName} 失败:`, err?.message || err);
          if (err?.stack) console.error(`[后台任务] ${taskId} 气泡图堆栈:`, err.stack);
        }
      }
      if (successCount === 0 && students.length > 0) {
        // 即使全部失败也要先上传日志再抛错
        try {
          debugLines.push(`\n=== 全部失败，上传日志用于诊断 ===`);
          const debugContent = debugLines.join("\n");
          const debugFileName = `${folderName}${params.lessonNumber || ""}气泡图调试日志.txt`;
          const debugFolderPath = `${basePath}/课后信息`;
          await uploadToGoogleDrive(userId, debugContent, debugFileName, debugFolderPath);
          console.log(`[后台任务] ${taskId} 调试日志已上传（全部失败情况）`);
        } catch (e: any) { console.error(`[后台任务] 调试日志上传失败:`, e?.message); }
        throw new Error(`全部${students.length}个学生气泡图生成失败（最后错误见服务器日志）`);
      }
      const failedCount = students.length - successCount;
      // 无论成功还是部分失败，都上传调试日志
      try {
        const debugContent = debugLines.join("\n");
        const debugFileName = `${folderName}${params.lessonNumber || ""}气泡图调试日志.txt`;
        const debugFolderPath = `${basePath}/课后信息`;
        await uploadToGoogleDrive(userId, debugContent, debugFileName, debugFolderPath);
        console.log(`[后台任务] ${taskId} 调试日志已上传: ${debugFileName}`);
      } catch (debugErr: any) {
        console.error(`[后台任务] ${taskId} 调试日志上传失败:`, debugErr?.message);
      }
      if (failedCount > 0) {
        throw new Error(`气泡图部分失败(${successCount}/${students.length}成功)`);
      }
      return { fileName: `气泡图(${successCount}/${students.length}成功)`, uploadResult: { url: "", path: "" }, chars: successCount, duration: Math.round((Date.now() - t) / 1000), files: perStudentFiles };
    })().then(r => { markDone("bubbleChart", r); }, e => { markFailed("bubbleChart", e); }),
  ]);

  // 并行步骤已在各自的 .then() 中即时更新了 stepResults 和 completedSteps

  const allCompleted = failedSteps === 0;
  const finalStatus = allCompleted ? "completed" : completedSteps > 1 ? "partial" : "failed";

  endLogSession(log);

  await updateTask(taskId, {
    status: finalStatus,
    currentStep: completedSteps,
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
      \`user_id\` int NOT NULL DEFAULT 0,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`completed_at\` timestamp NULL,
      PRIMARY KEY (\`id\`),
      KEY \`idx_background_tasks_user_id\` (\`user_id\`)
    )`);
    // 兼容旧表：text → mediumtext 升级（防止大文本超过 64KB 限制）
    try {
      await db.execute(sql`ALTER TABLE \`background_tasks\` MODIFY COLUMN \`input_params\` mediumtext NOT NULL`);
      await db.execute(sql`ALTER TABLE \`background_tasks\` MODIFY COLUMN \`step_results\` mediumtext`);
      await db.execute(sql`ALTER TABLE \`system_config\` MODIFY COLUMN \`value\` mediumtext NOT NULL`);
    } catch (alterErr: any) {
      // ALTER TABLE 失败可能有多种原因，不能盲目忽略
      console.warn("[后台任务] 列类型升级失败(可能已是mediumtext):", alterErr?.message || alterErr);
    }
    // 兼容旧表：添加 user_id 列用于数据隔离
    try {
      await db.execute(sql`ALTER TABLE \`background_tasks\` ADD COLUMN \`user_id\` INT NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE \`background_tasks\` ADD INDEX \`idx_background_tasks_user_id\` (\`user_id\`)`);
      console.log("[后台任务] 已添加 user_id 列和索引");
    } catch (userIdErr: any) {
      // 列已存在时会报 Duplicate column，安全忽略
    }
    // 兼容旧表：添加 model 列（V188: 运行时记录实际使用的AI模型）
    try {
      await db.execute(sql`ALTER TABLE \`background_tasks\` ADD COLUMN \`model\` VARCHAR(128) DEFAULT NULL`);
      console.log("[后台任务] 已添加 model 列");
    } catch {
      // 列已存在时安全忽略
    }
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
