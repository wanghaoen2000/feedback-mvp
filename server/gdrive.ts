import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getValidToken, isAuthorized } from "./googleAuth";

const execAsync = promisify(exec);

const RCLONE_CONFIG = "/home/ubuntu/.gdrive-rclone.ini";
const REMOTE_NAME = "manus_google_drive";

// Google Drive API端点
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

/** Google Drive API fetch with timeout protection (default 60s, uploads 120s) */
async function gdriveFetch(url: string, options?: RequestInit, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Google Drive API 请求超时 (${timeoutMs / 1000}秒)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface UploadStatus {
  fileName: string;
  status: 'pending' | 'uploading' | 'verifying' | 'success' | 'error';
  message?: string;
  error?: string;
  url?: string;
  path?: string;
  folderUrl?: string;
  verified?: boolean;
  fileSize?: number;
}

/**
 * 验证文件是否存在于Google Drive（通过 OAuth API）
 */
export async function verifyFileExists(filePath: string): Promise<{ exists: boolean; size?: number }> {
  try {
    const token = await getValidToken();
    if (!token) return { exists: false };

    const parts = filePath.split('/').filter(p => p);
    const fileName = parts.pop();
    if (!fileName) return { exists: false };

    const folderPath = parts.join('/');
    const folderId = folderPath ? await navigateToFolder(folderPath, token) : 'root';
    if (!folderId) return { exists: false };

    const q = `name='${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
    const searchUrl = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,size)&pageSize=1`;
    const res = await gdriveFetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { exists: false };
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      const size = data.files[0].size ? parseInt(data.files[0].size, 10) : undefined;
      return { exists: true, size };
    }
    return { exists: false };
  } catch {
    return { exists: false };
  }
}

/**
 * 并发去重：同一路径的文件夹创建请求共享同一个 Promise，
 * 避免并行上传时 Google Drive 创建多个同名文件夹
 */
const pendingFolderOps = new Map<string, Promise<string>>();

export async function getOrCreateFolderWithOAuth(folderPath: string, token: string): Promise<string> {
  const cacheKey = `${folderPath}::${token}`;
  const pending = pendingFolderOps.get(cacheKey);
  if (pending) {
    return pending;
  }

  const operation = _getOrCreateFolderWithOAuth(folderPath, token);
  pendingFolderOps.set(cacheKey, operation);

  try {
    return await operation;
  } finally {
    pendingFolderOps.delete(cacheKey);
  }
}

async function _getOrCreateFolderWithOAuth(folderPath: string, token: string): Promise<string> {
  const parts = folderPath.split('/').filter(p => p);
  let parentId = 'root';
  
  for (const folderName of parts) {
    // 查找文件夹是否存在
    const searchUrl = `${DRIVE_API_BASE}/files?q=name='${encodeURIComponent(folderName)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`;
    const searchRes = await gdriveFetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!searchRes.ok) {
      throw new Error(`查找文件夹失败: ${searchRes.status}`);
    }

    const searchData = await searchRes.json();

    if (searchData.files && searchData.files.length > 0) {
      parentId = searchData.files[0].id;
    } else {
      // 创建文件夹
      const createRes = await gdriveFetch(`${DRIVE_API_BASE}/files`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        }),
      });
      
      if (!createRes.ok) {
        throw new Error(`创建文件夹失败: ${createRes.status}`);
      }
      
      const createData = await createRes.json();
      parentId = createData.id;
    }
  }
  
  return parentId;
}

/**
 * 使用OAuth上传文件到Google Drive
 */
async function uploadFileWithOAuth(
  content: string | Buffer,
  fileName: string,
  folderId: string,
  token: string
): Promise<{ id: string; webViewLink: string }> {
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  
  const metadata = {
    name: fileName,
    parents: [folderId],
  };
  
  const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  const mimeType = fileName.endsWith('.png') ? 'image/png' 
    : fileName.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'text/plain';
  
  const multipartBody = Buffer.concat([
    Buffer.from(delimiter + 'Content-Type: application/json\r\n\r\n' + JSON.stringify(metadata)),
    Buffer.from(delimiter + `Content-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`),
    Buffer.from(contentBuffer.toString('base64')),
    Buffer.from(closeDelimiter),
  ]);
  
  const uploadRes = await gdriveFetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  }, 120_000); // 上传使用 120 秒超时
  
  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`上传失败: ${uploadRes.status} - ${errorText}`);
  }
  
  return await uploadRes.json();
}

/**
 * 带重试机制的上传函数
 */
