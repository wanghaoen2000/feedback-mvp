import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { sortByPinyin } from "@/lib/pinyinSort";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Circle,
  Plus,
  Trash2,
  RefreshCw,
  Send,
  ChevronDown,
  ChevronUp,
  UserPlus,
  BookOpen,
  X,
  History,
  Save,
  FileText,
  Copy,
  Check,
  Database,
  Download,
  Upload,
  Star,
  Eye,
} from "lucide-react";

// ============= 学生名片按钮组件 =============
function StudentButton({
  name,
  planType,
  isSelected,
  onClick,
}: {
  name: string;
  planType: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        px-3 py-2 rounded-lg text-sm font-medium transition-all
        border-2 min-w-[4rem] relative
        ${isSelected
          ? "bg-blue-500 text-white border-blue-500 shadow-md scale-105"
          : "bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50 active:bg-blue-100"
        }
      `}
    >
      {name}
      {planType === "daily" && (
        <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${isSelected ? "bg-yellow-300" : "bg-orange-400"}`} title="日计划" />
      )}
    </button>
  );
}

// ============= 条目状态图标 =============
function EntryStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "pending":
    case "processing":
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case "pre_staged":
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case "confirmed":
      return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-red-500" />;
    default:
      return <Circle className="w-4 h-4 text-gray-300" />;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending": return "等待处理";
    case "processing": return "AI处理中";
    case "pre_staged": return "待入库";
    case "confirmed": return "已入库";
    case "failed": return "处理失败";
    default: return status;
  }
}

/** 模型名称缩写 */
function shortModelName(model: string): string {
  if (!model) return "";
  let s = model.replace(/^claude-/, "");
  s = s.replace(/-\d{8}/, "");
  s = s.replace(/(\d+)-(\d+)/, "$1.$2");
  return s;
}

/** 格式化秒数为 Xs 或 Xm Xs */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

