/**
 * V46h: 批量任务 Word 文档生成器
 * 将 Markdown 文本转换为 Word 文档
 */
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, AlignmentType } from "docx";

/**
 * 解析行内格式（粗体、斜体），返回 TextRun 数组
 */
function parseInlineFormatting(text: string, baseSize: number = 22): TextRun[] {
  const runs: TextRun[] = [];
  
  // 正则匹配粗斜体、粗体、斜体
  // 顺序很重要：先匹配 ***，再匹配 **，最后匹配 *
  const pattern = /(\*\*\*|___)(.+?)(\*\*\*|___)|(\*\*|__)(.+?)(\*\*|__)|(\*|_)(.+?)(\*|_)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    // 添加匹配前的普通文本
    if (match.index > lastIndex) {
      const beforeText = text.substring(lastIndex, match.index);
      if (beforeText) {
        runs.push(new TextRun({ text: beforeText, size: baseSize }));
      }
    }
    
    // 判断匹配类型
    if (match[1] && match[2]) {
      // 粗斜体 ***text*** 或 ___text___
      runs.push(new TextRun({ text: match[2], bold: true, italics: true, size: baseSize }));
    } else if (match[4] && match[5]) {
      // 粗体 **text** 或 __text__
      runs.push(new TextRun({ text: match[5], bold: true, size: baseSize }));
    } else if (match[7] && match[8]) {
      // 斜体 *text* 或 _text_
      runs.push(new TextRun({ text: match[8], italics: true, size: baseSize }));
    }
    
    lastIndex = pattern.lastIndex;
  }
  
  // 添加剩余的普通文本
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    if (remainingText) {
      runs.push(new TextRun({ text: remainingText, size: baseSize }));
    }
  }
  
  // 如果没有任何匹配，返回原始文本
  if (runs.length === 0) {
    runs.push(new TextRun({ text: text, size: baseSize }));
  }
  
  return runs;
}

/**
 * 清理 Markdown 和 HTML 标记（保留粗体/斜体标记用于后续解析）
 */
function cleanMarkdownAndHtml(text: string): string {
  let cleaned = text;
  
  // 移除 HTML 标签
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  
  // 注意：不再移除粗体/斜体标记，留给 parseInlineFormatting 处理
  
  // 移除 Markdown 标题符号
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  
  // 移除 Markdown 链接
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // 移除 Markdown 代码块
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  
  // 移除多余空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  return cleaned.trim();
}

/**
 * 将任务编号格式化为两位数
 */
function formatTaskNumber(taskNumber: number): string {
  return taskNumber.toString().padStart(2, '0');
}

// 样式配置
const STYLE_CONFIG = {
  // 教学材料（带样式）
  styled: {
    titleColor: '6A1B9A',  // 紫色
    headingColor: '6A1B9A',
    accentColor: 'FF6F00',  // 橙色
  },
  // 通用文档（无样式）
  plain: {
    titleColor: '000000',  // 黑色
    headingColor: '000000',
    accentColor: '000000',
  }
};

/**
 * 生成批量任务的 Word 文档
 * @param content Markdown 或纯文本内容
 * @param taskNumber 任务编号
 * @param filePrefix 文件名前缀（默认为"任务"）
 * @param useStyled 是否使用带样式的模板（默认为 true）
 * @returns { buffer: Buffer, filename: string }
 */
export async function generateBatchDocument(
  content: string,
  taskNumber: number,
  filePrefix: string = '任务',
  useStyled: boolean = true
): Promise<{ buffer: Buffer; filename: string }> {
  const styleConfig = useStyled ? STYLE_CONFIG.styled : STYLE_CONFIG.plain;
  // 清理 Markdown 标记
  const cleanedText = cleanMarkdownAndHtml(content);
  const lines = cleanedText.split('\n');
  
  // 生成文件名
  const taskNumStr = formatTaskNumber(taskNumber);
  const prefix = filePrefix.trim() || '任务';
  const filename = `${prefix}${taskNumStr}.docx`;
  
  // 构建文档内容
  const children: Paragraph[] = [];
  
  // 添加标题
  const title = `${prefix} ${taskNumber}`;
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 32, color: styleConfig.titleColor })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );
  
  let inAnswerSection = false;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 检测答案分隔符
    if (trimmedLine.includes('===== 答案部分 =====') || trimmedLine.includes('答案部分')) {
      // 添加分页符
      children.push(
        new Paragraph({
          children: [new PageBreak()],
        })
      );
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '答案部分', bold: true, size: 28, color: styleConfig.titleColor })],
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 400 },
        })
      );
      inAnswerSection = true;
      continue;
    }
    
    // 检测章节标题（【xxx】格式）
    if (trimmedLine.match(/^【.+】$/)) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine, bold: true, size: 26, color: styleConfig.headingColor })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 200 },
        })
      );
      continue;
    }
    
    // 检测小节标题（一、二、三等）
    if (trimmedLine.match(/^[一二三四五六七八九十]+、/)) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine, bold: true, size: 24, color: styleConfig.headingColor })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 150 },
        })
      );
      continue;
    }
    
    // 检测 Markdown 标题（# ## ### 等）
    const headingMatch = trimmedLine.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const headingLevel = level === 1 ? HeadingLevel.HEADING_1 
        : level === 2 ? HeadingLevel.HEADING_2 
        : HeadingLevel.HEADING_3;
      const fontSize = level === 1 ? 28 : level === 2 ? 26 : 24;
      
      children.push(
        new Paragraph({
          children: [new TextRun({ text: headingText, bold: true, size: fontSize, color: styleConfig.headingColor })],
          heading: headingLevel,
          spacing: { before: 200, after: 150 },
        })
      );
      continue;
    }
    
    // 普通段落（解析粗体/斜体）
    if (trimmedLine) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmedLine, 22),
          spacing: { after: 100 },
        })
      );
    } else {
      // 空行
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '' })],
          spacing: { after: 50 },
        })
      );
    }
  }
  
  // 创建文档
  const doc = new Document({
    sections: [{
      properties: {},
      children,
    }],
  });
  
  // 生成 Buffer
  const buffer = await Packer.toBuffer(doc);
  
  return { buffer, filename };
}

/**
 * 批量生成多个文档
 * @param tasks 任务列表，每个任务包含 content 和 taskNumber
 * @returns 生成的文档列表
 */
export async function generateBatchDocuments(
  tasks: Array<{ content: string; taskNumber: number; suggestedFilename?: string }>
): Promise<Array<{ buffer: Buffer; filename: string; taskNumber: number }>> {
  const results: Array<{ buffer: Buffer; filename: string; taskNumber: number }> = [];
  
  for (const task of tasks) {
    const { buffer, filename } = await generateBatchDocument(
      task.content,
      task.taskNumber,
      task.suggestedFilename
    );
    results.push({ buffer, filename, taskNumber: task.taskNumber });
  }
  
  return results;
}
