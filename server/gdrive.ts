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
 * @param content 文件内容
 * @param fileName 文件名
 * @param folderPath Google Drive中的文件夹路径
 * @returns 上传结果，包含URL和路径
 */
export async function uploadToGoogleDrive(
  content: string,
  fileName: string,
  folderPath: string
): Promise<{ url: string; path: string }> {
  // 创建临时文件
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, fileName);
  
  try {
    // 写入临时文件
    await fs.promises.writeFile(tempFilePath, content, "utf-8");
    
    // 确保目标文件夹存在
    const mkdirCmd = `rclone mkdir "${REMOTE_NAME}:${folderPath}" --config ${RCLONE_CONFIG}`;
    await execAsync(mkdirCmd);
    
    // 上传文件
    const copyCmd = `rclone copy "${tempFilePath}" "${REMOTE_NAME}:${folderPath}/" --config ${RCLONE_CONFIG}`;
    await execAsync(copyCmd);
    
    // 获取分享链接
    const fullPath = `${folderPath}/${fileName}`;
    const linkCmd = `rclone link "${REMOTE_NAME}:${fullPath}" --config ${RCLONE_CONFIG}`;
    const { stdout } = await execAsync(linkCmd);
    const url = stdout.trim();
    
    return {
      url,
      path: fullPath,
    };
  } finally {
    // 清理临时文件
    try {
      await fs.promises.unlink(tempFilePath);
    } catch {
      // 忽略清理错误
    }
  }
}
