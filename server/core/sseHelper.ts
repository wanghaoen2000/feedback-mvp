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
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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
