import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  StopCircle,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** 格式化日期 */
function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 状态颜色映射 */
function statusConfig(status: string) {
  switch (status) {
    case "pending":
      return { icon: Clock, color: "text-gray-400", bg: "bg-gray-50", label: "等待中" };
    case "running":
      return { icon: Loader2, color: "text-blue-500", bg: "bg-blue-50", label: "生成中" };
    case "completed":
      return { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-50", label: "已完成" };
    case "failed":
      return { icon: XCircle, color: "text-red-500", bg: "bg-red-50", label: "失败" };
    case "stopped":
    case "cancelled":
      return { icon: StopCircle, color: "text-yellow-600", bg: "bg-yellow-50", label: "已停止" };
    default:
      return { icon: Clock, color: "text-gray-400", bg: "bg-gray-50", label: status };
  }
}

/** 模板类型中文名 */
const TEMPLATE_NAMES: Record<string, string> = {
  markdown_styled: "教学材料",
  markdown_plain: "通用文档",
  markdown_file: "MD文件",
  word_card: "词汇卡片",
  writing_material: "写作素材",
};

/** 子任务项组件 */
function BatchItemRow({
  item,
  onRetry,
  isRetrying,
}: {
  item: {
    id: number;
    taskNumber: number;
    status: string;
    chars: number;
    filename: string | null;
    url: string | null;
    error: string | null;
    truncated: boolean;
  };
  onRetry: () => void;
  isRetrying: boolean;
}) {
  const cfg = statusConfig(item.status);
  const Icon = cfg.icon;
  const isRunning = item.status === "running";

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-md ${cfg.bg}`}>
      <Icon
        className={`w-4 h-4 ${cfg.color} shrink-0 ${isRunning ? "animate-spin" : ""}`}
      />
      <span className="text-sm font-medium text-gray-700 w-10 shrink-0">
        #{item.taskNumber}
      </span>
      <div className="flex-1 min-w-0">
        {item.status === "running" && (
          <span className="text-sm text-blue-600">
            生成中{item.chars > 0 ? `... ${item.chars}字` : "..."}
          </span>
        )}
        {item.status === "completed" && (
          <span className={`text-sm ${item.truncated ? "text-yellow-600" : "text-green-600"}`}>
            {item.truncated ? "已截断" : "完成"} {item.chars}字
            {item.filename && (
              <span className="text-gray-400 ml-1 text-xs">{item.filename}</span>
            )}
          </span>
        )}
        {item.status === "failed" && (
          <span className="text-sm text-red-600 truncate block">
            {item.error || "失败"}
          </span>
        )}
        {item.status === "pending" && (
          <span className="text-sm text-gray-400">等待中</span>
        )}
      </div>
      {/* Google Drive 链接 */}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-700 shrink-0"
          title="在 Google Drive 中查看"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
      {/* 重做按钮：已完成或失败的才显示 */}
      {(item.status === "completed" || item.status === "failed") && (
        <button
          onClick={onRetry}
          disabled={isRetrying}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          title="重新生成"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isRetrying ? "animate-spin" : ""}`}
          />
        </button>
      )}
    </div>
  );
}

