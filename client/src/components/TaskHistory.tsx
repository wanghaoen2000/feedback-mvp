import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Clock, CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw, Copy, Check, X, ArrowUp, ArrowDown, Download, ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface TaskHistoryProps {
  /** 当前正在提交的任务ID（用于高亮） */
  activeTaskId?: string | null;
}

const STATUS_CONFIG = {
  pending: { label: "等待中", icon: Clock, bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600" },
  running: { label: "生成中", icon: Loader2, bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-600" },
  completed: { label: "已完成", icon: CheckCircle2, bg: "bg-green-50", border: "border-green-200", text: "text-green-600" },
  failed: { label: "失败", icon: XCircle, bg: "bg-red-50", border: "border-red-200", text: "text-red-600" },
  partial: { label: "部分完成", icon: AlertTriangle, bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-600" },
  cancelled: { label: "已取消", icon: XCircle, bg: "bg-gray-50", border: "border-gray-300", text: "text-gray-500" },
} as const;

const STEP_NAMES = ["反馈", "复习", "测试", "提取", "气泡图"];

// 格式化秒数为可读时间
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `${min}分${sec}秒` : `${min}分`;
}

// 判断是否为文本步骤（文本步骤显示字数）
function isTextStep(stepKey: string): boolean {
  return stepKey === "feedback" || stepKey === "extraction" || stepKey === "review" || stepKey === "test";
}

// 将完整模型ID缩短为易读名称
// 例: "claude-opus-4-5-20251101-cc" → "opus-4.5-cc"
//     "claude-sonnet-4-5-20250929" → "sonnet-4.5"
function shortModelName(model: string): string {
  if (!model) return "";
  // 移除 "claude-" 前缀
  let s = model.replace(/^claude-/, "");
  // 移除日期部分 (8位数字)
  s = s.replace(/-\d{8}/, "");
  // 将 "4-5" 格式转为 "4.5"
  s = s.replace(/(\d+)-(\d+)/, "$1.$2");
  return s;
}

// 从 Google Drive webViewLink 提取 fileId
// 格式: https://drive.google.com/file/d/{FILE_ID}/view?...
//   或: https://docs.google.com/document/d/{FILE_ID}/edit?...
function extractFileId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/\/d\/([^/]+)/);
  return match ? match[1] : null;
}

// 收集任务的可下载文件
function getDownloadFiles(stepResults: any) {
  if (!stepResults) return { docFiles: [] as { fileId: string; fileName: string }[], bubbleFiles: [] as { fileId: string; fileName: string }[] };

  const docFiles: { fileId: string; fileName: string }[] = [];

  // 复习文档
  if (stepResults.review?.status === "completed" && stepResults.review?.url) {
    const fid = extractFileId(stepResults.review.url);
    if (fid) docFiles.push({ fileId: fid, fileName: stepResults.review.fileName || "复习文档.docx" });
  }
  // 测试文档
  if (stepResults.test?.status === "completed" && stepResults.test?.url) {
    const fid = extractFileId(stepResults.test.url);
    if (fid) docFiles.push({ fileId: fid, fileName: stepResults.test.fileName || "测试文档.docx" });
  }

  const bubbleFiles: { fileId: string; fileName: string }[] = [];

  if (stepResults.bubbleChart?.status === "completed") {
    // 班课模式：多个学生气泡图
    if (stepResults.bubbleChart.files && stepResults.bubbleChart.files.length > 0) {
      for (const f of stepResults.bubbleChart.files) {
        const fid = extractFileId(f.url);
        if (fid) bubbleFiles.push({ fileId: fid, fileName: f.fileName });
      }
    } else if (stepResults.bubbleChart.url) {
      // 1对1模式：单个气泡图
      const fid = extractFileId(stepResults.bubbleChart.url);
      if (fid) bubbleFiles.push({ fileId: fid, fileName: stepResults.bubbleChart.fileName || "气泡图.png" });
    }
  }

  return { docFiles, bubbleFiles };
}

