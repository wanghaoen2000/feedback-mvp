/**
 * 批量处理 SSE 路由
 * 提供批量生成文档的 SSE 端点，支持并发控制、错误重试和停止功能
 */
import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import { setupSSEHeaders, sendSSEEvent, sendChunkedContent } from "../core/sseHelper";
import { invokeAIStream, getAPIConfig, FileInfo } from "../core/aiClient";
import { generateBatchDocument } from "./batchWordGenerator";
import { generateWordListDocx, WordListData } from "../templates/wordCardTemplate";
import { generateWritingMaterialDocx, WritingMaterialData } from "./writingMaterialGenerator";
import { uploadBinaryToGoogleDrive, ensureFolderExists } from "../gdrive";
import { ConcurrencyPool, TaskResult } from "../core/concurrencyPool";
import { parseDocumentToText, isParseableDocument } from "../utils/documentParser";
import { processAICodeGeneration } from "../core/aiCodeProcessor";

const router = Router();

// 最大重试次数
const MAX_RETRIES = 1;

/**
 * 批次任务状态
 */
interface TaskStatus {
  taskNumber: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  fileName?: string;
  fileUrl?: string;
  error?: string;
  chars?: number;
}

/**
 * 批次状态（用于状态查询接口）
 */
interface BatchStatus {
  batchId: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  startTime: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  tasks: TaskStatus[];
  pool: ConcurrencyPool<any>;
  stopped: boolean;
}

// 活跃批次管理（用于停止功能和状态查询）
const activeBatches = new Map<string, BatchStatus>();

/**
 * 生成批次 ID（格式：YYYYMMDD-HHmmss，使用北京时间 UTC+8）
 */
function generateBatchId(): string {
  // 使用北京时间 (UTC+8)
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = beijingTime.getUTCFullYear();
  const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getUTCDate()).padStart(2, '0');
  const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
  const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 单个任务的执行结果
 */
interface BatchTaskResult {
  content: string;
  filename: string;
  url?: string;
  path?: string;
  truncated?: boolean;  // 内容是否因token上限被截断
}

/**
 * POST /api/batch/stop
 * 停止批量处理
 * 
 * 请求参数：
 * - batchId: 批次 ID
 */
router.post("/stop", async (req: Request, res: Response) => {
  const { batchId } = req.body;

  if (!batchId) {
    res.status(400).json({ error: "缺少 batchId 参数" });
    return;
  }

  const batch = activeBatches.get(batchId);
  if (!batch) {
    res.status(404).json({ error: "批次不存在或已完成" });
    return;
  }

  console.log(`[BatchRoutes] 收到停止请求，批次 ID: ${batchId}`);
  
  // 标记为已停止并调用 pool.stop()
  batch.stopped = true;
  batch.pool.stop();

  res.json({ 
    success: true, 
    message: "停止信号已发送，等待当前任务完成",
    batchId 
  });
});

/**
 * GET /api/batch/status/:batchId
 * 查询批次状态（用于前端连接断开后的降级查询）
 * 
 * 返回：
 * - success: 是否成功
 * - data: 批次状态信息（包括每个任务的状态）
 * - error: 错误信息（如果批次不存在）
 */
router.get("/status/:batchId", async (req: Request, res: Response) => {
  const { batchId } = req.params;

  if (!batchId) {
    res.status(400).json({ 
      success: false, 
      error: "缺少 batchId 参数" 
    });
    return;
  }

  const batchStatus = activeBatches.get(batchId);

  if (!batchStatus) {
    // 批次不存在或已结束（超过5分钟）
    res.json({
      success: false,
      error: "批次不存在或已结束",
      batchId
    });
    return;
  }

  // 返回批次状态（不包含 pool 引用）
  res.json({
    success: true,
    data: {
      batchId: batchStatus.batchId,
      totalTasks: batchStatus.totalTasks,
      completedTasks: batchStatus.completedTasks,
      failedTasks: batchStatus.failedTasks,
      startTime: batchStatus.startTime,
      status: batchStatus.status,
      stopped: batchStatus.stopped,
      tasks: batchStatus.tasks,
    }
  });
});

/**
 * POST /api/batch/generate-stream
 * 批量生成 SSE 端点，支持多任务和并发控制
 * 
 * 请求参数：
 * - startNumber: 起始任务编号
 * - endNumber: 结束任务编号
 * - concurrency: 并发数（默认 5）
 * - roadmap: 路书内容（透明转发给 AI）
 * - storagePath: 存储路径（Google Drive 文件夹路径）
 */
