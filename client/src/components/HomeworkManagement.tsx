import React, { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
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
  Settings,
  ChevronDown,
  ChevronUp,
  UserPlus,
  BookOpen,
  X,
  History,
  Eye,
  EyeOff,
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
    onSuccess: () => { pendingEntriesQuery.refetch(); trpcUtils.homework.listStudentEntries.invalidate(); },
  });

  // --- 本地状态 ---
  const [selectedStudent, setSelectedStudent] = useState<string>("");
  const [inputText, setInputText] = useState("");
  const [showStudentMgmt, setShowStudentMgmt] = useState(false);
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentPlan, setNewStudentPlan] = useState<"daily" | "weekly">("weekly");
  const [showSettings, setShowSettings] = useState(false);
  const [localNotes, setLocalNotes] = useState("");
  const [localModel, setLocalModel] = useState("");
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null);
  const [showRecords, setShowRecords] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<number | null>(null);

  // --- 已入库记录 ---
  const studentEntriesQuery = trpc.homework.listStudentEntries.useQuery(
    { studentName: selectedStudent, limit: 50 },
    { enabled: !!selectedStudent && showRecords }
  );

  // 从服务器加载配置
  useEffect(() => {
    if (hwConfigQuery.data) {
      setLocalNotes(hwConfigQuery.data.hwSupplementaryNotes || "");
      setLocalModel(hwConfigQuery.data.hwAiModel || "");
    }
  }, [hwConfigQuery.data]);

  // 模型预设列表
  const presetList = (hwConfigQuery.data?.modelPresets || "").split("\n").map(s => s.trim()).filter(Boolean);

  // 学生列表
  const students = studentsQuery.data || [];

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
      supplementaryNotes: localNotes || undefined,
    });
  }, [selectedStudent, inputText, localModel, localNotes, submitEntryMut]);

  // 保存配置
  const saveConfig = useCallback(() => {
    updateHwConfigMut.mutate({
      hwAiModel: localModel,
      hwSupplementaryNotes: localNotes,
    });
  }, [localModel, localNotes, updateHwConfigMut]);

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
            onClick={() => setShowSettings(!showSettings)}
            className="h-8"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline ml-1">设置</span>
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

      {/* ===== 设置面板（折叠） ===== */}
      {showSettings && (
        <Card className="border-dashed">
          <CardContent className="pt-4 space-y-3">
            <div>
              <Label className="text-sm font-medium">补充说明（每次发送给AI的附加信息）</Label>
              <p className="text-xs text-gray-500 mb-1">
                如：术语映射（冲分=冲刺、进阶=强化、基础=初级）、作业名称标准等
              </p>
              <Textarea
                value={localNotes}
                onChange={(e) => setLocalNotes(e.target.value)}
                placeholder={"示例：\n冲分和冲刺是同一个意思\n进阶和强化是同一个意思\n基础和初级是同一个意思\n日常阅读分为：基础练习、进阶练习、冲分练习"}
                rows={4}
                className="text-sm"
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={saveConfig} disabled={updateHwConfigMut.isPending}>
                {updateHwConfigMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                保存设置
              </Button>
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

      {/* ===== 已入库记录 ===== */}
      {selectedStudent && (
        <div>
          <button
            type="button"
            onClick={() => setShowRecords(!showRecords)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-blue-600 transition-colors py-1"
          >
            {showRecords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            <History className="w-4 h-4" />
            <span>{selectedStudent} 的已入库记录</span>
            {studentEntriesQuery.data && (
              <span className="text-xs text-gray-400">（{studentEntriesQuery.data.total}条）</span>
            )}
          </button>

          {showRecords && (
            <Card className="mt-2">
              <CardContent className="px-4 py-3">
                {studentEntriesQuery.isLoading ? (
                  <div className="flex items-center justify-center py-4 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    加载中...
                  </div>
                ) : !studentEntriesQuery.data || studentEntriesQuery.data.entries.length === 0 ? (
                  <p className="text-center py-4 text-sm text-gray-400">暂无已入库记录</p>
                ) : (
                  <div className="space-y-2">
                    {studentEntriesQuery.data.entries.map((record) => (
                      <div
                        key={record.id}
                        className="border rounded-lg p-3 border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="text-xs text-gray-500">
                              {new Date(record.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                              {" "}
                              {new Date(record.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs shrink-0"
                            onClick={() => setExpandedRecord(expandedRecord === record.id ? null : record.id)}
                          >
                            {expandedRecord === record.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </Button>
                        </div>

                        {/* 折叠时显示解析结果摘要 */}
                        {expandedRecord !== record.id && (
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2 whitespace-pre-wrap">
                            {record.parsedContent || record.rawInput}
                          </p>
                        )}

                        {/* 展开详情 */}
                        {expandedRecord === record.id && (
                          <div className="mt-2 space-y-2">
                            {record.parsedContent && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1">AI解析结果：</p>
                                <pre className="text-xs text-gray-700 bg-white rounded p-2 whitespace-pre-wrap font-sans">{record.parsedContent}</pre>
                              </div>
                            )}
                            <div>
                              <p className="text-xs font-medium text-gray-500 mb-1">原文：</p>
                              <p className="text-xs text-gray-500 bg-white rounded p-2 whitespace-pre-wrap">{record.rawInput}</p>
                            </div>
                            {record.aiModel && (
                              <p className="text-xs text-gray-400">模型：{record.aiModel}</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
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
                  <div className="flex gap-1 shrink-0">
                    {entry.entryStatus === "failed" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => retryEntryMut.mutate({ id: entry.id, supplementaryNotes: localNotes || undefined })}
                        disabled={retryEntryMut.isPending}
                      >
                        <RefreshCw className="w-3 h-3 mr-1" />重试
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-gray-400 hover:text-red-500"
                      onClick={() => deleteEntryMut.mutate({ id: entry.id })}
                      disabled={deleteEntryMut.isPending}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                    >
                      {expandedEntry === entry.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
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
                    <div>
                      <p className="text-xs font-medium text-gray-600">原文：</p>
                      <p className="text-xs text-gray-700 bg-white rounded p-2 whitespace-pre-wrap">{entry.rawInput}</p>
                    </div>
                    {entry.parsedContent && (
                      <div>
                        <p className="text-xs font-medium text-gray-600">AI解析结果：</p>
                        <pre className="text-xs text-gray-700 bg-white rounded p-2 whitespace-pre-wrap font-sans">{entry.parsedContent}</pre>
                      </div>
                    )}
                    {entry.errorMessage && (
                      <div>
                        <p className="text-xs font-medium text-red-600">错误信息：</p>
                        <p className="text-xs text-red-500 bg-white rounded p-2">{entry.errorMessage}</p>
                      </div>
                    )}
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