/** 单个批量任务卡片 */
function BatchTaskCard({
  task,
}: {
  task: {
    id: string;
    displayName: string;
    status: string;
    totalItems: number;
    completedItems: number;
    failedItems: number;
    errorMessage: string | null;
    templateType: string | null;
    storagePath: string | null;
    createdAt: string;
    completedAt: string | null;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const [retryingItems, setRetryingItems] = useState<Set<number>>(new Set());

  const cfg = statusConfig(task.status);
  const Icon = cfg.icon;
  const isRunning = task.status === "running" || task.status === "pending";

  // 子项查询（仅展开时启用）
  const { data: items, refetch: refetchItems } = trpc.batchTask.items.useQuery(
    { batchId: task.id },
    {
      enabled: expanded,
      refetchInterval: isRunning && expanded ? 3000 : false,
    }
  );

  // 重试子任务
  const retryMutation = trpc.batchTask.retryItem.useMutation();

  const handleRetryItem = async (taskNumber: number) => {
    setRetryingItems((prev) => new Set(prev).add(taskNumber));
    try {
      await retryMutation.mutateAsync({ batchId: task.id, taskNumber });
      // 重试已启动，等子项列表刷新显示状态变化
      setTimeout(() => refetchItems(), 1000);
    } catch (err) {
      console.error("重试失败:", err);
    } finally {
      setRetryingItems((prev) => {
        const next = new Set(prev);
        next.delete(taskNumber);
        return next;
      });
    }
  };

  // 停止批量任务
  const cancelMutation = trpc.batchTask.cancel.useMutation();

  // 进度百分比
  const progress =
    task.totalItems > 0
      ? Math.round(((task.completedItems + task.failedItems) / task.totalItems) * 100)
      : 0;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* 批量任务头部 */}
      <div
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${cfg.bg}`}
        onClick={() => setExpanded(!expanded)}
      >
        {/* 展开/折叠图标 */}
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
        )}

        {/* 状态图标 */}
        <Icon
          className={`w-5 h-5 ${cfg.color} shrink-0 ${isRunning ? "animate-spin" : ""}`}
        />

        {/* 任务名称和信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-800 text-sm">{task.displayName}</span>
            {task.templateType && (
              <span className="text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                {TEMPLATE_NAMES[task.templateType] || task.templateType}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {formatTime(task.createdAt)}
            {task.completedAt && ` → ${formatTime(task.completedAt)}`}
          </div>
        </div>

        {/* 进度 */}
        <div className="text-right shrink-0">
          <div className="text-sm">
            <span className="text-green-600 font-medium">{task.completedItems}</span>
            {task.failedItems > 0 && (
              <>
                <span className="text-gray-400">/</span>
                <span className="text-red-500 font-medium">{task.failedItems}</span>
              </>
            )}
            <span className="text-gray-400">/{task.totalItems}</span>
          </div>
          {isRunning && (
            <div className="w-20 h-1.5 bg-gray-200 rounded-full mt-1">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        {/* 停止按钮（仅运行中） */}
        {isRunning && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              cancelMutation.mutate({ batchId: task.id });
            }}
            disabled={cancelMutation.isPending}
            className="p-1.5 rounded hover:bg-red-100 text-red-500 hover:text-red-700 disabled:opacity-50 shrink-0"
            title="停止任务"
          >
            <StopCircle className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 错误信息 */}
      {task.errorMessage && task.status !== "completed" && (
        <div className="px-4 py-2 bg-red-50 text-red-600 text-xs border-t">
          {task.errorMessage}
        </div>
      )}

      {/* 展开的子任务列表 */}
      {expanded && (
        <div className="border-t px-4 py-3 space-y-1.5 max-h-[50vh] overflow-y-auto bg-white">
          {!items ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中...
            </div>
          ) : items.length === 0 ? (
            <div className="text-gray-400 text-sm py-2">暂无子任务</div>
          ) : (
            items.map((item) => (
              <BatchItemRow
                key={item.id}
                item={item}
                onRetry={() => handleRetryItem(item.taskNumber)}
                isRetrying={retryingItems.has(item.taskNumber)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 批量任务历史组件（主入口） */
export function BatchTaskHistory() {
  const { data: batchTasks, isLoading } = trpc.batchTask.history.useQuery(undefined, {
    refetchInterval: 3000, // 3秒刷新
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
          加载批量任务记录...
        </CardContent>
      </Card>
    );
  }

  if (!batchTasks || batchTasks.length === 0) {
    return null; // 没有任务时不显示
  }

  // 统计
  const runningCount = batchTasks.filter((t) => t.status === "running" || t.status === "pending").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-600" />
          批量任务记录
          <span className="text-sm font-normal text-gray-500">
            （最近3天，共 {batchTasks.length} 个批次）
          </span>
          {runningCount > 0 && (
            <span className="text-sm font-normal text-blue-600 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {runningCount} 个运行中
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {batchTasks.map((task) => (
          <BatchTaskCard key={task.id} task={task} />
        ))}
      </CardContent>
    </Card>
  );
}