async function uploadWithRetry<T>(
  uploadFn: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 2000,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadFn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`[上传重试] 第${attempt}次尝试失败: ${lastError.message}`);
      
      if (attempt < maxRetries) {
        if (onRetry) {
          onRetry(attempt, lastError);
        }
        console.log(`[上传重试] ${retryDelay/1000}秒后进行第${attempt + 1}次尝试...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  
  throw lastError || new Error('上传失败');
}

/**
 * 上传文件到Google Drive（带状态回调和重试机制）
 * 优先使用OAuth，如果没有OAuth token则fallback到rclone
 */
export async function uploadToGoogleDrive(
  content: string,
  fileName: string,
  folderPath: string,
  onStatus?: (status: UploadStatus) => void,
  maxRetries: number = 3
): Promise<UploadStatus> {
  const status: UploadStatus = {
    fileName,
    status: 'pending',
  };

  const updateStatus = (updates: Partial<UploadStatus>) => {
    Object.assign(status, updates);
    if (onStatus) onStatus({ ...status });
  };

  // 尝试使用OAuth上传（带重试，防止网络抖动导致一次性失败）
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const token = await getValidToken();
      if (!token) break; // 无token，跳到rclone

      console.log(`[GDrive] 使用OAuth上传: ${fileName}${attempt > 0 ? ` (第${attempt + 1}次)` : ''}`);
      updateStatus({ status: 'uploading', message: '正在使用OAuth创建文件夹...' });

      const folderId = await getOrCreateFolderWithOAuth(folderPath, token);

      updateStatus({ message: '正在上传文件...' });
      const result = await uploadFileWithOAuth(content, fileName, folderId, token);

      const fullPath = `${folderPath}/${fileName}`;
      updateStatus({
        status: 'success',
        message: '上传成功',
        url: result.webViewLink,
        path: fullPath,
        verified: true,
      });

      return status;
    } catch (oauthError: any) {
      if (attempt < maxRetries - 1) {
        const delay = 2000 * (attempt + 1);
        console.log(`[GDrive] OAuth上传失败(第${attempt + 1}次)，${delay / 1000}秒后重试: ${oauthError?.message || oauthError}`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.log(`[GDrive] OAuth上传失败(${maxRetries}次尝试): ${oauthError?.message || oauthError}`);
      }
    }
  }

  // Fallback到rclone
  console.log(`[GDrive] 使用rclone上传: ${fileName}`);
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, fileName);
  
  // 内部上传函数（用于重试）
  const doUpload = async (): Promise<UploadStatus> => {
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
      throw new Error('文件上传后验证失败，文件可能未成功保存');
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
  };
  
  try {
    // 使用重试机制执行上传
    await uploadWithRetry(
      doUpload,
      maxRetries,
      2000,
      (attempt, error) => {
        console.log(`[上传重试] ${fileName}: 第${attempt}次失败 - ${error.message}`);
        updateStatus({ message: `上传失败，正在重试(${attempt}/${maxRetries})...` });
      }
    );
    return status;
  } catch (err) {
    updateStatus({
      status: 'error',
      error: err instanceof Error ? err.message : '上传失败（已重试' + maxRetries + '次）',
      verified: false,
    });
    return status;
  } finally {
    try {
      await fs.promises.unlink(tempFilePath);
    } catch (e) {
      console.warn(`[GDrive] 临时文件清理失败: ${tempFilePath}`, e);
    }
  }
}

/**
 * 上传二进制文件到Google Drive（带状态回调和重试机制）
 * 优先使用OAuth，如果没有OAuth token则fallback到rclone
 */
export async function uploadBinaryToGoogleDrive(
  content: Buffer,
  fileName: string,
  folderPath: string,
  onStatus?: (status: UploadStatus) => void,
  maxRetries: number = 3
): Promise<UploadStatus> {
  const status: UploadStatus = {
    fileName,
    status: 'pending',
  };

  const updateStatus = (updates: Partial<UploadStatus>) => {
    Object.assign(status, updates);
    if (onStatus) onStatus({ ...status });
  };

  // 尝试使用OAuth上传（带重试，防止网络抖动导致一次性失败）
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const token = await getValidToken();
      if (!token) break; // 无token，跳到rclone

      console.log(`[GDrive] 使用OAuth上传二进制文件: ${fileName}${attempt > 0 ? ` (第${attempt + 1}次)` : ''}`);
      updateStatus({ status: 'uploading', message: '正在使用OAuth创建文件夹...' });

      const folderId = await getOrCreateFolderWithOAuth(folderPath, token);

      updateStatus({ message: '正在上传文件...' });
      const result = await uploadFileWithOAuth(content, fileName, folderId, token);

      const fullPath = `${folderPath}/${fileName}`;
      updateStatus({
        status: 'success',
        message: '上传成功',
        url: result.webViewLink,
        path: fullPath,
        verified: true,
      });

      return status;
    } catch (oauthError: any) {
      if (attempt < maxRetries - 1) {
        const delay = 2000 * (attempt + 1);
        console.log(`[GDrive] OAuth上传二进制失败(第${attempt + 1}次)，${delay / 1000}秒后重试: ${oauthError?.message || oauthError}`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.log(`[GDrive] OAuth上传二进制失败(${maxRetries}次尝试): ${oauthError?.message || oauthError}`);
      }
    }
  }

  // Fallback到rclone
  console.log(`[GDrive] 使用rclone上传二进制文件: ${fileName}`);
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, fileName);
  
  // 内部上传函数（用于重试）
  const doUpload = async (): Promise<UploadStatus> => {
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
      throw new Error('文件上传后验证失败，文件可能未成功保存');
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
  };
  
  try {
    // 使用重试机制执行上传
    await uploadWithRetry(
      doUpload,
      maxRetries,
      2000,
      (attempt, error) => {
        console.log(`[上传重试] ${fileName}: 第${attempt}次失败 - ${error.message}`);
        updateStatus({ message: `上传失败，正在重试(${attempt}/${maxRetries})...` });
      }
    );
    return status;
  } catch (err) {
    updateStatus({
      status: 'error',
      error: err instanceof Error ? err.message : '上传失败（已重试' + maxRetries + '次）',
      verified: false,
    });
    return status;
  } finally {
    try {
      await fs.promises.unlink(tempFilePath);
    } catch (e) {
      console.warn(`[GDrive] 临时文件清理失败: ${tempFilePath}`, e);
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


/**
 * 预创建 Google Drive 文件夹（用于批量任务开始前）
 * 确保文件夹存在，避免并发创建时的竞争条件
 */
export async function ensureFolderExists(folderPath: string): Promise<{ success: boolean; folderId?: string; error?: string }> {
  try {
    // 尝试使用 OAuth
    const token = await getValidToken();
    if (token) {
      console.log(`[GDrive] 使用OAuth预创建文件夹: ${folderPath}`);
      const folderId = await getOrCreateFolderWithOAuth(folderPath, token);
      console.log(`[GDrive] 文件夹创建成功，ID: ${folderId}`);
      return { success: true, folderId };
    }
  } catch (oauthError) {
    console.log(`[GDrive] OAuth创建文件夹失败，尝试rclone: ${oauthError}`);
  }

  // Fallback 到 rclone
  try {
    console.log(`[GDrive] 使用rclone预创建文件夹: ${folderPath}`);
    const mkdirCmd = `rclone mkdir "${REMOTE_NAME}:${folderPath}" --config ${RCLONE_CONFIG}`;
    await execAsync(mkdirCmd);
    console.log(`[GDrive] 文件夹创建成功（rclone）`);
    return { success: true };
  } catch (rcloneError) {
    const errorMsg = rcloneError instanceof Error ? rcloneError.message : String(rcloneError);
    console.error(`[GDrive] 创建文件夹失败: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * 通过 OAuth API 按路径导航到指定文件夹，返回其 ID
 * @param folderPath 如 "Mac(online)/Documents/XDF/学生档案/孙浩然/学情反馈"
 * @param token OAuth access token
 * @returns 文件夹 ID，找不到返回 null
 */
async function navigateToFolder(folderPath: string, token: string): Promise<string | null> {
  const parts = folderPath.split('/').filter(p => p);
  let parentId = 'root';

  for (const folderName of parts) {
    const q = `name='${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchUrl = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
    const res = await gdriveFetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`[GDrive导航] 查找文件夹 "${folderName}" 失败: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data.files || data.files.length === 0) {
      console.warn(`[GDrive导航] 文件夹 "${folderName}" 不存在 (parent=${parentId})`);
      return null;
    }
    parentId = data.files[0].id;
  }
  return parentId;
}

/**
 * 通过 OAuth API 下载文件内容
 */
async function downloadFileById(fileId: string, token: string): Promise<Buffer> {
  // 先获取文件元数据，判断是否为 Google Docs 类型（需要 export）
  const metaUrl = `${DRIVE_API_BASE}/files/${fileId}?fields=mimeType,name`;
  const metaRes = await gdriveFetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!metaRes.ok) throw new Error(`获取文件元数据失败: ${metaRes.status}`);
  const meta = await metaRes.json();

  let downloadRes: Response;
  if (meta.mimeType === 'application/vnd.google-apps.document') {
    // Google Docs 需要通过 export 下载
    const exportUrl = `${DRIVE_API_BASE}/files/${fileId}/export?mimeType=text/plain`;
    downloadRes = await gdriveFetch(exportUrl, { headers: { Authorization: `Bearer ${token}` } }, 120_000);
  } else {
    const downloadUrl = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
    downloadRes = await gdriveFetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } }, 120_000);
  }

  if (!downloadRes.ok) throw new Error(`下载文件失败: ${downloadRes.status}`);
  const arrayBuffer = await downloadRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * 从 Google Drive 读取文件内容（通过 OAuth API 按路径定位）
 * @param filePath Google Drive 上的文件路径，如 "Mac(online)/Documents/XDF/学生档案/孙浩然/学情反馈/孙浩然11.md"
 * @returns 文件内容的 Buffer
 */
