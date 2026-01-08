/**
 * 日志记录模块
 * 记录每次生成的完整日志，支持导出到Google Drive
 */

import * as fs from 'fs';
import * as path from 'path';
import { StructuredError } from './errorHandler';

// 日志目录
const LOG_DIR = path.join(process.cwd(), 'logs');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 日志条目类型
export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  step: string;
  message: string;
  data?: any;
}

// 生成会话日志
export interface GenerationLog {
  sessionId: string;
  startTime: string;
  endTime?: string;
  studentName: string;
  lessonNumber?: string;
  lessonDate?: string;
  
  // 系统配置
  config: {
    apiUrl: string;
    apiModel: string;
    maxTokens: number;
  };
  
  // 输入摘要
  inputSummary: {
    notesLength: number;
    transcriptLength: number;
    lastFeedbackLength: number;
  };
  
  // 执行过程日志
  entries: LogEntry[];
  
  // 步骤结果
  stepResults: {
    step: string;
    status: 'success' | 'failed' | 'skipped';
    duration?: number;
    outputLength?: number;
    error?: StructuredError;
  }[];
  
  // 最终结果
  finalResult: 'success' | 'partial' | 'failed';
}

// 当前活跃的日志会话
let currentLog: GenerationLog | null = null;
let stepStartTime: number = 0;

/**
 * 生成会话ID
 */
function generateSessionId(): string {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const random = Math.random().toString(36).substring(2, 6);
  return `${dateStr}_${random}`;
}

/**
 * 格式化时间戳
 */
