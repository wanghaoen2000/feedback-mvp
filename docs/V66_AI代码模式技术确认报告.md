# V66 技术确认：AI代码模式排查报告

**日期**: 2026-01-27  
**问题**: 批量处理使用「AI自由模式」时，任务显示"生成中"但 Google Drive 无文件

---

## 一、问题现象

| 项目 | 值 |
|------|-----|
| 批次 | 20260127-192734 |
| 任务数 | 2 个 |
| 并发数 | 5 |
| 任务1状态 | 生成中... 已收到 22268 字 |
| 任务2状态 | 生成中... 已收到 22488 字 |
| 实际结果 | Google Drive 文件夹为空 |

---

## 二、AI代码模式完整流程

### 2.1 流程图

```
用户点击"开始批量生成"
     ↓
[第1步] 前端发送 POST /api/batch/generate-stream
     ↓
[第2步] 后端创建批次文件夹（Google Drive）
     ↓
[第3步] 并发池分配任务
     ↓
[第4步] 执行单个任务 executeTask()
     │
     ├─[4.1] 调用 invokeAIStream() 生成内容
     │       → 发送 task-progress 事件（已收到 XXX 字）
     │
     ├─[4.2] 判断 templateType === 'ai_code'
     │
     ├─[4.3] 调用 processAICodeGeneration()
     │       │
     │       ├─[4.3.1] 调用 AI 生成 docx-js 代码
     │       │         → 发送 task-progress（AI正在生成代码...）
     │       │
     │       ├─[4.3.2] 执行代码（带重试）executeWithRetry()
     │       │         │
     │       │         ├─ 清理输出目录
     │       │         ├─ 在 NodeVM 沙箱中执行代码
     │       │         ├─ 如果失败，调用 AI 修正代码
     │       │         └─ 最多重试 3 次
     │       │
     │       └─[4.3.3] 验证生成的 docx 文件
     │
     ├─[4.4] 读取生成的 Buffer
     │
     └─[4.5] 上传到 Google Drive
            → 发送 task-complete 事件
```

### 2.2 关键文件和函数

| 步骤 | 文件 | 函数 |
|------|------|------|
| 入口路由 | `server/batch/batchRoutes.ts` | `router.post("/generate-stream")` |
| 任务执行 | `server/batch/batchRoutes.ts` | `executeTask()` (第 442 行) |
| AI代码处理 | `server/core/aiCodeProcessor.ts` | `processAICodeGeneration()` |
| 代码重试 | `server/core/codeRetry.ts` | `executeWithRetry()` |
| AI代码修正 | `server/core/aiCodeFixer.ts` | `createAICodeFixer()` |
| 沙箱执行 | `server/core/codeSandbox.ts` | `executeInSandbox()` |
| docx验证 | `server/core/docxValidator.ts` | `validateDocx()` |

---

## 三、SSE 事件类型

### 3.1 批量处理支持的事件

| 事件类型 | 数据格式 | 触发时机 |
|----------|----------|----------|
| `batch-start` | `{batchId, totalTasks, concurrency, startNumber, endNumber}` | 批次开始 |
| `batch-complete` | `{batchId, totalTasks, completedTasks, failedTasks}` | 批次完成 |
| `batch-error` | `{batchId, error}` | 批次级错误 |
| `task-start` | `{taskNumber, batchId}` | 单个任务开始 |
| `task-progress` | `{taskNumber, chars, message?}` | 任务进度更新 |
| `task-complete` | `{taskNumber, batchId, filename, url}` | 任务完成 |
| `task-error` | `{taskNumber, batchId, error}` | 任务失败 |
| `task-retry` | `{taskNumber, batchId, retryCount, maxRetries, error}` | 任务重试 |
| `heartbeat` | `{timestamp}` | 心跳（每15秒） |

### 3.2 心跳机制

批量处理 SSE 端点**已实现**心跳机制（第 323-334 行）：

```typescript
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
```

---

## 四、重试机制实现状态

### 4.1 V52 设计的重试机制

| 功能 | 实现状态 | 说明 |
|------|----------|------|
| 代码沙箱执行 | ✅ 已实现 | `codeSandbox.ts` |
| 错误格式化 | ✅ 已实现 | `errorFormatter.ts` |
| 重试控制器 | ✅ 已实现 | `codeRetry.ts` |
| AI代码修正 | ✅ 已实现 | `aiCodeFixer.ts` |
| docx验证 | ✅ 已实现 | `docxValidator.ts` |
| 整合处理器 | ✅ 已实现 | `aiCodeProcessor.ts` |

### 4.2 重试流程

重试机制**已完整实现**，流程如下：

```
AI返回初始代码
     ↓
executeWithRetry() 执行代码
     ↓ 失败
formatErrorForAI() 格式化错误信息
     ↓
createAICodeFixer() 调用 AI 修正代码
     ↓
重新执行修正后的代码
     ↓ 再次失败
继续重试（最多 3 次）
     ↓ 全部失败
返回失败结果
```

### 4.3 配置参数

| 参数 | 值 | 位置 |
|------|-----|------|
| 最大重试次数 | 3 | `aiCodeProcessor.ts` 第 91 行 |
| 沙箱超时 | 30秒 | `codeSandbox.ts` 第 201 行 |
| AI温度 | 0.3 | `aiCodeFixer.ts` 第 84 行 |

