import React, { useState, useCallback, useEffect, useRef, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BatchProcess } from "@/components/BatchProcess";
import { GlobalSettings } from "@/components/GlobalSettings";
import { RoadmapSettings } from "@/components/RoadmapSettings";
import { FileUploadInput } from "@/components/FileUploadInput";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  FolderOpen,
  Circle,
  XCircle,
  ExternalLink,
  RefreshCw,
  Save,
  Square,
  Download,
  FolderDown,
  Search,
  MinusCircle,
  User,
  Users,
  SkipForward,
  Copy,
  ArrowUp,
  ArrowDown,
  BookOpen,
  PenLine,
  Eye,
  LogOut,
} from "lucide-react";
import { VERSION_DISPLAY } from "../version.generated";
import { TaskHistory } from "@/components/TaskHistory";
import { HomeworkManagement } from "@/components/HomeworkManagement";
import { HomeworkCorrection } from "@/components/HomeworkCorrection";

// 步骤状态类型
interface StepStatus {
  step: number;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  message?: string;
  error?: string;
  detail?: string; // 详细信息，如“AI正在生成中...”
  progress?: number; // 进度百分比 0-100
  startTime?: number; // 开始时间戳
  endTime?: number; // 结束时间戳
  uploadResult?: {
    fileName: string;
    url: string;
    path: string;
    folderUrl?: string;
  };
}

// 状态图标组件
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return <Circle className="w-5 h-5 text-gray-300" />;
    case 'running':
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    case 'success':
      return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    case 'error':
      return <XCircle className="w-5 h-5 text-red-500" />;
    case 'skipped':
      return <SkipForward className="w-5 h-5 text-gray-400" />;
    default:
      return <Circle className="w-5 h-5 text-gray-300" />;
  }
}

// 从 Google Drive URL 提取文件 ID
function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/file\/d\/([^/]+)/);
  return match ? match[1] : null;
}

// 可下载的步骤名称（复习文档、测试本、气泡图）
const DOWNLOADABLE_STEPS = new Set(['复习文档', '测试本', '气泡图']);

// 初始步骤状态（一对一）
const initialSteps: StepStatus[] = [
  { step: 1, name: "学情反馈", status: 'pending' },
  { step: 2, name: "复习文档", status: 'pending' },
  { step: 3, name: "测试本", status: 'pending' },
  { step: 4, name: "课后信息提取", status: 'pending' },
  { step: 5, name: "气泡图", status: 'pending' },
];

// 初始步骤状态（小班课）
const initialClassSteps: StepStatus[] = [
  { step: 1, name: "学情反馈", status: 'pending' },
  { step: 2, name: "复习文档", status: 'pending' },
  { step: 3, name: "测试本", status: 'pending' },
  { step: 4, name: "课后信息提取", status: 'pending' },
  { step: 5, name: "气泡图", status: 'pending' },
];

// V63.8: 并行任务状态类型
interface ParallelTaskStatus {
  status: 'pending' | 'running' | 'success' | 'failed';
  startTime?: number;
  endTime?: number;
  charCount?: number;  // 字符数
  error?: string;      // 失败时的错误信息
  uploadResult?: {
    fileName: string;
    url: string;
    path: string;
    folderUrl?: string;
  };
}

// 并行任务初始状态
const initialParallelTasks = {
  review: { status: 'pending' as const },
  test: { status: 'pending' as const },
  extraction: { status: 'pending' as const },
  bubble: { status: 'pending' as const },
};

/**
 * 防抖文本框：内部管理 local state，打字只重渲染自身；
 * debounceMs 毫秒无输入后才同步给父组件，避免大文本场景下整个页面卡顿。
 * onBlur 时立即 flush，确保用户点按钮前父 state 已更新。
 */
const DebouncedTextarea = memo(function DebouncedTextarea({
  value: externalValue,
  onValueChange,
  debounceMs = 300,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, 'onChange' | 'value'> & {
  value: string;
  onValueChange: (value: string) => void;
  debounceMs?: number;
}) {
  const [localValue, setLocalValue] = useState(externalValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef(externalValue);
  const localValueRef = useRef(localValue);
  localValueRef.current = localValue;

  // 仅当父组件主动改值（非来自本组件的 debounce）时同步
  useEffect(() => {
    if (externalValue !== lastSentRef.current) {
      setLocalValue(externalValue);
      lastSentRef.current = externalValue;
    }
  }, [externalValue]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setLocalValue(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastSentRef.current = val;
      onValueChange(val);
    }, debounceMs);
  }, [onValueChange, debounceMs]);

  // 失焦时立即 flush，保证点按钮前父 state 已是最新
  const handleBlur = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const val = localValueRef.current;
      lastSentRef.current = val;
      onValueChange(val);
    }
  }, [onValueChange]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return <Textarea {...props} value={localValue} onChange={handleChange} onBlur={handleBlur} />;
});

/**
 * 根据日期字符串计算星期
 * @param dateStr 日期字符串，如 "1月15日" 或 "1.15"
 * @param year 年份，如 "2026"
 * @returns 星期字符串，如 "周四"，如果无法解析则返回 null
 */
function getWeekday(dateStr: string, year: string): string | null {
  if (!dateStr || !year) return null;
  
  // 尝试解析日期格式："1月15日", "1.15", "01-15"
  let month: number | null = null;
  let day: number | null = null;
  
  // 匹配 "X月X日" 格式
  const chineseMatch = dateStr.match(/(\d{1,2})月(\d{1,2})日?/);
  if (chineseMatch) {
    month = parseInt(chineseMatch[1]);
    day = parseInt(chineseMatch[2]);
  }
  
  // 匹配 "X.X" 或 "X-X" 格式
  if (!month || !day) {
    const dotMatch = dateStr.match(/(\d{1,2})[.\-](\d{1,2})/);
    if (dotMatch) {
      month = parseInt(dotMatch[1]);
      day = parseInt(dotMatch[2]);
    }
  }
  
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  
  try {
    const yearNum = parseInt(year);
    const date = new Date(yearNum, month - 1, day);
    
    // 验证日期是否有效（防止日期溢出，如 2月30日）
    if (date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return weekdays[date.getDay()];
  } catch {
    return null;
  }
}

/**
 * 根据日期字符串生成 MMDD 格式的4位数字
 * 例如 "2月6日" → "0206", "12月15日" → "1215"
 */
function getMMDD(dateStr: string): string | null {
  if (!dateStr) return null;
  let month: number | null = null;
  let day: number | null = null;

  // 优先匹配中文格式: "1月15日"
  const chineseMatch = dateStr.match(/(\d{1,2})月(\d{1,2})日?/);
  if (chineseMatch) {
    month = parseInt(chineseMatch[1]);
    day = parseInt(chineseMatch[2]);
  }

  // ISO格式: "2026-01-15" → 提取月和日
  if (!month || !day) {
    const isoMatch = dateStr.match(/\d{4}[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) {
      month = parseInt(isoMatch[1]);
      day = parseInt(isoMatch[2]);
    }
  }

  // 短格式: "1.15" 或 "1-15"
  if (!month || !day) {
    const dotMatch = dateStr.match(/^(\d{1,2})[.\-](\d{1,2})$/);
    if (dotMatch) {
      month = parseInt(dotMatch[1]);
      day = parseInt(dotMatch[2]);
    }
  }

  if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return String(month).padStart(2, '0') + String(day).padStart(2, '0');
}

/**
 * 将SVG字符串转换为PNG的base64编码
 * 使用Canvas在前端转换，解决服务器缺少中文字体的问题
 */
async function svgToPngBase64(svgString: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // 创建一个临时的Image对象
    const img = new Image();
    
    // 将SVG转换为data URL
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    img.onload = () => {
      // 创建Canvas
      const canvas = document.createElement('canvas');
      
      // 从 SVG 中提取 viewBox 或使用默认尺寸
      const viewBoxMatch = svgString.match(/viewBox=["']([\d\s.]+)["']/);
      let width = 900;
      let height = 700;
      
      if (viewBoxMatch) {
        const [, , w, h] = viewBoxMatch[1].split(/\s+/).map(Number);
        if (w && h) {
          width = w;
          height = h;
        }
      }
      
      // 设置高分辨率（视网屏的话使用 2x）
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('无法创建Canvas上下文'));
        return;
      }
      
      // 填充白色背景
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // 缩放并绘制SVG
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      
      // 转换为base64
      const pngDataUrl = canvas.toDataURL('image/png');
      // 移除 "data:image/png;base64," 前缀
      const base64 = pngDataUrl.split(',')[1];
      
      URL.revokeObjectURL(url);
      resolve(base64);
    };
    
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG加载失败'));
    };
    
    img.src = url;
  });
}

const MAX_CLASS_STUDENTS = 10; // 班级最多记录10个学生

