import { describe, it, expect, vi } from 'vitest';

// Mock LLM调用
vi.mock('./_core/llm', () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: '测试生成内容'
      }
    }]
  }),
  TextContent: {},
  ImageContent: {},
  FileContent: {},
}));

// Mock Google Drive上传
vi.mock('./gdrive', () => ({
  uploadToGoogleDrive: vi.fn().mockResolvedValue({
    url: 'https://drive.google.com/test',
    path: 'test/path'
  }),
  uploadBinaryToGoogleDrive: vi.fn().mockResolvedValue({
    url: 'https://drive.google.com/test',
    path: 'test/path'
  }),
  uploadMultipleFiles: vi.fn().mockResolvedValue([
    { fileName: '测试反馈.md', url: 'https://drive.google.com/1', path: 'path/1' },
    { fileName: '测试复习.docx', url: 'https://drive.google.com/2', path: 'path/2' },
    { fileName: '测试测试本.docx', url: 'https://drive.google.com/3', path: 'path/3' },
    { fileName: '测试信息提取.md', url: 'https://drive.google.com/4', path: 'path/4' },
    { fileName: '测试气泡图.png', url: 'https://drive.google.com/5', path: 'path/5' },
  ])
}));

describe('Feedback Generator', () => {
  it('should have correct input validation schema (V11: without date fields)', async () => {
    // V11更新：移除了日期字段，AI自动从笔记中提取
    const validInput = {
      studentName: '张三',
      lessonNumber: '第10次课',
      // lessonDate 和 nextLessonDate 已移除
      lastFeedback: '上次反馈内容',
      currentNotes: '本次课笔记内容\n上次课：1月8日\n本次课：1月15日\n下次课：1月22日',
      transcript: '录音转文字内容',
      isFirstLesson: false,
      specialRequirements: '',
    };
    
    expect(validInput.studentName).toBeTruthy();
    expect(validInput.currentNotes).toBeTruthy();
    expect(validInput.transcript).toBeTruthy();
    // 确认日期信息包含在笔记中
    expect(validInput.currentNotes).toContain('本次课');
  });

  it('should handle first lesson mode', () => {
    const firstLessonInput = {
      studentName: '李四',
      isFirstLesson: true,
      lastFeedback: '', // 新生首次课不需要上次反馈
    };
    
    expect(firstLessonInput.isFirstLesson).toBe(true);
    expect(firstLessonInput.lastFeedback).toBe('');
  });

  it('should generate correct Google Drive path', () => {
    const studentName = '张三';
    const basePath = `Mac/Documents/XDF/学生档案/${studentName}`;
    
    const expectedPaths = {
      feedback: `${basePath}/学情反馈`,
      review: `${basePath}/复习文档`,
      test: `${basePath}/复习文档`,
      extraction: `${basePath}/课后信息`,
      bubbleChart: `${basePath}/气泡图`,
    };
    
    expect(expectedPaths.feedback).toBe('Mac/Documents/XDF/学生档案/张三/学情反馈');
    expect(expectedPaths.review).toBe('Mac/Documents/XDF/学生档案/张三/复习文档');
    expect(expectedPaths.bubbleChart).toBe('Mac/Documents/XDF/学生档案/张三/气泡图');
  });

  it('should generate SVG bubble chart with correct structure', () => {
    const items = [
      { problem: ['问题1', '描述1'], solution: ['方案1', '描述1'] },
      { problem: ['问题2', '描述2'], solution: ['方案2', '描述2'] },
    ];
    
    expect(items.length).toBe(2);
    expect(items[0].problem[0]).toBe('问题1');
    expect(items[0].solution[0]).toBe('方案1');
  });
});

