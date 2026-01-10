/**
 * V45b: 小班课学情反馈 SSE 流式端点
 * 解决 Cloudflare 524 超时问题
 */
import { Express, Request, Response } from "express";
import { z } from "zod";
import { invokeWhatAIStream, APIConfig } from "./whatai";
import { ClassFeedbackInput } from "./feedbackGenerator";
import { getDb } from "./db";
import { systemConfig } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { uploadToGoogleDrive } from "./gdrive";

// 默认配置值（和 routers.ts 保持一致）
const DEFAULT_CONFIG = {
  apiModel: "claude-sonnet-4-5-20250929",
  apiKey: process.env.WHATAI_API_KEY || "sk-WyfaRl3qxKk8gpaptVWUfe1ZiJYQg0Vqjd7nscsZMT4l0c9U",
  apiUrl: "https://www.DMXapi.com/v1",
  currentYear: "2026",
  roadmap: "",
  driveBasePath: "Mac/Documents/XDF/学生档案",
};

// 获取配置值
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

// 小班课默认 system prompt
const CLASS_FEEDBACK_SYSTEM_PROMPT = `你是一个学情反馈生成助手。请根据用户提供的路书和课堂信息生成学情反馈。

【重要格式要求】
这份反馈是给家长看的，要能直接复制到微信群，所以：
1. 不要使用任何markdown标记（不要用#、**、*、\`\`\`等）
2. 不要用表格格式
3. 不要用自动编号（手打1. 2. 3.）
4. 不要用首行缩进
5. 可以用中括号【】来标记章节
6. 可以用空行分隔段落
7. 直接输出纯文本
8. 最后以【OK】结尾`;

// 不要互动指令
const NO_INTERACTION_INSTRUCTION = `

【重要】不要与用户互动，不要等待确认，不要询问任何问题，直接生成完整内容。`;

