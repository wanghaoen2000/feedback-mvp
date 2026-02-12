/**
 * 并发池模块
 * 控制任务并发执行，支持动态添加任务和进度回调
 */

/**
 * 任务执行结果
 */
export interface TaskResult<T> {
  taskNumber: number;
  success: boolean;
  result?: T;
  error?: Error;
}

/**
 * 任务执行器类型
 * @param taskNumber 任务编号
 * @param onProgress 进度回调（字符数）
 * @returns 任务结果
 */
export type TaskExecutor<T> = (
  taskNumber: number,
  onProgress: (chars: number) => void
) => Promise<T>;

/**
 * 进度回调类型
 * @param taskNumber 任务编号
 * @param chars 当前字符数
 */
export type ProgressCallback = (taskNumber: number, chars: number) => void;

/**
 * 完成回调类型
 * @param taskNumber 任务编号
 * @param result 任务结果
 */
export type CompleteCallback<T> = (taskNumber: number, result: TaskResult<T>) => void | Promise<void>;

/**
 * 并发池类
 * 管理任务队列，控制并发执行数量
 */
export class ConcurrencyPool<T = any> {
  private concurrency: number;
  private queue: number[] = [];
  private running: Set<number> = new Set();
  private results: Map<number, TaskResult<T>> = new Map();
  private stopped: boolean = false;

  /**
   * 创建并发池
   * @param concurrency 最大并发数
   */
  constructor(concurrency: number) {
    if (concurrency < 1) {
      throw new Error("并发数必须大于0");
    }
    this.concurrency = concurrency;
  }

  /**
   * 添加任务到队列
   * @param taskNumbers 任务编号数组
   */
  addTasks(taskNumbers: number[]): void {
    this.queue.push(...taskNumbers);
  }

  /**
   * 获取队列中的任务数
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * 获取正在运行的任务数
   */
  getRunningCount(): number {
    return this.running.size;
  }

  /**
   * 停止执行（清空等待队列，但不中断正在执行的任务）
   */
  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.stopped = false;
    this.queue = [];
    this.running.clear();
    this.results.clear();
  }

  /**
   * 执行所有任务
   * @param taskExecutor 任务执行函数
   * @param onProgress 进度回调（可选）
   * @param onComplete 完成回调（可选）
   * @returns 所有任务的结果
   */
  async execute(
    taskExecutor: TaskExecutor<T>,
    onProgress?: ProgressCallback,
    onComplete?: CompleteCallback<T>
  ): Promise<TaskResult<T>[]> {
    this.stopped = false;
    this.results.clear();

    // 创建一个 Promise 来等待所有任务完成
    return new Promise((resolve) => {
      const totalTasks = this.queue.length;
      let completedCount = 0;

      // 检查是否所有任务都完成了
      const checkCompletion = () => {
        if (completedCount >= totalTasks || (this.stopped && this.running.size === 0)) {
          // 按任务编号排序返回结果
          const sortedResults = Array.from(this.results.values()).sort(
            (a, b) => a.taskNumber - b.taskNumber
          );
          resolve(sortedResults);
        }
      };

      // 执行单个任务
      const runTask = async (taskNumber: number) => {
        this.running.add(taskNumber);

        const result: TaskResult<T> = {
          taskNumber,
          success: false,
        };

        try {
          // 创建进度回调包装器
          const progressWrapper = (chars: number) => {
            if (onProgress) {
              onProgress(taskNumber, chars);
            }
          };

          // 执行任务
          const taskResult = await taskExecutor(taskNumber, progressWrapper);
          result.success = true;
          result.result = taskResult;
        } catch (error) {
          result.success = false;
          result.error = error instanceof Error ? error : new Error(String(error));
          console.error(`[ConcurrencyPool] 任务 ${taskNumber} 失败:`, result.error.message);
        }

        // 任务完成
        this.running.delete(taskNumber);
        this.results.set(taskNumber, result);
        completedCount++;

        // 调用完成回调（支持异步）
        if (onComplete) {
          try {
            await onComplete(taskNumber, result);
          } catch (e) {
            console.error(`[ConcurrencyPool] onComplete 回调异常 (任务 ${taskNumber}):`, e);
          }
        }

        // 如果没有停止，尝试启动下一个任务
        if (!this.stopped) {
          startNextTask();
        }

        // 检查是否全部完成
        checkCompletion();
      };

      // 启动下一个任务
      const startNextTask = () => {
        if (this.stopped) return;
        if (this.running.size >= this.concurrency) return;
        if (this.queue.length === 0) return;

        const nextTask = this.queue.shift();
        if (nextTask !== undefined) {
          runTask(nextTask);
          // 继续尝试填满并发池
          startNextTask();
        }
      };

      // 如果没有任务，直接返回
      if (totalTasks === 0) {
        resolve([]);
        return;
      }

      // 初始填满并发池
      startNextTask();
    });
  }
}
