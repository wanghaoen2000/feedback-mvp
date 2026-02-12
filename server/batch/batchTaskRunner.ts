/**
 * 批量任务后台运行器
 * 在服务器端执行批量生成任务，断网/切换页面不影响
 */

import { getDb } from "../db";
import { batchTasks, batchTaskItems } from "../../drizzle/schema";
import { eq, lt, and, sql, inArray } from "drizzle-orm";
import { getConfigValue as getConfig, DEFAULT_CONFIG, FileInfo } from "../core/aiClient";
import { ConcurrencyPool } from "../core/concurrencyPool";
import { executeBatchItem, BatchItemParams } from "./batchExecutor";

/** 最大并发批量任务数（同时只允许1个批量任务执行） */
const MAX_CONCURRENT_BATCH = 1;
let _runningBatchCount = 0;

/** 取消信号：batchId → AbortController */
const _cancelSignals = new Map<string, AbortController>();

/** 请求取消批量任务 */
export function cancelBatchTask(batchId: string): boolean {
  const controller = _cancelSignals.get(batchId);
  if (controller) {
    console.log(`[批量任务] ${batchId} 收到取消请求`);
    controller.abort();
    return true;
  }
  return false;
}

function isCancelled(batchId: string): boolean {
  return _cancelSignals.get(batchId)?.signal.aborted ?? false;
}

/** 更新批量任务（带错误保护） */
async function updateBatchTask(batchId: string, updates: Record<string, any>) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.update(batchTasks).set(updates).where(eq(batchTasks.id, batchId));
  } catch (err: any) {
    console.error(`[批量任务] ${batchId} 更新DB失败:`, err?.message || err);
  }
}

/** 更新子任务状态 */
async function updateBatchItem(batchId: string, taskNumber: number, updates: Record<string, any>) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.update(batchTaskItems).set(updates)
      .where(and(eq(batchTaskItems.batchId, batchId), eq(batchTaskItems.taskNumber, taskNumber)));
  } catch (err: any) {
    console.error(`[批量任务] ${batchId}/${taskNumber} 更新子任务DB失败:`, err?.message || err);
  }
}

/**
 * 批量任务输入参数（存储在 batch_tasks.input_params 中）
 */
export interface BatchTaskInputParams {
  startNumber: number;
  endNumber: number;
  concurrency: number;
  roadmap: string;
  storagePath: string;
  filePrefix: string;
  templateType: string;
  namingMethod: string;
  customFileNames?: Record<number, string>;
  files?: Record<number, FileInfo>;
  sharedFiles?: FileInfo[];
  // 配置快照
  apiModel?: string;
  apiKey?: string;
  apiUrl?: string;
}

/**
 * 启动批量后台任务（fire-and-forget）
 */
export function startBatchBackgroundTask(batchId: string) {
  if (_runningBatchCount >= MAX_CONCURRENT_BATCH) {
    console.warn(`[批量任务] ${batchId} 被拒绝：已有 ${_runningBatchCount} 个批量任务在运行（上限 ${MAX_CONCURRENT_BATCH}）`);
    updateBatchTask(batchId, {
      status: "failed",
      errorMessage: `服务器繁忙，当前已有 ${_runningBatchCount} 个批量任务在运行（上限 ${MAX_CONCURRENT_BATCH}），请稍后重试`,
      completedAt: new Date(),
    }).catch(() => {});
    return;
  }

  _runningBatchCount++;
  _cancelSignals.set(batchId, new AbortController());
  console.log(`[批量任务] ${batchId} 开始（当前并发: ${_runningBatchCount}/${MAX_CONCURRENT_BATCH}）`);

  runBatchTask(batchId)
    .catch((err) => {
      if (isCancelled(batchId)) {
        console.log(`[批量任务] ${batchId} 已被用户取消/停止`);
        return;
      }
      console.error(`[批量任务] ${batchId} 顶层异常:`, err);
      updateBatchTask(batchId, {
        status: "failed",
        errorMessage: `顶层异常: ${err?.message || String(err)}`,
        completedAt: new Date(),
      }).catch(() => {});
    })
    .finally(() => {
      _cancelSignals.delete(batchId);
      _runningBatchCount--;
      console.log(`[批量任务] ${batchId} 结束（当前并发: ${_runningBatchCount}/${MAX_CONCURRENT_BATCH}）`);
    });
}

