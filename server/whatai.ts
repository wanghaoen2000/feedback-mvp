/**
 * 神马中转API调用模块
 * Base URL: https://api.whatai.cc/v1
 * 默认模型: claude-opus-4-5-20251101-thinking
 */

const WHATAI_API_KEY = process.env.WHATAI_API_KEY || "sk-wOwJ32UuaB0d96sTGVTt4b1LV8oFEETM7PoFbyIj8mZO4fmT";
const WHATAI_BASE_URL = "https://api.whatai.cc/v1";

// 模型选择
export const MODELS = {
  // 最强模型，用于复杂任务
  OPUS: "claude-opus-4-5-20251101-thinking",
  // 平衡模型，速度与智能平衡
  SONNET: "claude-3-5-sonnet-20240620",
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
 * 调用神马中转API
 * @param messages 消息列表
 * @param options 可选参数
 */
export async function invokeWhatAI(
  messages: WhatAIMessage[],
  options?: {
    model?: string;
    max_tokens?: number;
    temperature?: number;
  }
): Promise<WhatAIResponse> {
  const model = options?.model || MODELS.OPUS;
  const max_tokens = options?.max_tokens || 8000;
  const temperature = options?.temperature ?? 0.7;

  console.log(`[WhatAI] 调用模型: ${model}`);
  console.log(`[WhatAI] 消息数量: ${messages.length}`);

  const response = await fetch(`${WHATAI_BASE_URL}/chat/completions`, {
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
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[WhatAI] API错误: ${response.status} - ${errorText}`);
    throw new Error(`WhatAI API错误: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as WhatAIResponse;
  console.log(`[WhatAI] 响应完成，使用tokens: ${data.usage?.total_tokens || "未知"}`);
  
  return data;
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
  });
}

/**
 * 复杂任务调用（使用Opus模型）
 */
export async function invokeWhatAIComplex(
  messages: WhatAIMessage[],
  max_tokens?: number
): Promise<WhatAIResponse> {
  return invokeWhatAI(messages, {
    model: MODELS.OPUS,
    max_tokens: max_tokens || 8000,
  });
}
