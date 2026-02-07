/**
 * AI代码生成Word处理器
 * 整合沙箱执行、重试、验证等模块
 */

import { executeWithRetry, RetryResult } from './codeRetry';
import { createAICodeFixer, AIConfig } from './aiCodeFixer';
import { validateDocx } from './docxValidator';
import { cleanOutputDir } from './codeSandbox';
import * as fs from 'fs';
import * as path from 'path';

// 处理配置
export interface AICodeProcessorConfig {
  aiConfig: AIConfig;           // AI配置
  outputDir?: string;           // 输出目录
  maxAttempts?: number;         // 最大重试次数
  validateStructure?: boolean;  // 是否验证docx结构
}

// 处理结果
export interface ProcessResult {
  success: boolean;
  outputPath?: string;          // 生成的文件路径
  totalAttempts: number;        // 总尝试次数
  errors: string[];             // 错误记录
  validationResult?: {          // 验证结果
    valid: boolean;
    error?: string;
  };
  executionTime: number;        // 总耗时
}

// AI代码生成的系统提示词
const AI_CODE_SYSTEM_PROMPT = `你是一个专业的 JavaScript/docx-js 代码专家。
用户会给你一个文档生成需求，你需要编写 docx-js 代码来生成 Word 文档。

【重要】docx、fs、path 模块已作为全局变量注入，请直接使用，不要使用 require()。

代码要求：
1. docx 库已作为全局变量注入，直接解构使用：const { Document, Paragraph, ... } = docx;
2. fs 和 path 已作为全局变量注入，直接使用 fs.writeFileSync() 和 path.join()
3. 最终使用 Packer.toBuffer() 生成文档，并用 fs.writeFileSync() 写入文件
4. 输出路径使用 __outputDir 变量（已注入沙箱环境）
5. 根据文档内容决定一个有意义的中文文件名，如 "托福词汇_学术场景.docx"、"新托福口语List03_图书馆场景.docx"
   - 文件名要能体现文档内容
   - 文件名不要包含非法字符（\ / : * ? " < > |）
   - 文件名必须以 .docx 结尾

输出要求：
1. 只输出可执行的 JavaScript 代码
2. 不要输出任何解释、说明或 markdown 标记
3. 不要输出 \`\`\`javascript 和 \`\`\` 标记
4. 确保代码可以直接执行
5. 不要使用 require()，模块已全局注入

示例代码结构：
// docx、fs、path 已作为全局变量注入，无需 require
const { Document, Paragraph, TextRun, Packer, Table, TableRow, TableCell, 
        WidthType, BorderStyle, AlignmentType, HeadingLevel, 
        PageBreak, Header, Footer, ImageRun } = docx;

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: { name: "微软雅黑", eastAsia: "微软雅黑" } },
      },
    },
  },
  sections: [{
    children: [
      // 文档内容
    ]
  }]
});

// 根据内容决定文件名
const fileName = "托福词汇_学术场景.docx";  // ← AI根据实际内容决定

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(path.join(__outputDir, fileName), buffer);
});`;

/**
 * 处理AI代码生成请求
 * @param userPrompt - 用户的文档生成需求（路书）
 * @param config - 处理配置
 * @param onProgress - 进度回调
 */
export async function processAICodeGeneration(
  userPrompt: string,
  config: AICodeProcessorConfig,
  onProgress?: (message: string) => void
): Promise<ProcessResult> {
  const startTime = Date.now();
  const outputDir = config.outputDir || '/tmp/docx-output';
  const maxAttempts = config.maxAttempts || 3;
  const validateStructure = config.validateStructure ?? true;

  // 清理输出目录
  cleanOutputDir(outputDir);

  // 进度回调
  const log = (msg: string) => {
    console.log(`[AICodeProcessor] ${msg}`);
    if (onProgress) onProgress(msg);
  };

  log('开始生成代码...');

  // 1. 第一次调用AI生成代码
  let initialCode: string;
  try {
    const response = await callAIForCode(config.aiConfig, userPrompt);
    initialCode = response;
    log(`AI返回代码，长度: ${initialCode.length} 字符`);
  } catch (err: any) {
    return {
      success: false,
      totalAttempts: 0,
      errors: [`AI调用失败: ${err.message}`],
      executionTime: Date.now() - startTime
    };
  }

  // 2. 创建AI修正函数
  const aiFixer = createAICodeFixer(config.aiConfig, AI_CODE_SYSTEM_PROMPT);

  // 3. 执行代码（带重试）
  log('开始执行代码...');
  const retryResult = await executeWithRetry(
    initialCode,
    aiFixer,
    {
      maxAttempts,
      sandboxConfig: { outputDir },
      onAttempt: (attempt) => log(`第 ${attempt} 次尝试...`),
      onError: (attempt, error) => log(`第 ${attempt} 次失败: ${error}`)
    }
  );

  // 4. 如果执行失败
  if (!retryResult.success || !retryResult.outputPath) {
    return {
      success: false,
      totalAttempts: retryResult.totalAttempts,
      errors: retryResult.errors,
      executionTime: Date.now() - startTime
    };
  }

  log(`代码执行成功，文件: ${retryResult.outputPath}`);

  // 5. 验证生成的文件
  log('验证文件...');
  const validation = validateDocx(retryResult.outputPath, {
    checkStructure: validateStructure
  });

  if (!validation.valid) {
    return {
      success: false,
      outputPath: retryResult.outputPath,
      totalAttempts: retryResult.totalAttempts,
      errors: [...retryResult.errors, `文件验证失败: ${validation.error}`],
      validationResult: {
        valid: false,
        error: validation.error
      },
      executionTime: Date.now() - startTime
    };
  }

  log('文件验证通过');

  // 6. 成功
  return {
    success: true,
    outputPath: retryResult.outputPath,
    totalAttempts: retryResult.totalAttempts,
    errors: retryResult.errors,
    validationResult: { valid: true },
    executionTime: Date.now() - startTime
  };
}

/**
 * 调用AI生成初始代码
 */
async function callAIForCode(config: AIConfig, userPrompt: string): Promise<string> {
  const { apiUrl, apiKey, model, maxTokens = 16000 } = config;

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: AI_CODE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('AI returned empty content');
  }

  // 清理返回内容（去除markdown标记）
  return cleanCode(content);
}

/**
 * 清理AI返回的代码
 */
function cleanCode(code: string): string {
  let cleaned = code.trim();
  cleaned = cleaned.replace(/^```(?:javascript|js)?\s*\n?/i, '');
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  return cleaned.trim();
}
