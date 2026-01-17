/**
 * 错误格式化模块
 * 将错误信息格式化为AI可理解的文本
 */

import { ErrorDetail } from './codeSandbox';

export interface FormatOptions {
  attempt: number;        // 第几次尝试
  maxAttempts: number;    // 最大尝试次数
  includeStack?: boolean; // 是否包含原始堆栈（默认false，太长了AI不需要）
}

/**
 * 将错误详情格式化为AI可读的文本
 */
export function formatErrorForAI(error: ErrorDetail, options: FormatOptions): string {
  const { attempt, maxAttempts } = options;
  
  let output = '';
  
  // 标题
  output += `【第${attempt}次尝试失败，还剩${maxAttempts - attempt}次机会】\n\n`;
  
  // 错误类型和信息
  output += `错误类型：${error.type}\n`;
  output += `错误信息：${error.message}\n`;
  
  // 位置信息（如果有）
  if (error.line) {
    output += `错误位置：第 ${error.line} 行`;
    if (error.column) {
      output += `，第 ${error.column} 列`;
    }
    output += '\n';
  }
  
  // 代码片段（如果有）
  if (error.codeSnippet) {
    output += `\n出错代码片段：\n`;
    output += '```javascript\n';
    output += error.codeSnippet;
    output += '\n```\n';
  }
  
  // 修复指引（根据错误类型给出提示）
  output += '\n';
  output += getFixGuidance(error.type, error.message);
  
  // 要求
  output += '\n---\n';
  output += '请修正上述错误，重新输出完整的代码。\n';
  output += '注意：只输出代码，不要输出任何解释或说明。\n';
  
  return output;
}

/**
 * 根据错误类型给出修复指引
 */
function getFixGuidance(errorType: string, errorMessage: string): string {
  switch (errorType) {
    case 'SyntaxError':
      if (errorMessage.includes('Unexpected token')) {
        return '【修复提示】检查是否有括号、花括号、方括号不匹配，或者缺少逗号、分号。';
      }
      if (errorMessage.includes('Unexpected end of input')) {
        return '【修复提示】代码可能不完整，检查是否有未闭合的括号或花括号。';
      }
      return '【修复提示】检查代码语法，确保所有括号匹配、语句完整。';
      
    case 'ReferenceError':
      if (errorMessage.includes('is not defined')) {
        const match = errorMessage.match(/(\w+) is not defined/);
        const varName = match ? match[1] : '某个变量';
        return `【修复提示】变量 "${varName}" 未定义。检查是否拼写错误，或者忘记声明/导入。`;
      }
      return '【修复提示】引用了未定义的变量或函数，检查拼写和导入语句。';
      
    case 'TypeError':
      if (errorMessage.includes('Cannot read property') || errorMessage.includes('Cannot read properties')) {
        return '【修复提示】尝试访问 null 或 undefined 的属性。检查变量是否正确初始化。';
      }
      if (errorMessage.includes('is not a function')) {
        return '【修复提示】尝试调用一个不是函数的值。检查函数名拼写和导入。';
      }
      return '【修复提示】类型错误，检查变量类型是否符合预期。';
      
    case 'TimeoutError':
      return '【修复提示】代码执行超时（超过30秒）。检查是否有死循环或过于耗时的操作。';
      
    case 'SecurityError':
      return '【修复提示】代码触发了安全限制。只能使用 docx, fs, path 模块，且 fs 只能写入指定目录。';
      
    case 'NoOutputError':
      return '【修复提示】代码执行完成但没有生成 .docx 文件。确保调用了 Packer.toBuffer() 并用 fs.writeFileSync() 写入文件。';
      
    default:
      return '【修复提示】请仔细检查代码逻辑。';
  }
}

/**
 * 生成简短的错误摘要（用于日志等场景）
 */
export function formatErrorSummary(error: ErrorDetail): string {
  let summary = `${error.type}: ${error.message}`;
  if (error.line) {
    summary += ` (line ${error.line})`;
  }
  return summary;
}
