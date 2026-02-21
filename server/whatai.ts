/**
 * 神马中转API调用模块
 * Base URL: https://api.whatai.cc/v1
 * 默认模型: claude-sonnet-4-5-20250929
 */

// 默认配置（可被覆盖）
const DEFAULT_API_KEY = process.env.WHATAI_API_KEY || "";
const DEFAULT_BASE_URL = "https://www.DMXapi.com/v1";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

// 模型选择
export const MODELS = {
  // 默认模型，性价比最高
  DEFAULT: DEFAULT_MODEL,
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

// API配置接口
export interface APIConfig {
  apiModel?: string;
  apiKey?: string;
  apiUrl?: string;
  roadmap?: string; // V9路书内容（可选）
  maxTokens?: number; // 最大输出 token 数（可选，默认64000）
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
 * @param config 自定义API配置（可覆盖默认值）
 */
export async function invokeWhatAI(
  messages: WhatAIMessage[],
  options?: {
    model?: string;
    max_tokens?: number;
    temperature?: number;
    timeout?: number; // 超时时间（毫秒）
    retries?: number; // 重试次数
  },
  config?: APIConfig
): Promise<WhatAIResponse> {
  // 优先使用config中的配置，否则用options中的，最后用默认值
  const apiKey = config?.apiKey || DEFAULT_API_KEY;
  const baseUrl = config?.apiUrl || DEFAULT_BASE_URL;
  const model = config?.apiModel || options?.model || DEFAULT_MODEL;
  
  const max_tokens = options?.max_tokens || config?.maxTokens || 64000;
  const temperature = options?.temperature ?? 0.7;
  const timeout = options?.timeout || 600000; // 默认10分钟
  const maxRetries = options?.retries ?? 2; // 默认重试2次

  console.log(`[WhatAI] 调用模型: ${model}`);
  console.log(`[WhatAI] API地址: ${baseUrl}`);
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
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
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
 * 流式调用神马中转API（防止超时）
 * 使用SSE流式返回，实时获取生成内容
 * @param messages 消息列表
 * @param options 可选参数
 * @param config 自定义API配置
 * @param onChunk 每收到一块内容时的回调
 */
export async function invokeWhatAIStream(
  messages: WhatAIMessage[],
  options?: {
    model?: string;
    max_tokens?: number;
    temperature?: number;
    timeout?: number;
    retries?: number;
    signal?: AbortSignal; // 外部取消信号（如客户端断连）
  },
  config?: APIConfig,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const apiKey = config?.apiKey || DEFAULT_API_KEY;
  const baseUrl = config?.apiUrl || DEFAULT_BASE_URL;
  const model = config?.apiModel || options?.model || DEFAULT_MODEL;

  const max_tokens = options?.max_tokens || config?.maxTokens || 64000;
  const temperature = options?.temperature ?? 0.7;
  // 连接超时：等待 HTTP 响应头（不含AI思考时间）
  const connectTimeout = options?.timeout || 90_000; // 默认90秒（原来10分钟太长了）
  const maxRetries = options?.retries ?? 2;

  console.log(`[WhatAI流式] 调用模型: ${model}`);
  console.log(`[WhatAI流式] API地址: ${baseUrl}`);
  console.log(`[WhatAI流式] 消息数量: ${messages.length}, 连接超时: ${connectTimeout / 1000}秒`);
  // 详细日志：打印 messages 内容长度
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    console.log(`[WhatAI流式] messages[${i}].role: ${msg.role}, content长度: ${msg.content?.length || 0}`);
  }
  if (messages.length === 0 || messages.some(m => !m.content)) {
    console.error(`[WhatAI流式] 警告: messages 为空或包含空 content!`);
    console.error(`[WhatAI流式] messages:`, JSON.stringify(messages, null, 2));
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[WhatAI流式] 第${attempt}次重试...`);
      await delay(2000 * attempt);
    }

    try {
      // 外部取消检查（如客户端已断连）
      if (options?.signal?.aborted) {
        throw new Error('生成已取消（客户端断开）');
      }

      const controller = new AbortController();
      // 链接外部 signal：客户端断连时立即中止 AI 流
      const onExternalAbort = () => {
        console.log('[WhatAI流式] 收到外部取消信号，中止AI流');
        controller.abort();
      };
      if (options?.signal) {
        options.signal.addEventListener('abort', onExternalAbort, { once: true });
      }

      // 连接超时：等待 API 返回 HTTP 响应头
      const timeoutId = setTimeout(() => {
        console.error(`[WhatAI流式] 连接超时（${connectTimeout / 1000}秒无HTTP响应），中止`);
        controller.abort();
      }, connectTimeout);

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens,
          temperature,
          stream: true, // 启用流式输出
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WhatAI流式] API错误: ${response.status} - ${errorText}`);

        // 4xx 客户端错误：不重试（重试也不会有不同结果）
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`WhatAI API错误: ${response.status} - ${errorText}`);
        }

        // 5xx 服务端错误：可以重试
        lastError = new Error(`WhatAI API错误: ${response.status} - ${errorText}`);
        continue;
      }

      // 读取流式响应
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      // 首 token 超时：流已连接但等待AI输出第一个token（含思考时间）
      const FIRST_TOKEN_TIMEOUT = 180_000; // 3分钟（thinking模型可能需要较长思考）
      // 后续卡死保护：收到首个token后，任意时刻超过60秒无新数据则中止
      const STALL_TIMEOUT = 60_000; // 60秒
      let gotFirstToken = false;
      let stallTimer = setTimeout(() => {
        console.error(`[WhatAI流式] 等待首个token超时（${FIRST_TOKEN_TIMEOUT / 1000}秒），中止`);
        controller.abort();
      }, FIRST_TOKEN_TIMEOUT);
      const resetStallTimer = () => {
        clearTimeout(stallTimer);
        if (!gotFirstToken) {
          gotFirstToken = true;
          console.log(`[WhatAI流式] 收到首个token`);
        }
        stallTimer = setTimeout(() => {
          console.error(`[WhatAI流式] 流式读取卡死（${STALL_TIMEOUT / 1000}秒无数据），中止`);
          controller.abort();
        }, STALL_TIMEOUT);
      };

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      let finishReason = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          resetStallTimer(); // 收到数据，重置卡死计时器

          buffer += decoder.decode(value, { stream: true });

          // 处理SSE格式的数据
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 保留未完成的行

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  fullContent += content;
                  if (onChunk) {
                    onChunk(content);
                  }
                }
                // 检测 finish_reason（兼容 OpenAI 的 'length' 和 Claude 的 'max_tokens'）
                const reason = parsed.choices?.[0]?.finish_reason || parsed.stop_reason;
                if (reason) {
                  finishReason = reason;
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }
      } finally {
        clearTimeout(stallTimer);
        reader.cancel().catch(() => {}); // 释放底层连接，防止资源泄漏
      }

      // 检测是否因 token 限制而截断（兼容 OpenAI 'length' 和 Claude 'max_tokens'）
      if (finishReason === 'length' || finishReason === 'max_tokens') {
        console.warn(`[WhatAI流式] ⚠️ 警告: 输出被截断（finish_reason=${finishReason}，max_tokens=${max_tokens}）`);
        console.warn(`[WhatAI流式] 当前输出长度: ${fullContent.length} 字符`);
        // 使用【】格式防止被 stripAIMetaCommentary 的 /^---+$/ 模式剥离
        fullContent += `\n\n【⚠️ 内容截断警告】以上内容因长度限制被截断（已达到 ${max_tokens} token 上限，finish_reason=${finishReason}），实际内容可能不完整。`;
      }

      console.log(`[WhatAI流式] 响应完成，内容长度: ${fullContent.length}字符, finish_reason: ${finishReason || 'unknown'}`);
      return fullContent;
      
    } catch (error: any) {
      console.error(`[WhatAI流式] 请求失败 (尝试 ${attempt + 1}/${maxRetries + 1}):`, error.message);

      // 外部取消（客户端断连）不重试，直接抛出
      if (options?.signal?.aborted) {
        throw new Error('生成已取消（客户端断开）');
      }

      if (error.name === 'AbortError') {
        lastError = new Error(`请求超时（连接超时${connectTimeout / 1000}秒 / 首token超时180秒 / 卡死超时60秒）`);
      } else {
        lastError = error;
      }

      // 4xx 客户端错误不重试（已在上面 throw，这里是 catch 到的情况）
      if (error.message?.includes('API错误: 4')) {
        throw error;
      }
    }
  }

  throw lastError || new Error('API调用失败');
}

/**
 * 简单任务调用（使用Haiku模型）
 */
export async function invokeWhatAISimple(
  messages: WhatAIMessage[],
  max_tokens?: number,
  config?: APIConfig
): Promise<WhatAIResponse> {
  return invokeWhatAI(messages, {
    model: config?.apiModel || MODELS.HAIKU,
    max_tokens: max_tokens, // 未指定时由 invokeWhatAI 从 config.maxTokens 或默认64000读取
    timeout: 180000, // 简单任务3分钟超时
    retries: 1,
  }, config);
}

/**
 * 复杂任务调用（使用默认Sonnet模型）
 */
export async function invokeWhatAIComplex(
  messages: WhatAIMessage[],
  max_tokens?: number,
  config?: APIConfig
): Promise<WhatAIResponse> {
  return invokeWhatAI(messages, {
    model: config?.apiModel || MODELS.DEFAULT,
    max_tokens: max_tokens, // 未指定时由 invokeWhatAI 从 config.maxTokens 或默认64000读取
    timeout: 600000, // 复杂任务10分钟超时
    retries: 2,
  }, config);
}
