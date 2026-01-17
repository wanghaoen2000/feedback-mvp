/**
 * DOCX 文件验证模块测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateDocx, validateDocxStructure, quickCheck, getFileSize, formatFileSize, listDocxContents } from './docxValidator';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

const testDir = '/tmp/docx-validator-test';
const structureTestDir = '/tmp/docx-structure-test';

// 创建一个有效的 docx 文件（最小结构）
function createValidDocx(filePath: string) {
  const zip = new AdmZip();
  
  // [Content_Types].xml
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`));
  
  // word/document.xml
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Test</w:t></w:r></w:p>
  </w:body>
</w:document>`));
  
  // _rels/.rels
  zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`));
  
  zip.writeZip(filePath);
}

// 创建一个损坏的 docx（缺少必要文件）
function createInvalidDocx(filePath: string) {
  const zip = new AdmZip();
  zip.addFile('random.txt', Buffer.from('not a valid docx'));
  zip.writeZip(filePath);
}

// 创建一个不是 zip 的文件
function createNotZipFile(filePath: string) {
  fs.writeFileSync(filePath, 'This is not a zip file, just plain text.');
}

// 测试前准备测试文件
beforeAll(() => {
  // 基础测试目录
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // 创建一个正常大小的文件（模拟有效docx，但不是真正的docx结构）
  const normalFile = path.join(testDir, 'normal.docx');
  fs.writeFileSync(normalFile, Buffer.alloc(5000, 'x'));  // 5KB
  
  // 创建一个空文件
  const emptyFile = path.join(testDir, 'empty.docx');
  fs.writeFileSync(emptyFile, '');
  
  // 创建一个很小的文件
  const tinyFile = path.join(testDir, 'tiny.docx');
  fs.writeFileSync(tinyFile, 'abc');  // 3 bytes

  // 结构测试目录
  if (!fs.existsSync(structureTestDir)) {
    fs.mkdirSync(structureTestDir, { recursive: true });
  }
  
  // 创建有效的 docx
  createValidDocx(path.join(structureTestDir, 'valid.docx'));
  
  // 创建无效的 docx（缺少必要文件）
  createInvalidDocx(path.join(structureTestDir, 'invalid.docx'));
  
  // 创建不是 zip 的文件
  createNotZipFile(path.join(structureTestDir, 'notzip.docx'));
});

// 测试后清理
afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.rmSync(structureTestDir, { recursive: true, force: true });
});

describe('docxValidator', () => {
  describe('validateDocx (size validation)', () => {
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
  });

  describe('validateDocxStructure', () => {
    it('should validate valid docx structure', () => {
      const validDocx = path.join(structureTestDir, 'valid.docx');
      const result = validateDocxStructure(validDocx);
      
      expect(result.valid).toBe(true);
      expect(result.details?.structureOK).toBe(true);
    });

    it('should fail for invalid docx (missing files)', () => {
      const invalidDocx = path.join(structureTestDir, 'invalid.docx');
      const result = validateDocxStructure(invalidDocx);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('缺少必要文件');
    });

    it('should fail for non-zip file', () => {
      const notZip = path.join(structureTestDir, 'notzip.docx');
      const result = validateDocxStructure(notZip);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('无法解析');
    });
  });

  describe('validateDocx with checkStructure', () => {
    it('should pass valid docx with structure check', () => {
      const validDocx = path.join(structureTestDir, 'valid.docx');
      const result = validateDocx(validDocx, { checkStructure: true, minSize: 100 });
      
      expect(result.valid).toBe(true);
      expect(result.details?.structureOK).toBe(true);
    });

    it('should fail invalid docx with structure check', () => {
      const invalidDocx = path.join(structureTestDir, 'invalid.docx');
      const result = validateDocx(invalidDocx, { checkStructure: true, minSize: 10 });
      
      expect(result.valid).toBe(false);
      expect(result.details?.structureOK).toBe(false);
    });

    it('should fail non-zip file with structure check', () => {
      const notZip = path.join(structureTestDir, 'notzip.docx');
      const result = validateDocx(notZip, { checkStructure: true, minSize: 10 });
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('无法解析');
    });
  });

  describe('listDocxContents', () => {
    it('should list contents of valid docx', () => {
      const validDocx = path.join(structureTestDir, 'valid.docx');
      const contents = listDocxContents(validDocx);
      
      expect(contents).not.toBeNull();
      expect(contents).toContain('[Content_Types].xml');
      expect(contents).toContain('word/document.xml');
    });

    it('should return null for non-zip file', () => {
      const notZip = path.join(structureTestDir, 'notzip.docx');
      const contents = listDocxContents(notZip);
      
      expect(contents).toBeNull();
    });

    it('should return null for non-existent file', () => {
      const contents = listDocxContents('/tmp/nope-12345.docx');
      
      expect(contents).toBeNull();
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
