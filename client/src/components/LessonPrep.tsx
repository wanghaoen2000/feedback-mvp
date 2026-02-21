import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUploadInput } from "@/components/FileUploadInput";
import { trpc } from "@/lib/trpc";
import { sortByPinyin } from "@/lib/pinyinSort";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Copy,
  Send,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Plus,
  X,
  BookOpen,
  RefreshCw,
  Trash2,
  Save,
} from "lucide-react";

// ============= 类型定义 =============

interface StudentRecord {
  lesson: number;
  lastUsed: number;
  students?: string[];
}

// ============= 工具函数 =============

function shortModelName(model: string): string {
  if (!model) return "";
  let s = model.replace(/^claude-/, "");
  s = s.replace(/-\d{8}/, "");
  s = s.replace(/(\d+)-(\d+)/, "$1.$2");
  return s;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

// ============= 防抖 Textarea =============

const DebouncedTextarea = React.memo(function DebouncedTextarea({
  value,
  onChange,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
} & Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange'>) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onChange(newValue), 300);
  }, [onChange]);

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  return <Textarea {...props} value={localValue} onChange={handleChange} />;
});

// ============= 主组件 =============

export function LessonPrep() {
  // 学生选择
  const [selectedStudent, setSelectedStudent] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [showStudentMgmt, setShowStudentMgmt] = useState(false);

  // 课次
  const [lessonNumber, setLessonNumber] = useState("");

  // 新生模式
  const [isNewStudent, setIsNewStudent] = useState(false);

  // 上次课内容 / 新生基本情况
  const [lastLessonContent, setLastLessonContent] = useState("");

  // 云盘加载
  const [loadFromDrive, setLoadFromDrive] = useState(false);

  // AI 模型（独立记忆）
  const [localModel, setLocalModel] = useState("");

  // 路书
  const [showRoadmapEditor, setShowRoadmapEditor] = useState(false);
  const [roadmapText, setRoadmapText] = useState("");
  const [roadmapSaving, setRoadmapSaving] = useState(false);

  // UI 状态
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // ============= tRPC 查询 =============

  // 学生列表（共享 hw_students）
  const studentsQuery = trpc.homework.listStudents.useQuery({ status: "active" });
  const students = useMemo(() => sortByPinyin(studentsQuery.data || []), [studentsQuery.data]);
  const addStudentMut = trpc.homework.addStudent.useMutation({
    onSuccess: () => { studentsQuery.refetch(); setNewStudentName(""); },
  });
  const removeStudentMut = trpc.homework.removeStudent.useMutation({
    onSuccess: () => studentsQuery.refetch(),
  });

  // 备课配置
  const configQuery = trpc.lessonPrep.getConfig.useQuery();
  const updateConfigMut = trpc.lessonPrep.updateConfig.useMutation();

  // 模型预设列表
  const presetList = (configQuery.data?.modelPresets || "").split("\n").map(s => s.trim()).filter(Boolean);

  // 从服务器加载配置
  useEffect(() => {
    if (configQuery.data) {
      setLocalModel(configQuery.data.prepAiModel || "");
      setRoadmapText(configQuery.data.lessonPrepRoadmap || "");
    }
  }, [configQuery.data]);

  // 课次历史（用于自动填充）
  const { data: serverHistory } = trpc.config.getStudentHistory.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const studentHistory = (serverHistory || {}) as Record<string, StudentRecord>;

  // 任务列表
  const historyQuery = trpc.lessonPrep.listTasks.useQuery(
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

  // 心跳计时器
  const [prepNow, setPrepNow] = useState(Date.now());
  const hasPendingTasks = historyQuery.data?.some((t: any) => t.taskStatus === "pending" || t.taskStatus === "processing");
  useEffect(() => {
    if (!hasPendingTasks) return;
    const timer = setInterval(() => setPrepNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasPendingTasks]);

  // 展开的任务详情
  const expandedTaskQuery = trpc.lessonPrep.getTask.useQuery(
    { id: expandedTaskId! },
    { enabled: expandedTaskId !== null },
  );

  // 提交
  const submitMut = trpc.lessonPrep.submit.useMutation({
    onSuccess: () => {
      historyQuery.refetch();
    },
    onError: (err) => {
      alert("提交失败: " + err.message);
    },
  });

  // 重试
  const retryMut = trpc.lessonPrep.retry.useMutation({
    onSuccess: () => historyQuery.refetch(),
    onError: (err) => alert("重试失败: " + err.message),
  });

  // 删除
  const deleteMut = trpc.lessonPrep.delete.useMutation({
    onSuccess: () => {
      historyQuery.refetch();
      if (expandedTaskId) setExpandedTaskId(null);
    },
    onError: (err) => alert("删除失败: " + err.message),
  });

  // 从云盘读取上次反馈
  const readLastFeedbackMut = trpc.drive.readLastFeedback.useMutation();

  // ============= 事件处理 =============

  // 选择学生 → 自动填充课次
  const handleSelectStudent = useCallback((name: string) => {
    const newSelected = selectedStudent === name ? "" : name;
    setSelectedStudent(newSelected);
    if (newSelected) {
      const record = studentHistory[newSelected.trim()];
      if (record?.lesson !== undefined) {
        setLessonNumber(String(record.lesson + 1));
      } else {
        setLessonNumber("");
      }
    } else {
      setLessonNumber("");
    }
    // 清空上次课内容（切换学生时）
    setLastLessonContent("");
    setLoadFromDrive(false);
    setIsNewStudent(false);
  }, [selectedStudent, studentHistory]);

  // 提交备课
  const handleSubmit = useCallback(async () => {
    if (!selectedStudent) return alert("请先选择学生");

    let finalLastLessonContent = lastLessonContent;

    // 如果勾选了从云盘加载，执行加载
    if (loadFromDrive && !isNewStudent && lessonNumber.trim()) {
      try {
        const result = await readLastFeedbackMut.mutateAsync({
          studentName: selectedStudent.trim(),
          lessonNumber: lessonNumber.trim(),
          courseType: "oneToOne",
        });
        finalLastLessonContent = result.content;
        setLastLessonContent(result.content);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "读取失败";
        alert(`从云盘加载上次课内容失败: ${message}`);
        return;
      }
    }

    submitMut.mutate({
      studentName: selectedStudent.trim(),
      lessonNumber: lessonNumber.trim() || undefined,
      isNewStudent,
      lastLessonContent: finalLastLessonContent.trim() || undefined,
      aiModel: localModel || undefined,
    });
  }, [selectedStudent, lessonNumber, isNewStudent, lastLessonContent, loadFromDrive, localModel, submitMut, readLastFeedbackMut]);

  // 复制
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

  // 保存路书
  const handleSaveRoadmap = async () => {
    setRoadmapSaving(true);
    try {
      await updateConfigMut.mutateAsync({ lessonPrepRoadmap: roadmapText });
      alert("备课路书已保存！");
    } catch (err) {
      alert(`保存失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setRoadmapSaving(false);
    }
  };

  // ============= 渲染 =============

  return (
    <div className="space-y-4">
      {/* 头部：AI模型选择 + 路书按钮 */}
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
                  updateConfigMut.mutate({ prepAiModel: newModel });
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowRoadmapEditor(!showRoadmapEditor)}
          className="text-xs"
        >
          <BookOpen className="w-3 h-3 mr-1" />
          备课路书
        </Button>
      </div>

      {/* 路书编辑面板 */}
      {showRoadmapEditor && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-orange-700">备课路书配置</CardTitle>
              <button type="button" onClick={() => setShowRoadmapEditor(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <p className="text-xs text-gray-500">
              路书内容将作为系统提示词指导AI生成备课方案。留空则使用默认备课提示词。
            </p>
            <DebouncedTextarea
              value={roadmapText}
              onChange={setRoadmapText}
              placeholder="粘贴备课路书内容...&#10;&#10;路书用于指导AI生成备课方案的格式和风格。"
              className="h-[200px] max-h-[50vh] font-mono text-xs overflow-y-auto"
            />
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {roadmapText ? `${roadmapText.length} 字符` : "未配置（使用默认提示词）"}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveRoadmap}
                  disabled={roadmapSaving}
                >
                  {roadmapSaving ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  保存路书
                </Button>
                {roadmapText && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (!confirm("确定要清空备课路书吗？")) return;
                      setRoadmapText("");
                      try {
                        await updateConfigMut.mutateAsync({ lessonPrepRoadmap: "" });
                        alert("备课路书已清空！");
                      } catch (err) {
                        alert(`清空失败：${err instanceof Error ? err.message : "未知错误"}`);
                      }
                    }}
                    disabled={roadmapSaving}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    清空
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 学生选择 + 管理 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">选择学生</Label>
          <button
            type="button"
            onClick={() => setShowStudentMgmt(!showStudentMgmt)}
            className="text-xs text-gray-400 hover:text-orange-600 flex items-center gap-1"
          >
            <UserPlus className="w-3 h-3" />
            管理
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {students.length === 0 && (
            <p className="text-sm text-gray-400">暂无学生，点击右上角「管理」添加</p>
          )}
          {students.map((s: any) => (
            <div key={s.id} className="relative group">
              <button
                type="button"
                onClick={() => handleSelectStudent(s.name)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  selectedStudent === s.name
                    ? "bg-orange-600 text-white shadow-md scale-105"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {s.name}
                {studentHistory[s.name]?.lesson !== undefined && (
                  <span className={`ml-1 text-xs ${
                    selectedStudent === s.name ? "text-orange-200" : "text-gray-400"
                  }`}>
                    ({studentHistory[s.name].lesson + 1})
                  </span>
                )}
              </button>
              {showStudentMgmt && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`确定要移除学生「${s.name}」吗？`)) {
                      const removedName = s.name;
                      removeStudentMut.mutate({ id: s.id }, {
                        onSuccess: () => {
                          if (selectedStudent === removedName) setSelectedStudent("");
                        },
                      });
                    }
                  }}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] hover:bg-red-600"
                  title="移除学生"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {/* 添加学生 */}
        {showStudentMgmt && (
          <div className="flex items-center gap-2">
            <Input
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              placeholder="输入新学生姓名"
              className="h-8 text-sm flex-1 max-w-[200px]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newStudentName.trim()) {
                  addStudentMut.mutate({ name: newStudentName.trim() });
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (newStudentName.trim()) addStudentMut.mutate({ name: newStudentName.trim() });
              }}
              disabled={!newStudentName.trim() || addStudentMut.isPending}
              className="h-8 text-xs"
            >
              <Plus className="w-3 h-3 mr-1" />
              添加
            </Button>
            {addStudentMut.isError && (
              <span className="text-xs text-red-500">{addStudentMut.error?.message || "添加失败"}</span>
            )}
          </div>
        )}
      </div>

      {/* 课次输入 */}
      {selectedStudent && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 flex-1">
              <Label className="text-sm font-medium shrink-0">课次</Label>
              <Input
                value={lessonNumber}
                onChange={(e) => setLessonNumber(e.target.value)}
                placeholder="自动填充（上次+1）"
                className="h-8 text-sm max-w-[120px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="isNewStudent"
                checked={isNewStudent}
                onCheckedChange={(checked) => {
                  setIsNewStudent(checked === true);
                  setLastLessonContent("");
                  setLoadFromDrive(false);
                }}
              />
              <Label htmlFor="isNewStudent" className="text-sm cursor-pointer">
                此生为新生
              </Label>
            </div>
          </div>

          {/* 上次课内容（老生）/ 学生基本情况（新生） */}
          <div className="space-y-2">
            {isNewStudent ? (
              <>
                <Label className="text-sm font-medium">学生基本情况</Label>
                <p className="text-xs text-gray-500">
                  填写新生的基本情况，如模考分数、阅读部分分数、是否有正课升级等。
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">上次课内容</Label>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="loadFromDrive"
                      checked={loadFromDrive}
                      onCheckedChange={(checked) => setLoadFromDrive(checked === true)}
                    />
                    <Label htmlFor="loadFromDrive" className="text-xs text-gray-500 cursor-pointer">
                      从云盘加载
                    </Label>
                  </div>
                </div>
                {loadFromDrive && (
                  <p className="text-xs text-gray-500">
                    提交时将自动从云盘搜索第{lessonNumber ? `${parseInt(lessonNumber.replace(/[^0-9]/g, ''), 10) - 1 || '?'}` : '?'}次课的反馈文件。
                  </p>
                )}
              </>
            )}

            {/* 文本框（不从云盘加载时显示，或新生模式始终显示） */}
            {(isNewStudent || !loadFromDrive) && (
              <div className="space-y-2">
                <Textarea
                  value={lastLessonContent}
                  onChange={(e) => setLastLessonContent(e.target.value)}
                  placeholder={isNewStudent
                    ? "例如：模考总分65，阅读18分，词汇薄弱，无正课升级经历..."
                    : "输入上次课的内容/反馈，或上传文件..."
                  }
                  className="min-h-[120px] max-h-[40vh] resize-y text-sm"
                />
                {!isNewStudent && (
                  <FileUploadInput
                    onFileContent={(content) => {
                      if (content) setLastLessonContent(content);
                    }}
                    disabled={submitMut.isPending}
                  />
                )}
              </div>
            )}
          </div>

          {/* 提交按钮 */}
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitMut.isPending || readLastFeedbackMut.isPending || !selectedStudent}
            className="w-full bg-orange-600 hover:bg-orange-700"
          >
            {submitMut.isPending || readLastFeedbackMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {readLastFeedbackMut.isPending ? "正在加载云盘文件..." : "提交中..."}
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                开始生成备课方案
              </>
            )}
          </Button>
        </div>
      )}

      {/* 备课任务列表 */}
      <div className="pt-2 border-t">
        <p className="text-xs text-gray-400 mb-2">备课任务</p>
        {historyQuery.data && historyQuery.data.length === 0 && (
          <p className="text-xs text-gray-400 py-2">暂无任务</p>
        )}
        <div className="space-y-2">
          {historyQuery.data?.map((t: any) => (
            <PrepTaskCard
              key={t.id}
              task={t}
              isExpanded={expandedTaskId === t.id}
              expandedData={expandedTaskId === t.id ? expandedTaskQuery.data : null}
              onToggle={() => setExpandedTaskId(expandedTaskId === t.id ? null : t.id)}
              onCopy={handleCopy}
              onRetry={(id) => {
                if (confirm("确定要重试此备课任务吗？")) {
                  retryMut.mutate({ id });
                }
              }}
              onDelete={(id) => {
                if (confirm("确定要删除此备课任务吗？")) {
                  deleteMut.mutate({ id });
                }
              }}
              copySuccess={copySuccess}
              now={prepNow}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============= 备课任务卡片 =============

function PrepTaskCard({
  task,
  isExpanded,
  expandedData,
  onToggle,
  onCopy,
  onRetry,
  onDelete,
  copySuccess,
  now,
}: {
  task: any;
  isExpanded: boolean;
  expandedData: any;
  onToggle: () => void;
  onCopy: (text: string) => void;
  onRetry: (id: number) => void;
  onDelete: (id: number) => void;
  copySuccess: boolean;
  now: number;
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
      {/* 卡片头部 */}
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
        {task.lessonNumber && (
          <span className="text-xs text-gray-400">第{task.lessonNumber}次</span>
        )}
        {task.isNewStudent === 1 && (
          <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">新生</span>
        )}
        {isPending && (
          task.streamingChars > 0 ? (
            <span className="text-xs text-blue-500 tabular-nums">已接收{task.streamingChars}字 · {formatDuration(Math.round((now - new Date(task.createdAt).getTime()) / 1000))}</span>
          ) : task.taskStatus === "processing" ? (
            <span className="text-xs text-blue-400">等待AI响应... · {formatDuration(Math.round((now - new Date(task.createdAt).getTime()) / 1000))}</span>
          ) : (
            <span className="text-xs text-blue-500">等待处理</span>
          )
        )}
        {isCompleted && (
          <>
            {task.aiModel && <span className="text-xs text-gray-400">({shortModelName(task.aiModel)})</span>}
            {task.completedAt && (
              <span className="text-xs text-gray-400 tabular-nums">
                {formatDuration(Math.round((new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()) / 1000))}
              </span>
            )}
            {task.streamingChars > 0 && <span className="text-xs text-gray-400">{task.streamingChars}字</span>}
          </>
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
        {(isCompleted || isFailed) && (
          isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        )}
      </div>

      {/* 展开详情 */}
      {isExpanded && (isCompleted || isFailed) && (
        <div className="border-t px-3 py-3 space-y-3">
          {/* 已完成：显示备课方案 */}
          {isCompleted && expandedData?.result && (
            <div className="bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-green-200">
                <span className="text-xs font-medium text-green-700">
                  备课方案
                  {expandedData.result && (
                    <span className="text-gray-400 ml-1">({expandedData.result.length}字)</span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onCopy(expandedData.result); }}
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
                {expandedData.result}
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onRetry(task.id); }}
              className="text-xs h-7"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              重试
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
              className="text-xs h-7 text-red-500 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              删除
            </Button>
          </div>

          {/* 失败信息 */}
          {isFailed && task.errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <span className="text-xs text-red-700 whitespace-pre-wrap break-words">{task.errorMessage}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