/** 下载按钮组件（带状态反馈） */
function DownloadButton({ label, files }: {
  label: string;
  files: { fileId: string; fileName: string }[];
}) {
  const [state, setState] = useState<"idle" | "downloading" | "success" | "failed">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // 成功/失败后自动恢复
  useEffect(() => {
    if (state === "success" || state === "failed") {
      const timer = setTimeout(() => { setState("idle"); setErrorMsg(""); }, state === "success" ? 4000 : 5000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state === "downloading" || files.length === 0) return;
    setState("downloading");
    setErrorMsg("");

    try {
      for (let i = 0; i < files.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 500));
        const { fileId, fileName } = files[i];
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
          const res = await fetch(
            `/api/download-drive-file?fileId=${encodeURIComponent(fileId)}&fileName=${encodeURIComponent(fileName)}`,
            { signal: controller.signal }
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "下载失败" }));
            throw new Error(err.error || `HTTP ${res.status}`);
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 3000);
        } finally {
          clearTimeout(timeout);
        }
      }
      setState("success");
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "下载超时" : (err?.message || "下载失败");
      setErrorMsg(msg);
      setState("failed");
    }
  };

  if (files.length === 0) return null;

  return (
    <button
      className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
        state === "idle" ? "bg-blue-500 hover:bg-blue-600 text-white active:bg-blue-700" :
        state === "downloading" ? "bg-blue-400 text-white/90 cursor-wait" :
        state === "success" ? "bg-green-500 text-white" :
        "bg-red-500 text-white"
      }`}
      onClick={handleDownload}
      disabled={state === "downloading"}
    >
      {state === "downloading" && <Loader2 className="h-4 w-4 animate-spin" />}
      {state === "success" && <Check className="h-4 w-4" />}
      {state === "failed" && <XCircle className="h-4 w-4" />}
      {state === "idle" && <Download className="h-4 w-4" />}
      <span>
        {state === "idle" && label}
        {state === "downloading" && "下载中..."}
        {state === "success" && (files.length > 1 ? `下载成功 (${files.length}个文件)` : "下载成功")}
        {state === "failed" && (errorMsg ? `下载失败: ${errorMsg}` : "下载失败")}
      </span>
    </button>
  );
}

/** 通用全文查看器 */
function ContentViewer({ taskId, onClose, title, queryFn }: {
  taskId: string;
  onClose: () => void;
  title: string;
  queryFn: "feedbackContent" | "extractionContent";
}) {
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const feedbackQuery = trpc.bgTask.feedbackContent.useQuery({ taskId }, { enabled: queryFn === "feedbackContent" });
  const extractionQuery = trpc.bgTask.extractionContent.useQuery({ taskId }, { enabled: queryFn === "extractionContent" });
  const contentQuery = queryFn === "feedbackContent" ? feedbackQuery : extractionQuery;

  const handleCopy = useCallback(async () => {
    if (!contentQuery.data?.content) return;
    try {
      await navigator.clipboard.writeText(contentQuery.data.content);
      setCopied(true);
    } catch {
      // fallback for older browsers / non-HTTPS
      try {
        const textarea = document.createElement("textarea");
        textarea.value = contentQuery.data.content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (ok) {
          setCopied(true);
        } else {
          alert("复制失败，请手动选中文本复制");
        }
      } catch {
        alert("复制失败，请手动选中文本复制");
      }
    }
  }, [contentQuery.data?.content]);

  // 复制成功后2秒自动恢复按钮
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="mt-1 border rounded bg-white">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b bg-gray-50">
        <span className="text-xs text-gray-500 font-medium">{title}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            title="回到顶部"
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            title="滚动到底部"
            onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 px-2 text-xs ${copied ? "text-green-600" : ""}`}
            onClick={handleCopy}
            disabled={!contentQuery.data?.content}
          >
            {copied ? (
              <><Check className="h-3 w-3 mr-1" />已复制</>
            ) : (
              <><Copy className="h-3 w-3 mr-1" />复制全文</>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {/* 内容区 */}
      <div ref={scrollRef} className="p-2 max-h-[30vh] sm:max-h-[300px] overflow-y-auto">
        {contentQuery.isLoading ? (
          <div className="flex items-center justify-center py-4 text-xs text-gray-400">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            加载中...
          </div>
        ) : contentQuery.error ? (
          <div className="flex flex-col items-center gap-2 py-3">
            <p className="text-xs text-red-500">{contentQuery.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => contentQuery.refetch()}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              重试
            </Button>
          </div>
        ) : (
          <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-sans leading-relaxed">
            {contentQuery.data?.content}
          </pre>
        )}
      </div>
    </div>
  );
}

