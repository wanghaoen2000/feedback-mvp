import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, BookOpen, FileText, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface RoadmapSettingsProps {
  disabled?: boolean;
}

// 防抖 Textarea 组件
const DebouncedTextarea = React.memo(function DebouncedTextarea({
  value,
  onChange,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
} & Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange'>) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      onChange(newValue);
    }, 300);
  }, [onChange]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return <Textarea {...props} value={localValue} onChange={handleChange} />;
});

export function RoadmapSettings({ disabled }: RoadmapSettingsProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // 记录正在保存哪个

  // 状态
  const [roadmap, setRoadmap] = useState("");
  const [roadmapClass, setRoadmapClass] = useState("");
  const [firstLessonTemplate, setFirstLessonTemplate] = useState("");
  const [classFirstLessonTemplate, setClassFirstLessonTemplate] = useState("");

  // 获取配置
  const configQuery = trpc.config.getAll.useQuery(undefined, {
    enabled: open,
  });

  // 更新配置
  const updateConfigMutation = trpc.config.update.useMutation();

  // 加载配置
  useEffect(() => {
    if (open && configQuery.data) {
      setRoadmap(configQuery.data.roadmap || "");
      setRoadmapClass(configQuery.data.roadmapClass || "");
      setFirstLessonTemplate(configQuery.data.firstLessonTemplate || "");
      setClassFirstLessonTemplate(configQuery.data.classFirstLessonTemplate || "");
    }
  }, [open, configQuery.data]);

  // 保存单个配置
  const handleSave = async (key: string, value: string, label: string) => {
    setSaving(key);
    try {
      await updateConfigMutation.mutateAsync({ [key]: value });
      await configQuery.refetch();
      alert(`${label}已保存！`);
    } catch (error) {
      alert(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSaving(null);
    }
  };

  // 清空单个配置
  const handleClear = async (key: string, setter: (v: string) => void, label: string) => {
    if (!confirm(`确定要清空${label}吗？`)) return;
    setSaving(key);
    try {
      await updateConfigMutation.mutateAsync({ [key]: "" });
      setter("");
      await configQuery.refetch();
      alert(`${label}已清空！`);
    } catch (error) {
      alert(`清空失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <BookOpen className="h-4 w-4 mr-2" />
          路书及范例管理
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>路书及范例管理</DialogTitle>
          <DialogDescription>
            管理一对一和小班课的路书内容以及首次课范例。每个配置独立保存，互不影响。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="roadmap" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="roadmap">路书</TabsTrigger>
            <TabsTrigger value="template">首次课范例</TabsTrigger>
          </TabsList>

          <TabsContent value="roadmap" className="space-y-6 mt-4">
            {/* 一对一路书 */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-600" />
                  一对一路书（V9路书）
                </Label>
                <div className="text-xs text-muted-foreground">
                  {roadmap ? `${roadmap.length} 字符` : "未配置"}
                </div>
              </div>
              <DebouncedTextarea
                value={roadmap}
                onChange={setRoadmap}
                placeholder="粘贴一对一课程的路书内容...&#10;&#10;路书用于指导AI生成学情反馈的格式和风格。"
                className="h-[150px] font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleSave("roadmap", roadmap, "一对一路书")}
                  disabled={saving !== null}
                >
                  {saving === "roadmap" ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  保存路书
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleClear("roadmap", setRoadmap, "一对一路书")}
                  disabled={saving !== null || !roadmap}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  清空
                </Button>
              </div>
            </div>

            {/* 小班课路书 */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4 text-green-600" />
                  小班课路书
                </Label>
                <div className="text-xs text-muted-foreground">
                  {roadmapClass ? `${roadmapClass.length} 字符` : "未配置"}
                </div>
              </div>
              <DebouncedTextarea
                value={roadmapClass}
                onChange={setRoadmapClass}
                placeholder="粘贴小班课的路书内容...&#10;&#10;小班课路书用于指导AI生成班级学情反馈。"
                className="h-[150px] font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleSave("roadmapClass", roadmapClass, "小班课路书")}
                  disabled={saving !== null}
                >
                  {saving === "roadmapClass" ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  保存路书
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleClear("roadmapClass", setRoadmapClass, "小班课路书")}
                  disabled={saving !== null || !roadmapClass}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  清空
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="template" className="space-y-6 mt-4">
            {/* 一对一首次课范例 */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4 text-orange-600" />
                  一对一首次课范例
                </Label>
                <div className="text-xs text-muted-foreground">
                  {firstLessonTemplate ? `${firstLessonTemplate.length} 字符` : "未配置"}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                勾选"新生首次课"时，此范例会自动填入"上次反馈"输入框，供AI参考生成格式。
              </p>
              <DebouncedTextarea
                value={firstLessonTemplate}
                onChange={setFirstLessonTemplate}
                placeholder="粘贴一对一首次课范例内容...&#10;&#10;这是一份完整的学情反馈范例，用于新生首次课时让AI学习输出格式。"
                className="h-[150px] font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleSave("firstLessonTemplate", firstLessonTemplate, "一对一首次课范例")}
                  disabled={saving !== null}
                >
                  {saving === "firstLessonTemplate" ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  保存范例
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleClear("firstLessonTemplate", setFirstLessonTemplate, "一对一首次课范例")}
                  disabled={saving !== null || !firstLessonTemplate}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  清空
                </Button>
              </div>
            </div>

            {/* 小班课首次课范例 */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4 text-purple-600" />
                  小班课首次课范例
                </Label>
                <div className="text-xs text-muted-foreground">
                  {classFirstLessonTemplate ? `${classFirstLessonTemplate.length} 字符` : "未配置"}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                勾选"首次课"时，此范例会自动填入"上次反馈"输入框，供AI参考生成格式。
              </p>
              <DebouncedTextarea
                value={classFirstLessonTemplate}
                onChange={setClassFirstLessonTemplate}
                placeholder="粘贴小班课首次课范例内容...&#10;&#10;这是一份完整的小班课学情反馈范例，用于首次课时让AI学习输出格式。"
                className="h-[150px] font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleSave("classFirstLessonTemplate", classFirstLessonTemplate, "小班课首次课范例")}
                  disabled={saving !== null}
                >
                  {saving === "classFirstLessonTemplate" ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  保存范例
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleClear("classFirstLessonTemplate", setClassFirstLessonTemplate, "小班课首次课范例")}
                  disabled={saving !== null || !classFirstLessonTemplate}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  清空
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
