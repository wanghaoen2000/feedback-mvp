import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('./db', () => ({
  getDb: vi.fn(() => Promise.resolve({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([]))
      }))
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve())
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve())
      }))
    })),
    delete: vi.fn(() => ({
      from: vi.fn(() => Promise.resolve())
    }))
  }))
}));

// Import after mocking
import { getAuthUrl, isAuthorized } from './googleAuth';

describe('googleAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAuthUrl', () => {
    it('should generate a valid Google OAuth URL', () => {
      const url = getAuthUrl();
      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('scope=');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('response_type=code');
      expect(url).toContain('access_type=offline');
    });

    it('should include drive scope', () => {
      const url = getAuthUrl();
      // 源码使用 https://www.googleapis.com/auth/drive 完整权限
      expect(url).toContain('drive');
    });
  });

  describe('isAuthorized', () => {
    it('should return false when no tokens exist', async () => {
      const result = await isAuthorized();
      expect(result).toBe(false);
    });
  });
});
