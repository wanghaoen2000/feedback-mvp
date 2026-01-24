# V64 SSE 连接断开问题排查报告

## 1. 后端 SSE 端点检查

### 1.1 SSE 端点位置
- **文件**: `server/batch/batchRoutes.ts`
- **端点**: `POST /api/batch/generate-stream`
- **行号**: 第 109-742 行

### 1.2 心跳机制
- **❌ 没有心跳机制**
- 当前实现中没有定期发送心跳/ping 事件来保持连接活跃

### 1.3 任务完成事件发送方式
- **单个任务完成**: 发送 `task-complete` 事件（第 677-686 行）
- **全部任务完成**: 发送 `batch-complete` 事件（第 714-721 行）
- 每个任务完成后立即发送 `task-complete`，不等待全部完成

### 1.4 连接关闭处理
- **已添加调试日志**: `res.on('close', ...)` 监听连接关闭（第 216-218 行）
- **原有处理**: 在 `finally` 块中调用 `res.end()` 关闭连接（第 740 行）
- **没有 try-catch 包装 SSE 写入操作**

### 1.5 关键代码片段

```typescript
// 设置 SSE 响应头 (server/core/sseHelper.ts)
export function setupSSEHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲
}

// 发送 SSE 事件
export function sendSSEEvent(res: Response, eventType: string, data: any): void {
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// 批次完成处理 (batchRoutes.ts)
try {
  await pool.execute(taskExecutor, onProgress, onComplete);
  sendSSEEvent(res, "batch-complete", { ... });
} catch (error) {
  sendSSEEvent(res, "batch-error", { ... });
} finally {
  activeBatches.delete(batchId);
  res.end();
}
```

---

## 2. 前端 SSE 解析检查

### 2.1 SSE 连接方式
- **文件**: `client/src/components/BatchProcess.tsx`
- **方式**: 使用 `fetch` + `ReadableStream` 读取 SSE 流（第 665-848 行）
- **不是使用 EventSource API**

### 2.2 错误处理 (onerror)
- **catch 块**: 捕获错误并显示 alert（第 856-860 行）
- **没有自动重连机制**
- **没有区分可恢复错误和不可恢复错误**

### 2.3 任务完成判断
- **收到 `batch-complete` 事件**: 更新 batchState 的 completed/failed 计数
- **SSE 流结束**: `reader.read()` 返回 `done: true` 时退出循环
- **没有超时检测机制**

### 2.4 连接断开处理
- 如果 SSE 连接中途断开，前端会：
  1. `reader.read()` 抛出错误
  2. 进入 catch 块，显示 "批量处理失败: TypeError: network error"
  3. 设置 `isGenerating = false`
  4. **不会自动重连或恢复状态**

### 2.5 关键代码片段

```typescript
// SSE 读取循环 (BatchProcess.tsx)
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  buffer += decoder.decode(value, { stream: true });
  // ... 解析事件
}

// 错误处理
} catch (error: any) {
  console.error('批量处理失败:', error);
  alert(`批量处理失败: ${error.message}`);
} finally {
  setIsGenerating(false);
}
```

---

## 3. 测试日志

### 3.1 测试配置
- 任务数: 4
- 并发数: 2
- 路书: 简单测试（输出一句话）

### 3.2 前端日志摘要
```
[SSE-DEBUG] 测试开始, 时间: 2026-01-24T09:40:59.323Z
[SSE-DEBUG] 收到事件: batch-start
[SSE-DEBUG] 收到事件: task-start (任务1, 任务2)
[SSE-DEBUG] 收到事件: task-retry (任务1, 任务2) - fetch failed
[SSE-DEBUG] 收到事件: task-progress (多次)
[SSE-DEBUG] 收到事件: task-complete (任务1-4)
[SSE-DEBUG] 收到事件: batch-complete
[SSE-DEBUG] SSE 流结束, 时间: 2026-01-24T09:42:02.840Z
```

### 3.3 测试结果
- **状态**: ✅ 成功完成
- **总耗时**: 约 63 秒
- **所有事件正常接收**

---

## 4. 问题定位

### 4.1 可能的原因分析

用户报告的问题有两种现象：
1. **现象1**: 文件都已生成，但界面一直显示"生成中"
2. **现象2**: 界面报错 "network error"，但文件都已成功生成

**可能原因**:

| 原因 | 现象1 | 现象2 | 可能性 |
|------|-------|-------|--------|
| **没有心跳机制** | ✅ | ✅ | 高 |
| **长时间无数据导致代理超时** | ✅ | ✅ | 高 |
| **HTTP/2 协议问题** | ❌ | ✅ | 中 |
| **前端没有重连机制** | ✅ | ❌ | 中 |
| **Nginx/反向代理缓冲** | ✅ | ✅ | 中 |

### 4.2 核心问题

1. **没有心跳机制**: 当任务执行时间较长（如 AI 生成、文件上传）时，SSE 连接可能因为长时间没有数据而被代理/网关断开。

2. **前端没有错误恢复**: 连接断开后，前端只是显示错误，没有尝试恢复或获取最终状态。

3. **HTTP/2 协议问题**: `ERR_HTTP2_PROTOCOL_ERROR` 可能是由于 HTTP/2 的流控制或超时机制导致的。

---

## 5. 修复建议

### 5.1 添加心跳机制（推荐）

**后端修改** (`server/batch/batchRoutes.ts`):

```typescript
// 在批量处理开始时启动心跳
const heartbeatInterval = setInterval(() => {
  try {
    sendSSEEvent(res, "heartbeat", { timestamp: Date.now() });
  } catch (e) {
    clearInterval(heartbeatInterval);
  }
}, 15000); // 每 15 秒发送一次心跳

// 在 finally 块中清理
finally {
  clearInterval(heartbeatInterval);
  activeBatches.delete(batchId);
  res.end();
}
```

**前端修改** (`client/src/components/BatchProcess.tsx`):
```typescript
// 忽略 heartbeat 事件，不做任何处理
if (currentEventType === 'heartbeat') {
  continue;
}
```

### 5.2 添加前端超时检测和状态恢复

```typescript
// 添加超时检测
let lastEventTime = Date.now();
const timeoutChecker = setInterval(() => {
  if (Date.now() - lastEventTime > 60000) { // 60秒无事件
    console.warn('[BatchProcess] SSE 连接可能已断开');
    // 可以尝试查询服务器获取最终状态
  }
}, 10000);

// 在收到事件时更新时间
lastEventTime = Date.now();
```

### 5.3 添加 SSE 写入错误处理

```typescript
// 包装 sendSSEEvent 添加错误处理
function safeSendSSEEvent(res: Response, eventType: string, data: any): boolean {
  try {
    if (res.writableEnded) return false;
    sendSSEEvent(res, eventType, data);
    return true;
  } catch (e) {
    console.error('[SSE] 发送事件失败:', e);
    return false;
  }
}
```

### 5.4 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `server/core/sseHelper.ts` | 添加心跳发送函数 |
| `server/batch/batchRoutes.ts` | 启动心跳定时器，添加错误处理 |
| `client/src/components/BatchProcess.tsx` | 忽略心跳事件，添加超时检测 |

---

## 6. 下一步

请确认以上分析和修复建议，我将：
1. 实现心跳机制
2. 添加 SSE 写入错误处理
3. 前端添加心跳事件处理
4. 清理调试日志

等待您的确认后再动手修改代码。
