import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  MinusCircle
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

// 初始步骤状态
const initialSteps: StepStatus[] = [
  { step: 1, name: "学情反馈", status: 'pending' },
  { step: 2, name: "复习文档", status: 'pending' },
  { step: 3, name: "测试本", status: 'pending' },
  { step: 4, name: "课后信息提取", status: 'pending' },
  { step: 5, name: "气泡图", status: 'pending' },
];

export default function Home() {
  // 基本信息
  const [studentName, setStudentName] = useState("");
  const [lessonNumber, setLessonNumber] = useState("");
  const [lessonDate, setLessonDate] = useState(""); // 本次课日期，如"1月5日"
  const [currentYear, setCurrentYear] = useState("2026"); // 年份
  
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
  const [roadmap, setRoadmap] = useState(""); // V9路书内容
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
  const [isExportingLog, setIsExportingLog] = useState(false); // 是否正在导出日志
  const [exportLogResult, setExportLogResult] = useState<{
    success: boolean;
    message: string;
    path?: string;
    url?: string;
  } | null>(null); // 导出结果
  const abortControllerRef = useRef<AbortController | null>(null); // 用于取消请求
  
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
  const exportLogMutation = trpc.feedback.exportLog.useMutation();
  const systemCheckMutation = trpc.feedback.systemCheck.useMutation();

  // 加载配置
  useEffect(() => {
    if (configQuery.data && !configLoaded) {
      setApiModel(configQuery.data.apiModel);
      setApiKey(configQuery.data.apiKey);
      setApiUrl(configQuery.data.apiUrl);
      setCurrentYear(configQuery.data.currentYear || "2026");
      setRoadmap(configQuery.data.roadmap || "");
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
    setSteps(initialSteps);
    setCurrentStep(1);

    let content = "";
    let date = "";
    let stopped = false;

    // 构建配置对象（只传非空值）
    const configOverride = {
      apiModel: apiModel.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      apiUrl: apiUrl.trim() || undefined,
      lessonDate: lessonDate.trim() || undefined,
      currentYear: currentYear.trim() || undefined,
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
        studentName: studentName.trim(),
        lessonNumber: lessonNumber.trim(),
        lastFeedback: lastFeedback.trim(),
        currentNotes: currentNotes.trim(),
        transcript: transcript.trim(),
        isFirstLesson,
        specialRequirements: specialRequirements.trim(),
        ...configOverride,
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
        studentName: studentName.trim(),
        dateStr: date,
        feedbackContent: content,
        ...configOverride,
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
        studentName: studentName.trim(),
        dateStr: date,
        feedbackContent: content,
        ...configOverride,
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
        studentName: studentName.trim(),
        dateStr: date,
        feedbackContent: content,
        ...configOverride,
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
        detail: '生成问题-方案对应的可视化图',
        startTime: step5Start
      });
      const step5Result = await generateBubbleChartMutation.mutateAsync({
        studentName: studentName.trim(),
        dateStr: date,
        lessonNumber: lessonNumber.trim(),
        feedbackContent: content,
        ...configOverride,
      });
      const step5End = Date.now();
      updateStep(4, { 
        status: 'success', 
        message: `生成完成 (耗时${Math.round((step5End - step5Start) / 1000)}秒)`,
        detail: '气泡图已上传到Google Drive',
        endTime: step5End,
        uploadResult: step5Result.uploadResult
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
      abortControllerRef.current = null;
    }
  }, [
    studentName, lessonNumber, lastFeedback, currentNotes, transcript, 
    isFirstLesson, specialRequirements, apiModel, apiKey, apiUrl,
    generateFeedbackMutation, generateReviewMutation, generateTestMutation,
    generateExtractionMutation, generateBubbleChartMutation, updateStep, currentStep
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim() || !currentNotes.trim() || !transcript.trim()) {
      return;
    }
    await runGeneration();
  };

  // 单步重试函数
  const retryStep = useCallback(async (stepIndex: number) => {
    if (isGenerating) return;
    
    setIsGenerating(true);
    updateStep(stepIndex, { status: 'running', message: '正在重试...' });

    const configOverride = {
      apiModel: apiModel.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      apiUrl: apiUrl.trim() || undefined,
      lessonDate: lessonDate.trim() || undefined,
      currentYear: currentYear.trim() || undefined,
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
            ...configOverride,
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
            ...configOverride,
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
            ...configOverride,
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
            ...configOverride,
          });
          updateStep(3, { status: 'success', message: '生成完成', uploadResult: result.uploadResult });
          break;

        case 4: // 气泡图
          if (!feedbackContent || !dateStr) {
            throw new Error('请先生成学情反馈');
          }
          result = await generateBubbleChartMutation.mutateAsync({
            studentName: studentName.trim(),
            dateStr,
            lessonNumber: lessonNumber.trim(),
            feedbackContent,
            ...configOverride,
          });
          updateStep(4, { status: 'success', message: '生成完成', uploadResult: result.uploadResult });
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
      const result = await exportLogMutation.mutateAsync();
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

  const isFormValid = studentName.trim() && currentNotes.trim() && transcript.trim();

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
                    <Input
                      id="lessonDate"
                      placeholder="例如：1月5日"
                      value={lessonDate}
                      onChange={(e) => setLessonDate(e.target.value)}
                      disabled={isGenerating}
                    />
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
                    新生首次课（勾选后"上次反馈"将替换为新生模板）
                  </Label>
                </div>
              </div>

              {/* 三段文本输入区 */}
              <div className="space-y-4">
                {/* 上次反馈 / 新生模板 */}
                <div className="space-y-2">
                  <Label htmlFor="lastFeedback">
                    {isFirstLesson ? "新生首次课模板（可选）" : "上次课反馈"}
                  </Label>
                  <Textarea
                    id="lastFeedback"
                    placeholder={isFirstLesson 
                      ? "如有新生模板可粘贴在此，没有可留空" 
                      : "粘贴上次课的反馈内容..."
                    }
                    value={lastFeedback}
                    onChange={(e) => setLastFeedback(e.target.value)}
                    className="min-h-[150px] font-mono text-sm"
                    disabled={isGenerating}
                  />
                  <p className="text-xs text-gray-500">
                    {isFirstLesson 
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
                    className="min-h-[200px] font-mono text-sm"
                    disabled={isGenerating}
                  />
                  <p className="text-xs text-gray-500">
                    包含课堂讲解的知识点、生词、长难句、错题等。请确保笔记中包含日期信息（上次课、本次课、下次课日期）
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
                    className="min-h-[200px] font-mono text-sm"
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
                  className="min-h-[80px]"
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

                    {/* 路书管理 */}
                    <div className="border-t pt-4 mt-4">
                      <div className="space-y-2">
                        <Label htmlFor="roadmap">V9路书内容（可选）</Label>
                        <Textarea
                          id="roadmap"
                          placeholder="粘贴更新后的V9路书内容...留空则使用系统内置的路书"
                          value={roadmap}
                          onChange={(e) => setRoadmap(e.target.value)}
                          className="min-h-[150px] font-mono text-xs"
                          disabled={isGenerating}
                        />
                        <p className="text-xs text-gray-500">
                          如果路书有更新，可以在此粘贴新版本。保存后系统将使用新路书生成文档。
                          留空则使用系统内置的默认路书。
                        </p>
                        <div className="flex gap-2">
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
                      正在生成文档 ({currentStep}/5)...
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
                        {isGenerating ? `正在生成第 ${currentStep} 个文档...` :
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
                        Mac/Documents/XDF/学生档案/{studentName}/
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