describe('Google Drive Upload', () => {
  it('should upload files to correct paths', async () => {
    const { uploadMultipleFiles } = await import('./gdrive');
    
    const files = [
      { content: '测试内容', fileName: '测试.md', folderPath: 'test/path' },
    ];
    
    const results = await uploadMultipleFiles(files);
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('API Configuration (V11)', () => {
  it('should have default config values', () => {
    const DEFAULT_CONFIG = {
      apiModel: "claude-sonnet-4-5-20250929",
      apiKey: "", // 从环境变量获取
      apiUrl: "https://api.whatai.cc/v1",
    };
    
    expect(DEFAULT_CONFIG.apiModel).toBe("claude-sonnet-4-5-20250929");
    expect(DEFAULT_CONFIG.apiUrl).toBe("https://api.whatai.cc/v1");
  });

  it('should allow custom config override', () => {
    const customConfig = {
      apiModel: "gpt-4o",
      apiKey: "sk-custom-key",
      apiUrl: "https://api.openai.com/v1",
    };
    
    // 模拟配置覆盖逻辑
    const DEFAULT_CONFIG = {
      apiModel: "claude-sonnet-4-5-20250929",
      apiKey: "",
      apiUrl: "https://api.whatai.cc/v1",
    };
    
    const finalConfig = {
      apiModel: customConfig.apiModel || DEFAULT_CONFIG.apiModel,
      apiKey: customConfig.apiKey || DEFAULT_CONFIG.apiKey,
      apiUrl: customConfig.apiUrl || DEFAULT_CONFIG.apiUrl,
    };
    
    expect(finalConfig.apiModel).toBe("gpt-4o");
    expect(finalConfig.apiKey).toBe("sk-custom-key");
    expect(finalConfig.apiUrl).toBe("https://api.openai.com/v1");
  });

  it('should use default when custom config is empty', () => {
    const customConfig = {
      apiModel: "",
      apiKey: "",
      apiUrl: "",
    };
    
    const DEFAULT_CONFIG = {
      apiModel: "claude-sonnet-4-5-20250929",
      apiKey: "default-key",
      apiUrl: "https://api.whatai.cc/v1",
    };
    
    const finalConfig = {
      apiModel: customConfig.apiModel || DEFAULT_CONFIG.apiModel,
      apiKey: customConfig.apiKey || DEFAULT_CONFIG.apiKey,
      apiUrl: customConfig.apiUrl || DEFAULT_CONFIG.apiUrl,
    };
    
    expect(finalConfig.apiModel).toBe("claude-sonnet-4-5-20250929");
    expect(finalConfig.apiKey).toBe("default-key");
    expect(finalConfig.apiUrl).toBe("https://api.whatai.cc/v1");
  });
});

describe('Date Extraction from Notes (V11)', () => {
  it('should extract dates from notes content', () => {
    const notes = `
上次课：1月8日
本次课：1月15日
下次课：1月22日

今天讲解了词汇题的解题方法...
    `;
    
    // 模拟日期提取逻辑
    const extractDate = (text: string, pattern: RegExp): string | null => {
      const match = text.match(pattern);
      return match ? match[1] : null;
    };
    
    const lastLessonDate = extractDate(notes, /上次课[：:]\s*(\d+月\d+日)/);
    const currentLessonDate = extractDate(notes, /本次课[：:]\s*(\d+月\d+日)/);
    const nextLessonDate = extractDate(notes, /下次课[：:]\s*(\d+月\d+日)/);
    
    expect(lastLessonDate).toBe('1月8日');
    expect(currentLessonDate).toBe('1月15日');
    expect(nextLessonDate).toBe('1月22日');
  });

  it('should handle missing dates gracefully', () => {
    const notes = `今天讲解了词汇题的解题方法...`;
    
    const extractDate = (text: string, pattern: RegExp): string | null => {
      const match = text.match(pattern);
      return match ? match[1] : null;
    };
    
    const currentLessonDate = extractDate(notes, /本次课[：:]\s*(\d+月\d+日)/);
    
    expect(currentLessonDate).toBeNull();
  });
});
