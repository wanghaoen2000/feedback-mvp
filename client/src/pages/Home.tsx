import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Loader2, CheckCircle2, AlertCircle, FileText, FolderOpen, Download } from "lucide-react";

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

  const isFormValid = studentName.trim() && currentNotes.trim() && transcript.trim();

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
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="lessonNumber">课次</Label>
                    <Input
                      id="lessonNumber"
                      placeholder="例如：第10次课"
                      value={lessonNumber}
                      onChange={(e) => setLessonNumber(e.target.value)}
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
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="nextLessonDate">下次课日期</Label>
                    <Input
                      id="nextLessonDate"
                      placeholder="例如：1月22日"
                      value={nextLessonDate}
                      onChange={(e) => setNextLessonDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-3 pt-2">
                  <Switch
                    id="isFirstLesson"
                    checked={isFirstLesson}
                    onCheckedChange={setIsFirstLesson}
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

            {/* 结果显示 */}
            {generateMutation.isSuccess && generateMutation.data && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-green-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-green-800 text-lg">✅ 反馈全部完成！</p>
                    
                    <div className="mt-4 space-y-2">
                      <p className="font-medium text-gray-700">生成的文件：</p>
                      <ul className="text-sm text-gray-600 space-y-1">
                        {generateMutation.data.files?.map((file, index) => (
                          <li key={index} className="flex items-center gap-2">
                            <Download className="w-4 h-4" />
                            {file.name}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {generateMutation.data.driveFolder && (
                      <div className="mt-4 p-3 bg-white rounded border border-green-200">
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                          <FolderOpen className="w-4 h-4" />
                          Google Drive位置
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          {generateMutation.data.driveFolder}
                        </p>
                        {generateMutation.data.driveUrl && (
                          <a 
                            href={generateMutation.data.driveUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline mt-2 inline-block"
                          >
                            点击打开文件夹 →
                          </a>
                        )}
                      </div>
                    )}

                    <div className="mt-4 p-3 bg-blue-50 rounded text-sm text-gray-700">
                      <p className="font-medium mb-1">接下来：</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>复制反馈内容到腾讯文档</li>
                        <li>把复习文档和测试本发给学生</li>
                        <li>把气泡图发到学习群</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {generateMutation.isError && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-6 h-6 text-red-600 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-800">生成失败</p>
                    <p className="text-sm text-red-700 mt-1">
                      {generateMutation.error?.message || "请检查输入内容后重试"}
                    </p>
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
