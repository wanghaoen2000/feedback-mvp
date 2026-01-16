/**
 * AI 调用模块
 * 封装 AI API 调用，提供统一的接口
 */
import { getDb } from "../db";
import { systemConfig } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import * as fs from 'fs';
import * as path from 'path';
import { extractTextFromDocument, isImageType, isDocumentType } from '../documentParser';

// 默认配置值
const DEFAULT_CONFIG = {
  apiModel: "claude-sonnet-4-5-20250929",
  apiKey: process.env.WHATAI_API_KEY || "sk-WyfaRl3qxKk8gpaptVWUfe1ZiJYQg0Vqjd7nscsZMT4l0c9U",
  apiUrl: "https://www.DMXapi.com/v1",
  currentYear: "2026",
  roadmap: "",
  roadmapClass: "",
  firstLessonTemplate: "",
  classFirstLessonTemplate: "",
  apiFormat: "openai"
};

export interface APIConfig {
  apiModel: string;
  apiKey: string;
  apiUrl: string;
  currentYear: string;
  roadmap: string;
  roadmapClass: string;
  firstLessonTemplate: string;
  classFirstLessonTemplate: string;
  apiFormat: string;
}

export interface FileInfo {
  type: 'image' | 'document';
  mimeType: string;
  base64DataUri?: string;  // data:image/png;base64,xxxxx 格式
  url?: string;
  fileName?: string;  // 文件名，用于标记
  source?: 'shared' | 'independent';  // 文件来源
}

export interface AIStreamResult {
  content: string;
  tokensUsed: number;
}

// ========== 获取系统配置 ==========
async function getSystemConfig(key: string): Promise<string | null> {
  try {
    const db = getDb();
    const result = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, key))
      .limit(1);
    
    return result.length > 0 ? result[0].value : null;
  } catch (error) {
    console.error(`获取配置失败 [${key}]:`, error);
    return null;
  }
}

// ========== 获取 API 配置 ==========
async function getAPIConfig(): Promise<APIConfig> {
  try {
    const db = getDb();
    const configs = await db.select().from(systemConfig);
    
    const config: APIConfig = { ...DEFAULT_CONFIG };
    
    for (const item of configs) {
      if (item.key === 'apiModel') config.apiModel = item.value;
      else if (item.key === 'apiKey') config.apiKey = item.value;
      else if (item.key === 'apiUrl') config.apiUrl = item.value;
      else if (item.key === 'currentYear') config.currentYear = item.value;
      else if (item.key === 'roadmap') config.roadmap = item.value;
      else if (item.key === 'roadmapClass') config.roadmapClass = item.value;
      else if (item.key === 'firstLessonTemplate') config.firstLessonTemplate = item.value;
      else if (item.key === 'classFirstLessonTemplate') config.classFirstLessonTemplate = item.value;
      else if (item.key === 'apiFormat') config.apiFormat = item.value;
    }
    
    writeDebugLog(`[CONFIG] apiFormat: ${config.apiFormat}`);
    return config;
  } catch (error) {
    console.error('获取API配置失败:', error);
    return DEFAULT_CONFIG;
  }
}

// ========== 获取模型 token 上限 ==========
let modelTokenLimits: Record<string, number> = {
  "claude-opus-4-5-20251101": 200000,
  "claude-sonnet-4-5-20250929": 200000,
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-opus-20240229": 200000,
  "gpt-4o": 128000,
  "gpt-4-turbo": 128000,
};

function getMaxTokensForModel(model: string): number {
  return modelTokenLimits[model] || 100000;
}

/**
 * 初始化模型 Token 上限配置
 * 从数据库加载用户自定义的配置
 */
export async function initModelTokenLimits(): Promise<void> {
  try {
    const savedLimits = await getSystemConfig('modelTokenLimits');
    if (savedLimits) {
      const parsed = JSON.parse(savedLimits);
      modelTokenLimits = { ...modelTokenLimits, ...parsed };
      console.log('[AIClient] 模型Token上限配置已加载');
    }
  } catch (error) {
    console.error('[AIClient] 加载模型Token上限配置失败:', error);
  }
}

/**
 * 刷新模型 Token 上限缓存
 */
export async function refreshModelTokenLimitsCache(): Promise<void> {
  await initModelTokenLimits();
}

