/**
 * AI 调用模块
 * 封装 AI API 调用，提供统一的接口
 */
import { getDb } from "../db";
import { systemConfig } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// 默认配置值
const DEFAULT_CONFIG = {
  apiModel: "claude-sonnet-4-5-20250929",
  apiKey: process.env.WHATAI_API_KEY || "sk-WyfaRl3qxKk8gpaptVWUfe1ZiJYQg0Vqjd7nscsZMT4l0c9U",
  apiUrl: "https://www.DMXapi.com/v1",
  currentYear: "2026",
  roadmap: "",
  roadmapClass: "",
  driveBasePath: "Mac/Documents/XDF/学生档案",
  maxTokens: "64000",
};

/**
 * API 配置接口
 */
export interface APIConfig {
  apiModel: string;
  apiKey: string;
  apiUrl: string;
  roadmap?: string;
  roadmapClass?: string;
  driveBasePath?: string;
  currentYear?: string;
  maxTokens?: number;
}

/**
 * 从数据库读取单个配置值
 */
async function getConfigValue(key: string): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return DEFAULT_CONFIG[key as keyof typeof DEFAULT_CONFIG] || "";
    const result = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
    if (result.length > 0 && result[0].value) {
      return result[0].value;
    }
  } catch (e) {
    console.error(`获取配置 ${key} 失败:`, e);
  }
  return DEFAULT_CONFIG[key as keyof typeof DEFAULT_CONFIG] || "";
}

/**
 * 获取完整的 API 配置
 * 从数据库读取所有 API 相关配置
 */
