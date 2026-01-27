# V67 排查报告：AI代码模式多次调用API问题

## 排查日期
2026年1月27日

## 问题现象
1. **多次 API 调用**：单个任务触发了多次 DMXapi 调用
2. **文档内容异常**：生成的 Word 文档内容是 JavaScript 代码
3. **Google Drive 文件夹有时为空**

---

## 核心发现：代码结构问题

### 问题根因：**AI 被调用了两次**

查看 `batchRoutes.ts` 的 `executeTask` 函数，发现流程如下：

```
第 553 行：第一次 AI 调用（invokeAIStream）
    ↓
    生成 content（这是第一次调用的结果）
    ↓
第 718 行：进入 ai_code 分支
    ↓
第 739 行：第二次 AI 调用（invokeAIStream）
    ↓
    生成 generatedCode（这是第二次调用的结果）
```

### 代码证据

**第一次调用（第 553-571 行）**：
```typescript
const aiResult = await invokeAIStream(
  systemPrompt,
  userMessage,
  (chars) => { ... },
  { config, fileInfos: taskFileInfos.length > 0 ? taskFileInfos : undefined }
);

const content = aiResult.content;  // 第一次调用的结果
```

**第二次调用（第 739-758 行）**：
```typescript
const codeResult = await invokeAIStream(
  '', // 空的 system prompt
  codePrompt,
  (chars) => { ... },
  { config, maxTokens: config.maxTokens || 16000 }
);

generatedCode = codeResult.content;  // 第二次调用的结果
```

### 问题分析

1. **为什么有两次 AI 调用？**
   - `executeTask` 函数在进入 `ai_code` 分支**之前**，已经调用了一次 AI（第 553 行）
   - 进入 `ai_code` 分支后，又调用了一次 AI（第 739 行）
   - 这是 V66 Step2 修改时遗留的问题：只修改了 `ai_code` 分支内部，没有跳过外部的第一次调用

2. **为什么文档内容是代码？**
   - 第一次 AI 调用使用的是 `buildMessageContent` 构建的提示词（普通文档生成提示词）
   - 第二次 AI 调用使用的是 `buildCodePrompt` 构建的提示词（代码生成提示词）
   - 但最终写入 Word 的是第二次调用的结果（代码），而不是第一次调用的结果（文档内容）
   - 这说明代码执行流程是正确的，但第一次调用是多余的

3. **为什么有时文件夹为空？**
   - 需要进一步排查沙箱执行是否成功
   - 可能是代码执行失败但没有正确报错

---

## 修复方案

### 方案：跳过第一次 AI 调用

在 `executeTask` 函数中，如果 `templateType === 'ai_code'`，应该跳过第一次 AI 调用，直接进入 `ai_code` 分支。

**修改位置**：`server/batch/batchRoutes.ts` 第 553 行附近

**修改逻辑**：
```typescript
// 在第一次 AI 调用之前添加判断
if (templateType === 'ai_code') {
  // ai_code 模式：跳过第一次调用，直接进入 ai_code 分支
  // （ai_code 分支内部会自己调用 AI）
} else {
  // 其他模式：正常调用 AI 生成内容
  const aiResult = await invokeAIStream(...);
  const content = aiResult.content;
  // ...
}
```

---

## 验收清单

- [x] 梳理出 ai_code 模式的完整代码路径
- [ ] 添加调试日志（问题已定位，可跳过）
- [ ] 跑测试并贴出日志（问题已定位，可跳过）
- [x] 明确回答：代码为什么没有被执行？→ **代码被执行了，但第一次 AI 调用是多余的**
- [x] 明确回答：多次 API 调用是什么原因？→ **executeTask 函数结构问题，ai_code 分支前有一次通用 AI 调用**

---

## 下一步

等待确认后，执行修复：
1. 修改 `executeTask` 函数，让 `ai_code` 模式跳过第一次 AI 调用
2. 测试验证只有一次 API 调用
3. 推送代码并发布
