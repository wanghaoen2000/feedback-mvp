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
import { Settings, Loader2, Save, FolderOpen, Key, Cloud, Search, RefreshCw, CheckCircle2, XCircle, MinusCircle, Circle } from "lucide-react";
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

  // Google Drive 连接状态
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

  // 获取配置
  const configQuery = trpc.config.getAll.useQuery(undefined, {
    enabled: open, // 只在对话框打开时获取
  });

  // Google Drive 状态查询
  const gdriveStatusQuery = trpc.feedback.googleAuthStatus.useQuery();
  const gdriveAuthUrlQuery = trpc.feedback.googleAuthUrl.useQuery();
  const gdriveDisconnectMutation = trpc.feedback.googleAuthDisconnect.useMutation();
  const gdriveCallbackMutation = trpc.feedback.googleAuthCallback.useMutation();
  const systemCheckMutation = trpc.feedback.systemCheck.useMutation();

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

  // Google Drive 连接处理
  const handleConnectGdrive = async () => {
    setIsConnectingGdrive(true);
    try {
      if (gdriveAuthUrlQuery.data?.url) {
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
            API配置、存储路径和 Google Drive 连接设置。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="api" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="api" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API配置
            </TabsTrigger>
            <TabsTrigger value="storage" className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              存储路径
            </TabsTrigger>
            <TabsTrigger value="gdrive" className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              云盘连接
            </TabsTrigger>
            <TabsTrigger value="check" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              系统自检
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

          <TabsContent value="gdrive" className="space-y-4 mt-4">
            {/* 连接状态 */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-gray-600" />
                  <span className="font-medium">Google Drive</span>
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
                    disabled={isDisconnectingGdrive}
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
                    disabled={isConnectingGdrive || gdriveStatusQuery.isLoading}
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
                <p className="text-sm text-gray-600 mt-3">
                  授权有效期至：{new Date(gdriveStatusQuery.data.expiresAt).toLocaleString('zh-CN')}
                </p>
              )}
            </div>

            {/* 回调地址 */}
            {gdriveAuthUrlQuery.data?.redirectUri && (
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-600 mb-2">
                  <span className="font-medium">回调地址</span>（需添加到 Google Cloud Console）：
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-xs font-mono text-gray-800 break-all">
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
          </TabsContent>

          <TabsContent value="check" className="space-y-4 mt-4">
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
                  disabled={isChecking}
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