/**
 * 执行批量任务
 */
async function runBatchTask(batchId: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 读取任务
  const tasks = await db.select().from(batchTasks).where(eq(batchTasks.id, batchId)).limit(1);
  if (tasks.length === 0) throw new Error(`批量任务不存在: ${batchId}`);

  const task = tasks[0];
  let params: BatchTaskInputParams;
  try {
    params = JSON.parse(task.inputParams);
  } catch {
    await updateBatchTask(batchId, {
      status: "failed",
      errorMessage: "任务参数解析失败",
      completedAt: new Date(),
    });
    return;
  }

  // 更新状态为运行中
  await updateBatchTask(batchId, { status: "running" });

  // 获取配置
  const apiModel = params.apiModel || (await getConfig("apiModel")) || DEFAULT_CONFIG.apiModel;
  const apiKey = params.apiKey || (await getConfig("apiKey")) || DEFAULT_CONFIG.apiKey;
  const apiUrl = params.apiUrl || (await getConfig("apiUrl")) || DEFAULT_CONFIG.apiUrl;
  const config = { apiModel, apiKey, apiUrl };

  // 构建文件夹路径
  const batchFolderPath = params.storagePath
    ? `${params.storagePath}/${batchId}`
    : undefined;

  // 构建任务编号列表
  const taskNumbers: number[] = [];
  for (let i = params.startNumber; i <= params.endNumber; i++) {
    taskNumbers.push(i);
  }

  let completedCount = 0;
  let failedCount = 0;

  // 使用并发池
  const pool = new ConcurrencyPool(params.concurrency || 50);

  // 添加所有任务到队列
  pool.addTasks(taskNumbers);

  // 执行
  await pool.execute(
    // taskExecutor
    async (taskNumber, onPoolProgress) => {
      // 检查取消
      if (isCancelled(batchId)) {
        throw new Error("任务已被取消");
      }

      // 更新子任务状态为 running
      await updateBatchItem(batchId, taskNumber, { status: "running" });

      const itemParams: BatchItemParams = {
        taskNumber,
        roadmap: params.roadmap,
        templateType: params.templateType,
        filePrefix: params.filePrefix,
        namingMethod: params.namingMethod,
        customFileNames: params.customFileNames,
        files: params.files,
        sharedFiles: params.sharedFiles,
        batchFolderPath,
        config,
      };

      const result = await executeBatchItem(itemParams, (chars, message) => {
        onPoolProgress(chars);
        // 更新子任务字符数
        updateBatchItem(batchId, taskNumber, { chars }).catch(() => {});
      });

      return result;
    },
    // onProgress
    (taskNumber, chars) => {
      // 子任务进度回调（可选：用于实时字符数更新）
    },
    // onComplete
    async (taskNumber, taskResult) => {
      if (taskResult.success && taskResult.result) {
        completedCount++;
        await updateBatchItem(batchId, taskNumber, {
          status: "completed",
          chars: taskResult.result.chars,
          filename: taskResult.result.filename,
          url: taskResult.result.url || null,
          truncated: taskResult.result.truncated ? 1 : 0,
          completedAt: new Date(),
        });
        console.log(`[批量任务] ${batchId} 任务 ${taskNumber} 完成 (${taskResult.result.filename}, ${taskResult.result.chars}字) [${completedCount + failedCount}/${taskNumbers.length}]`);
      } else {
        failedCount++;
        const errorMsg = taskResult.error?.message || "未知错误";
        await updateBatchItem(batchId, taskNumber, {
          status: "failed",
          error: errorMsg,
          completedAt: new Date(),
        });
        console.error(`[批量任务] ${batchId} 任务 ${taskNumber} 失败: ${errorMsg} [${completedCount + failedCount}/${taskNumbers.length}]`);
      }

      // 更新批量任务的计数
      await updateBatchTask(batchId, {
        completedItems: completedCount,
        failedItems: failedCount,
      });
    }
  );

  // 确定最终状态
  let finalStatus: string;
  if (isCancelled(batchId)) {
    finalStatus = "stopped";
  } else if (failedCount === 0) {
    finalStatus = "completed";
  } else if (completedCount > 0) {
    finalStatus = "completed"; // 有成功也有失败，仍标记完成（用户可以看到失败子任务）
  } else {
    finalStatus = "failed";
  }

  await updateBatchTask(batchId, {
    status: finalStatus,
    completedItems: completedCount,
    failedItems: failedCount,
    errorMessage: failedCount > 0 ? `${failedCount} 个任务失败` : null,
    completedAt: new Date(),
  });

  console.log(`[批量任务] ${batchId} 完成，状态: ${finalStatus} (成功${completedCount}/${taskNumbers.length}，失败${failedCount})`);
}

