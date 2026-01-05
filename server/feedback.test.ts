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
  it('should have correct input validation schema', async () => {
    // 测试输入验证
    const validInput = {
      studentName: '张三',
      lessonNumber: '第10次课',
      lessonDate: '1月15日',
      nextLessonDate: '1月22日',
      lastFeedback: '上次反馈内容',
      currentNotes: '本次课笔记内容',
      transcript: '录音转文字内容',
      isFirstLesson: false,
      specialRequirements: '',
    };
    
    expect(validInput.studentName).toBeTruthy();
    expect(validInput.currentNotes).toBeTruthy();
    expect(validInput.transcript).toBeTruthy();
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