function formatTimestamp(date: Date = new Date()): string {
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * 开始新的日志会话
 */
export function startLogSession(
  studentName: string,
  config: {
    apiUrl: string;
    apiModel: string;
    maxTokens: number;
  },
  inputSummary: {
    notesLength: number;
    transcriptLength: number;
    lastFeedbackLength: number;
  },
  lessonNumber?: string,
  lessonDate?: string
): string {
  const sessionId = generateSessionId();
  
  currentLog = {
    sessionId,
    startTime: formatTimestamp(),
    studentName,
    lessonNumber,
    lessonDate,
    config,
    inputSummary,
    entries: [],
    stepResults: [],
    finalResult: 'failed'
  };
  
  logInfo('session', `开始生成会话 ${sessionId}`);
  logInfo('config', `API地址: ${config.apiUrl}`);
  logInfo('config', `模型: ${config.apiModel}`);
  logInfo('config', `max_tokens: ${config.maxTokens}`);
  logInfo('input', `笔记长度: ${inputSummary.notesLength}字符`);
  logInfo('input', `录音长度: ${inputSummary.transcriptLength}字符`);
  logInfo('input', `上次反馈长度: ${inputSummary.lastFeedbackLength}字符`);
  
  return sessionId;
}

/**
 * 记录日志条目
 */
function addEntry(level: LogEntry['level'], step: string, message: string, data?: any) {
  if (!currentLog) return;
  
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    step,
    message,
    data
  };
  
  currentLog.entries.push(entry);
  
  // 同时输出到控制台
  const prefix = `[${entry.timestamp}] [${level}] [${step}]`;
  console.log(`${prefix} ${message}`);
  if (data) {
    console.log(`${prefix} 数据:`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
}

/**
 * 记录信息日志
 */
export function logInfo(step: string, message: string, data?: any) {
  addEntry('INFO', step, message, data);
}

/**
 * 记录警告日志
 */
export function logWarn(step: string, message: string, data?: any) {
  addEntry('WARN', step, message, data);
}

/**
 * 记录错误日志
 */
export function logError(step: string, message: string, data?: any) {
  addEntry('ERROR', step, message, data);
}

/**
 * 记录调试日志
 */
export function logDebug(step: string, message: string, data?: any) {
  addEntry('DEBUG', step, message, data);
}

/**
 * 开始步骤计时
 */
export function startStep(step: string) {
  stepStartTime = Date.now();
  logInfo(step, `开始生成${step}`);
}

/**
 * 记录步骤成功
 */
export function stepSuccess(step: string, outputLength?: number) {
  if (!currentLog) return;
  
  const duration = Date.now() - stepStartTime;
  
  currentLog.stepResults.push({
    step,
    status: 'success',
    duration,
    outputLength
  });
  
  logInfo(step, `生成完成，耗时${(duration / 1000).toFixed(1)}秒${outputLength ? `，输出${outputLength}字符` : ''}`);
}

/**
 * 记录步骤失败
 */
export function stepFailed(step: string, error: StructuredError) {
  if (!currentLog) return;
  
  const duration = Date.now() - stepStartTime;
  
  currentLog.stepResults.push({
    step,
    status: 'failed',
    duration,
    error
  });
  
  logError(step, `生成失败: ${error.message}`, {
    code: error.code,
    suggestion: error.suggestion,
    originalError: error.originalError
  });
}

/**
 * 记录步骤跳过
 */
export function stepSkipped(step: string, reason: string) {
  if (!currentLog) return;
  
  currentLog.stepResults.push({
    step,
    status: 'skipped'
  });
  
  logWarn(step, `跳过: ${reason}`);
}

/**
 * 记录流式输出进度
 */
export function logStreamProgress(step: string, chunkCount: number, totalLength: number) {
  if (chunkCount % 10 === 0) { // 每10个chunk记录一次
    logDebug(step, `收到第${chunkCount}个chunk，累计${totalLength}字符`);
  }
}

/**
 * 结束日志会话
 */
export function endLogSession(): GenerationLog | null {
  if (!currentLog) return null;
  
  currentLog.endTime = formatTimestamp();
  
  // 计算最终结果
  const successCount = currentLog.stepResults.filter(r => r.status === 'success').length;
  const totalCount = currentLog.stepResults.length;
  
  if (successCount === totalCount && totalCount > 0) {
    currentLog.finalResult = 'success';
  } else if (successCount > 0) {
    currentLog.finalResult = 'partial';
  } else {
    currentLog.finalResult = 'failed';
  }
  
  logInfo('session', `会话结束，结果: ${currentLog.finalResult} (${successCount}/${totalCount}步骤成功)`);
  
  // 保存日志文件
  saveLogToFile(currentLog);
  
  const log = currentLog;
  currentLog = null;
  
  return log;
}

/**
 * 保存日志到文件
 */
function saveLogToFile(log: GenerationLog) {
  const fileName = `${log.studentName}_${log.sessionId}.log`;
  const filePath = path.join(LOG_DIR, fileName);
  
  const content = formatLogForFile(log);
  
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[Logger] 日志已保存到: ${filePath}`);
  } catch (error) {
    console.error(`[Logger] 保存日志失败:`, error);
  }
}

/**
 * 格式化日志为文件内容
 */
function formatLogForFile(log: GenerationLog): string {
  const lines: string[] = [];
  
  // 头部摘要
  lines.push('='.repeat(60));
  lines.push('生成日志');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`会话ID: ${log.sessionId}`);
  lines.push(`开始时间: ${log.startTime}`);
  lines.push(`结束时间: ${log.endTime || '未完成'}`);
  lines.push(`学生: ${log.studentName}`);
  if (log.lessonNumber) lines.push(`课次: ${log.lessonNumber}`);
  if (log.lessonDate) lines.push(`日期: ${log.lessonDate}`);
  lines.push(`最终结果: ${log.finalResult}`);
  lines.push('');
  
  // 系统配置
  lines.push('-'.repeat(40));
  lines.push('系统配置');
  lines.push('-'.repeat(40));
  lines.push(`API地址: ${log.config.apiUrl}`);
  lines.push(`模型: ${log.config.apiModel}`);
  lines.push(`max_tokens: ${log.config.maxTokens}`);
  lines.push('');
  
  // 输入摘要
  lines.push('-'.repeat(40));
  lines.push('输入摘要');
  lines.push('-'.repeat(40));
  lines.push(`笔记长度: ${log.inputSummary.notesLength}字符`);
  lines.push(`录音长度: ${log.inputSummary.transcriptLength}字符`);
  lines.push(`上次反馈长度: ${log.inputSummary.lastFeedbackLength}字符`);
  lines.push('');
  
  // 执行过程
  lines.push('-'.repeat(40));
  lines.push('执行过程');
  lines.push('-'.repeat(40));
  for (const entry of log.entries) {
    const levelIcon = {
      'INFO': '📝',
      'WARN': '⚠️',
      'ERROR': '❌',
      'DEBUG': '🔍'
    }[entry.level];
    lines.push(`[${entry.timestamp}] ${levelIcon} [${entry.step}] ${entry.message}`);
    if (entry.data) {
      const dataStr = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2);
      lines.push(`    ${dataStr.replace(/\n/g, '\n    ')}`);
    }
  }
  lines.push('');
  
  // 步骤结果
  lines.push('-'.repeat(40));
  lines.push('步骤结果');
  lines.push('-'.repeat(40));
  for (const result of log.stepResults) {
    const icon = result.status === 'success' ? '✓' : result.status === 'failed' ? '✗' : '○';
    let line = `${icon} ${result.step}: ${result.status}`;
    if (result.duration) {
      line += ` (${(result.duration / 1000).toFixed(1)}秒)`;
    }
    if (result.outputLength) {
      line += ` - ${result.outputLength}字符`;
    }
    lines.push(line);
    
    if (result.error) {
      lines.push(`    错误码: ${result.error.code}`);
      lines.push(`    错误信息: ${result.error.message}`);
      lines.push(`    建议: ${result.error.suggestion}`);
      if (result.error.originalError) {
        lines.push(`    原始错误: ${result.error.originalError}`);
      }
    }
  }
  lines.push('');
  
  lines.push('='.repeat(60));
  lines.push('日志结束');
  lines.push('='.repeat(60));
  
  return lines.join('\n');
}

/**
 * 获取最新的日志文件路径
 */
export function getLatestLogPath(): string | null {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(LOG_DIR, f),
        mtime: fs.statSync(path.join(LOG_DIR, f)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    
    return files.length > 0 ? files[0].path : null;
  } catch (error) {
    console.error('[Logger] 获取日志文件失败:', error);
    return null;
  }
}

/**
 * 获取日志文件内容
 */
export function getLogContent(logPath: string): string | null {
  try {
    return fs.readFileSync(logPath, 'utf-8');
  } catch (error) {
    console.error('[Logger] 读取日志文件失败:', error);
    return null;
  }
}

/**
 * 获取当前日志会话
 */
export function getCurrentLog(): GenerationLog | null {
  return currentLog;
}

/**
 * 列出所有日志文件
 */
export function listLogFiles(): { name: string; path: string; mtime: Date }[] {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(LOG_DIR, f),
        mtime: fs.statSync(path.join(LOG_DIR, f)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  } catch (error) {
    console.error('[Logger] 列出日志文件失败:', error);
    return [];
  }
}