---

## 五、问题分析

### 5.1 可能的失败点

根据代码分析，任务卡在"生成中"状态可能有以下原因：

| 可能原因 | 概率 | 说明 |
|----------|------|------|
| AI代码生成阶段失败 | 高 | 第一次 AI 调用返回的是文档内容，不是代码 |
| 沙箱执行失败 | 中 | AI 生成的代码有语法错误或运行时错误 |
| 重试全部失败 | 中 | 3 次重试都没有成功 |
| 错误未正确传递给前端 | 低 | 可能有异常未被捕获 |

### 5.2 关键发现

**问题定位**：AI代码模式的流程是**两次 AI 调用**：

1. **第一次调用**：`invokeAIStream()` 生成文档内容（这就是"已收到 22268 字"的来源）
2. **第二次调用**：`processAICodeGeneration()` 中的 `callAIForCode()` 生成 docx-js 代码

问题很可能出在**第二次 AI 调用**或**沙箱执行**阶段，但这些阶段的进度/错误信息没有完整传递给前端。

### 5.3 代码分析

查看 `batchRoutes.ts` 第 641-689 行的 ai_code 分支：

```typescript
} else if (templateType === 'ai_code') {
  // AI代码生成模式：AI生成 docx-js 代码，沙箱执行生成 Word
  console.log(`[BatchRoutes] 任务 ${taskNumber} 进入 ai_code 模式`);
  
  // 构建用户提示词（包含任务编号和原始内容）
  const aiCodePrompt = `任务编号: ${taskNumber}\n\n${content}`;
  
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
    { ... },
    (message) => {
      // 进度回调
      sendSSEEvent(res, "task-progress", { ... });
    }
  );
  
  // 检查结果
  if (!aiCodeResult.success || !aiCodeResult.outputPath) {
    const errorMsg = aiCodeResult.errors.join('; ');
    console.error(`[BatchRoutes] 任务 ${taskNumber} AI代码生成失败:`, errorMsg);
    throw new Error(`AI代码生成失败 (尝试${aiCodeResult.totalAttempts}次): ${errorMsg}`);
  }
```

**问题**：如果 `processAICodeGeneration()` 抛出异常或返回失败，错误会被 `executeTaskWithRetry()` 捕获并重试，但如果重试也全部失败，最终会发送 `task-error` 事件。

---

## 六、排查建议

### 6.1 需要查看的日志

由于无法获取实际的服务器日志，建议下次测试时关注以下日志输出：

```
[BatchRoutes] 任务 X 进入 ai_code 模式
[AICodeProcessor] 开始生成代码...
[AICodeProcessor] AI返回代码，长度: XXX 字符
[AICodeProcessor] 开始执行代码...
[AICodeProcessor] 第 1 次尝试...
[沙箱] 准备执行代码，代码长度: XXX
[沙箱] 代码前200字符: ...
[沙箱] NodeVM 配置: ...
[沙箱] vm.run 返回: ...
```

### 6.2 可能的问题场景

| 场景 | 日志特征 | 解决方案 |
|------|----------|----------|
| AI 返回的不是代码 | "AI返回代码，长度: 0" 或内容是自然语言 | 优化 AI 提示词 |
| 代码语法错误 | "[沙箱] SyntaxError: ..." | AI 重试修正 |
| 代码运行时错误 | "[沙箱] TypeError/ReferenceError: ..." | AI 重试修正 |
| 没有生成 docx 文件 | "[沙箱] NoOutputError" | 检查代码逻辑 |
| 沙箱超时 | "[沙箱] TimeoutError" | 增加超时时间 |

---

## 七、改进建议

### 7.1 详细状态显示

当前前端只显示"生成中... 已收到 XXX 字"，建议增加更详细的状态：

```
[1/5] AI生成内容中... 已收到 22268 字 ✓
[2/5] AI生成代码中...
[3/5] 代码执行中... (尝试 1/3)
[4/5] 文件验证中...
[5/5] 上传中...
```

### 7.2 错误信息透传

当前 `processAICodeGeneration()` 的进度回调只传递 message，建议增加：

```typescript
onProgress?: (status: {
  step: 'generating' | 'executing' | 'validating' | 'uploading';
  attempt?: number;
  maxAttempts?: number;
  error?: string;
  message: string;
}) => void
```

### 7.3 人工干预机制

当自动重试全部失败后，可以：

1. 暂停任务，状态显示「需要人工干预」
2. 弹出文本框，显示错误信息
3. 用户输入额外提示词
4. 带着用户提示词重新请求 AI

---

## 八、结论

| 问题 | 回答 |
|------|------|
| AI代码模式的完整流程是什么？ | 见第二节流程图 |
| 重试机制是否已实现？ | ✅ 已完整实现（最多3次） |
| 心跳机制是否已实现？ | ✅ 已实现（每15秒） |
| 这次任务失败的具体原因？ | 需要查看服务器日志确认 |

**下一步**：建议在开发环境重新测试 AI 代码模式，观察服务器日志输出，定位具体失败环节。