export function TaskHistory({ activeTaskId }: TaskHistoryProps) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [viewingFeedbackTaskId, setViewingFeedbackTaskId] = useState<string | null>(null);
  const [viewingExtractionTaskId, setViewingExtractionTaskId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now()); // 用于心跳计时

  // 查询任务历史（始终3秒刷新）
  const historyQuery = trpc.bgTask.history.useQuery(undefined, {
    refetchInterval: 3000,
    staleTime: 3000,
  });

  const tasks = historyQuery.data || [];

  // 取消任务
  const cancelMutation = trpc.bgTask.cancel.useMutation({
    onSuccess: () => {
      historyQuery.refetch();
    },
  });

  // 清理指向已消失任务的引用
  useEffect(() => {
    if (viewingFeedbackTaskId && !tasks.find((t) => t.id === viewingFeedbackTaskId)) {
      setViewingFeedbackTaskId(null);
    }
    if (viewingExtractionTaskId && !tasks.find((t) => t.id === viewingExtractionTaskId)) {
      setViewingExtractionTaskId(null);
    }
    if (expandedTaskId && !tasks.find((t) => t.id === expandedTaskId)) {
      setExpandedTaskId(null);
    }
  }, [tasks, viewingFeedbackTaskId, viewingExtractionTaskId, expandedTaskId]);

  // 心跳计时器：运行中任务每秒更新
  const hasRunning = tasks.some((t) => t.status === "running" || t.status === "pending");
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasRunning]);

  // 计算摘要信息
  const runningCount = tasks.filter((t) => t.status === "running" || t.status === "pending").length;
  const failedCount = tasks.filter((t) => t.status === "failed" || t.status === "partial").length;

  const formatTime = (isoStr: string) => {
    const d = new Date(isoStr);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    if (isToday) {
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) + " " +
      d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  };

  // 计算任务总耗时（秒）
  const getTaskDuration = (task: any): number => {
    const start = new Date(task.createdAt).getTime();
    if (task.completedAt) {
      return Math.round((new Date(task.completedAt).getTime() - start) / 1000);
    }
    if (task.status === "running" || task.status === "pending") {
      return Math.round((now - start) / 1000);
    }
    return 0;
  };

  // 计算反馈文档字数（完成后的最终字数）
  const getFeedbackChars = (stepResults: any): number => {
    if (!stepResults?.feedback?.chars) return 0;
    return (stepResults.feedback.status === "completed" || stepResults.feedback.status === "truncated") ? stepResults.feedback.chars : 0;
  };

  // 获取正在生成中的实时字符数（running 状态的 feedback 步骤）
  const getRunningChars = (stepResults: any): number => {
    if (!stepResults?.feedback) return 0;
    if (stepResults.feedback.status === "running" && stepResults.feedback.chars) {
      return stepResults.feedback.chars;
    }
    return 0;
  };

  if (tasks.length === 0 && !historyQuery.isLoading) {
    return null;
  }

  return (
    <div className="w-full">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <Clock className="h-4 w-4 text-gray-500" />
        <span className="font-medium">任务记录</span>
        {tasks.length > 0 && (
          <span className="text-xs text-gray-400">({tasks.length})</span>
        )}
        {runningCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-blue-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            {runningCount}进行中
          </span>
        )}
        {failedCount > 0 && (
          <span className="text-xs text-red-500">{failedCount}失败</span>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden mx-1 mb-3">
        {historyQuery.isLoading && tasks.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
            加载中...
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">
            暂无任务记录
          </div>
        ) : (
          <div className="divide-y">
              {tasks.map((task) => {
                const config = STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
                const StatusIcon = config.icon;
                const isExpanded = expandedTaskId === task.id;
                const isActive = task.id === activeTaskId;
                const duration = getTaskDuration(task);
                const isRunning = task.status === "running" || task.status === "pending";
                const feedbackChars = getFeedbackChars(task.stepResults);
                const runningChars = getRunningChars(task.stepResults);

                return (
                  <div
                    key={task.id}
                    className={`${config.bg} ${isActive ? "ring-2 ring-blue-300 ring-inset" : ""}`}
                  >
                    {/* 任务主行 */}
                    <button
                      className="w-full px-3 py-2.5 flex items-center gap-2 text-left"
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                    >
                      <StatusIcon
                        className={`h-4 w-4 shrink-0 ${config.text} ${
                          task.status === "running" ? "animate-spin" : ""
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{task.displayName}</span>
                          {isRunning && (
                            <span className="text-xs text-blue-500">
                              ({task.currentStep}/{task.totalSteps})
                            </span>
                          )}
                          {task.model && (
                            <span className="text-xs text-gray-400 shrink-0">
                              ({shortModelName(task.model)})
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                          <span>{formatTime(task.createdAt)}</span>
                          {task.courseType === "class" && <span>· 班课</span>}
                          {/* 耗时显示：运行中实时更新，完成后固定 */}
                          {duration > 0 && (
                            <span className={isRunning ? "text-blue-500 tabular-nums" : "text-gray-400"}>
                              · {formatDuration(duration)}
                            </span>
                          )}
                          {/* 运行中显示实时字符数或等待状态 */}
                          {isRunning && (
                            runningChars > 0 ? (
                              <span className="text-blue-500 tabular-nums">· 已接收{runningChars}字</span>
                            ) : (
                              <span className="text-blue-400">· 等待AI响应...</span>
                            )
                          )}
                          {/* 完成后显示反馈字数 */}
                          {!isRunning && feedbackChars > 0 && (
                            <span>· 反馈{feedbackChars}字</span>
                          )}
                        </div>
                      </div>
                      {isRunning ? (
                        <button
                          className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("确定要停止此任务吗？")) {
                              cancelMutation.mutate({ taskId: task.id });
                            }
                          }}
                          disabled={cancelMutation.isPending}
                        >
                          {cancelMutation.isPending ? "取消中..." : "停止"}
                        </button>
                      ) : (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${config.bg} ${config.text} border ${config.border} shrink-0`}>
                          {config.label}
                        </span>
                      )}
                    </button>

                    {/* 展开详情 */}
                    {isExpanded && (
                      <div className="px-3 pb-2.5 space-y-1">
                        {task.stepResults && (
                          <div className="space-y-1">
                            {Object.entries(task.stepResults).map(([stepKey, stepResult]: [string, any]) => {
                              const stepIndex = ["feedback", "review", "test", "extraction", "bubbleChart"].indexOf(stepKey);
                              const stepName = STEP_NAMES[stepIndex] || stepKey;
                              const isFeedbackCompleted = stepKey === "feedback" && stepResult.status === "completed";
                              const isExtractionCompleted = stepKey === "extraction" && stepResult.status === "completed";
                              const isClickable = isFeedbackCompleted || isExtractionCompleted;
                              return (
                                <div key={stepKey}>
                                  <div
                                    className={`flex items-center gap-2 text-xs ${
                                      isClickable ? "cursor-pointer hover:bg-black/5 rounded px-1 -mx-1 py-0.5" : ""
                                    }`}
                                    onClick={isClickable ? (e) => {
                                      e.stopPropagation();
                                      if (isFeedbackCompleted) {
                                        setViewingFeedbackTaskId(
                                          viewingFeedbackTaskId === task.id ? null : task.id
                                        );
                                      } else if (isExtractionCompleted) {
                                        setViewingExtractionTaskId(
                                          viewingExtractionTaskId === task.id ? null : task.id
                                        );
                                      }
                                    } : undefined}
                                  >
                                    {stepResult.status === "completed" ? (
                                      <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                                    ) : stepResult.status === "failed" ? (
                                      <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                                    ) : stepResult.status === "running" ? (
                                      <Loader2 className="h-3 w-3 text-blue-500 animate-spin shrink-0" />
                                    ) : (
                                      <Clock className="h-3 w-3 text-gray-300 shrink-0" />
                                    )}
                                    <span className={`shrink-0 whitespace-nowrap ${isClickable ? "text-blue-600 underline" : "text-gray-600"}`}>
                                      {stepName}
                                    </span>
                                    {stepResult.fileName && (
                                      stepResult.url ? (
                                        <a
                                          href={stepResult.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-400 hover:text-blue-600 truncate min-w-0 inline-flex items-center gap-0.5"
                                          onClick={(e) => e.stopPropagation()}
                                          title="在 Google Drive 中查看"
                                        >
                                          {stepResult.fileName}
                                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                        </a>
                                      ) : (
                                        <span className="text-gray-400 truncate min-w-0">{stepResult.fileName}</span>
                                      )
                                    )}
                                    {/* 运行中步骤显示实时字符数或等待状态 */}
                                    {stepResult.status === "running" && (
                                      isTextStep(stepKey) && stepResult.chars > 0 ? (
                                        <span className="text-blue-500 ml-auto shrink-0 tabular-nums">
                                          已接收{stepResult.chars}字
                                        </span>
                                      ) : (
                                        <span className="text-blue-400 ml-auto shrink-0">
                                          等待AI响应...
                                        </span>
                                      )
                                    )}
                                    {/* 完成步骤显示耗时和字数 */}
                                    {(stepResult.status === "completed" || stepResult.status === "truncated") && (
                                      <span className="text-gray-400 ml-auto shrink-0">
                                        {stepResult.duration != null && formatDuration(stepResult.duration)}
                                        {isTextStep(stepKey) && stepResult.chars != null && (
                                          <>{stepResult.duration != null && " · "}{stepResult.chars}字</>
                                        )}
                                      </span>
                                    )}
                                    {stepResult.error && (
                                      <span className="text-red-400 truncate ml-auto">{stepResult.error}</span>
                                    )}
                                  </div>
                                  {/* 生成诊断信息（非流式/流式、轮次、token用量） */}
                                  {stepResult.genInfo && isExpanded && (
                                    <div className="text-xs text-gray-500 pl-5 mt-0.5">{stepResult.genInfo}</div>
                                  )}
                                  {/* 反馈全文查看器 */}
                                  {isFeedbackCompleted && viewingFeedbackTaskId === task.id && (
                                    <ContentViewer
                                      taskId={task.id}
                                      title="反馈全文"
                                      queryFn="feedbackContent"
                                      onClose={() => setViewingFeedbackTaskId(null)}
                                    />
                                  )}
                                  {/* 提取全文查看器 */}
                                  {isExtractionCompleted && viewingExtractionTaskId === task.id && (
                                    <ContentViewer
                                      taskId={task.id}
                                      title="提取全文"
                                      queryFn="extractionContent"
                                      onClose={() => setViewingExtractionTaskId(null)}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {task.errorMessage && (
                          <p className="text-xs text-red-500 mt-1">{task.errorMessage}</p>
                        )}
                        {task.completedAt && (
                          <p className="text-xs text-gray-400 mt-1">
                            完成于 {formatTime(task.completedAt)}
                            {duration > 0 && ` · 总计${formatDuration(duration)}`}
                            {feedbackChars > 0 && ` · 反馈${feedbackChars}字`}
                          </p>
                        )}
                        {/* 下载按钮区域 */}
                        {(task.status === "completed" || task.status === "partial") && (() => {
                          const { docFiles, bubbleFiles } = getDownloadFiles(task.stepResults);
                          if (docFiles.length === 0 && bubbleFiles.length === 0) return null;
                          return (
                            <div className="mt-2 space-y-2">
                              <DownloadButton
                                label="下载复习与测试文档"
                                files={docFiles}
                              />
                              <DownloadButton
                                label={bubbleFiles.length > 1 ? `下载全部气泡图 (${bubbleFiles.length}张)` : "下载气泡图"}
                                files={bubbleFiles}
                              />
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 底部刷新条 */}
          <div className="bg-gray-50 border-t px-3 py-1.5 flex items-center justify-between">
            <span className="text-xs text-gray-400">最近3天 · 自动刷新</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => historyQuery.refetch()}
              disabled={historyQuery.isFetching}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${historyQuery.isFetching ? "animate-spin" : ""}`} />
              刷新
            </Button>
          </div>
        </div>
    </div>
  );
}
