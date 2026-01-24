/**
 * SSE 工具模块
 * 提供 SSE 流式响应的公共函数，避免代码重复
 */
import { Response } from "express";

/**
 * 设置 SSE 响应头
 * @param res Express Response 对象
 */
export function setupSSEHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲
}

/**
 * 发送 SSE 事件
 * @param res Express Response 对象
 * @param eventType 事件类型（如 'start', 'progress', 'complete', 'error'）
 * @param data 事件数据对象
 */
export function sendSSEEvent(res: Response, eventType: string, data: any): void {
  // [SSE-DEBUG] 调试日志
  const taskId = data.taskNumber ?? data.batchId ?? 'N/A';
  console.log(`[SSE-DEBUG] 发送事件: ${eventType}, 任务ID: ${taskId}, 时间: ${new Date().toISOString()}`);
  
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * 安全发送 SSE 事件（带错误处理）
 * @param res Express Response 对象
 * @param eventType 事件类型
 * @param data 事件数据对象
 * @returns 是否发送成功
 */
export function safeSendSSEEvent(res: Response, eventType: string, data: any): boolean {
  try {
    if (res.writableEnded) {
      console.warn(`[SSE] 连接已关闭，无法发送事件: ${eventType}`);
      return false;
    }
    sendSSEEvent(res, eventType, data);
    return true;
  } catch (e) {
    console.error(`[SSE] 发送事件失败: ${eventType}`, e);
    return false;
  }
}

/**
 * 分块发送超长内容
 * 当内容超过阈值时，分块发送避免 SSE 数据包过大
 * @param res Express Response 对象
 * @param content 要发送的内容
 * @param chunkSize 每块大小（默认 15000 字符）
 * @returns 是否使用了分块发送
 */
export function sendChunkedContent(
  res: Response,
  content: string,
  chunkSize: number = 15000
): boolean {
  if (content.length <= chunkSize) {
    return false; // 内容不需要分块
  }

  const totalChunks = Math.ceil(content.length / chunkSize);
  for (let i = 0; i < totalChunks; i++) {
    const chunk = content.slice(i * chunkSize, (i + 1) * chunkSize);
    sendSSEEvent(res, "content-chunk", {
      index: i,
      total: totalChunks,
      text: chunk,
    });
  }

  return true; // 使用了分块发送
}

/**
 * 创建 SSE 事件发送器
 * 返回一个绑定了 Response 的发送函数，方便使用
 * @param res Express Response 对象
 * @returns 事件发送函数
 */
export function createSSEEventSender(res: Response) {
  return (eventType: string, data: any) => {
    sendSSEEvent(res, eventType, data);
  };
}
