import React, { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { 
  Play, 
  Square,
  Settings,
  FileText,
  FolderOpen,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  Upload,
  File,
  Image,
  Trash2,
  Copy,
  Check
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
  truncated?: boolean;  // 内容是否因token上限被截断
}

// 上传文件类型
interface UploadedFile {
  originalName: string;
  mimeType: string;
  size: number;
  type: 'document' | 'image';
  url?: string;
  base64DataUri?: string;
  error?: string;
}

// 批次状态
interface BatchState {
  batchId: string;
  totalTasks: number;
  concurrency: number;
  completed: number;
  failed: number;
  stopped?: boolean;
}

// 模板格式说明
const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  markdown_styled: `【适用场景】带紫色标题、表头背景色的教学文档

【AI输出格式】普通Markdown文本

【支持的语法】
# 一级标题（紫色）  ## 二级标题  ### 三级标题
**粗体**  *斜体*  ***粗斜体***
- 无序列表   1. 有序列表
> 引用块（橙色▸标记）
| 表头1 | 表头2 |  ← 表头有浅紫背景
| --- | --- |
| 数据1 | 数据2 |
---（分页符）

【输出文件】.docx`,

  markdown_plain: `【适用场景】黑白简洁的通用文档

【AI输出格式】普通Markdown文本

【支持的语法】
# 一级标题  ## 二级标题  ### 三级标题
**粗体**  *斜体*  ***粗斜体***
- 无序列表   1. 有序列表
> 引用块
| 表头1 | 表头2 |
| --- | --- |
| 数据1 | 数据2 |
---（分页符）

【输出文件】.docx（无颜色样式）`,

  markdown_file: `【适用场景】直接输出Markdown源文件，不转换为Word

【AI输出格式】普通Markdown文本

【支持的语法】所有标准Markdown语法
# 标题  **粗体**  *斜体*
- 列表   > 引用   \`代码\`
[链接](url)   ![图片](url)

【输出文件】.md

【注意】文件内容即AI输出的原始文本，不做任何转换`,

  word_card: `【适用场景】托福/雅思词汇表，双栏卡片布局，紫色主题

【AI输出格式】⚠️ 纯JSON（禁止输出\`\`\`json标记！）

【JSON结构】
{
  "listNumber": 1,
  "sceneName": "场景名称",
  "wordCount": 25,
  "words": [{
    "num": 1,
    "word": "example",
    "phonetic": "/ɪɡˈzæmpl/",
    "pos": "n.",
    "meaning": "例子",
    "example": "This is an example.",
    "translation": "这是一个例子。"
  }]
}

【关键要求】
⚠️ 只输出纯JSON，不要任何解释文字
⚠️ 不要输出\`\`\`json代码块标记
⚠️ JSON必须能被JSON.parse()直接解析

【输出文件】.docx（双栏卡片布局）`,

  writing_material: `【适用场景】托福写作邮件素材，分类层级结构

【AI输出格式】⚠️ 纯JSON（禁止输出\`\`\`json标记！）

【JSON结构】
{
  "partNum": 1,
  "partTitle": "Part 标题",
  "listNum": 1,
  "listTitle": "List 标题",
  "bookmarkId": "唯一书签ID",
  "categories": [{
    "categoryTitle": "分类标题",
    "sections": [{
      "sectionTitle": "小节标题",
      "items": [{
        "english": "English expression",
        "chinese": "中文释义"
      }]
    }]
  }]
}

【关键要求】
⚠️ 只输出纯JSON，不要任何解释文字
⚠️ 不要输出\`\`\`json代码块标记
⚠️ JSON必须能被JSON.parse()直接解析

【输出文件】.docx（层级结构文档）`,
};

