/**
 * V45b: 小班课学情反馈 SSE 流式端点
 * 解决 Cloudflare 524 超时问题
 */
import crypto from "crypto";
import { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { invokeWhatAIStream, APIConfig } from "./whatai";
import { ClassFeedbackInput, textToDocx, cleanMarkdownAndHtml, generateClassTestContent, generateClassExtractionContent } from "./feedbackGenerator";
import { getDb } from "./db";
import { systemConfig } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { uploadToGoogleDrive, uploadBinaryToGoogleDrive } from "./gdrive";
import { 
  createLogSession, 
  startStep, 
  stepSuccess, 
  stepFailed, 
  endLogSession, 
  logInfo,
  GenerationLog 
} from "./logger";
import { parseError } from "./errorHandler";
import { requireAuth } from "./_core/authMiddleware";
import { storeContent, retrieveContent } from "./contentStore";

// 默认配置值（和 routers.ts 保持一致）
const DEFAULT_CONFIG = {
  apiModel: "claude-sonnet-4-5-20250929",
  apiKey: process.env.WHATAI_API_KEY || "",
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

【重要】不要与用户互动，不要等待确认，不要询问任何问题。
不要输出任何前言、寒暄、自我描述或元评论（如"我将为您生成..."、"好的，以下是..."、"我将直接为您生成..."等）。
直接输出文档正文内容，第一行就是文档内容本身。`;

// cleanMarkdownAndHtml 已从 feedbackGenerator.ts 导入

/**
 * 给日期字符串添加星期信息
 * 输入: "2026年1月11日" 或 "1月11日"
 * 输出: "2026年1月11日（周日）" 或 "1月11日（周日）"
 */
function addWeekdayToDate(dateStr: string): string {
  if (!dateStr) return dateStr;
  
  // 如果已经包含星期信息，直接返回
  if (dateStr.includes('周') || dateStr.includes('星期')) {
    return dateStr;
  }
  
  try {
    // 解析日期：支持 "2026年1月11日" 或 "1月11日" 格式
    const match = dateStr.match(/(\d{4})年?(\d{1,2})月(\d{1,2})日?/);
    if (!match) {
      // 尝试解析不带年份的格式
      const shortMatch = dateStr.match(/(\d{1,2})月(\d{1,2})日?/);
      if (!shortMatch) return dateStr;
      
      // 使用当前年份（或默认2026）
      const year = new Date().getFullYear();
      const month = parseInt(shortMatch[1], 10) - 1;
      const day = parseInt(shortMatch[2], 10);
      const date = new Date(year, month, day);
      
      const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
      const weekday = weekdays[date.getDay()];
      
      return `${dateStr}（周${weekday}）`;
    }
    
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const date = new Date(year, month, day);
    
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdays[date.getDay()];
    
    return `${dateStr}（周${weekday}）`;
  } catch (e) {
    console.error('[addWeekdayToDate] 解析日期失败:', dateStr, e);
    return dateStr;
  }
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
  taskId: z.string().optional(),
});

/**
 * 注册小班课 SSE 流式端点
 */
export function registerClassStreamRoutes(app: Express): void {
  // 内容拉取端点：前端凭 taskId 获取完整内容（SSE 断了也能拉到）
  app.get("/api/feedback-content/:id", requireAuth, (req: Request, res: Response) => {
    const result = retrieveContent(req.params.id);
    if (result === null) {
      res.status(404).json({ error: "内容不存在或已过期" });
      return;
    }
    res.json({ content: result.content, meta: result.meta });
  });

  // SSE 端点：小班课学情反馈流式生成（需要登录）
  app.post("/api/class-feedback-stream", requireAuth, async (req: Request, res: Response) => {
    
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
    
    // 创建日志会话
    let log: GenerationLog | null = null;
    
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
      
      // 创建日志会话（小班课用班号作为学生名）
      log = createLogSession(
        `班级${input.classNumber}`,
        { apiUrl, apiModel, maxTokens: 32000 },
        {
          notesLength: input.currentNotes.length,
          transcriptLength: input.transcript.length,
          lastFeedbackLength: input.lastFeedback?.length || 0,
        },
        input.lessonNumber,
        input.lessonDate
      );
      logInfo(log, 'session', `开始小班课学情反馈生成 (SSE)，出勤学生: ${input.attendanceStudents.join('、')}`);
      
      // 组合年份和日期，并添加星期信息
      const lessonDate = input.lessonDate ? addWeekdayToDate(`${currentYear}年${input.lessonDate}`) : "";
      
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
      

      
      // 发送开始事件
      sendEvent("start", { 
        message: `开始为 ${input.classNumber} 班生成学情反馈`,
        students: classInput.attendanceStudents.length
      });
      
      // 记录步骤开始
      startStep(log, 'feedback');
      
      const config: APIConfig = { apiModel, apiKey, apiUrl };
      
      let charCount = 0;
      let lastProgressTime = Date.now();
      
      // 调用流式 API，实时发送进度
      const content = await invokeWhatAIStream(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        { max_tokens: 32000 },
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
      

      
      // 记录步骤成功
      stepSuccess(log, 'feedback', cleanedContent.length);
      endLogSession(log);
      
      // 内容存入暂存（用前端传入的 taskId，SSE 断了前端也能凭 taskId 拉取）
      const taskId = input.taskId || crypto.randomUUID();
      storeContent(taskId, cleanedContent);
      sendEvent("complete", {
        success: true,
        contentId: taskId,
        chars: cleanedContent.length
      });

    } catch (error: any) {
      console.error("[SSE] 生成失败:", error);

      // 记录步骤失败
      if (log) {
        stepFailed(log, 'feedback', parseError(error, 'feedback'));
        endLogSession(log);
      }

      sendEvent("error", {
        message: error.message || "生成失败",
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    } finally {
      res.end();
    }
  });
  

  
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
    taskId: z.string().optional(),
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
  app.post("/api/feedback-stream", requireAuth, async (req: Request, res: Response) => {
    
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
    
    // 创建日志会话
    let log: GenerationLog | null = null;
    
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
      
      // 创建日志会话
      log = createLogSession(
        input.studentName,
        { apiUrl, apiModel, maxTokens: 32000 },
        {
          notesLength: input.currentNotes.length,
          transcriptLength: input.transcript.length,
          lastFeedbackLength: input.lastFeedback?.length || 0,
        },
        input.lessonNumber,
        input.lessonDate
      );
      logInfo(log, 'session', '开始一对一学情反馈生成 (SSE)');
      
      // 组合年份和日期，并添加星期信息
      const lessonDate = input.lessonDate ? addWeekdayToDate(`${currentYear}年${input.lessonDate}`) : "";
      
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
      

      
      // 发送开始事件
      sendEvent("start", { 
        message: `开始为 ${input.studentName} 生成学情反馈`,
        studentName: input.studentName
      });
      
      // 记录步骤开始
      startStep(log, 'feedback');
      
      const config: APIConfig = { apiModel, apiKey, apiUrl };
      
      let charCount = 0;
      let lastProgressTime = Date.now();
      
      // 调用流式 API，实时发送进度
      const content = await invokeWhatAIStream(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        { max_tokens: 32000 },
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
      

      sendEvent("progress", { chars: charCount, message: "正在上传到 Google Drive..." });
      
      const uploadResult = await uploadToGoogleDrive(cleanedContent, fileName, folderPath);
      
      if (uploadResult.status === 'error') {
        throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
      }
      

      
      // 记录步骤成功
      stepSuccess(log, 'feedback', cleanedContent.length);
      logInfo(log, 'feedback', `上传成功: ${uploadResult.path}`);
      
      // 结束日志会话（保存日志文件）
      endLogSession(log);
      
      // 内容存入暂存（用前端传入的 taskId，SSE 断了前端也能凭 taskId 拉取）
      const taskId = input.taskId || crypto.randomUUID();
      storeContent(taskId, cleanedContent, {
        dateStr,
        uploadResult: {
          fileName: fileName,
          url: uploadResult.url || '',
          path: uploadResult.path || '',
          folderUrl: uploadResult.folderUrl || '',
        }
      });
      sendEvent("complete", {
        success: true,
        contentId: taskId,
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
      
      // 记录步骤失败
      if (log) {
        stepFailed(log, 'feedback', parseError(error, 'feedback'));
        endLogSession(log);
      }
      
      sendEvent("error", { 
        message: error.message || "生成失败",
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    } finally {
      res.end();
    }
  });
  

  
  // ========== V45d: 一对一复习文档 SSE 端点 ==========
  
  // 复习文档输入验证 schema
  const reviewInputSchema = z.object({
    studentName: z.string().min(1),
    dateStr: z.string().min(1),
    feedbackContent: z.string().min(1),
    apiModel: z.string().optional(),
    apiKey: z.string().optional(),
    apiUrl: z.string().optional(),
    roadmap: z.string().optional(),
    driveBasePath: z.string().optional(),
    taskId: z.string().optional(),
  });
  
  // 复习文档 system prompt
  const REVIEW_SYSTEM_PROMPT = `你是一个复习文档生成助手。根据学情反馈生成复习文档。

【重要格式要求】
1. 不要使用任何markdown标记
2. 不要使用HTML代码
3. 输出纯文本格式
4. 生词顺序和数量必须与学情反馈中的【生词】部分完全一致！

【复习文档结构】

第一部分：生词复习
（按照学情反馈中【生词】的顺序，逐个展开）

1. 单词 /音标/ 词性. 中文释义
词根词缀：xxx（如有）
例句：xxx
同义词：xxx
反义词：xxx

第二部分：长难句复习
（按照学情反馈中【长难句】的内容）

1. 原句
结构分析：xxx
翻译：xxx
语法要点：xxx

第三部分：错题复习
（按照学情反馈中【错题】的内容）

1. 题目
错误选项及原因：xxx
正确答案及解析：xxx
同类题型注意点：xxx`;
  
  // SSE 端点：一对一复习文档流式生成
  app.post("/api/review-stream", requireAuth, async (req: Request, res: Response) => {
    
    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    // 创建日志会话
    let log: GenerationLog | null = null;
    
    try {
      const parseResult = reviewInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendEvent("error", { message: "输入验证失败", details: parseResult.error.issues });
        res.end();
        return;
      }
      
      const input = parseResult.data;
      
      const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
      const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
      const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
      const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap") || "");
      const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
      
      // 创建日志会话
      log = createLogSession(
        input.studentName,
        { apiUrl, apiModel, maxTokens: 32000 },
        { notesLength: 0, transcriptLength: 0, lastFeedbackLength: input.feedbackContent.length },
        undefined,
        input.dateStr
      );
      logInfo(log, 'session', '开始一对一复习文档生成 (SSE)');
      startStep(log, 'review');
      
      const userPrompt = `学生姓名：${input.studentName}

学情反馈内容：
${input.feedbackContent}

请严格按照复习文档格式规范生成复习文档。
特别注意：
1. 不要使用markdown标记，输出纯文本
2. 生词顺序、数量必须和反馈里的【生词】部分完全一致！

【重要边界限制】
本次只需要生成复习文档，不要生成学情反馈、测试本、课后信息提取或其他任何内容。
复习文档完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
      
      const systemPrompt = roadmap && roadmap.trim() ? roadmap : REVIEW_SYSTEM_PROMPT;
      

      
      sendEvent("start", { 
        message: `开始为 ${input.studentName} 生成复习文档`,
        studentName: input.studentName
      });
      
      const config: APIConfig = { apiModel, apiKey, apiUrl };
      
      let charCount = 0;
      let lastProgressTime = Date.now();
      
      const reviewContent = await invokeWhatAIStream(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        { max_tokens: 32000 },
        config,
        (chunk: string) => {
          charCount += chunk.length;
          const now = Date.now();
          if (now - lastProgressTime >= 1000) {
            sendEvent("progress", { chars: charCount });
            lastProgressTime = now;
          }
        }
      );
      
      const cleanedContent = cleanMarkdownAndHtml(reviewContent);
      

      
      // 转换为 Word 文档
      sendEvent("progress", { chars: charCount, message: "正在转换为Word文档..." });
      const docxBuffer = await textToDocx(cleanedContent, `${input.studentName}${input.dateStr}复习文档`);
      
      // 上传到 Google Drive
      const basePath = `${driveBasePath}/${input.studentName}`;
      const fileName = `${input.studentName}${input.dateStr}复习文档.docx`;
      const folderPath = `${basePath}/复习文档`;
      

      sendEvent("progress", { chars: charCount, message: "正在上传到 Google Drive..." });

      const uploadKeepAlive1v1 = setInterval(() => {
        sendEvent("progress", { chars: charCount, message: "正在上传到 Google Drive..." });
      }, 15000);

      let uploadResult;
      try {
        uploadResult = await uploadBinaryToGoogleDrive(docxBuffer, fileName, folderPath);
      } finally {
        clearInterval(uploadKeepAlive1v1);
      }

      if (uploadResult.status === 'error') {
        throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
      }



      // 记录步骤成功
      stepSuccess(log, 'review', cleanedContent.length);
      logInfo(log, 'review', `上传成功: ${uploadResult.path}`);
      endLogSession(log);
      
      const reviewUploadData = {
        fileName: fileName,
        url: uploadResult.url || '',
        path: uploadResult.path || '',
        folderUrl: uploadResult.folderUrl || '',
      };

      // 存入 contentStore，供前端 SSE 断连后轮询
      const reviewTaskId = input.taskId || crypto.randomUUID();
      storeContent(reviewTaskId, JSON.stringify(reviewUploadData), { type: 'review', chars: cleanedContent.length });

      sendEvent("complete", {
        success: true,
        chars: cleanedContent.length,
        contentId: reviewTaskId,
        uploadResult: reviewUploadData,
      });

    } catch (error: any) {
      console.error("[SSE] 复习文档生成失败:", error);
      
      // 记录步骤失败
      if (log) {
        stepFailed(log, 'review', parseError(error, 'review'));
        endLogSession(log);
      }
      
      sendEvent("error", { 
        message: error.message || "生成失败",
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    } finally {
      res.end();
    }
  });
  

  
  // ========== V45e: 小班课复习文档 SSE 端点 ==========
  
  // 小班课复习文档输入验证 schema
  const classReviewInputSchema = z.object({
    classNumber: z.string().min(1),
    lessonNumber: z.string().optional(),
    lessonDate: z.string().optional(),
    attendanceStudents: z.array(z.string()),
    currentNotes: z.string(),
    combinedFeedback: z.string().min(1),
    taskId: z.string().optional(),
    apiModel: z.string().optional(),
    apiKey: z.string().optional(),
    apiUrl: z.string().optional(),
    roadmapClass: z.string().optional(),
    driveBasePath: z.string().optional(),
  });
  
  // 小班课复习文档 system prompt
  const CLASS_REVIEW_SYSTEM_PROMPT = `你是一个复习文档生成助手。为小班课生成复习文档。

【重要格式要求】
1. 不要使用任何markdown标记
2. 不要使用HTML代码
3. 输出纯文本格式

【复习文档结构】
班级：xxx班
日期：xxx
出勤学生：xxx

【本次课内容回顾】
1. 文章/题目：xxx
2. 核心知识点：xxx

【生词讲解】
（按照学情反馈中的生词逐一讲解）

【长难句分析】
（按照学情反馈中的长难句逐一分析）

【错题解析】
（按照学情反馈中的错题逐一解析）`;
  
  // SSE 端点：小班课复习文档流式生成
  app.post("/api/class-review-stream", requireAuth, async (req: Request, res: Response) => {
    
    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    // 创建日志会话
    let log: GenerationLog | null = null;
    
    try {
      const parseResult = classReviewInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendEvent("error", { message: "输入验证失败", details: parseResult.error.issues });
        res.end();
        return;
      }
      
      const input = parseResult.data;
      
      const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
      const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
      const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
      const roadmapClass = input.roadmapClass !== undefined ? input.roadmapClass : (await getConfig("roadmapClass") || "");
      const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;
      
      // 创建日志会话
      log = createLogSession(
        `班级${input.classNumber}`,
        { apiUrl, apiModel, maxTokens: 32000 },
        { notesLength: input.currentNotes?.length || 0, transcriptLength: 0, lastFeedbackLength: input.combinedFeedback.length },
        input.lessonNumber,
        input.lessonDate
      );
      logInfo(log, 'session', '开始小班课复习文档生成 (SSE)');
      startStep(log, 'review');
      
      // 给日期添加星期信息
      const lessonDateWithWeekday = input.lessonDate ? addWeekdayToDate(input.lessonDate) : '未指定';
      
      const userPrompt = `请根据以下小班课信息生成复习文档：

班号：${input.classNumber}
课次：${input.lessonNumber || '未指定'}
本次课日期：${lessonDateWithWeekday}
出勤学生：${input.attendanceStudents.filter(s => s.trim()).join('、')}

【学情反馈汇总】
${input.combinedFeedback}

【本次课笔记】
${input.currentNotes}

【重要边界限制】
本次只需要生成复习文档，不要生成学情反馈、测试本、课后信息提取或其他任何内容。
复习文档完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
      
      const systemPrompt = roadmapClass && roadmapClass.trim() ? roadmapClass : CLASS_REVIEW_SYSTEM_PROMPT;
      

      
      sendEvent("start", { 
        message: `开始为 ${input.classNumber} 班生成复习文档`,
        classNumber: input.classNumber
      });
      
      const config: APIConfig = { apiModel, apiKey, apiUrl };
      
      let charCount = 0;
      let lastProgressTime = Date.now();
      
      const reviewContent = await invokeWhatAIStream(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        { max_tokens: 32000 },
        config,
        (chunk: string) => {
          charCount += chunk.length;
          const now = Date.now();
          if (now - lastProgressTime >= 1000) {
            sendEvent("progress", { chars: charCount });
            lastProgressTime = now;
          }
        }
      );
      
      const cleanedContent = cleanMarkdownAndHtml(reviewContent);



      // 转换为 Word 文档
      sendEvent("progress", { chars: charCount, message: "正在转换为Word文档..." });
      const docxBuffer = await textToDocx(cleanedContent, `${input.classNumber}班${input.lessonDate || ''}复习文档`);

      // 上传到 Google Drive（期间发送 keep-alive 防止代理超时）
      const basePath = `${driveBasePath}/${input.classNumber}班`;
      const fileName = `${input.classNumber}班${input.lessonDate || ''}复习文档.docx`;
      const folderPath = `${basePath}/复习文档`;


      sendEvent("progress", { chars: charCount, message: "正在上传到 Google Drive..." });

      const uploadKeepAlive = setInterval(() => {
        sendEvent("progress", { chars: charCount, message: "正在上传到 Google Drive..." });
      }, 15000);

      let uploadResult;
      try {
        uploadResult = await uploadBinaryToGoogleDrive(docxBuffer, fileName, folderPath);
      } finally {
        clearInterval(uploadKeepAlive);
      }
      
      if (uploadResult.status === 'error') {
        throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
      }
      

      
      // 记录步骤成功
      stepSuccess(log, 'review', cleanedContent.length);
      logInfo(log, 'review', `上传成功: ${uploadResult.path}`);
      endLogSession(log);

      const reviewUploadData = {
        fileName: fileName,
        url: uploadResult.url || '',
        path: uploadResult.path || '',
        folderUrl: uploadResult.folderUrl || '',
      };

      // 存入 contentStore，供前端 SSE 断连后轮询
      const reviewTaskId = input.taskId || crypto.randomUUID();
      storeContent(reviewTaskId, JSON.stringify(reviewUploadData), { type: 'review', chars: cleanedContent.length });

      sendEvent("complete", {
        success: true,
        chars: cleanedContent.length,
        contentId: reviewTaskId,
        uploadResult: reviewUploadData,
      });

    } catch (error: any) {
      console.error("[SSE] 小班课复习文档生成失败:", error);
      
      // 记录步骤失败
      if (log) {
        stepFailed(log, 'review', parseError(error, 'review'));
        endLogSession(log);
      }
      
      sendEvent("error", { 
        message: error.message || "生成失败",
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    } finally {
      res.end();
    }
  });

  // ========== 小班课测试本 SSE 端点 ==========

  const classTestInputSchema = z.object({
    classNumber: z.string().min(1),
    lessonNumber: z.string().optional(),
    lessonDate: z.string().optional(),
    attendanceStudents: z.array(z.string()),
    currentNotes: z.string(),
    combinedFeedback: z.string().min(1),
    taskId: z.string().optional(),
    apiModel: z.string().optional(),
    apiKey: z.string().optional(),
    apiUrl: z.string().optional(),
    roadmapClass: z.string().optional(),
    driveBasePath: z.string().optional(),
  });

  app.post("/api/class-test-stream", requireAuth, async (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let keepAlive: ReturnType<typeof setInterval> | null = null;

    try {
      const parseResult = classTestInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendEvent("error", { message: "输入验证失败", details: parseResult.error.issues });
        res.end();
        return;
      }

      const input = parseResult.data;
      const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
      const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
      const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
      const roadmapClass = input.roadmapClass !== undefined ? input.roadmapClass : (await getConfig("roadmapClass") || "");
      const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;

      sendEvent("start", { message: `开始为 ${input.classNumber} 班生成测试本` });

      // 每15秒发送keep-alive，防止平台代理超时
      keepAlive = setInterval(() => {
        sendEvent("progress", { message: "正在生成测试本..." });
      }, 15000);

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

      if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }

      // 上传到 Google Drive
      sendEvent("progress", { message: "正在上传到 Google Drive..." });
      const basePath = `${driveBasePath}/${input.classNumber}班`;
      const fileName = `${input.classNumber}班${input.lessonDate || ''}测试文档.docx`;
      const folderPath = `${basePath}/复习文档`;

      const uploadResult = await uploadBinaryToGoogleDrive(testBuffer, fileName, folderPath);

      if (uploadResult.status === 'error') {
        throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
      }

      const testUploadData = {
        fileName,
        url: uploadResult.url || '',
        path: uploadResult.path || '',
        folderUrl: uploadResult.folderUrl || '',
      };
      const testTaskId = input.taskId || crypto.randomUUID();
      storeContent(testTaskId, JSON.stringify(testUploadData), { type: 'test' });

      sendEvent("complete", {
        success: true,
        contentId: testTaskId,
        uploadResult: testUploadData,
      });
    } catch (error: any) {
      console.error("[SSE] 小班课测试本生成失败:", error);
      if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
      sendEvent("error", { message: error.message || "生成失败" });
    } finally {
      if (keepAlive) clearInterval(keepAlive);
      res.end();
    }
  });

  // ========== 小班课课后信息提取 SSE 端点 ==========

  const classExtractionInputSchema = z.object({
    classNumber: z.string().min(1),
    lessonNumber: z.string().optional(),
    lessonDate: z.string().optional(),
    attendanceStudents: z.array(z.string()),
    combinedFeedback: z.string().min(1),
    taskId: z.string().optional(),
    apiModel: z.string().optional(),
    apiKey: z.string().optional(),
    apiUrl: z.string().optional(),
    roadmapClass: z.string().optional(),
    driveBasePath: z.string().optional(),
  });

  app.post("/api/class-extraction-stream", requireAuth, async (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let keepAlive: ReturnType<typeof setInterval> | null = null;

    try {
      const parseResult = classExtractionInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendEvent("error", { message: "输入验证失败", details: parseResult.error.issues });
        res.end();
        return;
      }

      const input = parseResult.data;
      const apiModel = input.apiModel || await getConfig("apiModel") || DEFAULT_CONFIG.apiModel;
      const apiKey = input.apiKey || await getConfig("apiKey") || DEFAULT_CONFIG.apiKey;
      const apiUrl = input.apiUrl || await getConfig("apiUrl") || DEFAULT_CONFIG.apiUrl;
      const roadmapClass = input.roadmapClass !== undefined ? input.roadmapClass : (await getConfig("roadmapClass") || "");
      const driveBasePath = input.driveBasePath || await getConfig("driveBasePath") || DEFAULT_CONFIG.driveBasePath;

      sendEvent("start", { message: `开始为 ${input.classNumber} 班生成课后信息提取` });

      // 每15秒发送keep-alive，防止平台代理超时
      keepAlive = setInterval(() => {
        sendEvent("progress", { message: "正在生成课后信息提取..." });
      }, 15000);

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

      const extractionContent = await generateClassExtractionContent(
        classInput,
        input.combinedFeedback,
        roadmapClass,
        { apiModel, apiKey, apiUrl }
      );

      if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }

      // 校验内容非空
      if (!extractionContent || !extractionContent.trim()) {
        console.error("[SSE] 课后信息提取内容为空，combinedFeedback长度:", input.combinedFeedback.length);
        throw new Error('课后信息提取生成失败：AI 返回内容为空，请重试');
      }

      // 上传到 Google Drive
      sendEvent("progress", { message: "正在上传到 Google Drive...", chars: extractionContent.length });
      const basePath = `${driveBasePath}/${input.classNumber}班`;
      const fileName = `${input.classNumber}班${input.lessonDate || ''}课后信息提取.md`;
      const folderPath = `${basePath}/课后信息`;

      const uploadResult = await uploadToGoogleDrive(extractionContent, fileName, folderPath);

      if (uploadResult.status === 'error') {
        throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
      }

      const extractUploadData = {
        fileName,
        url: uploadResult.url || '',
        path: uploadResult.path || '',
        folderUrl: uploadResult.folderUrl || '',
      };
      const extractTaskId = input.taskId || crypto.randomUUID();
      storeContent(extractTaskId, JSON.stringify(extractUploadData), { type: 'extraction', chars: extractionContent.length });

      sendEvent("complete", {
        success: true,
        chars: extractionContent.length,
        contentId: extractTaskId,
        uploadResult: extractUploadData,
      });
    } catch (error: any) {
      console.error("[SSE] 小班课课后信息提取生成失败:", error);
      if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
      sendEvent("error", { message: error.message || "生成失败" });
    } finally {
      if (keepAlive) clearInterval(keepAlive);
      res.end();
    }
  });

}
