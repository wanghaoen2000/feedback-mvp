/**
 * 错误处理模块
 * 将API错误转换为用户友好的中文提示
 */

// 结构化错误类型
export interface StructuredError {
  code: string;           // 错误码
  step: string;           // 出错的步骤
  message: string;        // 中文错误信息
  suggestion: string;     // 建议操作
  originalError?: string; // 原始错误信息（用于调试）
}

// 错误码映射表
const ERROR_MESSAGES: Record<string, { message: string; suggestion: string }> = {
  // API余额相关
  'insufficient_user_quota': {
    message: 'API余额不足',
    suggestion: '请登录DMXapi官网充值后重试'
  },
  'insufficient_quota': {
    message: 'API配额不足',
    suggestion: '请登录DMXapi官网充值后重试'
  },
  
  // 认证相关
  '401': {
    message: 'API密钥无效',
    suggestion: '请在高级设置中检查并更新API密钥'
  },
  'unauthorized': {
    message: 'API认证失败',
    suggestion: '请在高级设置中检查API密钥是否正确'
  },
  
  // 权限相关
  '403': {
    message: 'API访问被拒绝',
    suggestion: '可能是余额不足或密钥权限问题，请检查DMXapi账户'
  },
  'forbidden': {
    message: 'API访问被禁止',
    suggestion: '请检查DMXapi账户状态和余额'
  },
  
  // 频率限制
  '429': {
    message: '请求太频繁',
    suggestion: '请稍等1分钟后重试'
  },
  'rate_limit': {
    message: 'API请求频率超限',
    suggestion: '请稍等1-2分钟后重试'
  },
  'rate_limit_exceeded': {
    message: 'API请求频率超限',
    suggestion: '请稍等1-2分钟后重试'
  },
  
  // 超时相关
  'timeout': {
    message: '请求超时',
    suggestion: '可能是网络问题或AI响应太慢，请稍后重试'
  },
  'aborterror': {
    message: '请求被中止或超时',
    suggestion: '可能是网络不稳定，请检查网络后重试'
  },
  
  // 网络相关
  'failed to fetch': {
    message: '网络连接失败',
    suggestion: '请检查网络连接后重试'
  },
  'fetch failed': {
    message: '网络请求失败',
    suggestion: '请检查网络连接后重试'
  },
  'econnrefused': {
    message: '无法连接到API服务器',
    suggestion: 'DMXapi服务器可能暂时不可用，请稍后重试'
  },
  'econnreset': {
    message: '连接被重置',
    suggestion: '网络连接不稳定，请稍后重试'
  },
  'etimedout': {
    message: '连接超时',
    suggestion: '网络连接超时，请检查网络后重试'
  },
  
  // 服务器错误
  '500': {
    message: 'API服务器内部错误',
    suggestion: '请稍后重试，如持续出现请联系DMXapi客服'
  },
  '502': {
    message: 'API网关错误',
    suggestion: '请稍后重试'
  },
  '503': {
    message: 'API服务暂时不可用',
    suggestion: '服务器繁忙，请稍后重试'
  },
  '504': {
    message: 'API网关超时',
    suggestion: '请稍后重试'
  },
  
  // 模型相关
  'model_not_found': {
    message: '模型不存在',
    suggestion: '请在高级设置中检查模型名称是否正确'
  },
  'invalid_model': {
    message: '模型名称无效',
    suggestion: '请在高级设置中检查模型名称是否正确'
  },
  
  // 默认错误
  'unknown': {
    message: '未知错误',
    suggestion: '请查看日志获取详细信息，或联系技术支持'
  }
};

// 步骤名称映射
const STEP_NAMES: Record<string, string> = {
  'feedback': '学情反馈',
  'review': '复习文档',
  'test': '测试本',
  'extraction': '课后信息提取',
  'bubbleChart': '气泡图',
  'upload': '上传到Google Drive',
  'compress': '录音压缩'
};

/**
 * 从原始错误信息中提取错误码
 */
function extractErrorCode(errorMessage: string): string {
  const lowerMessage = errorMessage.toLowerCase();
  
  // 检查是否包含JSON格式的错误
  try {
    const jsonMatch = errorMessage.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error?.code) {
        return parsed.error.code.toLowerCase();
      }
      if (parsed.code) {
        return parsed.code.toLowerCase();
      }
    }
  } catch (e) {
    // 忽略JSON解析错误
  }
  
  // 检查HTTP状态码
  const statusMatch = errorMessage.match(/\b(401|403|429|500|502|503|504)\b/);
  if (statusMatch) {
    return statusMatch[1];
  }
  
  // 检查常见错误关键词
  const keywords = [
    'insufficient_user_quota',
    'insufficient_quota',
    'rate_limit',
    'rate_limit_exceeded',
    'unauthorized',
    'forbidden',
    'timeout',
    'aborterror',
    'failed to fetch',
    'fetch failed',
    'econnrefused',
    'econnreset',
    'etimedout',
    'model_not_found',
    'invalid_model'
  ];
  
  for (const keyword of keywords) {
    if (lowerMessage.includes(keyword.replace(/_/g, ' ')) || lowerMessage.includes(keyword)) {
      return keyword;
    }
  }
  
  return 'unknown';
}

/**
 * 将原始错误转换为结构化的中文错误
 */
export function parseError(error: Error | string, step: string = 'unknown'): StructuredError {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const errorCode = extractErrorCode(errorMessage);
  
  const errorInfo = ERROR_MESSAGES[errorCode] || ERROR_MESSAGES['unknown'];
  const stepName = STEP_NAMES[step] || step;
  
  return {
    code: errorCode,
    step: stepName,
    message: errorInfo.message,
    suggestion: errorInfo.suggestion,
    originalError: errorMessage
  };
}

/**
 * 格式化错误为用户友好的字符串
 */
export function formatErrorMessage(error: StructuredError): string {
  return `生成${error.step}时出错：${error.message}。${error.suggestion}`;
}

/**
 * 创建结构化错误
 */
export function createStructuredError(
  code: string,
  step: string,
  originalError?: string
): StructuredError {
  const errorInfo = ERROR_MESSAGES[code.toLowerCase()] || ERROR_MESSAGES['unknown'];
  const stepName = STEP_NAMES[step] || step;
  
  return {
    code,
    step: stepName,
    message: errorInfo.message,
    suggestion: errorInfo.suggestion,
    originalError
  };
}

/**
 * 检查是否是可重试的错误
 */
export function isRetryableError(error: StructuredError): boolean {
  const nonRetryableCodes = [
    'insufficient_user_quota',
    'insufficient_quota',
    '401',
    'unauthorized',
    '403',
    'forbidden',
    'model_not_found',
    'invalid_model'
  ];
  
  return !nonRetryableCodes.includes(error.code.toLowerCase());
}
