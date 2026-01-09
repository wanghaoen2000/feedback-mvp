import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { trpc } from "@/lib/trpc";
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
  Settings,
  ChevronDown,
  ChevronRight,
  Save,
  Square,
  Download,
  Search,
  MinusCircle,
  Cloud,
  Users
} from "lucide-react";

// 步骤状态类型
interface StepStatus {
  step: number;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
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
    default:
      return <Circle className="w-5 h-5 text-gray-300" />;
  }
}

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

export default function Home() {
  // 课程类型：'oneToOne' 或 'class'
  const [courseType, setCourseType] = useState<'oneToOne' | 'class'>('oneToOne');
  
  // 基本信息（一对一）
  const [studentName, setStudentName] = useState("");
  const [lessonNumber, setLessonNumber] = useState("");
  const [lessonDate, setLessonDate] = useState(""); // 本次课日期，如"1月5日"
  const [currentYear, setCurrentYear] = useState("2026"); // 年份
  
  // 小班课特有字段
  const [classNumber, setClassNumber] = useState(""); // 班号
  const [attendanceCount, setAttendanceCount] = useState(2); // 出勤学生数
  const [attendanceStudents, setAttendanceStudents] = useState<string[]>(['', '']); // 出勤学生名单
  
  // 三段文本
  const [lastFeedback, setLastFeedback] = useState("");
  const [currentNotes, setCurrentNotes] = useState("");
  const [transcript, setTranscript] = useState("");
  
  // 特殊选项
  const [isFirstLesson, setIsFirstLesson] = useState(false);
  const [specialRequirements, setSpecialRequirements] = useState("");

  // 高级设置
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiModel, setApiModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [roadmap, setRoadmap] = useState(""); // V9路书内容（一对一）
  const [roadmapClass, setRoadmapClass] = useState(""); // 小班课路书内容
  const [driveBasePath, setDriveBasePath] = useState(""); // Google Drive存储根路径
  const [configLoaded, setConfigLoaded] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [steps, setSteps] = useState<StepStatus[]>(initialSteps);
  const [currentStep, setCurrentStep] = useState(0);
  const [feedbackContent, setFeedbackContent] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isStopping, setIsStopping] = useState(false); // 是否正在停止
  const [currentGeneratingStudent, setCurrentGeneratingStudent] = useState<string | null>(null); // 当前正在生成的学生名
  
  // 小班课生成状态
  const [classFeedbacks, setClassFeedbacks] = useState<{studentName: string; feedback: string}[]>([]); // 各学生的学情反馈
  const [bubbleChartProgress, setBubbleChartProgress] = useState<{studentName: string; status: 'pending' | 'running' | 'success' | 'error'}[]>([]); // 气泡图生成进度
  const [isExportingLog, setIsExportingLog] = useState(false); // 是否正在导出日志
  const [exportLogResult, setExportLogResult] = useState<{
    success: boolean;
    message: string;
    path?: string;
    url?: string;
  } | null>(null); // 导出结果
  const abortControllerRef = useRef<AbortController | null>(null); // 用于取消请求
  
  // Google Drive OAuth状态
  const [gdriveStatus, setGdriveStatus] = useState<{
    connected: boolean;
    loading: boolean;
  }>({ connected: false, loading: true });
  const [isConnectingGdrive, setIsConnectingGdrive] = useState(false);
  const [isDisconnectingGdrive, setIsDisconnectingGdrive] = useState(false);
  
  // 系统自检状态
  const [isChecking, setIsChecking] = useState(false);
  const [checkResults, setCheckResults] = useState<{
    name: string;
    status: 'success' | 'error' | 'skipped' | 'pending';
    message: string;
    suggestion?: string;
  }[]>([]);
  const [checkSummary, setCheckSummary] = useState<{
    passed: number;
    total: number;
    allPassed: boolean;
  } | null>(null);

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
  const systemCheckMutation = trpc.feedback.systemCheck.useMutation();
  
  // 小班课 mutations
  const generateClassFeedbackMutation = trpc.feedback.generateClassFeedback.useMutation();
  const generateClassReviewMutation = trpc.feedback.generateClassReview.useMutation();
  const generateClassTestMutation = trpc.feedback.generateClassTest.useMutation();
  const generateClassExtractionMutation = trpc.feedback.generateClassExtraction.useMutation();
  const generateClassBubbleChartMutation = trpc.feedback.generateClassBubbleChart.useMutation();
  const uploadClassFileMutation = trpc.feedback.uploadClassFile.useMutation();
  
  // Google Drive OAuth
  const gdriveStatusQuery = trpc.feedback.googleAuthStatus.useQuery();
  const gdriveAuthUrlQuery = trpc.feedback.googleAuthUrl.useQuery();
  const gdriveDisconnectMutation = trpc.feedback.googleAuthDisconnect.useMutation();
  const gdriveCallbackMutation = trpc.feedback.googleAuthCallback.useMutation();

  // 加载配置
  useEffect(() => {
    if (configQuery.data && !configLoaded) {
      setApiModel(configQuery.data.apiModel);
      setApiKey(configQuery.data.apiKey);
      setApiUrl(configQuery.data.apiUrl);
      setCurrentYear(configQuery.data.currentYear || "2026");
      setRoadmap(configQuery.data.roadmap || "");
      setRoadmapClass(configQuery.data.roadmapClass || "");
      setDriveBasePath(configQuery.data.driveBasePath || "Mac/Documents/XDF/学生档案");
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
        roadmapClass: roadmapClass || undefined,
        driveBasePath: driveBasePath.trim() || undefined,
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
    setCurrentGeneratingStudent(studentName.trim()); // 设置当前生成的学生名
    setSteps(initialSteps);
    setCurrentStep(1);

    let content = "";
    let date = "";
    let stopped = false;

    // 创建学生信息快照（并发安全，防止生成过程中输入框被修改）
    const studentSnapshot = {
      studentName: studentName.trim(),
      lessonNumber: lessonNumber.trim(),
      lastFeedback: lastFeedback.trim(),
      currentNotes: currentNotes.trim(),
      transcript: transcript.trim(),
      isFirstLesson,
      specialRequirements: specialRequirements.trim(),
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
      // 步骤1: 生成学情反馈
      checkAborted();
      const step1Start = Date.now();
      updateStep(0, { 
        status: 'running', 
        message: '正在调用AI生成学情反馈...',
        detail: '连接AI服务中，预计1-2分钟',
        startTime: step1Start
      });
      const step1Result = await generateFeedbackMutation.mutateAsync({
        ...studentSnapshot,
        ...configSnapshot,
      });
      
      content = step1Result.feedbackContent;
      date = step1Result.dateStr;
      setFeedbackContent(content);
      setDateStr(date);
      const step1End = Date.now();
      updateStep(0, { 
        status: 'success', 
        message: `生成完成 (耗时${Math.round((step1End - step1Start) / 1000)}秒)`,
        detail: `学情反馈已生成，共${content.length}字`,
        endTime: step1End,
        uploadResult: step1Result.uploadResult
      });
      setCurrentStep(2);

      // 步骤2: 生成复习文档
      checkAborted();
      const step2Start = Date.now();
      updateStep(1, { 
        status: 'running', 
        message: '正在生成复习文档...',
        detail: '提取生词和错题，生成Word文档',
        startTime: step2Start
      });
      const step2Result = await generateReviewMutation.mutateAsync({
        studentName: studentSnapshot.studentName,
        dateStr: date,
        feedbackContent: content,
        ...configSnapshot,
      });
      const step2End = Date.now();
      updateStep(1, { 
        status: 'success', 
        message: `生成完成 (耗时${Math.round((step2End - step2Start) / 1000)}秒)`,
        detail: '复习文档已上传到Google Drive',
        endTime: step2End,
        uploadResult: step2Result.uploadResult
      });
      setCurrentStep(3);

      // 步骤3: 生成测试本
      checkAborted();
      const step3Start = Date.now();
      updateStep(2, { 
        status: 'running', 
        message: '正在生成测试本...',
        detail: '生成学生自测文档',
        startTime: step3Start
      });
      const step3Result = await generateTestMutation.mutateAsync({
        studentName: studentSnapshot.studentName,
        dateStr: date,
        feedbackContent: content,
        ...configSnapshot,
      });
      const step3End = Date.now();
      updateStep(2, { 
        status: 'success', 
        message: `生成完成 (耗时${Math.round((step3End - step3Start) / 1000)}秒)`,
        detail: '测试本已上传到Google Drive',
        endTime: step3End,
        uploadResult: step3Result.uploadResult
      });
      setCurrentStep(4);

      // 步骤4: 生成课后信息提取
      checkAborted();
      const step4Start = Date.now();
      updateStep(3, { 
        status: 'running', 
        message: '正在生成课后信息提取...',
        detail: '提取课后作业和下次课信息',
        startTime: step4Start
      });
      const step4Result = await generateExtractionMutation.mutateAsync({
        studentName: studentSnapshot.studentName,
        dateStr: date,
        feedbackContent: content,
        ...configSnapshot,
      });
      const step4End = Date.now();
      updateStep(3, { 
        status: 'success', 
        message: `生成完成 (耗时${Math.round((step4End - step4Start) / 1000)}秒)`,
        detail: '课后信息已上传到Google Drive',
        endTime: step4End,
        uploadResult: step4Result.uploadResult
      });
      setCurrentStep(5);

      // 步骤5: 生成气泡图
      checkAborted();
      const step5Start = Date.now();
      updateStep(4, { 
        status: 'running', 
        message: '正在生成气泡图...',
        detail: 'AI正在生成SVG图形',
        startTime: step5Start
      });
      
      // 步骤5a: 后端生成SVG
      const step5Result = await generateBubbleChartMutation.mutateAsync({
        studentName: studentSnapshot.studentName,
        dateStr: date,
        lessonNumber: studentSnapshot.lessonNumber,
        feedbackContent: content,
        ...configSnapshot,
      });
      
      checkAborted();
      updateStep(4, { 
        status: 'running', 
        message: '正在转换并上传...',
        detail: '前端转换SVG为PNG并上传',
        startTime: step5Start
      });
      
      // 步骤5b: 前端将SVG转换为PNG
      const svgContent = step5Result.svgContent;
      const pngBase64 = await svgToPngBase64(svgContent);
      
      // 步骤5c: 上传PNG到Google Drive
      const uploadResult = await uploadBubbleChartMutation.mutateAsync({
        studentName: studentSnapshot.studentName,
        dateStr: date,
        pngBase64,
        driveBasePath: configSnapshot.driveBasePath,
      });
      
      const step5End = Date.now();
      updateStep(4, { 
        status: 'success', 
        message: `生成完成 (耗时${Math.round((step5End - step5Start) / 1000)}秒)`,
        detail: '气泡图已上传到Google Drive',
        endTime: step5End,
        uploadResult: uploadResult.uploadResult
      });

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
          displayError = 'API密钥无效，请在高级设置中检查密钥';
        } else if (rawMessage.includes('403')) {
          displayError = 'API访问被拒绝，可能是余额不足或密钥权限问题';
        } else if (rawMessage.includes('429') || rawMessage.includes('rate limit')) {
          displayError = '请求太频繁，请稍等1分钟后重试';
        } else if (rawMessage.includes('timeout') || rawMessage.includes('超时')) {
          displayError = '请求超时，可能是网络问题或AI响应太慢，请稍后重试';
        }
      }
      
      // 标记当前步骤为失败或取消
      const failedStepIndex = currentStep - 1;
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
    isFirstLesson, specialRequirements, apiModel, apiKey, apiUrl,
    generateFeedbackMutation, generateReviewMutation, generateTestMutation,
    generateExtractionMutation, generateBubbleChartMutation, updateStep, currentStep
  ]);

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
    const validStudents = attendanceStudents.filter((s: string) => s.trim());
    const classSnapshot = {
      classNumber: classNumber.trim(),
      lessonNumber: lessonNumber.trim(),
      lessonDate: lessonDate.trim(),
      attendanceStudents: validStudents,
      lastFeedback: lastFeedback.trim(),
      currentNotes: currentNotes.trim(),
      transcript: transcript.trim(),
      specialRequirements: specialRequirements.trim(),
    };

    // 配置快照
    const configSnapshot = {
      apiModel: apiModel.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      apiUrl: apiUrl.trim() || undefined,
      roadmapClass: roadmapClass || undefined,
      driveBasePath: driveBasePath.trim() || undefined,
    };

    // 检查是否已停止
    const checkAborted = () => {
      if (abortControllerRef.current?.signal.aborted) {
        throw new Error('用户已取消生成');
      }
    };

    let allFeedbacks: {studentName: string; feedback: string}[] = [];
    let combinedFeedback = '';
    let extractedDate = '';

    try {
      // 步骤1: 为每个学生生成学情反馈
      checkAborted();
      const step1Start = Date.now();
      updateStep(0, { status: 'running', message: `正在为 ${validStudents.length} 个学生生成学情反馈...` });
      
      const feedbackResult = await generateClassFeedbackMutation.mutateAsync({
        ...classSnapshot,
        ...configSnapshot,
      });
      
      if (!feedbackResult.success || !feedbackResult.feedbacks) {
        throw new Error('学情反馈生成失败');
      }
      
      allFeedbacks = feedbackResult.feedbacks;
      setClassFeedbacks(allFeedbacks);
      
      // 合并所有学情反馈
      combinedFeedback = allFeedbacks.map(f => `## ${f.studentName}

${f.feedback}`).join('\n\n---\n\n');
      
      // 从第一个反馈中提取日期
      const dateMatch = allFeedbacks[0]?.feedback.match(/(\d{1,2}月\d{1,2}日?)/);
      extractedDate = dateMatch ? dateMatch[1] : classSnapshot.lessonDate || new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
      setDateStr(extractedDate);
      
      // 上传每个学生的学情反馈
      for (const fb of allFeedbacks) {
        await uploadClassFileMutation.mutateAsync({
          classNumber: classSnapshot.classNumber,
          dateStr: extractedDate,
          fileType: 'feedback',
          studentName: fb.studentName,
          content: fb.feedback,
          driveBasePath: configSnapshot.driveBasePath,
        });
      }
      
      const step1Time = Math.round((Date.now() - step1Start) / 1000);
      updateStep(0, { status: 'success', message: `已生成 ${allFeedbacks.length} 份学情反馈 (${step1Time}秒)` });
      setCurrentStep(2);

      // 步骤2: 生成复习文档
      checkAborted();
      const step2Start = Date.now();
      updateStep(1, { status: 'running', message: '正在生成复习文档...' });
      
      const reviewResult = await generateClassReviewMutation.mutateAsync({
        classNumber: classSnapshot.classNumber,
        lessonNumber: classSnapshot.lessonNumber,
        lessonDate: extractedDate,
        attendanceStudents: classSnapshot.attendanceStudents,
        currentNotes: classSnapshot.currentNotes,
        combinedFeedback,
        ...configSnapshot,
      });
      
      if (!reviewResult.success) {
        throw new Error('复习文档生成失败');
      }
      
      // 上传复习文档
      await uploadClassFileMutation.mutateAsync({
        classNumber: classSnapshot.classNumber,
        dateStr: extractedDate,
        fileType: 'review',
        content: reviewResult.content,
        driveBasePath: configSnapshot.driveBasePath,
      });
      
      const step2Time = Math.round((Date.now() - step2Start) / 1000);
      updateStep(1, { status: 'success', message: `生成完成 (${step2Time}秒)` });
      setCurrentStep(3);

      // 步骤3: 生成测试本
      checkAborted();
      const step3Start = Date.now();
      updateStep(2, { status: 'running', message: '正在生成测试本...' });
      
      const testResult = await generateClassTestMutation.mutateAsync({
        classNumber: classSnapshot.classNumber,
        lessonNumber: classSnapshot.lessonNumber,
        lessonDate: extractedDate,
        attendanceStudents: classSnapshot.attendanceStudents,
        currentNotes: classSnapshot.currentNotes,
        combinedFeedback,
        ...configSnapshot,
      });
      
      if (!testResult.success) {
        throw new Error('测试本生成失败');
      }
      
      // 上传测试本
      await uploadClassFileMutation.mutateAsync({
        classNumber: classSnapshot.classNumber,
        dateStr: extractedDate,
        fileType: 'test',
        content: testResult.content,
        driveBasePath: configSnapshot.driveBasePath,
      });
      
      const step3Time = Math.round((Date.now() - step3Start) / 1000);
      updateStep(2, { status: 'success', message: `生成完成 (${step3Time}秒)` });
      setCurrentStep(4);

      // 步骤4: 生成课后信息提取
      checkAborted();
      const step4Start = Date.now();
      updateStep(3, { status: 'running', message: '正在生成课后信息提取...' });
      
      const extractionResult = await generateClassExtractionMutation.mutateAsync({
        classNumber: classSnapshot.classNumber,
        lessonNumber: classSnapshot.lessonNumber,
        lessonDate: extractedDate,
        attendanceStudents: classSnapshot.attendanceStudents,
        combinedFeedback,
        ...configSnapshot,
      });
      
      if (!extractionResult.success) {
        throw new Error('课后信息提取生成失败');
      }
      
      // 上传课后信息提取
      await uploadClassFileMutation.mutateAsync({
        classNumber: classSnapshot.classNumber,
        dateStr: extractedDate,
        fileType: 'extraction',
        content: extractionResult.content,
        driveBasePath: configSnapshot.driveBasePath,
      });
      
      const step4Time = Math.round((Date.now() - step4Start) / 1000);
      updateStep(3, { status: 'success', message: `生成完成 (${step4Time}秒)` });
      setCurrentStep(5);

      // 步骤5: 为每个学生生成气泡图
      checkAborted();
      const step5Start = Date.now();
      updateStep(4, { status: 'running', message: `正在为 ${validStudents.length} 个学生生成气泡图...` });
      
      // 初始化气泡图进度
      const initialProgress = allFeedbacks.map(f => ({ studentName: f.studentName, status: 'pending' as const }));
      setBubbleChartProgress(initialProgress);
      
      // 串行生成每个学生的气泡图
      for (let i = 0; i < allFeedbacks.length; i++) {
        checkAborted();
        const fb = allFeedbacks[i];
        
        // 更新进度：当前学生正在生成
        setBubbleChartProgress(prev => prev.map((p, idx) => 
          idx === i ? { ...p, status: 'running' } : p
        ));
        
        try {
          // 生成 SVG
          const svgResult = await generateClassBubbleChartMutation.mutateAsync({
            studentName: fb.studentName,
            studentFeedback: fb.feedback,
            classNumber: classSnapshot.classNumber,
            dateStr: extractedDate,
            lessonNumber: classSnapshot.lessonNumber,
            ...configSnapshot,
          });
          
          if (!svgResult.success || !svgResult.svg) {
            throw new Error(`${fb.studentName} 气泡图生成失败`);
          }
          
          // 前端转换 SVG 为 PNG
          const pngBase64 = await svgToPngBase64(svgResult.svg);
          
          // 上传气泡图
          await uploadClassFileMutation.mutateAsync({
            classNumber: classSnapshot.classNumber,
            dateStr: extractedDate,
            fileType: 'bubbleChart',
            studentName: fb.studentName,
            content: pngBase64,
            driveBasePath: configSnapshot.driveBasePath,
          });
          
          // 更新进度：当前学生完成
          setBubbleChartProgress(prev => prev.map((p, idx) => 
            idx === i ? { ...p, status: 'success' } : p
          ));
        } catch (error) {
          // 更新进度：当前学生失败
          setBubbleChartProgress(prev => prev.map((p, idx) => 
            idx === i ? { ...p, status: 'error' } : p
          ));
          console.error(`${fb.studentName} 气泡图生成失败:`, error);
          // 继续生成其他学生的气泡图
        }
      }
      
      const step5Time = Math.round((Date.now() - step5Start) / 1000);
      const successCount = bubbleChartProgress.filter(p => p.status === 'success').length || allFeedbacks.length;
      updateStep(4, { status: 'success', message: `已生成 ${successCount}/${allFeedbacks.length} 个气泡图 (${step5Time}秒)` });

      // 完成
      setIsComplete(true);
      
    } catch (error: any) {
      setHasError(true);
      
      const rawMessage = error.message || '未知错误';
      let displayError = rawMessage;
      
      // 标记当前步骤为失败
      const failedStepIndex = currentStep - 1;
      if (failedStepIndex >= 0 && failedStepIndex < 5) {
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
    currentNotes, transcript, specialRequirements, apiModel, apiKey, apiUrl,
    roadmapClass, driveBasePath, generateClassFeedbackMutation, generateClassReviewMutation,
    generateClassTestMutation, generateClassExtractionMutation, generateClassBubbleChartMutation,
    uploadClassFileMutation, updateStep, currentStep
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (courseType === 'oneToOne') {
      // 一对一模式
      if (!studentName.trim() || !currentNotes.trim() || !transcript.trim()) {
        return;
      }
      await runGeneration();
    } else {
      // 小班课模式
      const validStudents = attendanceStudents.filter((s: string) => s.trim());
      if (!classNumber.trim() || validStudents.length === 0 || !currentNotes.trim() || !transcript.trim()) {
        return;
      }
      await runClassGeneration();
    }
  };

  // 单步重试函数
  const retryStep = useCallback(async (stepIndex: number) => {
    if (isGenerating) return;
    
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
      driveBasePath: driveBasePath.trim() || undefined,
    };

    try {
      let result;
      
      switch (stepIndex) {
        case 0: // 学情反馈
          result = await generateFeedbackMutation.mutateAsync({
            studentName: studentName.trim(),
            lessonNumber: lessonNumber.trim(),
            lastFeedback: lastFeedback.trim(),
            currentNotes: currentNotes.trim(),
            transcript: transcript.trim(),
            isFirstLesson,
            specialRequirements: specialRequirements.trim(),
            ...configSnapshot,
          });
          setFeedbackContent(result.feedbackContent);
          setDateStr(result.dateStr);
          updateStep(0, { status: 'success', message: '生成完成', uploadResult: result.uploadResult });
          break;

        case 1: // 复习文档
          if (!feedbackContent || !dateStr) {
            throw new Error('请先生成学情反馈');
          }
          result = await generateReviewMutation.mutateAsync({
            studentName: studentName.trim(),
            dateStr,
            feedbackContent,
            ...configSnapshot,
          });
          updateStep(1, { status: 'success', message: '生成完成', uploadResult: result.uploadResult });
          break;

        case 2: // 测试本
          if (!feedbackContent || !dateStr) {
            throw new Error('请先生成学情反馈');
          }
          result = await generateTestMutation.mutateAsync({
            studentName: studentName.trim(),
            dateStr,
            feedbackContent,
            ...configSnapshot,
          });
          updateStep(2, { status: 'success', message: '生成完成', uploadResult: result.uploadResult });
          break;

        case 3: // 课后信息提取
          if (!feedbackContent || !dateStr) {
            throw new Error('请先生成学情反馈');
          }
          result = await generateExtractionMutation.mutateAsync({
            studentName: studentName.trim(),
            dateStr,
            feedbackContent,
            ...configSnapshot,
          });
          updateStep(3, { status: 'success', message: '生成完成', uploadResult: result.uploadResult });
          break;

        case 4: // 气泡图
          if (!feedbackContent || !dateStr) {
            throw new Error('请先生成学情反馈');
          }
          // 步骤5a: 后端生成SVG
          updateStep(4, { status: 'running', message: '正在生成SVG...' });
          result = await generateBubbleChartMutation.mutateAsync({
            studentName: studentName.trim(),
            dateStr,
            lessonNumber: lessonNumber.trim(),
            feedbackContent,
            ...configSnapshot,
          });
          
          // 步骤5b: 前端转换SVG为PNG
          updateStep(4, { status: 'running', message: '正在转换并上传...' });
          const svgContent = result.svgContent;
          const pngBase64 = await svgToPngBase64(svgContent);
          
          // 步骤5c: 上传PNG到Google Drive
          const uploadResult = await uploadBubbleChartMutation.mutateAsync({
            studentName: studentName.trim(),
            dateStr,
            pngBase64,
            driveBasePath: configSnapshot.driveBasePath,
          });
          
          updateStep(4, { status: 'success', message: '生成完成', uploadResult: uploadResult.uploadResult });
          break;
      }

      // 检查是否所有步骤都成功
      const allSuccess = steps.every((s, i) => i === stepIndex || s.status === 'success');
      if (allSuccess) {
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
          displayError = 'API密钥无效，请在高级设置中检查密钥';
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
    lessonDate, currentYear, lastFeedback, currentNotes, transcript, isFirstLesson, specialRequirements,
    apiModel, apiKey, apiUrl, updateStep,
    generateFeedbackMutation, generateReviewMutation, generateTestMutation,
    generateExtractionMutation, generateBubbleChartMutation
  ]);

  const handleReset = () => {
    setSteps(initialSteps);
    setCurrentStep(0);
    setFeedbackContent("");
    setDateStr("");
    setIsComplete(false);
    setHasError(false);
    setExportLogResult(null);
  };

  // 导出日志到Google Drive
  const handleExportLog = async () => {
    setIsExportingLog(true);
    setExportLogResult(null);
    try {
      // 传入当前学生名，确保导出的是正确学生的日志
      const result = await exportLogMutation.mutateAsync({ studentName: studentName.trim() || undefined });
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

  // 系统自检
  const handleSystemCheck = async () => {
    setIsChecking(true);
    setCheckResults([]);
    setCheckSummary(null);
    
    try {
      const result = await systemCheckMutation.mutateAsync();
      if (result.success) {
        setCheckResults(result.results);
        setCheckSummary({
          passed: result.passed,
          total: result.total,
          allPassed: result.allPassed,
        });
      } else {
        setCheckResults([{
          name: '系统错误',
          status: 'error',
          message: result.error || '自检失败',
        }]);
      }
    } catch (error) {
      setCheckResults([{
        name: '系统错误',
        status: 'error',
        message: `自检失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }]);
    } finally {
      setIsChecking(false);
    }
  };

  // Google Drive 连接处理
  const handleConnectGdrive = async () => {
    setIsConnectingGdrive(true);
    try {
      if (gdriveAuthUrlQuery.data?.url) {
        // 打开Google授权页面
        window.open(gdriveAuthUrlQuery.data.url, '_blank');
      }
    } catch (error) {
      console.error('Failed to get auth URL:', error);
    } finally {
      setIsConnectingGdrive(false);
    }
  };

  const handleDisconnectGdrive = async () => {
    if (!confirm('确定要断开Google Drive连接吗？断开后需要重新授权才能上传文件。')) {
      return;
    }
    setIsDisconnectingGdrive(true);
    try {
      await gdriveDisconnectMutation.mutateAsync();
      await gdriveStatusQuery.refetch();
    } catch (error) {
      console.error('Failed to disconnect:', error);
    } finally {
      setIsDisconnectingGdrive(false);
    }
  };

  // 处理OAuth回调（从授权页面返回后）
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      // 清除URL中的code参数
      window.history.replaceState({}, '', window.location.pathname);
      // 处理授权回调
      gdriveCallbackMutation.mutateAsync({ code }).then(() => {
        gdriveStatusQuery.refetch();
        alert('Google Drive 授权成功！');
      }).catch((error) => {
        alert('授权失败: ' + (error instanceof Error ? error.message : '未知错误'));
      });
    }
  }, []);

  // 表单验证：根据课程类型检查不同的必填字段
  const isFormValid = courseType === 'oneToOne'
    ? (studentName.trim() && currentNotes.trim() && transcript.trim())
    : (classNumber.trim() && attendanceStudents.some((s: string) => s.trim()) && currentNotes.trim() && transcript.trim());

  // 计算成功数量
  const successCount = steps.filter(s => s.status === 'success').length;
  const errorCount = steps.filter(s => s.status === 'error').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">托福阅读学情反馈系统</h1>
          <p className="text-gray-600">输入课堂信息，自动生成5个文档并存储到Google Drive</p>
        </div>

        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              课堂信息录入
            </CardTitle>
            <CardDescription>
              填写学生信息和课堂内容，系统将自动生成学情反馈、复习文档、测试本、课后信息提取和气泡图
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
                        <Input
                          id="studentName"
                          placeholder="例如：张三"
                          value={studentName}
                          onChange={(e) => setStudentName(e.target.value)}
                          disabled={isGenerating}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="lessonNumber">课次</Label>
                        <Input
                          id="lessonNumber"
                          placeholder="例如：第10次课"
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
                        <p className="text-xs text-gray-500">默认2026，修改后在高级设置中保存可持久化</p>
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
                        <p className="text-xs text-gray-500">可留空，AI会从笔记中自动提取</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 pt-2">
                      <Switch
                        id="isFirstLesson"
                        checked={isFirstLesson}
                        onCheckedChange={setIsFirstLesson}
                        disabled={isGenerating}
                      />
                      <Label htmlFor="isFirstLesson" className="cursor-pointer">
                        新生首次课（勾选后“上次反馈”将替换为新生模板）
                      </Label>
                    </div>
                  </>
                ) : (
                  /* 小班课模式 */
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="classNumber">班号 *</Label>
                        <Input
                          id="classNumber"
                          placeholder="例如：26098班"
                          value={classNumber}
                          onChange={(e) => setClassNumber(e.target.value)}
                          disabled={isGenerating}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="lessonNumber">课次</Label>
                        <Input
                          id="lessonNumber"
                          placeholder="例如：第10次课"
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

                    {/* 出勤学生 */}
                    <div className="space-y-3 pt-2 border-t mt-4">
                      <div className="flex items-center gap-4">
                        <Label>出勤学生数：</Label>
                        <Select
                          value={String(attendanceCount)}
                          onValueChange={(v) => {
                            const count = parseInt(v);
                            setAttendanceCount(count);
                            // 调整学生名单数组长度
                            setAttendanceStudents(prev => {
                              const newList = [...prev];
                              while (newList.length < count) newList.push('');
                              return newList.slice(0, count);
                            });
                          }}
                          disabled={isGenerating}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[2,3,4,5,6,7,8].map(n => (
                              <SelectItem key={n} value={String(n)}>{n}人</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      
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
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 三段文本输入区 */}
              <div className="space-y-4">
                {/* 上次反馈 / 新生模板 */}
                <div className="space-y-2">
                  <Label htmlFor="lastFeedback">
                    {courseType === 'oneToOne' && isFirstLesson ? "新生首次课模板（可选）" : "上次课反馈"}
                  </Label>
                  <Textarea
                    id="lastFeedback"
                    placeholder={courseType === 'oneToOne' && isFirstLesson 
                      ? "如有新生模板可粘贴在此，没有可留空" 
                      : "粘贴上次课的反馈内容..."
                    }
                    value={lastFeedback}
                    onChange={(e) => setLastFeedback(e.target.value)}
                    className="h-[120px] font-mono text-sm resize-none overflow-y-auto"
                    disabled={isGenerating}
                  />
                  <p className="text-xs text-gray-500">
                    {courseType === 'oneToOne' && isFirstLesson 
                      ? "新生首次课可以不填此项" 
                      : "用于对比上次课内容，避免重复"
                    }
                  </p>
                </div>

                {/* 本次课笔记 */}
                <div className="space-y-2">
                  <Label htmlFor="currentNotes">本次课笔记 *</Label>
                  <Textarea
                    id="currentNotes"
                    placeholder="粘贴本次课的笔记内容...（请在笔记开头包含日期信息，AI会自动识别）"
                    value={currentNotes}
                    onChange={(e) => setCurrentNotes(e.target.value)}
                    className="h-[120px] font-mono text-sm resize-none overflow-y-auto"
                    disabled={isGenerating}
                  />
                  <p className="text-xs text-gray-500">
                    包含课堂讲解的知识点、生词、长难句、错题等
                  </p>
                </div>

                {/* 录音转文字 */}
                <div className="space-y-2">
                  <Label htmlFor="transcript">录音转文字 *</Label>
                  <Textarea
                    id="transcript"
                    placeholder="粘贴课堂录音的转文字内容..."
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    className="h-[120px] font-mono text-sm resize-none overflow-y-auto"
                    disabled={isGenerating}
                  />
                  <p className="text-xs text-gray-500">
                    课堂录音转换的文字，用于提取课堂细节和互动内容
                  </p>
                </div>
              </div>

              {/* 特殊要求 */}
              <div className="space-y-2">
                <Label htmlFor="specialRequirements">特殊要求（可选）</Label>
                <Textarea
                  id="specialRequirements"
                  placeholder="如有特殊要求可在此说明，例如：本次需要特别强调某个知识点、调整存储路径等..."
                  value={specialRequirements}
                  onChange={(e) => setSpecialRequirements(e.target.value)}
                  className="h-[120px] resize-none overflow-y-auto"
                  disabled={isGenerating}
                />
              </div>

              {/* 高级设置（折叠） */}
              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between p-4 bg-gray-50 hover:bg-gray-100">
                    <span className="flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      高级设置（API配置）
                    </span>
                    {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="bg-gray-50 p-4 rounded-b-lg space-y-4 border-t">
                    <p className="text-sm text-gray-600 mb-4">
                      修改后点击"保存配置"，下次打开网页会自动使用新配置。留空则使用默认值。
                    </p>
                    
                    <div className="space-y-2">
                      <Label htmlFor="apiModel">模型名称</Label>
                      <Input
                        id="apiModel"
                        placeholder="例如：claude-sonnet-4-5-20250929"
                        value={apiModel}
                        onChange={(e) => setApiModel(e.target.value)}
                        disabled={isGenerating}
                      />
                      <p className="text-xs text-gray-500">
                        直接复制API供应商提供的模型名称，不需要做任何修改
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="apiKey">API密钥</Label>
                      <Input
                        id="apiKey"
                        type="password"
                        placeholder="sk-xxxxxxxx"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        disabled={isGenerating}
                      />
                      <p className="text-xs text-gray-500">
                        留空则使用默认密钥
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="apiUrl">API地址</Label>
                      <Input
                        id="apiUrl"
                        placeholder="例如：https://api.whatai.cc/v1"
                        value={apiUrl}
                        onChange={(e) => setApiUrl(e.target.value)}
                        disabled={isGenerating}
                      />
                      <p className="text-xs text-gray-500">
                        留空则使用默认地址
                      </p>
                    </div>

                    {/* Google Drive 存储路径 */}
                    <div className="border-t pt-4 mt-4">
                      <div className="space-y-2">
                        <Label htmlFor="driveBasePath">Google Drive 存储路径</Label>
                        <Input
                          id="driveBasePath"
                          placeholder="例如：Mac/Documents/XDF/学生档案"
                          value={driveBasePath}
                          onChange={(e) => setDriveBasePath(e.target.value)}
                          disabled={isGenerating}
                        />
                        <p className="text-xs text-gray-500">
                          设置文档存储的根路径。学生文件夹将自动创建在此路径下。
                          例如：设置为 "Mac/Documents/XDF/学生档案" 后，张三的文档会存储到 "Mac/Documents/XDF/学生档案/张三/" 下。
                        </p>
                      </div>
                    </div>

                    {/* 路书管理 */}
                    <div className="border-t pt-4 mt-4 space-y-4">
                      {/* 一对一路书 */}
                      <div className="space-y-2">
                        <Label htmlFor="roadmap">V9路书内容（一对一）（可选）</Label>
                        <Textarea
                          id="roadmap"
                          placeholder="粘贴更新后的V9路书内容...留空则使用系统内置的路书"
                          value={roadmap}
                          onChange={(e) => setRoadmap(e.target.value)}
                          className="h-[120px] font-mono text-xs resize-none overflow-y-auto"
                          disabled={isGenerating}
                        />
                        <p className="text-xs text-gray-500">
                          用于一对一课程的路书。留空则使用系统内置的默认路书。
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setRoadmap("")}
                          disabled={isGenerating || !roadmap}
                        >
                          清空路书
                        </Button>
                      </div>
                      
                      {/* 小班课路书 */}
                      <div className="space-y-2">
                        <Label htmlFor="roadmapClass">小班课路书内容（可选）</Label>
                        <Textarea
                          id="roadmapClass"
                          placeholder="粘贴小班课路书内容...留空则使用系统内置的路书"
                          value={roadmapClass}
                          onChange={(e) => setRoadmapClass(e.target.value)}
                          className="h-[120px] font-mono text-xs resize-none overflow-y-auto"
                          disabled={isGenerating}
                        />
                        <p className="text-xs text-gray-500">
                          用于小班课的路书。留空则使用系统内置的默认路书。
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setRoadmapClass("")}
                          disabled={isGenerating || !roadmapClass}
                        >
                          清空路书
                        </Button>
                      </div>
                    </div>
                    
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={handleSaveConfig}
                      disabled={savingConfig || isGenerating}
                      className="w-full"
                    >
                      {savingConfig ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          保存中...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          保存配置
                        </>
                      )}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Google Drive 连接状态 */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-gray-600" />
                    <span className="font-medium">Google Drive 连接</span>
                    {gdriveStatusQuery.isLoading ? (
                      <span className="text-sm text-gray-500">(检查中...)</span>
                    ) : gdriveStatusQuery.data?.authorized ? (
                      <span className="text-sm text-green-600">(✅ 已连接)</span>
                    ) : (
                      <span className="text-sm text-orange-600">(❌ 未连接)</span>
                    )}
                  </div>
                  {gdriveStatusQuery.data?.authorized ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleDisconnectGdrive}
                      disabled={isDisconnectingGdrive || isGenerating}
                      className="text-red-600 hover:text-red-700"
                    >
                      {isDisconnectingGdrive ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          断开中...
                        </>
                      ) : (
                        '断开连接'
                      )}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleConnectGdrive}
                      disabled={isConnectingGdrive || isGenerating || gdriveStatusQuery.isLoading}
                    >
                      {isConnectingGdrive ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          连接中...
                        </>
                      ) : (
                        '连接 Google Drive'
                      )}
                    </Button>
                  )}
                </div>
                {gdriveStatusQuery.data?.expiresAt && (
                  <div className="border-t p-3 text-sm text-gray-600">
                    授权有效期至：{new Date(gdriveStatusQuery.data.expiresAt).toLocaleString('zh-CN')}
                  </div>
                )}
                {/* 显示回调地址，方便用户复制添加到 Google Cloud Console */}
                {gdriveAuthUrlQuery.data?.redirectUri && (
                  <div className="border-t p-3">
                    <div className="text-sm text-gray-600 mb-2">
                      <span className="font-medium">回调地址</span>（需添加到 Google Cloud Console 的 Authorized redirect URIs）：
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono text-gray-800 break-all">
                        {gdriveAuthUrlQuery.data.redirectUri}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(gdriveAuthUrlQuery.data?.redirectUri || '');
                          alert('已复制到剪贴板！');
                        }}
                      >
                        复制
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* 系统自检 */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-gray-600" />
                    <span className="font-medium">系统自检</span>
                    {checkSummary && (
                      <span className={`text-sm ${checkSummary.allPassed ? 'text-green-600' : 'text-orange-600'}`}>
                        ({checkSummary.passed}/{checkSummary.total} 通过)
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSystemCheck}
                    disabled={isChecking || isGenerating}
                  >
                    {isChecking ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        检测中...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        开始检测
                      </>
                    )}
                  </Button>
                </div>
                
                {checkResults.length > 0 && (
                  <div className="border-t divide-y">
                    {checkResults.map((result, index) => (
                      <div key={index} className="p-3 flex items-start gap-3">
                        <div className="mt-0.5">
                          {result.status === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                          {result.status === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
                          {result.status === 'skipped' && <MinusCircle className="w-5 h-5 text-gray-400" />}
                          {result.status === 'pending' && <Circle className="w-5 h-5 text-gray-300" />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{result.name}</span>
                            <span className={`text-sm ${
                              result.status === 'success' ? 'text-green-600' :
                              result.status === 'error' ? 'text-red-600' :
                              'text-gray-500'
                            }`}>
                              {result.message}
                            </span>
                          </div>
                          {result.suggestion && (
                            <p className="text-xs text-gray-500 mt-1">
                              └─ {result.suggestion}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {checkSummary && !checkSummary.allPassed && (
                  <div className="bg-orange-50 border-t p-3">
                    <p className="text-sm text-orange-700">
                      ⚠️ 有 {checkSummary.total - checkSummary.passed} 项需要修复，修复后才能正常生成文档
                    </p>
                  </div>
                )}
                
                {checkSummary && checkSummary.allPassed && (
                  <div className="bg-green-50 border-t p-3">
                    <p className="text-sm text-green-700">
                      ✅ 所有检测项均通过，可以正常生成文档
                    </p>
                  </div>
                )}
              </div>

              {/* 提交按钮和停止按钮 */}
              <div className="flex gap-3">
                <Button 
                  type="submit" 
                  className="flex-1 h-12 text-lg"
                  disabled={isGenerating || !isFormValid}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      正在为「{currentGeneratingStudent}」生成 ({currentStep}/5)...
                    </>
                  ) : (
                    <>
                      <FileText className="mr-2 h-5 w-5" />
                      生成5个文档并保存到Google Drive
                    </>
                  )}
                </Button>
                {isGenerating && (
                  <Button 
                    type="button"
                    variant="destructive"
                    className="h-12 px-6"
                    onClick={handleStop}
                    disabled={isStopping}
                  >
                    {isStopping ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        停止中...
                      </>
                    ) : (
                      <>
                        <Square className="mr-2 h-5 w-5" />
                        停止
                      </>
                    )}
                  </Button>
                )}
              </div>
            </form>

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
                        {isGenerating ? `正在为「${currentGeneratingStudent}」生成第 ${currentStep} 个文档...` :
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
                      <p className="text-sm text-red-600 mt-1">
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
                            </div>
                            {/* 运行中状态 */}
                            {step.status === 'running' && (
                              <div className="mt-1">
                                <p className="text-xs text-blue-600">{step.message}</p>
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
                                  <div className="flex items-center gap-2 mt-1">
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
                                  </div>
                                )}
                              </div>
                            )}
                            {/* 错误状态 */}
                            {step.error && (
                              <p className="text-xs text-red-600 mt-1">{step.error}</p>
                            )}
                          </div>
                          {/* 重试按钮 */}
                          {step.status === 'error' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => retryStep(index)}
                              disabled={isGenerating}
                              className="text-xs"
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              重试
                            </Button>
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
                          : `${driveBasePath || 'Mac/Documents/XDF/学生档案'}/小班课/${classNumber}/`
                        }
                      </code>
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

        {/* 底部说明 */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>系统会自动生成5个文档：学情反馈、复习文档、测试本、课后信息提取、气泡图</p>
          <p className="mt-1">文档将按照V9路书规范格式化，并自动存储到Google Drive对应文件夹</p>
          <p className="mt-1">日期信息将从课堂笔记中自动提取，无需手动填写</p>
        </div>
      </div>
    </div>
  );
}
