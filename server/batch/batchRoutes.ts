/**
 * 批量处理 SSE 路由
 * 提供批量生成学情反馈的 SSE 端点，支持并发控制、错误重试和停止功能
 */
import { Router, Request, Response } from "express";
import { setupSSEHeaders, sendSSEEvent, sendChunkedContent } from "../core/sseHelper";
import { invokeAIStream, getAPIConfig } from "../core/aiClient";
import { generateBatchDocument } from "./batchWordGenerator";
import { uploadBinaryToGoogleDrive } from "../gdrive";
import { ConcurrencyPool, TaskResult } from "../core/concurrencyPool";

const router = Router();

// 最大重试次数
const MAX_RETRIES = 1;

// 活跃批次管理（用于停止功能）
const activeBatches = new Map<string, {
  pool: ConcurrencyPool<any>;
  stopped: boolean;
}>();

/**
 * 生成批次 ID（格式：YYYYMMDD-HHmmss）
 */
function generateBatchId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
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
    storagePath 
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
  const concurrencyNum = Math.max(1, Math.min(10, Number(concurrency) || 5));

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
  console.log(`[BatchRoutes] 路书长度: ${roadmap.length} 字符`);
  console.log(`[BatchRoutes] 存储路径: ${storagePath || "(未指定)"}`);

  // 设置 SSE 响应头
  setupSSEHeaders(res);

  // 获取 API 配置
  const config = await getAPIConfig();

  // 创建并发池
  const pool = new ConcurrencyPool<BatchTaskResult>(concurrencyNum);
  pool.addTasks(taskNumbers);

  // 注册到活跃批次（用于停止功能）
  activeBatches.set(batchId, { pool, stopped: false });

  // 发送批次开始事件
  sendSSEEvent(res, "batch-start", {
    batchId,
    totalTasks,
    concurrency: concurrencyNum,
    startNumber: start,
    endNumber: end,
    timestamp: Date.now(),
  });

  // 统计
  let completedCount = 0;
  let failedCount = 0;

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
  const executeTask = async (
    taskNumber: number,
    onProgress: (chars: number) => void
  ): Promise<BatchTaskResult> => {
    // 构建用户消息
    const userMessage = `这是任务编号 ${taskNumber}，请按照路书要求生成内容。`;

    // 调用 AI，透明转发路书作为 system prompt
    const systemPrompt = roadmap + "\n\n【重要】请直接输出结果，不要与用户互动，不要询问任何问题。";

    let lastReportedChars = 0;

    const content = await invokeAIStream(
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
      { config }
    );

    // 检查内容是否有效
    if (!content || content.length === 0) {
      throw new Error("AI 返回内容为空");
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

    const { buffer, filename } = await generateBatchDocument(content, taskNumber);
    console.log(`[BatchRoutes] 任务 ${taskNumber} Word 文档生成完成: ${filename}`);

    // 上传到 Google Drive（如果指定了存储路径）
    let uploadUrl: string | undefined;
    let uploadPath: string | undefined;

    if (storagePath) {
      sendSSEEvent(res, "task-progress", {
        taskNumber,
        chars: content.length,
        message: "正在上传到 Google Drive...",
        timestamp: Date.now(),
      });

      const folderPath = `${storagePath}/${batchId}`;
      console.log(`[BatchRoutes] 任务 ${taskNumber} 上传到: ${folderPath}/${filename}`);

      const uploadResult = await uploadBinaryToGoogleDrive(buffer, filename, folderPath);

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
    };
  };

  // 任务执行器（包装重试逻辑）
  const taskExecutor = async (
    taskNumber: number,
    onProgress: (chars: number) => void
  ): Promise<BatchTaskResult> => {
    console.log(`[BatchRoutes] 任务 ${taskNumber} 开始执行`);

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
    if (result.success && result.result) {
      completedCount++;
      
      // 发送任务完成事件
      sendSSEEvent(res, "task-complete", {
        taskNumber,
        batchId,
        chars: result.result.content.length,
        filename: result.result.filename,
        url: result.result.url,
        path: result.result.path,
        timestamp: Date.now(),
      });

      console.log(`[BatchRoutes] 任务 ${taskNumber} 完成 (${completedCount}/${totalTasks})`);
    } else {
      failedCount++;

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
    // 清理活跃批次
    activeBatches.delete(batchId);
    res.end();
  }
});

export default router;
