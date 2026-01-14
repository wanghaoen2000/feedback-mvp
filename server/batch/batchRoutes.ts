/**
 * 批量处理 SSE 路由
 * 提供批量生成学情反馈的 SSE 端点
 */
import { Router, Request, Response } from "express";
import { setupSSEHeaders, sendSSEEvent, sendChunkedContent } from "../core/sseHelper";
import { invokeAIStream, getAPIConfig } from "../core/aiClient";
import { generateBatchDocument } from "./batchWordGenerator";
import { uploadBinaryToGoogleDrive } from "../gdrive";

const router = Router();

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
 * POST /api/batch/generate-stream
 * 单任务版本的批量生成 SSE 端点
 * 
 * 请求参数：
 * - taskNumber: 任务编号
 * - roadmap: 路书内容（透明转发给 AI）
 * - storagePath: 存储路径（Google Drive 文件夹路径）
 * - batchId: 可选的批次 ID（如果不提供则自动生成）
 * - suggestedFilename: 可选的建议文件名
 */
router.post("/generate-stream", async (req: Request, res: Response) => {
  const { taskNumber, roadmap, storagePath, batchId: providedBatchId, suggestedFilename } = req.body;

  // 参数验证
  if (taskNumber === undefined || taskNumber === null) {
    res.status(400).json({ error: "缺少 taskNumber 参数" });
    return;
  }

  if (!roadmap || typeof roadmap !== "string") {
    res.status(400).json({ error: "缺少 roadmap 参数或格式错误" });
    return;
  }

  // 生成或使用提供的批次 ID
  const batchId = providedBatchId || generateBatchId();

  console.log(`[BatchRoutes] 开始处理任务 ${taskNumber}`);
  console.log(`[BatchRoutes] 批次 ID: ${batchId}`);
  console.log(`[BatchRoutes] 路书长度: ${roadmap.length} 字符`);
  console.log(`[BatchRoutes] 存储路径: ${storagePath || "(未指定)"}`);

  // 设置 SSE 响应头
  setupSSEHeaders(res);

  try {
    // 发送任务开始事件
    sendSSEEvent(res, "task-start", {
      taskNumber,
      batchId,
      message: `任务 ${taskNumber} 开始处理`,
      timestamp: Date.now(),
    });

    // 获取 API 配置
    const config = await getAPIConfig();

    // 构建用户消息
    const userMessage = `这是任务编号 ${taskNumber}，请按照路书要求生成内容。`;

    // 调用 AI，透明转发路书作为 system prompt
    // 添加不要互动的指令
    const systemPrompt = roadmap + "\n\n【重要】请直接输出结果，不要与用户互动，不要询问任何问题。";

    let lastReportedChars = 0;

    const content = await invokeAIStream(
      systemPrompt,
      userMessage,
      (chars) => {
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

    const { buffer, filename } = await generateBatchDocument(content, taskNumber, suggestedFilename);
    console.log(`[BatchRoutes] Word 文档生成完成: ${filename}, 大小: ${buffer.length} 字节`);

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

      // 构建完整的文件夹路径：{storagePath}/{batchId}/
      const folderPath = `${storagePath}/${batchId}`;
      
      console.log(`[BatchRoutes] 上传到 Google Drive: ${folderPath}/${filename}`);

      const uploadResult = await uploadBinaryToGoogleDrive(buffer, filename, folderPath);

      if (uploadResult.status === 'success') {
        uploadUrl = uploadResult.url;
        uploadPath = uploadResult.path;
        console.log(`[BatchRoutes] 上传成功: ${uploadUrl}`);
      } else {
        console.error(`[BatchRoutes] 上传失败: ${uploadResult.error}`);
        // 上传失败不中断流程，继续返回生成结果
      }
    }

    // 检查是否需要分块发送
    const chunked = sendChunkedContent(res, content);

    // 发送任务完成事件
    sendSSEEvent(res, "task-complete", {
      taskNumber,
      batchId,
      chars: content.length,
      chunked,
      content: chunked ? undefined : content, // 如果分块发送，不在 complete 事件中包含内容
      filename,
      url: uploadUrl,
      path: uploadPath,
      timestamp: Date.now(),
    });

    console.log(`[BatchRoutes] 任务 ${taskNumber} 完成`);

  } catch (error: any) {
    console.error(`[BatchRoutes] 任务 ${taskNumber} 失败:`, error.message);

    // 发送错误事件
    sendSSEEvent(res, "task-error", {
      taskNumber,
      error: error.message || "未知错误",
      timestamp: Date.now(),
    });
  } finally {
    res.end();
  }
});

export default router;
