import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Clock, CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw, Copy, Check, X, ArrowUp, ArrowDown } from "lucide-react";
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

/** 反馈全文查看器 */
function FeedbackViewer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentQuery = trpc.bgTask.feedbackContent.useQuery({ taskId });

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
        <span className="text-xs text-gray-500 font-medium">反馈全文</span>
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
  const [isOpen, setIsOpen] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [viewingFeedbackTaskId, setViewingFeedbackTaskId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now()); // 用于心跳计时

  // 查询任务历史
  const historyQuery = trpc.bgTask.history.useQuery(undefined, {
    refetchInterval: isOpen ? 3000 : 30000,
    staleTime: 3000,
  });

  const tasks = historyQuery.data || [];

  // 取消任务
  const cancelMutation = trpc.bgTask.cancel.useMutation({
    onSuccess: () => {
      historyQuery.refetch();
    },
  });

  // 有新的运行中任务时自动展开
  useEffect(() => {
    if (activeTaskId) {
      setIsOpen(true);
    }
  }, [activeTaskId]);

  // 清理指向已消失任务的引用
  useEffect(() => {
    if (viewingFeedbackTaskId && !tasks.find((t) => t.id === viewingFeedbackTaskId)) {
      setViewingFeedbackTaskId(null);
    }
    if (expandedTaskId && !tasks.find((t) => t.id === expandedTaskId)) {
      setExpandedTaskId(null);
    }
  }, [tasks, viewingFeedbackTaskId, expandedTaskId]);

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
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full flex items-center justify-between px-3 py-2 h-auto text-sm"
        >
          <div className="flex items-center gap-2">
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
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
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
            <div className="divide-y max-h-[60vh] sm:max-h-[500px] overflow-y-auto">
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
                              return (
                                <div key={stepKey}>
                                  <div
                                    className={`flex items-center gap-2 text-xs ${
                                      isFeedbackCompleted ? "cursor-pointer hover:bg-black/5 rounded px-1 -mx-1 py-0.5" : ""
                                    }`}
                                    onClick={isFeedbackCompleted ? (e) => {
                                      e.stopPropagation();
                                      setViewingFeedbackTaskId(
                                        viewingFeedbackTaskId === task.id ? null : task.id
                                      );
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
                                    <span className={`shrink-0 whitespace-nowrap ${isFeedbackCompleted ? "text-blue-600 underline" : "text-gray-600"}`}>
                                      {stepName}
                                    </span>
                                    {stepResult.fileName && (
                                      <span className="text-gray-400 truncate min-w-0">{stepResult.fileName}</span>
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
                                    <FeedbackViewer
                                      taskId={task.id}
                                      onClose={() => setViewingFeedbackTaskId(null)}
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
      </CollapsibleContent>
    </Collapsible>
  );
}
