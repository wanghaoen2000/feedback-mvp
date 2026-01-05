import { useState } from "react";
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
  Download,
  Circle,
  XCircle,
  ExternalLink,
  RefreshCw
} from "lucide-react";

// 步骤状态类型
interface StepStatus {
  step: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
  error?: string;
}

// 上传结果类型
interface UploadResult {
  fileName: string;
  url: string;
  path: string;
  folderUrl?: string;
  status: 'success' | 'error';
  error?: string;
  verified: boolean;
  fileSize?: number;
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

// 格式化文件大小
function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

  const generateMutation = trpc.feedback.generate.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim() || !currentNotes.trim() || !transcript.trim()) {
      return;
    }
    
    generateMutation.mutate({
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
  };

  const handleReset = () => {
    generateMutation.reset();
  };

  const isFormValid = studentName.trim() && currentNotes.trim() && transcript.trim();

  // 从返回数据中获取状态
  const data = generateMutation.data;
  const generationSteps: StepStatus[] = data?.generationSteps || [];
  const uploadResults: UploadResult[] = data?.uploadResults || [];
  const summary = data?.summary;

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
                      disabled={generateMutation.isPending}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="lessonNumber">课次</Label>
                    <Input
                      id="lessonNumber"
                      placeholder="例如：第10次课"
                      value={lessonNumber}
                      onChange={(e) => setLessonNumber(e.target.value)}
                      disabled={generateMutation.isPending}
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
                      disabled={generateMutation.isPending}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="nextLessonDate">下次课日期</Label>
                    <Input
                      id="nextLessonDate"
                      placeholder="例如：1月22日"
                      value={nextLessonDate}
                      onChange={(e) => setNextLessonDate(e.target.value)}
                      disabled={generateMutation.isPending}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-3 pt-2">
                  <Switch
                    id="isFirstLesson"
                    checked={isFirstLesson}
                    onCheckedChange={setIsFirstLesson}
                    disabled={generateMutation.isPending}
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
                    disabled={generateMutation.isPending}
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
                    disabled={generateMutation.isPending}
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
                    disabled={generateMutation.isPending}
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
                  disabled={generateMutation.isPending}
                />
              </div>

              {/* 提交按钮 */}
              <Button 
                type="submit" 
                className="w-full h-12 text-lg"
                disabled={generateMutation.isPending || !isFormValid}
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    正在生成文档...
                  </>
                ) : (
                  <>
                    <FileText className="mr-2 h-5 w-5" />
                    生成5个文档并保存到Google Drive
                  </>
                )}
              </Button>
            </form>

            {/* 进度显示（生成中） */}
            {generateMutation.isPending && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2 mb-4">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  <span className="font-semibold text-blue-800">正在处理中...</span>
                </div>
                <div className="space-y-2 text-sm text-gray-600">
                  <p>1. 调用AI生成学情反馈...</p>
                  <p>2. 生成复习文档...</p>
                  <p>3. 生成测试本...</p>
                  <p>4. 生成课后信息提取...</p>
                  <p>5. 生成气泡图...</p>
                  <p>6. 上传到Google Drive...</p>
                  <p>7. 验证文件...</p>
                </div>
                <p className="mt-3 text-xs text-gray-500">
                  预计需要1-2分钟，请耐心等待...
                </p>
              </div>
            )}

            {/* 成功结果显示 */}
            {generateMutation.isSuccess && data && (
              <div className="mt-6 space-y-4">
                {/* 总体状态 */}
                <div className={`p-4 rounded-lg border ${
                  data.success 
                    ? 'bg-green-50 border-green-200' 
                    : 'bg-yellow-50 border-yellow-200'
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    {data.success ? (
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                    ) : (
                      <AlertCircle className="w-6 h-6 text-yellow-600" />
                    )}
                    <span className={`font-semibold text-lg ${
                      data.success ? 'text-green-800' : 'text-yellow-800'
                    }`}>
                      {data.success ? '✅ 全部完成！' : '⚠️ 部分完成'}
                    </span>
                  </div>
                  
                  {/* 统计摘要 */}
                  {summary && (
                    <div className="grid grid-cols-4 gap-2 text-sm mb-4">
                      <div className="bg-white p-2 rounded text-center">
                        <div className="text-2xl font-bold text-gray-800">{summary.totalFiles}</div>
                        <div className="text-gray-500">总文件</div>
                      </div>
                      <div className="bg-white p-2 rounded text-center">
                        <div className="text-2xl font-bold text-green-600">{summary.successCount}</div>
                        <div className="text-gray-500">上传成功</div>
                      </div>
                      <div className="bg-white p-2 rounded text-center">
                        <div className="text-2xl font-bold text-red-600">{summary.errorCount}</div>
                        <div className="text-gray-500">上传失败</div>
                      </div>
                      <div className="bg-white p-2 rounded text-center">
                        <div className="text-2xl font-bold text-blue-600">{summary.verifiedCount}</div>
                        <div className="text-gray-500">验证通过</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 文档生成步骤 */}
                {generationSteps.length > 0 && (
                  <div className="bg-white p-4 rounded-lg border">
                    <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      文档生成步骤
                    </h4>
                    <div className="space-y-2">
                      {generationSteps.map((step, index) => (
                        <div key={index} className="flex items-center gap-3 text-sm">
                          <StatusIcon status={step.status} />
                          <span className="font-medium w-24">{step.step}</span>
                          <span className={`flex-1 ${
                            step.status === 'error' ? 'text-red-600' : 'text-gray-600'
                          }`}>
                            {step.error || step.message || ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 文件上传结果 */}
                {uploadResults.length > 0 && (
                  <div className="bg-white p-4 rounded-lg border">
                    <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <FolderOpen className="w-4 h-4" />
                      文件上传结果
                    </h4>
                    <div className="space-y-2">
                      {uploadResults.map((file, index) => (
                        <div key={index} className={`flex items-center gap-3 text-sm p-2 rounded ${
                          file.status === 'error' ? 'bg-red-50' : 'bg-gray-50'
                        }`}>
                          <StatusIcon status={file.status} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{file.fileName}</span>
                              {file.verified && (
                                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                                  已验证
                                </span>
                              )}
                              {file.fileSize && (
                                <span className="text-xs text-gray-500">
                                  {formatFileSize(file.fileSize)}
                                </span>
                              )}
                            </div>
                            {file.error && (
                              <div className="text-red-600 text-xs mt-1">{file.error}</div>
                            )}
                          </div>
                          {file.url && (
                            <a 
                              href={file.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Google Drive 位置 */}
                {data.driveFolder && (
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                      <FolderOpen className="w-4 h-4" />
                      Google Drive 存储位置
                    </div>
                    <p className="text-sm text-gray-600 font-mono bg-white p-2 rounded">
                      {data.driveFolder}
                    </p>
                    {data.driveUrl && (
                      <a 
                        href={data.driveUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mt-2"
                      >
                        <ExternalLink className="w-4 h-4" />
                        在Google Drive中打开
                      </a>
                    )}
                  </div>
                )}

                {/* 下一步提示 */}
                <div className="bg-gray-50 p-4 rounded-lg border">
                  <p className="font-medium text-gray-700 mb-2">接下来：</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                    <li>复制反馈内容到腾讯文档</li>
                    <li>把复习文档和测试本发给学生</li>
                    <li>把气泡图发到学习群</li>
                  </ol>
                </div>

                {/* 重新生成按钮 */}
                <Button 
                  variant="outline" 
                  onClick={handleReset}
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  生成新的反馈
                </Button>
              </div>
            )}

            {/* 错误显示 */}
            {generateMutation.isError && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <XCircle className="w-6 h-6 text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-red-800">生成失败</p>
                    <p className="text-sm text-red-700 mt-1">
                      {generateMutation.error?.message || "请检查输入内容后重试"}
                    </p>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleReset}
                      className="mt-3"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      重试
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 底部说明 */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>文件将自动保存到 Google Drive：Mac/Documents/XDF/学生档案/[学生姓名]/</p>
        </div>
      </div>
    </div>
  );
}
