import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before importing
vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn((fn) => fn),
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { runSystemCheck, CheckResult, SystemCheckResults } from './systemCheck';
import { getDb } from './db';
import { exec } from 'child_process';

describe('系统自检模块', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runSystemCheck', () => {
    it('应该返回正确的结构', async () => {
      // Mock database
      const mockConfigs = [
        { key: 'apiKey', value: 'sk-test123' },
        { key: 'apiUrl', value: 'https://api.test.com/v1' },
        { key: 'apiModel', value: 'test-model' },
        { key: 'roadmap', value: 'A'.repeat(200) },
      ];
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockConfigs),
          }),
        }),
      };
      // 对于没有limit的查询，返回数组
      mockDb.select.mockReturnValue({
        from: vi.fn().mockResolvedValue(mockConfigs),
      });
      (getDb as any).mockResolvedValue(mockDb);
      
      // Mock exec for rclone commands
      (exec as any).mockImplementation((cmd: string, opts: any, callback?: any) => {
        if (callback) {
          callback(null, { stdout: 'success', stderr: '' });
        }
        return Promise.resolve({ stdout: 'success', stderr: '' });
      });
      
      // Mock fetch for API tests
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ models: [] }),
      });
      
      const result = await runSystemCheck();
      
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('allPassed');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('当数据库连接失败时应该跳过后续检测', async () => {
      (getDb as any).mockResolvedValue(null);
      
      const result = await runSystemCheck();
      
      expect(result.results[0].name).toBe('数据库连接');
      expect(result.results[0].status).toBe('error');
      expect(result.passed).toBe(0);
      expect(result.total).toBe(8);
      
      // 后续检测应该都是skipped
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i].status).toBe('skipped');
      }
    });
  });

  describe('CheckResult 结构', () => {
    it('应该包含必要的字段', () => {
      const result: CheckResult = {
        name: '测试项',
        status: 'success',
        message: '正常',
      };
      
      expect(result.name).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.message).toBeDefined();
    });

    it('可以包含可选的suggestion字段', () => {
      const result: CheckResult = {
        name: '测试项',
        status: 'error',
        message: '失败',
        suggestion: '请检查配置',
      };
      
      expect(result.suggestion).toBe('请检查配置');
    });
  });

  describe('SystemCheckResults 结构', () => {
    it('应该包含统计信息', () => {
      const results: SystemCheckResults = {
        results: [],
        passed: 5,
        total: 8,
        allPassed: false,
      };
      
      expect(results.passed).toBe(5);
      expect(results.total).toBe(8);
      expect(results.allPassed).toBe(false);
    });
  });
});
