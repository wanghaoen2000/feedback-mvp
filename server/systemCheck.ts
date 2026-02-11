import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { getDb } from "./db";
import { systemConfig, googleTokens } from "../drizzle/schema";
import { isAuthorized as isOAuthAuthorized, getValidToken } from "./googleAuth";
import { DEFAULT_CONFIG } from "./core/aiClient";

const execAsync = promisify(exec);

const RCLONE_CONFIG = "/home/ubuntu/.gdrive-rclone.ini";
const REMOTE_NAME = "manus_google_drive";

export interface CheckResult {
  name: string;
  status: 'success' | 'error' | 'skipped' | 'pending';
  message: string;
  suggestion?: string;
}

export interface SystemCheckResults {
  results: CheckResult[];
  passed: number;
  total: number;
  allPassed: boolean;
}

/**
 * 1. 数据库连接检测
 */
async function checkDatabase(): Promise<CheckResult> {
  try {
    const db = await getDb();
    if (!db) throw new Error('数据库未连接');
    const config = await db.select().from(systemConfig).limit(1);
    return { 
      name: '数据库连接', 
      status: 'success', 
      message: '正常' 
    };
  } catch (e: any) {
    return { 
      name: '数据库连接', 
      status: 'error', 
      message: '连接失败',
      suggestion: '请检查DATABASE_URL环境变量是否正确配置'
    };
  }
}

/**
 * 2. API配置完整性检测
 */
async function checkAPIConfig(): Promise<CheckResult> {
  try {
    const db = await getDb();
    if (!db) throw new Error('数据库未连接');
    const configs = await db.select().from(systemConfig);
    const configMap: Record<string, string> = {};
    configs.forEach((c: { key: string; value: string | null }) => { configMap[c.key] = c.value || ''; });
    
    const apiKey = configMap['apiKey'] || DEFAULT_CONFIG.apiKey || '';
    const apiUrl = configMap['apiUrl'] || DEFAULT_CONFIG.apiUrl || '';
    const apiModel = configMap['apiModel'] || DEFAULT_CONFIG.apiModel || '';

    const missing: string[] = [];
    if (!apiKey) missing.push('API密钥');
    if (!apiUrl) missing.push('API地址');
    if (!apiModel) missing.push('API模型');
    
    if (missing.length > 0) {
      return {
        name: 'API配置完整性',
        status: 'error',
        message: `缺少: ${missing.join(', ')}`,
        suggestion: '请在高级设置中填写完整的API配置'
      };
    }
    
    return {
      name: 'API配置完整性',
      status: 'success',
      message: '配置完整'
    };
  } catch (e: any) {
    return {
      name: 'API配置完整性',
      status: 'error',
      message: '检测失败',
      suggestion: '无法读取配置，请检查数据库连接'
    };
  }
}

/**
 * 3. API连通性检测
 */
async function checkAPIConnectivity(apiUrl: string): Promise<CheckResult> {
  if (!apiUrl) {
    return {
      name: 'API连通性',
      status: 'skipped',
      message: '未检测',
      suggestion: '需要先配置API地址'
    };
  }
  
  try {
    const modelsUrl = apiUrl.replace(/\/+$/, '') + '/models';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(modelsUrl, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    // 即使返回401也说明服务可达
    if (response.status === 200 || response.status === 401) {
      return {
        name: 'API连通性',
        status: 'success',
        message: '服务可达'
      };
    }
    
    return {
      name: 'API连通性',
      status: 'error',
      message: `HTTP ${response.status}`,
      suggestion: '请检查API地址是否正确'
    };
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return {
        name: 'API连通性',
        status: 'error',
        message: '连接超时',
        suggestion: '请检查网络连接或API地址'
      };
    }
    return {
      name: 'API连通性',
      status: 'error',
      message: '连接失败',
      suggestion: '请检查网络连接或API地址是否正确'
    };
  }
}

/**
 * 4. API密钥有效性检测
 */
async function checkAPIKey(apiUrl: string, apiKey: string): Promise<CheckResult> {
  if (!apiUrl || !apiKey) {
    return {
      name: 'API密钥有效性',
      status: 'skipped',
      message: '未检测',
      suggestion: '需要先配置API地址和密钥'
    };
  }
  
  try {
    const modelsUrl = apiUrl.replace(/\/+$/, '') + '/models';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.status === 200) {
      return {
        name: 'API密钥有效性',
        status: 'success',
        message: '密钥有效'
      };
    }
    
    if (response.status === 401) {
      return {
        name: 'API密钥有效性',
        status: 'error',
        message: '密钥无效',
        suggestion: '请检查API密钥是否正确'
      };
    }
    
    return {
      name: 'API密钥有效性',
      status: 'error',
      message: `HTTP ${response.status}`,
      suggestion: '请检查API密钥'
    };
  } catch (e: any) {
    return {
      name: 'API密钥有效性',
      status: 'error',
      message: '检测失败',
      suggestion: '请检查网络连接'
    };
  }
}

/**
 * 5. API余额检测
 */
