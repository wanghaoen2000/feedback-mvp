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
    refetchInterval: 5000, // 轮询刷新
  });
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
    }
  }, [hwConfigQuery.data]);

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

  // 待处理条目
  const entries = pendingEntriesQuery.data || [];
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
        <div className="flex justify-end">
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
                  <div className="flex items-center gap-2 min-w-0">
                    <EntryStatusIcon status={entry.entryStatus} />
                    <span className="font-medium text-sm">{entry.studentName}</span>
                    <span className="text-xs text-gray-500">{statusLabel(entry.entryStatus)}</span>
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
