/**
 * 重试控制器测试
 * Mock 沙箱模块以避免 vm2 兼容性问题
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 沙箱执行模块，避免依赖 vm2
vi.mock('./codeSandbox', () => ({
  executeInSandbox: vi.fn(),
  cleanOutputDir: vi.fn(),
}));

vi.mock('./errorFormatter', () => ({
  formatErrorSummary: vi.fn((err: any) => `${err.type}: ${err.message}`),
  formatErrorForAI: vi.fn((err: any) => `Error: ${err.message}`),
}));

import { executeWithRetry, createMockFixer } from './codeRetry';
import { executeInSandbox } from './codeSandbox';

const mockedExecuteInSandbox = vi.mocked(executeInSandbox);

// 测试用代码片段（仅用于标识，不会真正执行）
const correctCode = 'correct-code';
const wrongCode = 'wrong-code';
const runtimeErrorCode = 'runtime-error-code';

describe('codeRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeWithRetry', () => {
    it('should succeed on first attempt with correct code', async () => {
      mockedExecuteInSandbox.mockResolvedValueOnce({
        success: true,
        outputPath: '/tmp/docx-output/retry_test.docx',
        executionTime: 50,
      });

      const result = await executeWithRetry(
        correctCode,
        createMockFixer(correctCode),
        { maxAttempts: 3 }
      );

      expect(result.success).toBe(true);
      expect(result.totalAttempts).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.outputPath).toContain('.docx');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should retry and succeed on second attempt', async () => {
      // 第一次失败
      mockedExecuteInSandbox.mockResolvedValueOnce({
        success: false,
        error: { type: 'SyntaxError', message: 'missing ) after argument list' },
      });
      // 第二次成功
      mockedExecuteInSandbox.mockResolvedValueOnce({
        success: true,
        outputPath: '/tmp/docx-output/retry_test.docx',
        executionTime: 50,
      });

      const result = await executeWithRetry(
        wrongCode,
        createMockFixer(correctCode),
        { maxAttempts: 3 }
      );

      expect(result.success).toBe(true);
      expect(result.totalAttempts).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Attempt 1');
      expect(result.outputPath).toBeDefined();
    });

    it('should fail after all attempts exhausted', async () => {
      mockedExecuteInSandbox.mockResolvedValue({
        success: false,
        error: { type: 'SyntaxError', message: 'Unexpected token' },
      });

      const result = await executeWithRetry(
        wrongCode,
        createMockFixer(wrongCode),
        { maxAttempts: 3 }
      );

      expect(result.success).toBe(false);
      expect(result.totalAttempts).toBe(3);
      expect(result.errors).toHaveLength(3);
      expect(result.outputPath).toBeUndefined();
      expect(result.finalError).toBeDefined();
    });

    it('should respect maxAttempts configuration', async () => {
      mockedExecuteInSandbox.mockResolvedValue({
        success: false,
        error: { type: 'SyntaxError', message: 'Unexpected token' },
      });

      const result = await executeWithRetry(
        wrongCode,
        createMockFixer(wrongCode),
        { maxAttempts: 2 }
      );

      expect(result.success).toBe(false);
      expect(result.totalAttempts).toBe(2);
      expect(result.errors).toHaveLength(2);
    });

    it('should call onAttempt callback before each attempt', async () => {
      const onAttempt = vi.fn();
      mockedExecuteInSandbox.mockResolvedValueOnce({
        success: true,
        outputPath: '/tmp/docx-output/test.docx',
      });

      await executeWithRetry(
        correctCode,
        createMockFixer(correctCode),
        { maxAttempts: 3, onAttempt }
      );

      expect(onAttempt).toHaveBeenCalledTimes(1);
      expect(onAttempt).toHaveBeenCalledWith(1, correctCode);
    });

    it('should call onError callback after each failure', async () => {
      const onError = vi.fn();
      mockedExecuteInSandbox.mockResolvedValue({
        success: false,
        error: { type: 'SyntaxError', message: 'Unexpected token' },
      });

      await executeWithRetry(
        wrongCode,
        createMockFixer(wrongCode),
        { maxAttempts: 2, onError }
      );

      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError.mock.calls[0][0]).toBe(1);
      expect(onError.mock.calls[1][0]).toBe(2);
    });

    it('should handle runtime errors and retry', async () => {
      // 第一次：运行时错误
      mockedExecuteInSandbox.mockResolvedValueOnce({
        success: false,
        error: { type: 'ReferenceError', message: 'undefinedFunction is not defined' },
      });
      // 第二次：成功
      mockedExecuteInSandbox.mockResolvedValueOnce({
        success: true,
        outputPath: '/tmp/docx-output/test.docx',
      });

      const result = await executeWithRetry(
        runtimeErrorCode,
        createMockFixer(correctCode),
        { maxAttempts: 3 }
      );

      expect(result.success).toBe(true);
      expect(result.totalAttempts).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('ReferenceError');
    });

    it('should handle codeFixer throwing error', async () => {
      const brokenFixer = async () => {
        throw new Error('AI service unavailable');
      };

      mockedExecuteInSandbox.mockResolvedValue({
        success: false,
        error: { type: 'SyntaxError', message: 'Unexpected token' },
      });

      const result = await executeWithRetry(
        wrongCode,
        brokenFixer,
        { maxAttempts: 2 }
      );

      expect(result.success).toBe(false);
      expect(result.totalAttempts).toBe(2);
      expect(result.errors.some(e => e.includes('fix failed'))).toBe(true);
    });
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
