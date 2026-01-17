/**
 * AI代码修正模块
 * 调用AI接口，根据错误反馈修正代码
 */

import { CodeFixerFn } from './codeRetry';

// AI配置
export interface AIConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
}

/**
 * 创建AI代码修正函数
 * @param config - AI配置
 * @param systemPrompt - 系统提示词（告诉AI它的角色）
 */
export function createAICodeFixer(
  config: AIConfig,
  systemPrompt?: string
): CodeFixerFn {
  const defaultSystemPrompt = `你是一个专业的 JavaScript/docx-js 代码修复专家。
用户会给你一段生成 Word 文档的代码和错误信息。
你需要修复代码中的错误，并返回完整的修正后代码。

重要规则：
1. 只输出修正后的完整代码，不要输出任何解释或说明
2. 不要输出 markdown 代码块标记（不要 \`\`\`javascript 和 \`\`\`）
3. 确保代码可以直接执行
4. 保持原有的功能和结构，只修复错误`;

  return async (originalCode: string, errorFeedback: string, attempt: number): Promise<string> => {
    const userMessage = `原始代码：
\`\`\`javascript
${originalCode}
\`\`\`

${errorFeedback}`;

    try {
      // 调用AI接口
      const response = await callAI(config, systemPrompt || defaultSystemPrompt, userMessage);
      
      // 清理返回内容
      const cleanedCode = cleanAIResponse(response);
      
      console.log(`[AICodeFixer] Attempt ${attempt} received ${cleanedCode.length} chars of code`);
      
      return cleanedCode;
    } catch (error: any) {
      console.error(`[AICodeFixer] Attempt ${attempt} AI call failed:`, error.message);
      throw error;
    }
  };
}

/**
 * 调用AI接口
 * 基于项目现有的 llm.ts 风格实现
 */
async function callAI(
  config: AIConfig,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
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
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,  // 低温度，让输出更稳定
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
  
  return content;
}

/**
 * 清理AI返回的内容
 * - 去除 markdown 代码块标记
 * - 去除前后空白
 */
export function cleanAIResponse(response: string): string {
  let cleaned = response.trim();
  
  // 去除开头的 ```javascript 或 ```js 或 ```
  cleaned = cleaned.replace(/^```(?:javascript|js)?\s*\n?/i, '');
  
  // 去除结尾的 ```
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  
  // 再次trim
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * 从数据库配置创建AI修正函数
 * 这个函数会在实际使用时调用，从系统配置中读取API设置
 */
export async function createAICodeFixerFromConfig(
  getConfigFn: (key: string) => Promise<string | null>
): Promise<CodeFixerFn> {
  const apiUrl = await getConfigFn('apiUrl') || 'https://www.dmxapi.com/v1';
  const apiKey = await getConfigFn('apiKey') || '';
  const model = await getConfigFn('apiModel') || 'claude-sonnet-4-5-20250929';
  
  if (!apiKey) {
    throw new Error('API key not configured');
  }
  
  return createAICodeFixer({
    apiUrl,
    apiKey,
    model,
    maxTokens: 16000,
  });
}