router.post("/generate-stream", async (req: Request, res: Response) => {
  const { 
    startNumber, 
    endNumber, 
    concurrency = 5, 
    roadmap, 
    storagePath,
    filePrefix = '任务',
    templateType = 'markdown_styled',
    customFileNames,  // 可选：自定义文件名映射 Record<number, string>
    namingMethod = 'prefix',  // 命名方式: 'prefix' | 'custom' | 'ai_auto'
    files,  // 可选：独立文件信息 Record<number, FileInfo>
    sharedFiles  // 可选：共享文件信息 FileInfo[]
  } = req.body;

  // 参数验证
  if (startNumber === undefined || startNumber === null) {
    res.status(400).json({ error: "缺少 startNumber 参数" });
    return;
  }

  if (endNumber === undefined || endNumber === null) {
    res.status(400).json({ error: "缺少 endNumber 参数" });
    return;
  }

  if (!roadmap || typeof roadmap !== "string") {
    res.status(400).json({ error: "缺少 roadmap 参数或格式错误" });
    return;
  }

  const start = Number(startNumber);
  const end = Number(endNumber);
  const concurrencyNum = Math.max(1, Math.min(40, Number(concurrency) || 5));

  if (isNaN(start) || isNaN(end) || start > end) {
    res.status(400).json({ error: "任务编号范围无效" });
    return;
  }

  // 生成任务编号列表
  const taskNumbers: number[] = [];
  for (let i = start; i <= end; i++) {
    taskNumbers.push(i);
  }

  const totalTasks = taskNumbers.length;
  const batchId = generateBatchId();

  console.log(`[BatchRoutes] 开始批量处理`);
  console.log(`[BatchRoutes] 批次 ID: ${batchId}`);
  console.log(`[BatchRoutes] 任务范围: ${start} - ${end} (共 ${totalTasks} 个)`);
  console.log(`[BatchRoutes] 并发数: ${concurrencyNum}`);
  console.log(`[BatchRoutes] 模板类型: ${templateType}`);
  console.log(`[BatchRoutes] 路书长度: ${roadmap.length} 字符`);
  console.log(`[BatchRoutes] 存储路径: ${storagePath || "(未指定)"}`);
  console.log(`[BatchRoutes] 文件名前缀: ${filePrefix}`);
  console.log(`[BatchRoutes] 自定义文件名: ${customFileNames ? Object.keys(customFileNames).length + ' 个' : '(未指定)'}`);

  // 设置 SSE 响应头
  setupSSEHeaders(res);

  // 获取 API 配置
  const config = await getAPIConfig();

  // 创建并发池
  const pool = new ConcurrencyPool<BatchTaskResult>(concurrencyNum);
  pool.addTasks(taskNumbers);

  // 初始化任务状态列表
  const initialTasks: TaskStatus[] = taskNumbers.map(num => ({
    taskNumber: num,
    status: 'pending' as const,
  }));

  // 注册到活跃批次（用于停止功能和状态查询）
  activeBatches.set(batchId, {
    batchId,
    totalTasks,
    completedTasks: 0,
    failedTasks: 0,
    startTime: Date.now(),
    status: 'running',
    tasks: initialTasks,
    pool,
    stopped: false,
  });

  // 发送批次开始事件
  sendSSEEvent(res, "batch-start", {
    batchId,
    totalTasks,
    concurrency: concurrencyNum,
    startNumber: start,
    endNumber: end,
    timestamp: Date.now(),
  });

  // 预创建批次文件夹（避免并发任务竞争创建）
  let batchFolderPath: string | undefined;
  if (storagePath) {
    batchFolderPath = `${storagePath}/${batchId}`;
    console.log(`[BatchRoutes] 预创建批次文件夹: ${batchFolderPath}`);
    
    const folderResult = await ensureFolderExists(batchFolderPath);
    if (!folderResult.success) {
      console.error(`[BatchRoutes] 创建批次文件夹失败: ${folderResult.error}`);
      sendSSEEvent(res, "batch-error", {
        batchId,
        error: `创建批次文件夹失败: ${folderResult.error}`,
        timestamp: Date.now(),
      });
      res.end();
      return;
    }
    console.log(`[BatchRoutes] 批次文件夹创建成功`);
  }

  // 统计
  let completedCount = 0;
  let failedCount = 0;

  // [SSE-DEBUG] 监听连接关闭
  res.on('close', () => {
    console.log(`[SSE-DEBUG] 连接关闭, 时间: ${new Date().toISOString()}, 已完成任务数: ${completedCount}/${totalTasks}, 失败: ${failedCount}`);
  });

  // 心跳定时器：每15秒发送一次心跳事件，保持连接活跃
  const heartbeatInterval = setInterval(() => {
    try {
      if (!res.writableEnded) {
        sendSSEEvent(res, "heartbeat", { timestamp: Date.now() });
        console.log(`[SSE] 心跳发送, batchId: ${batchId}`);
      }
    } catch (e) {
      console.error('[SSE] 心跳发送失败:', e);
      clearInterval(heartbeatInterval);
    }
  }, 15000); // 每15秒

  /**
   * 执行单个任务（带重试）
   */
  const executeTaskWithRetry = async (
    taskNumber: number,
    onProgress: (chars: number) => void,
    retryCount: number = 0
  ): Promise<BatchTaskResult> => {
    try {
      return await executeTask(taskNumber, onProgress);
    } catch (error: any) {
      if (retryCount < MAX_RETRIES) {
        console.log(`[BatchRoutes] 任务 ${taskNumber} 失败，正在重试 (${retryCount + 1}/${MAX_RETRIES})...`);
        
        // 发送重试事件
        sendSSEEvent(res, "task-retry", {
          taskNumber,
          batchId,
          retryCount: retryCount + 1,
          maxRetries: MAX_RETRIES,
          error: error.message || "未知错误",
          timestamp: Date.now(),
        });

        // 等待1秒后重试
        await delay(1000);
        
        return executeTaskWithRetry(taskNumber, onProgress, retryCount + 1);
      }
      
      // 重试次数用尽，抛出错误
      throw error;
    }
  };

  /**
   * 执行单个任务（核心逻辑）
   */
  /**
   * 构建带来源标签的消息内容
   * 使用 XML 标签区分不同来源的内容：
   * - <路书提示词> 路书/提示词内容
   * - <共享文档> 共享文档内容（多个文档用 --- 分隔）
   * - <单独文档> 独立文档内容
   */
  const buildMessageContent = (
    taskNumber: number,
    roadmapContent: string,
    sharedFileList: FileInfo[] | undefined,
    independentFile: FileInfo | undefined
  ): { systemPrompt: string; userMessage: string } => {
    // 构建 system prompt（路书部分）
    const systemPrompt = `<路书提示词>
${roadmapContent}
</路书提示词>

【重要】请直接输出结果，不要与用户互动，不要询问任何问题。`;
    
    // 构建 user message
    let userMessage = `这是任务编号 ${taskNumber}，请按照路书要求生成内容。`;
    
    // 添加共享文档内容（如果有提取的文本）
    const sharedDocTexts: string[] = [];
    if (sharedFileList && sharedFileList.length > 0) {
      for (const file of sharedFileList) {
        if (file.type === 'document' && file.extractedText) {
          sharedDocTexts.push(file.extractedText);
        }
      }
    }
    
    if (sharedDocTexts.length > 0) {
      userMessage += `\n\n<共享文档>\n${sharedDocTexts.join('\n---\n')}\n</共享文档>`;
    }
    
    // 添加独立文档内容（如果有提取的文本）
    if (independentFile?.type === 'document' && independentFile.extractedText) {
      userMessage += `\n\n<单独文档>\n${independentFile.extractedText}\n</单独文档>`;
    }
    
    // 统计文件数量并添加提示
    const allFiles = [...(sharedFileList || []), ...(independentFile ? [independentFile] : [])];
    const imageCount = allFiles.filter(f => f.type === 'image').length;
    const docCount = allFiles.filter(f => f.type === 'document').length;
    const textDocCount = allFiles.filter(f => f.type === 'document' && f.extractedText).length;
    const urlDocCount = docCount - textDocCount;
    
    // 添加附件提示
    const hints: string[] = [];
    if (imageCount > 0) {
      hints.push(`${imageCount} 张图片`);
    }
    if (textDocCount > 0) {
      hints.push(`${textDocCount} 份文档（已提取文本，见上方标签）`);
    }
    if (urlDocCount > 0) {
      hints.push(`${urlDocCount} 份文档（以URL形式提供）`);
    }
    
    if (hints.length > 0) {
      userMessage += `\n\n【附件】请分析以上 ${hints.join('、')}。`;
    }
    
    return { systemPrompt, userMessage };
  };

  const executeTask = async (
    taskNumber: number,
    onProgress: (chars: number) => void
  ): Promise<BatchTaskResult> => {
    // 获取当前任务的所有文件（共享文件 + 独立文件）
    const taskFileInfos: FileInfo[] = [];
    
    // 先添加共享文件（所有任务都有）
    const sharedFileList = sharedFiles as FileInfo[] | undefined;
    if (sharedFileList && sharedFileList.length > 0) {
      taskFileInfos.push(...sharedFileList);
    }
    
    // 再添加独立文件（特定任务才有）
    const independentFiles = files as Record<number, FileInfo> | undefined;
    const independentFile = independentFiles?.[taskNumber];
    if (independentFile) {
      taskFileInfos.push(independentFile);
    }
    
    // 日志输出
    console.log(`[BatchRoutes] 任务${taskNumber}：共享文件${sharedFileList?.length || 0}个，独立文件${independentFile ? 1 : 0}个，共${taskFileInfos.length}个`);
    
    // 使用 buildMessageContent 构建带来源标签的消息
    const { systemPrompt, userMessage } = buildMessageContent(
      taskNumber,
      roadmap,
      sharedFileList,
      independentFile
    );


    let lastReportedChars = 0;

    const aiResult = await invokeAIStream(
      systemPrompt,
      userMessage,
      (chars) => {
        // 调用进度回调
        onProgress(chars);

        // 每增加 100 字符或首次时发送进度
        if (chars - lastReportedChars >= 100 || lastReportedChars === 0) {
          sendSSEEvent(res, "task-progress", {
            taskNumber,
            chars,
            timestamp: Date.now(),
          });
          lastReportedChars = chars;
        }
      },
      { config, fileInfos: taskFileInfos.length > 0 ? taskFileInfos : undefined }  // 传递多文件信息
    );
    
    const content = aiResult.content;
    const isTruncated = aiResult.truncated;

    // 检查内容是否有效
    if (!content || content.length === 0) {
      throw new Error("AI 返回内容为空");
    }
    
    // 如果内容被截断，记录警告
    if (isTruncated) {
      console.log(`[BatchRoutes] ⚠️ 任务 ${taskNumber} 内容因token上限被截断，stop_reason: ${aiResult.stopReason}`);
    }

    // 发送最终进度
    if (content.length !== lastReportedChars) {
      sendSSEEvent(res, "task-progress", {
        taskNumber,
        chars: content.length,
        timestamp: Date.now(),
      });
    }

    console.log(`[BatchRoutes] 任务 ${taskNumber} AI 生成完成，内容长度: ${content.length} 字符`);

    // 生成 Word 文档
    sendSSEEvent(res, "task-progress", {
      taskNumber,
      chars: content.length,
      message: "正在生成 Word 文档...",
      timestamp: Date.now(),
    });

    let buffer: Buffer;
    let filename: string;

    // 获取自定义文件名（如果有）
    const customName = customFileNames?.[taskNumber] as string | undefined;

    if (templateType === 'word_card') {
      // 词汇卡片模板：解析 JSON 并调用精确排版模板
      try {
        // 清理可能的 Markdown 代码块标记（AI 有时会输出 ```json ... ``` 包裹的 JSON）
        let cleanContent = content.trim();
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.slice(7); // 去掉 ```json
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.slice(3); // 去掉 ```
        }
        if (cleanContent.endsWith('```')) {
          cleanContent = cleanContent.slice(0, -3); // 去掉结尾的 ```
        }
        cleanContent = cleanContent.trim();
        
        const jsonData = JSON.parse(cleanContent) as WordListData;
        buffer = await generateWordListDocx(jsonData);
        // 文件名：优先使用自定义文件名
        if (customName) {
          filename = `${customName}.docx`;
        } else {
          const taskNumStr = taskNumber.toString().padStart(2, '0');
          const prefix = filePrefix.trim() || '任务';
          filename = `${prefix}${taskNumStr}.docx`;
        }
        console.log(`[BatchRoutes] 任务 ${taskNumber} 词汇卡片生成完成: ${filename}`);
      } catch (parseError: any) {
        console.error(`[BatchRoutes] 任务 ${taskNumber} JSON 解析失败:`, parseError.message);
        throw new Error(`AI返回的内容不是有效的JSON格式: ${parseError.message}`);
      }
    } else if (templateType === 'writing_material') {
      // 写作素材模板：解析 JSON 并调用写作素材模板
      console.log(`[BatchRoutes] 任务 ${taskNumber} 进入 writing_material 分支`);
      console.log(`[BatchRoutes] AI输出前100字符: ${content.substring(0, 100)}`);
      try {
        // 清理可能的 Markdown 代码块标记（AI 有时会输出 ```json ... ``` 包裹的 JSON）
        let cleanContent = content.trim();
        
        // 方法1：去掉开头的 ```json 或 ```
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.slice(7);
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.slice(3);
        }
        // 去掉结尾的 ```
        if (cleanContent.endsWith('```')) {
          cleanContent = cleanContent.slice(0, -3);
        }
        cleanContent = cleanContent.trim();
        
        // 方法2：如果还不是以 { 开头，尝试提取 JSON
        if (!cleanContent.startsWith('{')) {
          console.log(`[BatchRoutes] 内容不是以 { 开头，尝试提取 JSON`);
          // 尝试从 markdown 代码块中提取
          const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            cleanContent = jsonMatch[1].trim();
            console.log(`[BatchRoutes] 从代码块提取到 JSON`);
          } else {
            // 尝试提取 { 到 } 的内容
            const braceMatch = content.match(/\{[\s\S]*\}/);
            if (braceMatch) {
              cleanContent = braceMatch[0];
              console.log(`[BatchRoutes] 从大括号提取到 JSON`);
            }
          }
        }
        
        console.log(`[BatchRoutes] 清理后内容前100字符: ${cleanContent.substring(0, 100)}`);
        
        const jsonData = JSON.parse(cleanContent) as WritingMaterialData;
        console.log(`[BatchRoutes] JSON 解析成功，调用 generateWritingMaterialDocx`);
        
        buffer = await generateWritingMaterialDocx(jsonData);
        console.log(`[BatchRoutes] generateWritingMaterialDocx 返回 buffer 大小: ${buffer.length}`);
        
        // 文件名：优先使用自定义文件名
        if (customName) {
          filename = `${customName}.docx`;
        } else {
          const taskNumStr = taskNumber.toString().padStart(2, '0');
          const prefix = filePrefix.trim() || '任务';
          filename = `${prefix}${taskNumStr}.docx`;
        }
        console.log(`[BatchRoutes] 任务 ${taskNumber} 写作素材生成完成: ${filename}`);
      } catch (parseError: any) {
        console.error(`[BatchRoutes] 任务 ${taskNumber} 写作素材 JSON 解析失败:`, parseError.message);
        console.error(`[BatchRoutes] AI原始输出: ${content.substring(0, 500)}`);
        throw new Error(`AI返回的内容不是有效的JSON格式: ${parseError.message}`);
      }
    } else if (templateType === 'markdown_file') {
      // 生成 MD 文件：直接保存原始 Markdown 内容
      if (customName) {
        filename = `${customName}.md`;
      } else {
        const taskNumStr = taskNumber.toString().padStart(2, '0');
        const prefix = filePrefix.trim() || '任务';
        filename = `${prefix}${taskNumStr}.md`;
      }
      buffer = Buffer.from(content, 'utf-8');
      console.log(`[BatchRoutes] 任务 ${taskNumber} MD 文件生成完成: ${filename}`);
    } else if (templateType === 'markdown_plain') {
      // 通用文档（无样式）：黑白简洁
      const result = await generateBatchDocument(content, taskNumber, filePrefix, false, customName);
      buffer = result.buffer;
      filename = result.filename;
      console.log(`[BatchRoutes] 任务 ${taskNumber} 通用文档生成完成: ${filename}`);
    } else if (templateType === 'ai_code') {
      // AI代码生成模式：AI生成 docx-js 代码，沙箱执行生成 Word
      console.log(`[BatchRoutes] 任务 ${taskNumber} 进入 ai_code 模式`);
      
      // 构建用户提示词（包含任务编号和原始内容）
      const aiCodePrompt = `任务编号: ${taskNumber}\n\n${content}`;
      
      // 创建独立的输出目录
      const outputDir = `/tmp/docx-output-${batchId}-${taskNumber}`;
      
      // 发送进度：开始AI代码生成
      sendSSEEvent(res, "task-progress", {
        taskNumber,
        chars: content.length,
        message: "AI正在生成代码...",
        timestamp: Date.now(),
      });
      
      // 调用AI代码处理器
      const aiCodeResult = await processAICodeGeneration(
        aiCodePrompt,
        {
          aiConfig: {
            apiUrl: config.apiUrl,
            apiKey: config.apiKey,
            model: config.apiModel,
            maxTokens: config.maxTokens,
          },
          outputDir,
          maxAttempts: 3,
          validateStructure: true,
        },
        (message) => {
          // 进度回调
          sendSSEEvent(res, "task-progress", {
            taskNumber,
            chars: content.length,
            message,
            timestamp: Date.now(),
          });
        }
      );
      
      // 检查结果
      if (!aiCodeResult.success || !aiCodeResult.outputPath) {
        const errorMsg = aiCodeResult.errors.join('; ');
        console.error(`[BatchRoutes] 任务 ${taskNumber} AI代码生成失败:`, errorMsg);
        throw new Error(`AI代码生成失败 (尝试${aiCodeResult.totalAttempts}次): ${errorMsg}`);
      }
      
      console.log(`[BatchRoutes] 任务 ${taskNumber} AI代码生成成功，尝试次数: ${aiCodeResult.totalAttempts}`);
      
      // 读取生成的文件
      const fs = await import('fs');
      const pathModule = await import('path');
      buffer = fs.readFileSync(aiCodeResult.outputPath);
      
      // AI代码模式：根据 namingMethod 决定文件名
      const aiGeneratedFilename = pathModule.basename(aiCodeResult.outputPath);
      const taskNumStr = taskNumber.toString().padStart(2, '0');
      const prefix = filePrefix.trim() || '任务';
      
      if (namingMethod === 'prefix') {
        // 前缀+编号：强制使用前缀+编号，忽略 AI 的命名
        filename = `${prefix}${taskNumStr}.docx`;
        console.log(`[BatchRoutes] 任务 ${taskNumber} 使用前缀+编号命名: ${filename}`);
      } else if (namingMethod === 'custom' && customName) {
        // 从文本解析：使用用户指定的文件名，忽略 AI 的命名
        filename = customName.endsWith('.docx') ? customName : `${customName}.docx`;
        console.log(`[BatchRoutes] 任务 ${taskNumber} 使用自定义文件名: ${filename}`);
      } else {
        // AI自主命名：使用 AI 在代码中生成的文件名
        filename = aiGeneratedFilename;
        // 如果 AI 没有自定义文件名（默认 output.docx），回退到前缀+编号
        if (filename === 'output.docx') {
          filename = `${prefix}${taskNumStr}.docx`;
          console.log(`[BatchRoutes] 任务 ${taskNumber} AI未自定义文件名，回退到前缀+编号: ${filename}`);
        } else {
          console.log(`[BatchRoutes] 任务 ${taskNumber} 使用AI生成的文件名: ${filename}`);
        }
      }
      
      console.log(`[BatchRoutes] 任务 ${taskNumber} AI代码模式完成: ${filename}, 耗时: ${aiCodeResult.executionTime}ms`);
    } else {
      // 默认模板（markdown_styled）：教学材料（带样式）
      const result = await generateBatchDocument(content, taskNumber, filePrefix, true, customName);
      buffer = result.buffer;
      filename = result.filename;
      console.log(`[BatchRoutes] 任务 ${taskNumber} 教学材料生成完成: ${filename}`);
    }

    // 上传到 Google Drive（如果指定了存储路径）
    let uploadUrl: string | undefined;
    let uploadPath: string | undefined;

    if (batchFolderPath) {
      sendSSEEvent(res, "task-progress", {
        taskNumber,
        chars: content.length,
        message: "正在上传到 Google Drive...",
        timestamp: Date.now(),
      });

      // 使用预创建的批次文件夹路径（避免并发竞争）
      console.log(`[BatchRoutes] 任务 ${taskNumber} 上传到: ${batchFolderPath}/${filename}`);

      const uploadResult = await uploadBinaryToGoogleDrive(buffer, filename, batchFolderPath);

      if (uploadResult.status === 'success') {
        uploadUrl = uploadResult.url;
        uploadPath = uploadResult.path;
        console.log(`[BatchRoutes] 任务 ${taskNumber} 上传成功`);
      } else {
        // 上传失败也抛出错误，触发重试
        throw new Error(`上传失败: ${uploadResult.error}`);
      }
    }

    return {
      content,
      filename,
      url: uploadUrl,
      path: uploadPath,
      truncated: isTruncated,
    };
  };

  // 任务执行器（包装重试逻辑）
  const taskExecutor = async (
    taskNumber: number,
    onProgress: (chars: number) => void
  ): Promise<BatchTaskResult> => {
    console.log(`[BatchRoutes] 任务 ${taskNumber} 开始执行`);

    // 更新任务状态为 running
    const batchStatus = activeBatches.get(batchId);
    if (batchStatus) {
      const task = batchStatus.tasks.find(t => t.taskNumber === taskNumber);
      if (task) {
        task.status = 'running';
      }
    }

    // 发送任务开始事件
    sendSSEEvent(res, "task-start", {
      taskNumber,
      batchId,
      message: `任务 ${taskNumber} 开始处理`,
      timestamp: Date.now(),
    });

    // 执行任务（带重试）
    return executeTaskWithRetry(taskNumber, onProgress);
  };

  // 进度回调
  const onProgress = (taskNumber: number, chars: number) => {
    // 进度已在 taskExecutor 中发送，这里可以做额外处理
  };

  // 完成回调
  const onComplete = (taskNumber: number, result: TaskResult<BatchTaskResult>) => {
    // 获取批次状态
    const batchStatus = activeBatches.get(batchId);
    const task = batchStatus?.tasks.find(t => t.taskNumber === taskNumber);

    if (result.success && result.result) {
      completedCount++;
      
      // 更新任务状态为 completed
      if (batchStatus && task) {
        task.status = 'completed';
        task.fileName = result.result.filename;
        task.fileUrl = result.result.url;
        task.chars = result.result.content.length;
        batchStatus.completedTasks = completedCount;
      }

      // 发送任务完成事件
      sendSSEEvent(res, "task-complete", {
        taskNumber,
        batchId,
        chars: result.result.content.length,
        filename: result.result.filename,
        url: result.result.url,
        path: result.result.path,
        truncated: result.result.truncated || false,  // 内容是否被截断
        timestamp: Date.now(),
      });

      console.log(`[BatchRoutes] 任务 ${taskNumber} 完成 (${completedCount}/${totalTasks})`);
    } else {
      failedCount++;

      // 更新任务状态为 failed
      if (batchStatus && task) {
        task.status = 'failed';
        task.error = result.error?.message || '未知错误';
        batchStatus.failedTasks = failedCount;
      }

      // 发送任务错误事件（重试后仍失败）
      sendSSEEvent(res, "task-error", {
        taskNumber,
        batchId,
        error: result.error?.message || "未知错误",
        retriesExhausted: true,
        timestamp: Date.now(),
      });

      console.error(`[BatchRoutes] 任务 ${taskNumber} 最终失败: ${result.error?.message}`);
    }
  };

  try {
    // 执行所有任务
    await pool.execute(taskExecutor, onProgress, onComplete);

    // 检查是否被停止
    const batch = activeBatches.get(batchId);
    const wasStopped = batch?.stopped || false;

    // 发送批次完成事件
    sendSSEEvent(res, "batch-complete", {
      batchId,
      totalTasks,
      completed: completedCount,
      failed: failedCount,
      stopped: wasStopped,
      timestamp: Date.now(),
    });

    if (wasStopped) {
      console.log(`[BatchRoutes] 批次 ${batchId} 已停止: ${completedCount} 成功, ${failedCount} 失败`);
    } else {
      console.log(`[BatchRoutes] 批次 ${batchId} 完成: ${completedCount} 成功, ${failedCount} 失败`);
    }

  } catch (error: any) {
    console.error(`[BatchRoutes] 批次执行失败:`, error.message);

    sendSSEEvent(res, "batch-error", {
      batchId,
      error: error.message || "批次执行失败",
      timestamp: Date.now(),
    });
  } finally {
    // 清理心跳定时器
    clearInterval(heartbeatInterval);
    
    // 更新批次状态为已完成，但延迟5分钟后再删除（让前端有机会查询）
    const finalBatchStatus = activeBatches.get(batchId);
    if (finalBatchStatus) {
      finalBatchStatus.status = finalBatchStatus.stopped ? 'stopped' : 
        (finalBatchStatus.failedTasks > 0 && finalBatchStatus.completedTasks === 0) ? 'failed' : 'completed';
      // 移除 pool 引用，减少内存占用
      finalBatchStatus.pool = null as any;
    }
    
    // 5分钟后清理批次状态
    setTimeout(() => {
      activeBatches.delete(batchId);
      console.log(`[Batch] 清理批次状态: ${batchId}`);
    }, 5 * 60 * 1000);
    
    res.end();
  }
});