export function BatchProcess() {
  // 基本设置
  const [templateType, setTemplateType] = useState<'markdown_plain' | 'markdown_styled' | 'markdown_file' | 'word_card' | 'writing_material'>('markdown_styled');
  const [startNumber, setStartNumber] = useState("");
  const [endNumber, setEndNumber] = useState("");
  const [concurrency, setConcurrency] = useState("5");
  const [storagePath, setStoragePath] = useState("Mac(online)/Documents/XDF/批量任务");
  const [isPathSaving, setIsPathSaving] = useState(false);
  const [filePrefix, setFilePrefix] = useState("任务");
  const [isPrefixSaving, setIsPrefixSaving] = useState(false);

  // 复制格式说明状态
  const [copied, setCopied] = useState(false);

  // 文件命名方式
  const [namingMethod, setNamingMethod] = useState<'prefix' | 'custom'>('prefix');
  const [customNames, setCustomNames] = useState<string>('');
  const [parsedNames, setParsedNames] = useState<Map<number, string>>(new Map());

  // 从数据库加载配置
  const { data: config } = trpc.config.getAll.useQuery();
  const updateConfig = trpc.config.update.useMutation();

  // 加载配置后更新前缀和存储路径
  useEffect(() => {
    if (config?.batchFilePrefix) {
      setFilePrefix(config.batchFilePrefix);
    }
  }, [config?.batchFilePrefix]);

  useEffect(() => {
    // 如果数据库有保存的路径，使用保存的值；否则保持默认值
    if (config?.batchStoragePath) {
      setStoragePath(config.batchStoragePath);
    }
  }, [config?.batchStoragePath]);
  
  // 路书内容
  const [roadmap, setRoadmap] = useState("");

  // 独立文件上传（每个任务对应不同文件）
  const [uploadedFiles, setUploadedFiles] = useState<Map<number, UploadedFile>>(new Map());
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // 共享文件上传（发送给所有任务）
  const [sharedFiles, setSharedFiles] = useState<UploadedFile[]>([]);
  const [isUploadingShared, setIsUploadingShared] = useState(false);
  const [sharedUploadError, setSharedUploadError] = useState<string | null>(null);
  const sharedFileInputRef = React.useRef<HTMLInputElement>(null);

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [batchState, setBatchState] = useState<BatchState | null>(null);
  const [tasks, setTasks] = useState<Map<number, TaskState>>(new Map());

  // 根据状态分类任务
  const runningTasks = Array.from(tasks.values()).filter(t => t.status === 'running');
  const completedTasks = Array.from(tasks.values()).filter(t => t.status === 'completed');
  const errorTasks = Array.from(tasks.values()).filter(t => t.status === 'error');
  const waitingTasks = Array.from(tasks.values()).filter(t => t.status === 'waiting');
  const truncatedTasks = Array.from(tasks.values()).filter(t => t.truncated === true);

  // 文件上传处理
  const handleFileUpload = useCallback(async (files: FileList) => {
    const start = parseInt(startNumber) || 1;
    const end = parseInt(endNumber) || start;
    
    setIsUploading(true);
    setUploadError(null);
    
    try {
      const formData = new FormData();
      Array.from(files).forEach(file => formData.append('files', file));
      
      const response = await fetch('/api/batch/upload-files', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (!result.success) {
        setUploadError(result.error || '上传失败');
        return;
      }
      
      // 过滤掉有错误的文件，按文件名排序
      const successFiles = result.files
        .filter((f: UploadedFile) => !f.error)
        .sort((a: UploadedFile, b: UploadedFile) => 
          a.originalName.localeCompare(b.originalName, 'zh-CN')
        );
      
      // 分配给任务编号
      const fileMap = new Map<number, UploadedFile>();
      successFiles.forEach((file: UploadedFile, index: number) => {
        const taskNumber = start + index;
        if (taskNumber <= end) {
          fileMap.set(taskNumber, file);
        }
      });
      
      setUploadedFiles(fileMap);
      
      // 检查是否有上传失败的文件
      const errorFiles = result.files.filter((f: UploadedFile) => f.error);
      if (errorFiles.length > 0) {
        setUploadError(`${errorFiles.length} 个文件上传失败`);
      }
    } catch (error: any) {
      console.error('文件上传错误:', error);
      setUploadError(error.message || '上传失败');
    } finally {
      setIsUploading(false);
    }
  }, [startNumber, endNumber]);

  // 清空独立文件
  const handleClearFiles = useCallback(() => {
    setUploadedFiles(new Map());
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // 处理共享文件上传
  const handleSharedFileUpload = useCallback(async (files: FileList) => {
    setIsUploadingShared(true);
    setSharedUploadError(null);
    
    try {
      const formData = new FormData();
      Array.from(files).forEach(file => formData.append('files', file));
      
      const response = await fetch('/api/batch/upload-files', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (!result.success) {
        setSharedUploadError(result.error || '上传失败');
        return;
      }
      
      // 过滤掉有错误的文件
      const successFiles = result.files.filter((f: UploadedFile) => !f.error);
      
      // 追加到现有共享文件列表
      setSharedFiles(prev => [...prev, ...successFiles]);
      
      // 检查是否有上传失败的文件
      const errorFiles = result.files.filter((f: UploadedFile) => f.error);
      if (errorFiles.length > 0) {
        setSharedUploadError(`${errorFiles.length} 个文件上传失败`);
      }
    } catch (error: any) {
      console.error('共享文件上传错误:', error);
      setSharedUploadError(error.message || '上传失败');
    } finally {
      setIsUploadingShared(false);
    }
  }, []);

  // 清空共享文件
  const handleClearSharedFiles = useCallback(() => {
    setSharedFiles([]);
    setSharedUploadError(null);
    if (sharedFileInputRef.current) {
      sharedFileInputRef.current.value = '';
    }
  }, []);

  // 停止处理
  const handleStop = useCallback(async () => {
    if (!batchState?.batchId) return;
    
    setIsStopping(true);
    
    try {
      const response = await fetch('/api/batch/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: batchState.batchId }),
      });

      if (!response.ok) {
        const data = await response.json();
        console.error('停止失败:', data.error);
      } else {
        console.log('停止信号已发送');
        // 将等待中的任务标记为已取消（显示为灰色）
        setTasks(prev => {
          const newTasks = new Map(prev);
          Array.from(newTasks.entries()).forEach(([taskNumber, task]) => {
            if (task.status === 'waiting') {
              newTasks.set(taskNumber, {
                ...task,
                status: 'error',
                error: '已取消',
              });
            }
          });
          return newTasks;
        });
      }
    } catch (error: any) {
      console.error('停止请求失败:', error.message);
    }
  }, [batchState?.batchId]);

  // 复制格式说明到剪贴板
  const handleCopyDescription = async () => {
    const text = TEMPLATE_DESCRIPTIONS[templateType];
    if (text) {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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
    setIsStopping(false);
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
          filePrefix: filePrefix.trim() || '任务',
          templateType: templateType,
          // 如果使用自定义命名，传递 customFileNames
          customFileNames: namingMethod === 'custom' ? Object.fromEntries(parsedNames) : undefined,
          // 传递上传的独立文件信息
          files: uploadedFiles.size > 0 ? Object.fromEntries(
            Array.from(uploadedFiles.entries()).map(([taskNum, file]) => [
              taskNum,
              {
                type: file.type,
                url: file.url,
                base64DataUri: file.base64DataUri,
                mimeType: file.mimeType,
              }
            ])
          ) : undefined,
          // 传递共享文件信息
          sharedFiles: sharedFiles.length > 0 ? sharedFiles.map(file => ({
            type: file.type,
            url: file.url,
            base64DataUri: file.base64DataUri,
            mimeType: file.mimeType,
          })) : undefined,
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
                      truncated: data.truncated || false,  // 记录截断状态
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
                  stopped: data.stopped,
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
      setIsStopping(false);
    }
  }, [startNumber, endNumber, concurrency, roadmap, storagePath, filePrefix, templateType, namingMethod, parsedNames, uploadedFiles, sharedFiles]);

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
              <span className={`text-sm ${task.truncated ? 'text-yellow-600' : 'text-green-600'}`}>
                {task.truncated ? '⚠️ 完成但被截断' : '完成'} ({task.chars} 字)
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
          批量生成文档，支持并发处理
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* 基本设置区域 */}
        <div className="bg-gray-50 p-4 rounded-lg space-y-4">
          <h3 className="font-semibold text-gray-700 flex items-center gap-2">
            <Settings className="w-4 h-4" />
            基本设置
          </h3>
          
          {/* 模板类型选择 */}
          <div className="space-y-2">
            <Label htmlFor="templateType">模板类型</Label>
            <select
              id="templateType"
              value={templateType}
              onChange={(e) => {
                const value = e.target.value as 'markdown_plain' | 'markdown_styled' | 'markdown_file' | 'word_card' | 'writing_material';
                setTemplateType(value);
                console.log('模板类型已切换:', value);
              }}
              disabled={isGenerating}
              className="w-full h-10 px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="markdown_styled">教学材料（带样式）</option>
              <option value="markdown_plain">通用文档（无样式）</option>
              <option value="markdown_file">生成MD文件（不转换）</option>
              <option value="word_card">词汇卡片（精确排版）</option>
              <option value="writing_material">写作素材模板</option>
            </select>
            {/* 模板格式说明 */}
            <div className="mt-2">
              <div className="text-sm text-gray-500 mb-1">格式说明：</div>
              <div className="relative">
                {/* 复制按钮 */}
                <button
                  onClick={handleCopyDescription}
                  className="absolute top-2 right-2 p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-700 z-10"
                  title="复制格式说明"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                
                {/* 说明内容 */}
                <div 
                  className="bg-gray-50 border rounded p-3 pr-10 font-mono text-xs whitespace-pre-wrap overflow-y-auto"
                  style={{ height: '120px' }}
                >
                  {TEMPLATE_DESCRIPTIONS[templateType] || '请选择模板类型'}
                </div>
              </div>
            </div>
          </div>

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

          {/* 并发数和文件名前缀 */}
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
              <Label>文件命名方式</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="namingMethod"
                    value="prefix"
                    checked={namingMethod === 'prefix'}
                    onChange={() => setNamingMethod('prefix')}
                    disabled={isGenerating}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm">前缀+编号</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="namingMethod"
                    value="custom"
                    checked={namingMethod === 'custom'}
                    onChange={() => setNamingMethod('custom')}
                    disabled={isGenerating}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm">从文本解析</span>
                </label>
              </div>
            </div>
          </div>

          {/* 前缀+编号方式 */}
          {namingMethod === 'prefix' && (
            <div className="space-y-2">
              <Label htmlFor="filePrefix">文件名前缀</Label>
              <Input
                id="filePrefix"
                type="text"
                placeholder="如：生词表、练习册"
                value={filePrefix}
                onChange={(e) => setFilePrefix(e.target.value)}
                onBlur={async () => {
                  if (filePrefix !== config?.batchFilePrefix) {
                    setIsPrefixSaving(true);
                    try {
                      await updateConfig.mutateAsync({ batchFilePrefix: filePrefix });
                    } catch (e) {
                      console.error('保存前缀失败:', e);
                    } finally {
                      setIsPrefixSaving(false);
                    }
                  }
                }}
                disabled={isGenerating}
              />
              <p className="text-xs text-gray-500">
                {isPrefixSaving ? '保存中...' : '文件命名格式：{前缀}01.docx'}
              </p>
            </div>
          )}

          {/* 从文本解析方式 */}
          {namingMethod === 'custom' && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="customNames">文件名列表（一行一个）</Label>
                <Textarea
                  id="customNames"
                  placeholder="模块B讲义&#10;模块B练习册&#10;&#10;模块C讲义"
                  value={customNames}
                  onChange={(e) => setCustomNames(e.target.value)}
                  className="h-28 font-mono text-sm"
                  disabled={isGenerating}
                />
                <p className="text-xs text-gray-500">
                  第1行对应起始任务编号，空行使用默认值「任务XX」
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const start = parseInt(startNumber) || 1;
                  const end = parseInt(endNumber) || start;
                  const lines = customNames.split('\n');
                  const newParsedNames = new Map<number, string>();
                  
                  for (let i = start; i <= end; i++) {
                    const lineIndex = i - start;
                    const rawName = lines[lineIndex] || '';
                    // 过滤非法字符：\ / : * ? " < > |
                    const cleanName = rawName.trim().replace(/[\\/:*?"<>|]/g, '');
                    if (cleanName) {
                      newParsedNames.set(i, cleanName);
                    }
                    // 空行不设置，后端会使用默认值
                  }
                  
                  setParsedNames(newParsedNames);
                }}
                disabled={isGenerating || !startNumber || !endNumber}
              >
                确认文件名
              </Button>

              {/* 文件名预览 */}
              {parsedNames.size > 0 && (
                <div className="space-y-2">
                  <Label>文件名预览</Label>
                  <div className="bg-gray-100 rounded-md p-3 max-h-40 overflow-y-auto">
                    {(() => {
                      const start = parseInt(startNumber) || 1;
                      const end = parseInt(endNumber) || start;
                      const ext = templateType === 'markdown_file' ? '.md' : '.docx';
                      const previews: React.ReactNode[] = [];
                      
                      for (let i = start; i <= end; i++) {
                        const customName = parsedNames.get(i);
                        const displayName = customName || `任务${i.toString().padStart(2, '0')}`;
                        const isDefault = !customName;
                        
                        previews.push(
                          <div key={i} className="text-sm font-mono flex items-center gap-2">
                            <span className="text-gray-500 w-16">任务{i}</span>
                            <span className="text-gray-400">→</span>
                            <span className={isDefault ? 'text-gray-400' : 'text-gray-700'}>
                              {displayName}{ext}
                              {isDefault && <span className="text-xs ml-1">(默认)</span>}
                            </span>
                          </div>
                        );
                      }
                      
                      return previews;
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 存储路径 */}
          <div className="space-y-2">
            <Label htmlFor="storagePath">存储路径</Label>
            <div className="flex gap-2">
              <Input
                id="storagePath"
                type="text"
                placeholder="Google Drive 文件夹路径"
                value={storagePath}
                onChange={(e) => setStoragePath(e.target.value)}
                onBlur={async () => {
                  const trimmedPath = storagePath.trim();
                  // 如果为空，恢复默认值
                  if (!trimmedPath) {
                    setStoragePath("Mac(online)/Documents/XDF/批量任务");
                    return;
                  }
                  // 如果值有变化，保存到数据库
                  if (trimmedPath !== config?.batchStoragePath) {
                    setIsPathSaving(true);
                    try {
                      await updateConfig.mutateAsync({ batchStoragePath: trimmedPath });
                    } catch (e) {
                      console.error('保存存储路径失败:', e);
                    } finally {
                      setIsPathSaving(false);
                    }
                  }
                }}
                disabled={isGenerating}
              />
              <Button variant="outline" size="icon" disabled={isGenerating}>
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              {isPathSaving ? '保存中...' : '文件将上传到此 Google Drive 路径'}
            </p>
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
            className="h-36 overflow-y-auto resize-none font-mono text-sm"
            disabled={isGenerating}
          />
          <p className="text-xs text-gray-500">
            路书格式：每个任务用分隔符分开，包含学生姓名、课次、课堂笔记等信息
          </p>
        </div>

        {/* 配套文件上传 */}
        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            配套文件上传（可选）
          </Label>

          {/* 共享文件区域 */}
          <div className="border rounded-lg p-4 space-y-3 bg-purple-50/30">
            <Label className="flex items-center gap-2 text-purple-700">
              <FolderOpen className="w-4 h-4" />
              共享文件（发送给所有任务）
            </Label>
            
            {/* 隐藏的文件输入 */}
            <input
              type="file"
              multiple
              accept=".docx,.md,.txt,.pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => e.target.files && handleSharedFileUpload(e.target.files)}
              style={{ display: 'none' }}
              ref={sharedFileInputRef}
            />
            
            {/* 上传按钮 */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => !isUploadingShared && !isGenerating && sharedFileInputRef.current?.click()}
                disabled={isUploadingShared || isGenerating}
                className="flex items-center gap-1"
              >
                {isUploadingShared ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                选择文件
              </Button>
              
              {sharedFiles.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearSharedFiles}
                  disabled={isGenerating || isUploadingShared}
                  className="flex items-center gap-1 text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                  清空
                </Button>
              )}
            </div>
            
            {/* 错误提示 */}
            {sharedUploadError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
                <XCircle className="w-4 h-4" />
                {sharedUploadError}
              </div>
            )}
            
            {/* 已上传文件列表 */}
            {sharedFiles.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-gray-500">已上传 {sharedFiles.length} 个文件：</p>
                <div className="flex flex-wrap gap-2">
                  {sharedFiles.map((file, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded border text-sm"
                    >
                      {file.type === 'image' ? (
                        <Image className="w-3 h-3 text-green-500" />
                      ) : (
                        <File className="w-3 h-3 text-blue-500" />
                      )}
                      {file.originalName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 独立文件区域 */}
          <div className="border rounded-lg p-4 space-y-3 bg-blue-50/30">
            <Label className="flex items-center gap-2 text-blue-700">
              <FolderOpen className="w-4 h-4" />
              独立文件（每个任务对应不同文件，按文件名排序）
            </Label>
            
            {/* 隐藏的文件输入 */}
            <input
              type="file"
              multiple
              accept=".docx,.md,.txt,.pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
              style={{ display: 'none' }}
              ref={fileInputRef}
            />
            
            {/* 上传区域 */}
            <div
              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                isUploading ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
              }`}
              onClick={() => !isUploading && !isGenerating && fileInputRef.current?.click()}
            >
              {isUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                  <p className="text-sm text-blue-600">正在上传...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <Upload className="w-6 h-6 text-gray-400" />
                  <p className="text-sm text-gray-600">点击选择文件</p>
                  <p className="text-xs text-gray-400">
                    支持：docx/md/txt/pdf/png/jpg/webp
                  </p>
                </div>
              )}
            </div>
            
            {/* 错误提示 */}
            {uploadError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
                <XCircle className="w-4 h-4" />
                {uploadError}
              </div>
            )}
            
            {/* 清空按钮 */}
            {uploadedFiles.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFiles}
                disabled={isGenerating || isUploading}
                className="flex items-center gap-1 text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
                清空
              </Button>
            )}
            
            {/* 上传预览 */}
            {(uploadedFiles.size > 0 || (startNumber && endNumber)) && (
              <div className="space-y-2">
                <Label className="text-sm">上传预览</Label>
                <div className="bg-white rounded-md p-3 max-h-32 overflow-y-auto border">
                  {(() => {
                    const start = parseInt(startNumber) || 1;
                    const end = parseInt(endNumber) || start;
                    const previews: React.ReactNode[] = [];
                    
                    for (let i = start; i <= end; i++) {
                      const file = uploadedFiles.get(i);
                      
                      previews.push(
                        <div key={i} className="text-sm font-mono flex items-center gap-2">
                          <span className="text-gray-500 w-16">任务{i}</span>
                          <span className="text-gray-400">→</span>
                          {file ? (
                            <span className="flex items-center gap-1 text-gray-700">
                              {file.type === 'image' ? (
                                <Image className="w-4 h-4 text-green-500" />
                              ) : (
                                <File className="w-4 h-4 text-blue-500" />
                              )}
                              {file.originalName}
                            </span>
                          ) : (
                            <span className="text-gray-400">（未上传）</span>
                          )}
                        </div>
                      );
                    }
                    
                    return previews;
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 批次状态概览 */}
        {batchState && (
          <div className={`border rounded-lg p-4 ${batchState.stopped ? 'bg-yellow-50 border-yellow-200' : 'bg-blue-50 border-blue-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`font-medium ${batchState.stopped ? 'text-yellow-800' : 'text-blue-800'}`}>
                  批次 {batchState.batchId}
                  {batchState.stopped && <span className="ml-2 text-yellow-600">(已停止)</span>}
                </p>
                <p className={`text-sm ${batchState.stopped ? 'text-yellow-600' : 'text-blue-600'}`}>
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

            {/* 截断警告提示 */}
            {truncatedTasks.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg mb-4">
                <div className="flex items-start gap-2">
                  <span className="text-lg">⚠️</span>
                  <div>
                    <p className="font-medium">部分任务内容被截断</p>
                    <p className="text-sm mt-1">
                      有 {truncatedTasks.length} 个任务因超出Token上限被截断。
                      请在「高级设置」中增加「最大Token数」后重试。
                    </p>
                  </div>
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
        
        {/* 按钮区域 */}
        <div className="flex justify-center gap-4 pt-4">
          {isGenerating ? (
            <>
              <Button 
                onClick={handleStop}
                size="lg"
                variant="destructive"
                className="px-8"
                disabled={isStopping}
              >
                {isStopping ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    正在停止...
                  </>
                ) : (
                  <>
                    <Square className="w-5 h-5 mr-2" />
                    停止
                  </>
                )}
              </Button>
              <Button 
                size="lg"
                className="px-8"
                disabled
              >
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                处理中...
              </Button>
            </>
          ) : (
            <Button 
              onClick={handleStart}
              size="lg"
              className="px-8"
            >
              <Play className="w-5 h-5 mr-2" />
              开始批量生成
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
