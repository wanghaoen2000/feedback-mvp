/**
 * 错误格式化模块测试
 */

import { describe, it, expect } from 'vitest';
import { formatErrorForAI, formatErrorSummary } from './errorFormatter';
import { ErrorDetail } from './codeSandbox';

describe('errorFormatter', () => {
  describe('formatErrorForAI', () => {
    it('should format SyntaxError with all details', () => {
      const syntaxError: ErrorDetail = {
        type: 'SyntaxError',
        message: "Unexpected token '}'",
        line: 47,
        column: 5,
        codeSnippet: `   42: const doc = new Document({
   43:   sections: [{
   44:     children: [
   45:       new Paragraph({ children: [new TextRun("test")] }
   46:     ]
 →  47:   }
   48: });`
      };

      const formatted = formatErrorForAI(syntaxError, { attempt: 1, maxAttempts: 3 });
      
      // 验证包含关键信息
      expect(formatted).toContain('第1次尝试失败');
      expect(formatted).toContain('还剩2次机会');
      expect(formatted).toContain('错误类型：SyntaxError');
      expect(formatted).toContain("错误信息：Unexpected token '}'");
      expect(formatted).toContain('第 47 行');
      expect(formatted).toContain('第 5 列');
      expect(formatted).toContain('出错代码片段');
      expect(formatted).toContain('```javascript');
      expect(formatted).toContain('修复提示');
      expect(formatted).toContain('括号');
      expect(formatted).toContain('请修正上述错误');
      
      console.log('SyntaxError 格式化输出:\n', formatted);
    });

    it('should format ReferenceError with variable name extraction', () => {
      const refError: ErrorDetail = {
        type: 'ReferenceError',
        message: 'Documnet is not defined',  // 故意拼错
        line: 10
      };

      const formatted = formatErrorForAI(refError, { attempt: 2, maxAttempts: 3 });
      
      expect(formatted).toContain('第2次尝试失败');
      expect(formatted).toContain('还剩1次机会');
      expect(formatted).toContain('错误类型：ReferenceError');
      expect(formatted).toContain('Documnet is not defined');
      expect(formatted).toContain('第 10 行');
      expect(formatted).toContain('"Documnet" 未定义');
      expect(formatted).toContain('拼写错误');
      
      console.log('ReferenceError 格式化输出:\n', formatted);
    });

    it('should format TypeError correctly', () => {
      const typeError: ErrorDetail = {
        type: 'TypeError',
        message: "Cannot read properties of null (reading 'toString')",
        line: 25,
        column: 10
      };

      const formatted = formatErrorForAI(typeError, { attempt: 1, maxAttempts: 3 });
      
      expect(formatted).toContain('错误类型：TypeError');
      expect(formatted).toContain('null 或 undefined');
      expect(formatted).toContain('检查变量是否正确初始化');
      
      console.log('TypeError 格式化输出:\n', formatted);
    });

    it('should format TimeoutError correctly', () => {
      const timeoutError: ErrorDetail = {
        type: 'TimeoutError',
        message: 'Script execution timed out after 30000ms'
      };

      const formatted = formatErrorForAI(timeoutError, { attempt: 1, maxAttempts: 3 });
      
      expect(formatted).toContain('错误类型：TimeoutError');
      expect(formatted).toContain('超时');
      expect(formatted).toContain('死循环');
      
      console.log('TimeoutError 格式化输出:\n', formatted);
    });

    it('should format SecurityError correctly', () => {
      const securityError: ErrorDetail = {
        type: 'SecurityError',
        message: '安全限制：不允许使用模块 "child_process"'
      };

      const formatted = formatErrorForAI(securityError, { attempt: 1, maxAttempts: 3 });
      
      expect(formatted).toContain('错误类型：SecurityError');
      expect(formatted).toContain('安全限制');
      expect(formatted).toContain('docx, fs, path');
      
      console.log('SecurityError 格式化输出:\n', formatted);
    });

    it('should format NoOutputError correctly', () => {
      const noOutputError: ErrorDetail = {
        type: 'NoOutputError',
        message: '代码执行完成，但没有生成.docx文件'
      };

      const formatted = formatErrorForAI(noOutputError, { attempt: 3, maxAttempts: 3 });
      
      expect(formatted).toContain('第3次尝试失败');
      expect(formatted).toContain('还剩0次机会');
      expect(formatted).toContain('错误类型：NoOutputError');
      expect(formatted).toContain('Packer.toBuffer()');
      expect(formatted).toContain('fs.writeFileSync()');
      
      console.log('NoOutputError 格式化输出:\n', formatted);
    });

    it('should handle error without line number', () => {
      const error: ErrorDetail = {
        type: 'UnknownError',
        message: '未知错误'
      };

      const formatted = formatErrorForAI(error, { attempt: 1, maxAttempts: 3 });
      
      expect(formatted).not.toContain('错误位置');
      expect(formatted).toContain('请仔细检查代码逻辑');
      
      console.log('无行号错误格式化输出:\n', formatted);
    });

    it('should format "is not a function" TypeError', () => {
      const error: ErrorDetail = {
        type: 'TypeError',
        message: 'doc.save is not a function',
        line: 50
      };

      const formatted = formatErrorForAI(error, { attempt: 1, maxAttempts: 3 });
      
      expect(formatted).toContain('不是函数');
      expect(formatted).toContain('函数名拼写');
      
      console.log('"is not a function" 格式化输出:\n', formatted);
    });
  });

  describe('formatErrorSummary', () => {
    it('should format summary with line number', () => {
      const error: ErrorDetail = {
        type: 'SyntaxError',
        message: "Unexpected token '}'",
        line: 47
      };

      const summary = formatErrorSummary(error);
      
      expect(summary).toBe("SyntaxError: Unexpected token '}' (line 47)");
    });

    it('should format summary without line number', () => {
      const error: ErrorDetail = {
        type: 'TimeoutError',
        message: 'Script execution timed out'
      };

      const summary = formatErrorSummary(error);
      
      expect(summary).toBe('TimeoutError: Script execution timed out');
    });

    it('should handle long error messages', () => {
      const error: ErrorDetail = {
        type: 'ReferenceError',
        message: 'someVeryLongVariableNameThatDoesNotExist is not defined',
        line: 100
      };

      const summary = formatErrorSummary(error);
      
      expect(summary).toContain('ReferenceError');
      expect(summary).toContain('line 100');
    });
  });
});
