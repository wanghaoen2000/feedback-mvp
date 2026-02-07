import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Clock, CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
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
} as const;

const STEP_NAMES = ["反馈", "复习", "测试", "提取", "气泡图"];

// 格式化秒数为可读时间
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `${min}分${sec}秒` : `${min}分`;
}

// 格式化字符数
function formatChars(chars: number, stepKey: string): string {
  // 二进制文件（docx/png）显示为KB
  if (stepKey === "review" || stepKey === "test" || stepKey === "bubbleChart") {
    if (chars > 1024) return `${(chars / 1024).toFixed(0)}KB`;
    return `${chars}B`;
  }
  // 文本文件显示字数
  return `${chars}字`;
}

export function TaskHistory({ activeTaskId }: TaskHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now()); // 用于心跳计时

  // 查询任务历史
  const historyQuery = trpc.bgTask.history.useQuery(undefined, {
    refetchInterval: isOpen ? 5000 : 30000,
    staleTime: 3000,
  });

  const tasks = historyQuery.data || [];

  // 有新的运行中任务时自动展开
  useEffect(() => {
    if (activeTaskId) {
      setIsOpen(true);
    }
  }, [activeTaskId]);

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

  // 计算任务总字数
  const getTotalChars = (stepResults: any): number => {
    if (!stepResults) return 0;
    return Object.entries(stepResults).reduce((sum, [key, step]: [string, any]) => {
      if (step.status === "completed" && step.chars) {
        // 只统计文本文件的字数（排除二进制）
        if (key === "feedback" || key === "extraction") return sum + step.chars;
      }
      return sum;
    }, 0);
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
            <div className="divide-y max-h-[400px] overflow-y-auto">
              {tasks.map((task) => {
                const config = STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
                const StatusIcon = config.icon;
                const isExpanded = expandedTaskId === task.id;
                const isActive = task.id === activeTaskId;
                const duration = getTaskDuration(task);
                const isRunning = task.status === "running" || task.status === "pending";
                const totalChars = getTotalChars(task.stepResults);

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
                          {/* 完成后显示总字数 */}
                          {!isRunning && totalChars > 0 && (
                            <span>· {totalChars}字</span>
                          )}
                        </div>
                      </div>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${config.bg} ${config.text} border ${config.border}`}>
                        {config.label}
                      </span>
                    </button>

                    {/* 展开详情 */}
                    {isExpanded && (
                      <div className="px-3 pb-2.5 space-y-1">
                        {task.stepResults && (
                          <div className="space-y-1">
                            {Object.entries(task.stepResults).map(([stepKey, stepResult]: [string, any]) => {
                              const stepIndex = ["feedback", "review", "test", "extraction", "bubbleChart"].indexOf(stepKey);
                              const stepName = STEP_NAMES[stepIndex] || stepKey;
                              return (
                                <div key={stepKey} className="flex items-center gap-2 text-xs">
                                  {stepResult.status === "completed" ? (
                                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                                  ) : stepResult.status === "failed" ? (
                                    <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                                  ) : stepResult.status === "running" ? (
                                    <Loader2 className="h-3 w-3 text-blue-500 animate-spin shrink-0" />
                                  ) : (
                                    <Clock className="h-3 w-3 text-gray-300 shrink-0" />
                                  )}
                                  <span className="text-gray-600">{stepName}</span>
                                  {stepResult.fileName && (
                                    <span className="text-gray-400 truncate max-w-[120px]">{stepResult.fileName}</span>
                                  )}
                                  {/* 完成步骤显示耗时和大小 */}
                                  {stepResult.status === "completed" && (
                                    <span className="text-gray-400 ml-auto shrink-0">
                                      {stepResult.duration != null && <>{stepResult.duration}秒</>}
                                      {stepResult.chars != null && stepResult.duration != null && " · "}
                                      {stepResult.chars != null && formatChars(stepResult.chars, stepKey)}
                                    </span>
                                  )}
                                  {stepResult.error && (
                                    <span className="text-red-400 truncate ml-auto">{stepResult.error}</span>
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
                            {totalChars > 0 && ` · ${totalChars}字`}
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
