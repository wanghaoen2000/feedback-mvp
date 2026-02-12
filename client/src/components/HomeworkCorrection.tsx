import React, { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Copy,
  Send,
  ImagePlus,
  FileUp,
  X,
  Settings2,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ============= 类型定义 =============

interface AttachedImage {
  id: string;
  name: string;
  dataUri: string;
  preview: string;
}

interface AttachedFile {
  id: string;
  name: string;
  content: string;
  mimeType: string;
  size: number;
}

interface CorrectionType {
  id: string;
  name: string;
  prompt: string;
}

// ============= 主组件 =============

export function HomeworkCorrection() {
  // 学生选择
  const [selectedStudent, setSelectedStudent] = useState("");

  // 批改类型
  const [selectedType, setSelectedType] = useState("");

  // AI 模型（独立记忆）
  const [localModel, setLocalModel] = useState("");

  // 输入
  const [textContent, setTextContent] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);

  // UI 状态
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ============= tRPC 查询 =============

  const studentsQuery = trpc.homework.listStudents.useQuery({ status: "active" });
  const students = studentsQuery.data || [];

  const typesQuery = trpc.correction.getTypes.useQuery();
  const correctionTypes: CorrectionType[] = typesQuery.data || [];

  const configQuery = trpc.correction.getConfig.useQuery();
  const updateConfigMut = trpc.correction.updateConfig.useMutation();

  // 模型预设列表
  const presetList = (configQuery.data?.modelPresets || "").split("\n").map(s => s.trim()).filter(Boolean);

  // 从服务器加载配置
  useEffect(() => {
    if (configQuery.data) {
      setLocalModel(configQuery.data.corrAiModel || "");
    }
  }, [configQuery.data]);

  // 任务列表（始终加载，自动刷新进行中的任务）
  const historyQuery = trpc.correction.listTasks.useQuery(
    { limit: 20 },
    {
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data) return false;
        const hasPending = data.some((t: any) => t.taskStatus === "pending" || t.taskStatus === "processing");
        return hasPending ? 3000 : false;
      },
    },
  );

  // 展开的任务详情
  const expandedTaskQuery = trpc.correction.getTask.useQuery(
    { id: expandedTaskId! },
    { enabled: expandedTaskId !== null },
  );

  const submitMut = trpc.correction.submit.useMutation({
    onSuccess: () => {
      // 提交成功：清空表单，刷新任务列表
      setTextContent("");
      setImages([]);
      setFiles([]);
      setIsSubmitting(false);
      historyQuery.refetch();
    },
    onError: (err) => {
      setIsSubmitting(false);
      alert("提交失败: " + err.message);
    },
  });

  // ============= 事件处理 =============

  const handleSubmit = useCallback(() => {
    if (!selectedStudent) return alert("请先选择学生");
    if (!selectedType) return alert("请先选择批改类型");
    if (!textContent.trim() && images.length === 0 && files.length === 0) {
      return alert("请输入作业内容或上传文件/图片");
    }

    setIsSubmitting(true);

    submitMut.mutate({
      studentName: selectedStudent,
      correctionType: selectedType,
      rawText: textContent.trim() || undefined,
      images: images.length > 0 ? images.map((i) => i.dataUri) : undefined,
      files: files.length > 0
        ? files.map((f) => ({ name: f.name, content: f.content, mimeType: f.mimeType }))
        : undefined,
      aiModel: localModel || undefined,
    });
  }, [selectedStudent, selectedType, textContent, images, files, localModel, submitMut]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  }, []);

  // ============= 文件处理 =============

  const processImageFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUri = e.target?.result as string;
      setImages((prev) => [
        ...prev,
        {
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          dataUri,
          preview: dataUri,
        },
      ]);
    };
    reader.readAsDataURL(file);
  }, []);

  const processDocFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
      );
      setFiles((prev) => [
        ...prev,
        {
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          content: base64,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
        },
      ]);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleFilesDrop = useCallback(
    (fileList: FileList) => {
      Array.from(fileList).forEach((file) => {
        if (file.type.startsWith("image/")) {
          processImageFile(file);
        } else {
          processDocFile(file);
        }
      });
    },
    [processImageFile, processDocFile],
  );

  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleFilesDrop(e.dataTransfer.files);
      }
    },
    [handleFilesDrop],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) processImageFile(file);
        } else if (item.kind === "file" && !item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) processDocFile(file);
        }
      }
    },
    [processImageFile, processDocFile],
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // ============= 渲染 =============

  return (
    <div className="space-y-4">
      {/* 头部：AI模型选择 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {presetList.length > 0 && (
            <>
              <span className="text-sm text-gray-500 shrink-0">模型</span>
              <Select
                value={localModel || "__default__"}
                onValueChange={(val) => {
                  const newModel = val === "__default__" ? "" : val;
                  setLocalModel(newModel);
                  updateConfigMut.mutate({ corrAiModel: newModel });
                }}
              >
                <SelectTrigger className="h-8 text-sm max-w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">默认模型</SelectItem>
                  {presetList.map((model) => (
                    <SelectItem key={model} value={model}>{model}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
        >
          <Settings2 className="w-3 h-3" />
          设置
        </button>
      </div>

      {/* 设置面板 */}
      {showSettings && <CorrectionSettings onClose={() => setShowSettings(false)} />}

      {/* 学生选择 */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">选择学生</Label>
        <div className="flex flex-wrap gap-2">
          {students.length === 0 && (
            <p className="text-sm text-gray-400">暂无学生，请先在「作业管理」中添加</p>
          )}
          {students.map((s: any) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedStudent(selectedStudent === s.name ? "" : s.name)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                selectedStudent === s.name
                  ? "bg-purple-600 text-white shadow-md scale-105"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* 批改类型选择 */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">批改类型</Label>
        <div className="flex flex-wrap gap-2">
          {correctionTypes.map((ct) => (
            <button
              key={ct.id}
              type="button"
              onClick={() => setSelectedType(selectedType === ct.id ? "" : ct.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                selectedType === ct.id
                  ? "bg-purple-600 text-white shadow-md"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {ct.name}
            </button>
          ))}
        </div>
      </div>

      {/* 输入区 */}
      <div
        className={`relative border-2 rounded-lg transition-colors ${
          isDragOver ? "border-purple-400 bg-purple-50" : "border-gray-200"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Textarea
          ref={textareaRef}
          placeholder="在此输入作业内容，支持拖拽/粘贴图片和文件..."
          value={textContent}
          onChange={(e) => setTextContent(e.target.value)}
          onPaste={handlePaste}
          className="min-h-[160px] max-h-[50vh] border-0 focus-visible:ring-0 resize-y"
          disabled={isSubmitting}
        />

        {/* 附件预览区 */}
        {(images.length > 0 || files.length > 0) && (
          <div className="border-t px-3 py-2 space-y-2">
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((img) => (
                  <div key={img.id} className="relative group">
                    <img
                      src={img.preview}
                      alt={img.name}
                      className="w-16 h-16 object-cover rounded border"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <span className="text-[10px] text-gray-400 block text-center truncate max-w-[64px]">
                      {img.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded"
                  >
                    <FileUp className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{f.name}</span>
                    <span className="text-gray-400">({(f.size / 1024).toFixed(0)}KB)</span>
                    <button
                      type="button"
                      onClick={() => removeFile(f.id)}
                      className="ml-auto text-red-400 hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 底部工具栏 */}
        <div className="flex items-center justify-between border-t px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="text-gray-400 hover:text-purple-600 p-1 rounded transition-colors"
              title="添加图片"
            >
              <ImagePlus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-gray-400 hover:text-purple-600 p-1 rounded transition-colors"
              title="添加文件"
            >
              <FileUp className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-300">
              支持拖拽/粘贴图片、Word、PDF、TXT
            </span>
          </div>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedStudent || !selectedType}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-1" />
                提交批改
              </>
            )}
          </Button>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFilesDrop(e.target.files)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.doc,.pdf,.txt"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFilesDrop(e.target.files)}
        />

        {isDragOver && (
          <div className="absolute inset-0 bg-purple-50/80 flex items-center justify-center rounded-lg pointer-events-none">
            <p className="text-purple-600 font-medium">松开即可添加文件</p>
          </div>
        )}
      </div>

      {/* 批改任务列表 */}
      <div className="pt-2 border-t">
        <p className="text-xs text-gray-400 mb-2">批改任务</p>
        {historyQuery.data && historyQuery.data.length === 0 && (
          <p className="text-xs text-gray-400 py-2">暂无任务</p>
        )}
        <div className="space-y-2">
          {historyQuery.data?.map((t: any) => (
            <TaskCard
              key={t.id}
              task={t}
              isExpanded={expandedTaskId === t.id}
              expandedData={expandedTaskId === t.id ? expandedTaskQuery.data : null}
              onToggle={() => setExpandedTaskId(expandedTaskId === t.id ? null : t.id)}
              onCopy={handleCopy}
              copySuccess={copySuccess}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============= 任务卡片子组件 =============

function TaskCard({
  task,
  isExpanded,
  expandedData,
  onToggle,
  onCopy,
  copySuccess,
}: {
  task: any;
  isExpanded: boolean;
  expandedData: any;
  onToggle: () => void;
  onCopy: (text: string) => void;
  copySuccess: boolean;
}) {
  const isPending = task.taskStatus === "pending" || task.taskStatus === "processing";
  const isCompleted = task.taskStatus === "completed";
  const isFailed = task.taskStatus === "failed";

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${
      isPending ? "border-blue-200 bg-blue-50/30" :
      isCompleted ? "border-green-200" :
      "border-red-200"
    }`}>
      {/* 卡片头部（始终可见） */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50/50"
        onClick={onToggle}
      >
        {isCompleted ? (
          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
        ) : isFailed ? (
          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
        ) : (
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
        )}
        <span className="font-medium text-sm">{task.studentName}</span>
        <span className="text-xs text-gray-400">{task.correctionType}</span>
        {task.autoImported === 1 && (
          <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded">已入库</span>
        )}
        {isPending && (
          <span className="text-xs text-blue-500">批改中...</span>
        )}
        {isFailed && (
          <span className="text-xs text-red-500 truncate max-w-[150px]">{task.errorMessage}</span>
        )}
        <span className="text-[10px] text-gray-300 ml-auto shrink-0">
          {new Date(task.createdAt).toLocaleString("zh-CN", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {isCompleted && (
          isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        )}
      </div>

      {/* 展开详情（仅已完成的任务） */}
      {isExpanded && isCompleted && expandedData && (
        <div className="border-t px-3 py-3 space-y-3">
          {/* 批改内容 */}
          {expandedData.resultCorrection && (
            <div className="bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-green-200">
                <span className="text-xs font-medium text-green-700">批改内容（发给学生）</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onCopy(expandedData.resultCorrection); }}
                  className="text-green-600 hover:text-green-800 h-6 text-xs"
                >
                  {copySuccess ? (
                    <><CheckCircle2 className="w-3 h-3 mr-1" />已复制</>
                  ) : (
                    <><Copy className="w-3 h-3 mr-1" />一键复制</>
                  )}
                </Button>
              </div>
              <div className="p-3 text-sm text-gray-800 whitespace-pre-wrap max-h-[50vh] overflow-y-auto">
                {expandedData.resultCorrection}
              </div>
            </div>
          )}

          {/* 状态更新 */}
          {expandedData.resultStatusUpdate && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg">
              <div className="px-3 py-1.5 border-b border-blue-200 flex items-center gap-2">
                <span className="text-xs font-medium text-blue-700">状态更新</span>
                {expandedData.autoImported ? (
                  <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded">已自动推送到作业管理</span>
                ) : (
                  <span className="text-[10px] text-blue-400">等待推送</span>
                )}
              </div>
              <div className="p-3 text-xs text-gray-700 whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                {expandedData.resultStatusUpdate}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============= 批改类型设置子组件 =============

function CorrectionSettings({ onClose }: { onClose: () => void }) {
  const typesQuery = trpc.correction.getTypes.useQuery();
  const promptQuery = trpc.correction.getPrompt.useQuery();
  const updateTypesMut = trpc.correction.updateTypes.useMutation({
    onSuccess: () => typesQuery.refetch(),
  });
  const updatePromptMut = trpc.correction.updatePrompt.useMutation();
  const trpcUtils = trpc.useUtils();

  const [types, setTypes] = useState<CorrectionType[]>([]);
  const [generalPrompt, setGeneralPrompt] = useState("");
  const [editingType, setEditingType] = useState<string | null>(null);

  useEffect(() => {
    if (typesQuery.data) setTypes(typesQuery.data);
  }, [typesQuery.data]);

  useEffect(() => {
    if (promptQuery.data) setGeneralPrompt(promptQuery.data.prompt);
  }, [promptQuery.data]);

  const handleSaveTypes = () => {
    updateTypesMut.mutate(types, {
      onSuccess: () => {
        trpcUtils.correction.getTypes.invalidate();
      },
    });
  };

  const handleSavePrompt = () => {
    updatePromptMut.mutate({ prompt: generalPrompt });
  };

  const handleAddType = () => {
    const newId = `type-${Date.now()}`;
    setTypes([...types, { id: newId, name: "新类型", prompt: "" }]);
    setEditingType(newId);
  };

  const handleRemoveType = (id: string) => {
    setTypes(types.filter((t) => t.id !== id));
  };

  const handleUpdateType = (id: string, field: keyof CorrectionType, value: string) => {
    setTypes(types.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };

  return (
    <Card className="border-purple-200 bg-purple-50/50">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-purple-700">批改设置</CardTitle>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {/* 通用提示词 */}
        <div className="space-y-1">
          <Label className="text-xs text-gray-600">通用批改提示词</Label>
          <Textarea
            value={generalPrompt}
            onChange={(e) => setGeneralPrompt(e.target.value)}
            rows={4}
            className="text-xs max-h-[50vh] overflow-y-auto"
            placeholder="所有批改类型共用的系统提示词..."
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleSavePrompt}
            disabled={updatePromptMut.isPending}
            className="text-xs h-7"
          >
            {updatePromptMut.isPending ? "保存中..." : "保存提示词"}
          </Button>
        </div>

        {/* 类型列表 */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-600">批改类型列表</Label>
          {types.map((ct) => (
            <div key={ct.id} className="bg-white rounded-lg p-3 space-y-2 border">
              <div className="flex items-center gap-2">
                <input
                  className="font-medium text-sm flex-1 border-b border-transparent focus:border-purple-400 outline-none bg-transparent"
                  value={ct.name}
                  onChange={(e) => handleUpdateType(ct.id, "name", e.target.value)}
                  placeholder="类型名称"
                />
                <button
                  type="button"
                  onClick={() => setEditingType(editingType === ct.id ? null : ct.id)}
                  className="text-xs text-gray-400 hover:text-purple-600"
                >
                  {editingType === ct.id ? "收起" : "编辑"}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveType(ct.id)}
                  className="text-gray-300 hover:text-red-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {editingType === ct.id && (
                <div>
                  <label className="text-[10px] text-gray-400">专属提示词</label>
                  <Textarea
                    value={ct.prompt}
                    onChange={(e) => handleUpdateType(ct.id, "prompt", e.target.value)}
                    rows={3}
                    className="text-xs max-h-[50vh] overflow-y-auto"
                    placeholder="该批改类型的专属提示词，会附加到通用提示词后面"
                  />
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleAddType}
              className="text-xs h-7"
            >
              <Plus className="w-3 h-3 mr-1" />
              添加类型
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveTypes}
              disabled={updateTypesMut.isPending}
              className="text-xs h-7 bg-purple-600 hover:bg-purple-700"
            >
              {updateTypesMut.isPending ? "保存中..." : "保存类型配置"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
