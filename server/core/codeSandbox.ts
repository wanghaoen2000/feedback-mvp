/**
 * 代码沙箱执行模块
 * 用于安全执行AI生成的docx-js代码
 * 
 * 安全限制：
 * - 只允许 docx, fs, path 模块
 * - fs 只能写入指定的 outputDir 目录
 * - 30秒超时保护
 */

import { NodeVM, VMScript } from 'vm2';
import * as fs from 'fs';
import * as path from 'path';
import * as docx from 'docx';

// 错误详情类型（扩展版）
export interface ErrorDetail {
  type: string;           // 错误类型：SyntaxError, TypeError, ReferenceError, TimeoutError, SecurityError, NoOutputError
  message: string;        // 错误信息
  line?: number;          // 行号（如果能解析出来）
  column?: number;        // 列号（如果能解析出来）
  codeSnippet?: string;   // 出错位置前后5行代码
  stack?: string;         // 原始错误堆栈（用于调试）
}

// 执行结果类型
export interface ExecutionResult {
  success: boolean;
  outputPath?: string;    // 生成的文件路径
  error?: ErrorDetail;    // 错误详情
  executionTime?: number; // 执行耗时(ms)
}

// 沙箱配置
export interface SandboxConfig {
  timeout?: number;       // 超时时间，默认30秒
  outputDir?: string;     // 输出目录，默认 /tmp/docx-output
}

// 模块白名单
const ALLOWED_MODULES = ['docx', 'fs', 'path'];

/**
 * 从错误堆栈中解析行号和列号
 * 错误堆栈示例：
 * ReferenceError: undefinedFunction is not defined
 *     at vm.js:5:1
 *     at Script.runInContext (node:vm:149:12)
 */
function parseErrorLocation(error: Error, code: string): { line?: number; column?: number } {
  const stack = error.stack || '';
  
  // vm2 的错误格式：at vm.js:行号:列号
  const vmJsMatch = stack.match(/at vm\.js:(\d+):(\d+)/);
  if (vmJsMatch) {
    return {
      line: parseInt(vmJsMatch[1], 10),
      column: parseInt(vmJsMatch[2], 10)
    };
  }
  
  // 备用：尝试匹配 evalmachine.<anonymous>:行号:列号
  const evalMatch = stack.match(/evalmachine\.<anonymous>:(\d+):(\d+)/);
  if (evalMatch) {
    return {
      line: parseInt(evalMatch[1], 10),
      column: parseInt(evalMatch[2], 10)
    };
  }
  
  // 备用：尝试匹配 <anonymous>:行号:列号
  const anonMatch = stack.match(/at\s+(?:Object\.)?<anonymous>:(\d+):(\d+)/);
  if (anonMatch) {
    return {
      line: parseInt(anonMatch[1], 10),
      column: parseInt(anonMatch[2], 10)
    };
  }
  
  // 备用：尝试匹配 SyntaxError 中的位置信息
  const syntaxMatch = error.message.match(/at position (\d+)/);
  if (syntaxMatch) {
    const position = parseInt(syntaxMatch[1], 10);
    const lines = code.substring(0, position).split('\n');
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1
    };
  }
  
  return {};
}

/**
 * 提取出错位置前后的代码片段
 * @param code - 完整代码
 * @param line - 出错行号
 * @param contextLines - 上下文行数，默认5行
 */
function extractCodeSnippet(code: string, line: number, contextLines: number = 5): string {
  const lines = code.split('\n');
  const startLine = Math.max(0, line - contextLines - 1);
  const endLine = Math.min(lines.length, line + contextLines);
  
  const snippet = lines.slice(startLine, endLine).map((content, index) => {
    const lineNum = startLine + index + 1;
    const marker = lineNum === line ? ' → ' : '   ';
    return `${marker}${lineNum.toString().padStart(4)}: ${content}`;
  }).join('\n');
  
  return snippet;
}

/**
 * 构建详细的错误信息
 */
function buildErrorDetail(error: Error, code: string): ErrorDetail {
  let errorType = error.name || 'UnknownError';
  
  // 超时错误特殊处理
  if (error.message?.includes('Script execution timed out')) {
    errorType = 'TimeoutError';
  }
  
  // 安全限制错误特殊处理
  if (error.message?.includes('安全限制')) {
    errorType = 'SecurityError';
  }
  
  const location = parseErrorLocation(error, code);
  
  const detail: ErrorDetail = {
    type: errorType,
    message: error.message || '未知错误',
    stack: error.stack
  };
  
  if (location.line) {
    detail.line = location.line;
    detail.column = location.column;
    detail.codeSnippet = extractCodeSnippet(code, location.line);
  }
  
  return detail;
}

