import { useState, useCallback, useEffect } from "react";
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
  Play,
  History
} from "lucide-react";

// 步骤状态类型
interface StepStatus {
  step: number;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
  error?: string;
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

  // 断点续传状态
  const [taskKey, setTaskKey] = useState<string | null>(null);
  const [hasPendingTask, setHasPendingTask] = useState(false);
  const [pendingTaskInfo, setPendingTaskInfo] = useState<{
    studentName: string;
    currentStep: number;
    dateStr: string | null;
  } | null>(null);

  // tRPC queries and mutations
  const configQuery = trpc.config.getAll.useQuery();
  const updateConfigMutation = trpc.config.update.useMutation();
  
  const generateFeedbackMutation = trpc.feedback.generateFeedback.useMutation();
  const generateReviewMutation = trpc.feedback.generateReview.useMutation();
  const generateTestMutation = trpc.feedback.generateTest.useMutation();
  const generateExtractionMutation = trpc.feedback.generateExtraction.useMutation();
  const generateBubbleChartMutation = trpc.feedback.generateBubbleChart.useMutation();

  // 断点续传API
  const getOrCreateTaskMutation = trpc.task.getOrCreate.useMutation();
  const updateTaskStepMutation = trpc.task.updateStep.useMutation();
  const deleteTaskMutation = trpc.task.delete.useMutation();

