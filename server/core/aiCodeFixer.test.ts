/**
 * AI代码修正模块测试
 */

import { describe, it, expect, vi } from 'vitest';
import { cleanAIResponse, createAICodeFixer, createAICodeFixerFromConfig } from './aiCodeFixer';

describe('aiCodeFixer', () => {
  describe('cleanAIResponse', () => {
    it('should remove ```javascript code block markers', () => {
      const input = '```javascript\nconst a = 1;\nconst b = 2;\n```';
      const output = cleanAIResponse(input);
      expect(output).toBe('const a = 1;\nconst b = 2;');
    });

    it('should remove ```js code block markers', () => {
      const input = '```js\nconst a = 1;\n```';
      const output = cleanAIResponse(input);
      expect(output).toBe('const a = 1;');
    });

    it('should remove ``` code block markers without language', () => {
      const input = '```\nconst a = 1;\n```';
      const output = cleanAIResponse(input);
      expect(output).toBe('const a = 1;');
    });

    it('should handle code without markers', () => {
      const input = 'const a = 1;';
      const output = cleanAIResponse(input);
      expect(output).toBe('const a = 1;');
    });

    it('should trim whitespace', () => {
      const input = '  \n```javascript\nconst a = 1;\n```\n  ';
      const output = cleanAIResponse(input);
      expect(output).toBe('const a = 1;');
    });

    it('should handle multiline code', () => {
      const input = `\`\`\`javascript
const { Document, Paragraph, TextRun, Packer } = require('docx');
const fs = require('fs');

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({
        children: [new TextRun({ text: 'Hello', bold: true })],
      }),
    ],
  }],
});
\`\`\``;
      const output = cleanAIResponse(input);
      expect(output).toContain("const { Document, Paragraph, TextRun, Packer } = require('docx');");
      expect(output).toContain("new TextRun({ text: 'Hello', bold: true })");
      expect(output).not.toContain('```');
    });

    it('should handle JAVASCRIPT (uppercase) marker', () => {
      const input = '```JAVASCRIPT\nconst a = 1;\n```';
      const output = cleanAIResponse(input);
      expect(output).toBe('const a = 1;');
    });

    it('should preserve internal backticks', () => {
      const input = '```javascript\nconst str = `template ${var}`;\n```';
      const output = cleanAIResponse(input);
      expect(output).toBe('const str = `template ${var}`;');
    });
  });

  describe('createAICodeFixer', () => {
    it('should return a function', () => {
      const fixer = createAICodeFixer({
        apiUrl: 'https://test.api.com/v1',
        apiKey: 'test-key',
        model: 'test-model',
      });
      
      expect(typeof fixer).toBe('function');
    });

    it('should accept custom system prompt', () => {
      const customPrompt = 'You are a code fixing robot.';
      const fixer = createAICodeFixer(
        {
          apiUrl: 'https://test.api.com/v1',
          apiKey: 'test-key',
          model: 'test-model',
        },
        customPrompt
      );
      
      expect(typeof fixer).toBe('function');
    });

    it('should use default maxTokens if not provided', () => {
      const fixer = createAICodeFixer({
        apiUrl: 'https://test.api.com/v1',
        apiKey: 'test-key',
        model: 'test-model',
        // maxTokens not provided
      });
      
      expect(typeof fixer).toBe('function');
    });
  });

  describe('createAICodeFixerFromConfig', () => {
    it('should throw error if apiKey is not configured', async () => {
      const mockGetConfig = vi.fn().mockResolvedValue(null);
      
      await expect(createAICodeFixerFromConfig(mockGetConfig))
        .rejects
        .toThrow('API key not configured');
    });

    it('should create fixer with configured values', async () => {
      const mockGetConfig = vi.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          apiUrl: 'https://custom.api.com/v1',
          apiKey: 'custom-key',
          apiModel: 'custom-model',
        };
        return Promise.resolve(config[key] || null);
      });
      
      const fixer = await createAICodeFixerFromConfig(mockGetConfig);
      
      expect(typeof fixer).toBe('function');
      expect(mockGetConfig).toHaveBeenCalledWith('apiUrl');
      expect(mockGetConfig).toHaveBeenCalledWith('apiKey');
      expect(mockGetConfig).toHaveBeenCalledWith('apiModel');
    });

    it('should use default values for missing config', async () => {
      const mockGetConfig = vi.fn().mockImplementation((key: string) => {
        if (key === 'apiKey') return Promise.resolve('my-api-key');
        return Promise.resolve(null);  // Other configs not set
      });
      
      const fixer = await createAICodeFixerFromConfig(mockGetConfig);
      
      expect(typeof fixer).toBe('function');
    });
  });
});