export default function Home() {
  const { user: authUser, logout } = useAuth();

  // 课程类型：'oneToOne' 或 'class'
  const [courseType, setCourseType] = useState<'oneToOne' | 'class'>('oneToOne');
  
  // 基本信息（一对一）
  const [studentName, setStudentName] = useState("");
  const [lessonNumber, setLessonNumber] = useState("");
  // 获取当前北京时间（UTC+8）
  const getBeijingTime = () => {
    const now = new Date();
    // timezoneOffset 是本地时间与UTC的差值（分钟），北京时区为-480
    // 要转换为北京时间：先转UTC（+timezoneOffset），再转北京（+8小时）
    return new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60 * 1000);
  };
  const [lessonDate, setLessonDate] = useState(() => {
    const beijingTime = getBeijingTime();
    return `${beijingTime.getUTCMonth() + 1}月${beijingTime.getUTCDate()}日`;
  }); // 本次课日期，默认当前北京时间日期
  const [currentYear, setCurrentYear] = useState(() => {
    return getBeijingTime().getUTCFullYear().toString();
  }); // 年份，默认当前北京时间年份
  
  // 小班课特有字段
  const [classNumber, setClassNumber] = useState(""); // 班号
  // 固定8个输入框，填了名字的算出勤，空的自动忽略
  const [attendanceStudents, setAttendanceStudents] = useState<string[]>(Array(MAX_CLASS_STUDENTS).fill('')); // 出勤学生名单（10个位置）
  const [isClassFirstLesson, setIsClassFirstLesson] = useState(false); // 小班课首次课
  
  // 三段文本
  const [lastFeedback, setLastFeedback] = useState("");
  const [currentNotes, setCurrentNotes] = useState("");
  const [transcript, setTranscript] = useState("");

  // 文件上传状态（文件名和内容）
  const [lastFeedbackFile, setLastFeedbackFile] = useState<{ name: string; content: string } | null>(null);
  const [currentNotesFile, setCurrentNotesFile] = useState<{ name: string; content: string } | null>(null);
  const [transcriptFile, setTranscriptFile] = useState<{ name: string; content: string } | null>(null);

  // 自动从 Downloads 文件夹加载录音转文字
  const [autoLoadTranscript, setAutoLoadTranscript] = useState(true);
  const autoLoadedTranscriptRef = useRef<string | null>(null);
  // 多段录音：勾选后明确指定段数
  const [multiSegment, setMultiSegment] = useState(false);
  const [segmentCount, setSegmentCount] = useState(3);
  const transcriptSegmentsRef = useRef<{ count: number; chars: number[] } | null>(null);

  // 自动从 Downloads 文件夹加载课堂笔记
  const [autoLoadCurrentNotes, setAutoLoadCurrentNotes] = useState(true);
  const autoLoadedCurrentNotesRef = useRef<string | null>(null);

  // 自动从 Google Drive 本地文件夹加载上次反馈
  const [autoLoadLastFeedback, setAutoLoadLastFeedback] = useState(true);
  const autoLoadedLastFeedbackRef = useRef<string | null>(null);

  // 特殊选项
  const [isFirstLesson, setIsFirstLesson] = useState(false);

  const [apiModel, setApiModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [modelPresets, setModelPresets] = useState(""); // 模型预设列表
  const [roadmap, setRoadmap] = useState(""); // V9路书内容（一对一）
  const [firstLessonTemplate, setFirstLessonTemplate] = useState(""); // 一对一首次课范例
  const [roadmapClass, setRoadmapClass] = useState(""); // 小班课路书内容
  const [classFirstLessonTemplate, setClassFirstLessonTemplate] = useState(""); // 小班课首次课范例
  const [driveBasePath, setDriveBasePath] = useState(""); // Google Drive存储根路径
  const [maxTokens, setMaxTokens] = useState("64000"); // AI生成的最大token数
  const [configLoaded, setConfigLoaded] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [steps, setSteps] = useState<StepStatus[]>(initialSteps);
  const [currentStep, setCurrentStep] = useState(0);
  const [feedbackContent, setFeedbackContent] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isStopping, setIsStopping] = useState(false); // 是否正在停止
  const [currentGeneratingStudent, setCurrentGeneratingStudent] = useState<string | null>(null); // 当前正在生成的学生名
  
  // V63.8: 并行任务状态（复习文档、测试本、课后信息、气泡图）
  const [parallelTasks, setParallelTasks] = useState<{
    review: ParallelTaskStatus;
    test: ParallelTaskStatus;
    extraction: ParallelTaskStatus;
    bubble: ParallelTaskStatus;
  }>(initialParallelTasks);
  const [isParallelPhase, setIsParallelPhase] = useState(false); // 是否处于并行生成阶段
  
  // 小班课生成状态
  const [classFeedbacks, setClassFeedbacks] = useState<{studentName: string; feedback: string}[]>([]); // 各学生的学情反馈
  const [bubbleChartProgress, setBubbleChartProgress] = useState<{studentName: string; status: 'pending' | 'running' | 'success' | 'error'}[]>([]); // 气泡图生成进度
  
  // V63.11: 小班课并行任务状态（复习文档、测试本、课后信息、气泡图）
  const [classParallelTasks, setClassParallelTasks] = useState<{
    review: ParallelTaskStatus;
    test: ParallelTaskStatus;
    extraction: ParallelTaskStatus;
    bubble: ParallelTaskStatus;
  }>(initialParallelTasks);
  const [isClassParallelPhase, setIsClassParallelPhase] = useState(false); // 小班课是否处于并行生成阶段
  const [isExportingLog, setIsExportingLog] = useState(false); // 是否正在导出日志
  const [exportLogResult, setExportLogResult] = useState<{
    success: boolean;
    message: string;
    path?: string;
    url?: string;
  } | null>(null); // 导出结果
  const [feedbackCopied, setFeedbackCopied] = useState(false); // 学情反馈是否已复制
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null); // 当前提交的后台任务ID
  const [hwImportStatus, setHwImportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [showFeedbackPreview, setShowFeedbackPreview] = useState(false);
  const feedbackScrollRef = useRef<HTMLDivElement | null>(null); // 学情反馈内容滚动容器
  const abortControllerRef = useRef<AbortController | null>(null); // 用于取消请求
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清理 skipStep 定时器
  useEffect(() => {
    return () => { if (skipTimerRef.current) clearTimeout(skipTimerRef.current); };
  }, []);

  // 监听后台任务完成，自动清除 activeTaskId（解锁 retryStep）
  const activeTaskMonitor = trpc.bgTask.history.useQuery(undefined, {
    enabled: !!activeTaskId,
    refetchInterval: activeTaskId ? 5000 : false,
  });
  useEffect(() => {
    if (!activeTaskId || !activeTaskMonitor.data) return;
    const task = activeTaskMonitor.data.find((t: any) => t.id === activeTaskId);
    if (task && task.status !== 'running' && task.status !== 'pending') {
      setActiveTaskId(null);
    }
  }, [activeTaskId, activeTaskMonitor.data]);

  // ========== 学生课次记忆功能 ==========
  const STUDENT_LESSON_STORAGE_KEY = `studentLessonHistoryV2_${authUser?.id || 'default'}`;
  const MAX_RECENT_STUDENTS = 30; // 最多保存30个最近学生

  // 学生记录类型
  interface StudentRecord {
    lesson: number;
    lastUsed: number; // 时间戳，用于排序
    students?: string[]; // 班级记录：积累的学生名单（去重合并）
  }

  // 从服务器获取学生历史记录（首次加载）
  const [studentHistoryCache, setStudentHistoryCache] = useState<Record<string, StudentRecord>>({});
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // 从服务器获取历史记录
  const { data: serverHistory } = trpc.config.getStudentHistory.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity, // 不自动重新获取
  });

  // 保存到服务器的 mutation
  const saveHistoryMutation = trpc.config.saveStudentHistory.useMutation();

  // 当服务器数据返回时，更新缓存
  useEffect(() => {
    if (serverHistory && !historyLoaded) {
      setStudentHistoryCache(serverHistory as Record<string, StudentRecord>);
      setHistoryLoaded(true);
      // 同步到 localStorage 作为离线缓存
      try {
        localStorage.setItem(STUDENT_LESSON_STORAGE_KEY, JSON.stringify(serverHistory));
      } catch (e) {
        console.warn('同步到 localStorage 失败:', e);
      }
    }
  }, [serverHistory, historyLoaded]);

  // 从缓存或 localStorage 获取学生课次历史
  const getStudentLessonHistory = (): Record<string, StudentRecord> => {
    // 优先使用缓存（已从服务器加载）
    if (historyLoaded && Object.keys(studentHistoryCache).length > 0) {
      return studentHistoryCache;
    }
    // 回退到 localStorage（离线或首次加载）
    try {
      const data = localStorage.getItem(STUDENT_LESSON_STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  };

  // 获取最近使用的学生列表（按时间从近到远排序，最多30个）
  const getRecentStudents = (): Array<{ name: string; lesson: number }> => {
    const history = getStudentLessonHistory();
    return Object.entries(history)
      .filter(([name]) => !name.startsWith('班级:')) // 排除班级记录
      .sort((a, b) => b[1].lastUsed - a[1].lastUsed) // 按时间降序
      .slice(0, MAX_RECENT_STUDENTS)
      .map(([name, record]) => ({ name, lesson: record.lesson }));
  };

  // 获取最近使用的班级列表（按时间从近到远排序）
  const getRecentClasses = (): Array<{ classNumber: string; lesson: number; studentCount: number }> => {
    const history = getStudentLessonHistory();
    return Object.entries(history)
      .filter(([name]) => name.startsWith('班级:'))
      .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
      .slice(0, MAX_RECENT_STUDENTS)
      .map(([name, record]) => ({
        classNumber: name.replace('班级:', ''),
        lesson: record.lesson,
        studentCount: record.students?.length || 0,
      }));
  };

  // 保存学生课次到服务器和 localStorage
  // classStudents: 班级记录时传入本次出勤学生名单，会与历史合并去重
  const saveStudentLesson = (name: string, lesson: number, classStudents?: string[]) => {
    try {
      const history = getStudentLessonHistory();
      const existing = history[name];

      // 合并班级学生名单（跨次积累、去重、最多10个）
      let mergedStudents: string[] | undefined;
      if (classStudents && classStudents.length > 0) {
        const prev = existing?.students || [];
        const combined = [...prev];
        for (const s of classStudents) {
          if (s.trim() && !combined.includes(s.trim())) {
            combined.push(s.trim());
          }
        }
        mergedStudents = combined.slice(0, MAX_CLASS_STUDENTS);
      }

      history[name] = {
        lesson,
        lastUsed: Date.now(),
        ...(mergedStudents ? { students: mergedStudents } : existing?.students ? { students: existing.students } : {}),
      };

      // 清理超过30个的旧记录（分别清理学生和班级）
      const students = Object.entries(history).filter(([n]) => !n.startsWith('班级:'));
      const classes = Object.entries(history).filter(([n]) => n.startsWith('班级:'));

      // 按时间排序，只保留最近30个
      const sortedStudents = students.sort((a, b) => b[1].lastUsed - a[1].lastUsed).slice(0, MAX_RECENT_STUDENTS);
      const sortedClasses = classes.sort((a, b) => b[1].lastUsed - a[1].lastUsed).slice(0, MAX_RECENT_STUDENTS);

      const cleanedHistory: Record<string, StudentRecord> = {};
      [...sortedStudents, ...sortedClasses].forEach(([n, r]) => {
        cleanedHistory[n] = r;
      });

      // 更新本地缓存（立即生效）
      setStudentHistoryCache(cleanedHistory);

      // 保存到 localStorage（离线缓存）
      localStorage.setItem(STUDENT_LESSON_STORAGE_KEY, JSON.stringify(cleanedHistory));

      // 异步保存到服务器（跨设备同步）
      saveHistoryMutation.mutate(
        { history: cleanedHistory },
        {
          onError: (err) => {
            console.warn('保存学生课次到服务器失败:', err);
          },
        }
      );
    } catch (e) {
      console.warn('保存学生课次失败:', e);
    }
  };

  // 学生名下拉列表状态
  const [showStudentDropdown, setShowStudentDropdown] = useState(false);
  const [recentStudents, setRecentStudents] = useState<Array<{ name: string; lesson: number }>>([]);
  const studentInputRef = useRef<HTMLInputElement>(null);

  // 班号下拉列表状态
  const [showClassDropdown, setShowClassDropdown] = useState(false);
  const [recentClasses, setRecentClasses] = useState<Array<{ classNumber: string; lesson: number; studentCount: number }>>([]);
  const classInputRef = useRef<HTMLInputElement>(null);

  // 点击输入框时加载最近学生列表
  const handleStudentInputFocus = () => {
    setRecentStudents(getRecentStudents());
    setShowStudentDropdown(true);
  };

  // 点击班号输入框时加载最近班级列表
  const handleClassInputFocus = () => {
    setRecentClasses(getRecentClasses());
    setShowClassDropdown(true);
  };

  // 选择学生
  const handleSelectStudent = (name: string) => {
    setStudentName(name);
    setShowStudentDropdown(false);
    // 直接填充课次（不依赖 useEffect，避免选同名时值不变不触发的问题）
    const history = getStudentLessonHistory();
    const record = history[name.trim()];
    if (record?.lesson !== undefined) {
      setLessonNumber(String(record.lesson + 1));
    }
  };

  // 选择班级
  const handleSelectClass = (classNum: string) => {
    setClassNumber(classNum);
    setShowClassDropdown(false);
    const history = getStudentLessonHistory();
    const record = history[`班级:${classNum.trim()}`];
    // 自动填充课次
    if (record?.lesson !== undefined) {
      setLessonNumber(String(record.lesson + 1));
    }
    // 自动填充历史积累的学生名单
    if (record?.students && record.students.length > 0) {
      const slots = Array(MAX_CLASS_STUDENTS).fill('');
      record.students.forEach((s, i) => {
        if (i < MAX_CLASS_STUDENTS) slots[i] = s;
      });
      setAttendanceStudents(slots);
    }
  };

  // 点击外部关闭下拉列表
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (studentInputRef.current && !studentInputRef.current.parentElement?.contains(e.target as Node)) {
        setShowStudentDropdown(false);
      }
      if (classInputRef.current && !classInputRef.current.parentElement?.contains(e.target as Node)) {
        setShowClassDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 当学生姓名变化时，自动填充课次（上次课次+1）- 一对一模式
  useEffect(() => {
    if (!studentName.trim()) return;

    const history = getStudentLessonHistory();
    const record = history[studentName.trim()];

    if (record?.lesson !== undefined) {
      // 自动填充为上次课次+1
      const nextLesson = record.lesson + 1;
      setLessonNumber(String(nextLesson));
    }
  }, [studentName]);

  // 当班号变化时，自动填充课次和学生名单 - 小班课模式
  useEffect(() => {
    if (!classNumber.trim()) return;

    const history = getStudentLessonHistory();
    // 使用班号作为 key，格式如 "班级:26098"
    const record = history[`班级:${classNumber.trim()}`];

    if (record?.lesson !== undefined) {
      // 自动填充为上次课次+1
      const nextLesson = record.lesson + 1;
      setLessonNumber(String(nextLesson));
    }
    // 自动填充历史积累的学生名单
    if (record?.students && record.students.length > 0) {
      const slots = Array(MAX_CLASS_STUDENTS).fill('');
      record.students.forEach((s: string, i: number) => {
        if (i < MAX_CLASS_STUDENTS) slots[i] = s;
      });
      setAttendanceStudents(slots);
    }
  }, [classNumber]);

  // 生成中每秒触发重渲染，驱动耗时秒数实时刷新
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isGenerating) return;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [isGenerating]);


  // tRPC queries and mutations
  const configQuery = trpc.config.getAll.useQuery();
  const updateConfigMutation = trpc.config.update.useMutation();
  
  const generateFeedbackMutation = trpc.feedback.generateFeedback.useMutation();
  const generateReviewMutation = trpc.feedback.generateReview.useMutation();
  const generateTestMutation = trpc.feedback.generateTest.useMutation();
  const generateExtractionMutation = trpc.feedback.generateExtraction.useMutation();
  const generateBubbleChartMutation = trpc.feedback.generateBubbleChart.useMutation();
  const uploadBubbleChartMutation = trpc.feedback.uploadBubbleChart.useMutation();
  const exportLogMutation = trpc.feedback.exportLog.useMutation();

  // 小班课 mutations
  const generateClassFeedbackMutation = trpc.feedback.generateClassFeedback.useMutation();
  const generateClassReviewMutation = trpc.feedback.generateClassReview.useMutation();
  const generateClassTestMutation = trpc.feedback.generateClassTest.useMutation();
  const generateClassExtractionMutation = trpc.feedback.generateClassExtraction.useMutation();
  const generateClassBubbleChartMutation = trpc.feedback.generateClassBubbleChart.useMutation();
  const uploadClassFileMutation = trpc.feedback.uploadClassFile.useMutation();
  const readFromDownloadsMutation = trpc.localFile.readFromDownloads.useMutation();
  const readLastFeedbackMutation = trpc.localFile.readLastFeedback.useMutation();
  const diagnoseMutation = trpc.localFile.diagnose.useMutation();
  const bgTaskSubmitMutation = trpc.bgTask.submit.useMutation();
  const hwImportFromTaskMutation = trpc.homework.importFromTask.useMutation();
  const hwImportClassFromTaskMutation = trpc.homework.importClassFromTask.useMutation();
  // 学情反馈提示词预览
  const feedbackPreviewQuery = trpc.feedback.previewPrompts.useQuery(
    { courseType, roadmap: courseType === 'oneToOne' ? roadmap : roadmapClass },
    { enabled: showFeedbackPreview },
  );
  // 加载配置
  useEffect(() => {
    if (configQuery.data && !configLoaded) {
      setApiModel(configQuery.data.apiModel);
      // apiKey 不再从服务器返回，保持为空（安全考虑）
      // setApiKey(configQuery.data.apiKey);
      setApiUrl(configQuery.data.apiUrl);
      // 只有服务器有配置时才覆盖，否则保持当前北京时间年份
      if (configQuery.data.currentYear) {
        setCurrentYear(configQuery.data.currentYear);
      }
      setRoadmap(configQuery.data.roadmap || "");
      setFirstLessonTemplate(configQuery.data.firstLessonTemplate || "");
      setRoadmapClass(configQuery.data.roadmapClass || "");
      setClassFirstLessonTemplate(configQuery.data.classFirstLessonTemplate || "");
      setDriveBasePath(configQuery.data.driveBasePath || "Mac/Documents/XDF/学生档案");
      setMaxTokens(configQuery.data.maxTokens || "64000");
      setModelPresets(configQuery.data.modelPresets || "");
      setConfigLoaded(true);
    }
  }, [configQuery.data, configLoaded]);

  // 保存配置
  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      await updateConfigMutation.mutateAsync({
        apiModel: apiModel.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        apiUrl: apiUrl.trim() || undefined,
        currentYear: currentYear.trim() || undefined,
        roadmap: roadmap || undefined,
        firstLessonTemplate: firstLessonTemplate || undefined,
        roadmapClass: roadmapClass || undefined,
        classFirstLessonTemplate: classFirstLessonTemplate || undefined,
        driveBasePath: driveBasePath.trim() || undefined,
        maxTokens: maxTokens.trim() || undefined,
      });
      // 刷新配置
      await configQuery.refetch();
      alert("配置已保存！");
    } catch (error) {
      alert("保存失败：" + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setSavingConfig(false);
    }
  };

  // 更新步骤状态
  const updateStep = useCallback((stepIndex: number, updates: Partial<StepStatus>) => {
    setSteps(prev => prev.map((s, i) => 
      i === stepIndex ? { ...s, ...updates } : s
    ));
  }, []);

  // 停止生成函数
  const handleStop = useCallback(() => {
    setIsStopping(true);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  // 检查是否已停止
  const checkStopped = useCallback(() => {
    if (isStopping) {
      throw new Error('用户已取消生成');
    }
  }, [isStopping]);

  // 执行生成流程
  const runGeneration = useCallback(async () => {
    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();
    
    setIsGenerating(true);
    setIsComplete(false);
    setHasError(false);
    setIsStopping(false);
    setHwImportStatus('idle'); // 重置学生管理导入状态（新生成流程，taskId 尚未分配）
    setCurrentGeneratingStudent(studentName.trim()); // 设置当前生成的学生名
    setSteps(initialSteps);
    setCurrentStep(1);

    let content = "";
    let date = "";
    let stopped = false;
    let localCurrentStep = 1; // 使用局部变量跟踪当前步骤，避免闭包陷阱

    // 创建学生信息快照（并发安全，防止生成过程中输入框被修改）
    // 如果有自动加载的内容，优先使用它（因为 setState 是异步的，状态可能还没更新）
    const resolvedTranscript = autoLoadedTranscriptRef.current || transcript;
    autoLoadedTranscriptRef.current = null;
    const resolvedLastFeedback = autoLoadedLastFeedbackRef.current || lastFeedback;
    autoLoadedLastFeedbackRef.current = null;
    const studentSnapshot = {
      studentName: studentName.trim(),
      lessonNumber: lessonNumber.trim(),
      lastFeedback: resolvedLastFeedback.trim(),
      currentNotes: currentNotes.trim(),
      transcript: resolvedTranscript.trim(),
      isFirstLesson,
    };

    // 构建配置快照（并发安全，所有步骤使用相同的配置）
    const configSnapshot = {
      apiModel: apiModel.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      apiUrl: apiUrl.trim() || undefined,
      lessonDate: lessonDate.trim() || undefined,
      currentYear: currentYear.trim() || undefined,
      roadmap: roadmap || undefined,
      driveBasePath: driveBasePath.trim() || undefined,
    };

    // 检查是否已停止的辅助函数
    const checkAborted = () => {
      if (abortControllerRef.current?.signal.aborted) {
        stopped = true;
        throw new Error('用户已取消生成');
      }
    };

    try {
      // 步骤1: 生成学情反馈 (V45c: 使用 SSE 流式输出防止超时)
      localCurrentStep = 1;
      checkAborted();
      const step1Start = Date.now();
      updateStep(0, { 
        status: 'running', 
        message: '正在调用AI生成学情反馈...',
        detail: '连接AI服务中，预计1-3分钟',
        startTime: step1Start
      });
      
      // 前端生成 taskId，后端用此 ID 暂存内容；SSE 断了前端也能凭 taskId 拉取
      const taskId = crypto.randomUUID();

      const sseResponse = await fetch('/api/feedback-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...studentSnapshot,
          ...configSnapshot,
          taskId,
        }),
      });

      if (!sseResponse.ok) {
        throw new Error(`学情反馈生成失败: HTTP ${sseResponse.status}`);
      }

      // 读取 SSE 流式响应
      const reader = sseResponse.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let feedbackContent = '';
      let sseError: string | null = null;
      let sseUploadResult: { fileName: string; url: string; path: string; folderUrl?: string } | null = null;
      let sseCompleted = false;
      let currentEventType = '';

      try {
        while (true) {
          checkAborted();
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEventType = line.slice(7).trim();
              continue;
            }
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (currentEventType === 'progress' && data.chars) {
                  const progressMsg = data.message || `正在生成学情反馈... 已生成 ${data.chars} 字符`;
                  updateStep(0, { status: 'running', message: progressMsg });
                } else if (currentEventType === 'complete') {
                  sseCompleted = true;
                  if (data.dateStr) date = data.dateStr;
                  if (data.uploadResult) sseUploadResult = data.uploadResult;
                } else if (currentEventType === 'error' && data.message) {
                  sseError = data.message;
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }
      } finally { reader.cancel().catch(() => {}); }

      if (sseError) {
        throw new Error(sseError);
      }

      // 无论 SSE 是否正常结束，都通过 HTTP GET 凭 taskId 拉取内容
      updateStep(0, { status: 'running', message: '正在获取生成内容...' });
      const maxPolls = sseCompleted ? 1 : 30;
      for (let poll = 0; poll < maxPolls; poll++) {
        if (poll > 0) {
          await new Promise(r => setTimeout(r, 2000));
          updateStep(0, { status: 'running', message: `正在等待后端生成完毕... (${poll * 2}秒)` });
        }
        try {
          const contentRes = await fetch(`/api/feedback-content/${taskId}`);
          if (contentRes.ok) {
            const contentData = await contentRes.json();
            feedbackContent = contentData.content;
            // 如果 SSE 没收到 meta 信息，从暂存里补
            if (contentData.meta) {
              if (!date && contentData.meta.dateStr) date = contentData.meta.dateStr;
              if (!sseUploadResult && contentData.meta.uploadResult) sseUploadResult = contentData.meta.uploadResult;
            }
            break;
          }
        } catch (e) {
          // 网络错误，继续轮询
        }
      }

      if (!feedbackContent) {
        throw new Error('学情反馈生成失败: 未收到内容（后端可能仍在生成中，请稍后重试）');
      }
      
      content = feedbackContent;
      
      // 优先使用 SSE 返回的日期，否则从反馈内容中提取
      if (!date) {
        date = configSnapshot.lessonDate || '';
        if (!date) {
          const dateMatch = content.match(/(\d{1,2}月\d{1,2}日?)/);
          date = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
        }
      }
      
      setFeedbackContent(content);
      setDateStr(date);
      
      const step1End = Date.now();
      updateStep(0, { 
        status: 'success', 
        message: `生成完成 (耗时${Math.round((step1End - step1Start) / 1000)}秒)`,
        detail: `学情反馈已生成并上传，共${content.length}字`,
        endTime: step1End,
        uploadResult: sseUploadResult || undefined,
      });
      setCurrentStep(2);

      // ===== V63.7: 步骤2-5 并行执行 =====
      // 后4个文档只依赖学情反馈内容，互不依赖，可以并行生成
      const parallelStartTime = Date.now();
      
      // V63.8: 进入并行阶段，初始化并行任务状态
      setIsParallelPhase(true);
      setParallelTasks({
        review: { status: 'running', startTime: parallelStartTime },
        test: { status: 'running', startTime: parallelStartTime },
        extraction: { status: 'running', startTime: parallelStartTime },
        bubble: { status: 'running', startTime: parallelStartTime },
      });
      
      // 设置所有4个步骤为运行中状态
      updateStep(1, { status: 'running', message: '正在并行生成...', detail: '复习文档', startTime: parallelStartTime });
      updateStep(2, { status: 'running', message: '正在并行生成...', detail: '测试本', startTime: parallelStartTime });
      updateStep(3, { status: 'running', message: '正在并行生成...', detail: '课后信息提取', startTime: parallelStartTime });
      updateStep(4, { status: 'running', message: '正在并行生成...', detail: '气泡图', startTime: parallelStartTime });

      // 定义4个并行任务
      const parallelTasks = [
        // 任务1: 复习文档 (SSE + taskId 轮询容错)
        (async () => {
          const taskStart = Date.now();
          const reviewTaskId = crypto.randomUUID();
          setParallelTasks(prev => ({ ...prev, review: { ...prev.review, status: 'running', startTime: taskStart } }));
          try {
            checkAborted();
            let reviewUploadResult: { fileName: string; url: string; path: string; folderUrl?: string } | null = null;
            let reviewSseError: string | null = null;
            let reviewCharCount = 0;

            // SSE 请求（可能被代理断连）
            try {
              const reviewSseResponse = await fetch('/api/review-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  studentName: studentSnapshot.studentName,
                  dateStr: date,
                  feedbackContent: content,
                  taskId: reviewTaskId,
                  ...configSnapshot,
                }),
              });

              if (!reviewSseResponse.ok) throw new Error(`复习文档生成失败: HTTP ${reviewSseResponse.status}`);

              const reader = reviewSseResponse.body?.getReader();
              if (reader) {
                const decoder = new TextDecoder();
                let buf = '';
                let evt = '';
                try {
                  while (true) {
                    checkAborted();
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const lines = buf.split('\n');
                    buf = lines.pop() || '';
                    for (const line of lines) {
                      if (line.startsWith('event: ')) { evt = line.slice(7).trim(); continue; }
                      if (line.startsWith('data: ')) {
                        try {
                          const data = JSON.parse(line.slice(6));
                          if (evt === 'progress' && data.chars) {
                            reviewCharCount = data.chars;
                            updateStep(1, { status: 'running', message: `已生成 ${data.chars} 字符`, detail: '复习文档' });
                            setParallelTasks(prev => ({ ...prev, review: { ...prev.review, charCount: data.chars } }));
                          } else if (evt === 'complete') {
                            if (data.uploadResult) reviewUploadResult = data.uploadResult;
                            if (data.chars) reviewCharCount = data.chars;
                          } else if (evt === 'error' && data.message) {
                            reviewSseError = data.message;
                          }
                        } catch (e) { /* ignore */ }
                      }
                    }
                  }
                } finally { reader.cancel().catch(() => {}); }
              }
            } catch (sseErr) {
              console.log('[Review SSE] 连接断开，将轮询获取结果:', sseErr);
            }

            if (reviewSseError) throw new Error(reviewSseError);

            // SSE 未收到结果 → 轮询 contentStore
            if (!reviewUploadResult) {
              updateStep(1, { status: 'running', message: '等待后端完成上传...', detail: '复习文档' });
              for (let poll = 0; poll < 60; poll++) {
                if (poll > 0) await new Promise(r => setTimeout(r, 2000));
                try {
                  const res = await fetch(`/api/feedback-content/${reviewTaskId}`);
                  if (res.ok) {
                    const data = await res.json();
                    reviewUploadResult = JSON.parse(data.content);
                    if (data.meta?.chars) reviewCharCount = data.meta.chars;
                    break;
                  }
                } catch (e) { console.warn('[Poll] 轮询失败:', e); }
              }
            }

            if (!reviewUploadResult) throw new Error('复习文档生成失败：未收到上传结果（后端可能仍在处理，请稍后重试）');

            const taskEnd = Date.now();
            setParallelTasks(prev => ({ ...prev, review: { status: 'success', startTime: taskStart, endTime: taskEnd, charCount: reviewCharCount, uploadResult: reviewUploadResult || undefined } }));
            updateStep(1, { status: 'success', message: `完成 (${Math.round((taskEnd - taskStart) / 1000)}秒)`, detail: `复习文档已生成并上传，共${reviewCharCount}字`, endTime: taskEnd, uploadResult: reviewUploadResult });
            return { type: 'review', success: true, duration: taskEnd - taskStart, charCount: reviewCharCount, uploadResult: reviewUploadResult };
          } catch (error) {
            const taskEnd = Date.now();
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            setParallelTasks(prev => ({ ...prev, review: { status: 'failed', startTime: taskStart, endTime: taskEnd, error: errorMsg } }));
            updateStep(1, { status: 'error', error: errorMsg });
            return { type: 'review', success: false, duration: taskEnd - taskStart, error: errorMsg };
          }
        })(),

        // 任务2: 测试本 (SSE + taskId 轮询容错)
        (async () => {
          const taskStart = Date.now();
          const testTaskId = crypto.randomUUID();
          setParallelTasks(prev => ({ ...prev, test: { ...prev.test, status: 'running', startTime: taskStart } }));
          try {
            checkAborted();
            let testUploadResult: { fileName: string; url: string; path: string; folderUrl?: string } | null = null;
            let testSseError: string | null = null;
            let testCharCount = 0;

            try {
              const testSseResponse = await fetch('/api/test-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  studentName: studentSnapshot.studentName,
                  dateStr: date,
                  feedbackContent: content,
                  taskId: testTaskId,
                  ...configSnapshot,
                }),
              });

              if (!testSseResponse.ok) throw new Error(`测试本生成失败: HTTP ${testSseResponse.status}`);

              const reader = testSseResponse.body?.getReader();
              if (reader) {
                const decoder = new TextDecoder();
                let buf = '';
                let evt = '';
                try {
                  while (true) {
                    checkAborted();
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const lines = buf.split('\n');
                    buf = lines.pop() || '';
                    for (const line of lines) {
                      if (line.startsWith('event: ')) { evt = line.slice(7).trim(); continue; }
                      if (line.startsWith('data: ')) {
                        try {
                          const data = JSON.parse(line.slice(6));
                          if (evt === 'progress') {
                            if (data.chars) {
                              testCharCount = data.chars;
                              updateStep(2, { status: 'running', message: data.message || `已生成 ${data.chars} 字符`, detail: '测试本' });
                              setParallelTasks(prev => ({ ...prev, test: { ...prev.test, charCount: data.chars } }));
                            } else if (data.message) {
                              updateStep(2, { status: 'running', message: data.message, detail: '测试本' });
                            }
                          }
                          else if (evt === 'complete') {
                            if (data.uploadResult) testUploadResult = data.uploadResult;
                            if (data.chars) testCharCount = data.chars;
                          }
                          else if (evt === 'error' && data.message) testSseError = data.message;
                        } catch (e) { /* ignore */ }
                      }
                    }
                  }
                } finally { reader.cancel().catch(() => {}); }
              }
            } catch (sseErr) {
              console.log('[Test SSE] 连接断开，将轮询获取结果:', sseErr);
            }

            if (testSseError) throw new Error(testSseError);

            // SSE 未返回结果 → 轮询 contentStore
            if (!testUploadResult) {
              updateStep(2, { status: 'running', message: '等待后端完成上传...', detail: '测试本' });
              for (let poll = 0; poll < 60; poll++) {
                if (poll > 0) await new Promise(r => setTimeout(r, 2000));
                try {
                  const res = await fetch(`/api/feedback-content/${testTaskId}`);
                  if (res.ok) {
                    const data = await res.json();
                    testUploadResult = JSON.parse(data.content);
                    if (data.meta?.chars) testCharCount = data.meta.chars;
                    break;
                  }
                } catch (e) { console.warn('[Poll] 轮询失败:', e); }
              }
            }

            if (!testUploadResult) throw new Error('测试本生成失败：未收到上传结果（后端可能仍在处理，请稍后重试）');

            const taskEnd = Date.now();
            setParallelTasks(prev => ({ ...prev, test: { status: 'success', startTime: taskStart, endTime: taskEnd, uploadResult: testUploadResult || undefined } }));
            updateStep(2, { status: 'success', message: `完成 (${Math.round((taskEnd - taskStart) / 1000)}秒)`, detail: `测试本已生成并上传，共${testCharCount}字`, endTime: taskEnd, uploadResult: testUploadResult });
            return { type: 'test', success: true, duration: taskEnd - taskStart, uploadResult: testUploadResult };
          } catch (error) {
            const taskEnd = Date.now();
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            setParallelTasks(prev => ({ ...prev, test: { status: 'failed', startTime: taskStart, endTime: taskEnd, error: errorMsg } }));
            updateStep(2, { status: 'error', error: errorMsg });
            return { type: 'test', success: false, duration: taskEnd - taskStart, error: errorMsg };
          }
        })(),

        // 任务3: 课后信息提取 (SSE + taskId 轮询容错)
        (async () => {
          const taskStart = Date.now();
          const extractionTaskId = crypto.randomUUID();
          setParallelTasks(prev => ({ ...prev, extraction: { ...prev.extraction, status: 'running', startTime: taskStart } }));
          try {
            checkAborted();
            let extractionUploadResult: { fileName: string; url: string; path: string; folderUrl?: string } | null = null;
            let extractionSseError: string | null = null;
            let extractionCharCount = 0;

            try {
              const extractionSseResponse = await fetch('/api/extraction-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  studentName: studentSnapshot.studentName,
                  dateStr: date,
                  feedbackContent: content,
                  taskId: extractionTaskId,
                  ...configSnapshot,
                }),
              });

              if (!extractionSseResponse.ok) throw new Error(`课后信息提取失败: HTTP ${extractionSseResponse.status}`);

              const reader = extractionSseResponse.body?.getReader();
              if (reader) {
                const decoder = new TextDecoder();
                let buf = '';
                let evt = '';
                try {
                  while (true) {
                    checkAborted();
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const lines = buf.split('\n');
                    buf = lines.pop() || '';
                    for (const line of lines) {
                      if (line.startsWith('event: ')) { evt = line.slice(7).trim(); continue; }
                      if (line.startsWith('data: ')) {
                        try {
                          const data = JSON.parse(line.slice(6));
                          if (evt === 'progress') {
                            if (data.chars) {
                              extractionCharCount = data.chars;
                              updateStep(3, { status: 'running', message: data.message || `已生成 ${data.chars} 字符`, detail: '课后信息提取' });
                              setParallelTasks(prev => ({ ...prev, extraction: { ...prev.extraction, charCount: data.chars } }));
                            } else if (data.message) {
                              updateStep(3, { status: 'running', message: data.message, detail: '课后信息提取' });
                            }
                          }
                          else if (evt === 'complete') {
                            if (data.uploadResult) extractionUploadResult = data.uploadResult;
                            if (data.chars) extractionCharCount = data.chars;
                          }
                          else if (evt === 'error' && data.message) extractionSseError = data.message;
                        } catch (e) { /* ignore */ }
                      }
                    }
                  }
                } finally { reader.cancel().catch(() => {}); }
              }
            } catch (sseErr) {
              console.log('[Extraction SSE] 连接断开，将轮询获取结果:', sseErr);
            }

            if (extractionSseError) throw new Error(extractionSseError);

            // SSE 未返回结果 → 轮询 contentStore
            if (!extractionUploadResult) {
              updateStep(3, { status: 'running', message: '等待后端完成上传...', detail: '课后信息提取' });
              for (let poll = 0; poll < 60; poll++) {
                if (poll > 0) await new Promise(r => setTimeout(r, 2000));
                try {
                  const res = await fetch(`/api/feedback-content/${extractionTaskId}`);
                  if (res.ok) {
                    const data = await res.json();
                    extractionUploadResult = JSON.parse(data.content);
                    if (data.meta?.chars) extractionCharCount = data.meta.chars;
                    break;
                  }
                } catch (e) { console.warn('[Poll] 轮询失败:', e); }
              }
            }

            if (!extractionUploadResult) throw new Error('课后信息提取失败：未收到上传结果（后端可能仍在处理，请稍后重试）');

            const taskEnd = Date.now();
            setParallelTasks(prev => ({ ...prev, extraction: { status: 'success', startTime: taskStart, endTime: taskEnd, uploadResult: extractionUploadResult || undefined } }));
            updateStep(3, { status: 'success', message: `完成 (${Math.round((taskEnd - taskStart) / 1000)}秒)`, detail: `课后信息已生成并上传，共${extractionCharCount}字`, endTime: taskEnd, uploadResult: extractionUploadResult });
            return { type: 'extraction', success: true, duration: taskEnd - taskStart, uploadResult: extractionUploadResult };
          } catch (error) {
            const taskEnd = Date.now();
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            setParallelTasks(prev => ({ ...prev, extraction: { status: 'failed', startTime: taskStart, endTime: taskEnd, error: errorMsg } }));
            updateStep(3, { status: 'error', error: errorMsg });
            return { type: 'extraction', success: false, duration: taskEnd - taskStart, error: errorMsg };
          }
        })(),

        // 任务4: 气泡图 (tRPC + taskId 轮询容错 + 前端转换 + 上传)
        (async () => {
          const taskStart = Date.now();
          const bubbleTaskId = crypto.randomUUID();
          setParallelTasks(prev => ({ ...prev, bubble: { ...prev.bubble, status: 'running', startTime: taskStart } }));
          try {
            checkAborted();
            // 步骤5a: 后端生成SVG（可能被代理超时）
            let svgContent: string | null = null;

            try {
              const svgResult = await generateBubbleChartMutation.mutateAsync({
                studentName: studentSnapshot.studentName,
                dateStr: date,
                lessonNumber: studentSnapshot.lessonNumber,
                feedbackContent: content,
                taskId: bubbleTaskId,
                ...configSnapshot,
              });
              svgContent = svgResult.svgContent;
            } catch (rpcErr) {
              console.log('[BubbleChart tRPC] 请求失败，将轮询获取结果:', rpcErr);
            }

            // tRPC 未返回 SVG → 轮询 contentStore
            if (!svgContent) {
              updateStep(4, { status: 'running', message: '等待后端生成SVG...', detail: '气泡图' });
              for (let poll = 0; poll < 60; poll++) {
                if (poll > 0) await new Promise(r => setTimeout(r, 2000));
                try {
                  const res = await fetch(`/api/feedback-content/${bubbleTaskId}`);
                  if (res.ok) {
                    const data = await res.json();
                    const parsed = JSON.parse(data.content);
                    svgContent = parsed.svgContent;
                    break;
                  }
                } catch (e) { console.warn('[Poll] 轮询失败:', e); }
              }
            }

            if (!svgContent) throw new Error('气泡图生成失败：未收到SVG（后端可能仍在处理，请稍后重试）');

            checkAborted();
            updateStep(4, { status: 'running', message: '正在转换PNG...', detail: '气泡图' });
            setParallelTasks(prev => ({ ...prev, bubble: { ...prev.bubble, status: 'running' } }));

            // 步骤5b: 前端将SVG转换为PNG
            const pngBase64 = await svgToPngBase64(svgContent);

            // 步骤5c: 上传PNG到Google Drive
            const uploadResult = await uploadBubbleChartMutation.mutateAsync({
              studentName: studentSnapshot.studentName,
              dateStr: date,
              pngBase64,
              driveBasePath: configSnapshot.driveBasePath,
            });

            const taskEnd = Date.now();
            setParallelTasks(prev => ({ ...prev, bubble: { status: 'success', startTime: taskStart, endTime: taskEnd, uploadResult: uploadResult.uploadResult } }));
            updateStep(4, { status: 'success', message: `完成 (${Math.round((taskEnd - taskStart) / 1000)}秒)`, detail: '气泡图已生成并上传', endTime: taskEnd, uploadResult: uploadResult.uploadResult });
            return { type: 'bubble', success: true, duration: taskEnd - taskStart, uploadResult: uploadResult.uploadResult };
          } catch (error) {
            const taskEnd = Date.now();
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            setParallelTasks(prev => ({ ...prev, bubble: { status: 'failed', startTime: taskStart, endTime: taskEnd, error: errorMsg } }));
            updateStep(4, { status: 'error', error: errorMsg });
            return { type: 'bubble', success: false, duration: taskEnd - taskStart, error: errorMsg };
          }
        })(),
      ];

      // 使用 Promise.allSettled 并行执行，确保一个失败不影响其他
      const results = await Promise.allSettled(parallelTasks);
      const parallelEndTime = Date.now();
      const totalParallelDuration = Math.round((parallelEndTime - parallelStartTime) / 1000);

      // V63.8: 统计结果（状态已在各任务中实时更新）
      let successCount = 0;
      let failedCount = 0;
      const failedTaskNames: string[] = [];
      const taskNames = ['复习文档', '测试本', '课后信息提取', '气泡图'];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          successCount++;
        } else {
          failedCount++;
          failedTaskNames.push(taskNames[index]);
        }
      });

      // V63.8: 退出并行阶段
      setIsParallelPhase(false);

      // 如果有失败的任务，设置错误状态但不抛出（各步骤已单独更新状态）
      if (failedCount > 0) {
        setHasError(true);
        console.warn(`[V63.8] 并行生成部分失败: ${successCount}/4 成功，失败: ${failedTaskNames.join('、')}`);
        // 不抛出错误，避免覆盖各步骤的独立状态（各步骤已通过 updateStep 显示各自的错误信息）
        return;
      }

      // 全部成功才设置最终步骤
      localCurrentStep = 5;
      setCurrentStep(5);

      console.log(`[V63.7] 并行生成完成: ${successCount}/4 成功，总耗时 ${totalParallelDuration} 秒`);

      // 保存学生课次到 localStorage（用于下次自动填充课次+1）
      if (studentSnapshot.studentName && studentSnapshot.lessonNumber) {
        const lessonNum = parseInt(studentSnapshot.lessonNumber.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(lessonNum)) {
          saveStudentLesson(studentSnapshot.studentName, lessonNum);
          console.log(`[课次记忆] 已保存: ${studentSnapshot.studentName} 第${lessonNum}次课`);
        }
      }

      setIsComplete(true);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : '生成失败';
      const wasStopped = rawMessage.includes('取消') || stopped;
      
      console.error("生成失败:", error);
      setHasError(true);
      
      // 尝试解析结构化错误
      let displayError = rawMessage;
      try {
        const parsed = JSON.parse(rawMessage);
        if (parsed.userMessage) {
          displayError = parsed.userMessage;
        } else if (parsed.message && parsed.suggestion) {
          displayError = `${parsed.message}。${parsed.suggestion}`;
        }
      } catch (e) {
        // 不是JSON，使用原始消息
        // 尝试匹配常见错误并转换为中文
        if (rawMessage.toLowerCase().includes('failed to fetch') || rawMessage.toLowerCase().includes('fetch failed')) {
          displayError = '网络连接失败，请检查网络后重试';
        } else if (rawMessage.includes('insufficient_user_quota') || rawMessage.includes('预扣费额度失败')) {
          displayError = 'API余额不足，请登录DMXapi充值后重试';
        } else if (rawMessage.includes('401') || rawMessage.includes('Unauthorized')) {
          displayError = 'API密钥无效，请点击右上角设置按钮检查密钥';
        } else if (rawMessage.includes('403')) {
          displayError = 'API访问被拒绝，可能是余额不足或密钥权限问题';
        } else if (rawMessage.includes('429') || rawMessage.includes('rate limit')) {
          displayError = '请求太频繁，请稍等1分钟后重试';
        } else if (rawMessage.includes('timeout') || rawMessage.includes('超时')) {
          displayError = '请求超时，可能是网络问题或AI响应太慢，请稍后重试';
        }
      }
      
      // 标记当前步骤为失败或取消
      const failedStepIndex = localCurrentStep - 1; // 使用局部变量，避免闭包陷阱
      if (failedStepIndex >= 0 && failedStepIndex < 5) {
        updateStep(failedStepIndex, { 
          status: 'error', 
          error: wasStopped ? '已取消' : displayError
        });
      }
    } finally {
      setIsGenerating(false);
      setIsStopping(false);
      setCurrentGeneratingStudent(null); // 清除当前生成的学生名
      abortControllerRef.current = null;
    }
  }, [
    studentName, lessonNumber, lastFeedback, currentNotes, transcript,
    isFirstLesson, apiModel, apiKey, apiUrl,
    generateFeedbackMutation, generateReviewMutation, generateTestMutation,
    generateExtractionMutation, generateBubbleChartMutation, updateStep
  ]); // 移除 currentStep 依赖，使用 localCurrentStep 代替

  // 小班课生成流程
  const runClassGeneration = useCallback(async () => {
    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();
    
    setIsGenerating(true);
    setIsComplete(false);
    setHasError(false);
    setIsStopping(false);
    setCurrentGeneratingStudent(`${classNumber.trim()}班`);
    setSteps(initialClassSteps);
    setCurrentStep(1);
    setClassFeedbacks([]);
    setBubbleChartProgress([]);

    // 创建小班课信息快照
    // 如果有自动加载的内容，优先使用它
    const resolvedClassTranscript = autoLoadedTranscriptRef.current || transcript;
    autoLoadedTranscriptRef.current = null;
    const resolvedClassLastFeedback = autoLoadedLastFeedbackRef.current || lastFeedback;
    autoLoadedLastFeedbackRef.current = null;
    const validStudents = attendanceStudents.filter((s: string) => s.trim());
    const classSnapshot = {
      classNumber: classNumber.trim(),
      lessonNumber: lessonNumber.trim(),
      lessonDate: lessonDate.trim(),
      attendanceStudents: validStudents,
      lastFeedback: resolvedClassLastFeedback.trim(),
      currentNotes: currentNotes.trim(),
      transcript: resolvedClassTranscript.trim(),
    };

    // 配置快照（和一对一保持一致，包含年份）
    const configSnapshot = {
      apiModel: apiModel.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      apiUrl: apiUrl.trim() || undefined,
      roadmapClass: roadmapClass || undefined,
      driveBasePath: driveBasePath.trim() || undefined,
      currentYear: currentYear.trim() || undefined,
    };

    // 检查是否已停止
    const checkAborted = () => {
      if (abortControllerRef.current?.signal.aborted) {
        throw new Error('用户已取消生成');
      }
    };

    let combinedFeedback = '';
    let extractedDate = '';
    let localCurrentStep = 1; // 使用局部变量跟踪当前步骤，避免闭包陷阱

    try {
      // 步骤1: 生成1份完整学情反馈（使用 SSE 流式端点防止超时）
      localCurrentStep = 1;
      checkAborted();
      const step1Start = Date.now();
      updateStep(0, { status: 'running', message: `正在为 ${classSnapshot.classNumber} 班生成学情反馈...`, startTime: step1Start });
      
      // 前端生成 taskId，后端用此 ID 暂存内容；SSE 断了前端也能凭 taskId 拉取
      const taskId = crypto.randomUUID();

      const sseResponse = await fetch('/api/class-feedback-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...classSnapshot,
          ...configSnapshot,
          taskId,
        }),
      });

      if (!sseResponse.ok) {
        throw new Error(`学情反馈生成失败: HTTP ${sseResponse.status}`);
      }

      // 读取 SSE 流式响应
      const reader = sseResponse.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let feedbackContent = '';
      let sseError: string | null = null;
      let sseCompleted = false;
      let currentEventType = '';

      try {
        while (true) {
          checkAborted();
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEventType = line.slice(7).trim();
              continue;
            }
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (currentEventType === 'progress' && data.chars) {
                  updateStep(0, { status: 'running', message: `正在生成学情反馈... 已生成 ${data.chars} 字符` });
                } else if (currentEventType === 'complete') {
                  sseCompleted = true;
                  if (data.dateStr) extractedDate = data.dateStr;

                } else if (currentEventType === 'error' && data.message) {
                  sseError = data.message;
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }
      } finally { reader.cancel().catch(() => {}); }

      if (sseError) {
        throw new Error(sseError);
      }

      // 无论 SSE 是否正常结束，都通过 HTTP GET 凭 taskId 拉取内容
      // 如果后端还没生成完（SSE 被平台掐断），轮询等待
      updateStep(0, { status: 'running', message: '正在获取生成内容...' });
      const maxPolls = sseCompleted ? 1 : 30; // SSE 正常结束只拉一次；异常断开最多轮询 30 次（约 60 秒）
      for (let poll = 0; poll < maxPolls; poll++) {
        if (poll > 0) {
          await new Promise(r => setTimeout(r, 2000)); // 每 2 秒轮询一次
          updateStep(0, { status: 'running', message: `正在等待后端生成完毕... (${poll * 2}秒)` });
        }
        try {
          const contentRes = await fetch(`/api/feedback-content/${taskId}`);
          if (contentRes.ok) {
            const contentData = await contentRes.json();
            feedbackContent = contentData.content;
            if (contentData.meta) {
              if (!extractedDate && contentData.meta.dateStr) extractedDate = contentData.meta.dateStr;

            }
            break;
          }
        } catch (e) {
          // 网络错误，继续轮询
        }
      }

      if (!feedbackContent) {
        throw new Error('学情反馈生成失败: 未收到内容（后端可能仍在生成中，请稍后重试）');
      }
      

      
      // 1份完整的学情反馈
      combinedFeedback = feedbackContent;
      
      // 优先使用用户输入的日期，否则从反馈中提取（和一对一保持一致）
      extractedDate = classSnapshot.lessonDate || '';
      if (!extractedDate) {
        const dateMatch = combinedFeedback.match(/(\d{1,2}月\d{1,2}日?)/);
        extractedDate = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
      }
      setDateStr(extractedDate);
      setFeedbackContent(combinedFeedback); // 存入 React state，供重做步骤时使用

      // 上传1份完整的学情反馈（保存返回值）
      let feedbackUploadResult;
      try {
        feedbackUploadResult = await uploadClassFileMutation.mutateAsync({
          classNumber: classSnapshot.classNumber,
          dateStr: extractedDate,
          fileType: 'feedback',
          content: combinedFeedback,
          driveBasePath: configSnapshot.driveBasePath,
        });
        console.log('[Upload] 学情反馈上传成功:', feedbackUploadResult);
      } catch (uploadError: any) {
        console.error('[Upload] 学情反馈上传失败:', uploadError);
        throw new Error(`学情反馈上传失败: ${uploadError.message || '未知错误'}`);
      }
      
      const step1Time = Math.round((Date.now() - step1Start) / 1000);
      updateStep(0, {
        status: 'success',
        message: `学情反馈生成完成 (${step1Time}秒)`,
        detail: `学情反馈已生成并上传，共${combinedFeedback.length}字`,
        uploadResult: {
          fileName: feedbackUploadResult.fileName,
          url: feedbackUploadResult.url,
          path: feedbackUploadResult.path,
        }
      });
      setCurrentStep(2);

      // V63.9 (Step 3a): 步骤2-5 并行执行
      const parallelStartTime = Date.now();
      
      // V63.11: 进入小班课并行阶段，初始化并行任务状态
      setIsClassParallelPhase(true);
      setClassParallelTasks({
        review: { status: 'running', startTime: parallelStartTime },
        test: { status: 'running', startTime: parallelStartTime },
        extraction: { status: 'running', startTime: parallelStartTime },
        bubble: { status: 'running', startTime: parallelStartTime },
      });
      
      // 初始化所有并行步骤的状态为 running
      updateStep(1, { status: 'running', message: '正在并行生成...', detail: '复习文档', startTime: parallelStartTime });
      updateStep(2, { status: 'running', message: '正在并行生成...', detail: '测试本', startTime: parallelStartTime });
      updateStep(3, { status: 'running', message: '正在并行生成...', detail: '课后信息提取', startTime: parallelStartTime });
      updateStep(4, { status: 'running', message: '正在并行生成...', detail: `气泡图 (${validStudents.length}个学生)`, startTime: parallelStartTime });

      // 定义4个并行任务
      const parallelTasks = [
        // 任务1: 复习文档 (SSE + taskId 轮询容错)
        (async () => {
          const taskStart = Date.now();
          const reviewTaskId = crypto.randomUUID();
          try {
            checkAborted();
            let classReviewUploadResult: { fileName: string; url: string; path: string; folderUrl?: string } | null = null;
            let classReviewSseError: string | null = null;
            let classReviewCharCount = 0;

            // SSE 请求（可能被代理断连）
            try {
              const classReviewSseResponse = await fetch('/api/class-review-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  classNumber: classSnapshot.classNumber,
                  lessonNumber: classSnapshot.lessonNumber,
                  lessonDate: extractedDate,
                  attendanceStudents: classSnapshot.attendanceStudents,
                  currentNotes: classSnapshot.currentNotes,
                  combinedFeedback,
                  taskId: reviewTaskId,
                  ...configSnapshot,
                }),
              });

              if (!classReviewSseResponse.ok) throw new Error(`复习文档生成失败: HTTP ${classReviewSseResponse.status}`);

              const reader = classReviewSseResponse.body?.getReader();
              if (reader) {
                const decoder = new TextDecoder();
                let buf = '';
                let evt = '';
                try {
                  while (true) {
                    checkAborted();
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const lines = buf.split('\n');
                    buf = lines.pop() || '';
                    for (const line of lines) {
                      if (line.startsWith('event: ')) { evt = line.slice(7).trim(); continue; }
                      if (line.startsWith('data: ')) {
                        try {
                          const data = JSON.parse(line.slice(6));
                          if (evt === 'progress' && data.chars) {
                            classReviewCharCount = data.chars;
                            updateStep(1, { status: 'running', message: `已生成 ${data.chars} 字符`, detail: '复习文档' });
                          } else if (evt === 'complete') {
                            if (data.uploadResult) classReviewUploadResult = data.uploadResult;
                            if (data.chars) classReviewCharCount = data.chars;
                          } else if (evt === 'error' && data.message) {
                            classReviewSseError = data.message;
                          }
                        } catch (e) { /* ignore */ }
                      }
                    }
                  }
                } finally { reader.cancel().catch(() => {}); }
              }
            } catch (sseErr) {
              console.log('[Review SSE] 连接断开，将轮询获取结果:', sseErr);
            }

            if (classReviewSseError) throw new Error(classReviewSseError);

            // SSE 未收到结果 → 轮询 contentStore
            if (!classReviewUploadResult) {
              updateStep(1, { status: 'running', message: '等待后端完成上传...', detail: '复习文档' });
              for (let poll = 0; poll < 60; poll++) {
                if (poll > 0) await new Promise(r => setTimeout(r, 2000));
                try {
                  const res = await fetch(`/api/feedback-content/${reviewTaskId}`);
                  if (res.ok) {
                    const data = await res.json();
                    classReviewUploadResult = JSON.parse(data.content);
                    if (data.meta?.chars) classReviewCharCount = data.meta.chars;
                    break;
                  }
                } catch (e) { console.warn('[Poll] 轮询失败:', e); }
              }
            }

            if (!classReviewUploadResult) throw new Error('复习文档生成失败：未收到上传结果（后端可能仍在处理，请稍后重试）');

            const taskEnd = Date.now();
            updateStep(1, {
              status: 'success',
              message: `完成 (${Math.round((taskEnd - taskStart) / 1000)}秒)`,
              detail: `复习文档已生成并上传，共${classReviewCharCount}字`,
              endTime: taskEnd,
              uploadResult: classReviewUploadResult
            });
            setClassParallelTasks(prev => ({ ...prev, review: { status: 'success', startTime: prev.review.startTime, endTime: taskEnd, charCount: classReviewCharCount, uploadResult: classReviewUploadResult || undefined } }));
            return { type: 'review', success: true, duration: taskEnd - taskStart, charCount: classReviewCharCount, uploadResult: classReviewUploadResult };
          } catch (error) {
            const taskEnd = Date.now();
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            updateStep(1, { status: 'error', error: errorMsg });
            setClassParallelTasks(prev => ({ ...prev, review: { status: 'failed', startTime: prev.review.startTime, endTime: taskEnd, error: errorMsg } }));
            return { type: 'review', success: false, duration: taskEnd - taskStart, error: errorMsg };
          }
        })(),

        // 任务2: 测试本 (SSE + taskId 轮询容错)
        (async () => {
          const taskStart = Date.now();
          const testTaskId = crypto.randomUUID();
          try {
            checkAborted();
            let testUploadResult: { fileName: string; url: string; path: string; folderUrl?: string } | null = null;
            let testSseError: string | null = null;
            let testCharCount = 0;

            try {
              const testSseResponse = await fetch('/api/class-test-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  classNumber: classSnapshot.classNumber,
                  lessonNumber: classSnapshot.lessonNumber,
                  lessonDate: extractedDate,
                  attendanceStudents: classSnapshot.attendanceStudents,
                  currentNotes: classSnapshot.currentNotes,
                  combinedFeedback,
                  taskId: testTaskId,
                  ...configSnapshot,
                }),
              });

              if (!testSseResponse.ok) throw new Error(`测试本生成失败: HTTP ${testSseResponse.status}`);

              const reader = testSseResponse.body?.getReader();
              if (reader) {
                const decoder = new TextDecoder();
                let buf = '';
                let evt = '';
                try {
                  while (true) {
                    checkAborted();
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const lines = buf.split('\n');
                    buf = lines.pop() || '';
                    for (const line of lines) {
                      if (line.startsWith('event: ')) { evt = line.slice(7).trim(); continue; }
                      if (line.startsWith('data: ')) {
                        try {
                          const data = JSON.parse(line.slice(6));
                          if (evt === 'progress') {
                            if (data.chars) {
                              testCharCount = data.chars;
                              updateStep(2, { status: 'running', message: data.message || `已生成 ${data.chars} 字符`, detail: '测试本' });
                              setParallelTasks(prev => ({ ...prev, test: { ...prev.test, charCount: data.chars } }));
                            } else if (data.message) {
                              updateStep(2, { status: 'running', message: data.message, detail: '测试本' });
                            }
                          }
                          else if (evt === 'complete') {
                            if (data.uploadResult) testUploadResult = data.uploadResult;
                            if (data.chars) testCharCount = data.chars;
                          }
                          else if (evt === 'error' && data.message) testSseError = data.message;
                        } catch (e) { /* ignore */ }
                      }
                    }
                  }
                } finally { reader.cancel().catch(() => {}); }
              }
            } catch (sseErr) {
              console.log('[Test SSE] 连接断开，将轮询获取结果:', sseErr);
            }

            if (testSseError) throw new Error(testSseError);

            if (!testUploadResult) {
              updateStep(2, { status: 'running', message: '等待后端完成上传...', detail: '测试本' });
              for (let poll = 0; poll < 60; poll++) {
                if (poll > 0) await new Promise(r => setTimeout(r, 2000));
                try {
                  const res = await fetch(`/api/feedback-content/${testTaskId}`);
                  if (res.ok) {
                    const data = await res.json();
                    testUploadResult = JSON.parse(data.content);
                    if (data.meta?.chars) testCharCount = data.meta.chars;
                    break;
                  }
                } catch (e) { console.warn('[Poll] 轮询失败:', e); }
              }
            }

            if (!testUploadResult) throw new Error('测试本生成失败：未收到上传结果（后端可能仍在处理，请稍后重试）');

            const taskEnd = Date.now();
            updateStep(2, { status: 'success', message: `完成 (${Math.round((taskEnd - taskStart) / 1000)}秒)`, detail: `测试本已生成并上传，共${testCharCount}字`, endTime: taskEnd, uploadResult: testUploadResult });
            setClassParallelTasks(prev => ({ ...prev, test: { status: 'success', startTime: prev.test.startTime, endTime: taskEnd, uploadResult: testUploadResult || undefined } }));
            return { type: 'test', success: true, duration: taskEnd - taskStart, uploadResult: testUploadResult };
          } catch (error) {
            const taskEnd = Date.now();
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            updateStep(2, { status: 'error', error: errorMsg });
            setClassParallelTasks(prev => ({ ...prev, test: { status: 'failed', startTime: prev.test.startTime, endTime: taskEnd, error: errorMsg } }));
            return { type: 'test', success: false, duration: taskEnd - taskStart, error: errorMsg };
          }
        })(),

        // 任务3: 课后信息提取 (SSE + taskId 轮询容错)
        (async () => {
          const taskStart = Date.now();
          const extractTaskId = crypto.randomUUID();
          try {
            checkAborted();
            let extractionUploadResult: { fileName: string; url: string; path: string; folderUrl?: string } | null = null;
            let extractionSseError: string | null = null;
            let extractionCharCount = 0;

            try {
              const extractionSseResponse = await fetch('/api/class-extraction-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  classNumber: classSnapshot.classNumber,
                  lessonNumber: classSnapshot.lessonNumber,
                  lessonDate: extractedDate,
                  attendanceStudents: classSnapshot.attendanceStudents,
                  combinedFeedback,
                  taskId: extractTaskId,
                  ...configSnapshot,
                }),
              });

              if (!extractionSseResponse.ok) throw new Error(`课后信息提取失败: HTTP ${extractionSseResponse.status}`);

              const reader = extractionSseResponse.body?.getReader();
              if (reader) {
                const decoder = new TextDecoder();
                let buf = '';
                let evt = '';
                try {
                  while (true) {
                    checkAborted();
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const lines = buf.split('\n');
                    buf = lines.pop() || '';
                    for (const line of lines) {
                      if (line.startsWith('event: ')) { evt = line.slice(7).trim(); continue; }
                      if (line.startsWith('data: ')) {
                        try {
                          const data = JSON.parse(line.slice(6));
                          if (evt === 'progress') {
                            if (data.chars) {
                              extractionCharCount = data.chars;
                              updateStep(3, { status: 'running', message: data.message || `已生成 ${data.chars} 字符`, detail: '课后信息提取' });
                              setParallelTasks(prev => ({ ...prev, extraction: { ...prev.extraction, charCount: data.chars } }));
                            } else if (data.message) {
                              updateStep(3, { status: 'running', message: data.message, detail: '课后信息提取' });
                            }
                          }
                          else if (evt === 'complete') {
                            if (data.uploadResult) extractionUploadResult = data.uploadResult;
                            if (data.chars) extractionCharCount = data.chars;
                          }
                          else if (evt === 'error' && data.message) extractionSseError = data.message;
                        } catch (e) { /* ignore */ }
                      }
                    }
                  }
                } finally { reader.cancel().catch(() => {}); }
              }
            } catch (sseErr) {
              console.log('[Extraction SSE] 连接断开，将轮询获取结果:', sseErr);
            }

            if (extractionSseError) throw new Error(extractionSseError);

            if (!extractionUploadResult) {
              updateStep(3, { status: 'running', message: '等待后端完成上传...', detail: '课后信息提取' });
              for (let poll = 0; poll < 60; poll++) {
                if (poll > 0) await new Promise(r => setTimeout(r, 2000));
                try {
                  const res = await fetch(`/api/feedback-content/${extractTaskId}`);
                  if (res.ok) {
                    const data = await res.json();
                    extractionUploadResult = JSON.parse(data.content);
                    if (data.meta?.chars) extractionCharCount = data.meta.chars;
                    break;
                  }
                } catch (e) { console.warn('[Poll] 轮询失败:', e); }
              }
            }

            if (!extractionUploadResult) throw new Error('课后信息提取失败：未收到上传结果（后端可能仍在处理，请稍后重试）');

            const taskEnd = Date.now();
            updateStep(3, { status: 'success', message: `完成 (${Math.round((taskEnd - taskStart) / 1000)}秒)`, detail: `课后信息已生成并上传，共${extractionCharCount}字`, endTime: taskEnd, uploadResult: extractionUploadResult });
            setClassParallelTasks(prev => ({ ...prev, extraction: { status: 'success', startTime: prev.extraction.startTime, endTime: taskEnd, uploadResult: extractionUploadResult || undefined } }));
            return { type: 'extraction', success: true, duration: taskEnd - taskStart, uploadResult: extractionUploadResult };
          } catch (error) {
            const taskEnd = Date.now();
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            updateStep(3, { status: 'error', error: errorMsg });
            setClassParallelTasks(prev => ({ ...prev, extraction: { status: 'failed', startTime: prev.extraction.startTime, endTime: taskEnd, error: errorMsg } }));
            return { type: 'extraction', success: false, duration: taskEnd - taskStart, error: errorMsg };
          }
        })(),

        // 任务4: 气泡图 (V63.10 Step 3b: 多学生并行生成)
        (async () => {
          const taskStart = Date.now();
          try {
            checkAborted();
            
            // 初始化气泡图进度，所有学生同时开始
            const initialProgress = validStudents.map(name => ({ studentName: name, status: 'running' as const }));
            setBubbleChartProgress(initialProgress);
            updateStep(4, { status: 'running', message: `正在并行生成 ${validStudents.length} 个学生的气泡图...`, detail: `全部并行执行中` });
            
            // V63.10: 所有学生并行生成气泡图
            const bubbleResults = await Promise.allSettled(
              validStudents.map(async (studentName, index) => {
                try {
                  checkAborted();
                  
                  // 生成 SVG
                  const svgResult = await generateClassBubbleChartMutation.mutateAsync({
                    studentName: studentName,
                    studentFeedback: combinedFeedback,
                    classNumber: classSnapshot.classNumber,
                    dateStr: extractedDate,
                    lessonNumber: classSnapshot.lessonNumber,
                    ...configSnapshot,
                  });
                  
                  if (!svgResult.success || !svgResult.svg) {
                    throw new Error(`${studentName} 气泡图生成失败`);
                  }
                  
                  // 前端转换 SVG 为 PNG
                  const pngBase64 = await svgToPngBase64(svgResult.svg);
                  
                  // 上传气泡图
                  await uploadClassFileMutation.mutateAsync({
                    classNumber: classSnapshot.classNumber,
                    dateStr: extractedDate,
                    fileType: 'bubbleChart',
                    studentName: studentName,
                    content: pngBase64,
                    driveBasePath: configSnapshot.driveBasePath,
                  });
                  
                  // 更新该学生状态为成功
                  setBubbleChartProgress(prev => prev.map((p, idx) => 
                    idx === index ? { ...p, status: 'success' } : p
                  ));
                  
                  return { studentName, success: true };
                } catch (error) {
                  // 更新该学生状态为失败
                  setBubbleChartProgress(prev => prev.map((p, idx) => 
                    idx === index ? { ...p, status: 'error' } : p
                  ));
                  console.error(`${studentName} 气泡图生成失败:`, error);
                  return { studentName, success: false, error: error instanceof Error ? error.message : '未知错误' };
                }
              })
            );
            
            // 统计成功数量
            const bubbleSuccessCount = bubbleResults.filter(
              r => r.status === 'fulfilled' && r.value.success
            ).length;
            
            const taskEnd = Date.now();
            updateStep(4, { 
              status: 'success', 
              message: `完成 (${Math.round((taskEnd - taskStart) / 1000)}秒)`,
              detail: `已生成 ${bubbleSuccessCount}/${validStudents.length} 个气泡图`,
              endTime: taskEnd
            });
            // V63.11: 更新小班课并行任务状态
            setClassParallelTasks(prev => ({
              ...prev,
              bubble: {
                status: 'success',
                startTime: prev.bubble.startTime,
                endTime: taskEnd,
              }
            }));
            return { type: 'bubble', success: true, duration: taskEnd - taskStart, successCount: bubbleSuccessCount, totalCount: validStudents.length };
          } catch (error) {
            const taskEnd = Date.now();
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            updateStep(4, { status: 'error', error: errorMsg });
            // V63.11: 更新小班课并行任务状态
            setClassParallelTasks(prev => ({
              ...prev,
              bubble: {
                status: 'failed',
                startTime: prev.bubble.startTime,
                endTime: taskEnd,
                error: errorMsg,
              }
            }));
            return { type: 'bubble', success: false, duration: taskEnd - taskStart, error: errorMsg };
          }
        })(),
      ];

      // 使用 Promise.allSettled 并行执行，确保一个失败不影响其他
      const results = await Promise.allSettled(parallelTasks);
      const parallelEndTime = Date.now();
      const totalParallelDuration = Math.round((parallelEndTime - parallelStartTime) / 1000);

      // V63.9: 统计结果
      let successCount = 0;
      let failedCount = 0;
      const failedTaskNames: string[] = [];
      const taskNames = ['复习文档', '测试本', '课后信息提取', '气泡图'];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          successCount++;
        } else {
          failedCount++;
          failedTaskNames.push(taskNames[index]);
        }
      });

      // V63.11: 退出小班课并行阶段
      setIsClassParallelPhase(false);

      // 如果有失败的任务，设置错误状态但不抛出（各步骤已单独更新状态）
      if (failedCount > 0) {
        setHasError(true);
        console.warn(`[V63.8] 并行生成部分失败: ${successCount}/4 成功，失败: ${failedTaskNames.join('、')}`);
        // 不抛出错误，避免覆盖各步骤的独立状态（各步骤已通过 updateStep 显示各自的错误信息）
        return;
      }

      console.log(`[V63.9] 小班课并行生成完成: ${successCount}/4 成功，总耗时 ${totalParallelDuration} 秒`);

      // 保存班级课次到 localStorage（用于下次自动填充课次+1）
      if (classSnapshot.classNumber && classSnapshot.lessonNumber) {
        const lessonNum = parseInt(classSnapshot.lessonNumber.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(lessonNum)) {
          // 使用班号作为 key，格式如 "班级:26098"
          saveStudentLesson(`班级:${classSnapshot.classNumber}`, lessonNum, classSnapshot.attendanceStudents);
          console.log(`[课次记忆] 已保存: ${classSnapshot.classNumber}班 第${lessonNum}次课, 学生: ${classSnapshot.attendanceStudents.join(',')}`);
        }
      }

      // 全部成功才设置最终步骤
      localCurrentStep = 5;
      setCurrentStep(5);

      // 完成
      setIsComplete(true);
      
    } catch (error: any) {
      setHasError(true);

      const rawMessage = error.message || '未知错误';
      let displayError = rawMessage;

      // 尝试解析结构化错误
      try {
        const parsed = JSON.parse(rawMessage);
        if (parsed.userMessage) {
          displayError = parsed.userMessage;
        } else if (parsed.message && parsed.suggestion) {
          displayError = `${parsed.message}。${parsed.suggestion}`;
        }
      } catch (e) {
        // 不是JSON，尝试匹配常见错误并转换为中文
        if (rawMessage.toLowerCase().includes('failed to fetch') || rawMessage.toLowerCase().includes('fetch failed')) {
          displayError = '网络连接失败，请检查网络后重试';
        } else if (rawMessage.includes('insufficient_user_quota') || rawMessage.includes('预扣费额度失败')) {
          displayError = 'API余额不足，请登录DMXapi充值后重试';
        } else if (rawMessage.includes('401') || rawMessage.includes('Unauthorized')) {
          displayError = 'API密钥无效，请点击右上角设置按钮检查密钥';
        } else if (rawMessage.includes('403')) {
          displayError = 'API访问被拒绝，可能是余额不足或密钥权限问题';
        } else if (rawMessage.includes('429') || rawMessage.includes('rate limit')) {
          displayError = '请求太频繁，请稍等1分钟后重试';
        } else if (rawMessage.includes('timeout') || rawMessage.includes('超时')) {
          displayError = '请求超时，可能是网络问题或AI响应太慢，请稍后重试';
        }
      }

      // 标记当前步骤为失败
      // 注意：localCurrentStep === 5 表示并行阶段结束后的聚合错误，
      // 此时各步骤已有自己的独立状态，不应覆盖（否则会把成功的气泡图标为失败）
      const failedStepIndex = localCurrentStep - 1; // 使用局部变量，避免闭包陷阱
      if (failedStepIndex >= 0 && failedStepIndex < 5 && localCurrentStep !== 5) {
        updateStep(failedStepIndex, {
          status: 'error',
          error: displayError
        });
      }
    } finally {
      setIsGenerating(false);
      setIsStopping(false);
      setCurrentGeneratingStudent(null);
      abortControllerRef.current = null;
    }
  }, [
    classNumber, lessonNumber, lessonDate, attendanceStudents, lastFeedback,
    currentNotes, transcript, apiModel, apiKey, apiUrl,
    roadmapClass, driveBasePath, generateClassFeedbackMutation, generateClassReviewMutation,
    generateClassTestMutation, generateClassExtractionMutation, generateClassBubbleChartMutation,
    uploadClassFileMutation, updateStep
  ]); // 移除 currentStep 依赖，使用 localCurrentStep 代替

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return; // 防止重复提交
    setIsSubmitting(true);

    try {
      // 如果启用了自动加载上次反馈，从 Google Drive 本地文件夹读取（首次课跳过）
      const effectiveFirstLesson = courseType === 'oneToOne' ? isFirstLesson : isClassFirstLesson;
      if (autoLoadLastFeedback && !effectiveFirstLesson) {
        const name = courseType === 'oneToOne' ? studentName.trim() : classNumber.trim();
        if (!name) {
          alert(courseType === 'oneToOne' ? '请输入学生姓名' : '请输入班号');
          return;
        }
        if (!lessonNumber.trim()) {
          alert('请填写课次号（用于定位上次反馈文件）');
          return;
        }
        try {
          const result = await readLastFeedbackMutation.mutateAsync({
            studentName: studentName.trim(),
            lessonNumber: lessonNumber.trim(),
            courseType,
            classNumber: classNumber.trim() || undefined,
          });
          autoLoadedLastFeedbackRef.current = result.content;
          setLastFeedback(result.content);
          setLastFeedbackFile({ name: result.fileName, content: result.content });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : '读取文件失败';
          alert(`自动加载上次反馈失败: ${message}`);
          return;
        }
      }

      // 如果启用了自动加载课堂笔记，从 Downloads 文件夹读取（姓名+课次号.docx）
      if (autoLoadCurrentNotes) {
        const rawName = courseType === 'oneToOne' ? studentName.trim() : classNumber.trim();
        const lesson = lessonNumber.trim();
        if (!rawName) {
          alert(courseType === 'oneToOne' ? '请输入学生姓名' : '请输入班号');
          return;
        }
        if (!lesson) {
          alert('请填写课次号（用于构建笔记文件名）');
          return;
        }
        const displayName = courseType === 'class' ? `${rawName}班` : rawName;
        const expectedFileName = `${displayName}${lesson}.docx`;
        try {
          const result = await readFromDownloadsMutation.mutateAsync({ fileName: expectedFileName });
          autoLoadedCurrentNotesRef.current = result.content;
          setCurrentNotes(result.content);
          setCurrentNotesFile({ name: result.fileName, content: result.content });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : '读取文件失败';
          alert(`自动加载课堂笔记失败: ${message}`);
          return;
        }
      }

      // 如果启用了自动加载录音转文字，先从 Downloads 文件夹读取（姓名+日期.docx）
      if (autoLoadTranscript) {
        const rawName = courseType === 'oneToOne' ? studentName.trim() : classNumber.trim();
        const mmdd = getMMDD(lessonDate);
        if (!rawName) {
          alert(courseType === 'oneToOne' ? '请输入学生姓名' : '请输入班号');
          return;
        }
        if (!mmdd) {
          alert('请填写本次课日期（用于构建文件名）');
          return;
        }
        const displayName = courseType === 'class' ? `${rawName}班` : rawName;
        const expectedFileName = `${displayName}${mmdd}.docx`;
        try {
          // 多段模式：传 segmentCount；默认模式：传 allowSplit
          const loadParams = multiSegment
            ? { fileName: expectedFileName, segmentCount }
            : { fileName: expectedFileName, allowSplit: true };
          const result = await readFromDownloadsMutation.mutateAsync(loadParams);
          autoLoadedTranscriptRef.current = result.content;
          transcriptSegmentsRef.current = result.segments || null;
          setTranscript(result.content);
          setTranscriptFile({ name: result.fileName, content: result.content });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : '读取文件失败';
          alert(`自动加载录音转文字失败: ${message}`);
          return;
        }
      }

      // 获取最终的文本内容（可能来自自动加载）
      const finalLastFeedback = autoLoadedLastFeedbackRef.current || lastFeedback;
      const finalTranscript = autoLoadedTranscriptRef.current || transcript;
      const finalCurrentNotes = autoLoadedCurrentNotesRef.current || currentNotes;

      if (courseType === 'oneToOne') {
        // 一对一模式验证
        if (!studentName.trim()) { alert('请输入学生姓名'); return; }
        if (!autoLoadCurrentNotes && !finalCurrentNotes.trim()) { alert('请输入课堂笔记'); return; }
        if (!autoLoadTranscript && !finalTranscript.trim()) { alert('请输入录音转文字'); return; }
      } else {
        // 小班课模式验证
        if (!classNumber.trim()) { alert('请输入班号'); return; }
        const validStudents = attendanceStudents.filter((s: string) => s.trim());
        if (validStudents.length === 0) { alert('请至少添加一名出勤学生'); return; }
        if (!autoLoadCurrentNotes && !finalCurrentNotes.trim()) { alert('请输入课堂笔记'); return; }
        if (!autoLoadTranscript && !finalTranscript.trim()) { alert('请输入录音转文字'); return; }
      }

      // 提交后台任务（服务器端执行，断网不影响）
      try {
        const result = await bgTaskSubmitMutation.mutateAsync({
          courseType: courseType === 'oneToOne' ? 'one-to-one' : 'class',
          studentName: studentName.trim() || undefined,
          lessonNumber: lessonNumber.trim() || undefined,
          lessonDate: lessonDate.trim() || undefined,
          currentYear: currentYear.trim() || undefined,
          lastFeedback: finalLastFeedback || undefined,
          currentNotes: finalCurrentNotes.trim(),
          transcript: finalTranscript.trim(),
          isFirstLesson: (courseType === 'oneToOne' ? isFirstLesson : isClassFirstLesson) || undefined,
          specialRequirements: undefined,
          classNumber: classNumber.trim() || undefined,
          attendanceStudents: courseType === 'class' ? attendanceStudents.filter((s: string) => s.trim()) : undefined,
          transcriptSegments: transcriptSegmentsRef.current || undefined,
          apiModel: apiModel.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
          apiUrl: apiUrl.trim() || undefined,
          roadmap: roadmap || undefined,
          roadmapClass: roadmapClass || undefined,
          driveBasePath: driveBasePath.trim() || undefined,
        });
        transcriptSegmentsRef.current = null; // 提交后清除
        setActiveTaskId(result.taskId);
        // 新任务：检查 localStorage 是否曾导入过（通常不会，但保持一致）
        setHwImportStatus(localStorage.getItem(`hw-imported-${result.taskId}`) === '1' ? 'success' : 'idle');

        // 保存学生/班级课次到历史（用于下次自动填充课次+1）
        const lessonNum = parseInt((lessonNumber || '').replace(/[^0-9]/g, ''), 10);
        if (!isNaN(lessonNum)) {
          if (courseType === 'oneToOne' && studentName.trim()) {
            saveStudentLesson(studentName.trim(), lessonNum);
          } else if (courseType === 'class' && classNumber.trim()) {
            const validStudents = attendanceStudents.filter((s: string) => s.trim());
            saveStudentLesson(`班级:${classNumber.trim()}`, lessonNum, validStudents);
          }
        }

        // 提交成功 - 不弹对话框，任务会自动出现在下方「任务记录」中
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '提交失败';
        alert(`任务提交失败: ${message}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // 单步重试函数
  // V63.12: 根据 courseType 区分一对一和小班课接口
  const retryStep = useCallback(async (stepIndex: number) => {
    if (isGenerating || activeTaskId) return; // 后台任务运行中禁止SSE重试
    
    setIsGenerating(true);
    updateStep(stepIndex, { status: 'running', message: '正在重试...' });

    // 构建配置快照（并发安全）
    const configSnapshot = {
      apiModel: apiModel.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      apiUrl: apiUrl.trim() || undefined,
      lessonDate: lessonDate.trim() || undefined,
      currentYear: currentYear.trim() || undefined,
      roadmap: roadmap || undefined,
      roadmapClass: roadmapClass || undefined,
      driveBasePath: driveBasePath.trim() || undefined,
    };

    try {
      let result;
      
      // V63.12: 根据课程类型调用不同接口
      if (courseType === 'class') {
        // ===== 小班课模式 =====
        const validStudents = attendanceStudents.filter((s: string) => s.trim());
        
        switch (stepIndex) {
          case 0: { // 小班课学情反馈 (SSE + taskId 轮询容错)
            updateStep(0, { status: 'running', message: `正在为 ${classNumber} 班重新生成学情反馈...` });
            const cfTaskId = crypto.randomUUID();
            let cfFeedbackContent = '';
            let cfSseError: string | null = null;

            try {
              const classFeedbackResponse = await fetch('/api/class-feedback-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  classNumber: classNumber.trim(),
                  lessonNumber: lessonNumber.trim(),
                  attendanceStudents: validStudents,
                  lastFeedback: lastFeedback.trim(),
                  currentNotes: currentNotes.trim(),
                  transcript: transcript.trim(),
                  taskId: cfTaskId,
                  ...configSnapshot,
                  lessonDate: lessonDate.trim(),
                }),
              });

              if (!classFeedbackResponse.ok) {
                throw new Error(`学情反馈生成失败: HTTP ${classFeedbackResponse.status}`);
              }

              const cfReader = classFeedbackResponse.body?.getReader();
              if (!cfReader) throw new Error('无法读取响应流');

              const cfDecoder = new TextDecoder();
              let cfBuffer = '';
              let cfCurrentEventType = '';
              const cfContentChunks: string[] = [];

              try {
                while (true) {
                  const { done, value } = await cfReader.read();
                  if (done) break;

                  cfBuffer += cfDecoder.decode(value, { stream: true });
                  const cfLines = cfBuffer.split('\n');
                  cfBuffer = cfLines.pop() || '';

                  for (const line of cfLines) {
                    if (line.startsWith('event: ')) {
                      cfCurrentEventType = line.slice(7).trim();
                      continue;
                    }
                    if (line.startsWith('data: ')) {
                      try {
                        const data = JSON.parse(line.slice(6));
                        if (cfCurrentEventType === 'progress' && data.chars) {
                          updateStep(0, { status: 'running', message: `正在生成学情反馈... 已生成 ${data.chars} 字符` });
                        } else if (cfCurrentEventType === 'content-chunk' && data.text !== undefined) {
                          cfContentChunks[data.index] = data.text;
                        } else if (cfCurrentEventType === 'complete') {
                          if (data.chunked && cfContentChunks.length > 0) {
                            cfFeedbackContent = cfContentChunks.join('');
                          } else if (data.feedback) {
                            cfFeedbackContent = data.feedback;
                          }
                        } else if (cfCurrentEventType === 'error' && data.message) {
                          cfSseError = data.message;
                        }
                      } catch (e) { /* 忽略解析错误 */ }
                    }
                  }
                }
              } finally { cfReader.cancel().catch(() => {}); }
            } catch (e) { console.log('[ClassFeedback retry] SSE断开:', e); }

            if (cfSseError) throw new Error(cfSseError);

            // SSE 断开后轮询获取内容
            if (!cfFeedbackContent) {
              updateStep(0, { status: 'running', message: '等待后端完成生成...' });
              for (let p = 0; p < 60; p++) { if (p > 0) await new Promise(r => setTimeout(r, 2000)); try { const r = await fetch(`/api/feedback-content/${cfTaskId}`); if (r.ok) { const d = await r.json(); cfFeedbackContent = d.content; break; } } catch(e){ console.warn('[Poll] 轮询失败:', e); } }
            }
            if (!cfFeedbackContent) throw new Error('学情反馈生成失败：未收到内容');

            // 提取日期
            let cfExtractedDate = lessonDate.trim();
            if (!cfExtractedDate) {
              const dateMatch = cfFeedbackContent.match(/(\d{1,2}月\d{1,2}日?)/);
              cfExtractedDate = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
            }
            setDateStr(cfExtractedDate);
            setFeedbackContent(cfFeedbackContent);

            // 上传学情反馈
            const cfUploadResult = await uploadClassFileMutation.mutateAsync({
              classNumber: classNumber.trim(),
              dateStr: cfExtractedDate,
              fileType: 'feedback',
              content: cfFeedbackContent,
              driveBasePath: configSnapshot.driveBasePath,
            });

            updateStep(0, { status: 'success', message: '生成完成', detail: `学情反馈已生成并上传，共${cfFeedbackContent.length}字`, uploadResult: { fileName: cfUploadResult.fileName, url: cfUploadResult.url, path: cfUploadResult.path } });
            break;
          }

          case 1: { // 小班课复习文档 (SSE + polling)
            if (!feedbackContent || !dateStr) throw new Error('请先生成学情反馈');
            updateStep(1, { status: 'running', message: '正在重新生成复习文档...' });
            const rTaskId = crypto.randomUUID();
            let rUpload: any = null;
            let rErr: string | null = null;
            try {
              const rRes = await fetch('/api/class-review-stream', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ classNumber: classNumber.trim(), lessonNumber: lessonNumber.trim(), attendanceStudents: validStudents, currentNotes: currentNotes.trim(), combinedFeedback: feedbackContent, taskId: rTaskId, ...configSnapshot, lessonDate: dateStr }),
              });
              if (!rRes.ok) throw new Error(`HTTP ${rRes.status}`);
              const reader = rRes.body?.getReader();
              if (reader) {
                const dec = new TextDecoder(); let buf = '', evt = '';
                try {
                  while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop() || '';
                    for (const l of ls) { if (l.startsWith('event: ')) { evt = l.slice(7).trim(); continue; } if (l.startsWith('data: ')) { try { const d = JSON.parse(l.slice(6)); if (evt === 'progress' && d.chars) updateStep(1, { status: 'running', message: `已生成 ${d.chars} 字符` }); else if (evt === 'complete' && d.uploadResult) rUpload = d.uploadResult; else if (evt === 'error' && d.message) rErr = d.message; } catch(e){ /* SSE parse ignore */ } } } }
                } finally { reader.cancel().catch(() => {}); }
              }
            } catch(e) { console.log('[Review retry] SSE断开:', e); }
            if (rErr) throw new Error(rErr);
            if (!rUpload) { updateStep(1, { status: 'running', message: '等待后端完成上传...' });
              for (let p = 0; p < 60; p++) { if (p > 0) await new Promise(r => setTimeout(r, 2000)); try { const r = await fetch(`/api/feedback-content/${rTaskId}`); if (r.ok) { const d = await r.json(); rUpload = JSON.parse(d.content); break; } } catch(e){ console.warn('[Poll] 轮询失败:', e); } } }
            if (!rUpload) throw new Error('复习文档生成失败：未收到上传结果');
            updateStep(1, { status: 'success', message: '生成完成', uploadResult: rUpload });
            break;
          }

          case 2: { // 小班课测试本 (SSE + polling)
            if (!feedbackContent || !dateStr) throw new Error('请先生成学情反馈');
            updateStep(2, { status: 'running', message: '正在重新生成测试本...' });
            const tTaskId = crypto.randomUUID();
            let tUpload: any = null;
            let tErr: string | null = null;
            try {
              const tRes = await fetch('/api/class-test-stream', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ classNumber: classNumber.trim(), lessonNumber: lessonNumber.trim(), attendanceStudents: validStudents, currentNotes: currentNotes.trim(), combinedFeedback: feedbackContent, taskId: tTaskId, ...configSnapshot, lessonDate: dateStr }),
              });
              if (!tRes.ok) throw new Error(`HTTP ${tRes.status}`);
              const reader = tRes.body?.getReader();
              if (reader) {
                const dec = new TextDecoder(); let buf = '', evt = '';
                try {
                  while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop() || '';
                    for (const l of ls) { if (l.startsWith('event: ')) { evt = l.slice(7).trim(); continue; } if (l.startsWith('data: ')) { try { const d = JSON.parse(l.slice(6)); if (evt === 'progress') { if (d.chars) updateStep(2, { status: 'running', message: d.message || `已生成 ${d.chars} 字符` }); else if (d.message) updateStep(2, { status: 'running', message: d.message }); } else if (evt === 'complete' && d.uploadResult) tUpload = d.uploadResult; else if (evt === 'error' && d.message) tErr = d.message; } catch(e){ /* SSE parse ignore */ } } } }
                } finally { reader.cancel().catch(() => {}); }
              }
            } catch(e) { console.log('[Test retry] SSE断开:', e); }
            if (tErr) throw new Error(tErr);
            if (!tUpload) { updateStep(2, { status: 'running', message: '等待后端完成上传...' });
              for (let p = 0; p < 60; p++) { if (p > 0) await new Promise(r => setTimeout(r, 2000)); try { const r = await fetch(`/api/feedback-content/${tTaskId}`); if (r.ok) { const d = await r.json(); tUpload = JSON.parse(d.content); break; } } catch(e){ console.warn('[Poll] 轮询失败:', e); } } }
            if (!tUpload) throw new Error('测试本生成失败：未收到上传结果');
            updateStep(2, { status: 'success', message: '生成完成', uploadResult: tUpload });
            break;
          }

          case 3: { // 小班课课后信息提取 (SSE + polling)
            if (!feedbackContent || !dateStr) throw new Error('请先生成学情反馈');
            updateStep(3, { status: 'running', message: '正在重新生成课后信息提取...' });
            const eTaskId = crypto.randomUUID();
            let eUpload: any = null;
            let eErr: string | null = null;
            try {
              const eRes = await fetch('/api/class-extraction-stream', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ classNumber: classNumber.trim(), lessonNumber: lessonNumber.trim(), attendanceStudents: validStudents, combinedFeedback: feedbackContent, taskId: eTaskId, ...configSnapshot, lessonDate: dateStr }),
              });
              if (!eRes.ok) throw new Error(`HTTP ${eRes.status}`);
              const reader = eRes.body?.getReader();
              if (reader) {
                const dec = new TextDecoder(); let buf = '', evt = '';
                try {
                  while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop() || '';
                    for (const l of ls) { if (l.startsWith('event: ')) { evt = l.slice(7).trim(); continue; } if (l.startsWith('data: ')) { try { const d = JSON.parse(l.slice(6)); if (evt === 'progress') { if (d.chars) updateStep(3, { status: 'running', message: d.message || `已生成 ${d.chars} 字符` }); else if (d.message) updateStep(3, { status: 'running', message: d.message }); } else if (evt === 'complete' && d.uploadResult) eUpload = d.uploadResult; else if (evt === 'error' && d.message) eErr = d.message; } catch(e){ /* SSE parse ignore */ } } } }
                } finally { reader.cancel().catch(() => {}); }
              }
            } catch(e) { console.log('[Extraction retry] SSE断开:', e); }
            if (eErr) throw new Error(eErr);
            if (!eUpload) { updateStep(3, { status: 'running', message: '等待后端完成上传...' });
              for (let p = 0; p < 60; p++) { if (p > 0) await new Promise(r => setTimeout(r, 2000)); try { const r = await fetch(`/api/feedback-content/${eTaskId}`); if (r.ok) { const d = await r.json(); eUpload = JSON.parse(d.content); break; } } catch(e){ console.warn('[Poll] 轮询失败:', e); } } }
            if (!eUpload) throw new Error('课后信息提取失败：未收到上传结果');
            updateStep(3, { status: 'success', message: '生成完成', uploadResult: eUpload });
            break;
          }

          case 4: // 小班课气泡图 (多学生并行)
            if (!feedbackContent || !dateStr) throw new Error('请先生成学情反馈');
            updateStep(4, { status: 'running', message: `正在为 ${validStudents.length} 个学生重新生成气泡图...` });
            
            // 初始化气泡图进度
            const initialProgress = validStudents.map(name => ({ studentName: name, status: 'running' as const }));
            setBubbleChartProgress(initialProgress);
            
            // V63.12: 复用 Step 3b 的并行逻辑
            const bubbleResults = await Promise.allSettled(
              validStudents.map(async (studentName, index) => {
                try {
                  const svgResult = await generateClassBubbleChartMutation.mutateAsync({
                    studentName: studentName,
                    studentFeedback: feedbackContent,
                    classNumber: classNumber.trim(),
                    dateStr,
                    lessonNumber: lessonNumber.trim(),
                    ...configSnapshot,
                  });
                  
                  if (!svgResult.success || !svgResult.svg) throw new Error(`${studentName} 气泡图生成失败`);
                  
                  const pngBase64 = await svgToPngBase64(svgResult.svg);
                  
                  await uploadClassFileMutation.mutateAsync({
                    classNumber: classNumber.trim(),
                    dateStr,
                    fileType: 'bubbleChart',
                    studentName: studentName,
                    content: pngBase64,
                    driveBasePath: configSnapshot.driveBasePath,
                  });
                  
                  setBubbleChartProgress(prev => prev.map((p, idx) => idx === index ? { ...p, status: 'success' } : p));
                  return { studentName, success: true };
                } catch (error) {
                  setBubbleChartProgress(prev => prev.map((p, idx) => idx === index ? { ...p, status: 'error' } : p));
                  return { studentName, success: false, error: error instanceof Error ? error.message : '未知错误' };
                }
              })
            );
            
            const bubbleSuccessCount = bubbleResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
            updateStep(4, { status: 'success', message: '生成完成', detail: `气泡图已生成并上传，共${bubbleSuccessCount}/${validStudents.length}个` });
            break;
        }
      } else {
        // ===== 一对一模式（保持原有逻辑） =====
        switch (stepIndex) {
          case 0: { // 学情反馈 (tRPC + taskId 轮询容错)
            const fbTaskId = crypto.randomUUID();
            let fbResult: any = null;
            try {
              fbResult = await generateFeedbackMutation.mutateAsync({
                studentName: studentName.trim(),
                lessonNumber: lessonNumber.trim(),
                lastFeedback: lastFeedback.trim(),
                currentNotes: currentNotes.trim(),
                transcript: transcript.trim(),
                isFirstLesson,
                taskId: fbTaskId,
                ...configSnapshot,
              });
            } catch (e) { console.log('[Feedback retry] tRPC失败，轮询:', e); }
            if (!fbResult) {
              updateStep(0, { status: 'running', message: '等待后端完成生成...' });
              for (let p = 0; p < 60; p++) { if (p > 0) await new Promise(r => setTimeout(r, 2000)); try { const r = await fetch(`/api/feedback-content/${fbTaskId}`); if (r.ok) { const d = await r.json(); fbResult = JSON.parse(d.content); break; } } catch(e){ console.warn('[Poll] 轮询失败:', e); } }
            }
            if (!fbResult) throw new Error('学情反馈生成失败：未收到结果');
            setFeedbackContent(fbResult.feedbackContent);
            setDateStr(fbResult.dateStr);
            updateStep(0, { status: 'success', message: '生成完成', detail: `学情反馈已生成并上传，共${fbResult.feedbackContent.length}字`, uploadResult: fbResult.uploadResult });
            break;
          }

          case 1: { // 复习文档 (tRPC + taskId 轮询容错)
            if (!feedbackContent || !dateStr) throw new Error('请先生成学情反馈');
            const revTaskId = crypto.randomUUID();
            let revUpload: any = null;
            try {
              result = await generateReviewMutation.mutateAsync({
                studentName: studentName.trim(), dateStr, feedbackContent, taskId: revTaskId, ...configSnapshot,
              });
              revUpload = result.uploadResult;
            } catch (e) { console.log('[Review retry] tRPC失败，轮询:', e); }
            if (!revUpload) {
              updateStep(1, { status: 'running', message: '等待后端完成上传...' });
              for (let p = 0; p < 60; p++) { if (p > 0) await new Promise(r => setTimeout(r, 2000)); try { const r = await fetch(`/api/feedback-content/${revTaskId}`); if (r.ok) { const d = await r.json(); revUpload = JSON.parse(d.content); break; } } catch(e){ console.warn('[Poll] 轮询失败:', e); } }
            }
            if (!revUpload) throw new Error('复习文档生成失败：未收到上传结果');
            updateStep(1, { status: 'success', message: '生成完成', uploadResult: revUpload });
            break;
          }

          case 2: { // 测试本 (tRPC + taskId 轮询容错)
            if (!feedbackContent || !dateStr) throw new Error('请先生成学情反馈');
            const tstTaskId = crypto.randomUUID();
            let tstUpload: any = null;
            try {
              result = await generateTestMutation.mutateAsync({
                studentName: studentName.trim(), dateStr, feedbackContent, taskId: tstTaskId, ...configSnapshot,
              });
              tstUpload = result.uploadResult;
            } catch (e) { console.log('[Test retry] tRPC失败，轮询:', e); }
            if (!tstUpload) {
              updateStep(2, { status: 'running', message: '等待后端完成上传...' });
              for (let p = 0; p < 60; p++) { if (p > 0) await new Promise(r => setTimeout(r, 2000)); try { const r = await fetch(`/api/feedback-content/${tstTaskId}`); if (r.ok) { const d = await r.json(); tstUpload = JSON.parse(d.content); break; } } catch(e){ console.warn('[Poll] 轮询失败:', e); } }
            }
            if (!tstUpload) throw new Error('测试本生成失败：未收到上传结果');
            updateStep(2, { status: 'success', message: '生成完成', uploadResult: tstUpload });
            break;
          }

          case 3: { // 课后信息提取 (tRPC + taskId 轮询容错)
            if (!feedbackContent || !dateStr) throw new Error('请先生成学情反馈');
            const extTaskId = crypto.randomUUID();
            let extUpload: any = null;
            try {
              result = await generateExtractionMutation.mutateAsync({
                studentName: studentName.trim(), dateStr, feedbackContent, taskId: extTaskId, ...configSnapshot,
              });
              extUpload = result.uploadResult;
            } catch (e) { console.log('[Extraction retry] tRPC失败，轮询:', e); }
            if (!extUpload) {
              updateStep(3, { status: 'running', message: '等待后端完成上传...' });
              for (let p = 0; p < 60; p++) { if (p > 0) await new Promise(r => setTimeout(r, 2000)); try { const r = await fetch(`/api/feedback-content/${extTaskId}`); if (r.ok) { const d = await r.json(); extUpload = JSON.parse(d.content); break; } } catch(e){ console.warn('[Poll] 轮询失败:', e); } }
            }
            if (!extUpload) throw new Error('课后信息提取失败：未收到上传结果');
            updateStep(3, { status: 'success', message: '生成完成', uploadResult: extUpload });
            break;
          }

          case 4: { // 气泡图 (tRPC + taskId 轮询容错 + 前端转换 + 上传)
            if (!feedbackContent || !dateStr) throw new Error('请先生成学情反馈');
            const bubTaskId = crypto.randomUUID();
            let bubSvg: string | null = null;
            updateStep(4, { status: 'running', message: '正在生成SVG...' });
            try {
              result = await generateBubbleChartMutation.mutateAsync({
                studentName: studentName.trim(), dateStr, lessonNumber: lessonNumber.trim(), feedbackContent, taskId: bubTaskId, ...configSnapshot,
              });
              bubSvg = result.svgContent;
            } catch (e) { console.log('[BubbleChart retry] tRPC失败，轮询:', e); }
            if (!bubSvg) {
              updateStep(4, { status: 'running', message: '等待后端生成SVG...' });
              for (let p = 0; p < 60; p++) { if (p > 0) await new Promise(r => setTimeout(r, 2000)); try { const r = await fetch(`/api/feedback-content/${bubTaskId}`); if (r.ok) { const d = await r.json(); const parsed = JSON.parse(d.content); bubSvg = parsed.svgContent; break; } } catch(e){ console.warn('[Poll] 轮询失败:', e); } }
            }
            if (!bubSvg) throw new Error('气泡图生成失败：未收到SVG');
            updateStep(4, { status: 'running', message: '正在转换并上传...' });
            const retrySvgContent = bubSvg;
            const retryPngBase64 = await svgToPngBase64(retrySvgContent);
            const retryUploadResult = await uploadBubbleChartMutation.mutateAsync({
              studentName: studentName.trim(), dateStr, pngBase64: retryPngBase64, driveBasePath: configSnapshot.driveBasePath,
            });
            updateStep(4, { status: 'success', message: '生成完成', detail: '气泡图已生成并上传', uploadResult: retryUploadResult.uploadResult });
            break;
          }
        }
      }

      // 检查是否所有步骤都成功或跳过
      const allDone = steps.every((s, i) => i === stepIndex || s.status === 'success' || s.status === 'skipped');
      if (allDone) {
        setIsComplete(true);
        setHasError(false);
      }
    } catch (error) {
      console.error(`步骤${stepIndex + 1}重试失败:`, error);
      
      // 解析错误信息
      const rawMessage = error instanceof Error ? error.message : '重试失败';
      let displayError = rawMessage;
      try {
        const parsed = JSON.parse(rawMessage);
        if (parsed.userMessage) {
          displayError = parsed.userMessage;
        } else if (parsed.message && parsed.suggestion) {
          displayError = `${parsed.message}。${parsed.suggestion}`;
        }
      } catch (e) {
        if (rawMessage.toLowerCase().includes('failed to fetch') || rawMessage.toLowerCase().includes('fetch failed')) {
          displayError = '网络连接失败，请检查网络后重试';
        } else if (rawMessage.includes('insufficient_user_quota') || rawMessage.includes('预扣费额度失败')) {
          displayError = 'API余额不足，请登录DMXapi充值后重试';
        } else if (rawMessage.includes('401') || rawMessage.includes('Unauthorized')) {
          displayError = 'API密钥无效，请点击右上角设置按钮检查密钥';
        } else if (rawMessage.includes('403')) {
          displayError = 'API访问被拒绝，可能是余额不足或密钥权限问题';
        } else if (rawMessage.includes('429') || rawMessage.includes('rate limit')) {
          displayError = '请求太频繁，请稍等1分钟后重试';
        } else if (rawMessage.includes('timeout') || rawMessage.includes('超时')) {
          displayError = '请求超时，可能是网络问题或AI响应太慢，请稍后重试';
        }
      }
      
      updateStep(stepIndex, { 
        status: 'error', 
        error: displayError
      });
    } finally {
      setIsGenerating(false);
    }
  }, [
    isGenerating, steps, feedbackContent, dateStr, studentName, lessonNumber,
    lessonDate, currentYear, lastFeedback, currentNotes, transcript, isFirstLesson,
    apiModel, apiKey, apiUrl, roadmap, roadmapClass, driveBasePath, updateStep,
    // 一对一 mutations
    generateFeedbackMutation, generateReviewMutation, generateTestMutation,
    generateExtractionMutation, generateBubbleChartMutation, uploadBubbleChartMutation,
    // V63.12: 小班课 mutations
    courseType, classNumber, attendanceStudents,
    generateClassTestMutation, generateClassExtractionMutation, generateClassBubbleChartMutation, uploadClassFileMutation
  ]);

  // 跳过步骤函数（仅适用于步骤2-5）
  const skipStep = useCallback((stepIndex: number) => {
    // 步骤1不能跳过，因为后续步骤都依赖它的输出
    if (stepIndex === 0) return;
    
    // 将该步骤标记为 skipped
    updateStep(stepIndex, { 
      status: 'skipped', 
      message: '已跳过',
      error: undefined 
    });
    
    // V63.13: 根据课程类型区分处理逻辑
    if (courseType === 'oneToOne') {
      // 一对一模式：继续执行下一步
      const nextStepIndex = stepIndex + 1;
      if (nextStepIndex < 5) {
        // 延迟一下再执行下一步，确保 UI 更新
        if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
        skipTimerRef.current = setTimeout(() => {
          skipTimerRef.current = null;
          retryStep(nextStepIndex);
        }, 100);
      } else {
        // 已经是最后一步，标记为完成
        setIsComplete(true);
      }
    } else {
      // 小班课模式：并行执行已完成，只需标记状态
      // 检查是否所有步骤都已完成（成功或跳过）
      const allDone = steps.every((s, i) => 
        i === stepIndex || s.status === 'success' || s.status === 'skipped'
      );
      if (allDone) {
        setIsComplete(true);
        setHasError(false);
      }
    }
  }, [updateStep, retryStep, courseType, steps]);

  const handleReset = () => {
    // 根据课程类型重置不同的步骤
    setSteps(courseType === 'oneToOne' ? initialSteps : initialClassSteps);
    setCurrentStep(0);
    setFeedbackContent("");
    setDateStr("");
    setIsComplete(false);
    setHasError(false);
    setExportLogResult(null);
    // V63.8: 重置并行任务状态
    setParallelTasks(initialParallelTasks);
    setIsParallelPhase(false);
    // V63.11: 重置小班课并行任务状态
    setClassParallelTasks(initialParallelTasks);
    setIsClassParallelPhase(false);
    // 重置小班课相关状态
    setClassFeedbacks([]);
    setBubbleChartProgress([]);
    setIsClassFirstLesson(false);
  };

  // 一键导入学生管理（从课后信息提取）
  const handleHwImport = useCallback(async () => {
    if (!activeTaskId) return;
    // 先验证必填字段，避免设置loading后提前return导致按钮卡死
    if (courseType === 'class' && !classNumber.trim()) return;
    if (courseType !== 'class' && !studentName.trim()) return;

    setHwImportStatus('loading');
    try {
      if (courseType === 'class') {
        // 小班课：N+1模式，导入班级 + 每个出勤学生
        const validStudents = attendanceStudents.filter((s: string) => s.trim());
        const result = await hwImportClassFromTaskMutation.mutateAsync({
          taskId: activeTaskId,
          classNumber: classNumber.trim(),
          attendanceStudents: validStudents,
        });
        console.log(`[学生管理导入] 小班课导入完成: ${result.className}, 共${result.total}条`);
      } else {
        // 一对一：原有逻辑
        await hwImportFromTaskMutation.mutateAsync({
          taskId: activeTaskId,
          studentName: studentName.trim(),
        });
      }
      setHwImportStatus('success');
      if (activeTaskId) localStorage.setItem(`hw-imported-${activeTaskId}`, '1');
    } catch (err: any) {
      console.error("[学生管理导入] 失败:", err);
      setHwImportStatus('error');
    }
  }, [activeTaskId, courseType, studentName, classNumber, attendanceStudents, hwImportFromTaskMutation, hwImportClassFromTaskMutation]);

  // 导出日志到Google Drive
  const handleExportLog = async () => {
    setIsExportingLog(true);
    setExportLogResult(null);
    try {
      // 根据课程类型传入不同的标识
      const identifier = courseType === 'oneToOne' 
        ? studentName.trim() 
        : `${classNumber.trim()}班`;
      const result = await exportLogMutation.mutateAsync({ studentName: identifier || undefined });
      setExportLogResult({
        success: result.success,
        message: result.message,
        path: result.path,
        url: result.url,
      });
    } catch (error) {
      setExportLogResult({
        success: false,
        message: `导出失败: ${error instanceof Error ? error.message : '未知错误'}`,
      });
    } finally {
      setIsExportingLog(false);
    }
  };

  // 表单验证：根据课程类型检查不同的必填字段
  // 如果启用了自动加载，对应字段不需要手动填写（会在提交时自动读取）
  const transcriptReady = autoLoadTranscript
    ? !!(courseType === 'oneToOne' ? studentName.trim() : classNumber.trim()) && !!getMMDD(lessonDate)
    : !!transcript.trim();
  const notesReady = autoLoadCurrentNotes
    ? !!(courseType === 'oneToOne' ? studentName.trim() : classNumber.trim()) && !!lessonNumber.trim()
    : !!currentNotes.trim();
  const isFormValid = courseType === 'oneToOne'
    ? (studentName.trim() && notesReady && transcriptReady)
    : (classNumber.trim() && attendanceStudents.some((s: string) => s.trim()) && notesReady && transcriptReady);

  // 计算成功数量
  const successCount = steps.filter(s => s.status === 'success').length;
  const errorCount = steps.filter(s => s.status === 'error').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      {/* 右上角：用户菜单 + 全局设置 + 版本号 */}
      <div className="fixed top-2 right-2 flex items-center gap-1 z-50">
        {authUser && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground">
                <User className="h-3.5 w-3.5" />
                <span className="max-w-[80px] truncate hidden sm:inline">{authUser.name || authUser.email || '用户'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5 text-xs text-muted-foreground border-b mb-1">
                {authUser.email || authUser.name || '未知用户'}
              </div>
              <DropdownMenuItem
                onClick={async () => {
                  await logout();
                  window.location.reload();
                }}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <GlobalSettings disabled={isGenerating} />
        <span className="text-xs text-muted-foreground">{VERSION_DISPLAY}</span>
      </div>
      <div className="max-w-4xl mx-auto">
        {/* 标题 */}
        <div className="text-center mb-4 sm:mb-8">
          <h1 className="text-xl sm:text-3xl font-bold text-gray-800 mb-1">学情反馈系统</h1>
          <p className="text-xs sm:text-base text-gray-600 mb-2 sm:mb-4">输入课堂信息，自动生成文档并存储到Google Drive</p>
          <RoadmapSettings disabled={isGenerating} />
        </div>

        {/* 大分页 Tab 切换 */}
        <Tabs defaultValue="classroom" className="w-full">
          <TabsList className="grid w-full grid-cols-2 grid-rows-2 h-auto mb-6">
            <TabsTrigger value="classroom" className="text-base py-2">
              <FileText className="w-4 h-4 mr-2" />
              课堂反馈
            </TabsTrigger>
            <TabsTrigger value="homework" className="text-base py-2">
              <BookOpen className="w-4 h-4 mr-2" />
              学生管理
            </TabsTrigger>
            <TabsTrigger value="correction" className="text-base py-2">
              <PenLine className="w-4 h-4 mr-2" />
              作业批改
            </TabsTrigger>
            <TabsTrigger value="batch" className="text-base py-2">
              <Users className="w-4 h-4 mr-2" />
              批量处理
            </TabsTrigger>
          </TabsList>

          {/* 课堂反馈 Tab 内容 */}
          <TabsContent value="classroom">
        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              课堂信息录入
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              填写课堂信息，自动生成5个文档
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 基本信息区 */}
              <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                <h3 className="font-semibold text-gray-700 mb-3">基本信息</h3>
                
                {/* 课程类型切换 */}
                <div className="flex items-center gap-4 pb-3 border-b">
                  <Label>课程类型：</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={courseType === 'oneToOne' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCourseType('oneToOne')}
                      disabled={isGenerating}
                    >
                      一对一
                    </Button>
                    <Button
                      type="button"
                      variant={courseType === 'class' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCourseType('class')}
                      disabled={isGenerating}
                    >
                      <Users className="w-4 h-4 mr-1" />
                      小班课
                    </Button>
                  </div>
                </div>
                
                {courseType === 'oneToOne' ? (
                  /* 一对一模式 */
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="studentName">学生姓名 *</Label>
                        <div className="relative">
                          <Input
                            ref={studentInputRef}
                            id="studentName"
                            placeholder="例如：张三（点击选择历史）"
                            value={studentName}
                            onChange={(e) => setStudentName(e.target.value)}
                            onFocus={handleStudentInputFocus}
                            disabled={isGenerating}
                            autoComplete="off"
                          />
                          {showStudentDropdown && recentStudents.length > 0 && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                              {recentStudents.map((s, i) => (
                                <div
                                  key={i}
                                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex justify-between items-center"
                                  onClick={() => handleSelectStudent(s.name)}
                                >
                                  <span className="font-medium">{s.name}</span>
                                  <span className="text-xs text-gray-400">上次第{s.lesson}次 → {s.lesson + 1}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="lessonNumber">课次</Label>
                        <Input
                          id="lessonNumber"
                          placeholder="例如：12（自动填充）"
                          value={lessonNumber}
                          onChange={(e) => setLessonNumber(e.target.value)}
                          disabled={isGenerating}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div className="space-y-2">
                        <Label htmlFor="currentYear">年份</Label>
                        <Input
                          id="currentYear"
                          placeholder="例如：2026"
                          value={currentYear}
                          onChange={(e) => setCurrentYear(e.target.value)}
                          disabled={isGenerating}
                        />
                        <p className="text-xs text-gray-500">可在设置中修改</p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="lessonDate">本次课日期</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="lessonDate"
                            placeholder="例如：1月15日"
                            value={lessonDate}
                            onChange={(e) => setLessonDate(e.target.value)}
                            disabled={isGenerating}
                          />
                          {lessonDate && getWeekday(lessonDate, currentYear) && (
                            <span className="text-sm text-blue-600 whitespace-nowrap">
                              ({getWeekday(lessonDate, currentYear)})
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">可留空，AI自动提取</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 pt-2">
                      <Switch
                        id="isFirstLesson"
                        checked={isFirstLesson}
                        onCheckedChange={(checked) => {
                          setIsFirstLesson(checked);
                          if (checked) {
                            // 勾选时自动填充一对一首次课范例
                            if (firstLessonTemplate) {
                              setLastFeedback(firstLessonTemplate);
                            }
                          } else {
                            // 取消勾选时清空范例内容
                            setLastFeedback("");
                          }
                        }}
                        disabled={isGenerating}
                      />
                      <Label htmlFor="isFirstLesson" className="cursor-pointer text-sm">
                        新生首次课
                      </Label>
                    </div>
                  </>
                ) : (
                  /* 小班课模式 */
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="classNumber">班号 *</Label>
                        <div className="relative">
                          <Input
                            ref={classInputRef}
                            id="classNumber"
                            placeholder="例如：26098（点击选择历史）"
                            value={classNumber}
                            onChange={(e) => setClassNumber(e.target.value)}
                            onFocus={handleClassInputFocus}
                            disabled={isGenerating}
                            autoComplete="off"
                          />
                          {showClassDropdown && recentClasses.length > 0 && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                              {recentClasses.map((c, i) => (
                                <div
                                  key={i}
                                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex justify-between items-center"
                                  onClick={() => handleSelectClass(c.classNumber)}
                                >
                                  <span className="font-medium">{c.classNumber}班</span>
                                  <span className="text-xs text-gray-400">
                                    第{c.lesson}次→{c.lesson + 1}{c.studentCount > 0 ? ` · ${c.studentCount}人` : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="lessonNumber">课次</Label>
                        <Input
                          id="lessonNumber"
                          placeholder="例如：12（自动填充）"
                          value={lessonNumber}
                          onChange={(e) => setLessonNumber(e.target.value)}
                          disabled={isGenerating}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div className="space-y-2">
                        <Label htmlFor="currentYear">年份</Label>
                        <Input
                          id="currentYear"
                          placeholder="例如：2026"
                          value={currentYear}
                          onChange={(e) => setCurrentYear(e.target.value)}
                          disabled={isGenerating}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="lessonDate">本次课日期</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="lessonDate"
                            placeholder="例如：1月15日"
                            value={lessonDate}
                            onChange={(e) => setLessonDate(e.target.value)}
                            disabled={isGenerating}
                          />
                          {lessonDate && getWeekday(lessonDate, currentYear) && (
                            <span className="text-sm text-blue-600 whitespace-nowrap">
                              ({getWeekday(lessonDate, currentYear)})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 小班课首次课勾选框 */}
                    <div className="flex items-center space-x-3 pt-2">
                      <Switch
                        id="isClassFirstLesson"
                        checked={isClassFirstLesson}
                        onCheckedChange={(checked) => {
                          setIsClassFirstLesson(checked);
                          if (checked) {
                            // 勾选时自动填充小班课首次课范例
                            if (classFirstLessonTemplate) {
                              setLastFeedback(classFirstLessonTemplate);
                            }
                          } else {
                            // 取消勾选时清空范例内容
                            setLastFeedback("");
                          }
                        }}
                        disabled={isGenerating}
                      />
                      <Label htmlFor="isClassFirstLesson" className="cursor-pointer text-sm">
                        首次课
                      </Label>
                    </div>

                    {/* 出勤学生 */}
                    <div className="space-y-3 pt-2 border-t mt-4">
                      <div className="space-y-2">
                        <Label>出勤学生姓名：</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {attendanceStudents.map((name, idx) => (
                            <Input
                              key={idx}
                              placeholder={`学生${idx + 1}`}
                              value={name}
                              onChange={(e) => {
                                const newList = [...attendanceStudents];
                                newList[idx] = e.target.value;
                                setAttendanceStudents(newList);
                              }}
                              disabled={isGenerating}
                            />
                          ))}
                        </div>
                        <p className="text-xs text-gray-500">填了名字的算出勤，空的自动忽略，无需按顺序</p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 三段文本输入区 */}
              <div className="space-y-4">
                {/* 上次反馈 / 新生模板 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="lastFeedback">
                      {(courseType === 'oneToOne' && isFirstLesson)
                        ? "新生首次课模板（可选）"
                        : (courseType === 'class' && isClassFirstLesson)
                          ? "小班课首次课范例"
                          : "上次课反馈"
                      }
                    </Label>
                    {/* 操作区 - 仅在非首次课模式下显示 */}
                    {!((courseType === 'oneToOne' && isFirstLesson) || (courseType === 'class' && isClassFirstLesson)) && (
                      <div className="flex items-center gap-3">
                        {/* 自动加载上次反馈复选框 */}
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <Checkbox
                            checked={autoLoadLastFeedback}
                            onCheckedChange={(checked) => {
                              const val = checked === true;
                              setAutoLoadLastFeedback(val);
                              if (val) {
                                setLastFeedbackFile(null);
                                setLastFeedback('');
                              } else {
                                // 取消云盘读取时，清除已加载的数据（防止幽灵数据残留）
                                autoLoadedLastFeedbackRef.current = null;
                                setLastFeedback('');
                                setLastFeedbackFile(null);
                              }
                            }}
                            disabled={isGenerating}
                          />
                          <span className="text-xs text-gray-600 flex items-center gap-1">
                            <FolderDown className="h-3 w-3" />
                            云盘读取
                          </span>
                        </label>
                        {autoLoadLastFeedback && (
                          <button
                            type="button"
                            className="text-xs text-blue-500 underline hover:text-blue-700"
                            disabled={diagnoseMutation.isPending}
                            onClick={async () => {
                              try {
                                const name = courseType === 'oneToOne' ? studentName.trim() : classNumber.trim();
                                const lesson = parseInt(lessonNumber.replace(/[^0-9]/g, ''), 10);
                                const prevLesson = lesson > 1 ? lesson - 1 : 0;
                                const prefix = courseType === 'class' ? `${classNumber.trim()}班` : name;
                                const testFile = prevLesson > 0 ? `${prefix}${prevLesson}学情反馈.md` : undefined;
                                const result = await diagnoseMutation.mutateAsync({ testFileName: testFile });
                                alert(`Google Drive 诊断结果:\n\n${result.diagnostics.join('\n')}`);
                              } catch (err: any) {
                                alert(`诊断失败: ${err.message}`);
                              }
                            }}
                          >
                            {diagnoseMutation.isPending ? '诊断中...' : '诊断连接'}
                          </button>
                        )}
                        {!autoLoadLastFeedback && (
                          <FileUploadInput
                            onFileContent={(content, fileName) => {
                              if (content && fileName) {
                                setLastFeedbackFile({ name: fileName, content });
                                setLastFeedback(content);
                              } else {
                                setLastFeedbackFile(null);
                              }
                            }}
                            disabled={isGenerating}
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {/* 非首次课 + 自动加载模式 */}
                  {autoLoadLastFeedback && !((courseType === 'oneToOne' && isFirstLesson) || (courseType === 'class' && isClassFirstLesson)) ? (
                    <div className="h-[72px] flex items-center justify-center gap-2 bg-gray-50 border border-dashed border-gray-300 rounded-md text-xs text-gray-500">
                      <FolderDown className="h-5 w-5 text-gray-400 shrink-0" />
                      {(() => {
                        const name = courseType === 'oneToOne' ? studentName.trim() : classNumber.trim();
                        const lesson = parseInt(lessonNumber.replace(/[^0-9]/g, ''), 10);
                        if (!name || isNaN(lesson) || lesson <= 1) {
                          return <span className="text-gray-400">请填写{courseType === 'oneToOne' ? '姓名' : '班号'}和课次</span>;
                        }
                        const prevLesson = lesson - 1;
                        const prefix = courseType === 'class' ? `${classNumber.trim()}班` : name;
                        return (
                          <span className="font-mono text-blue-600 text-xs">
                            {prefix}{prevLesson}.md
                          </span>
                        );
                      })()}
                    </div>
                  ) : (
                    <DebouncedTextarea
                      id="lastFeedback"
                      placeholder={(courseType === 'oneToOne' && isFirstLesson)
                        ? "如有新生模板可粘贴在此，没有可留空"
                        : (courseType === 'class' && isClassFirstLesson)
                          ? "小班课首次课范例将自动填充，也可手动修改"
                          : lastFeedbackFile
                            ? `已上传文件：${lastFeedbackFile.name}`
                            : "粘贴上次课的反馈内容..."
                      }
                      value={lastFeedback}
                      onValueChange={setLastFeedback}
                      className={`h-[120px] font-mono text-sm resize-none overflow-y-auto ${lastFeedbackFile ? 'bg-gray-50' : ''}`}
                      disabled={isGenerating || !!lastFeedbackFile}
                    />
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      {(courseType === 'oneToOne' && isFirstLesson)
                        ? "首次课可不填"
                        : (courseType === 'class' && isClassFirstLesson)
                          ? "范例将透传给AI"
                          : "对比上次课，避免重复"
                      }
                    </p>
                    {/* 更新范例按钮 - 只在首次课模式下显示 */}
                    {((courseType === 'oneToOne' && isFirstLesson) || (courseType === 'class' && isClassFirstLesson)) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isGenerating || savingConfig || !lastFeedback.trim()}
                        onClick={async () => {
                          if (!lastFeedback.trim()) {
                            alert("范例内容为空，无法保存");
                            return;
                          }
                          if (!confirm("确定要将当前内容保存为新的首次课范例吗？这将覆盖原有范例。")) {
                            return;
                          }
                          setSavingConfig(true);
                          try {
                            const key = courseType === 'oneToOne' ? 'firstLessonTemplate' : 'classFirstLessonTemplate';
                            const label = courseType === 'oneToOne' ? '一对一首次课范例' : '小班课首次课范例';
                            await updateConfigMutation.mutateAsync({ [key]: lastFeedback });
                            // 更新本地状态
                            if (courseType === 'oneToOne') {
                              setFirstLessonTemplate(lastFeedback);
                            } else {
                              setClassFirstLessonTemplate(lastFeedback);
                            }
                            await configQuery.refetch();
                            alert(`${label}已更新！`);
                          } catch (error) {
                            alert("保存失败：" + (error instanceof Error ? error.message : "未知错误"));
                          } finally {
                            setSavingConfig(false);
                          }
                        }}
                      >
                        {savingConfig ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Save className="h-3 w-3 mr-1" />
                        )}
                        更新范例
                      </Button>
                    )}
                  </div>
                </div>

                {/* 本次课笔记 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="currentNotes">本次课笔记 *</Label>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox
                          checked={autoLoadCurrentNotes}
                          onCheckedChange={(checked) => {
                            const val = checked === true;
                            setAutoLoadCurrentNotes(val);
                            if (val) {
                              setCurrentNotesFile(null);
                              setCurrentNotes('');
                            } else {
                              // 取消云盘读取时，清除已加载的数据（防止幽灵数据残留）
                              autoLoadedCurrentNotesRef.current = null;
                              setCurrentNotes('');
                              setCurrentNotesFile(null);
                            }
                          }}
                          disabled={isGenerating}
                        />
                        <span className="text-xs text-gray-600 flex items-center gap-1">
                          <FolderDown className="h-3 w-3" />
                          云盘读取
                        </span>
                      </label>
                      {!autoLoadCurrentNotes && (
                        <FileUploadInput
                          onFileContent={(content, fileName) => {
                            if (content && fileName) {
                              setCurrentNotesFile({ name: fileName, content });
                              setCurrentNotes(content);
                            } else {
                              setCurrentNotesFile(null);
                            }
                          }}
                          disabled={isGenerating}
                        />
                      )}
                    </div>
                  </div>
                  {autoLoadCurrentNotes ? (
                    <div className="h-[72px] flex items-center justify-center gap-2 bg-gray-50 border border-dashed border-gray-300 rounded-md text-xs text-gray-500">
                      <FolderDown className="h-5 w-5 text-gray-400 shrink-0" />
                      {(() => {
                        const rawName = courseType === 'oneToOne' ? studentName.trim() : classNumber.trim();
                        const lesson = lessonNumber.trim();
                        if (!rawName || !lesson) {
                          return <span className="text-gray-400">请填写{courseType === 'oneToOne' ? '姓名' : '班号'}和课次</span>;
                        }
                        const displayName = courseType === 'class' ? `${rawName}班` : rawName;
                        return (
                          <span className="font-mono text-blue-600 text-xs">
                            {displayName}{lesson}.docx
                          </span>
                        );
                      })()}
                    </div>
                  ) : (
                    <DebouncedTextarea
                      id="currentNotes"
                      placeholder={currentNotesFile
                        ? `已上传文件：${currentNotesFile.name}`
                        : "粘贴本次课的笔记内容..."
                      }
                      value={currentNotes}
                      onValueChange={setCurrentNotes}
                      className={`h-[120px] font-mono text-sm resize-none overflow-y-auto ${currentNotesFile ? 'bg-gray-50' : ''}`}
                      disabled={isGenerating || !!currentNotesFile}
                    />
                  )}
                  <p className="text-xs text-gray-500">
                    知识点、生词、长难句、错题等
                  </p>
                </div>

                {/* 录音转文字 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="transcript">录音转文字 *</Label>
                    <div className="flex items-center gap-3">
                      {/* 自动加载复选框 */}
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox
                          checked={autoLoadTranscript}
                          onCheckedChange={(checked) => {
                            const val = checked === true;
                            setAutoLoadTranscript(val);
                            if (val) {
                              // 启用自动加载时，清除手动上传的文件和文本
                              setTranscriptFile(null);
                              setTranscript('');
                            } else {
                              // 取消云盘读取时，清除已加载的数据（防止幽灵数据残留）
                              autoLoadedTranscriptRef.current = null;
                              setTranscript('');
                              setTranscriptFile(null);
                            }
                          }}
                          disabled={isGenerating}
                        />
                        <span className="text-xs text-gray-600 flex items-center gap-1">
                          <FolderDown className="h-3 w-3" />
                          云盘读取
                        </span>
                      </label>
                      {!autoLoadTranscript && (
                        <FileUploadInput
                          onFileContent={(content, fileName) => {
                            if (content && fileName) {
                              setTranscriptFile({ name: fileName, content });
                              setTranscript(content);
                            } else {
                              setTranscriptFile(null);
                            }
                          }}
                          disabled={isGenerating}
                        />
                      )}
                    </div>
                  </div>
                  {autoLoadTranscript ? (
                    // 自动加载模式：显示预期文件名 + 多段选项
                    <div className="space-y-2">
                      <div className="min-h-[72px] flex items-center justify-center gap-2 bg-gray-50 border border-dashed border-gray-300 rounded-md text-xs text-gray-500 p-3">
                        <FolderDown className="h-5 w-5 text-gray-400 shrink-0" />
                        {(() => {
                          const rawName = courseType === 'oneToOne' ? studentName.trim() : classNumber.trim();
                          const mmdd = getMMDD(lessonDate);
                          if (!rawName || !mmdd) {
                            return <span className="text-gray-400">请填写{courseType === 'oneToOne' ? '姓名' : '班号'}和日期</span>;
                          }
                          const displayName = courseType === 'class' ? `${rawName}班` : rawName;
                          if (multiSegment && segmentCount >= 2) {
                            // 多段模式：显示所有分段文件名
                            return (
                              <div className="flex flex-col items-center gap-0.5">
                                {Array.from({ length: segmentCount }, (_, i) => (
                                  <span key={i} className="font-mono text-blue-600 text-xs">
                                    {displayName}{mmdd}-{i + 1}.docx
                                  </span>
                                ))}
                              </div>
                            );
                          }
                          return (
                            <span className="font-mono text-blue-600 text-xs">
                              {displayName}{mmdd}.docx
                            </span>
                          );
                        })()}
                      </div>
                      {/* 多段构成选项 */}
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <Checkbox
                            checked={multiSegment}
                            onCheckedChange={(checked) => setMultiSegment(checked === true)}
                            disabled={isGenerating}
                          />
                          <span className="text-xs text-gray-600">多段构成</span>
                        </label>
                        {multiSegment && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              max={10}
                              value={segmentCount}
                              onChange={(e) => setSegmentCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 2)))}
                              className="w-12 h-6 text-xs text-center border border-gray-300 rounded px-1"
                              disabled={isGenerating}
                            />
                            <span className="text-xs text-gray-500">段</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <DebouncedTextarea
                      id="transcript"
                      placeholder={transcriptFile
                        ? `已上传文件：${transcriptFile.name}`
                        : "粘贴课堂录音的转文字内容..."
                      }
                      value={transcript}
                      onValueChange={setTranscript}
                      className={`h-[120px] font-mono text-sm resize-none overflow-y-auto ${transcriptFile ? 'bg-gray-50' : ''}`}
                      disabled={isGenerating || !!transcriptFile}
                    />
                  )}
                  <p className="text-xs text-gray-500">
                    录音转文字内容
                  </p>
                </div>
              </div>

              {/* 模型选择 + 提交按钮 */}
              {(() => {
                const presetList = modelPresets.split('\n').map(s => s.trim()).filter(Boolean);
                if (presetList.length === 0) return null;
                return (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm text-gray-500 shrink-0">模型</span>
                    <Select
                      value={apiModel || '__default__'}
                      onValueChange={(val) => {
                        const newModel = val === '__default__' ? '' : val;
                        setApiModel(newModel);
                        // 自动保存到服务器（空字符串表示恢复默认）
                        updateConfigMutation.mutate({ apiModel: newModel });
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">默认模型</SelectItem>
                        {presetList.map((model) => (
                          <SelectItem key={model} value={model}>{model}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })()}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowFeedbackPreview(!showFeedbackPreview)}
                  className="text-xs text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-0.5 shrink-0"
                >
                  <Eye className="w-3 h-3" />
                  看看发给AI什么
                </button>
                <Button
                  type="submit"
                  className="flex-1 h-11 text-base"
                  disabled={isSubmitting || isGenerating || !isFormValid}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      提交中...
                    </>
                  ) : isGenerating ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      生成中 ({currentStep}/5)
                    </>
                  ) : (
                    '开始生成'
                  )}
                </Button>
                {isGenerating && (
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-11 px-4"
                    onClick={handleStop}
                    disabled={isStopping}
                  >
                    {isStopping ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </form>

            {/* 提示词预览面板 */}
            {showFeedbackPreview && (
              <div className="mt-3 border rounded bg-gray-50 p-3 space-y-3">
                <div className="text-xs text-gray-600 space-y-1 bg-amber-50 border border-amber-200 rounded p-2">
                  <div className="font-medium text-amber-800">发送给AI的数据结构（{courseType === 'oneToOne' ? '一对一' : '小班课'}，共4个步骤并行）：</div>
                  <div>1. <b>系统提示词</b>：当前时间 + {courseType === 'oneToOne' ? '学生姓名' : '班号和出勤学生'} + 路书内容（每步不同）</div>
                  <div>2. <b>用户消息</b>：{courseType === 'oneToOne' ? '学生姓名 + 课次 + 日期' : '班号 + 出勤 + 日期'} + 上次反馈 + 本次课笔记 + 录音转文字</div>
                  <div className="text-gray-500 mt-1">
                    <b>系统提示词</b>就是给AI的"工作说明书"，4个步骤（学情反馈、复习文档、测试本、课后信息提取）各有一份说明书。
                    <b>用户消息</b>就是你填的所有内容，4个步骤都看到同样的内容，但按各自的说明书分别处理。
                  </div>
                </div>
                {feedbackPreviewQuery.isLoading ? (
                  <div className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />加载中...</div>
                ) : feedbackPreviewQuery.isError ? (
                  <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded p-2">
                    加载失败：{feedbackPreviewQuery.error?.message || '未知错误'}
                    <button className="ml-2 underline" onClick={() => feedbackPreviewQuery.refetch()}>重试</button>
                  </div>
                ) : feedbackPreviewQuery.data ? (
                  Object.entries(feedbackPreviewQuery.data).map(([step, prompt]) => (
                    <details key={step} className="group">
                      <summary className="text-xs font-medium text-blue-600 cursor-pointer hover:underline">系统提示词 - {step}</summary>
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-white p-2 rounded border max-h-48 overflow-y-auto mt-1">{prompt as string}</pre>
                    </details>
                  ))
                ) : null}
              </div>
            )}

            {/* 实时进度显示 */}
            {(isGenerating || isComplete || hasError) && (
              <div className="mt-6 space-y-4">
                {/* 进度步骤 */}
                <div className={`p-4 rounded-lg border ${
                  isComplete ? 'bg-green-50 border-green-200' :
                  hasError ? 'bg-red-50 border-red-200' :
                  'bg-blue-50 border-blue-200'
                }`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      {isGenerating ? (
                        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                      ) : isComplete ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-600" />
                      )}
                      <span className={`font-semibold ${
                        isComplete ? 'text-green-800' :
                        hasError ? 'text-red-800' :
                        'text-blue-800'
                      }`}>
                        {isGenerating ? (
                          courseType === 'oneToOne'
                            ? (isParallelPhase
                                ? `${currentGeneratingStudent} 并行生成中...`
                                : `${currentGeneratingStudent} (${currentStep}/5)`)
                            : (isClassParallelPhase
                                ? `${classNumber}班 并行生成中...`
                                : `${classNumber}班 (${currentStep}/5)`)
                        ) :
                         isComplete ? '✅ 全部完成！' :
                         '⚠️ 生成过程中出错'}
                      </span>
                    </div>
                    {(isComplete || hasError) && (
                      <Button variant="outline" size="sm" onClick={handleReset}>
                        <RefreshCw className="w-4 h-4 mr-1" />
                        重新开始
                      </Button>
                    )}
                  </div>
                  
                  {/* 显示具体错误信息 */}
                  {hasError && !isGenerating && (
                    <div className="mb-4 p-3 bg-red-100 rounded-lg border border-red-200">
                      <p className="text-sm text-red-700 font-medium">错误详情：</p>
                      <p className="text-sm text-red-600 mt-1 break-words whitespace-pre-wrap">
                        {steps.find(s => s.status === 'error')?.error || '未知错误'}
                      </p>
                    </div>
                  )}

                  {/* 统计摘要 */}
                  {(isComplete || hasError) && (
                    <div className="grid grid-cols-3 gap-2 text-sm mb-4">
                      <div className="bg-white p-2 rounded text-center">
                        <div className="text-2xl font-bold text-gray-800">5</div>
                        <div className="text-gray-500">总文件</div>
                      </div>
                      <div className="bg-white p-2 rounded text-center">
                        <div className="text-2xl font-bold text-green-600">{successCount}</div>
                        <div className="text-gray-500">成功</div>
                      </div>
                      <div className="bg-white p-2 rounded text-center">
                        <div className="text-2xl font-bold text-red-600">{errorCount}</div>
                        <div className="text-gray-500">失败</div>
                      </div>
                    </div>
                  )}

                  {/* 步骤列表 */}
                  <div className="space-y-3">
                    {steps.map((step, index) => (
                      <div key={index} className={`p-3 rounded-lg border ${
                        step.status === 'running' ? 'bg-blue-50 border-blue-200' :
                        step.status === 'success' ? 'bg-green-50 border-green-200' :
                        step.status === 'error' ? 'bg-red-50 border-red-200' :
                        step.status === 'skipped' ? 'bg-gray-50 border-gray-200' :
                        'bg-white border-gray-200'
                      }`}>
                        <div className="flex items-center gap-3">
                          <StatusIcon status={step.status} />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{step.step}. {step.name}</span>
                              {step.status === 'success' && step.message && (
                                <span className="text-xs text-green-600">{step.message}</span>
                              )}
                              {step.status === 'skipped' && (
                                <span className="text-xs text-gray-500">已跳过</span>
                              )}
                            </div>
                            {/* 运行中状态 */}
                            {step.status === 'running' && (
                              <div className="mt-1">
                                <p className="text-xs text-blue-600">
                                  {step.message}
                                  {/* 所有运行中的步骤显示实时耗时 */}
                                  {step.startTime && (
                                    <span className="ml-2 text-blue-400">
                                      (已{Math.round((Date.now() - step.startTime) / 1000)}秒)
                                    </span>
                                  )}
                                </p>
                                {step.detail && (
                                  <p className="text-xs text-blue-500 mt-0.5">{step.detail}</p>
                                )}
                                {/* 小班课气泡图进度 */}
                                {courseType === 'class' && index === 4 && bubbleChartProgress.length > 0 && (
                                  <div className="mt-2 ml-4 space-y-1">
                                    {bubbleChartProgress.map((p, pIdx) => (
                                      <div key={pIdx} className="flex items-center gap-2 text-xs">
                                        {p.status === 'pending' && <Circle className="w-3 h-3 text-gray-300" />}
                                        {p.status === 'running' && <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />}
                                        {p.status === 'success' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                                        {p.status === 'error' && <XCircle className="w-3 h-3 text-red-500" />}
                                        <span className={p.status === 'running' ? 'text-blue-600' : p.status === 'success' ? 'text-green-600' : p.status === 'error' ? 'text-red-600' : 'text-gray-500'}>
                                          {p.studentName}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {/* 成功状态 */}
                            {step.status === 'success' && (
                              <div className="mt-1">
                                {step.detail && (
                                  <p className="text-xs text-green-600">{step.detail}</p>
                                )}
                                {step.uploadResult && (
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span className="text-xs text-gray-500">{step.uploadResult.fileName}</span>
                                    {step.uploadResult.url && (
                                      <a
                                        href={step.uploadResult.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                        查看
                                      </a>
                                    )}
                                    {DOWNLOADABLE_STEPS.has(step.name) && step.uploadResult.url && extractDriveFileId(step.uploadResult.url) && (
                                      <a
                                        href={`/api/download-drive-file?fileId=${extractDriveFileId(step.uploadResult.url)}&fileName=${encodeURIComponent(step.uploadResult.fileName)}`}
                                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                      >
                                        <Download className="w-3 h-3" />
                                        下载
                                      </a>
                                    )}
                                    {step.name === '课后信息提取' && activeTaskId && (
                                      <button
                                        onClick={handleHwImport}
                                        disabled={hwImportStatus === 'loading'}
                                        className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
                                          hwImportStatus === 'success'
                                            ? 'text-gray-500 bg-gray-100 hover:bg-gray-200'
                                            : hwImportStatus === 'error'
                                              ? 'text-red-600 hover:bg-red-50'
                                              : 'text-emerald-600 hover:bg-emerald-50 hover:underline'
                                        }`}
                                      >
                                        {hwImportStatus === 'loading' && <Loader2 className="w-3 h-3 animate-spin" />}
                                        {hwImportStatus === 'success' && <CheckCircle2 className="w-3 h-3" />}
                                        {hwImportStatus === 'error' && <AlertCircle className="w-3 h-3" />}
                                        {hwImportStatus === 'idle' && <BookOpen className="w-3 h-3" />}
                                        {hwImportStatus === 'success'
                                          ? (courseType === 'class' ? `已导入(1+${attendanceStudents.filter((s: string) => s.trim()).length})` : '已导入')
                                          : hwImportStatus === 'error' ? '导入失败，点击重试'
                                          : (courseType === 'class' ? '导入学生管理(班级+学生)' : '导入学生管理')}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                            {/* 错误状态 */}
                            {step.error && (
                              <p className="text-xs text-red-600 mt-1 break-words whitespace-pre-wrap">{step.error}</p>
                            )}
                          </div>
                          {/* 重试/重做按钮 */}
                          {(step.status === 'error' || step.status === 'success') && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => retryStep(index)}
                                disabled={isGenerating}
                                className="text-xs"
                              >
                                <RefreshCw className="w-3 h-3 mr-1" />
                                {step.status === 'error' ? '重试' : '重做'}
                              </Button>
                              {/* 跳过按钮（仅步骤2-5失败时显示） */}
                              {step.status === 'error' && index > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => skipStep(index)}
                                  disabled={isGenerating}
                                  className="text-xs text-gray-500 hover:text-gray-700"
                                >
                                  <SkipForward className="w-3 h-3 mr-1" />
                                  跳过
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 文件夹链接 */}
                {isComplete && (
                  <div className="p-4 bg-white rounded-lg border">
                    <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <FolderOpen className="w-4 h-4" />
                      文件存储位置
                    </h4>
                    <p className="text-sm text-gray-600">
                      所有文件已保存到 Google Drive：
                      <br />
                      <code className="bg-gray-100 px-2 py-1 rounded text-xs mt-1 inline-block">
                        {courseType === 'oneToOne'
                          ? `${driveBasePath || 'Mac/Documents/XDF/学生档案'}/${studentName}/`
                          : `${driveBasePath || 'Mac/Documents/XDF/学生档案'}/${classNumber}班/`
                        }
                      </code>
                    </p>
                  </div>
                )}

                {/* 学情反馈结果展示和复制 */}
                {isComplete && feedbackContent && (
                  <div className="p-4 bg-white rounded-lg border">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        学情反馈内容
                      </h4>
                      <div className="flex items-center gap-2">
                        {/* 滚动按钮 */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          title="回到顶部"
                          onClick={() => {
                            if (feedbackScrollRef.current) {
                              feedbackScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                            }
                          }}
                        >
                          <ArrowUp className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          title="滚动到底部"
                          onClick={() => {
                            if (feedbackScrollRef.current) {
                              feedbackScrollRef.current.scrollTo({ top: feedbackScrollRef.current.scrollHeight, behavior: 'smooth' });
                            }
                          }}
                        >
                          <ArrowDown className="w-4 h-4" />
                        </Button>
                        {/* 复制按钮 */}
                        <Button
                          size="sm"
                          variant={feedbackCopied ? "default" : "outline"}
                          className={feedbackCopied ? "bg-green-600 hover:bg-green-700" : ""}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(feedbackContent);
                              setFeedbackCopied(true);
                            } catch (e) {
                              alert("复制失败，请手动选择复制");
                            }
                          }}
                        >
                          {feedbackCopied ? (
                            <>
                              <CheckCircle2 className="w-4 h-4 mr-1" />
                              已复制
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4 mr-1" />
                              复制学情反馈
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    <div
                      ref={feedbackScrollRef}
                      className="bg-gray-50 rounded-lg p-4 h-[120px] overflow-y-auto"
                    >
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                        {feedbackContent}
                      </pre>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      共 {feedbackContent.length} 字符
                    </p>
                  </div>
                )}

                {/* 导出日志按钮 */}
                {(hasError || isComplete) && (
                  <div className="p-4 bg-gray-50 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                          <Download className="w-4 h-4" />
                          导出日志
                        </h4>
                        <p className="text-xs text-gray-500 mt-1">
                          将本次生成的详细日志导出到Google Drive，方便排查问题
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleExportLog}
                        disabled={isExportingLog}
                      >
                        {isExportingLog ? (
                          <><Loader2 className="w-4 h-4 mr-1 animate-spin" />导出中...</>
                        ) : (
                          <><Download className="w-4 h-4 mr-1" />导出日志</>
                        )}
                      </Button>
                    </div>
                    {exportLogResult && (
                      <div className={`mt-3 p-3 rounded-lg ${exportLogResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                        <p className={`text-sm font-medium ${exportLogResult.success ? 'text-green-700' : 'text-red-700'}`}>
                          {exportLogResult.success ? '✅' : '❌'} {exportLogResult.message}
                        </p>
                        {exportLogResult.success && exportLogResult.path && (
                          <div className="mt-2 text-sm text-gray-600">
                            <p className="flex items-center gap-1">
                              <FolderOpen className="w-4 h-4" />
                              <span>路径：{exportLogResult.path}</span>
                            </p>
                            {exportLogResult.url && (
                              <p className="flex items-center gap-1 mt-1">
                                <ExternalLink className="w-4 h-4" />
                                <a 
                                  href={exportLogResult.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  点击打开Google Drive
                                </a>
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 提示信息 */}
                {isGenerating && (
                  <p className="text-xs text-gray-500 text-center">
                    每个文档独立生成，预计每个需要1-2分钟，请耐心等待...
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 任务记录 */}
        <div className="mt-4">
          <TaskHistory activeTaskId={activeTaskId} />
        </div>

        {/* 底部说明 */}
        <div className="mt-2 text-center text-xs text-gray-400">
          <p>提交后台生成，关屏/断网不影响 · 在「任务记录」查看进度</p>
        </div>
          </TabsContent>

          {/* 学生管理 Tab 内容 */}
          <TabsContent value="homework">
            <Card className="shadow-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-green-600" />
                  学生管理
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  选择学生 → 输入语音转文字 → AI结构化处理 → 确认入库
                </CardDescription>
              </CardHeader>
              <CardContent>
                <HomeworkManagement />
              </CardContent>
            </Card>
          </TabsContent>

          {/* 作业批改 Tab 内容 */}
          <TabsContent value="correction">
            <Card className="shadow-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PenLine className="w-5 h-5 text-purple-600" />
                  作业批改
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  选择学生 → 选择批改类型 → 输入/上传作业 → AI批改 → 自动更新学生状态
                </CardDescription>
              </CardHeader>
              <CardContent>
                <HomeworkCorrection />
              </CardContent>
            </Card>
          </TabsContent>

          {/* 批量处理 Tab 内容 */}
          <TabsContent value="batch">
            <BatchProcess />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