/**
 * 创建受限的 fs 模块
 * 只允许写入指定目录
 */
function createRestrictedFs(allowedDir: string) {
  const resolvedAllowedDir = path.resolve(allowedDir);
  
  // 检查路径是否在允许的目录内
  const isPathAllowed = (targetPath: string): boolean => {
    const resolvedPath = path.resolve(targetPath);
    return resolvedPath.startsWith(resolvedAllowedDir);
  };

  return {
    // 只暴露必要的方法，且都有路径检查
    writeFileSync: (filePath: string, data: any) => {
      if (!isPathAllowed(filePath)) {
        throw new Error(`安全限制：不允许写入目录 ${path.dirname(filePath)}，只能写入 ${allowedDir}`);
      }
      return fs.writeFileSync(filePath, data);
    },
    
    existsSync: (filePath: string) => {
      return fs.existsSync(filePath);
    },
    
    mkdirSync: (dirPath: string, options?: any) => {
      if (!isPathAllowed(dirPath)) {
        throw new Error(`安全限制：不允许创建目录 ${dirPath}，只能在 ${allowedDir} 内操作`);
      }
      return fs.mkdirSync(dirPath, options);
    },
    
    readFileSync: (filePath: string, options?: any) => {
      // 读取文件相对安全，但也限制一下范围
      if (!isPathAllowed(filePath)) {
        throw new Error(`安全限制：不允许读取 ${filePath}`);
      }
      return fs.readFileSync(filePath, options);
    },
  };
}

/**
 * 在沙箱中执行代码
 * @param code - 要执行的JavaScript代码
 * @param config - 沙箱配置
 * @returns 执行结果
 */
export async function executeInSandbox(
  code: string,
  config: SandboxConfig = {}
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const timeout = config.timeout || 30000;
  const outputDir = config.outputDir || '/tmp/docx-output';

  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // 创建受限的 fs 模块
    const restrictedFs = createRestrictedFs(outputDir);
    
    // 创建 NodeVM 沙箱环境
    // 将 docx、fs、path 作为全局变量注入，而不是通过 require
    const vm = new NodeVM({
      timeout: timeout,
      console: 'inherit',
      sandbox: {
        __outputDir: outputDir,
        docx: docx,                  // docx 库作为全局变量（通过 import 导入）
        fs: restrictedFs,           // 受限的 fs 模块作为全局变量
        path: path,                 // path 模块作为全局变量
      },
      require: {
        external: false,  // 禁止加载外部模块
        builtin: [],      // 不允许内置模块
        root: './',
      }
    });

    // 执行代码
    console.log('[沙箱] 准备执行代码，代码长度:', code.length);
    console.log('[沙箱] 代码前200字符:', code.substring(0, 200));
    console.log('[沙箱] NodeVM 配置:', JSON.stringify({ timeout, outputDir }));
    const result = vm.run(code, 'vm.js');
    console.log('[沙箱] vm.run 返回:', typeof result);
    
    // 如果返回的是 Promise，等待它完成
    if (result && typeof result.then === 'function') {
      await result;
    }

    // 等待一小段时间让异步操作完成（如 Packer.toBuffer）
    await new Promise(resolve => setTimeout(resolve, 500));

    // 查找生成的docx文件
    const files = fs.readdirSync(outputDir);
    const docxFile = files.find(f => f.endsWith('.docx'));

    if (docxFile) {
      return {
        success: true,
        outputPath: path.join(outputDir, docxFile),
        executionTime: Date.now() - startTime
      };
    } else {
      return {
        success: false,
        error: {
          type: 'NoOutputError',
          message: '代码执行完成，但没有生成.docx文件'
        },
        executionTime: Date.now() - startTime
      };
    }

  } catch (err: any) {
    // 构建详细错误信息
    const errorDetail = buildErrorDetail(err, code);
    
    return {
      success: false,
      error: errorDetail,
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * 清理输出目录
 */
export function cleanOutputDir(outputDir: string = '/tmp/docx-output'): void {
  if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir);
    for (const file of files) {
      fs.unlinkSync(path.join(outputDir, file));
    }
  }
}
