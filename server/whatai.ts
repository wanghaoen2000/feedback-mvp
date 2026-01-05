/**
 * 神马中转API调用模块
 * Base URL: https://api.whatai.cc/v1
 * 默认模型: claude-sonnet-4-5-20250929
 */

const WHATAI_API_KEY = process.env.WHATAI_API_KEY || "sk-wOwJ32UuaB0d96sTGVTt4b1LV8oFEETM7PoFbyIj8mZO4fmT";
const WHATAI_BASE_URL = "https://api.whatai.cc/v1";

// 模型选择
export const MODELS = {
  // 默认模型，性价比最高
  DEFAULT: "claude-sonnet-4-5-20250929",
  // Sonnet 4.5（带思考），用于需要深度推理的任务
  SONNET_THINKING: "claude-sonnet-4-5-20250929-thinking",
  // 旧版Sonnet，备用
  SONNET_OLD: "claude-3-5-sonnet-20240620",
  // 最快最省模型
  HAIKU: "claude-3-haiku-20240307",
};

export interface WhatAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface WhatAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 带超时的fetch
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = 180000 // 默认3分钟超时
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 调用神马中转API（带重试机制）
 * @param messages 消息列表
 * @param options 可选参数
 */
export async function invokeWhatAI(
  messages: WhatAIMessage[],
  options?: {
    model?: string;
    max_tokens?: number;
    temperature?: number;
    timeout?: number; // 超时时间（毫秒）
    retries?: number; // 重试次数
  }
): Promise<WhatAIResponse> {
  const model = options?.model || MODELS.DEFAULT;
  const max_tokens = options?.max_tokens || 8000;
  const temperature = options?.temperature ?? 0.7;
  const timeout = options?.timeout || 600000; // 默认10分钟
  const maxRetries = options?.retries ?? 2; // 默认重试2次

  console.log(`[WhatAI] 调用模型: ${model}`);
  console.log(`[WhatAI] 消息数量: ${messages.length}`);
  console.log(`[WhatAI] 超时设置: ${timeout / 1000}秒`);

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[WhatAI] 第${attempt}次重试...`);
      await delay(2000 * attempt); // 递增延迟
    }
    
    try {
      const response = await fetchWithTimeout(
        `${WHATAI_BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${WHATAI_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens,
            temperature,
          }),
        },
        timeout
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WhatAI] API错误: ${response.status} - ${errorText}`);
        
        // 如果是余额不足等不可重试的错误，直接抛出
        if (response.status === 403 || response.status === 401) {
          throw new Error(`WhatAI API错误: ${response.status} - ${errorText}`);
        }
        
        lastError = new Error(`WhatAI API错误: ${response.status} - ${errorText}`);
        continue; // 尝试重试
      }

      const data = await response.json() as WhatAIResponse;
      console.log(`[WhatAI] 响应完成，使用tokens: ${data.usage?.total_tokens || "未知"}`);
      
      return data;
    } catch (error: any) {
      console.error(`[WhatAI] 请求失败 (尝试 ${attempt + 1}/${maxRetries + 1}):`, error.message);
      
      // 如果是AbortError（超时），记录并继续重试
      if (error.name === 'AbortError') {
        lastError = new Error(`请求超时（${timeout / 1000}秒）`);
      } else {
        lastError = error;
      }
      
      // 如果是不可重试的错误，直接抛出
      if (error.message?.includes('403') || error.message?.includes('401')) {
        throw error;
      }
    }
  }
  
  // 所有重试都失败
  throw lastError || new Error('API调用失败');
}

/**
 * 简单任务调用（使用Haiku模型）
 */
export async function invokeWhatAISimple(
  messages: WhatAIMessage[],
  max_tokens?: number
): Promise<WhatAIResponse> {
  return invokeWhatAI(messages, {
    model: MODELS.HAIKU,
    max_tokens: max_tokens || 2000,
    timeout: 180000, // 简单任务3分钟超时
    retries: 1,
  });
}

/**
 * 复杂任务调用（使用默认Sonnet模型）
 */
export async function invokeWhatAIComplex(
  messages: WhatAIMessage[],
  max_tokens?: number
): Promise<WhatAIResponse> {
  return invokeWhatAI(messages, {
    model: MODELS.DEFAULT,
    max_tokens: max_tokens || 8000,
    timeout: 600000, // 复杂任务10分钟超时
    retries: 2,
  });
}
