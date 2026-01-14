import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { 
  Play, 
  Settings,
  FileText,
  FolderOpen
} from "lucide-react";

export function BatchProcess() {
  // 基本设置
  const [startNumber, setStartNumber] = useState("");
  const [endNumber, setEndNumber] = useState("");
  const [concurrency, setConcurrency] = useState("5");
  const [storagePath, setStoragePath] = useState("");
  
  // 路书内容
  const [roadmap, setRoadmap] = useState("");

  const handleStart = () => {
    console.log("开始批量生成", {
      startNumber,
      endNumber,
      concurrency,
      storagePath,
      roadmapLength: roadmap.length
    });
  };

  return (
    <Card className="shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          批量处理
        </CardTitle>
        <CardDescription>
          批量生成多个学生的学情反馈文档，支持并发处理
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* 基本设置区域 */}
        <div className="bg-gray-50 p-4 rounded-lg space-y-4">
          <h3 className="font-semibold text-gray-700 flex items-center gap-2">
            <Settings className="w-4 h-4" />
            基本设置
          </h3>
          
          {/* 任务编号范围 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startNumber">起始任务编号</Label>
              <Input
                id="startNumber"
                type="number"
                placeholder="例如：1"
                value={startNumber}
                onChange={(e) => setStartNumber(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="endNumber">结束任务编号</Label>
              <Input
                id="endNumber"
                type="number"
                placeholder="例如：10"
                value={endNumber}
                onChange={(e) => setEndNumber(e.target.value)}
              />
            </div>
          </div>
          
          {/* 并发数和存储路径 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="concurrency">并发数</Label>
              <Input
                id="concurrency"
                type="number"
                placeholder="默认：5"
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
              />
              <p className="text-xs text-gray-500">同时处理的任务数量，建议3-5</p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="storagePath">存储路径</Label>
              <div className="flex gap-2">
                <Input
                  id="storagePath"
                  placeholder="Google Drive 文件夹路径"
                  value={storagePath}
                  onChange={(e) => setStoragePath(e.target.value)}
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="icon">
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
        
        {/* 路书输入区域 */}
        <div className="space-y-2">
          <Label htmlFor="roadmap" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            路书内容
          </Label>
          <Textarea
            id="roadmap"
            placeholder="粘贴路书内容，包含学生信息和课堂笔记..."
            value={roadmap}
            onChange={(e) => setRoadmap(e.target.value)}
            className="min-h-[300px] font-mono text-sm"
          />
          <p className="text-xs text-gray-500">
            路书格式：每个任务用分隔符分开，包含学生姓名、课次、课堂笔记等信息
          </p>
        </div>
        
        {/* 开始按钮 */}
        <div className="flex justify-center pt-4">
          <Button 
            onClick={handleStart}
            size="lg"
            className="px-8"
          >
            <Play className="w-5 h-5 mr-2" />
            开始批量生成
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
