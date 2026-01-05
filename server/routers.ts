import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { uploadToGoogleDrive, uploadMultipleFiles, verifyAllFiles, UploadResult } from "./gdrive";
import { generateFeedbackDocuments, StepStatus } from "./feedbackGenerator";

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

  // 学情反馈生成
  feedback: router({
    generate: publicProcedure
      .input(z.object({
        studentName: z.string().min(1, "请输入学生姓名"),
        lessonNumber: z.string().optional(),
        lessonDate: z.string().optional(),
        nextLessonDate: z.string().optional(),
        lastFeedback: z.string().optional(),
        currentNotes: z.string().min(1, "请输入本次课笔记"),
        transcript: z.string().min(1, "请输入录音转文字"),
        isFirstLesson: z.boolean().default(false),
        specialRequirements: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const {
          studentName,
          lessonNumber,
          lessonDate,
          nextLessonDate,
          lastFeedback,
          currentNotes,
          transcript,
          isFirstLesson,
          specialRequirements,
        } = input;

        const dateStr = lessonDate || new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace('/', '月') + '日';

        // 记录生成步骤状态
        const generationSteps: StepStatus[] = [];
        
        // 生成5个文档
        console.log(`[${new Date().toLocaleTimeString()}] 开始为 ${studentName} 生成文档...`);
        
        const documents = await generateFeedbackDocuments({
          studentName,
          lessonNumber: lessonNumber || "",
          lessonDate: dateStr,
          nextLessonDate: nextLessonDate || "",
          lastFeedback: lastFeedback || "",
          currentNotes,
          transcript,
          isFirstLesson,
          specialRequirements: specialRequirements || "",
        }, (step) => {
          console.log(`[${new Date().toLocaleTimeString()}] ${step.step}: ${step.status} - ${step.message || step.error || ''}`);
          generationSteps.push({ ...step });
        });

        // 上传到Google Drive
        const basePath = `Mac/Documents/XDF/学生档案/${studentName}`;
        
        const filesToUpload = [
          { content: documents.feedback, fileName: `${studentName}${dateStr}阅读课反馈.md`, folderPath: `${basePath}/学情反馈`, isBinary: false },
          { content: documents.review, fileName: `${studentName}${dateStr}复习文档.docx`, folderPath: `${basePath}/复习文档`, isBinary: true },
          { content: documents.test, fileName: `${studentName}${dateStr}测试文档.docx`, folderPath: `${basePath}/复习文档`, isBinary: true },
          { content: documents.extraction, fileName: `${studentName}${dateStr}课后信息提取.md`, folderPath: `${basePath}/课后信息`, isBinary: false },
          { content: documents.bubbleChart, fileName: `${studentName}${dateStr}气泡图.png`, folderPath: `${basePath}/气泡图`, isBinary: true },
        ];

        console.log(`[${new Date().toLocaleTimeString()}] 开始上传文件到Google Drive...`);
        
        const uploadResults = await uploadMultipleFiles(filesToUpload, (fileName, status) => {
          console.log(`[${new Date().toLocaleTimeString()}] 上传 ${fileName}: ${status.status} - ${status.message || status.error || ''}`);
        });

        // 最终验证所有文件
        console.log(`[${new Date().toLocaleTimeString()}] 开始最终验证...`);
        const filePaths = filesToUpload.map((f, i) => uploadResults[i]?.path || `${f.folderPath}/${f.fileName}`);
        const verification = await verifyAllFiles(filePaths);

        // 统计结果
        const successCount = uploadResults.filter(r => r.status === 'success').length;
        const errorCount = uploadResults.filter(r => r.status === 'error').length;
        const verifiedCount = verification.results.filter(r => r.exists).length;

        console.log(`[${new Date().toLocaleTimeString()}] 完成！成功: ${successCount}, 失败: ${errorCount}, 验证通过: ${verifiedCount}`);

        return {
          success: errorCount === 0,
          summary: {
            totalFiles: 5,
            successCount,
            errorCount,
            verifiedCount,
            allVerified: verification.allExist,
          },
          generationSteps: documents.steps,
          uploadResults: uploadResults.map((r, i) => ({
            ...r,
            verified: verification.results[i]?.exists || false,
            fileSize: verification.results[i]?.size,
          })),
          driveFolder: basePath,
          driveUrl: uploadResults.find(r => r.folderUrl)?.folderUrl || '',
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
