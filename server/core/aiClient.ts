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
};

/**
 * AI 流式响应结果
 */
export interface AIStreamResult {
  content: string;
  truncated: boolean;
}

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
  const [apiModel, apiKey, apiUrl, roadmap, roadmapClass, driveBasePath, currentYear] = await Promise.all([
    getConfigValue("apiModel"),
    getConfigValue("apiKey"),
    getConfigValue("apiUrl"),
    getConfigValue("roadmap"),
    getConfigValue("roadmapClass"),
    getConfigValue("driveBasePath"),
    getConfigValue("currentYear"),
  ]);

  return {
    apiModel: apiModel || DEFAULT_CONFIG.apiModel,
    apiKey: apiKey || DEFAULT_CONFIG.apiKey,
    apiUrl: apiUrl || DEFAULT_CONFIG.apiUrl,
    roadmap,
    roadmapClass,
    driveBasePath: driveBasePath || DEFAULT_CONFIG.driveBasePath,
    currentYear: currentYear || DEFAULT_CONFIG.currentYear,
  };
}

/**
 * 模型Token上限映射表（硬编码默认值，作为兆底）
 * 不同模型的 max_tokens 上限不同，需要根据模型自动设置
 */
const DEFAULT_MODEL_MAX_TOKENS: Record<string, number> = {
  // Claude 系列
  "claude-sonnet-4-5-20250929": 64000,
  "claude-opus-4-5-20251101": 64000,
  "claude-3-5-sonnet": 8192,
  "claude-3-opus": 4096,
  // OpenAI 系列
  "gpt-4o": 16384,
  "gpt-4o-mini": 16384,
  "gpt-4-turbo": 4096,
  "gpt-4": 8192,
};

// 保守默认值（用于未知模型）
const DEFAULT_MAX_TOKENS = 4096;

// 缓存数据库配置（避免每次调用都查询数据库）
let cachedModelTokenLimits: Record<string, number> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 缓存 60 秒

/**
 * 从数据库获取模型Token上限配置
 */
async function getModelTokenLimitsFromDb(): Promise<Record<string, number> | null> {
  // 检查缓存是否有效
  if (cachedModelTokenLimits && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedModelTokenLimits;
  }
  
  try {
    const db = await getDb();
    if (!db) return null;
    
    const result = await db.select().from(systemConfig).where(eq(systemConfig.key, "modelTokenLimits")).limit(1);
    if (result.length > 0 && result[0].value) {
      const parsed = JSON.parse(result[0].value);
      cachedModelTokenLimits = parsed;
      cacheTimestamp = Date.now();
      return parsed;
    }
  } catch (e) {
    console.error(`[AIClient] 获取 modelTokenLimits 配置失败:`, e);
  }
  return null;
}

/**
 * 根据模型名称获取 max_tokens 上限（同步版本，使用缓存）
 * @param model 模型名称
 * @returns 该模型的 max_tokens 上限
 */
function getMaxTokensForModel(model: string): number {
  // 优先使用缓存的数据库配置
  const dbConfig = cachedModelTokenLimits || {};
  const allConfig = { ...DEFAULT_MODEL_MAX_TOKENS, ...dbConfig };
  
  // 精确匹配
  if (allConfig[model]) {
    return allConfig[model];
  }
  // 模糊匹配（处理版本号后缀）
  for (const [key, value] of Object.entries(allConfig)) {
    if (model.includes(key) || key.includes(model)) {
      return value;
    }
  }
  console.log(`[AIClient] 未知模型 ${model}，使用默认 max_tokens: ${DEFAULT_MAX_TOKENS}`);
  return DEFAULT_MAX_TOKENS;
}

/**
 * 初始化模型Token上限配置（在系统启动时调用）
 * 如果数据库中没有配置，自动插入默认值
 */
export async function initModelTokenLimits(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.log(`[AIClient] 数据库未连接，跳过 modelTokenLimits 初始化`);
      return;
    }
    
    // 检查是否已有配置
    const existing = await db.select().from(systemConfig).where(eq(systemConfig.key, "modelTokenLimits")).limit(1);
    if (existing.length > 0) {
      console.log(`[AIClient] modelTokenLimits 配置已存在，跳过初始化`);
      // 加载到缓存
      if (existing[0].value) {
        cachedModelTokenLimits = JSON.parse(existing[0].value);
        cacheTimestamp = Date.now();
      }
      return;
    }
    
    // 插入默认配置
    const defaultConfig = JSON.stringify(DEFAULT_MODEL_MAX_TOKENS);
    await db.insert(systemConfig).values({
      key: "modelTokenLimits",
      value: defaultConfig,
    });
    console.log(`[AIClient] 已初始化 modelTokenLimits 配置`);
    
    // 加载到缓存
    cachedModelTokenLimits = DEFAULT_MODEL_MAX_TOKENS;
    cacheTimestamp = Date.now();
  } catch (e) {
    console.error(`[AIClient] 初始化 modelTokenLimits 失败:`, e);
  }
}

/**
 * 刷新模型Token上限缓存（在配置更新后调用）
 */
export async function refreshModelTokenLimitsCache(): Promise<void> {
  cachedModelTokenLimits = null;
  cacheTimestamp = 0;
  await getModelTokenLimitsFromDb();
  console.log(`[AIClient] modelTokenLimits 缓存已刷新`);
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
        hasUrl: !!file.url,
        hasBase64: !!file.base64DataUri,
        // 如果是base64，打印前100个字符看看内容
        base64Preview: file.base64DataUri?.substring(0, 100),
        urlValue: file.url,
      });
    });
  }
  console.log('[DEBUG-FILE] ========================================');

  // 构建用户消息内容
  let userContent: any;
  
  if (fileInfos.length > 0) {
    // 带文件的消息，使用数组格式
    const contentParts: any[] = [];
    
    // 添加所有文件
    for (const fileInfo of fileInfos) {
      if (fileInfo.type === 'image' && fileInfo.base64DataUri) {
        // 图片使用 image_url 类型
        contentParts.push({
          type: "image_url",
          image_url: {
            url: fileInfo.base64DataUri,
            detail: "high"
          }
        });
        console.log(`[AIClient] 添加图片内容 (Base64)`);
      } else if (fileInfo.type === 'document' && fileInfo.url) {
        // 文档使用 file_url 类型
        contentParts.push({
          type: "file_url",
          file_url: {
            url: fileInfo.url,
            mime_type: fileInfo.mimeType
          }
        });
        console.log(`[AIClient] 添加文档内容: ${fileInfo.url}`);
      }
    }
    
    console.log(`[AIClient] 共添加 ${contentParts.length} 个文件`);
    
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
  console.log(`[AIClient] max_tokens: ${maxTokens} (模型上限: ${modelMaxTokens})`);
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
      let truncated = false;

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
              // 检测是否被截断
              if (parsed.choices?.[0]?.finish_reason === 'length') {
                truncated = true;
                console.log('[AIClient] 检测到输出被截断 (finish_reason=length)');
              }
            } catch (e) {
              // 忽u7565解析错误
            }
          }
        }
      }

      console.log(`[AIClient] 响应完成，内容长度: ${fullContent.length}字符，被截断: ${truncated}`);
      return { content: fullContent, truncated };

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
