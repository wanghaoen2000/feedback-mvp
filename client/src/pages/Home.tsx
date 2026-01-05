import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  RefreshCw
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
  const [lessonDate, setLessonDate] = useState("");
  const [nextLessonDate, setNextLessonDate] = useState("");
  
  // 三段文本
  const [lastFeedback, setLastFeedback] = useState("");
  const [currentNotes, setCurrentNotes] = useState("");
  const [transcript, setTranscript] = useState("");
  
  // 特殊选项
  const [isFirstLesson, setIsFirstLesson] = useState(false);
  const [specialRequirements, setSpecialRequirements] = useState("");

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [steps, setSteps] = useState<StepStatus[]>(initialSteps);
  const [currentStep, setCurrentStep] = useState(0);
  const [feedbackContent, setFeedbackContent] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);

  // tRPC mutations
  const generateFeedbackMutation = trpc.feedback.generateFeedback.useMutation();
  const generateReviewMutation = trpc.feedback.generateReview.useMutation();
  const generateTestMutation = trpc.feedback.generateTest.useMutation();
  const generateExtractionMutation = trpc.feedback.generateExtraction.useMutation();
  const generateBubbleChartMutation = trpc.feedback.generateBubbleChart.useMutation();

  // 更新步骤状态
  const updateStep = useCallback((stepIndex: number, updates: Partial<StepStatus>) => {
    setSteps(prev => prev.map((s, i) => 
      i === stepIndex ? { ...s, ...updates } : s
    ));
  }, []);

  // 执行生成流程
  const runGeneration = useCallback(async () => {
    setIsGenerating(true);
    setIsComplete(false);
    setHasError(false);
    setSteps(initialSteps);
    setCurrentStep(1);

    let content = "";
    let date = "";

    try {
      // 步骤1: 生成学情反馈
      updateStep(0, { status: 'running', message: '正在调用AI生成学情反馈...' });
      const step1Result = await generateFeedbackMutation.mutateAsync({
        studentName: studentName.trim(),
        lessonNumber: lessonNumber.trim(),
        lessonDate: lessonDate.trim(),
        nextLessonDate: nextLessonDate.trim(),
        lastFeedback: lastFeedback.trim(),
        currentNotes: currentNotes.trim(),
        transcript: transcript.trim(),
        isFirstLesson,
        specialRequirements: specialRequirements.trim(),
      });
      
      content = step1Result.feedbackContent;
      date = step1Result.dateStr;
      setFeedbackContent(content);
      setDateStr(date);
      updateStep(0, { 
        status: 'success', 
        message: '生成完成',
        uploadResult: step1Result.uploadResult
      });
      setCurrentStep(2);

      // 步骤2: 生成复习文档
      updateStep(1, { status: 'running', message: '正在生成复习文档...' });
      const step2Result = await generateReviewMutation.mutateAsync({
        studentName: studentName.trim(),
        dateStr: date,
        feedbackContent: content,
      });
      updateStep(1, { 
        status: 'success', 
        message: '生成完成',
        uploadResult: step2Result.uploadResult
      });
      setCurrentStep(3);

      // 步骤3: 生成测试本
      updateStep(2, { status: 'running', message: '正在生成测试本...' });
      const step3Result = await generateTestMutation.mutateAsync({
        studentName: studentName.trim(),
        dateStr: date,
        feedbackContent: content,
      });
      updateStep(2, { 
        status: 'success', 
        message: '生成完成',
        uploadResult: step3Result.uploadResult
      });
      setCurrentStep(4);

      // 步骤4: 生成课后信息提取
      updateStep(3, { status: 'running', message: '正在生成课后信息提取...' });
      const step4Result = await generateExtractionMutation.mutateAsync({
        studentName: studentName.trim(),
        dateStr: date,
        nextLessonDate: nextLessonDate.trim(),
        feedbackContent: content,
      });
      updateStep(3, { 
        status: 'success', 
        message: '生成完成',
        uploadResult: step4Result.uploadResult
      });
      setCurrentStep(5);

      // 步骤5: 生成气泡图
      updateStep(4, { status: 'running', message: '正在生成气泡图...' });
      const step5Result = await generateBubbleChartMutation.mutateAsync({
        studentName: studentName.trim(),
        dateStr: date,
        lessonNumber: lessonNumber.trim(),
        feedbackContent: content,
      });
      updateStep(4, { 
        status: 'success', 
        message: '生成完成',
        uploadResult: step5Result.uploadResult
      });

      setIsComplete(true);
    } catch (error) {
      console.error("生成失败:", error);
      setHasError(true);
      // 标记当前步骤为失败
      const failedStepIndex = currentStep - 1;
      if (failedStepIndex >= 0 && failedStepIndex < 5) {
        updateStep(failedStepIndex, { 
          status: 'error', 
          error: error instanceof Error ? error.message : '生成失败'
        });
      }
    } finally {
      setIsGenerating(false);
    }
  }, [
    studentName, lessonNumber, lessonDate, nextLessonDate,
    lastFeedback, currentNotes, transcript, isFirstLesson, specialRequirements,
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

  const handleReset = () => {
    setSteps(initialSteps);
    setCurrentStep(0);
    setFeedbackContent("");
    setDateStr("");
    setIsComplete(false);
    setHasError(false);
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="lessonDate">本次课日期</Label>
                    <Input
                      id="lessonDate"
                      placeholder="例如：1月15日"
                      value={lessonDate}
                      onChange={(e) => setLessonDate(e.target.value)}
                      disabled={isGenerating}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="nextLessonDate">下次课日期</Label>
                    <Input
                      id="nextLessonDate"
                      placeholder="例如：1月22日"
                      value={nextLessonDate}
                      onChange={(e) => setNextLessonDate(e.target.value)}
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
                    {isFirstLesson ? "新生首次课模板（可选）" : "上次课反馈 *"}
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
                    placeholder="粘贴本次课的笔记内容..."
                    value={currentNotes}
                    onChange={(e) => setCurrentNotes(e.target.value)}
                    className="min-h-[200px] font-mono text-sm"
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

              {/* 提交按钮 */}
              <Button 
                type="submit" 
                className="w-full h-12 text-lg"
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
        </div>
      </div>
    </div>
  );
}
