import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, FileText, Loader2 } from "lucide-react";
import mammoth from "mammoth";

interface FileUploadInputProps {
  onFileContent: (content: string | null, fileName: string | null) => void;
  disabled?: boolean;
  accept?: string;
  className?: string;
}

export function FileUploadInput({
  onFileContent,
  disabled = false,
  accept = ".docx,.md,.txt",
  className = "",
}: FileUploadInputProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);

    try {
      let content: string;

      if (file.name.endsWith(".docx")) {
        // 解析 Word 文档
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        content = result.value;
      } else if (file.name.endsWith(".md") || file.name.endsWith(".txt")) {
        // 直接读取文本文件
        content = await file.text();
      } else {
        throw new Error("不支持的文件格式，请上传 .docx、.md 或 .txt 文件");
      }

      if (!content.trim()) {
        throw new Error("文件内容为空");
      }

      setFileName(file.name);
      onFileContent(content, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件解析失败");
      setFileName(null);
      onFileContent(null, null);
    } finally {
      setIsProcessing(false);
      // 重置 input，允许重复选择同一文件
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const handleClear = () => {
    setFileName(null);
    setError(null);
    onFileContent(null, null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        disabled={disabled || isProcessing}
        className="hidden"
      />

      {fileName ? (
        // 已上传状态
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-md text-sm">
          <FileText className="h-4 w-4 text-blue-600" />
          <span className="text-blue-700 max-w-[150px] truncate" title={fileName}>
            {fileName}
          </span>
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="text-blue-500 hover:text-blue-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        // 未上传状态
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isProcessing}
          className="text-xs"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              解析中...
            </>
          ) : (
            <>
              <Upload className="h-3 w-3 mr-1" />
              上传文件
            </>
          )}
        </Button>
      )}

      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  );
}
