/**
 * 文档解析工具
 * 将 PDF/DOCX 文档转换为纯文本
 */

import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

/**
 * 解析 PDF 文档，返回纯文本
 * @param buffer PDF 文件的 Buffer
 * @returns 提取的纯文本内容
 */
export async function parsePdfToText(buffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse();
    const data = await parser.loadPDF(buffer);
    // 提取所有页面的文本
    let text = '';
    for (let i = 1; i <= data.numPages; i++) {
      const page = await data.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      text += pageText + '\n';
    }
    return text.trim();
  } catch (error) {
    console.warn('[DocumentParser] PDF 解析失败:', error);
    return '';
  }
}

/**
 * 解析 Word 文档，返回纯文本
 * @param buffer DOCX 文件的 Buffer
 * @returns 提取的纯文本内容
 */
export async function parseDocxToText(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (error) {
    console.warn('[DocumentParser] DOCX 解析失败:', error);
    return '';
  }
}

/**
 * 统一入口：根据 mimeType 自动选择解析器
 * @param buffer 文件的 Buffer
 * @param mimeType 文件的 MIME 类型
 * @returns 提取的纯文本内容
 */
export async function parseDocumentToText(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  switch (mimeType) {
    case 'application/pdf':
      return parsePdfToText(buffer);
    
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return parseDocxToText(buffer);
    
    default:
      console.warn(`[DocumentParser] 不支持的文件类型: ${mimeType}`);
      return '';
  }
}

/**
 * 检查是否为可解析的文档类型
 * @param mimeType 文件的 MIME 类型
 * @returns 是否可解析
 */
export function isParseableDocument(mimeType: string): boolean {
  return [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ].includes(mimeType);
}
