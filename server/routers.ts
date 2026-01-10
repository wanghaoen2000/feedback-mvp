import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { systemConfig } from "../drizzle/schema";
import { uploadToGoogleDrive, uploadBinaryToGoogleDrive, verifyAllFiles, UploadStatus } from "./gdrive";
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
  generateBubbleChart,
  generateBubbleChartSVG,
  FeedbackInput,
  ClassFeedbackInput,
  generateClassFeedbackContent,
  generateClassReviewContent,
  generateClassTestContent,
  generateClassExtractionContent,
  generateClassBubbleChartSVG,
} from "./feedbackGenerator";

// 默认配置值
const DEFAULT_CONFIG = {
  apiModel: "claude-sonnet-4-5-20250929",
  apiKey: process.env.WHATAI_API_KEY || "sk-WyfaRl3qxKk8gpaptVWUfe1ZiJYQg0Vqjd7nscsZMT4l0c9U",
  apiUrl: "https://www.DMXapi.com/v1",
  currentYear: "2026",
  roadmap: "",
  driveBasePath: "Mac/Documents/XDF/学生档案",
};

// 获取配置值（优先从数据库，否则用默认值）
async function getConfig(key: string): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return DEFAULT_CONFIG[key as keyof typeof DEFAULT_CONFIG] || "";
    const result = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
    if (result.length > 0 && result[0].value) {
      return result[0].value;
    }
  } catch (e) {
    console.error(`获取配置 ${key} 失败:`, e);
  }
  return DEFAULT_CONFIG[key as keyof typeof DEFAULT_CONFIG] || "";
}

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
});

