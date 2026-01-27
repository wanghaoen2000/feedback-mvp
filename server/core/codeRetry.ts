/**
 * 代码重试控制器
 * 执行代码，失败后自动重试，最多N次
 */

import { executeInSandbox, ExecutionResult, SandboxConfig, cleanOutputDir } from './codeSandbox';
import { formatErrorForAI, formatErrorSummary } from './errorFormatter';

// 重试配置
export interface RetryConfig {
  maxAttempts?: number;      // 最大尝试次数，默认3
  sandboxConfig?: SandboxConfig;  // 沙箱配置
  onAttempt?: (attempt: number, code: string) => void;  // 每次尝试前的回调（用于日志）
  onError?: (attempt: number, error: string) => void;   // 每次失败后的回调（用于日志）
}

// 重试结果
export interface RetryResult {
  success: boolean;
  outputPath?: string;       // 成功时的文件路径
  totalAttempts: number;     // 总共尝试了几次
  errors: string[];          // 每次失败的错误摘要
  finalError?: string;       // 最终失败时的详细错误（格式化后的）
  executionTime: number;     // 总执行时间
}

// 代码修正函数类型（由调用方提供，Step 3.2 会实现真正的AI调用）
export type CodeFixerFn = (
  originalCode: string,
  errorFeedback: string,
  attempt: number
) => Promise<string>;

/**
 * 带重试的代码执行
 * @param initialCode - 初始代码
 * @param codeFixer - 代码修正函数（失败时调用，返回修正后的代码）
 * @param config - 重试配置
 */
export async function executeWithRetry(
  initialCode: string,
  codeFixer: CodeFixerFn,
  config: RetryConfig = {}
): Promise<RetryResult> {
  const startTime = Date.now();
  const maxAttempts = config.maxAttempts || 1;  // V67: 禁用重试，默认只尝试1次
  const errors: string[] = [];
  
  let currentCode = initialCode;
  let attempt = 0;
  
  while (attempt < maxAttempts) {
    attempt++;
    
    // 回调：开始尝试
    if (config.onAttempt) {
      config.onAttempt(attempt, currentCode);
    }
    
    // 清理输出目录（确保每次执行环境干净）
    cleanOutputDir(config.sandboxConfig?.outputDir);
    
    // 执行代码
    const result = await executeInSandbox(currentCode, config.sandboxConfig);
    
    // 成功
    if (result.success && result.outputPath) {
      return {
        success: true,
        outputPath: result.outputPath,
        totalAttempts: attempt,
        errors,
        executionTime: Date.now() - startTime
      };
    }
    
    // 失败：记录错误
    const errorSummary = result.error 
      ? formatErrorSummary(result.error)
      : '未知错误';
    errors.push(`Attempt ${attempt}: ${errorSummary}`);
    
    // 回调：发生错误
    if (config.onError) {
      config.onError(attempt, errorSummary);
    }
    
    // 如果还有重试机会，请求修正代码
    if (attempt < maxAttempts && result.error) {
      const errorFeedback = formatErrorForAI(result.error, {
        attempt,
        maxAttempts
      });
      
      try {
        // 调用代码修正函数获取新代码
        currentCode = await codeFixer(currentCode, errorFeedback, attempt);
      } catch (fixError: any) {
        // 修正函数本身出错，记录并继续（用原代码重试一次）
        errors.push(`Attempt ${attempt} fix failed: ${fixError.message}`);
      }
    }
  }
  
  // 全部失败
  return {
    success: false,
    totalAttempts: attempt,
    errors,
    finalError: errors.join('\n'),
    executionTime: Date.now() - startTime
  };
}

/**
 * 简单的模拟修正函数（用于测试）
 * 实际使用时会替换为真正的AI调用
 */
export function createMockFixer(fixedCode: string): CodeFixerFn {
  return async (originalCode, errorFeedback, attempt) => {
    console.log(`[MockFixer] Attempt ${attempt} failed, returning fixed code`);
    return fixedCode;
  };
}
