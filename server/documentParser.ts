import mammoth from 'mammoth';
import * as pdfParse from 'pdf-parse';

/**
 * 从 Base64 数据中提取文档文字
 * @param base64Data - 纯 base64 字符串（不含 data:xxx;base64, 前缀）
 * @param mimeType - 文件的 MIME 类型
 * @returns 提取的文字内容，失败返回 null
 */
export async function extractTextFromDocument(
  base64Data: string,
  mimeType: string
): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Word 文档
    if (mimeType.includes('wordprocessingml.document') || mimeType.includes('msword')) {
      const result = await mammoth.extractRawText({ buffer });
      console.log('[文档解析] Word文档提取成功，字符数:', result.value.length);
      return result.value;
    }
    
    // PDF 文档
    if (mimeType === 'application/pdf') {
      const result = await pdfParse.default(buffer);
      console.log('[文档解析] PDF提取成功，字符数:', result.text.length);
      return result.text;
    }
    
    console.log('[文档解析] 不支持的文档类型:', mimeType);
    return null;
  } catch (error) {
    console.error('[文档解析] 提取失败:', error);
    return null;
  }
}

/**
 * 判断是否为图片类型
 */
export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * 判断是否为可解析的文档类型
 */
export function isDocumentType(mimeType: string): boolean {
  return (
    mimeType.includes('wordprocessingml.document') ||
    mimeType.includes('msword') ||
    mimeType === 'application/pdf'
  );
}