async function checkAPIBalance(apiUrl: string, apiKey: string, apiModel: string): Promise<CheckResult> {
  if (!apiUrl || !apiKey || !apiModel) {
    return {
      name: 'API余额',
      status: 'skipped',
      message: '未检测',
      suggestion: '需要先完成API配置'
    };
  }
  
  try {
    const chatUrl = apiUrl.replace(/\/+$/, '') + '/chat/completions';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: apiModel,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.ok) {
      return {
        name: 'API余额',
        status: 'success',
        message: '余额充足'
      };
    }
    
    if (response.status === 403) {
      const data = await response.json().catch(() => ({}));
      if (data.error?.code === 'insufficient_user_quota' || 
          (data.error?.message && data.error.message.includes('余额'))) {
        return {
          name: 'API余额',
          status: 'error',
          message: '余额不足',
          suggestion: '请登录API服务商充值'
        };
      }
    }
    
    if (response.status === 401) {
      return {
        name: 'API余额',
        status: 'skipped',
        message: '未检测',
        suggestion: '需要先修复API密钥问题'
      };
    }
    
    return {
      name: 'API余额',
      status: 'error',
      message: `HTTP ${response.status}`,
      suggestion: '请检查API配置'
    };
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return {
        name: 'API余额',
        status: 'error',
        message: '请求超时',
        suggestion: '模型响应过慢，可能需要更换模型'
      };
    }
    return {
      name: 'API余额',
      status: 'error',
      message: '检测失败',
      suggestion: '请检查网络连接'
    };
  }
}

/**
 * 6. Google Drive授权检测（优先检查OAuth，其次检查rclone）
 */
async function checkGDriveAuth(): Promise<CheckResult & { method?: 'oauth' | 'rclone' }> {
  // 先检查OAuth授权
  try {
    const oauthAuthorized = await isOAuthAuthorized();
    if (oauthAuthorized) {
      const token = await getValidToken();
      if (token) {
        return {
          name: 'Google Drive授权',
          status: 'success',
          message: 'OAuth授权有效',
          method: 'oauth'
        };
      }
    }
  } catch (e) {
    // OAuth检查失败，继续检查rclone
  }
  
  // 再检查rclone授权
  try {
    const { stdout, stderr } = await execAsync(
      `rclone lsd "${REMOTE_NAME}:Mac/Documents/XDF" --config ${RCLONE_CONFIG}`,
      { timeout: 15000 }
    );
    
    return {
      name: 'Google Drive授权',
      status: 'success',
      message: 'rclone授权有效',
      method: 'rclone'
    };
  } catch (e: any) {
    const errorMsg = e.message || e.stderr || '';
    
    if (errorMsg.includes('token expired') || errorMsg.includes('Invalid Credentials')) {
      return {
        name: 'Google Drive授权',
        status: 'error',
        message: '授权已过期',
        suggestion: '请点击上方“连接 Google Drive”按钮重新授权'
      };
    }
    
    if (errorMsg.includes('directory not found')) {
      // 目录不存在但授权是有效的
      return {
        name: 'Google Drive授权',
        status: 'success',
        message: 'rclone授权有效',
        method: 'rclone'
      };
    }
    
    return {
      name: 'Google Drive授权',
      status: 'error',
      message: '未连接',
      suggestion: '请点击上方“连接 Google Drive”按钮进行授权'
    };
  }
}

// Google Drive API 端点
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

/**
 * 7. Google Drive写入权限检测
 * 使用 Google Drive REST API 而非 rclone，确保在正式部署环境也能正常工作
 */
async function checkGDriveWrite(authPassed: boolean): Promise<CheckResult> {
  if (!authPassed) {
    return {
      name: 'Google Drive写入权限',
      status: 'skipped',
      message: '未检测',
      suggestion: '需要先修复Google Drive授权'
    };
  }
  
  try {
    // 获取有效的 OAuth token
    const token = await getValidToken();
    if (!token) {
      return {
        name: 'Google Drive写入权限',
        status: 'error',
        message: '无法获取有效的访问令牌',
        suggestion: '请重新连接Google Drive'
      };
    }
    
    const testFileName = `_test_${Date.now()}.txt`;
    const testContent = 'test write permission';
    
    // 使用 Google Drive API 上传测试文件
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    
    const metadata = {
      name: testFileName,
      parents: ['root'], // 上传到根目录
    };
    
    const multipartBody = Buffer.concat([
      Buffer.from(delimiter + 'Content-Type: application/json\r\n\r\n' + JSON.stringify(metadata)),
      Buffer.from(delimiter + 'Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n'),
      Buffer.from(Buffer.from(testContent).toString('base64')),
      Buffer.from(closeDelimiter),
    ]);
    
    // 上传文件
    const uploadRes = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });
    
    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      console.error('[checkGDriveWrite] Upload failed:', uploadRes.status, errorText);
      return {
        name: 'Google Drive写入权限',
        status: 'error',
        message: `上传失败: ${uploadRes.status}`,
        suggestion: '请检查Google Drive权限设置'
      };
    }
    
    const uploadData = await uploadRes.json();
    const fileId = uploadData.id;
    console.log('[checkGDriveWrite] Test file uploaded:', fileId);
    
    // 删除测试文件
    const deleteRes = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    
    if (!deleteRes.ok && deleteRes.status !== 204) {
      console.warn('[checkGDriveWrite] Failed to delete test file:', deleteRes.status);
      // 删除失败不影响写入测试结果
    } else {
      console.log('[checkGDriveWrite] Test file deleted');
    }
    
    return {
      name: 'Google Drive写入权限',
      status: 'success',
      message: '写入正常'
    };
  } catch (e: any) {
    console.error('[checkGDriveWrite] Error:', e.message || e);
    return {
      name: 'Google Drive写入权限',
      status: 'error',
      message: `写入失败: ${e.message || '未知错误'}`,
      suggestion: '请检查Google Drive权限设置'
    };
  }
}

