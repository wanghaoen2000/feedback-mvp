import React, { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Play,
  Settings,
  FileText,
  FolderOpen,
  Loader2,
  XCircle,
  Upload,
  File,
  Image,
  Trash2,
  Eye,
} from "lucide-react";
import { BatchTaskHistory } from "./BatchTaskHistory";

// 上传文件类型
interface UploadedFile {
  originalName: string;
  mimeType: string;
  size: number;
  type: 'document' | 'image';
  url?: string;
  base64DataUri?: string;
  extractedText?: string;
  error?: string;
}

export function BatchProcess() {
  // 基本设置
  const [templateType, setTemplateType] = useState<'markdown_plain' | 'markdown_styled' | 'markdown_file' | 'word_card' | 'writing_material'>('markdown_styled');
  const [startNumber, setStartNumber] = useState("");
  const [endNumber, setEndNumber] = useState("");
  const [concurrency, setConcurrency] = useState("50");
  const [isConcurrencySaving, setIsConcurrencySaving] = useState(false);
  const [filePrefix, setFilePrefix] = useState("任务");
  const [isPrefixSaving, setIsPrefixSaving] = useState(false);

  // 文件命名方式
  const [namingMethod, setNamingMethod] = useState<'prefix' | 'custom'>('prefix');
  const [customNames, setCustomNames] = useState<string>('');
  const [parsedNames, setParsedNames] = useState<Map<number, string>>(new Map());

  // 从数据库加载配置
  const { data: config } = trpc.config.getAll.useQuery();
  const updateConfig = trpc.config.update.useMutation();
  const trpcUtils = trpc.useUtils();

  // 加载配置后更新前缀和存储路径
  useEffect(() => {
    if (config?.batchFilePrefix) {
      setFilePrefix(config.batchFilePrefix);
    }
  }, [config?.batchFilePrefix]);

  useEffect(() => {
    if (config?.batchConcurrency) {
      setConcurrency(config.batchConcurrency);
    }
  }, [config?.batchConcurrency]);

  // 路书内容
  const [roadmap, setRoadmap] = useState("");
  const [showPromptPreview, setShowPromptPreview] = useState(false);

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

  // 提交状态
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // tRPC mutation
  const submitMutation = trpc.batchTask.submit.useMutation();

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

      const successFiles = result.files
        .filter((f: UploadedFile) => !f.error)
        .sort((a: UploadedFile, b: UploadedFile) =>
          a.originalName.localeCompare(b.originalName, 'zh-CN')
        );

      const fileMap = new Map<number, UploadedFile>();
      successFiles.forEach((file: UploadedFile, index: number) => {
        const taskNumber = start + index;
        if (taskNumber <= end) {
          fileMap.set(taskNumber, file);
        }
      });

      setUploadedFiles(fileMap);

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

      const successFiles = result.files.filter((f: UploadedFile) => !f.error);
      setSharedFiles(prev => [...prev, ...successFiles]);

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

  // 提交任务到后台
  const handleSubmit = useCallback(async () => {
    const start = parseInt(startNumber);
    const end = parseInt(endNumber);
    const concurrencyNum = parseInt(concurrency) || 50;

    if (isNaN(start) || isNaN(end)) {
      setSubmitError("请输入有效的任务编号范围");
      return;
    }
    if (start > end) {
      setSubmitError("起始编号不能大于结束编号");
      return;
    }
    if (!roadmap.trim()) {
      setSubmitError("请输入路书内容");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // 构建文件信息
      const filesObj = uploadedFiles.size > 0 ? Object.fromEntries(
        Array.from(uploadedFiles.entries()).map(([taskNum, file]) => [
          taskNum,
          {
            type: file.type,
            url: file.url,
            base64DataUri: file.base64DataUri,
            mimeType: file.mimeType,
            extractedText: file.extractedText,
          }
        ])
      ) : undefined;

      const sharedFilesArr = sharedFiles.length > 0 ? sharedFiles.map(file => ({
        type: file.type,
        url: file.url,
        base64DataUri: file.base64DataUri,
        mimeType: file.mimeType,
        extractedText: file.extractedText,
      })) : undefined;

      await submitMutation.mutateAsync({
        startNumber: start,
        endNumber: end,
        concurrency: concurrencyNum,
        roadmap: roadmap.trim(),
        storagePath: config?.batchStoragePath?.trim() || undefined,
        filePrefix: filePrefix.trim() || '任务',
        templateType,
        namingMethod,
        customFileNames: namingMethod === 'custom' ? Object.fromEntries(parsedNames) : undefined,
        files: filesObj,
        sharedFiles: sharedFilesArr,
        apiModel: config?.apiModel || undefined,
        apiKey: config?.apiKey || undefined,
        apiUrl: config?.apiUrl || undefined,
      });

      // 提交成功 — 立即刷新历史列表，不用等3秒轮询
      trpcUtils.batchTask.history.invalidate();
    } catch (error: any) {
      const message = error?.message || "提交失败";
      setSubmitError(message);
      console.error('批量任务提交失败:', message);
    } finally {
      setIsSubmitting(false);
    }
  }, [startNumber, endNumber, concurrency, roadmap, filePrefix, templateType, namingMethod, parsedNames, uploadedFiles, sharedFiles, config, submitMutation]);

  return (
    <div className="space-y-6">
      <Card className="shadow-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            批量处理
          </CardTitle>
          <CardDescription>
            批量生成文档，提交后在服务器后台执行，可安心关闭页面
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
                  const value = e.target.value as typeof templateType;
                  setTemplateType(value);
                }}
                disabled={isSubmitting}
                className="w-full h-10 px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <option value="markdown_styled">教学材料（带样式）</option>
                <option value="markdown_plain">通用文档（无样式）</option>
                <option value="markdown_file">生成MD文件（不转换）</option>
                <option value="word_card">词汇卡片（精确排版）</option>
                <option value="writing_material">写作素材模板</option>
              </select>
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
                  disabled={isSubmitting}
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
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* 并发数和文件命名方式 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="concurrency">并发数</Label>
                <Input
                  id="concurrency"
                  type="number"
                  placeholder="默认：50"
                  value={concurrency}
                  onChange={(e) => setConcurrency(e.target.value)}
                  onBlur={async () => {
                    if (concurrency !== config?.batchConcurrency) {
                      setIsConcurrencySaving(true);
                      try {
                        await updateConfig.mutateAsync({ batchConcurrency: concurrency });
                      } catch (e) {
                        console.error('保存并发数失败:', e);
                      } finally {
                        setIsConcurrencySaving(false);
                      }
                    }
                  }}
                  disabled={isSubmitting}
                />
                <p className="text-xs text-gray-500">{isConcurrencySaving ? '保存中...' : '同时处理的任务数量，修改后自动保存'}</p>
              </div>
              <div className="space-y-2">
                <Label>文件命名方式</Label>
                <div className="flex gap-4 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="namingMethod"
                      value="prefix"
                      checked={namingMethod === 'prefix'}
                      onChange={() => setNamingMethod('prefix')}
                      disabled={isSubmitting}
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
                      disabled={isSubmitting}
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
                  disabled={isSubmitting}
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
                    disabled={isSubmitting}
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
                      const cleanName = rawName.trim().replace(/[\\/:*?"<>|]/g, '');
                      if (cleanName) {
                        newParsedNames.set(i, cleanName);
                      }
                    }

                    setParsedNames(newParsedNames);
                  }}
                  disabled={isSubmitting || !startNumber || !endNumber}
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
              disabled={isSubmitting}
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
                公用文档（所有任务都能看到的参考资料）
              </Label>
              <p className="text-xs text-gray-500">最多支持 100 个文件，单个文件最大 20MB</p>

              <input
                type="file"
                multiple
                accept=".docx,.md,.txt,.pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => e.target.files && handleSharedFileUpload(e.target.files)}
                style={{ display: 'none' }}
                ref={sharedFileInputRef}
              />

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => !isUploadingShared && !isSubmitting && sharedFileInputRef.current?.click()}
                  disabled={isUploadingShared || isSubmitting}
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
                    disabled={isSubmitting || isUploadingShared}
                    className="flex items-center gap-1 text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                    清空
                  </Button>
                )}
              </div>

              {sharedUploadError && (
                <div className="text-sm text-red-600 flex items-center gap-1">
                  <XCircle className="w-4 h-4" />
                  {sharedUploadError}
                </div>
              )}

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
                每个任务单独的文档（按文件名排序，一个文件对应一个任务）
              </Label>
              <p className="text-xs text-gray-500">最多支持 100 个文件，单个文件最大 20MB</p>

              <input
                type="file"
                multiple
                accept=".docx,.md,.txt,.pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                style={{ display: 'none' }}
                ref={fileInputRef}
              />

              <div
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  isUploading ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                }`}
                onClick={() => !isUploading && !isSubmitting && fileInputRef.current?.click()}
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

              {uploadError && (
                <div className="text-sm text-red-600 flex items-center gap-1">
                  <XCircle className="w-4 h-4" />
                  {uploadError}
                </div>
              )}

              {uploadedFiles.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFiles}
                  disabled={isSubmitting || isUploading}
                  className="flex items-center gap-1 text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                  清空
                </Button>
              )}

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

          {/* 模型选择 */}
          {(() => {
            const presetList = (config?.modelPresets || '').split('\n').map((s: string) => s.trim()).filter(Boolean);
            if (presetList.length === 0) return null;
            return (
              <div className="flex items-center justify-center gap-2 pt-4">
                <span className="text-sm text-gray-500 shrink-0">模型</span>
                <Select
                  value={config?.apiModel || '__default__'}
                  onValueChange={(val) => {
                    const newModel = val === '__default__' ? '' : val;
                    updateConfig.mutate({ apiModel: newModel });
                  }}
                >
                  <SelectTrigger className="h-8 text-sm max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">默认模型</SelectItem>
                    {presetList.map((model: string) => (
                      <SelectItem key={model} value={model}>{model}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })()}

          {/* 提交错误提示 */}
          {submitError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>提交失败: {submitError}</span>
              </div>
            </div>
          )}

          {/* 按钮区域 */}
          <div className="flex flex-col items-center gap-2 pt-4">
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSubmit}
                size="lg"
                className="px-8"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    正在提交...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-2" />
                    开始批量生成
                  </>
                )}
              </Button>
              <button
                type="button"
                onClick={() => setShowPromptPreview(!showPromptPreview)}
                className="text-xs text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-0.5"
              >
                <Eye className="w-3 h-3" />
                看看发给AI什么
              </button>
            </div>
            {showPromptPreview && (
              <div className="w-full border rounded bg-gray-50 p-3 space-y-2 text-left">
                <div className="text-xs font-medium text-gray-500">AI收到的指令（路书 + 格式要求，所有任务共用）</div>
                <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-white p-2 rounded border max-h-60 overflow-y-auto">{
                  `<路书提示词>\n${roadmap.trim() || '(未填写路书)'}\n</路书提示词>\n${
                    templateType === 'word_card' ? '【输出格式要求 - 词汇卡片】\n(JSON结构: listNumber, sceneName, words[...])\n' :
                    templateType === 'writing_material' ? '【输出格式要求 - 写作素材】\n(JSON结构: partNum, categories[...])\n' : ''
                  }【重要】请直接输出结果，不要与用户互动，不要询问任何问题。`
                }</pre>
                <div className="text-xs font-medium text-gray-500">发给AI的任务内容（以第1个任务为例）</div>
                <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-white p-2 rounded border max-h-20 overflow-y-auto">{
                  `这是任务编号 ${startNumber || 1}，请按照路书要求生成内容。${
                    sharedFiles.length > 0 ? `\n\n<公用文档>\n(${sharedFiles.length}个公用文档的提取文本)\n</公用文档>` : ''
                  }${
                    uploadedFiles.size > 0 ? `\n\n<本任务文档>\n(该任务对应的单独文档文本)\n</本任务文档>` : ''
                  }`
                }</pre>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 批量任务历史 */}
      <BatchTaskHistory />
    </div>
  );
}
