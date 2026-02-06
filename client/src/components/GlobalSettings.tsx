import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Loader2, Save, FolderOpen, Key } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface GlobalSettingsProps {
  disabled?: boolean;
}

export function GlobalSettings({ disabled }: GlobalSettingsProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // API 配置状态
  const [apiModel, setApiModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [maxTokens, setMaxTokens] = useState("64000");

  // 存储路径状态
  const [driveBasePath, setDriveBasePath] = useState("");
  const [classStoragePath, setClassStoragePath] = useState("");
  const [batchStoragePath, setBatchStoragePath] = useState("");

  // 获取配置
  const configQuery = trpc.config.getAll.useQuery(undefined, {
    enabled: open, // 只在对话框打开时获取
  });

  // 更新配置
  const updateConfigMutation = trpc.config.update.useMutation();

  // 当对话框打开时，加载配置
  useEffect(() => {
    if (open && configQuery.data) {
      setApiModel(configQuery.data.apiModel || "");
      setApiUrl(configQuery.data.apiUrl || "");
      setMaxTokens(configQuery.data.maxTokens || "64000");
      setDriveBasePath(configQuery.data.driveBasePath || "");
      setClassStoragePath(configQuery.data.classStoragePath || "");
      setBatchStoragePath(configQuery.data.batchStoragePath || "");
      // 不加载 apiKey，保持为空（安全考虑）
    }
  }, [open, configQuery.data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateConfigMutation.mutateAsync({
        apiModel: apiModel.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        apiUrl: apiUrl.trim() || undefined,
        maxTokens: maxTokens.trim() || undefined,
        driveBasePath: driveBasePath.trim() || undefined,
        classStoragePath: classStoragePath.trim() || undefined,
        batchStoragePath: batchStoragePath.trim() || undefined,
      });
      await configQuery.refetch();
      alert("全局设置已保存！");
      setApiKey(""); // 清空密钥输入框
    } catch (error) {
      alert("保存失败：" + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" disabled={disabled} title="全局设置">
          <Settings className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>全局设置</DialogTitle>
          <DialogDescription>
            API配置和存储路径设置。这些设置对一对一、小班课、批量生成全局生效。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="api" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="api" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API配置
            </TabsTrigger>
            <TabsTrigger value="storage" className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              存储路径
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="global-apiModel">模型名称</Label>
              <Input
                id="global-apiModel"
                value={apiModel}
                onChange={(e) => setApiModel(e.target.value)}
                placeholder="例如：claude-sonnet-4-5-20250929"
              />
              <p className="text-xs text-muted-foreground">
                留空则使用系统默认模型
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="global-apiKey">API 密钥</Label>
              <Input
                id="global-apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={configQuery.data?.hasApiKey ? "已配置（输入新值可更新）" : "sk-xxxxxxxx"}
              />
              <p className="text-xs text-muted-foreground">
                {configQuery.data?.hasApiKey
                  ? "已配置密钥。输入新值可更新，留空则保持不变。"
                  : "请输入您的 API 密钥"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="global-apiUrl">API 地址</Label>
              <Input
                id="global-apiUrl"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="例如：https://api.whatai.cc/v1"
              />
              <p className="text-xs text-muted-foreground">
                留空则使用系统默认地址
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="global-maxTokens">最大 Token 数</Label>
              <Input
                id="global-maxTokens"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                min={1000}
                max={200000}
                placeholder="64000"
              />
              <p className="text-xs text-muted-foreground">
                AI 生成的最大 token 数（1000-200000）
              </p>
            </div>
          </TabsContent>

          <TabsContent value="storage" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="global-driveBasePath">一对一存储路径</Label>
              <Input
                id="global-driveBasePath"
                value={driveBasePath}
                onChange={(e) => setDriveBasePath(e.target.value)}
                placeholder="Mac/Documents/XDF/学生档案"
              />
              <p className="text-xs text-muted-foreground">
                一对一课程内容的 Google Drive 存储路径
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="global-classStoragePath">小班课存储路径</Label>
              <Input
                id="global-classStoragePath"
                value={classStoragePath}
                onChange={(e) => setClassStoragePath(e.target.value)}
                placeholder="Mac/Documents/XDF/学生档案"
              />
              <p className="text-xs text-muted-foreground">
                小班课内容的 Google Drive 存储路径。留空则使用一对一路径。
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="global-batchStoragePath">批量生成存储路径</Label>
              <Input
                id="global-batchStoragePath"
                value={batchStoragePath}
                onChange={(e) => setBatchStoragePath(e.target.value)}
                placeholder="Mac(online)/Documents/XDF/批量任务"
              />
              <p className="text-xs text-muted-foreground">
                批量生成内容的 Google Drive 存储路径
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                保存全局设置
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
