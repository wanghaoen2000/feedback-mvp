import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { eq, gte, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { systemConfig } from "../drizzle/schema";
import { uploadToGoogleDrive, uploadBinaryToGoogleDrive, verifyAllFiles, UploadStatus, readFileFromGoogleDrive, verifyFileExists, searchFileInGoogleDrive } from "./gdrive";
import { parseError, formatErrorMessage, StructuredError } from "./errorHandler";
import { 
  createLogSession, 
  startStep, 
  stepSuccess, 
  stepFailed, 
  endLogSession, 
  logInfo, 
  getLatestLogPath, 
  getLatestLogPathByStudent,
  getLogContent, 
  listLogFiles 
} from './logger';
import { runSystemCheck } from "./systemCheck";
import * as googleAuth from "./googleAuth";
import {
  generateFeedbackContent,
  generateReviewContent,
  generateTestContent,
  generateExtractionContent,
  generateBubbleChartSVG,
  FeedbackInput,
  ClassFeedbackInput,
  CourseType,
  generateClassFeedbackContent,
  generateClassReviewContent,
  generateClassTestContent,
  generateClassExtractionContent,
  generateClassBubbleChartSVG,
} from "./feedbackGenerator";
import { storeContent } from "./contentStore";
import { DEFAULT_CONFIG, getConfigValue as getConfig } from "./core/aiClient";
import { addWeekdayToDate } from "./utils";

// 设置配置值
async function setConfig(key: string, value: string, description?: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const existing = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(systemConfig).set({ value, description }).where(eq(systemConfig.key, key));
    } else {
      await db.insert(systemConfig).values({ key, value, description });
    }
  } catch (e) {
    console.error(`设置配置 ${key} 失败:`, e);
    throw e;
  }
}


// 共享的输入schema（一对一）
const feedbackInputSchema = z.object({
  studentName: z.string().min(1, "请输入学生姓名"),
  lessonNumber: z.string().optional(),
  lessonDate: z.string().optional(), // 本次课日期，如"1月5日"
  currentYear: z.string().optional(), // 年份，如"2026"
  lastFeedback: z.string().optional(),
  currentNotes: z.string().min(1, "请输入本次课笔记"),
  transcript: z.string().min(1, "请输入录音转文字"),
  isFirstLesson: z.boolean().default(false),
  specialRequirements: z.string().optional(),
  // 配置参数（并发安全，由前端传入快照）
  apiModel: z.string().optional(),
  apiKey: z.string().optional(),
  apiUrl: z.string().optional(),
  roadmap: z.string().optional(),
  driveBasePath: z.string().optional(),
  taskId: z.string().optional(),
});

