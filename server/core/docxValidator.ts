/**
 * DOCX 文件验证模块
 * 验证生成的 Word 文件是否有效
 */

import * as fs from 'fs';
import AdmZip from 'adm-zip';

// 验证结果
export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: {
    exists: boolean;
    size?: number;
    sizeOK?: boolean;
    structureOK?: boolean;
  };
}

// 验证配置
export interface ValidationConfig {
  minSize?: number;        // 最小文件大小（字节），默认 1000 (1KB)
  checkStructure?: boolean; // 是否检查docx结构，默认 false
}

// docx 必须包含的文件
const REQUIRED_DOCX_FILES = [
  '[Content_Types].xml',
  'word/document.xml',
];

/**
 * 验证 docx 文件结构
 * @param filePath - 文件路径
 * @returns 验证结果
 */
export function validateDocxStructure(filePath: string): ValidationResult {
  const details: ValidationResult['details'] = {
    exists: true,
    structureOK: false,
  };

  try {
    // 尝试作为 zip 打开
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries().map(e => e.entryName);
    
    // 检查必要文件
    const missingFiles: string[] = [];
    for (const required of REQUIRED_DOCX_FILES) {
      if (!entries.includes(required)) {
        missingFiles.push(required);
      }
    }
    
    if (missingFiles.length > 0) {
      return {
        valid: false,
        error: `docx 结构不完整，缺少必要文件: ${missingFiles.join(', ')}`,
        details: {
          ...details,
          structureOK: false,
        }
      };
    }
    
    // 尝试读取 document.xml 验证内容
    const documentEntry = zip.getEntry('word/document.xml');
    if (documentEntry) {
      const content = documentEntry.getData().toString('utf8');
      
      // 检查是否包含基本的 XML 结构
      if (!content.includes('<?xml') && !content.includes('<w:document')) {
        return {
          valid: false,
          error: 'word/document.xml 内容无效，不是有效的 XML',
          details: {
            ...details,
            structureOK: false,
          }
        };
      }
    }
    
    details.structureOK = true;
    return {
      valid: true,
      details
    };
    
  } catch (err: any) {
    // zip 解析失败，说明文件损坏
    return {
      valid: false,
      error: `无法解析 docx 文件结构: ${err.message}`,
      details: {
        ...details,
        structureOK: false,
      }
    };
  }
}

/**
 * 验证 docx 文件
 * @param filePath - 文件路径
 * @param config - 验证配置
 */
export function validateDocx(
  filePath: string,
  config: ValidationConfig = {}
): ValidationResult {
  const minSize = config.minSize ?? 1000;  // 默认最小 1KB
  
  const details: ValidationResult['details'] = {
    exists: false,
  };

  // 1. 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      error: `文件不存在: ${filePath}`,
      details
    };
  }
  details.exists = true;

  // 2. 检查文件大小
  try {
    const stats = fs.statSync(filePath);
    details.size = stats.size;
    details.sizeOK = stats.size >= minSize;
    
    if (!details.sizeOK) {
      return {
        valid: false,
        error: `文件过小 (${stats.size} 字节)，可能是空文件或损坏。最小要求: ${minSize} 字节`,
        details
      };
    }
  } catch (err: any) {
    return {
      valid: false,
      error: `无法读取文件信息: ${err.message}`,
      details
    };
  }

  // 3. 结构检查（如果启用）
  if (config.checkStructure) {
    const structureResult = validateDocxStructure(filePath);
    if (!structureResult.valid) {
      return {
        valid: false,
        error: structureResult.error,
        details: {
          ...details,
          structureOK: false,
        }
      };
    }
    details.structureOK = true;
  }

  return {
    valid: true,
    details
  };
}

/**
 * 快速检查文件是否存在且非空
 * 简化版验证，用于快速判断
 */
export function quickCheck(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    const stats = fs.statSync(filePath);
    return stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * 获取文件大小（字节）
 * 文件不存在返回 -1
 */
export function getFileSize(filePath: string): number {
  try {
    if (!fs.existsSync(filePath)) {
      return -1;
    }
    return fs.statSync(filePath).size;
  } catch {
    return -1;
  }
}

/**
 * 格式化文件大小为可读字符串
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 0) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 获取 docx 内部文件列表（用于调试）
 */
export function listDocxContents(filePath: string): string[] | null {
  try {
    const zip = new AdmZip(filePath);
    return zip.getEntries().map(e => e.entryName);
  } catch {
    return null;
  }
}
