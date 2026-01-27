# V67 重试排查报告 - 为什么重试仍然发生

**排查时间**：2026年1月27日
**问题现象**：V67 修复后，网络面板仍显示 3 次 batch_create_event_v2 请求

---

## 一、当前代码中的重试配置

### 1. grep "MAX_RETRIES" server/
```
server/batch/batchRoutes.ts:23:const MAX_RETRIES = 0;
server/batch/batchRoutes.ts:348:      if (retryCount < MAX_RETRIES) {
server/batch/batchRoutes.ts:349:        console.log(`[BatchRoutes] 任务 ${taskNumber} 失败，正在重试 (${retryCount + 1}/${MAX_RETRIES})...`);
server/batch/batchRoutes.ts:356:          maxRetries: MAX_RETRIES,
```
**结论**：batchRoutes.ts 的 MAX_RETRIES 已设为 0 ✅

### 2. grep "maxRetries" server/ (排除测试文件)
```
server/batch/batchRoutes.ts:356:          maxRetries: MAX_RETRIES,
server/core/aiClient.ts:131:  const maxRetries = options?.retries ?? 0;  // V67: 禁用重试，默认为0
server/core/aiClient.ts:204:  for (let attempt = 0; attempt <= maxRetries; attempt++) {
server/gdrive.ts:149:  maxRetries: number = 1,
server/gdrive.ts:184:  maxRetries: number = 1  // V67: 禁用重试，默认为1
server/gdrive.ts:303:  maxRetries: number = 1  // V67: 禁用重试，默认为1
server/whatai.ts:111:  const maxRetries = options?.retries ?? 0; // V67: 禁用重试，默认为0
server/whatai.ts:210:  const maxRetries = options?.retries ?? 0;  // V67: 禁用重试，默认为0
```
**结论**：aiClient.ts 和 whatai.ts 的 maxRetries 默认值已设为 0 ✅

### 3. grep "retries" server/ - 发现问题！
```
server/whatai.ts:341:    retries: 1,
server/whatai.ts:357:    retries: 2,
```

**⚠️ 发现问题**：whatai.ts 中有两个硬编码的 retries 调用！

---

## 二、问题根源：whatai.ts 硬编码 retries

### 位置：server/whatai.ts 第 335-365 行

```typescript
// 简单任务调用（使用Haiku模型）
export async function invokeWhatAISimple(
  messages: WhatAIMessage[],
  max_tokens?: number,
  config?: APIConfig
): Promise<WhatAIResponse> {
  return invokeWhatAI(messages, {
    model: config?.apiModel || MODELS.HAIKU,
    max_tokens: max_tokens || 32000,
    timeout: 180000, // 简单任务3分钟超时
    retries: 1,  // ⚠️ 硬编码 retries: 1
  }, config);
}

// 复杂任务调用（使用默认Sonnet模型）
export async function invokeWhatAIComplex(
  messages: WhatAIMessage[],
  max_tokens?: number,
  config?: APIConfig
): Promise<WhatAIResponse> {
  return invokeWhatAI(messages, {
    model: config?.apiModel || MODELS.DEFAULT,
    max_tokens: max_tokens || 32000,
    timeout: 600000, // 复杂任务10分钟超时
    retries: 2,  // ⚠️ 硬编码 retries: 2
  }, config);
}
```

---

## 三、另一个重试源：codeRetry.ts

### 位置：server/core/codeRetry.ts

```typescript
export async function executeWithRetry(
  initialCode: string,
  codeFixer: CodeFixerFn,
  config: RetryConfig = {}
): Promise<RetryResult> {
  const maxAttempts = config.maxAttempts || 3;  // ⚠️ 默认 3 次尝试
  // ...
  while (attempt < maxAttempts) {
    // 执行代码，失败则重试
  }
}
```

### 调用处：server/core/aiCodeProcessor.ts 第 104 行
```typescript
const maxAttempts = config.maxAttempts || 3;  // ⚠️ 默认 3 次尝试
```

**这是 AI 代码模式的重试逻辑**：生成的代码执行失败时，会调用 AI 修正代码并重试，最多 3 次。

---

## 四、Git 状态确认

```
$ git log --oneline -5
e7d6e6f (HEAD -> main) V67 Step4: 禁用所有重试逻辑 - batchRoutes/aiClient/whatai/gdrive 默认重试次数设为0或1
a7b6819 V67: 更新版本号
b966c3c V67: 修复ai_code模式重复AI调用 - 跳过通用AI调用
9db5685 V66 Step2.1: 修复重做流程ai_code分支为单次调用
53fcdc7 V66: 更新版本号

$ cat scripts/generate-version.cjs | grep VERSION
const VERSION = 'V67';
```

**结论**：代码已提交到 main 分支 ✅

---

## 五、总结：遗漏的重试位置

| 文件 | 位置 | 当前值 | 需要改为 |
|------|------|--------|----------|
| `server/whatai.ts` | 第 341 行 `invokeWhatAISimple` | `retries: 1` | `retries: 0` |
| `server/whatai.ts` | 第 357 行 `invokeWhatAIComplex` | `retries: 2` | `retries: 0` |
| `server/core/codeRetry.ts` | 第 47 行 | `maxAttempts \|\| 3` | `maxAttempts \|\| 1` |
| `server/core/aiCodeProcessor.ts` | 第 104 行 | `maxAttempts \|\| 3` | `maxAttempts \|\| 1` |

---

## 六、下一步建议

1. **修改 whatai.ts**：将两个硬编码的 `retries` 改为 0
2. **修改 codeRetry.ts**：将默认 `maxAttempts` 改为 1
3. **修改 aiCodeProcessor.ts**：将默认 `maxAttempts` 改为 1
4. **重新构建并发布**

---

**报告完成，等待用户确认后再修改代码。**
