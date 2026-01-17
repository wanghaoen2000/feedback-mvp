/**
 * DOCX 文件验证模块测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateDocx, quickCheck, getFileSize, formatFileSize } from './docxValidator';
import * as fs from 'fs';
import * as path from 'path';

const testDir = '/tmp/docx-validator-test';

// 测试前准备测试文件
beforeAll(() => {
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // 创建一个正常大小的文件（模拟有效docx）
  const normalFile = path.join(testDir, 'normal.docx');
  fs.writeFileSync(normalFile, Buffer.alloc(5000, 'x'));  // 5KB
  
  // 创建一个空文件
  const emptyFile = path.join(testDir, 'empty.docx');
  fs.writeFileSync(emptyFile, '');
  
  // 创建一个很小的文件
  const tinyFile = path.join(testDir, 'tiny.docx');
  fs.writeFileSync(tinyFile, 'abc');  // 3 bytes
});

// 测试后清理
afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('docxValidator', () => {
  describe('validateDocx', () => {
    it('should validate normal file successfully', () => {
      const normalFile = path.join(testDir, 'normal.docx');
      const result = validateDocx(normalFile);
      
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.details?.exists).toBe(true);
      expect(result.details?.size).toBe(5000);
      expect(result.details?.sizeOK).toBe(true);
    });

    it('should fail for non-existent file', () => {
      const result = validateDocx('/tmp/not-exist-12345.docx');
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('文件不存在');
      expect(result.details?.exists).toBe(false);
    });

    it('should fail for empty file', () => {
      const emptyFile = path.join(testDir, 'empty.docx');
      const result = validateDocx(emptyFile);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('文件过小');
      expect(result.details?.exists).toBe(true);
      expect(result.details?.size).toBe(0);
      expect(result.details?.sizeOK).toBe(false);
    });

    it('should fail for tiny file', () => {
      const tinyFile = path.join(testDir, 'tiny.docx');
      const result = validateDocx(tinyFile);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('文件过小');
      expect(result.details?.size).toBe(3);
      expect(result.details?.sizeOK).toBe(false);
    });

    it('should respect custom minSize', () => {
      const normalFile = path.join(testDir, 'normal.docx');
      
      // 设置很高的最小值，正常文件也不通过
      const result = validateDocx(normalFile, { minSize: 10000 });
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('文件过小');
    });

    it('should pass with lower minSize', () => {
      const tinyFile = path.join(testDir, 'tiny.docx');
      
      // 设置很低的最小值，小文件也能通过
      const result = validateDocx(tinyFile, { minSize: 1 });
      
      expect(result.valid).toBe(true);
    });

    it('should handle checkStructure flag (placeholder)', () => {
      const normalFile = path.join(testDir, 'normal.docx');
      const result = validateDocx(normalFile, { checkStructure: true });
      
      expect(result.valid).toBe(true);
      expect(result.details?.structureOK).toBe(true);  // 暂时默认为 true
    });
  });

  describe('quickCheck', () => {
    it('should return true for normal file', () => {
      const normalFile = path.join(testDir, 'normal.docx');
      expect(quickCheck(normalFile)).toBe(true);
    });

    it('should return false for empty file', () => {
      const emptyFile = path.join(testDir, 'empty.docx');
      expect(quickCheck(emptyFile)).toBe(false);
    });

    it('should return false for non-existent file', () => {
      expect(quickCheck('/tmp/nope-12345.docx')).toBe(false);
    });
  });

  describe('getFileSize', () => {
    it('should return correct size for normal file', () => {
      const normalFile = path.join(testDir, 'normal.docx');
      expect(getFileSize(normalFile)).toBe(5000);
    });

    it('should return 0 for empty file', () => {
      const emptyFile = path.join(testDir, 'empty.docx');
      expect(getFileSize(emptyFile)).toBe(0);
    });

    it('should return -1 for non-existent file', () => {
      expect(getFileSize('/tmp/nope-12345.docx')).toBe(-1);
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(1023)).toBe('1023 B');
    });

    it('should format kilobytes correctly', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(2048)).toBe('2.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('should format megabytes correctly', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
      expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.50 MB');
      expect(formatFileSize(10 * 1024 * 1024)).toBe('10.00 MB');
    });

    it('should return N/A for negative values', () => {
      expect(formatFileSize(-1)).toBe('N/A');
      expect(formatFileSize(-100)).toBe('N/A');
    });
  });
});
