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
 * @param filename 文件名（可选，用于根据扩展名判断类型）
 * @returns 提取的纯文本内容
 */
export async function parseDocumentToText(
  buffer: Buffer,
  mimeType: string,
  filename?: string
): Promise<string> {
  // 获取文件扩展名
  const ext = filename ? filename.split('.').pop()?.toLowerCase() : null;
  
  console.log('[DocumentParser] parseDocumentToText 开始');
  console.log('[DocumentParser] mimeType:', mimeType);
  console.log('[DocumentParser] filename:', filename);
  console.log('[DocumentParser] ext:', ext);
  console.log('[DocumentParser] Buffer 大小:', buffer.length, 'bytes');
  
  // 【优先】根据扩展名判断纯文本文件（.md, .txt）
  // 这是为了解决浏览器将 .md 文件识别为 application/octet-stream 的问题
  if (ext === 'md' || ext === 'txt') {
    console.log(`[DocumentParser] 根据扩展名 .${ext} 识别为纯文本文件`);
    const result = buffer.toString('utf-8');
    console.log('[DocumentParser] 纯文本读取成功，长度:', result.length);
    return result;
  }
  
  // 根据 MIME 类型判断纯文本文件
  const isPlainText = mimeType === 'text/markdown' || mimeType === 'text/plain';
  if (isPlainText) {
    console.log(`[DocumentParser] 根据 MIME 类型 ${mimeType} 识别为纯文本文件`);
    const result = buffer.toString('utf-8');
    console.log('[DocumentParser] 纯文本读取成功，长度:', result.length);
    return result;
  }
  
  // PDF 文件
  const isPdf = mimeType === 'application/pdf' || ext === 'pdf';
  if (isPdf) {
    console.log('[DocumentParser] 识别为 PDF 文件');
    return parsePdfToText(buffer);
  }
  
  // DOCX 文件（注意：只有扩展名也是 .docx 时才当作 DOCX 处理）
  const isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
    || (mimeType === 'application/octet-stream' && ext === 'docx');
  if (isDocx) {
    console.log('[DocumentParser] 识别为 DOCX 文件');
    return parseDocxToText(buffer);
  }
  
  console.warn(`[DocumentParser] 不支持的文件类型: mimeType=${mimeType}, filename=${filename}, ext=${ext}`);
  return '';
}

/**
 * 检查是否为可解析的文档类型
 * @param mimeType 文件的 MIME 类型
 * @returns 是否可解析
 */
export function isParseableDocument(mimeType: string): boolean {
  const supportedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream', // DOCX 有时被识别为这个类型
    'text/markdown',  // .md 文件
    'text/plain',     // .txt 文件
  ];
  
  return supportedTypes.includes(mimeType);
}