export async function getAPIConfig(): Promise<APIConfig> {
  const [apiModel, apiKey, apiUrl, roadmap, roadmapClass, driveBasePath, currentYear, maxTokensStr] = await Promise.all([
    getConfigValue("apiModel"),
    getConfigValue("apiKey"),
    getConfigValue("apiUrl"),
    getConfigValue("roadmap"),
    getConfigValue("roadmapClass"),
    getConfigValue("driveBasePath"),
    getConfigValue("currentYear"),
    getConfigValue("maxTokens"),
  ]);

  return {
    apiModel: apiModel || DEFAULT_CONFIG.apiModel,
    apiKey: apiKey || DEFAULT_CONFIG.apiKey,
    apiUrl: apiUrl || DEFAULT_CONFIG.apiUrl,
    roadmap,
    roadmapClass,
    driveBasePath: driveBasePath || DEFAULT_CONFIG.driveBasePath,
    currentYear: currentYear || DEFAULT_CONFIG.currentYear,
    maxTokens: parseInt(maxTokensStr || DEFAULT_CONFIG.maxTokens, 10),
  };
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 文件信息类型
export interface FileInfo {
  type: 'document' | 'image';
  url?: string;
  base64DataUri?: string;
  mimeType: string;
  extractedText?: string;  // 文档提取的纯文本内容
}

// AI响应结果类型
export interface AIStreamResult {
  content: string;
  truncated: boolean;
  stopReason?: string;
}

/**
 * 流式调用 AI API
 * @param systemPrompt 系统提示词
 * @param userMessage 用户消息
 * @param onProgress 进度回调，参数为当前累计字符数
 * @param options 可选参数
 * @returns AI响应结果，包含内容和截断状态
 */
export async function invokeAIStream(
  systemPrompt: string,
  userMessage: string,
  onProgress?: (chars: number) => void,
  options?: {
    config?: APIConfig;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
    retries?: number;
    fileInfo?: FileInfo;  // 单文件信息（向后兼容）
    fileInfos?: FileInfo[];  // 多文件信息（新增）
  }
): Promise<AIStreamResult> {
  // 获取配置
  const config = options?.config || await getAPIConfig();
  // 优先级：options.maxTokens > config.maxTokens > 默认值64000
  const maxTokens = options?.maxTokens || config.maxTokens || 64000;
  const temperature = options?.temperature ?? 0.7;
  const timeout = options?.timeout || 600000; // 默认10分钟
  const maxRetries = options?.retries ?? 2;
  
  // 兼容单文件和多文件
  const fileInfos = options?.fileInfos || (options?.fileInfo ? [options.fileInfo] : []);

  // 构建用户消息内容
  let userContent: any;
  
  if (fileInfos.length > 0) {
    // 带文件的消息，使用数组格式
    const contentParts: any[] = [];
    
    // 添加所有文件
    for (const fileInfo of fileInfos) {
      if (fileInfo.type === 'image' && fileInfo.base64DataUri) {
        // 图片使用 image_url 类型（保持原有方式）
        contentParts.push({
          type: "image_url",
          image_url: {
            url: fileInfo.base64DataUri,
            detail: "high"
          }
        });
        console.log(`[文件处理] 添加图片内容 (Base64)`);
      } else if (fileInfo.type === 'document') {
        // 文档：优先使用提取的纯文本，否则使用 file_url
        if (fileInfo.extractedText) {
          // 使用提取的纯文本（不需要添加到 contentParts，文本会在 userMessage 中处理）
          console.log(`[文件处理] 文档使用提取文本 (${fileInfo.extractedText.length} 字符)`);
        } else if (fileInfo.url) {
          // 回退到 file_url 方式
          contentParts.push({
            type: "file_url",
            file_url: {
              url: fileInfo.url,
              mime_type: fileInfo.mimeType
            }
          });
          console.log(`[文件处理] 文档使用URL: ${fileInfo.url}`);
        }
      }
    }
    
    // 统计添加的文件数量
    const imageCount = contentParts.filter(p => p.type === 'image_url').length;
    const urlDocCount = contentParts.filter(p => p.type === 'file_url').length;
    const textDocCount = fileInfos.filter(f => f.type === 'document' && f.extractedText).length;
    console.log(`[文件处理] 图片: ${imageCount}, URL文档: ${urlDocCount}, 文本文档: ${textDocCount}`);
    
    // 添加文本消息
    contentParts.push({
      type: "text",
      text: userMessage
    });
    
    userContent = contentParts;
  } else {
    // 普通文本消息
    userContent = userMessage;
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userContent },
  ];

  console.log(`[AIClient] 调用模型: ${config.apiModel}`);
  console.log(`[AIClient] API地址: ${config.apiUrl}`);
  console.log(`[AIClient] System prompt长度: ${systemPrompt.length}`);
  console.log(`[AIClient] User message长度: ${userMessage.length}`);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[AIClient] 第${attempt}次重试...`);
      await delay(2000 * attempt);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${config.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.apiModel,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AIClient] API错误: ${response.status} - ${errorText}`);

        if (response.status === 403 || response.status === 401) {
          throw new Error(`AI API错误: ${response.status} - ${errorText}`);
        }

        lastError = new Error(`AI API错误: ${response.status} - ${errorText}`);
        continue;
      }

      // 读取流式响应
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("无法获取响应流");
      }

      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";
      let stopReason = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 处理 SSE 格式的数据
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || "";
              if (content) {
                fullContent += content;
                if (onProgress) {
                  onProgress(fullContent.length);
                }
              }
              // 检测停止原因（Claude格式: stop_reason, OpenAI格式: finish_reason）
              const finishReason = parsed.choices?.[0]?.finish_reason || parsed.stop_reason;
              if (finishReason) {
                stopReason = finishReason;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      // 判断是否因token上限被截断
      const isTruncated = stopReason === 'max_tokens' || stopReason === 'length';
      
      console.log(`[AIClient] 响应完成，内容长度: ${fullContent.length}字符, stop_reason: ${stopReason || '无'}`);
      if (isTruncated) {
        console.log(`[AIClient] ⚠️ 警告: 内容因token上限被截断，stop_reason: ${stopReason}`);
      }
      
      return {
        content: fullContent,
        truncated: isTruncated,
        stopReason: stopReason || undefined
      };

    } catch (error: any) {
      console.error(`[AIClient] 请求失败 (尝试 ${attempt + 1}/${maxRetries + 1}):`, error.message);

      if (error.name === "AbortError") {
        lastError = new Error(`请求超时（${timeout / 1000}秒）`);
      } else {
        lastError = error;
      }

      if (error.message?.includes("403") || error.message?.includes("401")) {
        throw error;
      }
    }
  }

  throw lastError || new Error("AI API调用失败");
}