  // 加载配置
  useEffect(() => {
    if (configQuery.data && !configLoaded) {
      setApiModel(configQuery.data.apiModel);
      setApiKey(configQuery.data.apiKey);
      setApiUrl(configQuery.data.apiUrl);
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

  // 从已保存的步骤结果恢复状态
  const restoreFromTask = useCallback((taskData: any) => {
    const newSteps = [...initialSteps];
    
    if (taskData.steps.step1) {
      const step1 = taskData.steps.step1;
      newSteps[0] = { ...newSteps[0], status: 'success', uploadResult: step1.uploadResult };
      if (step1.feedbackContent) setFeedbackContent(step1.feedbackContent);
      if (step1.dateStr) setDateStr(step1.dateStr);
    }
    if (taskData.steps.step2) {
      newSteps[1] = { ...newSteps[1], status: 'success', uploadResult: taskData.steps.step2.uploadResult };
    }
    if (taskData.steps.step3) {
      newSteps[2] = { ...newSteps[2], status: 'success', uploadResult: taskData.steps.step3.uploadResult };
    }
    if (taskData.steps.step4) {
      newSteps[3] = { ...newSteps[3], status: 'success', uploadResult: taskData.steps.step4.uploadResult };
    }
    if (taskData.steps.step5) {
      newSteps[4] = { ...newSteps[4], status: 'success', uploadResult: taskData.steps.step5.uploadResult };
    }
    
    setSteps(newSteps);
    setCurrentStep(taskData.currentStep);
    if (taskData.dateStr) setDateStr(taskData.dateStr);
    
    // 检查是否全部完成
    if (taskData.status === 'completed' || taskData.currentStep === 5) {
      setIsComplete(true);
    }
  }, []);

  // 执行单个步骤
  const executeStep = useCallback(async (
    stepNum: number, 
    content: string, 
    date: string, 
    configOverride: any,
    currentTaskKey: string
  ): Promise<{ content: string; date: string; success: boolean }> => {
    const stepIndex = stepNum - 1;
    updateStep(stepIndex, { status: 'running', message: '正在生成...' });

    try {
      let result;
      let stepResult: any = {};

      switch (stepNum) {
        case 1:
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
          content = result.feedbackContent;
          date = result.dateStr;
          setFeedbackContent(content);
          setDateStr(date);
          stepResult = { feedbackContent: content, dateStr: date, uploadResult: result.uploadResult };
          break;

        case 2:
          result = await generateReviewMutation.mutateAsync({
            studentName: studentName.trim(),
            dateStr: date,
            feedbackContent: content,
            ...configOverride,
          });
          stepResult = { uploadResult: result.uploadResult };
          break;

        case 3:
          result = await generateTestMutation.mutateAsync({
            studentName: studentName.trim(),
            dateStr: date,
            feedbackContent: content,
            ...configOverride,
          });
          stepResult = { uploadResult: result.uploadResult };
          break;

        case 4:
          result = await generateExtractionMutation.mutateAsync({
            studentName: studentName.trim(),
            dateStr: date,
            feedbackContent: content,
            ...configOverride,
          });
          stepResult = { uploadResult: result.uploadResult };
          break;

        case 5:
          result = await generateBubbleChartMutation.mutateAsync({
            studentName: studentName.trim(),
            dateStr: date,
            lessonNumber: lessonNumber.trim(),
            feedbackContent: content,
            ...configOverride,
          });
          stepResult = { uploadResult: result.uploadResult };
          break;
      }

      // 保存进度到数据库
      await updateTaskStepMutation.mutateAsync({
        taskKey: currentTaskKey,
        step: stepNum,
        result: JSON.stringify(stepResult),
        dateStr: stepNum === 1 ? date : undefined,
      });

      updateStep(stepIndex, { 
        status: 'success', 
        message: '生成完成',
        uploadResult: result?.uploadResult
      });

      return { content, date, success: true };
    } catch (error) {
      console.error(`步骤${stepNum}失败:`, error);
      updateStep(stepIndex, { 
        status: 'error', 
        error: error instanceof Error ? error.message : '生成失败'
      });
      return { content, date, success: false };
    }
  }, [
    studentName, lessonNumber, lastFeedback, currentNotes, transcript,
    isFirstLesson, specialRequirements, updateStep,
    generateFeedbackMutation, generateReviewMutation, generateTestMutation,
    generateExtractionMutation, generateBubbleChartMutation, updateTaskStepMutation
  ]);

  // 执行生成流程（支持从指定步骤开始）
  const runGeneration = useCallback(async (startFromStep: number = 1, existingContent?: string, existingDate?: string) => {
    setIsGenerating(true);
    setIsComplete(false);
    setHasError(false);
    
    if (startFromStep === 1) {
      setSteps(initialSteps);
    }
    setCurrentStep(startFromStep);

    let content = existingContent || feedbackContent;
    let date = existingDate || dateStr;

    // 构建配置对象（只传非空值）
    const configOverride = {
      apiModel: apiModel.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      apiUrl: apiUrl.trim() || undefined,
    };

    // 获取或创建任务
    let currentTaskKey = taskKey;
    if (!currentTaskKey) {
      try {
        const inputData = JSON.stringify({
          studentName: studentName.trim(),
          lessonNumber: lessonNumber.trim(),
          lastFeedback: lastFeedback.trim(),
          currentNotes: currentNotes.trim(),
          transcript: transcript.trim(),
          isFirstLesson,
          specialRequirements: specialRequirements.trim(),
        });
        
        const taskResult = await getOrCreateTaskMutation.mutateAsync({
          studentName: studentName.trim(),
          inputData,
        });
        
        currentTaskKey = taskResult.taskKey;
        setTaskKey(currentTaskKey);

        // 如果有未完成的任务，恢复状态
        if (!taskResult.isNew && taskResult.currentStep > 0) {
          restoreFromTask(taskResult);
          content = taskResult.steps.step1?.feedbackContent || content;
          date = taskResult.dateStr || date;
          
          // 从下一个未完成的步骤开始
          const nextStep = taskResult.currentStep + 1;
          if (nextStep <= 5) {
            startFromStep = nextStep;
            setCurrentStep(nextStep);
          } else {
            // 已全部完成
            setIsComplete(true);
            setIsGenerating(false);
            return;
          }
        }
      } catch (error) {
        console.error("创建任务失败:", error);
        setHasError(true);
        setIsGenerating(false);
        return;
      }
    }

    // 执行步骤
    for (let stepNum = startFromStep; stepNum <= 5; stepNum++) {
      setCurrentStep(stepNum);
      
      const result = await executeStep(stepNum, content, date, configOverride, currentTaskKey!);
      
      if (!result.success) {
        setHasError(true);
        setIsGenerating(false);
        return;
      }
      
      content = result.content;
      date = result.date;
    }

    setIsComplete(true);
    setIsGenerating(false);
  }, [
    feedbackContent, dateStr, apiModel, apiKey, apiUrl, taskKey,
    studentName, lessonNumber, lastFeedback, currentNotes, transcript,
    isFirstLesson, specialRequirements,
    getOrCreateTaskMutation, executeStep, restoreFromTask
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim() || !currentNotes.trim() || !transcript.trim()) {
      return;
    }
    
    // 检查是否有未完成的任务
    try {
      const inputData = JSON.stringify({
        studentName: studentName.trim(),
        lessonNumber: lessonNumber.trim(),
        lastFeedback: lastFeedback.trim(),
        currentNotes: currentNotes.trim(),
        transcript: transcript.trim(),
        isFirstLesson,
        specialRequirements: specialRequirements.trim(),
      });
      
      const taskResult = await getOrCreateTaskMutation.mutateAsync({
        studentName: studentName.trim(),
        inputData,
      });
      
      setTaskKey(taskResult.taskKey);
      
      if (!taskResult.isNew && taskResult.currentStep > 0 && taskResult.status !== 'completed') {
        // 有未完成的任务
        setHasPendingTask(true);
        setPendingTaskInfo({
          studentName: taskResult.studentName,
          currentStep: taskResult.currentStep,
          dateStr: taskResult.dateStr,
        });
        restoreFromTask(taskResult);
        return;
      }
      
      // 没有未完成的任务，直接开始
      await runGeneration(1);
    } catch (error) {
      console.error("检查任务失败:", error);
      // 出错时直接开始新任务
      await runGeneration(1);
    }
  };

  // 继续未完成的任务
  const handleContinueTask = async () => {
    setHasPendingTask(false);
    const nextStep = (pendingTaskInfo?.currentStep || 0) + 1;
    await runGeneration(nextStep, feedbackContent, dateStr);
  };

  // 放弃未完成的任务，重新开始
  const handleRestartTask = async () => {
    if (taskKey) {
      try {
        await deleteTaskMutation.mutateAsync({ taskKey });
      } catch (e) {
        console.error("删除任务失败:", e);
      }
    }
    setTaskKey(null);
    setHasPendingTask(false);
    setPendingTaskInfo(null);
    setSteps(initialSteps);
    setFeedbackContent("");
    setDateStr("");
    await runGeneration(1);
  };

  // 单步重试函数
  const retryStep = useCallback(async (stepIndex: number) => {
    if (isGenerating) return;
    
    setIsGenerating(true);
    
    const configOverride = {
      apiModel: apiModel.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      apiUrl: apiUrl.trim() || undefined,
    };

    const result = await executeStep(
      stepIndex + 1, 
      feedbackContent, 
      dateStr, 
      configOverride,
      taskKey!
    );

    if (result.success) {
      // 检查是否所有步骤都成功
      const updatedSteps = steps.map((s, i) => 
        i === stepIndex ? { ...s, status: 'success' as const } : s
      );
      const allSuccess = updatedSteps.every(s => s.status === 'success');
      if (allSuccess) {
        setIsComplete(true);
        setHasError(false);
      }
    }

    setIsGenerating(false);
  }, [isGenerating, feedbackContent, dateStr, apiModel, apiKey, apiUrl, taskKey, steps, executeStep]);

  const handleReset = () => {
    setSteps(initialSteps);
    setCurrentStep(0);
    setFeedbackContent("");
    setDateStr("");
    setIsComplete(false);
    setHasError(false);
    setTaskKey(null);
    setHasPendingTask(false);
    setPendingTaskInfo(null);
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

        {/* 未完成任务提示 */}
        {hasPendingTask && pendingTaskInfo && (
          <Card className="mb-6 border-yellow-300 bg-yellow-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <History className="w-8 h-8 text-yellow-600 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-yellow-800 mb-2">发现未完成的任务</h3>
                  <p className="text-sm text-yellow-700 mb-3">
                    学生 <strong>{pendingTaskInfo.studentName}</strong> 的反馈生成已完成 {pendingTaskInfo.currentStep}/5 步
                    {pendingTaskInfo.dateStr && `（${pendingTaskInfo.dateStr}）`}
                  </p>
                  <div className="flex gap-3">
                    <Button onClick={handleContinueTask} className="bg-yellow-600 hover:bg-yellow-700">
                      <Play className="w-4 h-4 mr-2" />
                      继续生成（从第{pendingTaskInfo.currentStep + 1}步开始）
                    </Button>
                    <Button variant="outline" onClick={handleRestartTask}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      放弃并重新开始
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

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

              {/* 提交按钮 */}
              <Button 
                type="submit" 
                className="w-full h-12 text-lg"
                disabled={isGenerating || !isFormValid || hasPendingTask}
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
                         '⚠️ 生成过程中出错（已保存进度，可点击重试）'}
                      </span>
                    </div>
                    {(isComplete || hasError) && (
                      <Button variant="outline" size="sm" onClick={handleReset}>
                        <RefreshCw className="w-4 h-4 mr-1" />
                        重新开始
                      </Button>
                    )}
                  </div>

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

                  {/* 断点续传提示 */}
                  {hasError && (
                    <div className="bg-yellow-100 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-800">
                      <strong>💡 进度已保存：</strong>已完成的步骤不会重复执行，点击"重试"只会重新执行失败的步骤。
                      即使关闭网页，下次打开也可以继续。
                    </div>
                  )}

                  {/* 步骤列表 */}
                  <div className="space-y-3">
                    {steps.map((step, index) => (
                      <div key={index} className={`flex items-center gap-3 p-2 rounded ${
                        step.status === 'running' ? 'bg-blue-100' :
                        step.status === 'success' ? 'bg-green-100' :
                        step.status === 'error' ? 'bg-red-100' :
                        'bg-white'
                      }`}>
                        <StatusIcon status={step.status} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{step.step}. {step.name}</span>
                            {step.status === 'running' && (
                              <span className="text-xs text-blue-600">{step.message}</span>
                            )}
                          </div>
                          {step.error && (
                            <p className="text-xs text-red-600 mt-1">{step.error}</p>
                          )}
                          {step.uploadResult && step.status === 'success' && (
                            <div className="flex items-center gap-2 mt-1">
                              {step.uploadResult.url ? (
                                <a 
                                  href={step.uploadResult.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                >
                                  <FileText className="w-3 h-3" />
                                  {step.uploadResult.fileName}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <span className="text-xs text-gray-500">{step.uploadResult.fileName}</span>
                              )}
                            </div>
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

                {/* 提示信息 */}
                {isGenerating && (
                  <p className="text-xs text-gray-500 text-center">
                    每个文档独立生成，预计每个需要1-2分钟，请耐心等待...
                    <br />
                    <span className="text-green-600">✓ 进度自动保存，即使网络中断也不会丢失已完成的步骤</span>
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
          <p className="mt-1 text-green-600">✓ 支持断点续传：网络中断后可从上次进度继续</p>
        </div>
      </div>
    </div>
  );
}