// ============================================
// 单任务重做端点
// ============================================

/**
 * POST /api/batch/retry-task
 * 重做单个任务（用于批量处理完成后重做失败或不满意的任务）
 * 
 * 请求参数：
 * - taskNumber: 要重做的任务编号
 * - originalBatchId: 原批次ID（用于确定存储路径）
 * - storagePath: 原存储路径（Google Drive 文件夹路径）
 * - roadmap: 路书内容
 * - templateType: 模板类型
 * - filePrefix: 文件名前缀
 * - customFileName: 自定义文件名（可选）
 * - namingMethod: 命名方式
 * - files: 独立文件信息（可选）
 * - sharedFiles: 共享文件信息（可选）
 */
router.post("/retry-task", async (req: Request, res: Response) => {
  const {
    taskNumber,
    originalBatchId,
    storagePath,
    roadmap,
    templateType = 'markdown_styled',
    filePrefix = '任务',
    customFileName,
    namingMethod = 'prefix',
    files,
    sharedFiles,
  } = req.body;

  // 参数验证
  if (taskNumber === undefined || taskNumber === null) {
    res.status(400).json({ error: "缺少 taskNumber 参数" });
    return;
  }

  if (!originalBatchId) {
    res.status(400).json({ error: "缺少 originalBatchId 参数" });
    return;
  }

  if (!roadmap || typeof roadmap !== "string") {
    res.status(400).json({ error: "缺少 roadmap 参数或格式错误" });
    return;
  }

  const taskNum = Number(taskNumber);
  if (isNaN(taskNum)) {
    res.status(400).json({ error: "taskNumber 必须是数字" });
    return;
  }

  console.log(`[BatchRoutes] 开始重做任务`);
  console.log(`[BatchRoutes] 任务编号: ${taskNum}`);
  console.log(`[BatchRoutes] 原批次 ID: ${originalBatchId}`);
  console.log(`[BatchRoutes] 模板类型: ${templateType}`);
  console.log(`[BatchRoutes] 存储路径: ${storagePath || "(未指定)"}`);

  // 设置 SSE 响应头
  setupSSEHeaders(res);

  // 获取 API 配置
  const config = await getAPIConfig();

  // 发送重做开始事件
  sendSSEEvent(res, "retry-start", {
    taskNumber: taskNum,
    originalBatchId,
    timestamp: Date.now(),
  });

  // 构建文件存储路径（使用原批次文件夹）
  let batchFolderPath: string | undefined;
  if (storagePath) {
    batchFolderPath = `${storagePath}/${originalBatchId}`;
    console.log(`[BatchRoutes] 重做任务将存储到: ${batchFolderPath}`);
  }

  // 构建带来源标签的消息内容
  const buildRetryMessageContent = (
    taskNum: number,
    roadmapContent: string,
    sharedFileList: FileInfo[] | undefined,
    independentFile: FileInfo | undefined
  ): { systemPrompt: string; userMessage: string } => {
    const systemPrompt = `<路书提示词>
${roadmapContent}
</路书提示词>

【重要】请直接输出结果，不要与用户互动，不要询问任何问题。`;
    
    let userMessage = `这是任务编号 ${taskNum}，请按照路书要求生成内容。`;
    
    // 添加共享文档内容
    const sharedDocTexts: string[] = [];
    if (sharedFileList && sharedFileList.length > 0) {
      for (const file of sharedFileList) {
        if (file.type === 'document' && file.extractedText) {
          sharedDocTexts.push(file.extractedText);
        }
      }
    }
    
    if (sharedDocTexts.length > 0) {
      userMessage += `\n\n<共享文档>\n${sharedDocTexts.join('\n---\n')}\n</共享文档>`;
    }
    
    // 添加独立文档内容
    if (independentFile?.type === 'document' && independentFile.extractedText) {
      userMessage += `\n\n<单独文档>\n${independentFile.extractedText}\n</单独文档>`;
    }
    
    // 统计文件数量并添加提示
    const allFiles = [...(sharedFileList || []), ...(independentFile ? [independentFile] : [])];
    const imageCount = allFiles.filter(f => f.type === 'image').length;
    const docCount = allFiles.filter(f => f.type === 'document').length;
    const textDocCount = allFiles.filter(f => f.type === 'document' && f.extractedText).length;
    const urlDocCount = docCount - textDocCount;
    
    const hints: string[] = [];
    if (imageCount > 0) hints.push(`${imageCount} 张图片`);
    if (textDocCount > 0) hints.push(`${textDocCount} 份文档（已提取文本，见上方标签）`);
    if (urlDocCount > 0) hints.push(`${urlDocCount} 份文档（以URL形式提供）`);
    
    if (hints.length > 0) {
      userMessage += `\n\n【附件】请分析以上 ${hints.join('、')}。`;
    }
    
    return { systemPrompt, userMessage };
  };

  try {
    // 获取文件信息
    const taskFileInfos: FileInfo[] = [];
    const sharedFileList = sharedFiles as FileInfo[] | undefined;
    if (sharedFileList && sharedFileList.length > 0) {
      taskFileInfos.push(...sharedFileList);
    }
    const independentFiles = files as Record<number, FileInfo> | undefined;
    const independentFile = independentFiles?.[taskNum];
    if (independentFile) {
      taskFileInfos.push(independentFile);
    }

    console.log(`[BatchRoutes] 重做任务${taskNum}：共享文件${sharedFileList?.length || 0}个，独立文件${independentFile ? 1 : 0}个`);

    // 构建消息
    const { systemPrompt, userMessage } = buildRetryMessageContent(
      taskNum,
      roadmap,
      sharedFileList,
      independentFile
    );

    let lastReportedChars = 0;

    // 调用 AI 生成
    const aiResult = await invokeAIStream(
      systemPrompt,
      userMessage,
      (chars) => {
        if (chars - lastReportedChars >= 100 || lastReportedChars === 0) {
          sendSSEEvent(res, "task-progress", {
            taskNumber: taskNum,
            chars,
            timestamp: Date.now(),
          });
          lastReportedChars = chars;
        }
      },
      { config, fileInfos: taskFileInfos.length > 0 ? taskFileInfos : undefined }
    );

    const content = aiResult.content;
    const isTruncated = aiResult.truncated;

    if (!content || content.length === 0) {
      throw new Error("AI 返回内容为空");
    }

    if (isTruncated) {
      console.log(`[BatchRoutes] ⚠️ 重做任务 ${taskNum} 内容因token上限被截断`);
    }

    // 发送最终进度
    if (content.length !== lastReportedChars) {
      sendSSEEvent(res, "task-progress", {
        taskNumber: taskNum,
        chars: content.length,
        timestamp: Date.now(),
      });
    }

    console.log(`[BatchRoutes] 重做任务 ${taskNum} AI 生成完成，内容长度: ${content.length} 字符`);

    // 生成 Word 文档
    sendSSEEvent(res, "task-progress", {
      taskNumber: taskNum,
      chars: content.length,
      message: "正在生成 Word 文档...",
      timestamp: Date.now(),
    });

    let buffer: Buffer;
    let filename: string;
    const customName = customFileName as string | undefined;

    // 根据模板类型生成文档（复用现有逻辑）
    if (templateType === 'word_card') {
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) cleanContent = cleanContent.slice(7);
      else if (cleanContent.startsWith('```')) cleanContent = cleanContent.slice(3);
      if (cleanContent.endsWith('```')) cleanContent = cleanContent.slice(0, -3);
      cleanContent = cleanContent.trim();
      
      const jsonData = JSON.parse(cleanContent) as WordListData;
      buffer = await generateWordListDocx(jsonData);
      if (customName) {
        filename = `${customName}.docx`;
      } else {
        const taskNumStr = taskNum.toString().padStart(2, '0');
        const prefix = filePrefix.trim() || '任务';
        filename = `${prefix}${taskNumStr}.docx`;
      }
    } else if (templateType === 'writing_material') {
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) cleanContent = cleanContent.slice(7);
      else if (cleanContent.startsWith('```')) cleanContent = cleanContent.slice(3);
      if (cleanContent.endsWith('```')) cleanContent = cleanContent.slice(0, -3);
      cleanContent = cleanContent.trim();
      
      if (!cleanContent.startsWith('{')) {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) cleanContent = jsonMatch[1].trim();
        else {
          const braceMatch = content.match(/\{[\s\S]*\}/);
          if (braceMatch) cleanContent = braceMatch[0];
        }
      }
      
      const jsonData = JSON.parse(cleanContent) as WritingMaterialData;
      buffer = await generateWritingMaterialDocx(jsonData);
      if (customName) {
        filename = `${customName}.docx`;
      } else {
        const taskNumStr = taskNum.toString().padStart(2, '0');
        const prefix = filePrefix.trim() || '任务';
        filename = `${prefix}${taskNumStr}.docx`;
      }
    } else if (templateType === 'markdown_file') {
      if (customName) {
        filename = `${customName}.md`;
      } else {
        const taskNumStr = taskNum.toString().padStart(2, '0');
        const prefix = filePrefix.trim() || '任务';
        filename = `${prefix}${taskNumStr}.md`;
      }
      buffer = Buffer.from(content, 'utf-8');
    } else if (templateType === 'markdown_plain') {
      const result = await generateBatchDocument(content, taskNum, filePrefix, false, customName);
      buffer = result.buffer;
      filename = result.filename;
    } else if (templateType === 'ai_code') {
      // AI代码模式
      const aiCodePrompt = `任务编号: ${taskNum}\n\n${content}`;
      const outputDir = `/tmp/docx-output-retry-${originalBatchId}-${taskNum}`;
      
      sendSSEEvent(res, "task-progress", {
        taskNumber: taskNum,
        chars: content.length,
        message: "AI正在生成代码...",
        timestamp: Date.now(),
      });
      
      const aiCodeResult = await processAICodeGeneration(
        aiCodePrompt,
        {
          aiConfig: {
            apiUrl: config.apiUrl,
            apiKey: config.apiKey,
            model: config.apiModel,
            maxTokens: config.maxTokens,
          },
          outputDir,
          maxAttempts: 3,
          validateStructure: true,
        },
        (message) => {
          sendSSEEvent(res, "task-progress", {
            taskNumber: taskNum,
            chars: content.length,
            message,
            timestamp: Date.now(),
          });
        }
      );
      
      if (!aiCodeResult.success || !aiCodeResult.outputPath) {
        throw new Error(`AI代码生成失败: ${aiCodeResult.errors.join('; ')}`);
      }
      
      const fs = await import('fs');
      const pathModule = await import('path');
      buffer = fs.readFileSync(aiCodeResult.outputPath);
      
      const aiGeneratedFilename = pathModule.basename(aiCodeResult.outputPath);
      const taskNumStr = taskNum.toString().padStart(2, '0');
      const prefix = filePrefix.trim() || '任务';
      
      if (namingMethod === 'prefix') {
        filename = `${prefix}${taskNumStr}.docx`;
      } else if (namingMethod === 'custom' && customName) {
        filename = customName.endsWith('.docx') ? customName : `${customName}.docx`;
      } else {
        filename = aiGeneratedFilename === 'output.docx' ? `${prefix}${taskNumStr}.docx` : aiGeneratedFilename;
      }
    } else {
      // 默认模板
      const result = await generateBatchDocument(content, taskNum, filePrefix, true, customName);
      buffer = result.buffer;
      filename = result.filename;
    }

    // 上传到 Google Drive
    let uploadUrl: string | undefined;
    let uploadPath: string | undefined;

    if (batchFolderPath) {
      sendSSEEvent(res, "task-progress", {
        taskNumber: taskNum,
        chars: content.length,
        message: "正在上传到 Google Drive...",
        timestamp: Date.now(),
      });

      console.log(`[BatchRoutes] 重做任务 ${taskNum} 上传到: ${batchFolderPath}/${filename}`);

      const uploadResult = await uploadBinaryToGoogleDrive(buffer, filename, batchFolderPath);

      if (uploadResult.status === 'success') {
        uploadUrl = uploadResult.url;
        uploadPath = uploadResult.path;
        console.log(`[BatchRoutes] 重做任务 ${taskNum} 上传成功`);
      } else {
        throw new Error(`上传失败: ${uploadResult.error}`);
      }
    }

    // 发送重做完成事件
    sendSSEEvent(res, "retry-complete", {
      taskNumber: taskNum,
      originalBatchId,
      chars: content.length,
      filename,
      url: uploadUrl,
      path: uploadPath,
      truncated: isTruncated || false,
      timestamp: Date.now(),
    });

    console.log(`[BatchRoutes] 重做任务 ${taskNum} 完成`);

  } catch (error: any) {
    console.error(`[BatchRoutes] 重做任务 ${taskNum} 失败:`, error.message);

    sendSSEEvent(res, "retry-error", {
      taskNumber: taskNum,
      originalBatchId,
      error: error.message || "重做失败",
      timestamp: Date.now(),
    });
  } finally {
    res.end();
  }
});

