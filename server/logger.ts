/**
 * 日志记录模块
 * 记录每次生成的完整日志，支持导出到Google Drive
 * V40补充：改为每个请求独立的 log 对象，解决并发污染问题
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
  
  // 步骤计时（内部使用）
  _stepStartTime?: number;
}

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
 * 创建新的日志会话（每个请求独立）
 */
export function createLogSession(
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
): GenerationLog {
  const sessionId = generateSessionId();
  
  const log: GenerationLog = {
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
  
  logInfo(log, 'session', `开始生成会话 ${sessionId}`);
  logInfo(log, 'config', `学生: ${studentName}`);
  logInfo(log, 'config', `API地址: ${config.apiUrl}`);
  logInfo(log, 'config', `模型: ${config.apiModel}`);
  logInfo(log, 'config', `max_tokens: ${config.maxTokens}`);
  logInfo(log, 'input', `笔记长度: ${inputSummary.notesLength}字符`);
  logInfo(log, 'input', `录音长度: ${inputSummary.transcriptLength}字符`);
  logInfo(log, 'input', `上次反馈长度: ${inputSummary.lastFeedbackLength}字符`);
  
  return log;
}

/**
 * 记录日志条目（需要传入 log 对象）
 */
function addEntry(log: GenerationLog, level: LogEntry['level'], step: string, message: string, data?: any) {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    step,
    message,
    data
  };
  
  log.entries.push(entry);
  
  // 同时输出到控制台，包含学生名以区分并发请求
  const prefix = `[${entry.timestamp}] [${log.studentName}] [${level}] [${step}]`;
  console.log(`${prefix} ${message}`);
  if (data) {
    console.log(`${prefix} 数据:`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
}

/**
 * 记录信息日志
 */
export function logInfo(log: GenerationLog, step: string, message: string, data?: any) {
  addEntry(log, 'INFO', step, message, data);
}

/**
 * 记录警告日志
 */
export function logWarn(log: GenerationLog, step: string, message: string, data?: any) {
  addEntry(log, 'WARN', step, message, data);
}

/**
 * 记录错误日志
 */
export function logError(log: GenerationLog, step: string, message: string, data?: any) {
  addEntry(log, 'ERROR', step, message, data);
}

/**
 * 记录调试日志
 */
export function logDebug(log: GenerationLog, step: string, message: string, data?: any) {
  addEntry(log, 'DEBUG', step, message, data);
}

/**
 * 开始步骤计时
 */
export function startStep(log: GenerationLog, step: string) {
  log._stepStartTime = Date.now();
  logInfo(log, step, `开始生成${step}`);
}

/**
 * 记录步骤成功
 */
export function stepSuccess(log: GenerationLog, step: string, outputLength?: number) {
  const duration = Date.now() - (log._stepStartTime || Date.now());
  
  log.stepResults.push({
    step,
    status: 'success',
    duration,
    outputLength
  });
  
  logInfo(log, step, `生成完成，耗时${(duration / 1000).toFixed(1)}秒${outputLength ? `，输出${outputLength}字符` : ''}`);
}

/**
 * 记录步骤失败
 */
export function stepFailed(log: GenerationLog, step: string, error: StructuredError) {
  const duration = Date.now() - (log._stepStartTime || Date.now());
  
  log.stepResults.push({
    step,
    status: 'failed',
    duration,
    error
  });
  
  logError(log, step, `生成失败: ${error.message}`, {
    code: error.code,
    suggestion: error.suggestion,
    originalError: error.originalError
  });
}

/**
 * 记录步骤跳过
 */
export function stepSkipped(log: GenerationLog, step: string, reason: string) {
  log.stepResults.push({
    step,
    status: 'skipped'
  });
  
  logWarn(log, step, `跳过: ${reason}`);
}

/**
 * 记录流式输出进度
 */
export function logStreamProgress(log: GenerationLog, step: string, chunkCount: number, totalLength: number) {
  if (chunkCount % 10 === 0) { // 每10个chunk记录一次
    logDebug(log, step, `收到第${chunkCount}个chunk，累计${totalLength}字符`);
  }
}

/**
 * 结束日志会话
 */
export function endLogSession(log: GenerationLog): GenerationLog {
  log.endTime = formatTimestamp();
  
  // 计算最终结果
  const successCount = log.stepResults.filter(r => r.status === 'success').length;
  const totalCount = log.stepResults.length;
  
  if (successCount === totalCount && totalCount > 0) {
    log.finalResult = 'success';
  } else if (successCount > 0) {
    log.finalResult = 'partial';
  } else {
    log.finalResult = 'failed';
  }
  
  logInfo(log, 'session', `会话结束，结果: ${log.finalResult} (${successCount}/${totalCount}步骤成功)`);
  
  // 保存日志文件
  saveLogToFile(log);
  
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
 * 根据学生名获取最新的日志文件路径
 */
export function getLatestLogPathByStudent(studentName: string): string | null {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log') && f.startsWith(studentName + '_'))
      .map(f => ({
        name: f,
        path: path.join(LOG_DIR, f),
        mtime: fs.statSync(path.join(LOG_DIR, f)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    
    return files.length > 0 ? files[0].path : null;
  } catch (error) {
    console.error('[Logger] 根据学生名获取日志文件失败:', error);
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

// ========== 兼容旧版 API（逐步废弃）==========
// 这些函数保留是为了兼容现有代码，新代码应使用带 log 参数的版本

let _legacyLog: GenerationLog | null = null;

/**
 * @deprecated 使用 createLogSession 代替
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
  _legacyLog = createLogSession(studentName, config, inputSummary, lessonNumber, lessonDate);
  return _legacyLog.sessionId;
}

/**
 * @deprecated 使用 getCurrentLog() 获取 log 对象后调用带参数版本
 */
export function getCurrentLog(): GenerationLog | null {
  return _legacyLog;
}

// 兼容旧版无参数调用的包装函数
export const logger = {
  startLogSession,
  createLogSession,
  logInfo: (step: string, message: string, data?: any) => {
    if (_legacyLog) logInfo(_legacyLog, step, message, data);
  },
  logWarn: (step: string, message: string, data?: any) => {
    if (_legacyLog) logWarn(_legacyLog, step, message, data);
  },
  logError: (step: string, message: string, data?: any) => {
    if (_legacyLog) logError(_legacyLog, step, message, data);
  },
  logDebug: (step: string, message: string, data?: any) => {
    if (_legacyLog) logDebug(_legacyLog, step, message, data);
  },
  startStep: (step: string) => {
    if (_legacyLog) startStep(_legacyLog, step);
  },
  stepSuccess: (step: string, outputLength?: number) => {
    if (_legacyLog) stepSuccess(_legacyLog, step, outputLength);
  },
  stepFailed: (step: string, error: StructuredError) => {
    if (_legacyLog) stepFailed(_legacyLog, step, error);
  },
  stepSkipped: (step: string, reason: string) => {
    if (_legacyLog) stepSkipped(_legacyLog, step, reason);
  },
  logStreamProgress: (step: string, chunkCount: number, totalLength: number) => {
    if (_legacyLog) logStreamProgress(_legacyLog, step, chunkCount, totalLength);
  },
  endLogSession: (): GenerationLog | null => {
    if (!_legacyLog) return null;
    const log = endLogSession(_legacyLog);
    _legacyLog = null;
    return log;
  },
  getCurrentLog,
  getLatestLogPath,
  getLogContent,
  listLogFiles,
};

export default logger;
