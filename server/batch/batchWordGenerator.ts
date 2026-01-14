/**
 * V46h: 批量任务 Word 文档生成器
 * 将 Markdown 文本转换为 Word 文档
 */
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, AlignmentType } from "docx";

/**
 * 清理 Markdown 和 HTML 标记
 */
function cleanMarkdownAndHtml(text: string): string {
  let cleaned = text;
  
  // 移除 HTML 标签
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  
  // 移除 Markdown 粗体/斜体
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
  
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

/**
 * 生成批量任务的 Word 文档
 * @param content Markdown 或纯文本内容
 * @param taskNumber 任务编号
 * @param suggestedFilename 可选的建议文件名（不含扩展名）
 * @returns { buffer: Buffer, filename: string }
 */
export async function generateBatchDocument(
  content: string,
  taskNumber: number,
  suggestedFilename?: string
): Promise<{ buffer: Buffer; filename: string }> {
  // 清理 Markdown 标记
  const cleanedText = cleanMarkdownAndHtml(content);
  const lines = cleanedText.split('\n');
  
  // 生成文件名
  const taskNumStr = formatTaskNumber(taskNumber);
  const filename = suggestedFilename 
    ? `任务${taskNumStr}_${suggestedFilename}.docx`
    : `任务${taskNumStr}_学情反馈.docx`;
  
  // 构建文档内容
  const children: Paragraph[] = [];
  
  // 添加标题
  const title = suggestedFilename || `任务 ${taskNumber} 学情反馈`;
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 32 })],
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
          children: [new TextRun({ text: '答案部分', bold: true, size: 28 })],
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
          children: [new TextRun({ text: trimmedLine, bold: true, size: 26 })],
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
          children: [new TextRun({ text: trimmedLine, bold: true, size: 24 })],
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
          children: [new TextRun({ text: headingText, bold: true, size: fontSize })],
          heading: headingLevel,
          spacing: { before: 200, after: 150 },
        })
      );
      continue;
    }
    
    // 普通段落
    if (trimmedLine) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine, size: 22 })],
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
