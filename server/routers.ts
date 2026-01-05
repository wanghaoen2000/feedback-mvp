import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { uploadToGoogleDrive, uploadBinaryToGoogleDrive, verifyAllFiles, UploadStatus } from "./gdrive";
import { 
  generateFeedbackContent, 
  generateReviewContent, 
  generateTestContent, 
  generateExtractionContent, 
  generateBubbleChart,
  FeedbackInput 
} from "./feedbackGenerator";

// 共享的输入schema
const feedbackInputSchema = z.object({
  studentName: z.string().min(1, "请输入学生姓名"),
  lessonNumber: z.string().optional(),
  lessonDate: z.string().optional(),
  nextLessonDate: z.string().optional(),
  lastFeedback: z.string().optional(),
  currentNotes: z.string().min(1, "请输入本次课笔记"),
  transcript: z.string().min(1, "请输入录音转文字"),
  isFirstLesson: z.boolean().default(false),
  specialRequirements: z.string().optional(),
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

  // 学情反馈生成 - 拆分为5个独立端点
  feedback: router({
    // 步骤1: 生成学情反馈
    generateFeedback: publicProcedure
      .input(feedbackInputSchema)
      .mutation(async ({ input }) => {
        const dateStr = input.lessonDate || new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace('/', '月') + '日';
        
        console.log(`[${new Date().toLocaleTimeString()}] 步骤1: 开始生成学情反馈...`);
        
        const feedbackContent = await generateFeedbackContent({
          studentName: input.studentName,
          lessonNumber: input.lessonNumber || "",
          lessonDate: dateStr,
          nextLessonDate: input.nextLessonDate || "",
          lastFeedback: input.lastFeedback || "",
          currentNotes: input.currentNotes,
          transcript: input.transcript,
          isFirstLesson: input.isFirstLesson,
          specialRequirements: input.specialRequirements || "",
        });

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
          feedbackContent, // 返回内容供后续步骤使用
          uploadResult: {
            fileName,
            url: uploadResult.url || "",
            path: uploadResult.path || "",
            folderUrl: uploadResult.folderUrl || "",
          },
          dateStr, // 返回日期字符串供后续步骤使用
        };
      }),

    // 步骤2: 生成复习文档
    generateReview: publicProcedure
      .input(z.object({
        studentName: z.string(),
        dateStr: z.string(),
        feedbackContent: z.string(),
      }))
      .mutation(async ({ input }) => {
        console.log(`[${new Date().toLocaleTimeString()}] 步骤2: 开始生成复习文档...`);
        
        const reviewDocx = await generateReviewContent(input.feedbackContent, input.studentName, input.dateStr);

        // 上传到Google Drive（二进制文件）
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
        feedbackContent: z.string(), // 使用反馈内容生成测试本
      }))
      .mutation(async ({ input }) => {
        console.log(`[${new Date().toLocaleTimeString()}] 步骤3: 开始生成测试本...`);
        
        const testDocx = await generateTestContent(input.feedbackContent, input.studentName, input.dateStr);

        // 上传到Google Drive（二进制文件）
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
        nextLessonDate: z.string().optional(),
        feedbackContent: z.string(),
      }))
      .mutation(async ({ input }) => {
        console.log(`[${new Date().toLocaleTimeString()}] 步骤4: 开始生成课后信息提取...`);
        
        const extractionContent = await generateExtractionContent(
          input.studentName, 
          input.nextLessonDate || "待定", 
          input.feedbackContent
        );

        // 上传到Google Drive
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
      }))
      .mutation(async ({ input }) => {
        console.log(`[${new Date().toLocaleTimeString()}] 步骤5: 开始生成气泡图...`);
        
        const bubbleChartPng = await generateBubbleChart(
          input.feedbackContent,
          input.studentName,
          input.dateStr,
          input.lessonNumber || ""
        );

        // 上传到Google Drive（二进制文件）
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
