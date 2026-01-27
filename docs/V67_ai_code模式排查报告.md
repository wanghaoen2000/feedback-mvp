# V67 排查报告：AI代码模式 Word 格式异常

**排查时间**：2026年1月27日
**问题现象**：AI代码模式生成的 Word 文档顶部显示 JSON 原始数据

---

## 一、ai_code 分支的完整流程

### 代码位置：server/batch/batchRoutes.ts 第 728-856 行

```
流程图：
1. 进入 ai_code 分支 (第 728 行)
2. 发送状态：开始生成代码 (第 733-741 行)
3. 构建代码提示词 buildCodePrompt() (第 744 行)
4. 调用 AI 生成 docx-js 代码 invokeAIStream() (第 749-768 行)
5. 清理代码（去除 markdown 标记）(第 774-777 行)
6. 发送状态：代码执行中 (第 780-789 行)
7. 创建输出目录 (第 792-793 行)
8. 沙箱执行代码 executeInSandbox() (第 796 行)
9. 检查执行结果 (第 798-815 行)
10. 读取生成的文件 (第 820-822 行)
11. 确定文件名 (第 824-847 行)
12. 上传到 Google Drive (后续代码)
```

### 关键代码片段

```typescript
// 第 746-768 行：调用 AI 生成代码
const codeResult = await invokeAIStream(
  '', // 空的 system prompt
  codePrompt,  // 用户消息包含代码生成指令
  (chars) => { /* 进度回调 */ },
  { config, maxTokens: config.maxTokens || 16000 }
);

generatedCode = codeResult.content;

// 第 774-777 行：清理代码
let cleanedCode = generatedCode.trim();
cleanedCode = cleanedCode.replace(/^```(?:javascript|js)?\s*\n?/i, '');
cleanedCode = cleanedCode.replace(/\n?```\s*$/i, '');
cleanedCode = cleanedCode.trim();

// 第 796 行：沙箱执行
const executeResult = await executeInSandbox(cleanedCode, { outputDir });
```

---

## 二、V67 修改是否影响 ai_code 分支？

### V67 的修改内容（commit b966c3c）

V67 添加了"跳过通用 AI 调用"的逻辑：

```typescript
// 第 542-549 行
if (templateType === 'ai_code') {
  // ai_code 模式：跳过通用 AI 调用
  // 后面的 ai_code 分支会自己调用 AI 生成代码
  console.log(`[BatchRoutes] 任务 ${taskNumber} 是 ai_code 模式，跳过通用 AI 调用`);
} else {
  // 其他模式：正常调用 AI 生成内容
  // ...
}
```

**结论：V67 的修改是正确的**。ai_code 模式现在：
1. ✅ 跳过通用 AI 调用（第 546-549 行）
2. ✅ 在 ai_code 分支内部调用 AI 生成代码（第 749-768 行）
3. ✅ 沙箱执行代码（第 796 行）

---

## 三、问题分析

### 代码流程看起来是正确的，那问题出在哪里？

**可能的原因**：

1. **AI 没有返回代码，而是返回了 JSON 数据**
   - `buildCodePrompt()` 的提示词可能不够明确
   - AI 可能误解了指令，返回了数据而不是代码

2. **代码清理逻辑不完整**
   - 只清理了 markdown 代码块标记
   - 如果 AI 返回了其他格式（如 JSON），不会被清理

3. **沙箱执行失败但没有正确报错**
   - 如果代码不是有效的 JavaScript，沙箱会报错
   - 但如果 AI 返回的是"看起来像代码但实际是数据"的内容，可能会执行但产生错误结果

### 需要进一步排查

1. **查看 `buildCodePrompt()` 函数**
   - 确认提示词是否明确要求输出 docx-js 代码

2. **查看后端日志**
   - 确认 AI 返回的内容是什么
   - 确认沙箱执行是否成功

3. **查看生成的 Word 文件**
   - 确认文件内容是什么
   - 确认是代码执行结果还是直接写入的内容

---

## 四、建议的下一步排查

### 1. 查看 buildCodePrompt 函数

```bash
grep -n "buildCodePrompt" server/batch/batchRoutes.ts
# 找到函数定义，查看提示词内容
```

### 2. 添加调试日志

在以下位置添加日志：

```typescript
// 第 771 行后
console.log(`[DEBUG] AI返回内容前100字符: ${generatedCode.substring(0, 100)}`);

// 第 777 行后
console.log(`[DEBUG] 清理后代码前100字符: ${cleanedCode.substring(0, 100)}`);

// 第 796 行后
console.log(`[DEBUG] 沙箱执行结果: success=${executeResult.success}, outputPath=${executeResult.outputPath}`);
```

### 3. 检查是否有其他代码路径

确认是否有其他地方在写入 Word 文件，绕过了沙箱执行。

---

## 五、结论

**代码流程看起来是正确的**：
- ✅ V67 正确跳过了通用 AI 调用
- ✅ ai_code 分支内部调用 AI 生成代码
- ✅ 沙箱执行代码生成 Word 文件

**问题可能出在**：
1. AI 返回的内容不是有效的 docx-js 代码
2. `buildCodePrompt()` 的提示词需要优化
3. 需要查看后端日志确认实际执行情况

**建议**：先查看 `buildCodePrompt()` 函数和后端日志，确认 AI 返回的内容是什么。

---

**报告完成，等待用户确认后再进一步排查。**
