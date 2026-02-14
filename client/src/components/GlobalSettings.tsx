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
import { Settings, Loader2, Save, FolderOpen, Key, Cloud, Search, RefreshCw, CheckCircle2, XCircle, MinusCircle, Circle, List, Plus, Trash2, Shield, Crown, UserPlus, Eye, ArrowLeftRight, Download, Upload } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

interface GlobalSettingsProps {
  disabled?: boolean;
}

export function GlobalSettings({ disabled }: GlobalSettingsProps) {
  const { user: authUser } = useAuth();
  const isAdmin = authUser?.role === 'admin';
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // API 配置状态
  const [apiModel, setApiModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [maxTokens, setMaxTokens] = useState("64000");
  const [modelPresets, setModelPresets] = useState("");
  const [showPresetEditor, setShowPresetEditor] = useState(false);
  const [forceCustomInput, setForceCustomInput] = useState(false);

  // API 供应商预设
  type ProviderDisplay = { name: string; maskedKey: string; apiUrl: string };
  type ProviderEdit = { name: string; apiKey: string; apiUrl: string };
  const [providerDisplayList, setProviderDisplayList] = useState<ProviderDisplay[]>([]);
  const [providerEditList, setProviderEditList] = useState<ProviderEdit[]>([]);
  const [showProviderEditor, setShowProviderEditor] = useState(false);
  const [providerEditorDirty, setProviderEditorDirty] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>(""); // 选中的供应商名称

  // 存储路径状态
  const [driveBasePath, setDriveBasePath] = useState("");
  const [classStoragePath, setClassStoragePath] = useState("");
  const [batchStoragePath, setBatchStoragePath] = useState("");
  const [gradingStoragePath, setGradingStoragePath] = useState("");
  const [gdriveLocalBasePath, setGdriveLocalBasePath] = useState("");
  const [gdriveDownloadsPath, setGdriveDownloadsPath] = useState("");

  // 白名单
  const [allowedEmails, setAllowedEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [allowedEmailsDirty, setAllowedEmailsDirty] = useState(false);

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

  // 备份/恢复状态
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const exportBackupQuery = trpc.config.exportBackup.useQuery(undefined, { enabled: false });
  const importBackupMut = trpc.config.importBackup.useMutation();

  // 管理员功能状态
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<"user" | "admin">("user");

  // 管理员查询
  const usersQuery = trpc.admin.listUsers.useQuery(undefined, {
    enabled: open && isAdmin,
  });
  const impersonateMut = trpc.admin.impersonateUser.useMutation();
  const createUserMut = trpc.admin.createUser.useMutation();
  const deleteUserMut = trpc.admin.deleteUser.useMutation();

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
      setGradingStoragePath(configQuery.data.gradingStoragePath || "");
      setGdriveLocalBasePath(configQuery.data.gdriveLocalBasePath || "");
      setGdriveDownloadsPath(configQuery.data.gdriveDownloadsPath || "");
      setModelPresets(configQuery.data.modelPresets || "");
      setForceCustomInput(false);
      // 加载供应商预设
      const presets = configQuery.data.apiProviderPresets || [];
      setProviderDisplayList(presets);
      setProviderEditList(presets.map((p: ProviderDisplay) => ({ name: p.name, apiKey: "", apiUrl: p.apiUrl })));
      setSelectedProvider("");
      setShowProviderEditor(false);
      setProviderEditorDirty(false);
      // 加载白名单
      try {
        const emails = configQuery.data.allowedEmails ? JSON.parse(configQuery.data.allowedEmails) : [];
        setAllowedEmails(Array.isArray(emails) ? emails : []);
      } catch { setAllowedEmails([]); }
      setNewEmail("");
      setAllowedEmailsDirty(false);
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
        gradingStoragePath: gradingStoragePath.trim() || undefined,
        gdriveLocalBasePath: gdriveLocalBasePath.trim() || undefined,
        gdriveDownloadsPath: gdriveDownloadsPath.trim() || undefined,
        modelPresets,
        ...(providerEditorDirty ? { apiProviderPresets: JSON.stringify(providerEditList) } : {}),
        ...(selectedProvider ? { applyProviderKey: selectedProvider } : {}),
        ...(allowedEmailsDirty ? { allowedEmails: JSON.stringify(allowedEmails) } : {}),
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
          <TabsList className={`grid w-full ${isAdmin ? 'grid-cols-5' : 'grid-cols-4'}`}>
            <TabsTrigger value="api" className="flex items-center gap-1 px-1 text-xs">
              <Key className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">API</span>配置
            </TabsTrigger>
            <TabsTrigger value="storage" className="flex items-center gap-1 px-1 text-xs">
              <FolderOpen className="h-4 w-4 shrink-0" />
              路径
            </TabsTrigger>
            <TabsTrigger value="gdrive" className="flex items-center gap-1 px-1 text-xs">
              <Cloud className="h-4 w-4 shrink-0" />
              云盘
            </TabsTrigger>
            <TabsTrigger value="check" className="flex items-center gap-1 px-1 text-xs">
              <Search className="h-4 w-4 shrink-0" />
              自检
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="admin" className="flex items-center gap-1 px-1 text-xs">
                <Crown className="h-4 w-4 shrink-0" />
                管理
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="api" className="space-y-4 mt-4">
            {(() => {
              const presetList = modelPresets.split('\n').map(s => s.trim()).filter(Boolean);
              const isCurrentModelInPresets = apiModel !== '' && presetList.includes(apiModel);
              const selectValue = forceCustomInput
                ? '__custom__'
                : apiModel === ''
                  ? '__default__'
                  : isCurrentModelInPresets
                    ? apiModel
                    : '__custom__';
              const showCustomInput = presetList.length > 0 && (forceCustomInput || (!isCurrentModelInPresets && apiModel !== ''));

              return (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="global-apiModel">模型名称</Label>
                    {presetList.length > 0 ? (
                      <>
                        <Select
                          value={selectValue}
                          onValueChange={(val) => {
                            if (val === '__default__') {
                              setApiModel('');
                              setForceCustomInput(false);
                            } else if (val === '__custom__') {
                              setForceCustomInput(true);
                            } else {
                              setApiModel(val);
                              setForceCustomInput(false);
                            }
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__">留空（使用默认模型）</SelectItem>
                            <SelectSeparator />
                            {presetList.map((model) => (
                              <SelectItem key={model} value={model}>{model}</SelectItem>
                            ))}
                            <SelectSeparator />
                            <SelectItem value="__custom__">自定义输入...</SelectItem>
                          </SelectContent>
                        </Select>
                        {showCustomInput && (
                          <Input
                            id="global-apiModel"
                            value={apiModel}
                            onChange={(e) => setApiModel(e.target.value)}
                            placeholder="输入自定义模型名称"
                          />
                        )}
                        <p className="text-xs text-muted-foreground">
                          从预设列表快速选择，或选"自定义输入"手动填写
                        </p>
                      </>
                    ) : (
                      <>
                        <Input
                          id="global-apiModel"
                          value={apiModel}
                          onChange={(e) => setApiModel(e.target.value)}
                          placeholder="例如：claude-sonnet-4-5-20250929"
                        />
                        <p className="text-xs text-muted-foreground">
                          留空则使用系统默认模型
                        </p>
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowPresetEditor(!showPresetEditor)}
                    >
                      <List className="h-3 w-3" />
                      编辑常用模型列表{presetList.length > 0 ? `（${presetList.length} 个）` : ''}
                    </button>
                    {showPresetEditor && (
                      <Textarea
                        value={modelPresets}
                        onChange={(e) => setModelPresets(e.target.value)}
                        placeholder={"每行一个模型名称，例如：\nclaude-sonnet-4-5-20250929\nclaude-haiku-4-5-20251001\ngpt-4o"}
                        rows={5}
                        className="text-sm font-mono"
                      />
                    )}
                  </div>
                </>
              );
            })()}

            {/* API 供应商选择 */}
            {providerDisplayList.length > 0 && (
              <div className="space-y-2">
                <Label>API 供应商</Label>
                <Select
                  value={selectedProvider || "__manual__"}
                  onValueChange={(val) => {
                    if (val === "__manual__") {
                      setSelectedProvider("");
                    } else {
                      setSelectedProvider(val);
                      // 自动填充该供应商的 URL
                      const provider = providerDisplayList.find(p => p.name === val);
                      if (provider) {
                        setApiUrl(provider.apiUrl);
                      }
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual__">手动输入</SelectItem>
                    <SelectSeparator />
                    {providerDisplayList.map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        {p.name}{p.maskedKey ? ` (${p.maskedKey})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedProvider
                    ? `将使用「${selectedProvider}」的密钥和地址`
                    : "选择供应商快速切换，或手动输入密钥和地址"}
                </p>
              </div>
            )}

            {/* 编辑供应商列表 */}
            <div className="space-y-2">
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowProviderEditor(!showProviderEditor)}
              >
                <List className="h-3 w-3" />
                编辑供应商列表{providerDisplayList.length > 0 ? `（${providerDisplayList.length} 个）` : ''}
              </button>
              {showProviderEditor && (
                <div className="space-y-3 border rounded-lg p-3 bg-gray-50">
                  {providerEditList.map((provider, index) => (
                    <div key={index} className="space-y-2 border rounded p-2 bg-white relative">
                      <button
                        type="button"
                        className="absolute top-2 right-2 text-gray-400 hover:text-red-500 transition-colors"
                        onClick={() => {
                          const newList = providerEditList.filter((_, i) => i !== index);
                          setProviderEditList(newList);
                          setProviderEditorDirty(true);
                        }}
                        title="删除此供应商"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <Input
                        value={provider.name}
                        onChange={(e) => {
                          const newList = [...providerEditList];
                          newList[index] = { ...newList[index], name: e.target.value };
                          setProviderEditList(newList);
                          setProviderEditorDirty(true);
                        }}
                        placeholder="供应商名称（如：DMXapi）"
                        className="text-sm"
                      />
                      <Input
                        type="password"
                        value={provider.apiKey}
                        onChange={(e) => {
                          const newList = [...providerEditList];
                          newList[index] = { ...newList[index], apiKey: e.target.value };
                          setProviderEditList(newList);
                          setProviderEditorDirty(true);
                        }}
                        placeholder={providerDisplayList[index]?.maskedKey
                          ? `已配置 (${providerDisplayList[index].maskedKey})，留空保持不变`
                          : "API 密钥（sk-xxxxxxxx）"}
                        className="text-sm"
                      />
                      <Input
                        value={provider.apiUrl}
                        onChange={(e) => {
                          const newList = [...providerEditList];
                          newList[index] = { ...newList[index], apiUrl: e.target.value };
                          setProviderEditList(newList);
                          setProviderEditorDirty(true);
                        }}
                        placeholder="API 地址（如：https://www.DMXapi.com/v1）"
                        className="text-sm"
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setProviderEditList([...providerEditList, { name: "", apiKey: "", apiUrl: "" }]);
                      setProviderEditorDirty(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    添加供应商
                  </Button>
                  {providerEditorDirty && (
                    <p className="text-xs text-orange-600">供应商列表已修改，请点击「保存设置」生效</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="global-apiKey">API 密钥</Label>
              <Input
                id="global-apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (e.target.value) setSelectedProvider(""); // 手动输入密钥时取消供应商选择
                }}
                placeholder={
                  selectedProvider
                    ? `将使用「${selectedProvider}」的密钥`
                    : configQuery.data?.hasApiKey
                      ? "已配置（输入新值可更新）"
                      : "sk-xxxxxxxx"
                }
                disabled={!!selectedProvider}
              />
              <p className="text-xs text-muted-foreground">
                {selectedProvider
                  ? `密钥将从供应商「${selectedProvider}」自动获取`
                  : configQuery.data?.hasApiKey
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
                {selectedProvider ? `已从「${selectedProvider}」填入地址` : "留空则使用系统默认地址"}
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
                一对一课程存储路径
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
                小班课存储路径，留空则用一对一路径
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
                批量生成存储路径
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="global-gradingStoragePath">周打分记录存储路径</Label>
              <Input
                id="global-gradingStoragePath"
                value={gradingStoragePath}
                onChange={(e) => setGradingStoragePath(e.target.value)}
                placeholder="留空则自动用「一对一路径/周打分记录」"
              />
              <p className="text-xs text-muted-foreground">
                每次打分完成后自动上传到此文件夹，留空则默认放在一对一路径下的「周打分记录」子文件夹
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground">自动提取文件（从 Google Drive 网盘读取）</p>
              <Label htmlFor="global-gdriveDownloadsPath">Downloads 文件夹路径</Label>
              <Input
                id="global-gdriveDownloadsPath"
                value={gdriveDownloadsPath}
                onChange={(e) => setGdriveDownloadsPath(e.target.value)}
                placeholder="Mac M3/Downloads"
              />
              <p className="text-xs text-muted-foreground">
                网盘上 Downloads 路径，用于提取录音转文字
              </p>
            </div>
          </TabsContent>

          <TabsContent value="gdrive" className="space-y-4 mt-4">
            {/* 连接状态 */}
            <div className="border rounded-lg p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-gray-600 shrink-0" />
                  <span className="font-medium text-sm">Google Drive</span>
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
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-600 mb-2">
                  <span className="font-medium">回调地址</span>（需添加到 Google Cloud Console）
                </div>
                <div className="space-y-2">
                  <code className="block bg-gray-100 px-3 py-2 rounded text-xs font-mono text-gray-800 break-all">
                    {gdriveAuthUrlQuery.data.redirectUri}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
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
              <div className="bg-gray-50 p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-gray-600 shrink-0" />
                  <span className="font-medium text-sm">系统自检</span>
                  {checkSummary && (
                    <span className={`text-xs ${checkSummary.allPassed ? 'text-green-600' : 'text-orange-600'}`}>
                      ({checkSummary.passed}/{checkSummary.total})
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

          {/* 管理员面板 */}
          {isAdmin && (
            <TabsContent value="admin" className="space-y-4 mt-4">
              {/* 用户列表 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">用户管理</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => usersQuery.refetch()}
                    disabled={usersQuery.isRefetching}
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${usersQuery.isRefetching ? 'animate-spin' : ''}`} />
                    刷新
                  </Button>
                </div>

                {/* 创建用户 */}
                <div className="border rounded-lg p-3 space-y-2">
                  <Label className="text-xs text-muted-foreground">创建新用户</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="用户名"
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="邮箱（可选）"
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      className="flex-1"
                    />
                    <Select value={newUserRole} onValueChange={(v) => setNewUserRole(v as "user" | "admin")}>
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">用户</SelectItem>
                        <SelectItem value="admin">管理员</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!newUserName.trim()) return;
                      try {
                        const emailVal = newUserEmail.trim();
                        await createUserMut.mutateAsync({
                          name: newUserName.trim(),
                          email: emailVal || undefined,
                          role: newUserRole,
                        });
                        // 前端也同步白名单显示（后端已自动同步数据库）
                        if (emailVal && !allowedEmails.some(em => em.toLowerCase() === emailVal.toLowerCase())) {
                          setAllowedEmails(prev => [...prev, emailVal]);
                        }
                        setNewUserName("");
                        setNewUserEmail("");
                        setNewUserRole("user");
                        usersQuery.refetch();
                      } catch (err: any) {
                        alert("创建失败: " + (err?.message || "未知错误"));
                      }
                    }}
                    disabled={!newUserName.trim() || createUserMut.isPending}
                  >
                    {createUserMut.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <UserPlus className="h-3 w-3 mr-1" />
                    )}
                    创建用户
                  </Button>
                </div>

                {/* 用户列表表格 */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-[300px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2">ID</th>
                          <th className="text-left p-2">用户名</th>
                          <th className="text-left p-2">邮箱</th>
                          <th className="text-left p-2">角色</th>
                          <th className="text-left p-2">最后登录</th>
                          <th className="text-right p-2">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usersQuery.data?.map((u) => (
                          <tr key={u.id} className="border-t hover:bg-muted/30">
                            <td className="p-2 text-muted-foreground">{u.id}</td>
                            <td className="p-2 font-medium">
                              {u.name || "-"}
                              {u.id === authUser?.id && (
                                <span className="ml-1 text-xs text-blue-500">(你)</span>
                              )}
                            </td>
                            <td className="p-2 text-muted-foreground">{u.email || "-"}</td>
                            <td className="p-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                u.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                              }`}>
                                {u.role === 'admin' ? '管理员' : '用户'}
                              </span>
                            </td>
                            <td className="p-2 text-muted-foreground">
                              {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString('zh-CN') : '-'}
                            </td>
                            <td className="p-2 text-right">
                              <div className="flex gap-1 justify-end">
                                {u.id !== authUser?.id && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs"
                                      title="以该用户身份查看"
                                      onClick={async () => {
                                        if (!confirm(`确定切换到用户 "${u.name}" 的视角？`)) return;
                                        try {
                                          await impersonateMut.mutateAsync({ userId: u.id });
                                          window.location.reload();
                                        } catch (err: any) {
                                          alert("切换失败: " + (err?.message || "未知错误"));
                                        }
                                      }}
                                      disabled={impersonateMut.isPending}
                                    >
                                      <Eye className="h-3 w-3 mr-0.5" />
                                      切换
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                                      title="删除用户"
                                      onClick={async () => {
                                        if (!confirm(`确定删除用户 "${u.name}"？此操作不可逆。`)) return;
                                        try {
                                          await deleteUserMut.mutateAsync({ userId: u.id });
                                          usersQuery.refetch();
                                        } catch (err: any) {
                                          alert("删除失败: " + (err?.message || "未知错误"));
                                        }
                                      }}
                                      disabled={deleteUserMut.isPending}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {(!usersQuery.data || usersQuery.data.length === 0) && (
                          <tr>
                            <td colSpan={6} className="p-4 text-center text-muted-foreground">
                              {usersQuery.isLoading ? "加载中..." : "暂无用户"}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  手动创建的用户使用 manual 登录方式。切换用户后页面会刷新，以该用户身份查看所有数据。
                  创建带邮箱的用户时会自动添加到下方白名单。
                </p>
              </div>

              {/* 邮箱白名单（从原「权限」Tab 合并到此处） */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-600" />
                  <Label className="text-sm font-medium">邮箱白名单</Label>
                </div>
                <div className="border rounded-lg p-3 bg-blue-50">
                  <p className="text-xs text-blue-700">
                    白名单控制谁可以使用本系统。只有邮箱在列表中的用户登录后才能访问。
                    清空列表则所有登录用户均可使用（开放模式）。上方创建用户时填写邮箱会自动同步到此列表。
                  </p>
                </div>

                {allowedEmails.map((email, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={email}
                      onChange={(e) => {
                        const updated = [...allowedEmails];
                        updated[index] = e.target.value;
                        setAllowedEmails(updated);
                        setAllowedEmailsDirty(true);
                      }}
                      placeholder="user@example.com"
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-gray-400 hover:text-red-500"
                      onClick={() => {
                        setAllowedEmails(allowedEmails.filter((_, i) => i !== index));
                        setAllowedEmailsDirty(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                <div className="flex items-center gap-2">
                  <Input
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="输入邮箱地址并点击添加"
                    className="text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newEmail.trim()) {
                        e.preventDefault();
                        if (!allowedEmails.some(em => em.toLowerCase() === newEmail.trim().toLowerCase())) {
                          setAllowedEmails([...allowedEmails, newEmail.trim()]);
                          setAllowedEmailsDirty(true);
                        }
                        setNewEmail("");
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={!newEmail.trim()}
                    onClick={() => {
                      if (newEmail.trim() && !allowedEmails.some(em => em.toLowerCase() === newEmail.trim().toLowerCase())) {
                        setAllowedEmails([...allowedEmails, newEmail.trim()]);
                        setAllowedEmailsDirty(true);
                      }
                      setNewEmail("");
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    添加
                  </Button>
                </div>

                {allowedEmailsDirty && (
                  <p className="text-xs text-orange-600">白名单已修改，请点击「保存设置」生效</p>
                )}

                {allowedEmails.length === 0 && (
                  <p className="text-xs text-amber-600">
                    白名单为空 = 开放模式，所有登录用户均可使用系统。添加邮箱后仅白名单中的用户可以访问。
                  </p>
                )}
              </div>
            </TabsContent>
          )}
        </Tabs>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 mr-auto">
            {/* 一键备份 */}
            <Button
              variant="outline"
              size="sm"
              disabled={isExporting}
              onClick={async () => {
                setIsExporting(true);
                try {
                  const result = await exportBackupQuery.refetch();
                  if (result.data) {
                    const json = JSON.stringify(result.data, null, 2);
                    const blob = new Blob([json], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    const date = new Date().toISOString().slice(0, 10);
                    a.download = `config-backup-${date}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }
                } catch (err: any) {
                  alert("导出失败: " + (err?.message || "未知错误"));
                } finally {
                  setIsExporting(false);
                }
              }}
            >
              {isExporting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1 h-3.5 w-3.5" />
              )}
              一键备份
            </Button>

            {/* 一键恢复 */}
            <Button
              variant="outline"
              size="sm"
              disabled={isImporting}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".json";
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;
                  setIsImporting(true);
                  try {
                    const text = await file.text();
                    const backup = JSON.parse(text);
                    if (!backup.config || backup.version !== 1) {
                      alert("无效的备份文件格式");
                      return;
                    }
                    const keyCount = Object.keys(backup.config).length;
                    if (!confirm(`确认从备份恢复 ${keyCount} 项配置？\n\n来源: ${backup.userName || '未知'} (${backup.exportedAt || '未知时间'})\n\n注意: API密钥等敏感信息会被跳过，需要手动重新配置。`)) {
                      return;
                    }
                    const result = await importBackupMut.mutateAsync({
                      config: backup.config,
                    });
                    alert(`恢复完成！\n已恢复: ${result.restored} 项\n跳过: ${result.skipped} 项`);
                    // 刷新配置
                    configQuery.refetch();
                  } catch (err: any) {
                    alert("恢复失败: " + (err?.message || "JSON格式错误"));
                  } finally {
                    setIsImporting(false);
                  }
                };
                input.click();
              }}
            >
              {isImporting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1 h-3.5 w-3.5" />
              )}
              一键恢复
            </Button>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                保存设置
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
