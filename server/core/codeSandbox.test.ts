/**
 * 代码沙箱执行模块测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { executeInSandbox, cleanOutputDir } from './codeSandbox';
import * as fs from 'fs';
import * as path from 'path';

const TEST_OUTPUT_DIR = '/tmp/docx-output-test';

describe('codeSandbox', () => {
  beforeEach(() => {
    // 清理测试输出目录
    cleanOutputDir(TEST_OUTPUT_DIR);
  });

  it('should execute simple code successfully', async () => {
    const testCode = `
      const result = 1 + 1;
      console.log('计算结果:', result);
    `;

    const result = await executeInSandbox(testCode, { outputDir: TEST_OUTPUT_DIR });
    
    // 代码执行成功，但没有生成 docx 文件
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('NoOutputError');
    expect(result.executionTime).toBeDefined();
  });

  it('should generate docx file with docx-js', async () => {
    const testCode = `
      const { Document, Paragraph, TextRun, Packer } = require('docx');
      const fs = require('fs');
      const path = require('path');

      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: '测试文档', bold: true, size: 48 }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun('这是沙箱生成的Word文档。'),
              ],
            }),
          ],
        }],
      });

      Packer.toBuffer(doc).then(buffer => {
        fs.writeFileSync(path.join(__outputDir, 'test_output.docx'), buffer);
      });
    `;

    const result = await executeInSandbox(testCode, { 
      outputDir: TEST_OUTPUT_DIR,
      timeout: 10000 
    });

    console.log('执行结果:', JSON.stringify(result, null, 2));

    // 验证执行成功
    expect(result.success).toBe(true);
    expect(result.outputPath).toBeDefined();
    expect(result.outputPath).toContain('test_output.docx');
    expect(result.executionTime).toBeDefined();

    // 验证文件存在
    if (result.outputPath) {
      expect(fs.existsSync(result.outputPath)).toBe(true);
    }
  });

  it('should catch syntax errors', async () => {
    const badCode = `
      const x = {
        // 语法错误：缺少闭合括号
    `;

    const result = await executeInSandbox(badCode, { outputDir: TEST_OUTPUT_DIR });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('SyntaxError');
  });

  it('should catch runtime errors', async () => {
    const badCode = `
      // 运行时错误：调用未定义的函数
      undefinedFunction();
    `;

    const result = await executeInSandbox(badCode, { outputDir: TEST_OUTPUT_DIR });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('undefinedFunction');
  });

  it('should respect timeout', async () => {
    const infiniteLoopCode = `
      while(true) {}
    `;

    const result = await executeInSandbox(infiniteLoopCode, { 
      outputDir: TEST_OUTPUT_DIR,
      timeout: 1000  // 1秒超时
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // vm2 超时会抛出错误
  });

  it('should clean output directory', () => {
    // 创建测试目录和文件
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(TEST_OUTPUT_DIR, 'test.txt'), 'test content');

    // 验证文件存在
    expect(fs.existsSync(path.join(TEST_OUTPUT_DIR, 'test.txt'))).toBe(true);

    // 清理目录
    cleanOutputDir(TEST_OUTPUT_DIR);

    // 验证文件已删除
    const files = fs.readdirSync(TEST_OUTPUT_DIR);
    expect(files.length).toBe(0);
  });
});

// ==================== 安全测试 ====================
describe('codeSandbox security', () => {
  beforeEach(() => {
    cleanOutputDir(TEST_OUTPUT_DIR);
  });

  it('should block child_process module', async () => {
    const maliciousCode = `
      const child_process = require('child_process');
      child_process.execSync('ls -la');
    `;

    const result = await executeInSandbox(maliciousCode, { outputDir: TEST_OUTPUT_DIR });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('安全限制');
    expect(result.error?.message).toContain('child_process');
  });

  it('should block http module', async () => {
    const maliciousCode = `
      const http = require('http');
      http.get('http://evil.com');
    `;

    const result = await executeInSandbox(maliciousCode, { outputDir: TEST_OUTPUT_DIR });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('安全限制');
    expect(result.error?.message).toContain('http');
  });

  it('should block net module', async () => {
    const maliciousCode = `
      const net = require('net');
      net.createServer();
    `;

    const result = await executeInSandbox(maliciousCode, { outputDir: TEST_OUTPUT_DIR });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('安全限制');
    expect(result.error?.message).toContain('net');
  });

  it('should block os module', async () => {
    const maliciousCode = `
      const os = require('os');
      console.log(os.hostname());
    `;

    const result = await executeInSandbox(maliciousCode, { outputDir: TEST_OUTPUT_DIR });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('安全限制');
    expect(result.error?.message).toContain('os');
  });

  it('should block writing to /etc/passwd', async () => {
    const maliciousCode = `
      const fs = require('fs');
      fs.writeFileSync('/etc/passwd', 'hacked');
    `;

    const result = await executeInSandbox(maliciousCode, { outputDir: TEST_OUTPUT_DIR });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('安全限制');
  });

  it('should block writing to /tmp/other-dir', async () => {
    const maliciousCode = `
      const fs = require('fs');
      fs.writeFileSync('/tmp/other-dir/hack.txt', 'hacked');
    `;

    const result = await executeInSandbox(maliciousCode, { outputDir: TEST_OUTPUT_DIR });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('安全限制');
  });

  it('should allow writing to outputDir', async () => {
    const safeCode = `
      const fs = require('fs');
      const path = require('path');
      fs.writeFileSync(path.join(__outputDir, 'safe.txt'), 'safe content');
    `;

    const result = await executeInSandbox(safeCode, { outputDir: TEST_OUTPUT_DIR });

    // 代码执行成功（虽然没有生成 docx）
    expect(result.error?.type).not.toBe('Error');
    // 验证文件确实被创建
    expect(fs.existsSync(path.join(TEST_OUTPUT_DIR, 'safe.txt'))).toBe(true);
  });

  it('should allow normal docx generation with restricted modules', async () => {
    const safeCode = `
      const { Document, Paragraph, TextRun, Packer } = require('docx');
      const fs = require('fs');
      const path = require('path');

      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({
              children: [new TextRun('安全测试文档')],
            }),
          ],
        }],
      });

      Packer.toBuffer(doc).then(buffer => {
        fs.writeFileSync(path.join(__outputDir, 'safe_test.docx'), buffer);
      });
    `;

    const result = await executeInSandbox(safeCode, { 
      outputDir: TEST_OUTPUT_DIR,
      timeout: 10000 
    });

    expect(result.success).toBe(true);
    expect(result.outputPath).toBeDefined();
    expect(result.outputPath).toContain('safe_test.docx');
  });
});