// 小班课输入schema
const classFeedbackInputSchema = z.object({
  classNumber: z.string().min(1, "请输入班号"),
  lessonNumber: z.string().optional(),
  lessonDate: z.string().optional(), // 本次课日期，如"1月15日"
  currentYear: z.string().optional(), // 年份，如"2026"
  attendanceStudents: z.array(z.string()).min(2, "至少需要2名学生"),
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
    getAll: publicProcedure.query(async () => {
      const apiModel = await getConfig("apiModel");
      const apiKey = await getConfig("apiKey");
      const apiUrl = await getConfig("apiUrl");
      const currentYear = await getConfig("currentYear");
      const roadmap = await getConfig("roadmap");
      const roadmapClass = await getConfig("roadmapClass");
      const firstLessonTemplate = await getConfig("firstLessonTemplate");
      const classFirstLessonTemplate = await getConfig("classFirstLessonTemplate");
      const driveBasePath = await getConfig("driveBasePath");
      
      return {
        apiModel: apiModel || DEFAULT_CONFIG.apiModel,
        apiKey: apiKey || DEFAULT_CONFIG.apiKey,
        apiUrl: apiUrl || DEFAULT_CONFIG.apiUrl,
        currentYear: currentYear || DEFAULT_CONFIG.currentYear,
        roadmap: roadmap || "",
        roadmapClass: roadmapClass || "",
        firstLessonTemplate: firstLessonTemplate || "",
        classFirstLessonTemplate: classFirstLessonTemplate || "",
        driveBasePath: driveBasePath || DEFAULT_CONFIG.driveBasePath,
        // 返回是否使用默认值
        isDefault: {
          apiModel: !apiModel,
          apiKey: !apiKey,
          apiUrl: !apiUrl,
          currentYear: !currentYear,
          driveBasePath: !driveBasePath,
        }
      };
    }),

    // 更新配置
    update: publicProcedure
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
          await setConfig("driveBasePath", path, "Google Drive存储根路径");
          updates.push("driveBasePath");
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
    reset: publicProcedure
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
  }),

  // 学情反馈生成 - 拆分为5个独立端点
  feedback: router({
    // 步骤1: 生成学情反馈
    generateFeedback: publicProcedure
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
          // 组合年份和日期
          const lessonDate = input.lessonDate ? `${currentYear}年${input.lessonDate}` : "";
          
          const feedbackContent = await generateFeedbackContent({
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

          // 优先使用用户输入的日期，否则从反馈内容中提取
          let dateStr = input.lessonDate || "";
          if (!dateStr) {
            const dateMatch = feedbackContent.match(/(\d{1,2}月\d{1,2}日)/);
            dateStr = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace('/', '月') + '日';
          }

          // 上传到Google Drive
          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${dateStr}阅读课反馈.md`;
          const folderPath = `${basePath}/学情反馈`;
          
          logInfo(log, "学情反馈", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadToGoogleDrive(feedbackContent, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          stepSuccess(log, "学情反馈", feedbackContent.length);
          
          return {
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
    generateReview: publicProcedure
      .input(z.object({
        studentName: z.string(),
        dateStr: z.string(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
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
          const reviewDocx = await generateReviewContent(
            input.feedbackContent, 
            input.studentName, 
            input.dateStr,
            { apiModel, apiKey, apiUrl, roadmap }
          );

          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.dateStr}复习文档.docx`;
          const folderPath = `${basePath}/复习文档`;
          
          logInfo(log, "复习文档", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadBinaryToGoogleDrive(reviewDocx, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          stepSuccess(log, "复习文档", reviewDocx.length);
          endLogSession(log);
          
          return {
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
    generateTest: publicProcedure
      .input(z.object({
        studentName: z.string(),
        dateStr: z.string(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
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
          const testDocx = await generateTestContent(
            input.feedbackContent, 
            input.studentName, 
            input.dateStr,
            { apiModel, apiKey, apiUrl, roadmap }
          );

          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.dateStr}测试文档.docx`;
          const folderPath = `${basePath}/复习文档`;
          
          logInfo(log, "测试本", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadBinaryToGoogleDrive(testDocx, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          stepSuccess(log, "测试本", testDocx.length);
          endLogSession(log);
          
          return {
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
    generateExtraction: publicProcedure
      .input(z.object({
        studentName: z.string(),
        dateStr: z.string(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
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
          const extractionContent = await generateExtractionContent(
            input.studentName, 
            "",
            input.feedbackContent,
            { apiModel, apiKey, apiUrl, roadmap }
          );

          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.dateStr}课后信息提取.md`;
          const folderPath = `${basePath}/课后信息`;
          
          logInfo(log, "课后信息提取", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadToGoogleDrive(extractionContent, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          stepSuccess(log, "课后信息提取", extractionContent.length);
          endLogSession(log);
          
          return {
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
    generateBubbleChart: publicProcedure
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
            input.feedbackContent,
            input.studentName,
            input.dateStr,
            input.lessonNumber || "",
            { apiModel, apiKey, apiUrl, roadmap }
          );
          
          stepSuccess(log, "气泡图", svgContent.length);
          endLogSession(log);
          
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
    uploadBubbleChart: publicProcedure
      .input(z.object({
        studentName: z.string(),
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
          const fileName = `${input.studentName}${input.dateStr}气泡图.png`;
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
    verifyAll: publicProcedure
      .input(z.object({
        studentName: z.string(),
        dateStr: z.string(),
        driveBasePath: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        console.log(`[${new Date().toLocaleTimeString()}] 最终验证: 检查所有文件...`);
        
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
        const basePath = `${driveBasePath}/${input.studentName}`;
        const filePaths = [
          `${basePath}/学情反馈/${input.studentName}${input.dateStr}阅读课反馈.md`,
          `${basePath}/复习文档/${input.studentName}${input.dateStr}复习文档.docx`,
          `${basePath}/复习文档/${input.studentName}${input.dateStr}测试文档.docx`,
          `${basePath}/课后信息/${input.studentName}${input.dateStr}课后信息提取.md`,
          `${basePath}/气泡图/${input.studentName}${input.dateStr}气泡图.png`,
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
    getLatestLog: publicProcedure
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
    exportLog: publicProcedure
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
    listLogs: publicProcedure
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
    systemCheck: publicProcedure
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
    googleAuthStatus: publicProcedure
      .query(async () => {
        return await googleAuth.getStatus();
      }),
    googleAuthUrl: publicProcedure
      .query(async () => {
        return { 
          url: googleAuth.getAuthUrl(),
          redirectUri: googleAuth.getRedirectUri()
        };
      }),
    googleAuthCallback: publicProcedure
      .input(z.object({ code: z.string() }))
      .mutation(async ({ input }) => {
        return await googleAuth.handleCallback(input.code);
      }),
    googleAuthDisconnect: publicProcedure
      .mutation(async () => {
        return await googleAuth.disconnect();
      }),
      
    // ========== 小班课生成接口 ==========
    
    // 小班课步骤1: 生成1份完整学情反馈
    generateClassFeedback: publicProcedure
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
        
        // 组合年份和日期（和一对一保持一致）
        const lessonDate = input.lessonDate ? `${currentYear}年${input.lessonDate}` : "";
        
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
          const feedback = await generateClassFeedbackContent(
            classInput,
            roadmapClass,
            { apiModel, apiKey, apiUrl }
          );
          
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
    generateClassReview: publicProcedure
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
      }),
    
    // 小班课步骤3: 生成测试本
    generateClassTest: publicProcedure
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
      }),
    
    // 小班课步骤4: 生成课后信息提取
    generateClassExtraction: publicProcedure
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
      }),
    
    // 小班课步骤5: 为单个学生生成气泡图SVG
    generateClassBubbleChart: publicProcedure
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
      }),
    
    // 小班课上传文件到 Google Drive
    uploadClassFile: publicProcedure
      .input(z.object({
        classNumber: z.string(),
        dateStr: z.string(),
        fileType: z.enum(['feedback', 'review', 'test', 'extraction', 'bubbleChart']),
        studentName: z.string().optional(), // 反馈和气泡图需要
        content: z.string(), // base64 或文本
        driveBasePath: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
        // 路径格式：{basePath}/{classNumber}班/
        const basePath = `${driveBasePath}/${input.classNumber}班`;
        
        let fileName: string;
        let filePath: string;
        let contentBuffer: Buffer | string;
        
        switch (input.fileType) {
          case 'feedback':
            // 1份完整的学情反馈，文件名用班号
            fileName = `${input.classNumber}班${input.dateStr}阅读课反馈.md`;
            filePath = `${basePath}/学情反馈/${fileName}`;
            contentBuffer = input.content;
            break;
          case 'review':
            fileName = `${input.classNumber}班${input.dateStr}复习文档.docx`;
            filePath = `${basePath}/复习文档/${fileName}`;
            contentBuffer = Buffer.from(input.content, 'base64');
            break;
          case 'test':
            fileName = `${input.classNumber}班${input.dateStr}测试文档.docx`;
            filePath = `${basePath}/复习文档/${fileName}`;
            contentBuffer = Buffer.from(input.content, 'base64');
            break;
          case 'extraction':
            fileName = `${input.classNumber}班${input.dateStr}课后信息提取.md`;
            filePath = `${basePath}/课后信息/${fileName}`;
            contentBuffer = input.content;
            break;
          case 'bubbleChart':
            fileName = `${input.studentName}${input.dateStr}气泡图.png`;
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

  // 简单计算功能（保留MVP验证）
  calculate: router({
    compute: publicProcedure
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