// 小班课输入schema
const classFeedbackInputSchema = z.object({
  classNumber: z.string().min(1, "请输入班号"),
  lessonNumber: z.string().optional(),
  lessonDate: z.string().optional(), // 本次课日期，如"1月15日"
  currentYear: z.string().optional(), // 年份，如"2026"
  attendanceStudents: z.array(z.string()).min(1, "至少需要1名出勤学生"),
  lastFeedback: z.string().optional(),
  currentNotes: z.string().min(1, "请输入本次课笔记"),
  transcript: z.string().min(1, "请输入录音转文字"),
  specialRequirements: z.string().optional(),
  // 配置参数
  apiModel: z.string().optional(),
  apiKey: z.string().optional(),
  apiUrl: z.string().optional(),
  roadmapClass: z.string().optional(), // 小班课路书
  driveBasePath: z.string().optional(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // 配置管理
  config: router({
    // 获取所有配置
    getAll: protectedProcedure.query(async () => {
      const apiModel = await getConfig("apiModel");
      const apiKey = await getConfig("apiKey");
      const apiUrl = await getConfig("apiUrl");
      const currentYear = await getConfig("currentYear");
      const roadmap = await getConfig("roadmap");
      const roadmapClass = await getConfig("roadmapClass");
      const firstLessonTemplate = await getConfig("firstLessonTemplate");
      const classFirstLessonTemplate = await getConfig("classFirstLessonTemplate");
      const driveBasePath = await getConfig("driveBasePath");
      const classStoragePath = await getConfig("classStoragePath");
      const batchFilePrefix = await getConfig("batchFilePrefix");
      const batchStoragePath = await getConfig("batchStoragePath");
      const batchConcurrency = await getConfig("batchConcurrency");
      const maxTokens = await getConfig("maxTokens");
      const gdriveLocalBasePath = await getConfig("gdriveLocalBasePath");
      const gdriveDownloadsPath = await getConfig("gdriveDownloadsPath");
      const modelPresets = await getConfig("modelPresets");

      return {
        apiModel: apiModel || DEFAULT_CONFIG.apiModel,
        // 安全考虑：不返回完整 API Key，只返回空字符串。用 hasApiKey 指示是否已配置
        apiKey: "",
        apiUrl: apiUrl || DEFAULT_CONFIG.apiUrl,
        currentYear: currentYear || DEFAULT_CONFIG.currentYear,
        roadmap: roadmap || "",
        roadmapClass: roadmapClass || "",
        firstLessonTemplate: firstLessonTemplate || "",
        classFirstLessonTemplate: classFirstLessonTemplate || "",
        driveBasePath: driveBasePath || DEFAULT_CONFIG.driveBasePath,
        classStoragePath: classStoragePath || "", // 小班课路径，留空则使用 driveBasePath
        batchFilePrefix: batchFilePrefix || DEFAULT_CONFIG.batchFilePrefix,
        batchStoragePath: batchStoragePath || DEFAULT_CONFIG.batchStoragePath,
        batchConcurrency: batchConcurrency || DEFAULT_CONFIG.batchConcurrency,
        maxTokens: maxTokens || "64000",
        gdriveLocalBasePath: gdriveLocalBasePath || "",
        gdriveDownloadsPath: gdriveDownloadsPath || "",
        modelPresets: modelPresets || "",
        // 返回是否使用默认值（apiKey 特殊处理：表示是否已配置）
        hasApiKey: !!apiKey,
        isDefault: {
          apiModel: !apiModel,
          apiKey: !apiKey, // deprecated，使用 hasApiKey
          apiUrl: !apiUrl,
          currentYear: !currentYear,
          driveBasePath: !driveBasePath,
          batchFilePrefix: !batchFilePrefix,
          batchStoragePath: !batchStoragePath,
        }
      };
    }),

    // 更新配置
    update: protectedProcedure
      .input(z.object({
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        currentYear: z.string().optional(),
        roadmap: z.string().optional(),
        roadmapClass: z.string().optional(),
        firstLessonTemplate: z.string().optional(),
        classFirstLessonTemplate: z.string().optional(),
        driveBasePath: z.string().optional(),
        classStoragePath: z.string().optional(),
        batchFilePrefix: z.string().optional(),
        batchStoragePath: z.string().optional(),
        batchConcurrency: z.string().optional(),
        maxTokens: z.string().optional(),
        gdriveLocalBasePath: z.string().optional(),
        gdriveDownloadsPath: z.string().optional(),
        modelPresets: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const updates: string[] = [];
        
        if (input.apiModel !== undefined && input.apiModel.trim()) {
          await setConfig("apiModel", input.apiModel.trim(), "AI模型名称");
          updates.push("apiModel");
        }
        
        if (input.apiKey !== undefined && input.apiKey.trim()) {
          await setConfig("apiKey", input.apiKey.trim(), "API密钥");
          updates.push("apiKey");
        }
        
        if (input.apiUrl !== undefined && input.apiUrl.trim()) {
          await setConfig("apiUrl", input.apiUrl.trim(), "API地址");
          updates.push("apiUrl");
        }
        
        if (input.currentYear !== undefined && input.currentYear.trim()) {
          await setConfig("currentYear", input.currentYear.trim(), "当前年份");
          updates.push("currentYear");
        }
        
        if (input.roadmap !== undefined) {
          await setConfig("roadmap", input.roadmap, "V9路书内容（一对一）");
          updates.push("roadmap");
        }
        
        if (input.roadmapClass !== undefined) {
          await setConfig("roadmapClass", input.roadmapClass, "小班课路书内容");
          updates.push("roadmapClass");
        }
        
        if (input.firstLessonTemplate !== undefined) {
          await setConfig("firstLessonTemplate", input.firstLessonTemplate, "一对一首次课范例");
          updates.push("firstLessonTemplate");
        }
        
        if (input.classFirstLessonTemplate !== undefined) {
          await setConfig("classFirstLessonTemplate", input.classFirstLessonTemplate, "小班课首次课范例");
          updates.push("classFirstLessonTemplate");
        }
        
        if (input.driveBasePath !== undefined && input.driveBasePath.trim()) {
          // 验证路径格式：不能以/开头或结尾
          let path = input.driveBasePath.trim();
          if (path.startsWith('/')) {
            path = path.slice(1);
          }
          if (path.endsWith('/')) {
            path = path.slice(0, -1);
          }
          await setConfig("driveBasePath", path, "一对一存储路径");
          updates.push("driveBasePath");
        }

        if (input.classStoragePath !== undefined) {
          // 小班课存储路径，可以为空（空则使用 driveBasePath）
          let path = input.classStoragePath.trim();
          if (path) {
            if (path.startsWith('/')) {
              path = path.slice(1);
            }
            if (path.endsWith('/')) {
              path = path.slice(0, -1);
            }
          }
          await setConfig("classStoragePath", path, "小班课存储路径");
          updates.push("classStoragePath");
        }

        if (input.batchFilePrefix !== undefined) {
          await setConfig("batchFilePrefix", input.batchFilePrefix.trim() || DEFAULT_CONFIG.batchFilePrefix, "批量处理文件名前缀");
          updates.push("batchFilePrefix");
        }

        if (input.batchConcurrency !== undefined) {
          const val = parseInt(input.batchConcurrency.trim(), 10);
          if (!isNaN(val) && val >= 1 && val <= 200) {
            await setConfig("batchConcurrency", val.toString(), "批量处理并发数");
            updates.push("batchConcurrency");
          }
        }

        if (input.batchStoragePath !== undefined && input.batchStoragePath.trim()) {
          // 验证路径格式：不能以/开头或结尾
          let path = input.batchStoragePath.trim();
          if (path.startsWith('/')) {
            path = path.slice(1);
          }
          if (path.endsWith('/')) {
            path = path.slice(0, -1);
          }
          await setConfig("batchStoragePath", path, "批量处理存储路径");
          updates.push("batchStoragePath");
        }
        
        if (input.maxTokens !== undefined && input.maxTokens.trim()) {
          // 验证是否为有效数字
          const tokenValue = parseInt(input.maxTokens.trim(), 10);
          if (!isNaN(tokenValue) && tokenValue >= 1000 && tokenValue <= 200000) {
            await setConfig("maxTokens", tokenValue.toString(), "AI生成的最大token数");
            updates.push("maxTokens");
          }
        }

        if (input.gdriveLocalBasePath !== undefined) {
          // Google Drive 本地路径（绝对路径，允许以/开头）
          let localPath = input.gdriveLocalBasePath.trim();
          if (localPath.endsWith('/')) {
            localPath = localPath.slice(0, -1);
          }
          await setConfig("gdriveLocalBasePath", localPath, "Google Drive本地同步路径");
          updates.push("gdriveLocalBasePath");
        }

        if (input.gdriveDownloadsPath !== undefined) {
          let dlPath = input.gdriveDownloadsPath.trim();
          if (dlPath.startsWith('/')) dlPath = dlPath.slice(1);
          if (dlPath.endsWith('/')) dlPath = dlPath.slice(0, -1);
          await setConfig("gdriveDownloadsPath", dlPath, "Google Drive上Downloads文件夹路径");
          updates.push("gdriveDownloadsPath");
        }

        if (input.modelPresets !== undefined) {
          await setConfig("modelPresets", input.modelPresets, "常用模型预设列表");
          updates.push("modelPresets");
        }

        return {
          success: true,
          updated: updates,
          message: updates.length > 0 
            ? `已更新: ${updates.join(", ")}` 
            : "没有需要更新的配置",
        };
      }),

    // 重置为默认值
    reset: protectedProcedure
      .input(z.object({
        keys: z.array(z.enum(["apiModel", "apiKey", "apiUrl", "currentYear", "roadmap", "driveBasePath"])),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("数据库不可用");
        for (const key of input.keys) {
          try {
            await db.delete(systemConfig).where(eq(systemConfig.key, key));
          } catch (e) {
            console.error(`重置配置 ${key} 失败:`, e);
          }
        }
        
        return {
          success: true,
          reset: input.keys,
          message: `已重置: ${input.keys.join(", ")}`,
        };
      }),

    // 获取学生/班级历史记录
    getStudentHistory: protectedProcedure.query(async () => {
      const historyJson = await getConfig("studentLessonHistory");
      if (!historyJson) {
        return {};
      }
      try {
        return JSON.parse(historyJson);
      } catch {
        return {};
      }
    }),

    // 保存学生/班级历史记录
    saveStudentHistory: protectedProcedure
      .input(z.object({
        history: z.record(z.string(), z.object({
          lesson: z.number(),
          lastUsed: z.number(),
        })),
      }))
      .mutation(async ({ input }) => {
        await setConfig("studentLessonHistory", JSON.stringify(input.history));
        return { success: true };
      }),
  }),

  // 学情反馈生成 - 拆分为5个独立端点
  feedback: router({
    // 步骤1: 生成学情反馈
    generateFeedback: protectedProcedure
      .input(feedbackInputSchema)
      .mutation(async ({ input }) => {
        // 获取配置（优先使用传入的快照，确保并发安全）
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        const currentYear = input.currentYear || await getConfig("currentYear") || DEFAULT_CONFIG.currentYear;
        const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap") || DEFAULT_CONFIG.roadmap);
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
        
        // 创建独立的日志会话（并发安全）
        const log = createLogSession(
          input.studentName,
          { apiUrl, apiModel, maxTokens: 32000 },
          {
            notesLength: input.currentNotes.length,
            transcriptLength: input.transcript.length,
            lastFeedbackLength: (input.lastFeedback || "").length,
          },
          input.lessonNumber,
          input.lessonDate
        );
        
        startStep(log, "学情反馈");
        
        try {
          // 组合年份和日期，并添加星期信息
          const lessonDate = input.lessonDate ? addWeekdayToDate(input.lessonDate.includes('年') ? input.lessonDate : `${currentYear}年${input.lessonDate}`) : "";
          
          const feedbackResult = await generateFeedbackContent('oneToOne', {
            studentName: input.studentName,
            lessonNumber: input.lessonNumber || "",
            lessonDate: lessonDate,
            nextLessonDate: "",
            lastFeedback: input.lastFeedback || "",
            currentNotes: input.currentNotes,
            transcript: input.transcript,
            isFirstLesson: input.isFirstLesson,
            specialRequirements: input.specialRequirements || "",
          }, { apiModel, apiKey, apiUrl, roadmap });
          const feedbackContent = feedbackResult.content;

          // 记录原始AI输出（清洗前），用于排查奇怪换行等问题
          if (feedbackResult.rawContent) {
            logInfo(log, "学情反馈", `原始AI输出（${feedbackResult.rawContent.length}字符，清洗后${feedbackContent.length}字符）`, feedbackResult.rawContent);
          }

          if (!feedbackContent || !feedbackContent.trim()) {
            throw new Error('学情反馈生成失败：AI 返回内容为空，请重试');
          }

          // 优先使用用户输入的日期，否则从反馈内容中提取
          let dateStr = input.lessonDate || "";
          if (!dateStr) {
            const dateMatch = feedbackContent.match(/(\d{1,2}月\d{1,2}日)/);
            dateStr = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace('/', '月') + '日';
          }

          // 上传到Google Drive
          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.lessonNumber || ''}.md`;
          const folderPath = `${basePath}/学情反馈`;
          
          logInfo(log, "学情反馈", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadToGoogleDrive(feedbackContent, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          stepSuccess(log, "学情反馈", feedbackContent.length);

          const resultPayload = {
            success: true,
            step: 1,
            stepName: "学情反馈",
            feedbackContent,
            uploadResult: {
              fileName,
              url: uploadResult.url || "",
              path: uploadResult.path || "",
              folderUrl: uploadResult.folderUrl || "",
            },
            dateStr,
            usedConfig: { apiModel, apiUrl },
          };

          // taskId 容错：存入 contentStore 供前端轮询
          if (input.taskId) {
            storeContent(input.taskId, JSON.stringify(resultPayload));
          }

          return resultPayload;
        } catch (error: any) {
          const structuredError = parseError(error, "feedback");
          stepFailed(log, "学情反馈", structuredError);
          endLogSession(log);
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 步骤2: 生成复习文档
    generateReview: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
        taskId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap") || DEFAULT_CONFIG.roadmap);
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
        
        // 创建独立的日志会话（并发安全）
        const log = createLogSession(
          input.studentName,
          { apiUrl, apiModel, maxTokens: 32000 },
          { notesLength: 0, transcriptLength: 0, lastFeedbackLength: input.feedbackContent.length },
          undefined,
          input.dateStr
        );
        
        startStep(log, "复习文档");
        
        try {
          const feedbackInput: FeedbackInput = {
            studentName: input.studentName,
            lessonNumber: input.lessonNumber || "",
            lessonDate: input.dateStr,
            nextLessonDate: "",
            lastFeedback: "",
            currentNotes: "",
            transcript: "",
            isFirstLesson: false,
            specialRequirements: "",
          };

          const reviewDocx = await generateReviewContent(
            'oneToOne',
            feedbackInput,
            input.feedbackContent,
            input.dateStr,
            { apiModel, apiKey, apiUrl, roadmap }
          );

          if (!reviewDocx || reviewDocx.length === 0) {
            throw new Error('复习文档生成失败：AI 返回内容为空，请重试');
          }

          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.lessonNumber || ''}复习文档.docx`;
          const folderPath = `${basePath}/复习文档`;
          
          logInfo(log, "复习文档", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadBinaryToGoogleDrive(reviewDocx, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          stepSuccess(log, "复习文档", reviewDocx.length);
          endLogSession(log);

          const reviewResult = {
            success: true,
            step: 2,
            stepName: "复习文档",
            uploadResult: {
              fileName,
              url: uploadResult.url || "",
              path: uploadResult.path || "",
              folderUrl: uploadResult.folderUrl || "",
            },
          };

          // 存入 contentStore，供前端代理超时后轮询
          if (input.taskId) {
            storeContent(input.taskId, JSON.stringify(reviewResult.uploadResult), { type: 'review', chars: reviewDocx.length });
          }

          return reviewResult;
        } catch (error: any) {
          const structuredError = parseError(error, "review");
          stepFailed(log, "复习文档", structuredError);
          endLogSession(log);
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 步骤3: 生成测试本
    generateTest: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
        taskId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap") || DEFAULT_CONFIG.roadmap);
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
        
        // 创建独立的日志会话（并发安全）
        const log = createLogSession(
          input.studentName,
          { apiUrl, apiModel, maxTokens: 32000 },
          { notesLength: 0, transcriptLength: 0, lastFeedbackLength: input.feedbackContent.length },
          undefined,
          input.dateStr
        );
        
        startStep(log, "测试本");
        
        try {
          const feedbackInput: FeedbackInput = {
            studentName: input.studentName,
            lessonNumber: input.lessonNumber || "",
            lessonDate: input.dateStr,
            nextLessonDate: "",
            lastFeedback: "",
            currentNotes: "",
            transcript: "",
            isFirstLesson: false,
            specialRequirements: "",
          };

          const testDocx = await generateTestContent(
            'oneToOne',
            feedbackInput,
            input.feedbackContent,
            input.dateStr,
            { apiModel, apiKey, apiUrl, roadmap }
          );

          if (!testDocx || testDocx.length === 0) {
            throw new Error('测试本生成失败：AI 返回内容为空，请重试');
          }

          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.lessonNumber || ''}测试文档.docx`;
          const folderPath = `${basePath}/复习文档`;
          
          logInfo(log, "测试本", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadBinaryToGoogleDrive(testDocx, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          stepSuccess(log, "测试本", testDocx.length);
          endLogSession(log);

          const testResult = {
            success: true,
            step: 3,
            stepName: "测试本",
            uploadResult: {
              fileName,
              url: uploadResult.url || "",
              path: uploadResult.path || "",
              folderUrl: uploadResult.folderUrl || "",
            },
          };

          if (input.taskId) {
            storeContent(input.taskId, JSON.stringify(testResult.uploadResult), { type: 'test', chars: testDocx.length });
          }

          return testResult;
        } catch (error: any) {
          const structuredError = parseError(error, "test");
          stepFailed(log, "测试本", structuredError);
          endLogSession(log);
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 步骤4: 生成课后信息提取
    generateExtraction: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
        taskId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap") || DEFAULT_CONFIG.roadmap);
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
        
        // 创建独立的日志会话（并发安全）
        const log = createLogSession(
          input.studentName,
          { apiUrl, apiModel, maxTokens: 32000 },
          { notesLength: 0, transcriptLength: 0, lastFeedbackLength: input.feedbackContent.length },
          undefined,
          input.dateStr
        );
        
        startStep(log, "课后信息提取");
        
        try {
          const feedbackInput: FeedbackInput = {
            studentName: input.studentName,
            lessonNumber: input.lessonNumber || "",
            lessonDate: input.dateStr,
            nextLessonDate: "",
            lastFeedback: "",
            currentNotes: "",
            transcript: "",
            isFirstLesson: false,
            specialRequirements: "",
          };

          const extractionContent = await generateExtractionContent(
            'oneToOne',
            feedbackInput,
            input.feedbackContent,
            { apiModel, apiKey, apiUrl, roadmap }
          );

          if (!extractionContent || !extractionContent.trim()) {
            throw new Error('课后信息提取生成失败：AI 返回内容为空，请重试');
          }

          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.lessonNumber || ''}课后信息提取.md`;
          const folderPath = `${basePath}/课后信息`;
          
          logInfo(log, "课后信息提取", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadToGoogleDrive(extractionContent, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          stepSuccess(log, "课后信息提取", extractionContent.length);
          endLogSession(log);

          const extractionResult = {
            success: true,
            step: 4,
            stepName: "课后信息提取",
            uploadResult: {
              fileName,
              url: uploadResult.url || "",
              path: uploadResult.path || "",
              folderUrl: uploadResult.folderUrl || "",
            },
          };

          if (input.taskId) {
            storeContent(input.taskId, JSON.stringify(extractionResult.uploadResult), { type: 'extraction', chars: extractionContent.length });
          }

          return extractionResult;
        } catch (error: any) {
          const structuredError = parseError(error, "extraction");
          stepFailed(log, "课后信息提取", structuredError);
          endLogSession(log);
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 步骤5: 生成气泡图SVG（返回SVG字符串，前端转换为PNG并上传）
    generateBubbleChart: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        dateStr: z.string(),
        lessonNumber: z.string().optional(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
        taskId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap") || DEFAULT_CONFIG.roadmap);
        
        // 创建独立的日志会话（并发安全）
        const log = createLogSession(
          input.studentName,
          { apiUrl, apiModel, maxTokens: 32000 },
          { notesLength: 0, transcriptLength: 0, lastFeedbackLength: input.feedbackContent.length },
          input.lessonNumber,
          input.dateStr
        );
        
        startStep(log, "气泡图");
        
        try {
          // 生成SVG字符串，返回给前端
          const svgContent = await generateBubbleChartSVG(
            'oneToOne',
            input.feedbackContent,
            input.studentName,
            input.dateStr,
            input.lessonNumber || "",
            { apiModel, apiKey, apiUrl, roadmap }
          );

          if (!svgContent || !svgContent.trim()) {
            throw new Error('气泡图生成失败：AI 返回内容为空，请重试');
          }

          stepSuccess(log, "气泡图", svgContent.length);
          endLogSession(log);

          // 存入 contentStore（气泡图存的是 SVG 内容）
          if (input.taskId) {
            storeContent(input.taskId, JSON.stringify({ svgContent }), { type: 'bubbleChart', chars: svgContent.length });
          }

          // 返回SVG字符串，前端负责转换为PNG并上传
          return {
            success: true,
            step: 5,
            stepName: "气泡图",
            svgContent,
          };
        } catch (error: any) {
          const structuredError = parseError(error, "bubbleChart");
          stepFailed(log, "气泡图", structuredError);
          endLogSession(log);
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 步骤5b: 上传气泡图PNG（前端转换后调用）
    uploadBubbleChart: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        pngBase64: z.string(), // base64编码的PNG数据
        driveBasePath: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
        
        try {
          // 将base64转换为Buffer
          const pngBuffer = Buffer.from(input.pngBase64, 'base64');
          
          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.lessonNumber || ''}气泡图.png`;
          const folderPath = `${basePath}/气泡图`;
          
          console.log(`[气泡图上传] 上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadBinaryToGoogleDrive(pngBuffer, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          return {
            success: true,
            step: 5,
            stepName: "气泡图上传",
            uploadResult: {
              fileName,
              url: uploadResult.url || "",
              path: uploadResult.path || "",
              folderUrl: uploadResult.folderUrl || "",
            },
          };
        } catch (error: any) {
          const structuredError = parseError(error, "bubbleChartUpload");
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 最终验证
    verifyAll: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        driveBasePath: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        console.log(`[${new Date().toLocaleTimeString()}] 最终验证: 检查所有文件...`);
        
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
        const basePath = `${driveBasePath}/${input.studentName}`;
        const ln = input.lessonNumber || '';
        const filePaths = [
          `${basePath}/学情反馈/${input.studentName}${ln}.md`,
          `${basePath}/复习文档/${input.studentName}${ln}复习文档.docx`,
          `${basePath}/复习文档/${input.studentName}${ln}测试文档.docx`,
          `${basePath}/课后信息/${input.studentName}${ln}课后信息提取.md`,
          `${basePath}/气泡图/${input.studentName}${ln}气泡图.png`,
        ];
        
        const verification = await verifyAllFiles(filePaths);
        
        console.log(`[${new Date().toLocaleTimeString()}] 最终验证: ${verification.results.filter(r => r.exists).length}/5 文件验证通过`);
        
        return {
          success: verification.allExist,
          verifiedCount: verification.results.filter(r => r.exists).length,
          totalCount: 5,
          results: verification.results,
          driveFolder: basePath,
        };
      }),

    // 获取最新日志
    getLatestLog: protectedProcedure
      .query(async () => {
        const logPath = getLatestLogPath();
        if (!logPath) {
          return { success: false, message: "没有找到日志文件" };
        }
        const content = getLogContent(logPath);
        return {
          success: true,
          path: logPath,
          content,
        };
      }),

    // 导出日志到Google Drive
    exportLog: protectedProcedure
      .input(z.object({
        studentName: z.string().optional(),
      }).optional())
      .mutation(async ({ input }) => {
        // 如果提供了学生名，根据学生名查找日志；否则获取最新的日志
        const logPath = input?.studentName 
          ? getLatestLogPathByStudent(input.studentName) 
          : getLatestLogPath();
        if (!logPath) {
          return { success: false, message: "没有找到日志文件，请先运行一次生成" };
        }
        
        const content = getLogContent(logPath);
        if (!content) {
          return { success: false, message: "无法读取日志文件" };
        }
        
        const fileName = logPath.split('/').pop() || 'log.txt';
        const folderPath = 'Mac/Documents/XDF/日志';
        const fullPath = `${folderPath}/${fileName}`;
        
        try {
          const uploadResult = await uploadToGoogleDrive(content, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            return {
              success: false,
              message: `导出失败: ${uploadResult.error || '上传失败'}`,
            };
          }
          
          return {
            success: true,
            message: "日志已导出到Google Drive",
            url: uploadResult.url || "",
            path: fullPath,
            fileName: fileName,
          };
        } catch (error: any) {
          return {
            success: false,
            message: `导出失败: ${error.message}`,
          };
        }
      }),

    // 列出所有日志文件
    listLogs: protectedProcedure
      .query(async () => {
        const logs = listLogFiles();
        return {
          success: true,
          logs: logs.map((l: { name: string; path: string; mtime: Date }) => ({
            name: l.name,
            path: l.path,
            mtime: l.mtime.toISOString(),
          })),
        };
      }),

    // 系统自检
    systemCheck: protectedProcedure
      .mutation(async () => {
        try {
          const results = await runSystemCheck();
          return {
            success: true,
            ...results,
          };
        } catch (error: any) {
          return {
            success: false,
            results: [],
            passed: 0,
            total: 8,
            allPassed: false,
            error: error.message,
          };
        }
      }),
    // Google Drive OAuth授权
    googleAuthStatus: protectedProcedure
      .query(async () => {
        return await googleAuth.getStatus();
      }),
    googleAuthUrl: protectedProcedure
      .query(async () => {
        return { 
          url: googleAuth.getAuthUrl(),
          redirectUri: googleAuth.getRedirectUri()
        };
      }),
    googleAuthCallback: protectedProcedure
      .input(z.object({ code: z.string() }))
      .mutation(async ({ input }) => {
        return await googleAuth.handleCallback(input.code);
      }),
    googleAuthDisconnect: protectedProcedure
      .mutation(async () => {
        return await googleAuth.disconnect();
      }),
      
    // ========== 小班课生成接口 ==========
    
    // 小班课步骤1: 生成1份完整学情反馈
    generateClassFeedback: protectedProcedure
      .input(classFeedbackInputSchema)
      .mutation(async ({ input }) => {
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        const currentYear = input.currentYear || await getConfig("currentYear") || DEFAULT_CONFIG.currentYear;
        const roadmapClass = input.roadmapClass !== undefined ? input.roadmapClass : (await getConfig("roadmapClass") || "");
        
        // 创建小班课日志会话（用班号作为标识符）
        const log = createLogSession(
          `${input.classNumber}班`,
          { apiUrl, apiModel, maxTokens: 32000 },
          {
            notesLength: input.currentNotes.length,
            transcriptLength: input.transcript.length,
            lastFeedbackLength: (input.lastFeedback || "").length,
          },
          input.lessonNumber,
          input.lessonDate
        );
        
        startStep(log, "小班课学情反馈");
        
        console.log(`[小班课] 开始为 ${input.classNumber} 班生成学情反馈...`);
        console.log(`[小班课] 路书长度: ${roadmapClass?.length || 0} 字符`);
        
        // 组合年份和日期，并添加星期信息（和一对一保持一致）
        const lessonDate = input.lessonDate ? addWeekdayToDate(input.lessonDate.includes('年') ? input.lessonDate : `${currentYear}年${input.lessonDate}`) : "";
        
        const classInput: ClassFeedbackInput = {
          classNumber: input.classNumber,
          lessonNumber: input.lessonNumber || '',
          lessonDate: lessonDate,
          nextLessonDate: '', // 小班课从笔记中提取
          attendanceStudents: input.attendanceStudents.filter(s => s.trim()),
          lastFeedback: input.lastFeedback || '',
          currentNotes: input.currentNotes,
          transcript: input.transcript,
          specialRequirements: input.specialRequirements || '',
        };
        
        try {
          // 生成1份完整的学情反馈（包含全班共用部分+每个学生的单独部分）
          const classResult = await generateClassFeedbackContent(
            classInput,
            roadmapClass,
            { apiModel, apiKey, apiUrl }
          );
          const feedback = classResult.content;

          stepSuccess(log, "小班课学情反馈", feedback.length);
          endLogSession(log);

          return {
            success: true,
            feedback, // 字符串，1份完整的学情反馈
          };
        } catch (error: any) {
          stepFailed(log, "小班课学情反馈", parseError(error));
          endLogSession(log);
          throw error;
        }
      }),
    
    // 小班课步骤2: 生成复习文档
    generateClassReview: protectedProcedure
      .input(z.object({
        classNumber: z.string(),
        lessonNumber: z.string().optional(),
        lessonDate: z.string().optional(),
        attendanceStudents: z.array(z.string()),
        currentNotes: z.string(),
        combinedFeedback: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmapClass: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
          const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
          const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
          const roadmapClass = input.roadmapClass || await getConfig("roadmapClass") || "";

          const classInput: ClassFeedbackInput = {
            classNumber: input.classNumber,
            lessonNumber: input.lessonNumber || '',
            lessonDate: input.lessonDate || '',
            nextLessonDate: '',
            attendanceStudents: input.attendanceStudents,
            lastFeedback: '',
            currentNotes: input.currentNotes,
            transcript: '',
            specialRequirements: '',
          };

          const reviewBuffer = await generateClassReviewContent(
            classInput,
            input.combinedFeedback,
            roadmapClass,
            { apiModel, apiKey, apiUrl }
          );

          return {
            success: true,
            content: reviewBuffer.toString('base64'),
          };
        } catch (error) {
          console.error('[generateClassReview] 生成复习文档失败:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : '生成复习文档失败',
          });
        }
      }),

    // 小班课步骤3: 生成测试本
    generateClassTest: protectedProcedure
      .input(z.object({
        classNumber: z.string(),
        lessonNumber: z.string().optional(),
        lessonDate: z.string().optional(),
        attendanceStudents: z.array(z.string()),
        currentNotes: z.string(),
        combinedFeedback: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmapClass: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
          const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
          const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
          const roadmapClass = input.roadmapClass || await getConfig("roadmapClass") || "";

          const classInput: ClassFeedbackInput = {
            classNumber: input.classNumber,
            lessonNumber: input.lessonNumber || '',
            lessonDate: input.lessonDate || '',
            nextLessonDate: '',
            attendanceStudents: input.attendanceStudents,
            lastFeedback: '',
            currentNotes: input.currentNotes,
            transcript: '',
            specialRequirements: '',
          };

          const testBuffer = await generateClassTestContent(
            classInput,
            input.combinedFeedback,
            roadmapClass,
            { apiModel, apiKey, apiUrl }
          );

          return {
            success: true,
            content: testBuffer.toString('base64'),
          };
        } catch (error) {
          console.error('[generateClassTest] 生成测试本失败:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : '生成测试本失败',
          });
        }
      }),

    // 小班课步骤4: 生成课后信息提取
    generateClassExtraction: protectedProcedure
      .input(z.object({
        classNumber: z.string(),
        lessonNumber: z.string().optional(),
        lessonDate: z.string().optional(),
        attendanceStudents: z.array(z.string()),
        combinedFeedback: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmapClass: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
          const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
          const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
          const roadmapClass = input.roadmapClass || await getConfig("roadmapClass") || "";

          const classInput: ClassFeedbackInput = {
            classNumber: input.classNumber,
            lessonNumber: input.lessonNumber || '',
            lessonDate: input.lessonDate || '',
            nextLessonDate: '',
            attendanceStudents: input.attendanceStudents,
            lastFeedback: '',
            currentNotes: '',
            transcript: '',
            specialRequirements: '',
          };

          const extraction = await generateClassExtractionContent(
            classInput,
            input.combinedFeedback,
            roadmapClass,
            { apiModel, apiKey, apiUrl }
          );

          return {
            success: true,
            content: extraction,
          };
        } catch (error) {
          console.error('[generateClassExtraction] 生成课后信息提取失败:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : '生成课后信息提取失败',
          });
        }
      }),

    // 小班课步骤5: 为单个学生生成气泡图SVG
    generateClassBubbleChart: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        studentFeedback: z.string(),
        classNumber: z.string(),
        dateStr: z.string(),
        lessonNumber: z.string().optional(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmapClass: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
          const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
          const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
          const roadmapClass = input.roadmapClass || await getConfig("roadmapClass") || "";

          const svgContent = await generateClassBubbleChartSVG(
            input.studentFeedback,
            input.studentName,
            input.classNumber,
            input.dateStr,
            input.lessonNumber || '',
            { apiModel, apiKey, apiUrl, roadmapClass }
          );

          return {
            success: true,
            svg: svgContent,
          };
        } catch (error) {
          console.error('[generateClassBubbleChart] 生成气泡图失败:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : '生成气泡图失败',
          });
        }
      }),
    
    // 小班课上传文件到 Google Drive
    uploadClassFile: protectedProcedure
      .input(z.object({
        classNumber: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        fileType: z.enum(['feedback', 'review', 'test', 'extraction', 'bubbleChart']),
        studentName: z.string().optional(), // 反馈和气泡图需要
        content: z.string(), // base64 或文本
        driveBasePath: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // 小班课优先使用 classStoragePath，如果没有则使用 driveBasePath
        const classStoragePath = await getConfig("classStoragePath");
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
        const effectivePath = classStoragePath || driveBasePath;
        // 路径格式：{basePath}/{classNumber}班/
        const basePath = `${effectivePath}/${input.classNumber}班`;
        
        let fileName: string;
        let filePath: string;
        let contentBuffer: Buffer | string;
        
        switch (input.fileType) {
          case 'feedback':
            // 1份完整的学情反馈，文件名用班号
            fileName = `${input.classNumber}班${input.lessonNumber || ''}.md`;
            filePath = `${basePath}/学情反馈/${fileName}`;
            contentBuffer = input.content;
            break;
          case 'review':
            fileName = `${input.classNumber}班${input.lessonNumber || ''}复习文档.docx`;
            filePath = `${basePath}/复习文档/${fileName}`;
            contentBuffer = Buffer.from(input.content, 'base64');
            break;
          case 'test':
            fileName = `${input.classNumber}班${input.lessonNumber || ''}测试文档.docx`;
            filePath = `${basePath}/复习文档/${fileName}`;
            contentBuffer = Buffer.from(input.content, 'base64');
            break;
          case 'extraction':
            fileName = `${input.classNumber}班${input.lessonNumber || ''}课后信息提取.md`;
            filePath = `${basePath}/课后信息/${fileName}`;
            contentBuffer = input.content;
            break;
          case 'bubbleChart':
            fileName = `${input.studentName}${input.lessonNumber || ''}气泡图.png`;
            filePath = `${basePath}/气泡图/${fileName}`;
            contentBuffer = Buffer.from(input.content, 'base64');
            break;
          default:
            throw new Error(`未知文件类型: ${input.fileType}`);
        }
        
        // 解析文件路径，分离文件名和文件夹路径
        const lastSlash = filePath.lastIndexOf('/');
        const folderPath = filePath.substring(0, lastSlash);
        
        let result;
        if (typeof contentBuffer === 'string') {
          result = await uploadToGoogleDrive(contentBuffer, fileName, folderPath);
        } else {
          result = await uploadBinaryToGoogleDrive(contentBuffer, fileName, folderPath);
        }
        
        if (result.status === 'error') {
          throw new Error(`文件上传失败: ${result.error || '上传到Google Drive失败'}`);
        }
        
        return {
          success: true,
          fileName,
          url: result.url || '',
          path: filePath,
        };
      }),
  }),

  // 从 Google Drive 网盘读取文件
  localFile: router({
    // 诊断端点：测试 Google Drive OAuth 连接和文件搜索
    diagnose: protectedProcedure
      .input(z.object({
        testFileName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const diagnostics: string[] = [];
        const { getValidToken } = await import('./googleAuth');

        // 1. 检查 OAuth token
        const token = await getValidToken();
        if (!token) {
          diagnostics.push('❌ OAuth token 不可用 - 请在设置中授权 Google Drive');
          return { diagnostics, success: false };
        }
        diagnostics.push('✅ OAuth token 有效');

        // 2. 测试 API 连接 - 列出根目录
        try {
          const res = await fetch(`https://www.googleapis.com/drive/v3/files?q='root' in parents and trashed=false&fields=files(id,name,mimeType)&pageSize=10`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            const errText = await res.text();
            diagnostics.push(`❌ Drive API 返回 ${res.status}: ${errText}`);
            return { diagnostics, success: false };
          }
          const data = await res.json();
          const folderNames = (data.files || []).map((f: any) => f.name);
          diagnostics.push(`✅ Drive API 正常 - 根目录文件夹: ${folderNames.join(', ')}`);
        } catch (err: any) {
          diagnostics.push(`❌ Drive API 请求失败: ${err.message}`);
          return { diagnostics, success: false };
        }

        // 3. 测试 driveBasePath 导航
        const driveBasePath = await getConfig("driveBasePath") || "Mac/Documents/XDF/学生档案";
        diagnostics.push(`配置路径: ${driveBasePath}`);

        const parts = driveBasePath.split('/').filter((p: string) => p);
        let parentId = 'root';
        let navOk = true;
        for (const folderName of parts) {
          const q = `name='${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
          const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`;
          const res = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (data.files && data.files.length > 0) {
            parentId = data.files[0].id;
            diagnostics.push(`  ✅ 文件夹 "${folderName}" 找到 (id=${parentId})`);
          } else {
            diagnostics.push(`  ❌ 文件夹 "${folderName}" 不存在 (parent=${parentId})`);
            // 列出该层级的所有文件夹以帮助诊断
            const listQ = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
            const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(listQ)}&fields=files(id,name)&pageSize=20`;
            const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
            const listData = await listRes.json();
            const available = (listData.files || []).map((f: any) => f.name);
            diagnostics.push(`  📁 该层级可用文件夹: ${available.length > 0 ? available.join(', ') : '(空)'}`);
            navOk = false;
            break;
          }
        }

        // 4. 如果提供了测试文件名，尝试全局搜索
        if (input.testFileName) {
          const q = `name='${input.testFileName.replace(/'/g, "\\'")}' and trashed=false`;
          const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)&pageSize=5`;
          const res = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (data.files && data.files.length > 0) {
            diagnostics.push(`✅ 全局搜索 "${input.testFileName}" 找到 ${data.files.length} 个结果: ${data.files.map((f: any) => f.name).join(', ')}`);
          } else {
            diagnostics.push(`❌ 全局搜索 "${input.testFileName}" 无结果`);
          }
        }

        return { diagnostics, success: navOk };
      }),

    // 从 Google Drive 的 Downloads 文件夹读取录音转文字
    readFromDownloads: protectedProcedure
      .input(z.object({
        fileName: z.string().min(1, "请提供文件名"),
        allowSplit: z.boolean().optional(), // 允许分段文件检索（-1, -2）
      }))
      .mutation(async ({ input }) => {
        const { fileName, allowSplit } = input;

        const ext = path.extname(fileName).toLowerCase();
        if (!['.docx', '.txt', '.md'].includes(ext)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '只支持 .docx、.txt、.md 文件',
          });
        }

        // 策略：先在 Downloads 目录精确读取，找不到再搜索
        const gdriveDownloadsPath = await getConfig("gdriveDownloadsPath");

        // 辅助函数：尝试读取单个文件（精确路径 → 搜索）
        async function tryReadFile(name: string): Promise<{ buffer: Buffer; resolvedName: string } | null> {
          let buffer: Buffer | null = null;
          let resolvedName = name;

          if (gdriveDownloadsPath) {
            try {
              buffer = await readFileFromGoogleDrive(`${gdriveDownloadsPath}/${name}`);
              console.log(`[readFromDownloads] 精确路径找到: ${gdriveDownloadsPath}/${name}`);
            } catch {
              // 继续搜索
            }
          }

          if (!buffer) {
            const result = await searchFileInGoogleDrive([name], gdriveDownloadsPath || undefined);
            if (result) {
              buffer = result.buffer;
              resolvedName = result.fullPath.split('/').pop() || name;
              console.log(`[readFromDownloads] 搜索找到: ${result.fullPath}`);
            }
          }

          return buffer ? { buffer, resolvedName } : null;
        }

        // 辅助函数：解析文件内容
        async function parseFileContent(buffer: Buffer, name: string): Promise<string> {
          const fileExt = path.extname(name).toLowerCase();
          if (fileExt === '.docx') {
            const { parseDocxToText } = await import('./utils/documentParser');
            return await parseDocxToText(buffer);
          }
          return buffer.toString('utf-8');
        }

        // 第一优先级：完整文件（如 孙浩然0206.docx）
        const mainResult = await tryReadFile(fileName);

        if (mainResult) {
          const content = await parseFileContent(mainResult.buffer, mainResult.resolvedName);
          if (!content.trim()) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '文件内容为空' });
          }
          return { content: content.trim(), fileName: mainResult.resolvedName };
        }

        // 第二优先级：分段文件（如 孙浩然0206-1.docx + 孙浩然0206-2.docx）
        if (allowSplit) {
          const baseName = path.basename(fileName, ext); // 如 "孙浩然0206"
          const part1Name = `${baseName}-1${ext}`;
          const part1Result = await tryReadFile(part1Name);

          if (part1Result) {
            console.log(`[readFromDownloads] 分段模式：找到第1段 ${part1Name}`);
            const part1Content = await parseFileContent(part1Result.buffer, part1Result.resolvedName);

            // 找到 -1，继续找 -2
            const part2Name = `${baseName}-2${ext}`;
            const part2Result = await tryReadFile(part2Name);

            if (part2Result) {
              console.log(`[readFromDownloads] 分段模式：找到第2段 ${part2Name}，合并两段`);
              const part2Content = await parseFileContent(part2Result.buffer, part2Result.resolvedName);
              const merged = (part1Content.trim() + '\n\n' + part2Content.trim()).trim();
              if (!merged) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '分段文件内容均为空' });
              }
              return {
                content: merged,
                fileName: `${baseName}-1+2${ext}`,
              };
            } else {
              // 有 -1 就一定有 -2，找不到说明第2段还没下载
              throw new TRPCError({
                code: 'NOT_FOUND',
                message: `找到了第1段 ${part1Name}，但未找到第2段 ${part2Name}\n请检查是否已下载完整的录音转文字文件`,
              });
            }
          }
        }

        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `在 Google Drive 未找到文件: ${fileName}${allowSplit ? `\n也未找到分段文件: ${path.basename(fileName, ext)}-1${ext}` : ''}\n已尝试: ${gdriveDownloadsPath ? `指定目录(${gdriveDownloadsPath})` : '(未配置Downloads路径)'} + 全局搜索`,
        });
      }),

    // 从 Google Drive 读取上次学情反馈
    readLastFeedback: protectedProcedure
      .input(z.object({
        studentName: z.string().default(""),
        lessonNumber: z.string().min(1),
        courseType: z.enum(['oneToOne', 'class']).default('oneToOne'),
        classNumber: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { studentName, lessonNumber, courseType, classNumber } = input;

        // 一对一模式必须有学生姓名
        if (courseType === 'oneToOne' && !studentName.trim()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '请输入学生姓名' });
        }
        // 小班课模式必须有班号
        if (courseType === 'class' && !classNumber?.trim()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '请输入班号' });
        }

        const currentLesson = parseInt(lessonNumber.replace(/[^0-9]/g, ''), 10);
        if (isNaN(currentLesson) || currentLesson <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '首次课没有上次反馈可加载',
          });
        }
        const prevLesson = currentLesson - 1;

        // 小班课优先使用 classStoragePath，一对一使用 driveBasePath
        let driveBasePath: string;
        if (courseType === 'class') {
          const classStoragePath = await getConfig("classStoragePath");
          driveBasePath = classStoragePath || await getConfig("driveBasePath") || "Mac/Documents/XDF/学生档案";
        } else {
          driveBasePath = await getConfig("driveBasePath") || "Mac/Documents/XDF/学生档案";
        }

        // 构建文件名候选列表和搜索目录
        let folderName: string;
        const candidateFileNames: string[] = [];
        if (courseType === 'class' && classNumber) {
          folderName = `${classNumber}班`;
          const prefixes = [
            `${classNumber}班${prevLesson}`,
            `${classNumber}班 ${prevLesson}`,
          ];
          for (const prefix of prefixes) {
            candidateFileNames.push(`${prefix}.md`, `${prefix}.docx`, `${prefix}.txt`);
          }
        } else {
          folderName = studentName;
          const prefixes = [
            `${studentName}${prevLesson}`,
            `${studentName} ${prevLesson}`,
          ];
          for (const prefix of prefixes) {
            candidateFileNames.push(`${prefix}.md`, `${prefix}.docx`, `${prefix}.txt`);
          }
        }

        const feedbackFolder = `${driveBasePath}/${folderName}/学情反馈`;

        // 收集诊断信息
        const diag: string[] = [];
        let foundBuffer: Buffer | null = null;
        let foundFileName: string | null = null;

        // 阶段1：精确路径尝试（优先，速度快）
        let firstError: string | null = null;
        for (const candidateName of candidateFileNames) {
          const candidatePath = `${feedbackFolder}/${candidateName}`;
          try {
            const buf = await readFileFromGoogleDrive(candidatePath);
            if (buf.length > 0) {
              foundBuffer = buf;
              foundFileName = candidateName;
              console.log(`[readLastFeedback] 精确路径找到: ${candidatePath}`);
              break;
            }
          } catch (err: any) {
            if (!firstError) firstError = err.message || String(err);
          }
        }
        if (!foundBuffer) {
          diag.push(`精确路径: 全部未命中 (首条错误: ${firstError || 'unknown'})`);
        }

        // 不做全局搜索兜底，避免搜到 Downloads 文件夹里的同名笔记文件
        if (!foundBuffer || !foundFileName) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `未找到第${prevLesson}次课反馈\n路径: ${feedbackFolder}\n候选: ${candidateFileNames.slice(0, 3).join(', ')}...\n诊断: ${diag.join(' | ')}\n\n请确认文件存在于学情反馈文件夹中`,
          });
        }

        const foundExt = path.extname(foundFileName).toLowerCase();
        let content: string;
        if (foundExt === '.docx') {
          const { parseDocxToText } = await import('./utils/documentParser');
          content = await parseDocxToText(foundBuffer);
        } else {
          content = foundBuffer.toString('utf-8');
        }

        if (!content.trim()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '文件内容为空',
          });
        }

        return {
          content: content.trim(),
          fileName: foundFileName,
          prevLesson,
        };
      }),
  }),

  // 后台任务管理
  bgTask: router({
    // 提交后台任务
    submit: protectedProcedure
      .input(z.object({
        courseType: z.enum(["one-to-one", "class"]),
        // 共用字段
        lessonNumber: z.string().optional(),
        lessonDate: z.string().optional(),
        currentYear: z.string().optional(),
        lastFeedback: z.string().optional(),
        currentNotes: z.string().min(1),
        transcript: z.string().min(1),
        specialRequirements: z.string().optional(),
        // 一对一字段
        studentName: z.string().optional(),
        isFirstLesson: z.boolean().optional(),
        // 小班课字段
        classNumber: z.string().optional(),
        attendanceStudents: z.array(z.string()).optional(),
        // 配置快照
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        roadmapClass: z.string().optional(),
        driveBasePath: z.string().optional(),
        classStoragePath: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { startBackgroundTask, cleanupOldTasks } = await import("./backgroundTaskRunner");
        const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        // 先清理旧任务
        await cleanupOldTasks();

        // 生成任务 ID 和显示名
        const taskId = crypto.randomUUID();
        let displayName: string;
        if (input.courseType === "one-to-one") {
          if (!input.studentName) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入学生姓名" });
          displayName = `${input.studentName} 第${input.lessonNumber || "?"}次`;
        } else {
          if (!input.classNumber) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入班号" });
          displayName = `${input.classNumber}班 第${input.lessonNumber || "?"}次`;
        }

        // 构建参数
        const taskParams = { ...input };

        // 插入任务记录
        await db.insert(bgTasksTable).values({
          id: taskId,
          courseType: input.courseType,
          displayName,
          status: "pending",
          currentStep: 0,
          totalSteps: 5,
          inputParams: JSON.stringify(taskParams),
        });

        // 启动后台处理（不等待）
        startBackgroundTask(taskId);

        return { taskId, displayName };
      }),

    // 查询单个任务状态
    status: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .query(async ({ input }) => {
        const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        const tasks = await db.select().from(bgTasksTable).where(eq(bgTasksTable.id, input.taskId)).limit(1);
        if (tasks.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });

        const task = tasks[0];
        return {
          id: task.id,
          courseType: task.courseType,
          displayName: task.displayName,
          status: task.status,
          currentStep: task.currentStep,
          totalSteps: task.totalSteps,
          stepResults: (() => { try { return task.stepResults ? JSON.parse(task.stepResults) : null; } catch { return null; } })(),
          errorMessage: task.errorMessage,
          createdAt: task.createdAt.toISOString(),
          completedAt: task.completedAt?.toISOString() || null,
        };
      }),

    // 查询最近3天的任务历史
    history: protectedProcedure.query(async () => {
      const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
      const db = await getDb();
      if (!db) return [];

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const tasks = await db.select({
        id: bgTasksTable.id,
        courseType: bgTasksTable.courseType,
        displayName: bgTasksTable.displayName,
        status: bgTasksTable.status,
        currentStep: bgTasksTable.currentStep,
        totalSteps: bgTasksTable.totalSteps,
        stepResults: bgTasksTable.stepResults,
        errorMessage: bgTasksTable.errorMessage,
        createdAt: bgTasksTable.createdAt,
        completedAt: bgTasksTable.completedAt,
      })
        .from(bgTasksTable)
        .where(gte(bgTasksTable.createdAt, threeDaysAgo))
        .orderBy(desc(bgTasksTable.createdAt));

      return tasks.map((t) => {
          // 从历史列表中剥离 feedback.content（太大，按需加载）
          let stepResults = null;
          try {
            stepResults = t.stepResults ? JSON.parse(t.stepResults) : null;
          } catch {
            console.error(`[bgTask.history] 任务 ${t.id} stepResults JSON损坏`);
          }
          if (stepResults?.feedback?.content) {
            delete stepResults.feedback.content;
          }
          return {
            id: t.id,
            courseType: t.courseType,
            displayName: t.displayName,
            status: t.status,
            currentStep: t.currentStep,
            totalSteps: t.totalSteps,
            stepResults,
            errorMessage: t.errorMessage,
            createdAt: t.createdAt.toISOString(),
            completedAt: t.completedAt?.toISOString() || null,
          };
        });
    }),

    // 获取反馈全文（按需加载）
    feedbackContent: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .query(async ({ input }) => {
        const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        const tasks = await db.select({ stepResults: bgTasksTable.stepResults })
          .from(bgTasksTable)
          .where(eq(bgTasksTable.id, input.taskId))
          .limit(1);
        if (tasks.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });

        let stepResults = null;
        try {
          stepResults = tasks[0].stepResults ? JSON.parse(tasks[0].stepResults) : null;
        } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "任务数据损坏，无法解析" });
        }
        const content = stepResults?.feedback?.content || null;
        if (!content) throw new TRPCError({ code: "NOT_FOUND", message: "反馈内容不可用（可能是旧任务）" });
        return { content };
      }),

    // 取消运行中的任务
    cancel: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .mutation(async ({ input }) => {
        const { cancelBackgroundTask } = await import("./backgroundTaskRunner");
        const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        // 检查任务是否存在且在运行中
        const tasks = await db.select({ status: bgTasksTable.status })
          .from(bgTasksTable)
          .where(eq(bgTasksTable.id, input.taskId))
          .limit(1);
        if (tasks.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        if (tasks[0].status !== "running" && tasks[0].status !== "pending") {
          return { success: false, message: "任务不在运行状态" };
        }

        const cancelled = cancelBackgroundTask(input.taskId);
        if (!cancelled) {
          // 任务可能是pending（还没开始），直接在DB中标记取消
          await db.update(bgTasksTable).set({
            status: "cancelled",
            errorMessage: "用户手动取消",
            completedAt: new Date(),
          }).where(eq(bgTasksTable.id, input.taskId));
        }
        return { success: true, message: "取消请求已发送" };
      }),
  }),

  // 简单计算功能（保留MVP验证）
  calculate: router({
    compute: protectedProcedure
      .input(z.object({
        expression: z.string().min(1, "请输入算术表达式"),
        studentName: z.string().default("李四"),
      }))
      .mutation(async ({ input }) => {
        const { expression, studentName } = input;
        
        const response = await invokeLLM({
          messages: [
            { 
              role: "system", 
              content: "你是一个计算器。用户会给你一个算术表达式，请直接返回计算结果，只返回数字，不要有任何其他文字。" 
            },
            { 
              role: "user", 
              content: expression 
            },
          ],
        });

        const result = response.choices[0]?.message?.content || "计算失败";
        
        const fileContent = `# 计算结果\n\n表达式：${expression}\n结果：${result}\n\n生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
        
        const fileName = `${studentName}计算结果.md`;
        const folderPath = `Mac/Documents/XDF/学生档案/${studentName}/课后信息`;
        
        try {
          const driveResult = await uploadToGoogleDrive(fileContent, fileName, folderPath);
          return {
            success: true,
            expression,
            result,
            driveUrl: driveResult.url,
            filePath: driveResult.path,
          };
        } catch (error) {
          console.error("Google Drive上传失败:", error);
          return {
            success: false,
            expression,
            result,
            error: "文件上传失败，但计算成功",
          };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