/**
 * 8. V9路书配置检测
 */
async function checkRoadmap(): Promise<CheckResult> {
  try {
    const db = await getDb();
    if (!db) throw new Error('数据库未连接');
    const configs = await db.select().from(systemConfig);
    const roadmapConfig = configs.find((c: { key: string; value: string | null }) => c.key === 'roadmap');
    
    if (!roadmapConfig || !roadmapConfig.value || roadmapConfig.value.trim().length < 100) {
      return {
        name: 'V9路书配置',
        status: 'error',
        message: '未配置',
        suggestion: '请在高级设置中粘贴V9路书内容'
      };
    }
    
    return {
      name: 'V9路书配置',
      status: 'success',
      message: '已配置'
    };
  } catch (e: any) {
    return {
      name: 'V9路书配置',
      status: 'error',
      message: '检测失败',
      suggestion: '无法读取配置'
    };
  }
}

/**
 * 执行完整的系统自检
 */
export async function runSystemCheck(): Promise<SystemCheckResults> {
  const results: CheckResult[] = [];
  
  // 1. 数据库连接
  const dbResult = await checkDatabase();
  results.push(dbResult);
  
  // 如果数据库连接失败，后续检测无法进行
  if (dbResult.status === 'error') {
    // 添加跳过的检测项
    results.push({ name: 'API配置完整性', status: 'skipped', message: '未检测', suggestion: '需要先修复数据库连接' });
    results.push({ name: 'API连通性', status: 'skipped', message: '未检测', suggestion: '需要先修复数据库连接' });
    results.push({ name: 'API密钥有效性', status: 'skipped', message: '未检测', suggestion: '需要先修复数据库连接' });
    results.push({ name: 'API余额', status: 'skipped', message: '未检测', suggestion: '需要先修复数据库连接' });
    results.push({ name: 'Google Drive授权', status: 'skipped', message: '未检测', suggestion: '需要先修复数据库连接' });
    results.push({ name: 'Google Drive写入权限', status: 'skipped', message: '未检测', suggestion: '需要先修复数据库连接' });
    results.push({ name: 'V9路书配置', status: 'skipped', message: '未检测', suggestion: '需要先修复数据库连接' });
    
    return {
      results,
      passed: 0,
      total: 8,
      allPassed: false
    };
  }
  
  // 获取API配置
  const db = await getDb();
  if (!db) throw new Error('数据库未连接');
  const configs = await db.select().from(systemConfig);
  const configMap: Record<string, string> = {};
  configs.forEach((c: { key: string; value: string | null }) => { configMap[c.key] = c.value || ''; });
  
  const apiKey = configMap['apiKey'] || DEFAULT_CONFIG.apiKey || '';
  const apiUrl = configMap['apiUrl'] || DEFAULT_CONFIG.apiUrl || '';
  const apiModel = configMap['apiModel'] || DEFAULT_CONFIG.apiModel || '';
  
  // 2. API配置完整性
  const apiConfigResult = await checkAPIConfig();
  results.push(apiConfigResult);
  
  // 3. API连通性
  const apiConnResult = await checkAPIConnectivity(apiUrl);
  results.push(apiConnResult);
  
  // 4. API密钥有效性
  const apiKeyResult = await checkAPIKey(apiUrl, apiKey);
  results.push(apiKeyResult);
  
  // 5. API余额
  const apiBalanceResult = await checkAPIBalance(apiUrl, apiKey, apiModel);
  results.push(apiBalanceResult);
  
  // 6. Google Drive授权
  const gdriveAuthResult = await checkGDriveAuth();
  results.push(gdriveAuthResult);
  
  // 7. Google Drive写入权限
  const gdriveWriteResult = await checkGDriveWrite(gdriveAuthResult.status === 'success');
  results.push(gdriveWriteResult);
  
  // 8. V9路书配置
  const roadmapResult = await checkRoadmap();
  results.push(roadmapResult);
  
  // 统计结果
  const passed = results.filter(r => r.status === 'success').length;
  const total = results.length;
  
  return {
    results,
    passed,
    total,
    allPassed: passed === total
  };
}
