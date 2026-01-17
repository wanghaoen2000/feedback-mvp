/**
 * 重试控制器测试
 */

import { describe, it, expect, vi } from 'vitest';
import { executeWithRetry, createMockFixer, RetryResult } from './codeRetry';

// 正确的代码（用于测试成功场景）
const correctCode = `
const { Document, Paragraph, TextRun, Packer } = require('docx');
const fs = require('fs');
const path = require('path');

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({
        children: [new TextRun({ text: '重试测试', bold: true })],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(path.join(__outputDir, 'retry_test.docx'), buffer);
});
`;

// 错误的代码（语法错误）
const wrongCode = `
const { Document, Paragraph, TextRun, Packer } = require('docx');
const fs = require('fs');

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({
        children: [new TextRun({ text: '测试' }]  // 缺少闭合括号
      }),
    ],
  }],
});
`;

// 运行时错误的代码
const runtimeErrorCode = `
const { Document, Paragraph, TextRun, Packer } = require('docx');
const fs = require('fs');
const path = require('path');

// 调用未定义的函数
undefinedFunction();

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({
        children: [new TextRun({ text: '测试' })],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(path.join(__outputDir, 'test.docx'), buffer);
});
`;

describe('codeRetry', () => {
  describe('executeWithRetry', () => {
    it('should succeed on first attempt with correct code', async () => {
      const result = await executeWithRetry(
        correctCode,
        createMockFixer(correctCode),  // 不会被调用
        { maxAttempts: 3 }
      );
      
      expect(result.success).toBe(true);
      expect(result.totalAttempts).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.outputPath).toBeDefined();
      expect(result.outputPath).toContain('.docx');
      expect(result.executionTime).toBeGreaterThan(0);
      
      console.log('Test 1 - First success:', {
        success: result.success,
        totalAttempts: result.totalAttempts,
        outputPath: result.outputPath,
        executionTime: `${result.executionTime}ms`
      });
    }, 15000);

    it('should retry and succeed on second attempt', async () => {
      const result = await executeWithRetry(
        wrongCode,
        createMockFixer(correctCode),  // 模拟AI返回正确代码
        { maxAttempts: 3 }
      );
      
      expect(result.success).toBe(true);
      expect(result.totalAttempts).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Attempt 1');
      expect(result.outputPath).toBeDefined();
      
      console.log('Test 2 - Retry success:', {
        success: result.success,
        totalAttempts: result.totalAttempts,
        errors: result.errors,
        executionTime: `${result.executionTime}ms`
      });
    }, 15000);

    it('should fail after all attempts exhausted', async () => {
      const result = await executeWithRetry(
        wrongCode,
        createMockFixer(wrongCode),  // 模拟AI一直返回错误代码
        { maxAttempts: 3 }
      );
      
      expect(result.success).toBe(false);
      expect(result.totalAttempts).toBe(3);
      expect(result.errors).toHaveLength(3);
      expect(result.outputPath).toBeUndefined();
      expect(result.finalError).toBeDefined();
      
      console.log('Test 3 - All failed:', {
        success: result.success,
        totalAttempts: result.totalAttempts,
        errors: result.errors,
        executionTime: `${result.executionTime}ms`
      });
    }, 15000);

    it('should respect maxAttempts configuration', async () => {
      const result = await executeWithRetry(
        wrongCode,
        createMockFixer(wrongCode),
        { maxAttempts: 2 }  // 只尝试2次
      );
      
      expect(result.success).toBe(false);
      expect(result.totalAttempts).toBe(2);
      expect(result.errors).toHaveLength(2);
      
      console.log('Test 4 - Max attempts respected:', {
        totalAttempts: result.totalAttempts
      });
    }, 15000);

    it('should call onAttempt callback before each attempt', async () => {
      const onAttempt = vi.fn();
      
      await executeWithRetry(
        correctCode,
        createMockFixer(correctCode),
        { 
          maxAttempts: 3,
          onAttempt 
        }
      );
      
      expect(onAttempt).toHaveBeenCalledTimes(1);
      expect(onAttempt).toHaveBeenCalledWith(1, correctCode);
      
      console.log('Test 5 - onAttempt callback works');
    }, 15000);

    it('should call onError callback after each failure', async () => {
      const onError = vi.fn();
      
      await executeWithRetry(
        wrongCode,
        createMockFixer(wrongCode),
        { 
          maxAttempts: 2,
          onError 
        }
      );
      
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError.mock.calls[0][0]).toBe(1);  // 第一次尝试
      expect(onError.mock.calls[1][0]).toBe(2);  // 第二次尝试
      
      console.log('Test 6 - onError callback works');
    }, 15000);

    it('should handle runtime errors and retry', async () => {
      const result = await executeWithRetry(
        runtimeErrorCode,
        createMockFixer(correctCode),  // 模拟AI修复运行时错误
        { maxAttempts: 3 }
      );
      
      expect(result.success).toBe(true);
      expect(result.totalAttempts).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('ReferenceError');
      
      console.log('Test 7 - Runtime error retry:', {
        success: result.success,
        totalAttempts: result.totalAttempts,
        errors: result.errors
      });
    }, 15000);

    it('should handle codeFixer throwing error', async () => {
      const brokenFixer = async () => {
        throw new Error('AI service unavailable');
      };
      
      const result = await executeWithRetry(
        wrongCode,
        brokenFixer,
        { maxAttempts: 2 }
      );
      
      expect(result.success).toBe(false);
      // 即使 fixer 出错，也应该继续尝试
      expect(result.totalAttempts).toBe(2);
      // 应该记录 fixer 的错误
      expect(result.errors.some(e => e.includes('fix failed'))).toBe(true);
      
      console.log('Test 8 - Broken fixer handled:', {
        errors: result.errors
      });
    }, 15000);
  });

  describe('createMockFixer', () => {
    it('should return the fixed code', async () => {
      const fixer = createMockFixer('fixed code');
      const result = await fixer('original', 'error feedback', 1);
      
      expect(result).toBe('fixed code');
    });

    it('should log attempt number', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const fixer = createMockFixer('fixed');
      
      await fixer('original', 'error', 2);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Attempt 2')
      );
      
      consoleSpy.mockRestore();
    });
  });
});