/**
 * 流式调用 AI API
 * @param systemPrompt 系统提示词
 * @param userMessage 用户消息
 * @param onProgress 进度回调，参数为当前累计字符数
 * @param options 可选参数
 * @returns 完整的 AI 响应内容
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
  // 根据模型动态获取 max_tokens 上限
  const modelMaxTokens = getMaxTokensForModel(config.apiModel);
  const maxTokens = options?.maxTokens ? Math.min(options.maxTokens, modelMaxTokens) : modelMaxTokens;
  const temperature = options?.temperature ?? 0.7;
  const timeout = options?.timeout || 600000; // 默认10分钟
  const maxRetries = options?.retries ?? 2;
  
  // 兼容单文件和多文件
  const fileInfos = options?.fileInfos || (options?.fileInfo ? [options.fileInfo] : []);

  // ========== 调试日志：传给AI的文件 ==========
  console.log('[DEBUG-FILE] ========== 传给AI的文件 ==========');
  console.log('[DEBUG-FILE] fileInfos数量:', fileInfos?.length || 0);
  if (fileInfos && fileInfos.length > 0) {
    fileInfos.forEach((file, index) => {
      console.log(`[DEBUG-FILE] 文件${index}:`, {
        type: file.type,
        mimeType: file.mimeType,
        fileName: file.fileName,
        source: file.source,
        hasUrl: !!file.url,
        hasBase64: !!file.base64DataUri,
        base64Preview: file.base64DataUri?.substring(0, 100),
      });
    });
  }
  console.log('[DEBUG-FILE] ========================================');

  // 获取 apiFormat 配置
  const apiFormat = config.apiFormat || 'openai';
  writeDebugLog(`[AIClient] 使用API格式: ${apiFormat}`);

  // 构建用户消息内容
  let userContent: any;
  
  if (fileInfos.length > 0) {
    // 带文件的消息，使用数组格式
    const contentParts: any[] = [];
    
    // 添加所有文件
    for (const fileInfo of fileInfos) {
      const mimeType = fileInfo.mimeType || '';
      const fileName = fileInfo.fileName || '文件';
      const sourceLabel = fileInfo.source === 'shared' ? '共享文件' : '任务专属文件';
      
      writeDebugLog(`[文件处理] 类型: ${mimeType}, 文件名: ${fileName}, 来源: ${sourceLabel}, 处理方式: ${isImageType(mimeType) ? '图片' : isDocumentType(mimeType) ? '文档提取文字' : '未知'}`);
      
      // 图片处理
      if (isImageType(mimeType) && fileInfo.base64DataUri) {
        // 添加图片标记
        contentParts.push({
          type: "text",
          text: `【${sourceLabel}】${fileName}`
        });
        
        // 图片消息格式根据 apiFormat 切换
        if (apiFormat === 'openai') {
          // OpenAI 格式
          contentParts.push({
            type: "image_url",
            image_url: {
              url: fileInfo.base64DataUri  // 完整的 data:image/png;base64,...
            }
          });
          writeDebugLog(`[AIClient] 添加图片内容 (OpenAI格式) - 【${sourceLabel}】${fileName}`);
        } else {
          // Claude 原生格式
          const base64Parts = fileInfo.base64DataUri.split(',');
          const base64Data = base64Parts.length > 1 ? base64Parts[1] : fileInfo.base64DataUri;
          
          contentParts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: base64Data
            }
          });

        }
      } 
      // 文档处理：提取文字
      else if (isDocumentType(mimeType) && fileInfo.base64DataUri) {
        const base64Parts = fileInfo.base64DataUri.split(',');
        const base64Data = base64Parts.length > 1 ? base64Parts[1] : fileInfo.base64DataUri;
        
        // 同步提取文档文字
        try {
          const extractedText = await extractTextFromDocument(base64Data, mimeType);
          if (extractedText) {
            // 添加来源标记
            const markedText = `【${sourceLabel}】${fileName}\n${extractedText}\n【/${sourceLabel}】`;
            
            contentParts.push({
              type: "text",
              text: markedText
            });
          }
        } catch (error) {
          // 文档提取失败，继续处理其他文件
        }
      }
    }
    

    
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

  // ========== 构建 API 请求 ==========
  const messages = [
    {
      role: "user",
      content: userContent
    }
  ];



  // ========== 调用 API ==========
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${config.apiUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: config.apiModel,
          max_tokens: maxTokens,
          temperature: temperature,
          system: systemPrompt,
          messages: messages
        }),
        signal: AbortSignal.timeout(timeout)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 返回错误: ${response.status} ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      let fullContent = '';
      let totalChars = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
                fullContent += data.delta.text;
                totalChars += data.delta.text.length;
                onProgress?.(totalChars);
              }
            } catch (e) {
              // 忽略 JSON 解析错误
            }
          }
        }
      }

      return {
        content: fullContent,
        tokensUsed: totalChars
      };
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        console.warn(`API 调用失败 (尝试 ${attempt + 1}/${maxRetries + 1}):`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error('API 调用失败');
}