// 清理 markdown 和 HTML
function cleanMarkdownAndHtml(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 输入验证 schema
const classFeedbackInputSchema = z.object({
  classNumber: z.string().min(1),
  lessonNumber: z.string().optional(),
  lessonDate: z.string().optional(),
  currentYear: z.string().optional(),
  attendanceStudents: z.array(z.string()).min(2),
  lastFeedback: z.string().optional(),
  currentNotes: z.string().min(1),
  transcript: z.string().min(1),
  specialRequirements: z.string().optional(),
  apiModel: z.string().optional(),
  apiKey: z.string().optional(),
  apiUrl: z.string().optional(),
  roadmapClass: z.string().optional(),
  driveBasePath: z.string().optional(),
});

/**
 * 注册小班课 SSE 流式端点
 */
export function registerClassStreamRoutes(app: Express): void {
  // SSE 端点：小班课学情反馈流式生成
  app.post("/api/class-feedback-stream", async (req: Request, res: Response) => {
    console.log("[SSE] 收到小班课学情反馈流式请求");
    
    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲
    
    // 发送 SSE 事件的辅助函数
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    try {
      // 验证输入
      const parseResult = classFeedbackInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendEvent("error", { message: "输入验证失败", details: parseResult.error.issues });
        res.end();
        return;
      }
      
      const input = parseResult.data;
      
      // 获取配置
      const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
      const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
      const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
      const currentYear = input.currentYear || await getConfig("currentYear") || DEFAULT_CONFIG.currentYear;
      const roadmapClass = input.roadmapClass !== undefined ? input.roadmapClass : (await getConfig("roadmapClass") || "");
      
      // 组合年份和日期
      const lessonDate = input.lessonDate ? `${currentYear}年${input.lessonDate}` : "";
      
      // 构建输入
      const classInput: ClassFeedbackInput = {
        classNumber: input.classNumber,
        lessonNumber: input.lessonNumber || '',
        lessonDate: lessonDate,
        nextLessonDate: '',
        attendanceStudents: input.attendanceStudents.filter(s => s.trim()),
        lastFeedback: input.lastFeedback || '',
        currentNotes: input.currentNotes,
        transcript: input.transcript,
        specialRequirements: input.specialRequirements || '',
      };
      
      // 构建 prompt
      const studentList = classInput.attendanceStudents.join('、');
      const userPrompt = `请为以下小班课生成完整的学情反馈：

班号：${classInput.classNumber}
课次：${classInput.lessonNumber || '未指定'}
本次课日期：${classInput.lessonDate || '未指定'}
出勤学生：${studentList}

${classInput.lastFeedback ? `【上次课反馈】\n${classInput.lastFeedback}\n` : ''}
【本次课笔记】
${classInput.currentNotes}

【录音转文字】
${classInput.transcript}

${classInput.specialRequirements ? `【特殊要求】\n${classInput.specialRequirements}\n` : ''}

【重要边界限制】
本次只需要生成学情反馈文档，不要生成复习文档、测试本、课后信息提取或其他任何内容。
学情反馈文档以【OK】结束，输出【OK】后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

      const systemPrompt = roadmapClass && roadmapClass.trim() ? roadmapClass : CLASS_FEEDBACK_SYSTEM_PROMPT;
      
      console.log(`[SSE] 开始为 ${input.classNumber} 班生成学情反馈...`);
      console.log(`[SSE] 出勤学生: ${studentList}`);
      console.log(`[SSE] 路书长度: ${roadmapClass?.length || 0} 字符`);
      
      // 发送开始事件
      sendEvent("start", { 
        message: `开始为 ${input.classNumber} 班生成学情反馈`,
        students: classInput.attendanceStudents.length
      });
      
      const config: APIConfig = { apiModel, apiKey, apiUrl };
      
      let charCount = 0;
      let lastProgressTime = Date.now();
      
      // 调用流式 API，实时发送进度
      const content = await invokeWhatAIStream(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        { max_tokens: 16000 },
        config,
        (chunk: string) => {
          charCount += chunk.length;
          // 每秒最多发送一次进度更新，避免过于频繁
          const now = Date.now();
          if (now - lastProgressTime >= 1000) {
            sendEvent("progress", { chars: charCount });
            lastProgressTime = now;
          }
        }
      );
      
      // 清理内容
      const cleanedContent = cleanMarkdownAndHtml(content);
      
      console.log(`[SSE] 学情反馈生成完成，长度: ${cleanedContent.length} 字符`);
      
      // 发送完成事件
      sendEvent("complete", { 
        success: true,
        feedback: cleanedContent,
        chars: cleanedContent.length
      });
      
    } catch (error: any) {
      console.error("[SSE] 生成失败:", error);
      sendEvent("error", { 
        message: error.message || "生成失败",
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    } finally {
      res.end();
    }
  });
  
  console.log("[SSE] 小班课学情反馈流式端点已注册: POST /api/class-feedback-stream");
  
  // ========== V45c: 一对一学情反馈 SSE 端点 ==========
  
  // 一对一输入验证 schema
  const feedbackInputSchema = z.object({
    studentName: z.string().min(1),
    lessonNumber: z.string().optional(),
    lessonDate: z.string().optional(),
    currentYear: z.string().optional(),
    lastFeedback: z.string().optional(),
    currentNotes: z.string().min(1),
    transcript: z.string().min(1),
    isFirstLesson: z.boolean().default(false),
    specialRequirements: z.string().optional(),
    apiModel: z.string().optional(),
    apiKey: z.string().optional(),
    apiUrl: z.string().optional(),
    roadmap: z.string().optional(),
    driveBasePath: z.string().optional(),
  });
  
  // 一对一默认 system prompt
  const FEEDBACK_SYSTEM_PROMPT = `你是新东方托福阅读教师的反馈助手。请严格按照以下V9路书规范生成学情反馈。

【重要格式要求】
这份反馈是给家长看的，要能直接复制到微信群，所以：
1. 不要使用任何markdown标记（不要用#、**、*、\`\`\`等）
2. 不要用表格格式
3. 不要用自动编号（手打1. 2. 3.）
4. 不要用首行缩进
5. 可以用中括号【】来标记章节
6. 可以用空行分隔段落
7. 直接输出纯文本
8. 最后以【OK】结尾`;
  
  // SSE 端点：一对一学情反馈流式生成
  app.post("/api/feedback-stream", async (req: Request, res: Response) => {
    console.log("[SSE] 收到一对一学情反馈流式请求");
    
    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲
    
    // 发送 SSE 事件的辅助函数
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    try {
      // 验证输入
      const parseResult = feedbackInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendEvent("error", { message: "输入验证失败", details: parseResult.error.issues });
        res.end();
        return;
      }
      
      const input = parseResult.data;
      
      // 获取配置
      const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
      const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
      const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
      const currentYear = input.currentYear || await getConfig("currentYear") || DEFAULT_CONFIG.currentYear;
      const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap") || "");
      
      // 组合年份和日期
      const lessonDate = input.lessonDate ? `${currentYear}年${input.lessonDate}` : "";
      
      // 构建 prompt
      const userPrompt = `## 学生信息
- 学生姓名：${input.studentName}
- 课次：${input.lessonNumber || "未指定"}
${lessonDate ? `- 本次课日期：${lessonDate}` : "- 本次课日期：请从课堂笔记中提取"}
${input.isFirstLesson ? "- 这是新生首次课" : ""}
${input.specialRequirements ? `- 特殊要求：${input.specialRequirements}` : ""}

## 上次反馈
${input.isFirstLesson ? "（新生首次课，无上次反馈）" : (input.lastFeedback || "（未提供）")}

## 本次课笔记
${input.currentNotes}

## 录音转文字
${input.transcript}

请严格按照V9路书规范生成完整的学情反馈文档。
特别注意：
1. 不要使用任何markdown标记，输出纯文本
2. 【生词】部分必须达到15-25个，不足15个必须从课堂材料中补齐！
3. 请从课堂笔记中自动识别日期信息

【重要边界限制】
本次只需要生成学情反馈文档，不要生成复习文档、测试本、课后信息提取或其他任何内容。
学情反馈文档以【OK】结束，输出【OK】后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
      
      const systemPrompt = roadmap && roadmap.trim() ? roadmap : FEEDBACK_SYSTEM_PROMPT;
      
      console.log(`[SSE] 开始为 ${input.studentName} 生成学情反馈...`);
      console.log(`[SSE] 路书长度: ${roadmap?.length || 0} 字符`);
      
      // 发送开始事件
      sendEvent("start", { 
        message: `开始为 ${input.studentName} 生成学情反馈`,
        studentName: input.studentName
      });
      
      const config: APIConfig = { apiModel, apiKey, apiUrl };
      
      let charCount = 0;
      let lastProgressTime = Date.now();
      
      // 调用流式 API，实时发送进度
      const content = await invokeWhatAIStream(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        { max_tokens: 16000 },
        config,
        (chunk: string) => {
          charCount += chunk.length;
          // 每秒最多发送一次进度更新，避免过于频繁
          const now = Date.now();
          if (now - lastProgressTime >= 1000) {
            sendEvent("progress", { chars: charCount });
            lastProgressTime = now;
          }
        }
      );
      
      // 清理内容
      const cleanedContent = cleanMarkdownAndHtml(content);
      
      console.log(`[SSE] 学情反馈生成完成，长度: ${cleanedContent.length} 字符`);
      
      // 优先使用用户输入的日期，否则从反馈内容中提取
      let dateStr = input.lessonDate || '';
      if (!dateStr) {
        const dateMatch = cleanedContent.match(/(\d{1,2}月\d{1,2}日?)/);
        dateStr = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
      }
      
      // 上传到 Google Drive
      const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
      const basePath = `${driveBasePath}/${input.studentName}`;
      const fileName = `${input.studentName}${dateStr}阅读课反馈.md`;
      const folderPath = `${basePath}/学情反馈`;
      
      console.log(`[SSE] 上传到 Google Drive: ${folderPath}/${fileName}`);
      sendEvent("progress", { chars: charCount, message: "正在上传到 Google Drive..." });
      
      const uploadResult = await uploadToGoogleDrive(cleanedContent, fileName, folderPath);
      
      if (uploadResult.status === 'error') {
        throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
      }
      
      console.log(`[SSE] 上传成功: ${uploadResult.url}`);
      
      // 发送完成事件
      sendEvent("complete", { 
        success: true,
        feedback: cleanedContent,
        chars: cleanedContent.length,
        dateStr: dateStr,
        uploadResult: {
          fileName: fileName,
          url: uploadResult.url || '',
          path: uploadResult.path || '',
          folderUrl: uploadResult.folderUrl || '',
        }
      });
      
    } catch (error: any) {
      console.error("[SSE] 生成失败:", error);
      sendEvent("error", { 
        message: error.message || "生成失败",
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    } finally {
      res.end();
    }
  });
  
  console.log("[SSE] 一对一学情反馈流式端点已注册: POST /api/feedback-stream");
}
