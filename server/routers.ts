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
import { 
  generateFeedbackContent, 
  generateReviewContent, 
  generateTestContent, 
  generateExtractionContent, 
  generateBubbleChart,
  FeedbackInput 
} from "./feedbackGenerator";

// 默认配置值
const DEFAULT_CONFIG = {
  apiModel: "claude-sonnet-4-5-20250929",
  apiKey: process.env.WHATAI_API_KEY || "sk-WyfaRl3qxKk8gpaptVWUfe1ZiJYQg0Vqjd7nscsZMT4l0c9U",
  apiUrl: "https://www.DMXapi.com/v1",
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

// 共享的输入schema（移除日期字段）
const feedbackInputSchema = z.object({
  studentName: z.string().min(1, "请输入学生姓名"),
  lessonNumber: z.string().optional(),
  lastFeedback: z.string().optional(),
  currentNotes: z.string().min(1, "请输入本次课笔记"),
  transcript: z.string().min(1, "请输入录音转文字"),
  isFirstLesson: z.boolean().default(false),
  specialRequirements: z.string().optional(),
  // 可选的配置覆盖
  apiModel: z.string().optional(),
  apiKey: z.string().optional(),
  apiUrl: z.string().optional(),
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
      
      return {
        apiModel: apiModel || DEFAULT_CONFIG.apiModel,
        apiKey: apiKey || DEFAULT_CONFIG.apiKey,
        apiUrl: apiUrl || DEFAULT_CONFIG.apiUrl,
        // 返回是否使用默认值
        isDefault: {
          apiModel: !apiModel,
          apiKey: !apiKey,
          apiUrl: !apiUrl,
        }
      };
    }),

    // 更新配置
    update: publicProcedure
      .input(z.object({
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
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
        keys: z.array(z.enum(["apiModel", "apiKey", "apiUrl"])),
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
        // 获取配置（优先使用传入的，否则用数据库的，最后用默认的）
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤1: 开始生成学情反馈...`);
        console.log(`[${new Date().toLocaleTimeString()}] 使用模型: ${apiModel}`);
        
        const feedbackContent = await generateFeedbackContent({
          studentName: input.studentName,
          lessonNumber: input.lessonNumber || "",
          lessonDate: "", // AI会自动从笔记中提取
          nextLessonDate: "", // AI会自动从笔记中提取
          lastFeedback: input.lastFeedback || "",
          currentNotes: input.currentNotes,
          transcript: input.transcript,
          isFirstLesson: input.isFirstLesson,
          specialRequirements: input.specialRequirements || "",
        }, { apiModel, apiKey, apiUrl });

        // 从反馈内容中提取日期（AI会在反馈开头写日期）
        const dateMatch = feedbackContent.match(/(\d{1,2}月\d{1,2}日)/);
        const dateStr = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace('/', '月') + '日';

        // 上传到Google Drive
        const basePath = `Mac/Documents/XDF/学生档案/${input.studentName}`;
        const fileName = `${input.studentName}${dateStr}阅读课反馈.md`;
        const folderPath = `${basePath}/学情反馈`;
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤1: 上传学情反馈到Google Drive...`);
        const uploadResult = await uploadToGoogleDrive(feedbackContent, fileName, folderPath);
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤1: 学情反馈完成`);
        
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
      }))
      .mutation(async ({ input }) => {
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤2: 开始生成复习文档...`);
        
        const reviewDocx = await generateReviewContent(
          input.feedbackContent, 
          input.studentName, 
          input.dateStr,
          { apiModel, apiKey, apiUrl }
        );

        const basePath = `Mac/Documents/XDF/学生档案/${input.studentName}`;
        const fileName = `${input.studentName}${input.dateStr}复习文档.docx`;
        const folderPath = `${basePath}/复习文档`;
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤2: 上传复习文档到Google Drive...`);
        const uploadResult = await uploadBinaryToGoogleDrive(reviewDocx, fileName, folderPath);
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤2: 复习文档完成`);
        
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
      }))
      .mutation(async ({ input }) => {
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤3: 开始生成测试本...`);
        
        const testDocx = await generateTestContent(
          input.feedbackContent, 
          input.studentName, 
          input.dateStr,
          { apiModel, apiKey, apiUrl }
        );

        const basePath = `Mac/Documents/XDF/学生档案/${input.studentName}`;
        const fileName = `${input.studentName}${input.dateStr}测试文档.docx`;
        const folderPath = `${basePath}/复习文档`;
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤3: 上传测试本到Google Drive...`);
        const uploadResult = await uploadBinaryToGoogleDrive(testDocx, fileName, folderPath);
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤3: 测试本完成`);
        
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
      }))
      .mutation(async ({ input }) => {
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤4: 开始生成课后信息提取...`);
        
        const extractionContent = await generateExtractionContent(
          input.studentName, 
          "", // 下次课日期由AI从笔记中提取
          input.feedbackContent,
          { apiModel, apiKey, apiUrl }
        );

        const basePath = `Mac/Documents/XDF/学生档案/${input.studentName}`;
        const fileName = `${input.studentName}${input.dateStr}课后信息提取.md`;
        const folderPath = `${basePath}/课后信息`;
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤4: 上传课后信息提取到Google Drive...`);
        const uploadResult = await uploadToGoogleDrive(extractionContent, fileName, folderPath);
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤4: 课后信息提取完成`);
        
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
      }),

    // 步骤5: 生成气泡图
    generateBubbleChart: publicProcedure
      .input(z.object({
        studentName: z.string(),
        dateStr: z.string(),
        lessonNumber: z.string().optional(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤5: 开始生成气泡图...`);
        
        const bubbleChartPng = await generateBubbleChart(
          input.feedbackContent,
          input.studentName,
          input.dateStr,
          input.lessonNumber || "",
          { apiModel, apiKey, apiUrl }
        );

        const basePath = `Mac/Documents/XDF/学生档案/${input.studentName}`;
        const fileName = `${input.studentName}${input.dateStr}气泡图.png`;
        const folderPath = `${basePath}/气泡图`;
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤5: 上传气泡图到Google Drive...`);
        const uploadResult = await uploadBinaryToGoogleDrive(bubbleChartPng, fileName, folderPath);
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤5: 气泡图完成`);
        
        return {
          success: true,
          step: 5,
          stepName: "气泡图",
          uploadResult: {
            fileName,
            url: uploadResult.url || "",
            path: uploadResult.path || "",
            folderUrl: uploadResult.folderUrl || "",
          },
        };
      }),

    // 最终验证
    verifyAll: publicProcedure
      .input(z.object({
        studentName: z.string(),
        dateStr: z.string(),
      }))
      .mutation(async ({ input }) => {
        console.log(`[${new Date().toLocaleTimeString()}] 最终验证: 检查所有文件...`);
        
        const basePath = `Mac/Documents/XDF/学生档案/${input.studentName}`;
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