export async function readFileFromGoogleDrive(filePath: string): Promise<Buffer> {
  const token = await getValidToken();
  if (!token) {
    throw new Error('未授权 Google Drive，请先在设置中完成 OAuth 授权');
  }

  const parts = filePath.split('/').filter(p => p);
  const fileName = parts.pop();
  if (!fileName) throw new Error('文件路径无效');

  const folderPath = parts.join('/');
  const folderId = folderPath ? await navigateToFolder(folderPath, token) : 'root';
  if (!folderId) {
    throw new Error(`文件夹不存在: ${folderPath}`);
  }

  // 在目标文件夹中查找文件
  const q = `name='${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
  const searchUrl = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=1`;
  const res = await gdriveFetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`查找文件失败: ${res.status}`);
  const data = await res.json();
  if (!data.files || data.files.length === 0) {
    throw new Error(`文件不存在: ${fileName}`);
  }

  return downloadFileById(data.files[0].id, token);
}

/**
 * 在 Google Drive 中搜索文件（通过 OAuth API）
 * 策略：先在指定目录搜索，找不到再全局按文件名搜索
 * @param fileNames 要搜索的文件名列表（按优先级排序，找到第一个即返回）
 * @param searchDir 优先搜索的目录路径（可选）
 * @returns { fullPath, buffer } 或 null
 */
