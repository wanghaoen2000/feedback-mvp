import { describe, it, expect } from 'vitest';
import { parseError, formatErrorMessage, StructuredError, isRetryableError } from './errorHandler';

describe('错误处理模块', () => {
  describe('parseError', () => {
    it('应该正确解析网络超时错误', () => {
      const error = new Error('fetch failed');
      const result = parseError(error, 'feedback');
      
      expect(result.code).toBe('fetch failed');
      expect(result.step).toBe('学情反馈');
      expect(result.message).toContain('网络');
    });

    it('应该正确解析余额不足错误', () => {
      const error = new Error('预扣费额度失败, insufficient_user_quota');
      const result = parseError(error, 'feedback');
      
      expect(result.code).toBe('insufficient_user_quota');
      expect(result.suggestion).toContain('充值');
    });

    it('应该正确解析401未授权错误', () => {
      const error = new Error('HTTP 401 Unauthorized');
      const result = parseError(error, 'review');
      
      expect(result.code).toBe('401');
      expect(result.step).toBe('复习文档');
      expect(result.suggestion).toContain('密钥');
    });

    it('应该正确解析403禁止访问错误', () => {
      const error = new Error('HTTP 403 Forbidden');
      const result = parseError(error, 'test');
      
      expect(result.code).toBe('403');
      expect(result.step).toBe('测试本');
    });

    it('应该正确解析429限流错误', () => {
      const error = new Error('rate_limit exceeded');
      const result = parseError(error, 'extraction');
      
      expect(result.code).toBe('rate_limit');
      expect(result.step).toBe('课后信息提取');
      expect(result.suggestion).toContain('等');
    });

    it('应该正确解析超时错误', () => {
      const error = new Error('timeout');
      const result = parseError(error, 'bubbleChart');
      
      expect(result.code).toBe('timeout');
      expect(result.step).toBe('气泡图');
    });

    it('应该将未知错误归类为unknown', () => {
      const error = new Error('some random error');
      const result = parseError(error, 'feedback');
      
      expect(result.code).toBe('unknown');
      expect(result.originalError).toBe('some random error');
    });

    it('应该处理非Error对象', () => {
      const result = parseError('string error', 'feedback');
      
      expect(result.code).toBe('unknown');
      expect(result.originalError).toBe('string error');
    });
  });

  describe('formatErrorMessage', () => {
    it('应该格式化完整的错误消息', () => {
      const error: StructuredError = {
        code: 'fetch failed',
        step: '学情反馈',
        message: '网络请求失败',
        suggestion: '请检查网络连接后重试',
        originalError: 'fetch failed'
      };
      
      const result = formatErrorMessage(error);
      
      expect(result).toContain('网络请求失败');
      expect(result).toContain('请检查网络连接后重试');
    });

    it('应该正确显示步骤名称', () => {
      const error: StructuredError = {
        code: 'timeout',
        step: '气泡图',
        message: '请求超时',
        suggestion: '请稍后重试',
        originalError: 'timeout'
      };
      
      const result = formatErrorMessage(error);
      
      expect(result).toContain('气泡图');
    });
  });

  describe('isRetryableError', () => {
    it('余额不足错误不应该重试', () => {
      const error: StructuredError = {
        code: 'insufficient_user_quota',
        step: '学情反馈',
        message: 'API余额不足',
        suggestion: '请充值',
        originalError: ''
      };
      
      expect(isRetryableError(error)).toBe(false);
    });

    it('401错误不应该重试', () => {
      const error: StructuredError = {
        code: '401',
        step: '学情反馈',
        message: 'API密钥无效',
        suggestion: '请检查密钥',
        originalError: ''
      };
      
      expect(isRetryableError(error)).toBe(false);
    });

    it('超时错误应该可以重试', () => {
      const error: StructuredError = {
        code: 'timeout',
        step: '学情反馈',
        message: '请求超时',
        suggestion: '请稍后重试',
        originalError: ''
      };
      
      expect(isRetryableError(error)).toBe(true);
    });

    it('网络错误应该可以重试', () => {
      const error: StructuredError = {
        code: 'fetch failed',
        step: '学情反馈',
        message: '网络请求失败',
        suggestion: '请检查网络',
        originalError: ''
      };
      
      expect(isRetryableError(error)).toBe(true);
    });
  });
});
