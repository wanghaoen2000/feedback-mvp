import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

const RCLONE_CONFIG = "/home/ubuntu/.gdrive-rclone.ini";
const REMOTE_NAME = "manus_google_drive";

export interface UploadStatus {
  fileName: string;
  status: 'pending' | 'uploading' | 'verifying' | 'success' | 'error';
  message?: string;
  error?: string;
  url?: string;
  path?: string;
  verified?: boolean;
  fileSize?: number;
}

/**
 * 验证文件是否存在于Google Drive
 */
export async function verifyFileExists(filePath: string): Promise<{ exists: boolean; size?: number }> {
  try {
    const lsCmd = `rclone ls "${REMOTE_NAME}:${filePath}" --config ${RCLONE_CONFIG}`;
    const { stdout } = await execAsync(lsCmd);
    if (stdout.trim()) {
      const match = stdout.trim().match(/^\s*(\d+)/);
      const size = match ? parseInt(match[1], 10) : undefined;
      return { exists: true, size };
    }
    return { exists: false };
  } catch {
    return { exists: false };
  }
}

/**
 * 上传文件到Google Drive（带状态回调）
 */
export async function uploadToGoogleDrive(
  content: string,
  fileName: string,
  folderPath: string,
  onStatus?: (status: UploadStatus) => void
): Promise<UploadStatus> {
  const status: UploadStatus = {
    fileName,
    status: 'pending',
  };

  const updateStatus = (updates: Partial<UploadStatus>) => {
    Object.assign(status, updates);
    if (onStatus) onStatus({ ...status });
  };

  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, fileName);
  
  try {
    updateStatus({ status: 'uploading', message: '正在创建文件夹...' });
    await fs.promises.writeFile(tempFilePath, content, "utf-8");
    
    const mkdirCmd = `rclone mkdir "${REMOTE_NAME}:${folderPath}" --config ${RCLONE_CONFIG}`;
    await execAsync(mkdirCmd);
    
    updateStatus({ message: '正在上传文件...' });
    const copyCmd = `rclone copy "${tempFilePath}" "${REMOTE_NAME}:${folderPath}/" --config ${RCLONE_CONFIG}`;
    await execAsync(copyCmd);
    
    const fullPath = `${folderPath}/${fileName}`;
    
    updateStatus({ status: 'verifying', message: '正在验证文件...' });
    const verification = await verifyFileExists(fullPath);
    
    if (!verification.exists) {
      updateStatus({ 
        status: 'error', 
        error: '文件上传后验证失败，文件可能未成功保存',
        verified: false 
      });
      return status;
    }
    
    updateStatus({ message: '正在获取分享链接...' });
    const linkCmd = `rclone link "${REMOTE_NAME}:${fullPath}" --config ${RCLONE_CONFIG}`;
    const { stdout } = await execAsync(linkCmd);
    const url = stdout.trim();
    
    updateStatus({
      status: 'success',
      message: '上传成功',
      url,
      path: fullPath,
      verified: true,
      fileSize: verification.size,
    });
    
    return status;
  } catch (err) {
    updateStatus({
      status: 'error',
      error: err instanceof Error ? err.message : '上传失败',
      verified: false,
    });
    return status;
  } finally {
    try {
      await fs.promises.unlink(tempFilePath);
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 上传二进制文件到Google Drive（带状态回调）
 */
export async function uploadBinaryToGoogleDrive(
  content: Buffer,
  fileName: string,
  folderPath: string,
  onStatus?: (status: UploadStatus) => void
): Promise<UploadStatus> {
  const status: UploadStatus = {
    fileName,
    status: 'pending',
  };

  const updateStatus = (updates: Partial<UploadStatus>) => {
    Object.assign(status, updates);
    if (onStatus) onStatus({ ...status });
  };

  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, fileName);
  
  try {
    updateStatus({ status: 'uploading', message: '正在创建文件夹...' });
    await fs.promises.writeFile(tempFilePath, content);
    
    const mkdirCmd = `rclone mkdir "${REMOTE_NAME}:${folderPath}" --config ${RCLONE_CONFIG}`;
    await execAsync(mkdirCmd);
    
    updateStatus({ message: '正在上传文件...' });
    const copyCmd = `rclone copy "${tempFilePath}" "${REMOTE_NAME}:${folderPath}/" --config ${RCLONE_CONFIG}`;
    await execAsync(copyCmd);
    
    const fullPath = `${folderPath}/${fileName}`;
    
    updateStatus({ status: 'verifying', message: '正在验证文件...' });
    const verification = await verifyFileExists(fullPath);
    
    if (!verification.exists) {
      updateStatus({ 
        status: 'error', 
        error: '文件上传后验证失败，文件可能未成功保存',
        verified: false 
      });
      return status;
    }
    
    updateStatus({ message: '正在获取分享链接...' });
    const linkCmd = `rclone link "${REMOTE_NAME}:${fullPath}" --config ${RCLONE_CONFIG}`;
    const { stdout } = await execAsync(linkCmd);
    const url = stdout.trim();
    
    updateStatus({
      status: 'success',
      message: '上传成功',
      url,
      path: fullPath,
      verified: true,
      fileSize: verification.size,
    });
    
    return status;
  } catch (err) {
    updateStatus({
      status: 'error',
      error: err instanceof Error ? err.message : '上传失败',
      verified: false,
    });
    return status;
  } finally {
    try {
      await fs.promises.unlink(tempFilePath);
    } catch {
      // 忽略清理错误
    }
  }
}

export interface FileUploadItem {
  content: string | Buffer;
  fileName: string;
  folderPath: string;
  isBinary?: boolean;
}

export interface UploadResult {
  fileName: string;
  url: string;
  path: string;
  folderUrl?: string;
  status: 'success' | 'error';
  error?: string;
  verified: boolean;
  fileSize?: number;
}

/**
 * 批量上传多个文件到Google Drive（带状态回调）
 */
export async function uploadMultipleFiles(
  files: FileUploadItem[],
  onProgress?: (fileName: string, status: UploadStatus) => void
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  
  for (const file of files) {
    const statusCallback = onProgress 
      ? (status: UploadStatus) => onProgress(file.fileName, status)
      : undefined;

    try {
      let uploadStatus: UploadStatus;
      if (file.isBinary && Buffer.isBuffer(file.content)) {
        uploadStatus = await uploadBinaryToGoogleDrive(file.content, file.fileName, file.folderPath, statusCallback);
      } else {
        const contentStr = typeof file.content === 'string' ? file.content : file.content.toString('utf-8');
        uploadStatus = await uploadToGoogleDrive(contentStr, file.fileName, file.folderPath, statusCallback);
      }
      
      // 获取文件夹链接
      let folderUrl = "";
      try {
        const folderLinkCmd = `rclone link "${REMOTE_NAME}:${file.folderPath}" --config ${RCLONE_CONFIG}`;
        const { stdout } = await execAsync(folderLinkCmd);
        folderUrl = stdout.trim();
      } catch {
        // 文件夹链接获取失败不影响主流程
      }
      
      results.push({
        fileName: file.fileName,
        url: uploadStatus.url || "",
        path: uploadStatus.path || "",
        folderUrl,
        status: uploadStatus.status === 'success' ? 'success' : 'error',
        error: uploadStatus.error,
        verified: uploadStatus.verified || false,
        fileSize: uploadStatus.fileSize,
      });
    } catch (error) {
      console.error(`上传文件 ${file.fileName} 失败:`, error);
      results.push({
        fileName: file.fileName,
        url: "",
        path: "",
        status: 'error',
        error: error instanceof Error ? error.message : '上传失败',
        verified: false,
      });
    }
  }
  
  return results;
}

/**
 * 验证多个文件是否都存在
 */
export async function verifyAllFiles(filePaths: string[]): Promise<{
  allExist: boolean;
  results: Array<{ path: string; exists: boolean; size?: number }>;
}> {
  const results = await Promise.all(
    filePaths.map(async (filePath) => {
      const verification = await verifyFileExists(filePath);
      return { path: filePath, ...verification };
    })
  );
  
  return {
    allExist: results.every(r => r.exists),
    results,
  };
}
