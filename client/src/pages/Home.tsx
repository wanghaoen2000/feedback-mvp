import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Loader2, CheckCircle2, AlertCircle, Calculator, FolderOpen } from "lucide-react";

export default function Home() {
  const [expression, setExpression] = useState("");
  const [studentName, setStudentName] = useState("李四");

  const computeMutation = trpc.calculate.compute.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expression.trim()) return;
    
    computeMutation.mutate({
      expression: expression.trim(),
      studentName: studentName.trim() || "李四",
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <Calculator className="w-6 h-6 text-blue-600" />
          </div>
          <CardTitle className="text-xl">学情反馈MVP验证</CardTitle>
          <CardDescription>
            输入算术表达式，计算结果将保存到Google Drive
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="studentName">学生姓名</Label>
              <Input
                id="studentName"
                type="text"
                placeholder="李四"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="expression">算术表达式</Label>
              <Input
                id="expression"
                type="text"
                placeholder="例如：1+1"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                autoFocus
              />
            </div>
            
            <Button 
              type="submit" 
              className="w-full"
              disabled={computeMutation.isPending || !expression.trim()}
            >
              {computeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  计算中...
                </>
              ) : (
                "计算并保存"
              )}
            </Button>
          </form>

          {/* 结果显示 */}
          {computeMutation.isSuccess && computeMutation.data && (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-green-800">计算成功！</p>
                  <p className="text-sm text-green-700 mt-1">
                    {computeMutation.data.expression} = <span className="font-bold">{computeMutation.data.result}</span>
                  </p>
                  {computeMutation.data.success && computeMutation.data.driveUrl && (
                    <div className="mt-3 p-2 bg-white rounded border border-green-200">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <FolderOpen className="w-4 h-4" />
                        <span>已保存到 Google Drive</span>
                      </div>
                      <a 
                        href={computeMutation.data.driveUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline mt-1 block truncate"
                      >
                        {computeMutation.data.filePath}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {computeMutation.isError && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800">出错了</p>
                  <p className="text-sm text-red-700 mt-1">
                    {computeMutation.error?.message || "请稍后重试"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
