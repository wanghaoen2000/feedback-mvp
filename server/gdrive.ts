import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

const RCLONE_CONFIG = "/home/ubuntu/.gdrive-rclone.ini";
const REMOTE_NAME = "manus_google_drive";

/**
 * 上传文件到Google Drive
 */
export async function uploadToGoogleDrive(
  content: string,
  fileName: string,
  folderPath: string
): Promise<{ url: string; path: string }> {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, fileName);
  
  try {
    await fs.promises.writeFile(tempFilePath, content, "utf-8");
    
    const mkdirCmd = `rclone mkdir "${REMOTE_NAME}:${folderPath}" --config ${RCLONE_CONFIG}`;
    await execAsync(mkdirCmd);
    
    const copyCmd = `rclone copy "${tempFilePath}" "${REMOTE_NAME}:${folderPath}/" --config ${RCLONE_CONFIG}`;
    await execAsync(copyCmd);
    
    const fullPath = `${folderPath}/${fileName}`;
    const linkCmd = `rclone link "${REMOTE_NAME}:${fullPath}" --config ${RCLONE_CONFIG}`;
    const { stdout } = await execAsync(linkCmd);
    const url = stdout.trim();
    
    return {
      url,
      path: fullPath,
    };
  } finally {
    try {
      await fs.promises.unlink(tempFilePath);
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 上传二进制文件到Google Drive
 */
export async function uploadBinaryToGoogleDrive(
  content: Buffer,
  fileName: string,
  folderPath: string
): Promise<{ url: string; path: string }> {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, fileName);
  
  try {
    await fs.promises.writeFile(tempFilePath, content);
    
    const mkdirCmd = `rclone mkdir "${REMOTE_NAME}:${folderPath}" --config ${RCLONE_CONFIG}`;
    await execAsync(mkdirCmd);
    
    const copyCmd = `rclone copy "${tempFilePath}" "${REMOTE_NAME}:${folderPath}/" --config ${RCLONE_CONFIG}`;
    await execAsync(copyCmd);
    
    const fullPath = `${folderPath}/${fileName}`;
    const linkCmd = `rclone link "${REMOTE_NAME}:${fullPath}" --config ${RCLONE_CONFIG}`;
    const { stdout } = await execAsync(linkCmd);
    const url = stdout.trim();
    
    return {
      url,
      path: fullPath,
    };
  } finally {
    try {
      await fs.promises.unlink(tempFilePath);
    } catch {
      // 忽略清理错误
    }
  }
}

interface FileUploadItem {
  content: string | Buffer;
  fileName: string;
  folderPath: string;
  isBinary?: boolean;
}

interface UploadResult {
  fileName: string;
  url: string;
  path: string;
  folderUrl?: string;
}

/**
 * 批量上传多个文件到Google Drive
 */
export async function uploadMultipleFiles(
  files: FileUploadItem[]
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  
  for (const file of files) {
    try {
      let result;
      if (file.isBinary && Buffer.isBuffer(file.content)) {
        result = await uploadBinaryToGoogleDrive(file.content, file.fileName, file.folderPath);
      } else {
        const contentStr = typeof file.content === 'string' ? file.content : file.content.toString('utf-8');
        result = await uploadToGoogleDrive(contentStr, file.fileName, file.folderPath);
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
        url: result.url,
        path: result.path,
        folderUrl,
      });
    } catch (error) {
      console.error(`上传文件 ${file.fileName} 失败:`, error);
      results.push({
        fileName: file.fileName,
        url: "",
        path: "",
      });
    }
  }
  
  return results;
}
