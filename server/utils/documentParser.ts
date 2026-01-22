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
    // pdf-parse v2 API: 使用 data 参数传入 buffer
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text?.trim() || '';
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
  // 根据 MIME 类型或文件扩展名判断
  const isPdf = mimeType === 'application/pdf';
  const isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
    || mimeType === 'application/octet-stream'; // DOCX 有时被识别为 octet-stream
  
  if (isPdf) {
    return parsePdfToText(buffer);
  } else if (isDocx) {
    return parseDocxToText(buffer);
  }
  
  // 纯文本文件（.md, .txt）直接读取
  const isPlainText = mimeType === 'text/markdown' || mimeType === 'text/plain';
  if (isPlainText) {
    return buffer.toString('utf-8');
  }
  
  console.warn(`[DocumentParser] 不支持的文件类型: ${mimeType}`);
  return '';
}

/**
 * 检查是否为可解析的文档类型
 * @param mimeType 文件的 MIME 类型
 * @returns 是否可解析
 */
export function isParseableDocument(mimeType: string): boolean {
  return [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream', // DOCX 有时被识别为这个类型
    'text/markdown',  // .md 文件
    'text/plain',     // .txt 文件
  ].includes(mimeType);
}