// ============= 主组件 =============
export function HomeworkManagement() {
  // --- 学生名册 ---
  const studentsQuery = trpc.homework.listStudents.useQuery({ status: "active" });
  const addStudentMut = trpc.homework.addStudent.useMutation({
    onSuccess: () => { studentsQuery.refetch(); setNewStudentName(""); setNewStudentPlan("weekly"); },
  });
  const updateStudentMut = trpc.homework.updateStudent.useMutation({
    onSuccess: () => studentsQuery.refetch(),
  });
  const removeStudentMut = trpc.homework.removeStudent.useMutation({
    onSuccess: () => studentsQuery.refetch(),
  });

  // --- 配置 ---
  const hwConfigQuery = trpc.homework.getConfig.useQuery();
  const updateHwConfigMut = trpc.homework.updateConfig.useMutation({
    onSuccess: () => hwConfigQuery.refetch(),
  });

  // --- 条目（预入库队列） ---
  const pendingEntriesQuery = trpc.homework.listPendingEntries.useQuery(undefined, {
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 5000;
      const hasProcessing = data.some((e: any) => e.entryStatus === "pending" || e.entryStatus === "processing");
      return hasProcessing ? 3000 : 5000; // 有处理中的条目时加快轮询
    },
  });

  // 心跳计时器：处理中条目实时刷新秒数
  const [now, setNow] = useState(Date.now());
  const entries = pendingEntriesQuery.data || [];
  const hasProcessing = entries.some((e: any) => e.entryStatus === "pending" || e.entryStatus === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasProcessing]);
  const submitEntryMut = trpc.homework.submitEntry.useMutation({
    onSuccess: () => { pendingEntriesQuery.refetch(); setInputText(""); },
  });
  const retryEntryMut = trpc.homework.retryEntry.useMutation({
    onSuccess: () => pendingEntriesQuery.refetch(),
  });
  const deleteEntryMut = trpc.homework.deleteEntry.useMutation({
    onSuccess: () => pendingEntriesQuery.refetch(),
  });
  const trpcUtils = trpc.useUtils();
  const confirmAllMut = trpc.homework.confirmAll.useMutation({
    onSuccess: () => { pendingEntriesQuery.refetch(); trpcUtils.homework.getStudentStatus.invalidate(); },
  });

  // --- 本地状态 ---
  const [selectedStudent, setSelectedStudent] = useState<string>("");
  const [inputText, setInputText] = useState("");
  const [showStudentMgmt, setShowStudentMgmt] = useState(false);
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentPlan, setNewStudentPlan] = useState<"daily" | "weekly">("weekly");
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [localModel, setLocalModel] = useState("");
  const [localPrompt, setLocalPrompt] = useState("");
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null);
  const [statusCopied, setStatusCopied] = useState(false);
  const promptTextareaRef = React.useRef<HTMLTextAreaElement>(null);

  // --- 数据备份相关 ---
  const [showDataMgmt, setShowDataMgmt] = useState(false);
  const [backupPreview, setBackupPreview] = useState<{
    total: number;
    samples: Array<{ name: string; planType: string; statusPreview: string }>;
    allNames: string[];
    rawContent: string;
  } | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; created: number; updated: number } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const exportBackupMut = trpc.homework.exportBackup.useMutation();
  const previewBackupMut = trpc.homework.previewBackup.useMutation();
  const importBackupMut = trpc.homework.importBackup.useMutation({
    onSuccess: (data) => {
      setImportResult(data);
      setBackupPreview(null);
      studentsQuery.refetch();
      trpcUtils.homework.getStudentStatus.invalidate();
    },
  });

  // --- 发送处理提示词预览 ---
  const [showEntryPreview, setShowEntryPreview] = useState(false);
  const entryPreviewQuery = trpc.homework.previewEntryPrompt.useQuery(
    { studentName: selectedStudent },
    { enabled: !!selectedStudent && showEntryPreview }
  );

  // --- 一键打分相关 ---
  const [showGrading, setShowGrading] = useState(false);
  const [gradingYear, setGradingYear] = useState("");
  const [gradingStartMonth, setGradingStartMonth] = useState("");
  const [gradingStartDay, setGradingStartDay] = useState("");
  const [gradingEndMonth, setGradingEndMonth] = useState("");
  const [gradingEndDay, setGradingEndDay] = useState("");
  const [gradingPrompt, setGradingPrompt] = useState("");
  const [gradingNotes, setGradingNotes] = useState("");
  const [showGradingPreview, setShowGradingPreview] = useState(false);
  const [expandedGradingId, setExpandedGradingId] = useState<number | null>(null);
  const [gradingCopiedId, setGradingCopiedId] = useState<number | null>(null);
  const [activeGradingId, setActiveGradingId] = useState<number | null>(null);
  const submitGradingMut = trpc.homework.submitGrading.useMutation();
  const gradingHistoryQuery = trpc.homework.listGradingTasks.useQuery(undefined, {
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 5000;
      const hasActive = data.some((t: any) => t.taskStatus === "pending" || t.taskStatus === "processing");
      return hasActive ? 3000 : 10000;
    },
  });
  const activeGradingQuery = trpc.homework.getGradingTask.useQuery(
    { id: activeGradingId! },
    {
      enabled: activeGradingId !== null,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data) return 2000;
        return (data.taskStatus === "pending" || data.taskStatus === "processing") ? 2000 : false;
      },
    }
  );

  // 计算星期（硬编码）
  const getDayOfWeek = useCallback((y: number, m: number, d: number): string => {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const date = new Date(y, m - 1, d);
    if (isNaN(date.getTime())) return '';
    return days[date.getDay()];
  }, []);

  const gradingStartDow = useMemo(() => {
    const y = parseInt(gradingYear), m = parseInt(gradingStartMonth), d = parseInt(gradingStartDay);
    return (y && m && d) ? getDayOfWeek(y, m, d) : '';
  }, [gradingYear, gradingStartMonth, gradingStartDay, getDayOfWeek]);

  const gradingEndDow = useMemo(() => {
    const y = parseInt(gradingYear), m = parseInt(gradingEndMonth), d = parseInt(gradingEndDay);
    return (y && m && d) ? getDayOfWeek(y, m, d) : '';
  }, [gradingYear, gradingEndMonth, gradingEndDay, getDayOfWeek]);

  // 构建系统提示词预览
  const gradingSystemPromptPreview = useMemo(() => {
    const y = gradingYear, sm = gradingStartMonth?.padStart(2, '0'), sd = gradingStartDay?.padStart(2, '0');
    const em = gradingEndMonth?.padStart(2, '0'), ed = gradingEndDay?.padStart(2, '0');
    const startStr = `${y}-${sm}-${sd}（${gradingStartDow}）`;
    const endStr = `${y}-${em}-${ed}（${gradingEndDow}）`;
    const parts = [`评分时间段：${startStr} 至 ${endStr}`, '', '<打分要求>', gradingPrompt.trim() || '(未配置)', '</打分要求>'];
    if (gradingNotes.trim()) parts.push('', '<额外说明>', gradingNotes.trim(), '</额外说明>');
    return parts.join('\n');
  }, [gradingYear, gradingStartMonth, gradingStartDay, gradingEndMonth, gradingEndDay, gradingStartDow, gradingEndDow, gradingPrompt, gradingNotes]);

  // --- 学生当前状态 ---
  const studentStatusQuery = trpc.homework.getStudentStatus.useQuery(
    { studentName: selectedStudent },
    { enabled: !!selectedStudent }
  );

  // 从服务器加载配置
  useEffect(() => {
    if (hwConfigQuery.data) {
      setLocalModel(hwConfigQuery.data.hwAiModel || "");
      setLocalPrompt(hwConfigQuery.data.hwPromptTemplate || "");
      if (hwConfigQuery.data.gradingPrompt) setGradingPrompt(hwConfigQuery.data.gradingPrompt);
    }
  }, [hwConfigQuery.data]);

  // 初始化打分日期默认值
  useEffect(() => {
    const now = new Date();
    const bjNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const bjYear = bjNow.getUTCFullYear();
    // 年份：优先用服务器记忆值
    const savedYear = hwConfigQuery.data?.gradingYear;
    setGradingYear(savedYear || String(bjYear));
    // 截止日期 = 昨天
    const endDate = new Date(bjNow.getTime() - 24 * 60 * 60 * 1000);
    setGradingEndMonth(String(endDate.getUTCMonth() + 1));
    setGradingEndDay(String(endDate.getUTCDate()));
    // 起始日期 = 7天前
    const startDate = new Date(bjNow.getTime() - 7 * 24 * 60 * 60 * 1000);
    setGradingStartMonth(String(startDate.getUTCMonth() + 1));
    setGradingStartDay(String(startDate.getUTCDate()));
  }, [hwConfigQuery.data?.gradingYear]);

  // 复制状态自动重置
  useEffect(() => {
    if (!statusCopied) return;
    const timer = setTimeout(() => setStatusCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [statusCopied]);

  // 复制学生当前状态
  const handleCopyStatus = useCallback(async () => {
    const text = studentStatusQuery.data?.currentStatus;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatusCopied(true);
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (ok) setStatusCopied(true);
        else alert("复制失败，请手动选中文本复制");
      } catch {
        alert("复制失败，请手动选中文本复制");
      }
    }
  }, [studentStatusQuery.data?.currentStatus]);

  // 模型预设列表
  const presetList = (hwConfigQuery.data?.modelPresets || "").split("\n").map(s => s.trim()).filter(Boolean);

  // 学生列表（按姓氏拼音排序）
  const students = useMemo(() => sortByPinyin(studentsQuery.data || []), [studentsQuery.data]);

  // 待处理条目统计
  const preStagedCount = entries.filter(e => e.entryStatus === "pre_staged").length;
  const failedCount = entries.filter(e => e.entryStatus === "failed").length;
  const processingCount = entries.filter(e => e.entryStatus === "pending" || e.entryStatus === "processing").length;

  // 发送处理
  const handleSubmit = useCallback(() => {
    if (!selectedStudent || !inputText.trim()) return;
    submitEntryMut.mutate({
      studentName: selectedStudent,
      rawInput: inputText.trim(),
      aiModel: localModel || undefined,
    });
  }, [selectedStudent, inputText, localModel, submitEntryMut]);

  // 添加学生
  const handleAddStudent = useCallback(() => {
    if (!newStudentName.trim()) return;
    addStudentMut.mutate({ name: newStudentName.trim(), planType: newStudentPlan });
  }, [newStudentName, newStudentPlan, addStudentMut]);

  return (
    <div className="space-y-4">
      {/* ===== 头部：设置 + AI模型 ===== */}
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
                  updateHwConfigMut.mutate({ hwAiModel: newModel });
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
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPromptEditor(!showPromptEditor)}
            className="h-8"
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline ml-1">提示词</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowStudentMgmt(!showStudentMgmt)}
            className="h-8"
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline ml-1">管理学生</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setShowDataMgmt(!showDataMgmt); setBackupPreview(null); setImportResult(null); }}
            className="h-8"
          >
            <Database className="w-4 h-4" />
            <span className="hidden sm:inline ml-1">数据</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowGrading(!showGrading)}
            className="h-8"
          >
            <Star className="w-4 h-4" />
            <span className="hidden sm:inline ml-1">打分</span>
          </Button>
        </div>
      </div>

      {/* ===== 提示词管理面板 ===== */}
      {showPromptEditor && (
        <Card className="border-dashed border-blue-200">
          <CardContent className="pt-4 space-y-3">
            <div>
              <Label className="text-sm font-medium flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                学生管理提示词
              </Label>
              <p className="text-xs text-gray-500 mb-1">
                定义学生状态文档的格式要求和AI处理规则。类似学情反馈的路书，每次AI处理时会使用此提示词。
              </p>
              <div className="relative">
                <Textarea
                  ref={promptTextareaRef}
                  value={localPrompt}
                  onChange={(e) => setLocalPrompt(e.target.value)}
                  placeholder={"在这里编写学生管理提示词...\n\n例如：\n- 学生状态文档的格式模板\n- 各模块（作业布置、完成情况、成绩轨迹、词汇进展等）的具体要求\n- 作业标准名称列表\n- 更新规则（哪些字段原封不动保留，哪些需要更新）"}
                  rows={12}
                  className="text-sm font-mono !field-sizing-fixed max-h-[45vh] overflow-y-auto"
                  style={{ fieldSizing: 'fixed' } as React.CSSProperties}
                />
                {/* 一键到顶/到底 */}
                {localPrompt.length > 500 && (
                  <div className="absolute right-2 top-2 flex flex-col gap-1">
                    <button
                      type="button"
                      className="w-7 h-7 rounded bg-white/80 border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-white shadow-sm"
                      onClick={() => { promptTextareaRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      title="滚动到顶部"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="w-7 h-7 rounded bg-white/80 border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-white shadow-sm"
                      onClick={() => { promptTextareaRef.current?.scrollTo({ top: promptTextareaRef.current.scrollHeight, behavior: 'smooth' }); }}
                      title="滚动到底部"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">
                  {localPrompt ? `${localPrompt.length} 字符` : "未配置"}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (!localPrompt || confirm("确定要清空提示词吗？")) {
                        setLocalPrompt("");
                        updateHwConfigMut.mutate({ hwPromptTemplate: "" });
                      }
                    }}
                    disabled={updateHwConfigMut.isPending || !localPrompt}
                  >
                    清空
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => updateHwConfigMut.mutate({ hwPromptTemplate: localPrompt })}
                    disabled={updateHwConfigMut.isPending}
                  >
                    {updateHwConfigMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                    保存提示词
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== 学生管理面板（折叠） ===== */}
      {showStudentMgmt && (
        <Card className="border-dashed">
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="text-sm">添加学生</Label>
                <Input
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  placeholder="学生姓名"
                  className="h-9"
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddStudent(); }}
                />
              </div>
              <Select value={newStudentPlan} onValueChange={(v: "daily" | "weekly") => setNewStudentPlan(v)}>
                <SelectTrigger className="w-24 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">周计划</SelectItem>
                  <SelectItem value="daily">日计划</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleAddStudent} disabled={!newStudentName.trim() || addStudentMut.isPending} className="h-9">
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {students.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {students.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-gray-50 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${s.planType === "daily" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                        {s.planType === "daily" ? "日" : "周"}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600"
                        onClick={() => {
                          const newType = s.planType === "daily" ? "weekly" : "daily";
                          updateStudentMut.mutate({ id: s.id, planType: newType });
                        }}
                        title="切换计划类型"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
                        onClick={() => {
                          if (confirm(`确定要移除学生「${s.name}」吗？`)) {
                            const removedName = s.name;
                            removeStudentMut.mutate({ id: s.id }, {
                              onSuccess: () => {
                                // 如果删除的是当前选中的学生，清空选择
                                if (selectedStudent === removedName) {
                                  setSelectedStudent("");
                                }
                              },
                            });
                          }
                        }}
                        title="移除学生"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {addStudentMut.isError && (
              <p className="text-xs text-red-500">{addStudentMut.error?.message || "添加失败"}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== 数据管理面板（折叠） ===== */}
      {showDataMgmt && (
        <Card className="border-dashed border-emerald-200">
          <CardContent className="pt-4 space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600" />
              数据备份与恢复
            </Label>
            <p className="text-xs text-gray-500">
              导出所有学生数据为 Markdown 备份文件（自动上传到 Google Drive）。每次入库操作也会自动备份。
            </p>

            <div className="flex flex-wrap gap-2">
              {/* 一键导出 */}
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const result = await exportBackupMut.mutateAsync();
                    // 下载为本地文件
                    const blob = new Blob([result.content], { type: "text/markdown;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `学生管理备份_${result.timestamp}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch {}
                }}
                disabled={exportBackupMut.isPending}
              >
                {exportBackupMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Download className="w-3 h-3 mr-1" />}
                一键导出 ({students.length}个学生)
              </Button>

              {/* 导入备份 */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={previewBackupMut.isPending}
              >
                {previewBackupMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />}
                导入备份
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const preview = await previewBackupMut.mutateAsync({ content: text });
                    setBackupPreview({ ...preview, rawContent: text });
                    setImportResult(null);
                  } catch {}
                  e.target.value = "";
                }}
              />
            </div>

            {exportBackupMut.isSuccess && !backupPreview && (
              <div className="text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                已导出 {exportBackupMut.data.studentCount} 个学生，文件已下载并上传到 Google Drive
              </div>
            )}

            {exportBackupMut.isError && (
              <p className="text-xs text-red-500">导出失败: {exportBackupMut.error?.message}</p>
            )}

            {/* 导入预览 */}
            {backupPreview && (
              <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-amber-800">
                  预览：共 {backupPreview.total} 个学生
                </p>
                <div className="space-y-1">
                  {backupPreview.samples.map((s, i) => (
                    <div key={i} className="text-xs bg-white rounded p-2 border border-amber-100">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{s.name}</span>
                        <span className={`px-1 py-0.5 rounded ${s.planType === "daily" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                          {s.planType === "daily" ? "日计划" : "周计划"}
                        </span>
                        {i === 0 && <span className="text-gray-400">(第1个)</span>}
                        {i === 1 && backupPreview.total > 2 && <span className="text-gray-400">(中间)</span>}
                        {i === backupPreview.samples.length - 1 && i > 0 && <span className="text-gray-400">(最后)</span>}
                      </div>
                      <p className="text-gray-500 whitespace-pre-wrap line-clamp-3">{s.statusPreview}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-amber-700">
                  将覆盖现有同名学生的数据，不存在的学生会自动创建。确认导入？
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => importBackupMut.mutate({ content: backupPreview.rawContent })}
                    disabled={importBackupMut.isPending}
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    {importBackupMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                    确认导入
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setBackupPreview(null)}
                    disabled={importBackupMut.isPending}
                  >
                    取消
                  </Button>
                </div>
              </div>
            )}

            {/* 导入结果 */}
            {importResult && (
              <div className="text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                导入完成：共 {importResult.imported} 个学生（新建 {importResult.created}，更新 {importResult.updated}）
              </div>
            )}

            {importBackupMut.isError && (
              <p className="text-xs text-red-500">导入失败: {importBackupMut.error?.message}</p>
            )}

            {previewBackupMut.isError && (
              <p className="text-xs text-red-500">文件解析失败: {previewBackupMut.error?.message}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== 一键打分面板 ===== */}
      {showGrading && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-4 space-y-3">
            {/* 打分提示词 */}
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">打分提示词（保存后每次复用）</Label>
              <Textarea
                value={gradingPrompt}
                onChange={(e) => setGradingPrompt(e.target.value)}
                placeholder="请输入打分的规则和要求..."
                className="text-sm resize-none bg-white"
                rows={5}
                style={{ maxHeight: '8rem' }}
              />
              <div className="flex justify-end mt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => updateHwConfigMut.mutate({ gradingPrompt })}
                  disabled={updateHwConfigMut.isPending}
                >
                  <Save className="w-3 h-3 mr-1" />
                  {updateHwConfigMut.isPending ? "保存中..." : "保存提示词"}
                </Button>
              </div>
            </div>

            {/* 日期范围选择 */}
            <div className="space-y-2">
              <Label className="text-xs text-gray-600 block">评分日期范围</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">年</span>
                  <Input
                    type="number"
                    value={gradingYear}
                    onChange={(e) => setGradingYear(e.target.value)}
                    onBlur={() => {
                      if (gradingYear && gradingYear !== (hwConfigQuery.data?.gradingYear || '')) {
                        updateHwConfigMut.mutate({ gradingYear });
                      }
                    }}
                    className="w-20 h-8 text-sm text-center"
                    min={2020}
                    max={2099}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="text-xs text-gray-500 shrink-0">起始</span>
                <Input
                  type="number"
                  value={gradingStartMonth}
                  onChange={(e) => setGradingStartMonth(e.target.value)}
                  className="w-14 h-8 text-sm text-center"
                  placeholder="月"
                  min={1} max={12}
                />
                <span className="text-gray-400">月</span>
                <Input
                  type="number"
                  value={gradingStartDay}
                  onChange={(e) => setGradingStartDay(e.target.value)}
                  className="w-14 h-8 text-sm text-center"
                  placeholder="日"
                  min={1} max={31}
                />
                <span className="text-gray-400">日</span>
                {gradingStartDow && <span className="text-blue-600 font-medium text-xs">({gradingStartDow})</span>}

                <span className="text-gray-400 mx-1">—</span>

                <span className="text-xs text-gray-500 shrink-0">截止</span>
                <Input
                  type="number"
                  value={gradingEndMonth}
                  onChange={(e) => setGradingEndMonth(e.target.value)}
                  className="w-14 h-8 text-sm text-center"
                  placeholder="月"
                  min={1} max={12}
                />
                <span className="text-gray-400">月</span>
                <Input
                  type="number"
                  value={gradingEndDay}
                  onChange={(e) => setGradingEndDay(e.target.value)}
                  className="w-14 h-8 text-sm text-center"
                  placeholder="日"
                  min={1} max={31}
                />
                <span className="text-gray-400">日</span>
                {gradingEndDow && <span className="text-blue-600 font-medium text-xs">({gradingEndDow})</span>}
              </div>
            </div>

            {/* 额外说明 */}
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">额外说明（可选，本次使用）</Label>
              <Textarea
                value={gradingNotes}
                onChange={(e) => setGradingNotes(e.target.value)}
                placeholder="本次打分的补充说明..."
                className="text-sm resize-none bg-white"
                rows={2}
              />
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  if (!gradingPrompt.trim()) return;
                  const y = gradingYear, sm = gradingStartMonth.padStart(2, '0'), sd = gradingStartDay.padStart(2, '0');
                  const em = gradingEndMonth.padStart(2, '0'), ed = gradingEndDay.padStart(2, '0');
                  try {
                    const res = await submitGradingMut.mutateAsync({
                      startDate: `${y}-${sm}-${sd}`,
                      endDate: `${y}-${em}-${ed}`,
                      gradingPrompt: gradingPrompt.trim(),
                      userNotes: gradingNotes.trim(),
                    });
                    setActiveGradingId(res.id);
                    gradingHistoryQuery.refetch();
                  } catch {}
                }}
                disabled={submitGradingMut.isPending || !gradingPrompt.trim() || !gradingYear || !gradingStartMonth || !gradingStartDay || !gradingEndMonth || !gradingEndDay}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                {submitGradingMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />提交中...</> : <><Star className="w-4 h-4 mr-1" />开始打分</>}
              </Button>
              <span className="text-xs text-gray-400">结果自动存到Google Drive</span>
              <button
                type="button"
                onClick={() => setShowGradingPreview(!showGradingPreview)}
                className="text-xs text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-0.5"
              >
                <Eye className="w-3 h-3" />
                预览发给AI的内容
              </button>
            </div>

            {/* 提示词预览 */}
            {showGradingPreview && (
              <div className="border rounded bg-white p-3 space-y-3">
                <div className="text-xs text-gray-600 space-y-1 bg-amber-50 border border-amber-200 rounded p-2">
                  <div className="font-medium text-amber-800">发送给AI的数据结构：</div>
                  <div>1. <b>系统提示词</b>：评分日期范围 + 你写的打分要求 + 额外说明</div>
                  <div>2. <b>用户消息</b>：所有学生的完整状态数据（和「一键导出」一模一样的内容）</div>
                  <div className="text-gray-500 mt-1">
                    <b>系统提示词</b>就是给AI的"打分说明书"，告诉它该怎么评分、评什么时间段。
                    <b>用户消息</b>就是所有学生的档案数据，AI看完说明书后对这些数据打分。
                  </div>
                </div>
                <details>
                  <summary className="text-xs font-medium text-blue-600 cursor-pointer hover:underline">查看完整的系统提示词</summary>
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 p-2 rounded max-h-60 overflow-y-auto mt-1">{gradingSystemPromptPreview}</pre>
                </details>
                <details>
                  <summary className="text-xs font-medium text-blue-600 cursor-pointer hover:underline">查看用户消息（学生数据太长，点击导出可看完整内容）</summary>
                  <p className="text-xs text-gray-500 mt-1">= 所有 {students.length} 个学生的完整状态文档，格式与「一键导出」相同</p>
                </details>
              </div>
            )}

            {/* 提交错误 */}
            {submitGradingMut.isError && (
              <p className="text-xs text-red-500">提交失败: {submitGradingMut.error?.message}</p>
            )}

            {/* 打分历史记录 */}
            {(gradingHistoryQuery.data && gradingHistoryQuery.data.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <History className="w-4 h-4" />
                  <span>打分历史（保留180天）</span>
                </div>
                <div className="space-y-1.5">
                  {gradingHistoryQuery.data.map((task: any) => (
                    <div key={task.id} className={`border rounded-lg p-2.5 ${
                      task.taskStatus === "failed" ? "border-red-200 bg-red-50" :
                      task.taskStatus === "completed" ? "border-green-200 bg-green-50" :
                      "border-blue-200 bg-blue-50"
                    }`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          {task.taskStatus === "completed" ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                          ) : task.taskStatus === "failed" ? (
                            <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                          ) : (
                            <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                          )}
                          <span className="text-sm font-medium">{task.startDate} ~ {task.endDate}</span>
                          <span className="text-xs text-gray-500">{task.studentCount || 0}人</span>
                          {task.aiModel && <span className="text-xs text-gray-400">({shortModelName(task.aiModel)})</span>}
                          {(task.taskStatus === "pending" || task.taskStatus === "processing") && (task.streamingChars ?? 0) > 0 && (
                            <span className="text-xs text-blue-500">已生成{task.streamingChars}字</span>
                          )}
                          {task.taskStatus === "failed" && task.errorMessage && (
                            <span className="text-xs text-red-500 truncate max-w-[200px]" title={task.errorMessage}>{task.errorMessage}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {task.taskStatus === "completed" && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs px-1.5"
                                onClick={async () => {
                                  // 展开/收起需要先获取完整数据
                                  if (expandedGradingId === task.id) {
                                    setExpandedGradingId(null);
                                  } else {
                                    setActiveGradingId(task.id);
                                    setExpandedGradingId(task.id);
                                  }
                                }}
                              >
                                {expandedGradingId === task.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </Button>
                            </>
                          )}
                          <span className="text-xs text-gray-400">
                            {task.createdAt ? new Date(task.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : ""}
                          </span>
                        </div>
                      </div>

                      {/* 展开查看完整结果 */}
                      {expandedGradingId === task.id && activeGradingQuery.data?.result && (
                        <div className="mt-2 border-t pt-2 space-y-1">
                          <div className="flex items-center justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(activeGradingQuery.data!.result!);
                                  setGradingCopiedId(task.id);
                                  setTimeout(() => setGradingCopiedId(null), 2000);
                                } catch {}
                              }}
                            >
                              {gradingCopiedId === task.id ? <><Check className="w-3 h-3 mr-1" />已复制</> : <><Copy className="w-3 h-3 mr-1" />复制结果</>}
                            </Button>
                          </div>
                          <pre className="text-sm text-gray-800 whitespace-pre-wrap bg-white p-3 rounded border max-h-96 overflow-y-auto">{activeGradingQuery.data.result}</pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== 学生选择区：点选按钮 ===== */}
      <div>
        <Label className="text-sm text-gray-600 mb-2 block">
          选择学生 {selectedStudent && <span className="text-blue-600 font-medium">（当前：{selectedStudent}）</span>}
        </Label>
        {students.length === 0 ? (
          <div className="text-center py-4 text-sm text-gray-400">
            <p>尚未添加学生，点击上方「管理学生」添加</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {students.map((s) => (
              <StudentButton
                key={s.id}
                name={s.name}
                planType={s.planType}
                isSelected={selectedStudent === s.name}
                onClick={() => setSelectedStudent(selectedStudent === s.name ? "" : s.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ===== 输入区 ===== */}
      <div className="space-y-2">
        {selectedStudent && (
          <div className="flex items-center gap-1 text-sm">
            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">{selectedStudent}</span>
            <span className="text-gray-400">的作业信息</span>
          </div>
        )}
        <Textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={selectedStudent
            ? `输入关于 ${selectedStudent} 的作业信息（语音转文字）...\n例：今天交了日常阅读第三章冲分段第1篇，词汇填空天文类第7篇也做了`
            : "请先选择学生..."
          }
          rows={4}
          className="text-sm"
          disabled={!selectedStudent}
        />
        <div className="flex items-center justify-end gap-2">
          {selectedStudent && (
            <button
              type="button"
              onClick={() => setShowEntryPreview(!showEntryPreview)}
              className="text-xs text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-0.5"
            >
              <Eye className="w-3 h-3" />
              看看发给AI什么
            </button>
          )}
          <Button
            onClick={handleSubmit}
            disabled={!selectedStudent || !inputText.trim() || submitEntryMut.isPending}
            className="h-10"
          >
            {submitEntryMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Send className="w-4 h-4 mr-1" />
            )}
            发送处理
          </Button>
        </div>
        {showEntryPreview && selectedStudent && (
          <div className="border rounded bg-gray-50 p-3 space-y-3">
            {entryPreviewQuery.isLoading ? (
              <div className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />加载中...</div>
            ) : entryPreviewQuery.data ? (
              <>
                <div className="text-xs text-gray-600 space-y-1 bg-amber-50 border border-amber-200 rounded p-2">
                  <div className="font-medium text-amber-800">发送给AI的数据结构：</div>
                  <div>1. <b>系统提示词</b>（system prompt）：{entryPreviewQuery.data.studentStatus ? '当前时间 + 学生姓名 + 你配置的提示词' : '当前时间 + 学生姓名 + 你配置的提示词'}</div>
                  <div>2. <b>用户消息</b>（user message）：{entryPreviewQuery.data.studentStatus ? '学生当前状态文档 + 你输入的文字' : '你输入的文字'}</div>
                  <div className="text-gray-500 mt-1">
                    <b>系统提示词</b>就是给AI的"工作说明书"，告诉它该怎么处理你发的内容。
                    <b>用户消息</b>就是实际发过去的数据，包括学生已有的状态和你这次输入的新信息。
                  </div>
                </div>
                <details>
                  <summary className="text-xs font-medium text-blue-600 cursor-pointer hover:underline">查看完整的系统提示词</summary>
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-white p-2 rounded border max-h-60 overflow-y-auto mt-1">{entryPreviewQuery.data.systemPrompt}</pre>
                </details>
                <details open={!!inputText.trim() || !!entryPreviewQuery.data.studentStatus}>
                  <summary className="text-xs font-medium text-blue-600 cursor-pointer hover:underline">查看完整的用户消息</summary>
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-white p-2 rounded border max-h-60 overflow-y-auto mt-1">{
                    [
                      entryPreviewQuery.data.studentStatus ? `【该学生当前的状态文档】\n${entryPreviewQuery.data.studentStatus}` : null,
                      inputText.trim() ? `【本次新增信息（语音转文字原文）】\n${inputText.trim()}` : '【本次新增信息】\n(还没有输入文字)',
                    ].filter(Boolean).join('\n\n')
                  }</pre>
                </details>
              </>
            ) : null}
          </div>
        )}
        {submitEntryMut.isError && (
          <p className="text-xs text-red-500 mt-1">
            <AlertCircle className="w-3 h-3 inline mr-1" />
            {submitEntryMut.error?.message || "提交失败"}
          </p>
        )}
      </div>

      {/* ===== 学生当前状态文档 ===== */}
      {selectedStudent && (
        <div>
          <div className="flex items-center justify-between text-sm text-gray-600 py-1">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4" />
              <span>{selectedStudent} 的当前状态</span>
            </div>
            {studentStatusQuery.data?.currentStatus && (
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 px-2 text-xs ${statusCopied ? "text-green-600" : ""}`}
                onClick={handleCopyStatus}
              >
                {statusCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1" />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    复制
                  </>
                )}
              </Button>
            )}
          </div>

          <Card className="mt-2">
            <CardContent className="px-4 py-3">
              {studentStatusQuery.isLoading ? (
                <div className="flex items-center justify-center py-4 text-sm text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  加载中...
                </div>
              ) : !studentStatusQuery.data?.currentStatus ? (
                <p className="text-center py-4 text-sm text-gray-400">暂无状态记录，提交信息并入库后会在此显示</p>
              ) : (
                <pre className="text-xs text-gray-700 bg-gray-50 rounded p-3 whitespace-pre-wrap font-sans leading-relaxed">{studentStatusQuery.data.currentStatus}</pre>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== 预入库队列 ===== */}
      {entries.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                预入库队列
                <span className="text-sm font-normal text-gray-500">
                  （{entries.length}条{preStagedCount > 0 && `，${preStagedCount}条可入库`}{failedCount > 0 && `，${failedCount}条失败`}{processingCount > 0 && `，${processingCount}条处理中`}）
                </span>
              </CardTitle>
              {preStagedCount > 0 && (
                <Button
                  size="sm"
                  onClick={() => confirmAllMut.mutate()}
                  disabled={confirmAllMut.isPending}
                  className="h-8"
                >
                  {confirmAllMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                  一键入库 ({preStagedCount})
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={`border rounded-lg p-3 ${
                  entry.entryStatus === "failed" ? "border-red-200 bg-red-50" :
                  entry.entryStatus === "pre_staged" ? "border-green-200 bg-green-50" :
                  entry.entryStatus === "confirmed" ? "border-emerald-200 bg-emerald-50" :
                  "border-gray-200 bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <EntryStatusIcon status={entry.entryStatus} />
                    <span className="font-medium text-sm">{entry.studentName}</span>
                    {(entry.entryStatus === "pending" || entry.entryStatus === "processing") ? (
                      // 处理中：实时进度
                      <>
                        {(entry.streamingChars ?? 0) > 0 ? (
                          <span className="text-xs text-blue-500 tabular-nums">已接收{entry.streamingChars}字</span>
                        ) : entry.entryStatus === "processing" ? (
                          <span className="text-xs text-blue-400">等待AI响应...</span>
                        ) : (
                          <span className="text-xs text-gray-500">{statusLabel(entry.entryStatus)}</span>
                        )}
                        {entry.startedAt && (
                          <span className="text-xs text-gray-400 tabular-nums">
                            {formatDuration(Math.round((now - new Date(entry.startedAt).getTime()) / 1000))}
                          </span>
                        )}
                      </>
                    ) : (
                      // 已完成/失败：静态信息
                      <>
                        <span className="text-xs text-gray-500">{statusLabel(entry.entryStatus)}</span>
                        {entry.aiModel && <span className="text-xs text-gray-400">({shortModelName(entry.aiModel)})</span>}
                        {entry.startedAt && entry.completedAt && (
                          <span className="text-xs text-gray-400 tabular-nums">
                            {formatDuration(Math.round((new Date(entry.completedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000))}
                          </span>
                        )}
                        {(entry.streamingChars ?? 0) > 0 && (
                          <span className="text-xs text-gray-400">{entry.streamingChars}字</span>
                        )}
                      </>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(entry.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {/* 展开/收起按钮 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                    >
                      {expandedEntry === entry.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                    {/* 重试按钮（失败或待入库状态可用） */}
                    {(entry.entryStatus === "failed" || entry.entryStatus === "pre_staged") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                        onClick={() => {
                          if (confirm(`确定要重新处理「${entry.studentName}」的这条记录吗？\nAI将重新分析原文并生成结果。`)) {
                            retryEntryMut.mutate({ id: entry.id });
                          }
                        }}
                        disabled={retryEntryMut.isPending}
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1" />重试
                      </Button>
                    )}
                    {/* 删除按钮 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-3 text-xs text-gray-400 hover:text-red-600 hover:bg-red-50"
                      onClick={() => {
                        if (confirm(`确定要删除「${entry.studentName}」的这条记录吗？\n删除后无法恢复。`)) {
                          deleteEntryMut.mutate({ id: entry.id });
                        }
                      }}
                      disabled={deleteEntryMut.isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* 原文预览（折叠时） */}
                {expandedEntry !== entry.id && (
                  <p className="text-xs text-gray-500 mt-1 truncate">{entry.rawInput}</p>
                )}

                {/* 展开详情 */}
                {expandedEntry === entry.id && (
                  <div className="mt-2 space-y-2">
                    {/* AI处理结果（放在最上面，这是用户最关心的） */}
                    <div>
                      <p className="text-sm font-semibold text-blue-700 mb-1">AI处理结果：</p>
                      {entry.parsedContent ? (
                        <pre className="text-xs text-gray-700 bg-white rounded p-2 whitespace-pre-wrap font-sans border border-blue-100">{entry.parsedContent}</pre>
                      ) : (entry.entryStatus === "pending" || entry.entryStatus === "processing") ? (
                        <div className="flex items-center gap-2 text-xs text-blue-500 bg-white rounded p-2 border border-blue-100">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          AI处理中，请稍候...
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 bg-white rounded p-2 border border-gray-100">暂无结果</p>
                      )}
                    </div>
                    {entry.errorMessage && (
                      <div>
                        <p className="text-xs font-medium text-red-600">错误信息：</p>
                        <p className="text-xs text-red-500 bg-white rounded p-2 break-words whitespace-pre-wrap">{entry.errorMessage}</p>
                      </div>
                    )}
                    {/* 原文（放在下面） */}
                    <div>
                      <p className="text-xs font-medium text-gray-500">原文：</p>
                      <p className="text-xs text-gray-600 bg-white rounded p-2 whitespace-pre-wrap">{entry.rawInput}</p>
                    </div>
                    {entry.aiModel && (
                      <p className="text-xs text-gray-400">使用模型：{entry.aiModel}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 无条目时的提示 */}
      {entries.length === 0 && students.length > 0 && (
        <div className="text-center py-6 text-sm text-gray-400">
          <p>选择学生 → 输入语音转文字内容 → 发送处理</p>
          <p className="mt-1">处理结果会出现在这里，确认后一键入库</p>
        </div>
      )}
    </div>
  );
}
