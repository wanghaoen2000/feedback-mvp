/**
 * 代码沙箱执行模块
 * 用于安全执行AI生成的docx-js代码
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
    // 创建沙箱环境
    const vm = new VM({
      timeout: timeout,
      sandbox: {
        // 注入必要的模块和工具
        require: require,  // Step 1.2会限制这个
        console: console,
        Buffer: Buffer,
        __dirname: outputDir,
        __outputDir: outputDir,
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