/** 重试锁：防止同一子任务被并发重试 */
const _retryLocks = new Set<string>();

/**
 * 重试单个子任务
 */
export async function retryBatchItem(batchId: string, taskNumber: number): Promise<void> {
  const lockKey = `${batchId}:${taskNumber}`;
  if (_retryLocks.has(lockKey)) {
    throw new Error("该任务正在重试中，请稍候");
  }
  _retryLocks.add(lockKey);

  try {
    await _doRetryBatchItem(batchId, taskNumber);
  } finally {
    _retryLocks.delete(lockKey);
  }
}

async function _doRetryBatchItem(batchId: string, taskNumber: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 读取批量任务参数
  const tasks = await db.select().from(batchTasks).where(eq(batchTasks.id, batchId)).limit(1);
  if (tasks.length === 0) throw new Error("批量任务不存在");

  let params: BatchTaskInputParams;
  try {
    params = JSON.parse(tasks[0].inputParams);
  } catch {
    throw new Error("任务参数解析失败");
  }

  // 标记子任务为 running
  await updateBatchItem(batchId, taskNumber, {
    status: "running",
    chars: 0,
    error: null,
    filename: null,
    url: null,
    truncated: 0,
    completedAt: null,
  });

  // 获取配置
  const apiModel = params.apiModel || (await getConfig("apiModel")) || DEFAULT_CONFIG.apiModel;
  const apiKey = params.apiKey || (await getConfig("apiKey")) || DEFAULT_CONFIG.apiKey;
  const apiUrl = params.apiUrl || (await getConfig("apiUrl")) || DEFAULT_CONFIG.apiUrl;
  const config = { apiModel, apiKey, apiUrl };

  const batchFolderPath = params.storagePath
    ? `${params.storagePath}/${batchId}`
    : undefined;

  try {
    const itemParams: BatchItemParams = {
      taskNumber,
      roadmap: params.roadmap,
      templateType: params.templateType,
      filePrefix: params.filePrefix,
      namingMethod: params.namingMethod,
      customFileNames: params.customFileNames,
      files: params.files,
      sharedFiles: params.sharedFiles,
      batchFolderPath,
      config,
    };

    const result = await executeBatchItem(itemParams, (chars) => {
      updateBatchItem(batchId, taskNumber, { chars }).catch(() => {});
    });

    await updateBatchItem(batchId, taskNumber, {
      status: "completed",
      chars: result.chars,
      filename: result.filename,
      url: result.url || null,
      truncated: result.truncated ? 1 : 0,
      completedAt: new Date(),
    });

    // 用 SQL 原子操作更新批量任务计数（避免读-改-写竞态）
    try {
      await db.execute(sql`UPDATE batch_tasks SET
        completed_items = completed_items + 1,
        failed_items = GREATEST(0, failed_items - 1),
        error_message = CASE WHEN GREATEST(0, failed_items - 1) = 0 THEN NULL ELSE CONCAT(GREATEST(0, failed_items - 1), ' 个任务失败') END,
        status = CASE WHEN GREATEST(0, failed_items - 1) = 0 THEN 'completed' ELSE status END
        WHERE id = ${batchId}`);
    } catch (e: any) {
      console.error(`[批量任务] ${batchId} 更新计数失败:`, e?.message || e);
    }

    console.log(`[批量任务] ${batchId} 重试任务 ${taskNumber} 成功`);
  } catch (err: any) {
    await updateBatchItem(batchId, taskNumber, {
      status: "failed",
      error: err?.message || "重试失败",
      completedAt: new Date(),
    });
    console.error(`[批量任务] ${batchId} 重试任务 ${taskNumber} 失败:`, err?.message || err);
    throw err;
  }
}