export async function searchFileInGoogleDrive(
  fileNames: string[],
  searchDir?: string
): Promise<{ fullPath: string; buffer: Buffer } | null> {
  const token = await getValidToken();
  if (!token) {
    console.error('[GDrive搜索] 未授权 Google Drive');
    return null;
  }

  // 阶段1：在指定目录中精确查找（如果提供了 searchDir）
  if (searchDir) {
    const folderId = await navigateToFolder(searchDir, token);
    if (folderId) {
      for (const fileName of fileNames) {
        try {
          const q = `name='${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
          const searchUrl = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
          const res = await gdriveFetch(searchUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) continue;
          const data = await res.json();
          if (data.files && data.files.length > 0) {
            const file = data.files[0];
            console.log(`[GDrive搜索] 在指定目录找到: ${searchDir}/${file.name}`);
            const buffer = await downloadFileById(file.id, token);
            return { fullPath: `${searchDir}/${file.name}`, buffer };
          }
        } catch (err) {
          console.warn(`[GDrive搜索] 目录搜索 "${fileName}" 失败:`, err);
        }
      }
    }
    console.log(`[GDrive搜索] 指定目录 ${searchDir} 未找到匹配文件，尝试全局搜索...`);
  }

  // 阶段2：全局按文件名搜索（不限定文件夹）
  for (const fileName of fileNames) {
    try {
      const q = `name='${fileName.replace(/'/g, "\\'")}' and trashed=false`;
      const searchUrl = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)&pageSize=5`;
      const res = await gdriveFetch(searchUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.files && data.files.length > 0) {
        const file = data.files[0];
        console.log(`[GDrive搜索] 全局搜索找到: ${file.name} (id=${file.id})`);
        const buffer = await downloadFileById(file.id, token);
        return { fullPath: file.name, buffer };
      }
    } catch (err) {
      console.warn(`[GDrive搜索] 全局搜索 "${fileName}" 失败:`, err);
    }
  }

  return null;
}
