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
  XCircle
} from "lucide-react";

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
  const [currentChars, setCurrentChars] = useState(0);
  const [result, setResult] = useState<{
    success: boolean;
    content?: string;
    error?: string;
    chars?: number;
  } | null>(null);

  const handleStart = useCallback(async () => {
    // 验证参数
    const taskNumber = parseInt(startNumber);
    if (isNaN(taskNumber)) {
      setResult({ success: false, error: "请输入有效的任务编号" });
      return;
    }
    if (!roadmap.trim()) {
      setResult({ success: false, error: "请输入路书内容" });
      return;
    }

    // 重置状态
    setIsGenerating(true);
    setCurrentChars(0);
    setResult(null);

    try {
      // 调用 SSE 端点
      const response = await fetch('/api/batch/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskNumber,
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
      let finalContent = '';
      let sseError: string | null = null;
      
      // 支持分块内容
      const contentChunks: string[] = [];
      
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
              if (currentEventType === 'task-start') {
                // 任务开始
                setCurrentChars(0);
              } else if (currentEventType === 'task-progress' && data.chars !== undefined) {
                // 进度更新
                setCurrentChars(data.chars);
              } else if (currentEventType === 'content-chunk' && data.text !== undefined) {
                // 分块内容
                contentChunks[data.index] = data.text;
              } else if (currentEventType === 'task-complete') {
                // 完成事件
                if (data.chunked && contentChunks.length > 0) {
                  // 从分块拼接内容
                  finalContent = contentChunks.join('');
                } else if (data.content) {
                  finalContent = data.content;
                }
                setCurrentChars(data.chars || finalContent.length);
              } else if (currentEventType === 'task-error' && data.error) {
                // 错误事件
                sseError = data.error;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      if (sseError) {
        throw new Error(sseError);
      }

      if (!finalContent) {
        throw new Error('未收到生成内容');
      }

      // 设置成功结果
      setResult({
        success: true,
        content: finalContent,
        chars: finalContent.length,
      });

    } catch (error: any) {
      setResult({
        success: false,
        error: error.message || '生成失败',
      });
    } finally {
      setIsGenerating(false);
    }
  }, [startNumber, roadmap, storagePath]);

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
            className="min-h-[300px] font-mono text-sm"
            disabled={isGenerating}
          />
          <p className="text-xs text-gray-500">
            路书格式：每个任务用分隔符分开，包含学生姓名、课次、课堂笔记等信息
          </p>
        </div>

        {/* 生成状态显示 */}
        {isGenerating && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <div>
                <p className="font-medium text-blue-800">生成中...</p>
                <p className="text-sm text-blue-600">已生成 {currentChars} 字符</p>
              </div>
            </div>
          </div>
        )}

        {/* 生成结果显示 */}
        {result && !isGenerating && (
          <div className={`border rounded-lg p-4 ${
            result.success 
              ? 'bg-green-50 border-green-200' 
              : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-center gap-3">
              {result.success ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <XCircle className="w-5 h-5 text-red-600" />
              )}
              <div>
                {result.success ? (
                  <>
                    <p className="font-medium text-green-800">生成完成</p>
                    <p className="text-sm text-green-600">共 {result.chars} 字符</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-red-800">生成失败</p>
                    <p className="text-sm text-red-600">{result.error}</p>
                  </>
                )}
              </div>
            </div>
            
            {/* 显示生成内容预览 */}
            {result.success && result.content && (
              <div className="mt-3 pt-3 border-t border-green-200">
                <p className="text-xs text-green-700 mb-2">内容预览（前500字）：</p>
                <pre className="text-xs text-gray-700 bg-white p-2 rounded border overflow-auto max-h-40">
                  {result.content.slice(0, 500)}
                  {result.content.length > 500 && '...'}
                </pre>
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
                生成中...
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