/**
 * 清理旧批量任务 + 超时自愈
 */
export async function cleanupOldBatchTasks(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  // 先获取要删除的批量任务 ID
  const oldTasks = await db.select({ id: batchTasks.id })
    .from(batchTasks)
    .where(lt(batchTasks.createdAt, threeDaysAgo));

  if (oldTasks.length > 0) {
    const oldIds = oldTasks.map(t => t.id);
    // 批量删除子项和批量任务（单条 SQL，避免循环）
    await db.delete(batchTaskItems).where(inArray(batchTaskItems.batchId, oldIds));
    await db.delete(batchTasks).where(inArray(batchTasks.id, oldIds));
    console.log(`[批量任务] 清理了 ${oldTasks.length} 条旧批量任务`);
  }

  // 超时自愈：运行超过60分钟的任务标记为失败
  try {
    const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000);
    const staleResult = await db.update(batchTasks)
      .set({
        status: "failed",
        errorMessage: "任务超时（超过60分钟未完成）",
        completedAt: new Date(),
      })
      .where(and(
        eq(batchTasks.status, "running"),
        lt(batchTasks.createdAt, sixtyMinAgo)
      ));
    const staleCount = (staleResult as any)?.[0]?.affectedRows || 0;
    if (staleCount > 0) {
      console.log(`[批量任务] 超时自愈：标记 ${staleCount} 个超时批量任务为失败`);
    }
  } catch (err: any) {
    console.error("[批量任务] 超时自愈失败:", err?.message || err);
  }

  return oldTasks.length;
}

/**
 * 确保批量任务相关表存在
 */
export async function ensureBatchTables(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS \`batch_tasks\` (
      \`id\` varchar(36) NOT NULL,
      \`display_name\` varchar(200) NOT NULL,
      \`status\` varchar(20) NOT NULL DEFAULT 'pending',
      \`total_items\` int NOT NULL DEFAULT 0,
      \`completed_items\` int NOT NULL DEFAULT 0,
      \`failed_items\` int NOT NULL DEFAULT 0,
      \`input_params\` mediumtext NOT NULL,
      \`error_message\` text,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`completed_at\` timestamp NULL,
      PRIMARY KEY (\`id\`)
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS \`batch_task_items\` (
      \`id\` int AUTO_INCREMENT PRIMARY KEY,
      \`batch_id\` varchar(36) NOT NULL,
      \`task_number\` int NOT NULL,
      \`status\` varchar(20) NOT NULL DEFAULT 'pending',
      \`chars\` int DEFAULT 0,
      \`filename\` varchar(500),
      \`url\` text,
      \`error\` text,
      \`truncated\` int DEFAULT 0,
      \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`completed_at\` timestamp NULL,
      INDEX \`idx_batch_id\` (\`batch_id\`)
    )`);
    console.log("[批量任务] 表已就绪");
  } catch (err: any) {
    console.error("[批量任务] 建表失败:", err?.message || err);
  }
}

/**
 * 恢复中断的批量任务（服务器重启后）
 */
export async function recoverInterruptedBatchTasks(): Promise<void> {
  await ensureBatchTables();

  const db = await getDb();
  if (!db) return;

  try {
    const result = await db.update(batchTasks)
      .set({
        status: "failed",
        errorMessage: "服务器重启，任务被中断",
        completedAt: new Date(),
      })
      .where(eq(batchTasks.status, "running"));

    const result2 = await db.update(batchTasks)
      .set({
        status: "failed",
        errorMessage: "服务器重启，任务未能启动",
        completedAt: new Date(),
      })
      .where(eq(batchTasks.status, "pending"));

    // 也把子项中 running 的标记为失败
    await db.update(batchTaskItems)
      .set({
        status: "failed",
        error: "服务器重启，任务被中断",
        completedAt: new Date(),
      })
      .where(eq(batchTaskItems.status, "running"));

    const count = (result as any)?.[0]?.affectedRows || 0;
    const count2 = (result2 as any)?.[0]?.affectedRows || 0;
    if (count + count2 > 0) {
      console.log(`[批量任务] 恢复了 ${count} 个中断的批量任务, ${count2} 个未启动的批量任务`);
    }
  } catch (err: any) {
    console.error("[批量任务] 恢复中断任务失败:", err?.message || err);
  }
}
