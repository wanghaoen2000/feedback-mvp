/**
 * 代码沙箱执行模块
 * 用于安全执行AI生成的docx-js代码
 * 
 * 安全限制：
 * - 只允许 docx, fs, path 模块
 * - fs 只能写入指定的 outputDir 目录
 * - 30秒超时保护
 */

import { VM } from 'vm2';
import * as fs from 'fs';
import * as path from 'path';

// 执行结果类型
export interface ExecutionResult {
  success: boolean;
  outputPath?: string;    // 生成的文件路径
  error?: {
    type: string;         // 错误类型：SyntaxError, TypeError, etc.
    message: string;      // 错误信息
    stack?: string;       // 错误堆栈
  };
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
 * 创建受限的 require 函数
 * 只允许白名单内的模块
 */
function createRestrictedRequire(allowedDir: string) {
  const restrictedFs = createRestrictedFs(allowedDir);
  
  return (moduleName: string) => {
    if (!ALLOWED_MODULES.includes(moduleName)) {
      throw new Error(`安全限制：不允许使用模块 "${moduleName}"，只允许: ${ALLOWED_MODULES.join(', ')}`);
    }
    
    switch (moduleName) {
      case 'docx':
        return require('docx');
      case 'fs':
        return restrictedFs;  // 返回受限版本
      case 'path':
        return path;
      default:
        throw new Error(`模块 "${moduleName}" 未配置`);
    }
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
    // 创建受限的 require
    const restrictedRequire = createRestrictedRequire(outputDir);
    
    // 创建沙箱环境
    const vm = new VM({
      timeout: timeout,
      sandbox: {
        require: restrictedRequire,  // 使用受限的 require
        console: {
          log: console.log,
          error: console.error,
          warn: console.warn,
        },
        Buffer: Buffer,
        __dirname: outputDir,
        __outputDir: outputDir,
        // 注入 Promise 以支持异步操作
        Promise: Promise,
      }
    });

    // 执行代码
    await vm.run(code);

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
    return {
      success: false,
      error: {
        type: err.name || 'UnknownError',
        message: err.message || '未知错误',
        stack: err.stack
      },
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