// ============================================
// 文件上传端点
// ============================================

// 允许的文件类型
const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain',
  'text/markdown',
];

// 根据文件后缀名判断类型（备用）
const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

// 文件大小限制
const MAX_DOCUMENT_SIZE = 30 * 1024 * 1024; // 30MB
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

// 配置 multer（内存存储）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_SIZE, // 使用较大的限制，后续根据类型检查
  },
});

/**
 * 解码文件名（处理 multer 的 latin1 编码问题）
 * multer 默认使用 latin1 编码处理文件名，导致中文文件名乱码
 * 需要将 latin1 编码的字符串转换为 UTF-8
 */
function decodeFilename(filename: string): string {
  try {
    // 将 latin1 编码的字符串转换为 Buffer，然后以 UTF-8 解码
    return Buffer.from(filename, 'latin1').toString('utf8');
  } catch (e) {
    // 如果转换失败，返回原始文件名
    return filename;
  }
}

// 上传文件的返回类型
interface UploadedFile {
  originalName: string;
  mimeType: string;
  size: number;
  type: 'document' | 'image';
  url?: string;
  base64DataUri?: string;
  extractedText?: string;  // 文档提取的纯文本内容
  error?: string;
}

/**
 * 判断是否为文档类型
 */
function isDocument(mimeType: string, filename: string): boolean {
  // 先根据 MIME 类型判断
  if (ALLOWED_DOCUMENT_TYPES.includes(mimeType)) {
    return true;
  }
  // 如果 MIME 类型不明确，根据文件后缀名判断
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return DOCUMENT_EXTENSIONS.includes(ext);
}

