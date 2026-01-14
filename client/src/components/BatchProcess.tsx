import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { 
  Play, 
  Settings,
  FileText,
  FolderOpen,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink
} from "lucide-react";

// 任务状态类型
type TaskStatus = 'waiting' | 'running' | 'completed' | 'error';

// 单个任务的状态
interface TaskState {
  taskNumber: number;
  status: TaskStatus;
  chars: number;
  message?: string;
  filename?: string;
  url?: string;
  error?: string;
}

// 批次状态
interface BatchState {
  batchId: string;
  totalTasks: number;
  concurrency: number;
  completed: number;
  failed: number;
}

export function BatchProcess() {
  // 基本设置
  const [startNumber, setStartNumber] = useState("");
  const [endNumber, setEndNumber] = useState("");
  const [concurrency, setConcurrency] = useState("5");
  const [storagePath, setStoragePath] = useState("");
  
  // 路书内容
  const [roadmap, setRoadmap] = useState("");

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [batchState, setBatchState] = useState<BatchState | null>(null);
  const [tasks, setTasks] = useState<Map<number, TaskState>>(new Map());

  // 根据状态分类任务
  const runningTasks = Array.from(tasks.values()).filter(t => t.status === 'running');
  const completedTasks = Array.from(tasks.values()).filter(t => t.status === 'completed');
  const errorTasks = Array.from(tasks.values()).filter(t => t.status === 'error');
  const waitingTasks = Array.from(tasks.values()).filter(t => t.status === 'waiting');

  const handleStart = useCallback(async () => {
    // 验证参数
    const start = parseInt(startNumber);
    const end = parseInt(endNumber);
    const concurrencyNum = parseInt(concurrency) || 5;

    if (isNaN(start) || isNaN(end)) {
      alert("请输入有效的任务编号范围");
      return;
    }
    if (start > end) {
      alert("起始编号不能大于结束编号");
      return;
    }
    if (!roadmap.trim()) {
      alert("请输入路书内容");
      return;
    }

    // 初始化任务列表
    const initialTasks = new Map<number, TaskState>();
    for (let i = start; i <= end; i++) {
      initialTasks.set(i, {
        taskNumber: i,
        status: 'waiting',
        chars: 0,
      });
    }

    // 重置状态
    setIsGenerating(true);
    setBatchState(null);
    setTasks(initialTasks);

    try {
      // 调用 SSE 端点
      const response = await fetch('/api/batch/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startNumber: start,
          endNumber: end,
          concurrency: concurrencyNum,
          roadmap: roadmap.trim(),
          storagePath: storagePath.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`请求失败: HTTP ${response.status}`);
      }

      // 读取 SSE 流式响应
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      
      // 事件类型在循环外部跟踪（V45b 教训）
      let currentEventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          // 用 event: 行判断事件类型（V45b 教训）
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              // 根据事件类型处理
              if (currentEventType === 'batch-start') {
                setBatchState({
                  batchId: data.batchId,
                  totalTasks: data.totalTasks,
                  concurrency: data.concurrency,
                  completed: 0,
                  failed: 0,
                });
              } else if (currentEventType === 'task-start') {
                setTasks(prev => {
                  const newTasks = new Map(prev);
                  const task = newTasks.get(data.taskNumber);
                  if (task) {
                    newTasks.set(data.taskNumber, {
                      ...task,
                      status: 'running',
                      message: data.message,
                    });
                  }
                  return newTasks;
                });
              } else if (currentEventType === 'task-progress') {
                setTasks(prev => {
                  const newTasks = new Map(prev);
                  const task = newTasks.get(data.taskNumber);
                  if (task) {
                    newTasks.set(data.taskNumber, {
                      ...task,
                      chars: data.chars || task.chars,
                      message: data.message || task.message,
                    });
                  }
                  return newTasks;
                });
              } else if (currentEventType === 'task-complete') {
                setTasks(prev => {
                  const newTasks = new Map(prev);
                  const task = newTasks.get(data.taskNumber);
                  if (task) {
                    newTasks.set(data.taskNumber, {
                      ...task,
                      status: 'completed',
                      chars: data.chars || task.chars,
                      filename: data.filename,
                      url: data.url,
                    });
                  }
                  return newTasks;
                });
                setBatchState(prev => prev ? { ...prev, completed: prev.completed + 1 } : null);
              } else if (currentEventType === 'task-error') {
                setTasks(prev => {
                  const newTasks = new Map(prev);
                  const task = newTasks.get(data.taskNumber);
                  if (task) {
                    newTasks.set(data.taskNumber, {
                      ...task,
                      status: 'error',
                      error: data.error,
                    });
                  }
                  return newTasks;
                });
                setBatchState(prev => prev ? { ...prev, failed: prev.failed + 1 } : null);
              } else if (currentEventType === 'batch-complete') {
                setBatchState(prev => prev ? {
                  ...prev,
                  completed: data.completed,
                  failed: data.failed,
                } : null);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

    } catch (error: any) {
      console.error('批量处理失败:', error);
      alert(`批量处理失败: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  }, [startNumber, endNumber, concurrency, roadmap, storagePath]);

  // 渲染单个任务卡片
  const renderTaskCard = (task: TaskState) => {
    const statusConfig = {
      waiting: { icon: Clock, color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200' },
      running: { icon: Loader2, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
      completed: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
      error: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    };
    const config = statusConfig[task.status];
    const Icon = config.icon;

    return (
      <div 
        key={task.taskNumber}
        className={`flex items-center gap-3 p-3 rounded-lg border ${config.bg} ${config.border}`}
      >
        <Icon className={`w-5 h-5 ${config.color} ${task.status === 'running' ? 'animate-spin' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800">#{task.taskNumber}</span>
            {task.status === 'running' && (
              <span className="text-sm text-blue-600">
                生成中... {task.chars > 0 && `已收到 ${task.chars} 字`}
              </span>
            )}
            {task.status === 'completed' && (
              <span className="text-sm text-green-600">
                完成 ({task.chars} 字)
              </span>
            )}
            {task.status === 'error' && (
              <span className="text-sm text-red-600 truncate">
                {task.error || '失败'}
              </span>
            )}
            {task.status === 'waiting' && (
              <span className="text-sm text-gray-500">等待中</span>
            )}
          </div>
          {task.filename && (
            <div className="text-xs text-gray-500 truncate">{task.filename}</div>
          )}
        </div>
        {task.url && (
          <a 
            href={task.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    );
  };

  return (
    <Card className="shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          批量处理
        </CardTitle>
        <CardDescription>
          批量生成多个学生的学情反馈文档，支持并发处理
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* 基本设置区域 */}
        <div className="bg-gray-50 p-4 rounded-lg space-y-4">
          <h3 className="font-semibold text-gray-700 flex items-center gap-2">
            <Settings className="w-4 h-4" />
            基本设置
          </h3>
          
          {/* 任务编号范围 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startNumber">起始任务编号</Label>
              <Input
                id="startNumber"
                type="number"
                placeholder="例如：1"
                value={startNumber}
                onChange={(e) => setStartNumber(e.target.value)}
                disabled={isGenerating}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="endNumber">结束任务编号</Label>
              <Input
                id="endNumber"
                type="number"
                placeholder="例如：10"
                value={endNumber}
                onChange={(e) => setEndNumber(e.target.value)}
                disabled={isGenerating}
              />
            </div>
          </div>
          
          {/* 并发数和存储路径 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="concurrency">并发数</Label>
              <Input
                id="concurrency"
                type="number"
                placeholder="默认：5"
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
                disabled={isGenerating}
              />
              <p className="text-xs text-gray-500">同时处理的任务数量，建议3-5</p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="storagePath">存储路径</Label>
              <div className="flex gap-2">
                <Input
                  id="storagePath"
                  placeholder="Google Drive 文件夹路径"
                  value={storagePath}
                  onChange={(e) => setStoragePath(e.target.value)}
                  className="flex-1"
                  disabled={isGenerating}
                />
                <Button type="button" variant="outline" size="icon" disabled={isGenerating}>
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
        
        {/* 路书输入区域 */}
        <div className="space-y-2">
          <Label htmlFor="roadmap" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            路书内容
          </Label>
          <Textarea
            id="roadmap"
            placeholder="粘贴路书内容，包含学生信息和课堂笔记..."
            value={roadmap}
            onChange={(e) => setRoadmap(e.target.value)}
            className="min-h-[200px] font-mono text-sm"
            disabled={isGenerating}
          />
          <p className="text-xs text-gray-500">
            路书格式：每个任务用分隔符分开，包含学生姓名、课次、课堂笔记等信息
          </p>
        </div>

        {/* 批次状态概览 */}
        {batchState && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-blue-800">
                  批次 {batchState.batchId}
                </p>
                <p className="text-sm text-blue-600">
                  共 {batchState.totalTasks} 个任务，并发 {batchState.concurrency}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm">
                  <span className="text-green-600 font-medium">{batchState.completed} 完成</span>
                  {batchState.failed > 0 && (
                    <span className="text-red-600 font-medium ml-2">{batchState.failed} 失败</span>
                  )}
                </p>
                <p className="text-xs text-gray-500">
                  {batchState.completed + batchState.failed} / {batchState.totalTasks}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 任务进度显示 */}
        {tasks.size > 0 && (
          <div className="space-y-4">
            {/* 执行中的任务 */}
            {runningTasks.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  执行中 ({runningTasks.length})
                </h4>
                <div className="space-y-2">
                  {runningTasks.map(renderTaskCard)}
                </div>
              </div>
            )}

            {/* 等待中的任务 */}
            {waitingTasks.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-400" />
                  等待中 ({waitingTasks.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {waitingTasks.map(task => (
                    <span 
                      key={task.taskNumber}
                      className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded"
                    >
                      #{task.taskNumber}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 已完成的任务 */}
            {completedTasks.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  已完成 ({completedTasks.length})
                </h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {completedTasks.map(renderTaskCard)}
                </div>
              </div>
            )}

            {/* 失败的任务 */}
            {errorTasks.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-600" />
                  失败 ({errorTasks.length})
                </h4>
                <div className="space-y-2">
                  {errorTasks.map(renderTaskCard)}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* 开始按钮 */}
        <div className="flex justify-center pt-4">
          <Button 
            onClick={handleStart}
            size="lg"
            className="px-8"
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <Play className="w-5 h-5 mr-2" />
                开始批量生成
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