/**
 * 判断是否为图片类型
 */
function isImage(mimeType: string, filename: string): boolean {
  // 先根据 MIME 类型判断
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    return true;
  }
  // 如果 MIME 类型不明确，根据文件后缀名判断
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * POST /api/batch/upload-files
 * 批量上传文件（文档和图片）
 * 最多支持 100 个文件
 */
router.post("/upload-files", (req: Request, res: Response, next: NextFunction) => {
  // 使用自定义错误处理的 multer 中间件
  upload.array("files", 100)(req, res, (err: any) => {
    if (err) {
      console.error("[BatchRoutes] Multer 错误:", err.message);
      return res.status(400).json({
        success: false,
        error: err.message || '文件上传失败',
        hint: '最多支持 100 个文件，单个文件最大 20MB'
      });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  console.log("[BatchRoutes] 收到文件上传请求");
  
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    
    if (!files || files.length === 0) {
      res.status(400).json({
        success: false,
        error: "没有上传任何文件",
      });
      return;
    }
    
    console.log(`[BatchRoutes] 收到 ${files.length} 个文件`);
    
    const results: UploadedFile[] = [];
    
    for (const file of files) {
      // 解码文件名（处理中文乱码问题）
      const decodedFilename = decodeFilename(file.originalname);
      
      console.log(`[BatchRoutes] 处理文件: ${decodedFilename}, 类型: ${file.mimetype}, 大小: ${file.size}`);
      
      const result: UploadedFile = {
        originalName: decodedFilename,
        mimeType: file.mimetype,
        size: file.size,
        type: 'document', // 默认值，后续会修改
      };
      
      // 检查文件类型
      if (!isDocument(file.mimetype, decodedFilename) && !isImage(file.mimetype, decodedFilename)) {
        result.error = `不支持的文件类型: ${file.mimetype}`;
        results.push(result);
        console.log(`[BatchRoutes] 文件类型不支持: ${decodedFilename}`);
        continue;
      }
      
      // 检查文件大小
      if (isDocument(file.mimetype, decodedFilename) && file.size > MAX_DOCUMENT_SIZE) {
        result.error = `文档文件超过大小限制 (${MAX_DOCUMENT_SIZE / 1024 / 1024}MB)`;
        results.push(result);
        console.log(`[BatchRoutes] 文档文件过大: ${decodedFilename}`);
        continue;
      }
      
      if (isImage(file.mimetype, decodedFilename) && file.size > MAX_IMAGE_SIZE) {
        result.error = `图片文件超过大小限制 (${MAX_IMAGE_SIZE / 1024 / 1024}MB)`;
        results.push(result);
        console.log(`[BatchRoutes] 图片文件过大: ${decodedFilename}`);
        continue;
      }
      
      try {
        if (isDocument(file.mimetype, decodedFilename)) {
          // 文档：上传到 S3
          result.type = 'document';
          
          // 生成唯一文件名
          const ext = decodedFilename.split('.').pop() || 'bin';
          const uniqueKey = `batch-uploads/${nanoid()}.${ext}`;
          
          const uploadResult = await storagePut(uniqueKey, file.buffer, file.mimetype);
          result.url = uploadResult.url;
          
          // 提取文档文字内容（PDF/DOCX/MD/TXT）
          if (isParseableDocument(file.mimetype)) {
            try {
              const extractedText = await parseDocumentToText(file.buffer, file.mimetype, decodedFilename);
              
              if (extractedText) {
                result.extractedText = extractedText;
                console.log(`[BatchRoutes] 文档文字提取成功: ${decodedFilename} (${extractedText.length} 字符)`);
              }
            } catch (parseError: any) {
              console.warn(`[BatchRoutes] 文档文字提取失败: ${decodedFilename}`, parseError.message);
              // 解析失败不影响上传，继续处理
            }
          }
          
          console.log(`[BatchRoutes] 文档上传成功: ${decodedFilename} -> ${uploadResult.url}`);
        } else if (isImage(file.mimetype, decodedFilename)) {
          // 图片：转为 Base64
          result.type = 'image';
          
          const base64 = file.buffer.toString('base64');
          result.base64DataUri = `data:${file.mimetype};base64,${base64}`;
          
          console.log(`[BatchRoutes] 图片转换成功: ${decodedFilename} (${base64.length} chars)`);
        }
      } catch (error: any) {
        result.error = `处理失败: ${error.message}`;
        console.error(`[BatchRoutes] 文件处理失败: ${decodedFilename}`, error.message);
      }
      
      results.push(result);
    }
    
    // 统计结果
    const successCount = results.filter(r => !r.error).length;
    const errorCount = results.filter(r => r.error).length;
    
    console.log(`[BatchRoutes] 文件上传完成: ${successCount} 成功, ${errorCount} 失败`);
    
    res.json({
      success: true,
      files: results,
      summary: {
        total: results.length,
        success: successCount,
        error: errorCount,
      },
    });
    
  } catch (error: any) {
    console.error("[BatchRoutes] 文件上传错误:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "文件上传失败",
    });
  }
});

export default router;
